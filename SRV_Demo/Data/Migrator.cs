using System.Reflection;
using System.Text.RegularExpressions;
using MySqlConnector;

namespace SRV_Demo.Data;

/// <summary>
/// Minimal forward-only migrator: embedded <c>Data/Migrations/NNN_name.sql</c> files are applied once, in name order,
/// and recorded in <c>schema_migrations</c>. Statements inside a file are separated by a line containing only "-- GO".
/// </summary>
public sealed class Migrator(Db db, ILogger<Migrator> log)
{
    private static readonly Regex Splitter = new(@"^\s*--\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);

    public async Task<IReadOnlyList<string>> MigrateAsync()
    {
        var applied = new List<string>();
        await using var conn = await db.OpenRawAsync();
        await Exec(conn, "CREATE TABLE IF NOT EXISTS `schema_migrations` (" +
                         "`version` VARCHAR(100) NOT NULL, `applied_at` DATETIME(3) NOT NULL, PRIMARY KEY (`version`)" +
                         ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        var done = new HashSet<string>();
        await using (var cmd = new MySqlCommand("SELECT `version` FROM `schema_migrations`", conn))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync()) done.Add(r.GetString(0));

        var asm = Assembly.GetExecutingAssembly();
        var resources = asm.GetManifestResourceNames()
            .Where(n => n.Contains(".Migrations.", StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            .OrderBy(n => n, StringComparer.Ordinal);

        foreach (var res in resources)
        {
            var version = Path.GetFileNameWithoutExtension(res[(res.LastIndexOf(".Migrations.", StringComparison.Ordinal) + ".Migrations.".Length)..]);
            if (done.Contains(version)) continue;

            log.LogInformation("Applying migration {Version}", version);
            using var stream = asm.GetManifestResourceStream(res)!;
            using var reader = new StreamReader(stream);
            foreach (var stmt in Splitter.Split(await reader.ReadToEndAsync()))
                if (HasSql(stmt)) await Exec(conn, stmt);

            await using var ins = new MySqlCommand(
                "INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (@v, UTC_TIMESTAMP(3))", conn);
            ins.Parameters.AddWithValue("@v", version);
            await ins.ExecuteNonQueryAsync();
            applied.Add(version);
        }
        return applied;
    }

    public async Task<IReadOnlyList<string>> AppliedAsync()
    {
        await using var conn = await db.OpenRawAsync();
        var list = new List<string>();
        try
        {
            await using var cmd = new MySqlCommand("SELECT `version` FROM `schema_migrations` ORDER BY `version`", conn);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) list.Add(r.GetString(0));
        }
        catch (MySqlException e) when (e.Number == 1146) { /* table missing: nothing applied yet */ }
        return list;
    }

    private static bool HasSql(string s) =>
        s.Split('\n').Any(l => { var t = l.Trim(); return t.Length > 0 && !t.StartsWith("--"); });

    private static async Task Exec(MySqlConnection conn, string sql)
    {
        await using var cmd = new MySqlCommand(sql, conn) { CommandTimeout = 120 };
        await cmd.ExecuteNonQueryAsync();
    }
}
