using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using MySqlConnector;

namespace SRV_Demo.Data;

/// <summary>A row change to broadcast to connected browsers after the transaction commits.</summary>
public sealed record ChangeEvent(string Table, string Action, Row Row, string? ToUserId = null);

public interface IRealtime
{
    Task PublishAsync(IReadOnlyCollection<ChangeEvent> events);
}

public sealed class NullRealtime : IRealtime
{
    public Task PublishAsync(IReadOnlyCollection<ChangeEvent> events) => Task.CompletedTask;
}

/// <summary>One database unit of work (connection + optional transaction) plus the events it produced.</summary>
public sealed class Tx(MySqlConnection conn, MySqlTransaction? transaction)
{
    public MySqlConnection Conn { get; } = conn;
    public MySqlTransaction? Transaction { get; } = transaction;
    public List<ChangeEvent> Events { get; } = [];

    /// <summary>Single timestamp for the whole unit of work (UTC, millisecond precision = DATETIME(3)).</summary>
    public DateTime Now { get; } = Fmt.TruncateMs(DateTime.UtcNow);

    private MySqlCommand Cmd(string sql, (string Name, object? Value)[] args)
    {
        var cmd = new MySqlCommand(sql, Conn, Transaction);
        foreach (var (name, value) in args)
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    public async Task<int> ExecAsync(string sql, params (string Name, object? Value)[] args)
    {
        await using var cmd = Cmd(sql, args);
        return await cmd.ExecuteNonQueryAsync();
    }

    public async Task<object?> ScalarAsync(string sql, params (string Name, object? Value)[] args)
    {
        await using var cmd = Cmd(sql, args);
        var v = await cmd.ExecuteScalarAsync();
        return v switch { DBNull => null, Guid g => g.ToString("D"), _ => v }; // CHAR(36) arrives as Guid
    }

    /// <summary>Runs a query and returns JSON-friendly rows (timestamps as ISO-8601 UTC strings, JSON columns parsed).</summary>
    public async Task<List<Row>> QueryAsync(string sql, TableDef? def, params (string Name, object? Value)[] args)
    {
        await using var cmd = Cmd(sql, args);
        await using var r = await cmd.ExecuteReaderAsync();
        var rows = new List<Row>();
        var names = new string[r.FieldCount];
        for (var i = 0; i < names.Length; i++) names[i] = r.GetName(i);
        while (await r.ReadAsync())
        {
            var row = new Row(names.Length);
            for (var i = 0; i < names.Length; i++)
            {
                var raw = r.IsDBNull(i) ? null : r.GetValue(i);
                var col = def?.Find(names[i]);
                row[names[i]] = Fmt.ToJsonValue(col?.Type, raw);
            }
            rows.Add(row);
        }
        return rows;
    }
}

/// <summary>
/// Connection factory + transaction helper. Registered as a singleton; tests replace it with a rollback-only subclass.
/// </summary>
public class Db
{
    // MariaDB on the hosted server runs with sql_mode=NO_ENGINE_SUBSTITUTION (not strict) and a Berlin session time zone.
    // Force strict mode + UTC for every physical connection so data is validated and NOW()-style values are predictable.
    private const string SessionInit =
        "SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', time_zone='+00:00'";

    private readonly string _connectionString;
    private readonly IRealtime _realtime;
    private readonly ILogger<Db> _log;
    private readonly ConcurrentDictionary<int, bool> _initialised = new();

    public Db(IConfiguration cfg, IRealtime realtime, ILogger<Db> log)
    {
        var raw = cfg.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException(
                "Missing ConnectionStrings:Default. Set it in appsettings.Development.json or the environment variable ConnectionStrings__Default.");
        var b = new MySqlConnectionStringBuilder(raw)
        {
            DateTimeKind = MySqlDateTimeKind.Utc,
            // Session state is initialised once per physical connection (see EnsureSession); skip the reset round-trip on reuse.
            ConnectionReset = false,
        };
        if (!raw.Contains("Maximum Pool Size", StringComparison.OrdinalIgnoreCase) &&
            !raw.Contains("MaximumPoolSize", StringComparison.OrdinalIgnoreCase))
            b.MaximumPoolSize = 10; // shared hosting usually caps connections per user
        _connectionString = b.ConnectionString;
        _realtime = realtime;
        _log = log;
    }

