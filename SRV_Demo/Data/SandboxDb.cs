using MySqlConnector;

namespace SRV_Demo.Data;

/// <summary>
/// Database wrapper that never commits. The whole process shares ONE connection with ONE outer transaction;
/// each logical unit of work is a SAVEPOINT inside it (so a failing request still rolls back cleanly), and everything is
/// discarded when the process stops.
///
/// Enable with <c>Db:Sandbox=true</c> (env var <c>Db__Sandbox=true</c>). Used by the integration tests and for trying the
/// UI against the real database without leaving data behind. Not for production: requests are serialised.
/// </summary>
public sealed class SandboxDb : Db, IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private MySqlConnection? _conn;
    private MySqlTransaction? _outer;
    private int _seq;

    public SandboxDb(IConfiguration cfg, IRealtime realtime, ILogger<Db> log) : base(cfg, realtime, log)
    {
        log.LogWarning("SANDBOX MODE: all database writes are rolled back when the application stops. Nothing is persisted.");
    }

    private async Task<(MySqlConnection Conn, MySqlTransaction Tx)> SharedAsync()
    {
        if (_conn is null)
        {
            _conn = await OpenAsync();
            // Without this, REPEATABLE READ would pin a snapshot at the first read and hide rows committed by others.
            await using (var iso = new MySqlCommand("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED", _conn))
                await iso.ExecuteNonQueryAsync();
            _outer = await _conn.BeginTransactionAsync();
        }
        return (_conn, _outer!);
    }

    private static async Task Exec(MySqlConnection c, MySqlTransaction t, string sql)
    {
        await using var cmd = new MySqlCommand(sql, c, t);
        await cmd.ExecuteNonQueryAsync();
    }

    public override async Task<T> ReadAsync<T>(Func<Tx, Task<T>> work)
    {
        await _gate.WaitAsync();
        try
        {
            var (c, t) = await SharedAsync();
            return await work(new Tx(c, t));
        }
        finally { _gate.Release(); }
    }

    public override async Task<T> TxAsync<T>(Func<Tx, Task<T>> work)
    {
        Tx tx;
        T result;
        await _gate.WaitAsync();
        try
        {
            var (c, t) = await SharedAsync();
            var sp = "sp_" + (++_seq);
            await Exec(c, t, $"SAVEPOINT {sp}");
            tx = new Tx(c, t);
            try
            {
                result = await work(tx);
                await Exec(c, t, $"RELEASE SAVEPOINT {sp}");
            }
            catch
            {
                await Exec(c, t, $"ROLLBACK TO SAVEPOINT {sp}");
                throw;
            }
        }
        finally { _gate.Release(); }
        await PublishAsync(tx.Events);
        return result;
    }

    public async ValueTask DisposeAsync()
    {
        if (_outer is not null) { try { await _outer.RollbackAsync(); } catch { /* connection already gone */ } await _outer.DisposeAsync(); }
        if (_conn is not null) await _conn.DisposeAsync();
        _gate.Dispose();
    }
}
