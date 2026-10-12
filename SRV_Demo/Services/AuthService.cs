using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using SRV_Demo.Common;
using SRV_Demo.Data;

namespace SRV_Demo.Services;

/// <summary>Cached view of an account used to validate a cookie on every request.</summary>
public sealed record SessionInfo(bool Active, int Version, string Role);

/// <summary>
/// Replaces Supabase Auth + the <c>profiles</c> membership check.
/// Roles: <c>admin</c> (system administrator), <c>director</c> and <c>secretary</c> (the two equal workspace users).
/// </summary>
public sealed class AuthService(Db db, IMemoryCache cache)
{
    public const int MinPasswordLength = 8;
    public const string Admin = "admin", Director = "director", Secretary = "secretary";
    public static readonly string[] Roles = [Admin, Director, Secretary];

    private static readonly PasswordHasher<object> Hasher = new();
    private static readonly object HashSubject = new();
    private static readonly string DummyHash = Hasher.HashPassword(HashSubject, Guid.NewGuid().ToString("N"));

    public static string NormalizeEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();

    // ---- who may manage whom ------------------------------------------------------------------------------------
    /// <summary>Admin and director manage accounts. Only an admin may create or touch an admin account.</summary>
    public static bool CanManageAccounts(string actorRole) => actorRole is Admin or Director;

    public static bool CanManage(string actorRole, string targetRole) =>
        actorRole == Admin || (actorRole == Director && targetRole != Admin);

    // ---- login ----------------------------------------------------------------------------------------------------
    /// <summary>Returns id, display_name, role, active, session_version or null when email/password do not match.</summary>
    public async Task<Row?> LoginAsync(string email, string password)
    {
        email = NormalizeEmail(email);
        var rows = await db.ReadAsync(tx => tx.QueryAsync(
            "SELECT `id`, `password_hash`, `display_name`, `role`, `active`, `session_version` FROM `profiles` WHERE `email` = @e",
            null, ("@e", email)));
        var row = rows.FirstOrDefault();
        var verdict = Hasher.VerifyHashedPassword(HashSubject, row?["password_hash"] as string ?? DummyHash, password);
        if (row is null || verdict == PasswordVerificationResult.Failed) return null;
        if (!Convert.ToBoolean(row["active"])) throw ApiException.Forbidden("Tài khoản đã bị khóa. Liên hệ quản trị viên.");

        await db.TxAsync(async tx =>
        {
            if (verdict == PasswordVerificationResult.SuccessRehashNeeded)
                await tx.ExecAsync("UPDATE `profiles` SET `password_hash` = @h WHERE `id` = @id",
                    ("@h", Hasher.HashPassword(HashSubject, password)), ("@id", row["id"]));
            await tx.ExecAsync("UPDATE `profiles` SET `last_login_at` = @t WHERE `id` = @id", ("@t", tx.Now), ("@id", row["id"]));
            return 0;
        });
        row.Remove("password_hash");
        row["active"] = true;
        return row;
    }

    // ---- account administration -------------------------------------------------------------------------------------
    /// <summary>Creates an account. <paramref name="actorId"/> is the creator (null for seeding / CLI).</summary>
    public async Task<Row> CreateUserAsync(string email, string displayName, string role, string password, string? actorId = null)
    {
        email = NormalizeEmail(email);
        if (email.Length == 0 || !email.Contains('@') || email.Length > 190) throw ApiException.Validation("Email không hợp lệ.");
        if (!Roles.Contains(role)) throw ApiException.Validation("Vai trò phải là admin, director hoặc secretary.");
        if (string.IsNullOrWhiteSpace(displayName)) throw ApiException.Validation("Cần nhập tên hiển thị.");
        if (displayName.Trim().Length > 120) throw ApiException.Validation("Tên hiển thị tối đa 120 ký tự.");
        CheckPassword(password);
        return await db.TxAsync(async tx =>
        {
            var exists = await tx.ScalarAsync("SELECT 1 FROM `profiles` WHERE `email` = @e", ("@e", email));
            if (exists is not null) throw ApiException.Conflict("Email này đã có tài khoản.", "duplicate");

            var id = Guid.NewGuid().ToString("D");
            await tx.ExecAsync(
                "INSERT INTO `profiles` (`id`,`email`,`password_hash`,`display_name`,`role`,`active`,`session_version`,`created_at`,`updated_at`) " +
                "VALUES (@id,@e,@h,@n,@r,1,1,@t,@t)",
                ("@id", id), ("@e", email), ("@h", Hasher.HashPassword(HashSubject, password)),
                ("@n", displayName.Trim()), ("@r", role), ("@t", tx.Now));
            var saved = (await Repo.GetAsync(tx, Tables.Profiles, id))!;
            await Repo.AuditAsync(tx, Tables.Profiles, "INSERT", null, saved, actorId);
            tx.Events.Add(new ChangeEvent("profiles", "INSERT", PublicProfile(saved)));
            return saved;
        });
    }

    /// <summary>All accounts for the management screen (never includes password_hash).</summary>
    public Task<List<Row>> ListUsersAsync() => db.ReadAsync(tx => tx.QueryAsync(
        "SELECT `id`,`email`,`display_name`,`role`,`active`,`last_login_at`,`created_at` FROM `profiles` " +
        "ORDER BY FIELD(`role`,'admin','director','secretary'), `display_name`",
        Tables.Profiles));

    public async Task<Row?> GetProfileAsync(string id) =>
        await db.ReadAsync(tx => Repo.GetAsync(tx, Tables.Profiles, id));