    public string ConnectionStringForTools => _connectionString;

    protected virtual async Task<MySqlConnection> OpenAsync()
    {
        var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await EnsureSessionAsync(conn);
        return conn;
    }

    protected async Task EnsureSessionAsync(MySqlConnection conn)
    {
        if (_initialised.ContainsKey(conn.ServerThread)) return;
        await using var cmd = new MySqlCommand(SessionInit, conn);
        await cmd.ExecuteNonQueryAsync();
        _initialised[conn.ServerThread] = true;
    }

    /// <summary>Read-only unit of work (no transaction).</summary>
    public virtual async Task<T> ReadAsync<T>(Func<Tx, Task<T>> work)
    {
        await using var conn = await OpenAsync();
        return await work(new Tx(conn, null));
    }

    /// <summary>Read-write unit of work: BEGIN … COMMIT, rollback on exception; realtime events are published after commit.</summary>
    public virtual async Task<T> TxAsync<T>(Func<Tx, Task<T>> work)
    {
        await using var conn = await OpenAsync();
        await using var trans = await conn.BeginTransactionAsync();
        var tx = new Tx(conn, trans);
        T result;
        try
        {
            result = await work(tx);
            await trans.CommitAsync();
        }
        catch
        {
            try { await trans.RollbackAsync(); } catch (Exception e) { _log.LogWarning(e, "Rollback failed"); }
            throw;
        }
        await PublishAsync(tx.Events);
        return result;
    }

    protected async Task PublishAsync(List<ChangeEvent> events)
    {
        if (events.Count == 0) return;
        try { await _realtime.PublishAsync(events); }
        catch (Exception e) { _log.LogWarning(e, "Realtime publish failed (data is already committed)"); }
    }

    /// <summary>Opens a raw connection for tooling (migrator, CLI). Caller disposes.</summary>
    public Task<MySqlConnection> OpenRawAsync() => OpenAsync();
}

/// <summary>Value formatting shared by reads (DB → JSON) and audit snapshots.</summary>
public static class Fmt
{
    public static DateTime TruncateMs(DateTime d) => new(d.Ticks - d.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

    public static string Iso(DateTime d) =>
        DateTime.SpecifyKind(d, d.Kind == DateTimeKind.Unspecified ? DateTimeKind.Utc : d.Kind).ToUniversalTime()
            .ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static string DateKey(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static object? ToJsonValue(ColType? type, object? raw)
    {
        switch (raw)
        {
            case null: return null;
            case DateTime dt: return type == ColType.Date ? DateKey(dt) : Iso(dt);
            case DateOnly d: return DateKey(d.ToDateTime(TimeOnly.MinValue));
            case Guid g: return g.ToString("D"); // MySqlConnector maps CHAR(36) to Guid by default
            case bool or int or long or decimal or double or string: break;
            case sbyte or byte or short or ushort or uint or ulong: raw = Convert.ToInt64(raw); break;
            case MySqlDecimal md: raw = md.Value; break;
            case byte[] bytes: raw = System.Text.Encoding.UTF8.GetString(bytes); break;
        }
        if (type == ColType.Bool) return raw switch { bool b => b, string s => s != "0", _ => Convert.ToInt64(raw) != 0 };
        if (type == ColType.Json && raw is string js && js.Length > 0)
        {
            try { return JsonDocument.Parse(js).RootElement.Clone(); } catch (JsonException) { return js; }
        }
        return raw;
    }
}
