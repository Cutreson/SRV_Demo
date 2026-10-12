using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SRV_Demo.Common;
using SRV_Demo.Data;
using SRV_Demo.Services;

namespace SRV_Demo.Api;

/// <summary>Reference data, people, goals, settings, audit log and the current account.</summary>
public sealed class WorkspaceController(Db db) : ApiBase
{
    // ---- initial load ---------------------------------------------------------------------------------------
    /// <summary>Everything the SPA keeps in memory (same sets and limits as the original DataProvider.reload()).</summary>
    [HttpGet("bootstrap")]
    public async Task<IActionResult> Bootstrap()
    {
        var me = Me;
        var profiles = db.ReadAsync(tx => tx.QueryAsync(
            "SELECT `id`,`display_name`,`role`,`active` FROM `profiles` ORDER BY `role`, `display_name`", Tables.Profiles));
        var people = db.ReadAsync(tx => tx.QueryAsync($"{Tables.People.Select} ORDER BY `full_name`", Tables.People));
        var categories = db.ReadAsync(tx => tx.QueryAsync($"{Tables.Categories.Select} ORDER BY `code`", Tables.Categories));
        var goals = db.ReadAsync(tx => tx.QueryAsync($"{Tables.Goals.Select} ORDER BY (`due_date` IS NULL), `due_date`", Tables.Goals));
        var tasks = db.ReadAsync(tx => tx.QueryAsync($"{Tables.Tasks.Select} ORDER BY (`due_at` IS NULL), `due_at` LIMIT 5000", Tables.Tasks));
        var notifications = db.ReadAsync(tx => tx.QueryAsync(
            $"{Tables.Notifications.Select} WHERE `target_profile_id` = @me AND `resolved_at` IS NULL ORDER BY `scheduled_at` LIMIT 1000",
            Tables.Notifications, ("@me", me)));
        await Task.WhenAll(profiles, people, categories, goals, tasks, notifications);
        return Ok(new
        {
            profiles = profiles.Result, people = people.Result, categories = categories.Result,
            goals = goals.Result, tasks = tasks.Result, notifications = notifications.Result,
        });
    }

    // ---- people ---------------------------------------------------------------------------------------------
    [HttpPost("people")]
    public async Task<IActionResult> CreatePerson([FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.InsertAsync(tx, Tables.People, body, Me)));

    [HttpPatch("people/{id}")]
    public async Task<IActionResult> UpdatePerson(string id, [FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.UpdateAsync(tx, Tables.People, RequireUuid(id), body, Me)));

    // ---- goals ----------------------------------------------------------------------------------------------
    [HttpPost("goals")]
    public async Task<IActionResult> CreateGoal([FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.InsertAsync(tx, Tables.Goals, body, Me)));

    [HttpPatch("goals/{id}")]
    public async Task<IActionResult> UpdateGoal(string id, [FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.UpdateAsync(tx, Tables.Goals, RequireUuid(id), body, Me)));

    // ---- settings -------------------------------------------------------------------------------------------
    private static readonly Dictionary<string, Func<JsonElement, bool>> SettingRules = new()
    {
        ["working_days"] = v => IsIntArray(v, 1, 7),
        ["working_hours"] = v => v.ValueKind == JsonValueKind.Array,
        ["due_soon_days"] = v => IsIntArray(v, 1, 90),
        ["buffer_percent"] = v => IsInt(v, 20, 35),
        ["max_block_minutes"] = v => IsInt(v, 15, 240),
        ["event_lead_minutes"] = v => IsInt(v, 1, 240),
        ["strategy_gap_days"] = v => IsInt(v, 1, 60),
        ["daily_template"] = v => v.ValueKind == JsonValueKind.Object,
    };

    private static bool IsInt(JsonElement v, int min, int max) =>
        v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) && n >= min && n <= max;

    private static bool IsIntArray(JsonElement v, int min, int max) =>
        v.ValueKind == JsonValueKind.Array && v.EnumerateArray().All(e => IsInt(e, min, max));

    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings() =>
        Ok(await db.ReadAsync(tx => tx.QueryAsync($"{Tables.Settings.Select} ORDER BY `key`", Tables.Settings)));

    [HttpPut("settings/{key}")]
    public async Task<IActionResult> PutSetting(string key, [FromBody] JsonElement body)
    {
        if (!SettingRules.TryGetValue(key, out var valid)) throw ApiException.NotFound("Không có cấu hình này.");
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("value", out var value) || !valid(value))
            throw ApiException.Validation("Giá trị cấu hình không hợp lệ.");
        return Ok(await db.TxAsync(async tx =>
        {
            var exists = await Repo.GetAsync(tx, Tables.Settings, key) is not null;
            return exists
                ? await Repo.UpdateAsync(tx, Tables.Settings, key, body, Me)
                : await Repo.InsertAsync(tx, Tables.Settings, body, Me, new Row { ["key"] = key });
        }));
    }

    // ---- audit log ------------------------------------------------------------------------------------------
    [HttpGet("audit")]
    public async Task<IActionResult> Audit([FromQuery] string? table, [FromQuery(Name = "record_id")] string? recordId,
        [FromQuery(Name = "actor_id")] string? actorId, [FromQuery(Name = "before_id")] long? beforeId, [FromQuery] int limit = 100)
    {
        limit = Math.Clamp(limit, 1, 200);
        var where = new List<string>();
        var args = new List<(string, object?)>();
        if (!string.IsNullOrEmpty(table)) { where.Add("`table_name` = @t"); args.Add(("@t", table)); }
        if (!string.IsNullOrEmpty(recordId)) { where.Add("`record_id` = @r"); args.Add(("@r", recordId)); }
        if (!string.IsNullOrEmpty(actorId)) { where.Add("`actor_id` = @a"); args.Add(("@a", actorId)); }
        if (beforeId is not null) { where.Add("`id` < @b"); args.Add(("@b", beforeId)); }
        var sql = Tables.AuditLogs.Select + (where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : "") +
                  $" ORDER BY `id` DESC LIMIT {limit}";
        return Ok(await db.ReadAsync(tx => tx.QueryAsync(sql, Tables.AuditLogs, args.ToArray())));
    }

    // ---- my account -----------------------------------------------------------------------------------------
    [HttpPatch("me")]
    public async Task<IActionResult> UpdateMe([FromBody] JsonElement body)
    {
        var me = Me;
        // only display_name is writable on profiles (role/active/email are not in the writable set)
        var saved = await db.TxAsync(tx => Repo.UpdateAsync(tx, Tables.Profiles, me, body, me, requireVersion: false));
        return Ok(PublicProfile(saved));
    }

    // ---- ops ------------------------------------------------------------------------------------------------
    [HttpGet("health"), AllowAnonymous]
    public async Task<IActionResult> Health([FromServices] Migrator migrator)
    {
        var version = await db.ReadAsync(tx => tx.ScalarAsync("SELECT VERSION()"));
        var migrations = await migrator.AppliedAsync();
        return Ok(new { status = "ok", database = version?.ToString(), migrations, utc = Fmt.Iso(DateTime.UtcNow) });
    }
}