    /// <summary>
    /// Sets another account's password (or the caller's own, see <see cref="ChangePasswordAsync"/>) and invalidates every cookie
    /// issued before. The audit row records the fact, never the password.
    /// </summary>
    public async Task<int> SetPasswordAsync(string profileId, string newPassword, string? actorId)
    {
        CheckPassword(newPassword);
        var version = await db.TxAsync(async tx =>
        {
            var before = await Repo.GetAsync(tx, Tables.Profiles, profileId, forUpdate: true) ?? throw ApiException.NotFound("Không tìm thấy tài khoản.");
            await tx.ExecAsync(
                "UPDATE `profiles` SET `password_hash` = @h, `session_version` = `session_version` + 1, `updated_at` = @t WHERE `id` = @id",
                ("@h", Hasher.HashPassword(HashSubject, newPassword)), ("@t", tx.Now), ("@id", profileId));
            var v = Convert.ToInt32(await tx.ScalarAsync("SELECT `session_version` FROM `profiles` WHERE `id` = @id", ("@id", profileId)));

            var after = new Row(before) { ["password_changed"] = true };
            await Repo.AuditAsync(tx, Tables.Profiles, "UPDATE", before, after, actorId);
            return v;
        });
        cache.Remove("member:" + profileId);
        return version;
    }

    /// <summary>Self-service change. Returns the new session version so the caller can re-issue its own cookie.</summary>
    public async Task<int> ChangePasswordAsync(string profileId, string current, string next)
    {
        CheckPassword(next);
        var rows = await db.ReadAsync(tx => tx.QueryAsync(
            "SELECT `password_hash` FROM `profiles` WHERE `id` = @id", null, ("@id", profileId)));
        var hash = rows.FirstOrDefault()?["password_hash"] as string ?? throw ApiException.NotFound("Không tìm thấy tài khoản.");
        if (Hasher.VerifyHashedPassword(HashSubject, hash, current) == PasswordVerificationResult.Failed)
            throw ApiException.Validation("Mật khẩu hiện tại không đúng.", "wrong_password");
        return await SetPasswordAsync(profileId, next, profileId);
    }

    public async Task SetActiveAsync(string email, bool active)
    {
        var id = await db.ReadAsync(tx => tx.ScalarAsync("SELECT `id` FROM `profiles` WHERE `email` = @e", ("@e", NormalizeEmail(email)))) as string
                 ?? throw ApiException.NotFound("Không tìm thấy tài khoản.");
        await db.TxAsync(tx => tx.ExecAsync(
            "UPDATE `profiles` SET `active` = @a, `updated_at` = @t WHERE `id` = @id", ("@a", active ? 1 : 0), ("@t", tx.Now), ("@id", id)));
        cache.Remove("member:" + id);
    }

    public async Task<int> CountProfilesAsync() =>
        Convert.ToInt32(await db.ReadAsync(tx => tx.ScalarAsync("SELECT COUNT(*) FROM `profiles`")));

    public async Task<bool> EmailExistsAsync(string email) =>
        await db.ReadAsync(tx => tx.ScalarAsync("SELECT 1 FROM `profiles` WHERE `email` = @e", ("@e", NormalizeEmail(email)))) is not null;

    // ---- per-request validation -----------------------------------------------------------------------------------
    /// <summary>
    /// Account state used to validate a cookie. Cached for 30 s, so deactivation or a password reset reaches every
    /// outstanding session within that time (and immediately on this instance, which clears the cache entry).
    /// </summary>
    public async Task<SessionInfo> GetSessionAsync(string profileId)
    {
        return (await cache.GetOrCreateAsync("member:" + profileId, async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
            var rows = await db.ReadAsync(tx => tx.QueryAsync(
                "SELECT `active`, `session_version`, `role` FROM `profiles` WHERE `id` = @id", null, ("@id", profileId)));
            var r = rows.FirstOrDefault();
            return r is null
                ? new SessionInfo(false, 0, "")
                : new SessionInfo(Convert.ToBoolean(r["active"]), Convert.ToInt32(r["session_version"]), (string)r["role"]!);
        }))!;
    }

    private static Row PublicProfile(Row p) => new()
    {
        ["id"] = p["id"], ["display_name"] = p["display_name"], ["role"] = p["role"], ["active"] = p["active"],
    };

    private static void CheckPassword(string? p)
    {
        if (p is null || p.Length < MinPasswordLength)
            throw ApiException.Validation($"Mật khẩu cần tối thiểu {MinPasswordLength} ký tự.", "weak_password");
        if (p.Length > 128) throw ApiException.Validation("Mật khẩu tối đa 128 ký tự.", "weak_password");
    }
}

/// <summary>In-memory brute-force guard: 5 failed logins for the same email+IP lock further attempts for 5 minutes.</summary>
public sealed class LoginThrottle
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan Lock = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, (int Fails, DateTime LockedUntil)> _state = new();

    public void EnsureAllowed(string key)
    {
        if (_state.TryGetValue(key, out var s) && s.LockedUntil > DateTime.UtcNow)
            throw ApiException.TooMany("Đăng nhập sai quá nhiều lần. Thử lại sau vài phút.");
    }

    public void Failed(string key) => _state.AddOrUpdate(key,
        _ => (1, DateTime.MinValue),
        (_, s) => s.Fails + 1 >= MaxFailures ? (0, DateTime.UtcNow + Lock) : (s.Fails + 1, s.LockedUntil));

    public void Succeeded(string key) => _state.TryRemove(key, out _);
}
