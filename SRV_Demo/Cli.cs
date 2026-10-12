using SRV_Demo.Data;
using SRV_Demo.Services;

namespace SRV_Demo;

/// <summary>
/// Admin commands run against the configured database:  <c>dotnet run --project SRV_Demo -- cli &lt;command&gt; [--key value]</c>
/// Passwords can also be supplied through the SORA_PASSWORD environment variable to keep them out of shell history.
/// </summary>
public static class Cli
{
    public const string Help = """
        Commands:
          status                                         DB version, applied migrations, row counts
          migrate                                        apply pending schema migrations
          create-user --email E --name N --role admin|director|secretary --password P
          set-password --email E --password P            (also signs the account out everywhere)
          deactivate --email E        | activate --email E
          ensure-admin                                   create the default admin from Seed:Admin if it does not exist yet
          seed-demo                                      load illustrative data (all titles start with [MINH HỌA])
          purge-demo                                     remove the illustrative data again
        """;

    public static async Task<int> RunAsync(IServiceProvider sp, string[] args)
    {
        if (args.Length == 0 || args[0] is "help" or "--help") { Console.WriteLine(Help); return 0; }
        var o = Options(args.Skip(1).ToArray());
        string Req(string k) => o.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v)
            ? v : throw new ArgumentException($"Missing --{k}");
        string Password() => o.TryGetValue("password", out var v) && v.Length > 0
            ? v : Environment.GetEnvironmentVariable("SORA_PASSWORD") ?? throw new ArgumentException("Missing --password (or SORA_PASSWORD)");

        var auth = sp.GetRequiredService<AuthService>();
        var migrator = sp.GetRequiredService<Migrator>();
        var db = sp.GetRequiredService<Db>();
        try
        {
            // Same behaviour as app start-up: never run a command against an outdated schema.
            var pending = args[0] is not ("status" or "migrate") && sp.GetRequiredService<IConfiguration>().GetValue("Db:AutoMigrate", true)
                ? await migrator.MigrateAsync() : [];
            if (pending.Count > 0) Console.WriteLine("Applied migrations: " + string.Join(", ", pending));

            switch (args[0])
            {
                case "migrate":
                    var applied = await migrator.MigrateAsync();
                    Console.WriteLine(applied.Count == 0 ? "Schema is up to date." : "Applied: " + string.Join(", ", applied));
                    break;
                case "ensure-admin":
                    var made = await sp.GetRequiredService<SeedService>().EnsureDefaultAdminAsync();
                    Console.WriteLine(made ? "Default administrator created." : "Nothing to do (already exists, or Seed:Admin:Password is not set).");
                    break;
                case "status":
                    Console.WriteLine("Database: " + await db.ReadAsync(tx => tx.ScalarAsync("SELECT VERSION()")));
                    Console.WriteLine("Migrations: " + string.Join(", ", await migrator.AppliedAsync()));
                    foreach (var t in new[] { "profiles", "people", "goals", "tasks", "task_updates", "task_links", "calendar_events",
                                              "recurrence_exceptions", "weekly_priorities", "notifications", "audit_logs", "settings" })
                    {
                        var n = await db.ReadAsync(tx => tx.ScalarAsync($"SELECT COUNT(*) FROM `{t}`"));
                        Console.WriteLine($"  {t,-22} {n}");
                    }
                    break;
                case "create-user":
                    var u = await auth.CreateUserAsync(Req("email"), Req("name"), Req("role"), Password());
                    Console.WriteLine($"Created {u["role"]} {u["email"]} ({u["id"]})");
                    break;
                case "set-password":
                    var rows = await db.ReadAsync(tx => tx.QueryAsync(
                        "SELECT `id` FROM `profiles` WHERE `email` = @e", null, ("@e", AuthService.NormalizeEmail(Req("email")))));
                    var id = rows.FirstOrDefault()?["id"] as string ?? throw new ArgumentException("No such account");
                    await auth.SetPasswordAsync(id, Password(), actorId: null);
                    Console.WriteLine("Password updated.");
                    break;
                case "deactivate" or "activate":
                    await auth.SetActiveAsync(Req("email"), args[0] == "activate");
                    Console.WriteLine(args[0] == "activate" ? "Account activated." : "Account deactivated.");
                    break;
                case "seed-demo":
                    var seeded = await sp.GetRequiredService<SeedService>().SeedDemoAsync();
                    Console.WriteLine(seeded ? "Demo data loaded." : "Demo data already present — nothing to do.");
                    break;
                case "purge-demo":
                    var removed = await sp.GetRequiredService<SeedService>().PurgeDemoAsync();
                    Console.WriteLine($"Removed {removed} demo rows.");
                    break;
                default:
                    Console.Error.WriteLine("Unknown command: " + args[0]);
                    Console.Error.WriteLine(Help);
                    return 2;
            }
            return 0;
        }
        catch (Exception e) when (e is ArgumentException or Common.ApiException)
        {
            Console.Error.WriteLine("Error: " + e.Message);
            return 1;
        }
    }

    private static Dictionary<string, string> Options(string[] a)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < a.Length; i++)
            if (a[i].StartsWith("--")) d[a[i][2..]] = i + 1 < a.Length && !a[i + 1].StartsWith("--") ? a[++i] : "";
        return d;
    }
}
