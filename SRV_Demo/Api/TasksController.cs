using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using SRV_Demo.Common;
using SRV_Demo.Data;

namespace SRV_Demo.Api;

/// <summary>Tasks, the follow-up log (task_updates) and task links. Tasks are never deleted — use status 'cancelled'.</summary>
public sealed class TasksController(Db db) : ApiBase
{
    [HttpGet("tasks/{id}")]
    public async Task<IActionResult> Get(string id)
    {
        id = RequireUuid(id);
        var row = await db.ReadAsync(tx => Repo.GetAsync(tx, Tables.Tasks, id));
        return row is null ? throw ApiException.NotFound() : Ok(row);
    }

    [HttpPost("tasks")]
    public async Task<IActionResult> Create([FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.InsertAsync(tx, Tables.Tasks, body, Me)));

    /// <summary>Body: the fields to change plus <c>version</c> (the version the client last saw).</summary>
    [HttpPatch("tasks/{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.UpdateAsync(tx, Tables.Tasks, RequireUuid(id), body, Me)));

    // ---- follow-up log --------------------------------------------------------------------------------------
    [HttpGet("tasks/{id}/updates")]
    public async Task<IActionResult> ListUpdates(string id)
    {
        id = RequireUuid(id);
        return Ok(await db.ReadAsync(tx => tx.QueryAsync(
            $"{Tables.TaskUpdates.Select} WHERE `task_id` = @id ORDER BY `created_at` DESC, `id`", Tables.TaskUpdates, ("@id", id))));
    }

    /// <summary>
    /// Adds a reminder/follow-up note. If it carries <c>next_follow_up_at</c> the task's follow-up date is moved too
    /// (was trigger tg_task_updates_after).
    /// </summary>
    [HttpPost("tasks/{id}/updates")]
    public async Task<IActionResult> AddUpdate(string id, [FromBody] JsonElement body)
    {
        id = RequireUuid(id);
        var me = Me;
        return Ok(await db.TxAsync(async tx =>
        {
            if (await Repo.GetAsync(tx, Tables.Tasks, id) is null) throw ApiException.NotFound("Không tìm thấy công việc.");
            var row = await Repo.InsertAsync(tx, Tables.TaskUpdates, body, me, new Row { ["task_id"] = id });
            if (row["next_follow_up_at"] is string next)
            {
                var patch = JsonSerializer.SerializeToElement(new Dictionary<string, string> { ["next_follow_up_at"] = next });
                await Repo.UpdateAsync(tx, Tables.Tasks, id, patch, me, requireVersion: false);
            }
            return row;
        }));
    }

    /// <summary>
    /// Bulk read used by the "delegated" board (<c>task_ids=a,b,c</c>) and the weekly report (<c>from</c>/<c>to</c>, ISO UTC).
    /// </summary>
    [HttpGet("task-updates")]
    public async Task<IActionResult> Query([FromQuery(Name = "task_ids")] string? taskIds, [FromQuery] string? from,
        [FromQuery] string? to, [FromQuery] int limit = 1000)
    {
        limit = Math.Clamp(limit, 1, 5000);
        var where = new List<string>();
        var args = new List<(string, object?)>();
        if (!string.IsNullOrWhiteSpace(taskIds))
        {
            var ids = taskIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToArray();
            if (ids.Length > 500 || ids.Any(i => !Repo.IsUuid(i))) throw ApiException.BadRequest("Danh sách task_ids không hợp lệ.");
            where.Add($"`task_id` IN ({string.Join(",", ids.Select((_, i) => "@t" + i))})");
            args.AddRange(ids.Select((v, i) => ("@t" + i, (object?)v.ToLowerInvariant())));
        }
        if (!string.IsNullOrEmpty(from)) { where.Add("`created_at` >= @from"); args.Add(("@from", ParseUtc(from))); }
        if (!string.IsNullOrEmpty(to)) { where.Add("`created_at` < @to"); args.Add(("@to", ParseUtc(to))); }
        if (where.Count == 0) throw ApiException.BadRequest("Cần task_ids hoặc from/to.");

        var sql = $"{Tables.TaskUpdates.Select} WHERE {string.Join(" AND ", where)} ORDER BY `created_at` DESC LIMIT {limit}";
        return Ok(await db.ReadAsync(tx => tx.QueryAsync(sql, Tables.TaskUpdates, args.ToArray())));
    }

    // ---- links ----------------------------------------------------------------------------------------------
    [HttpGet("tasks/{id}/links")]
    public async Task<IActionResult> ListLinks(string id)
    {
        id = RequireUuid(id);
        return Ok(await db.ReadAsync(tx => tx.QueryAsync(
            $"{Tables.TaskLinks.Select} WHERE `task_id` = @id ORDER BY `created_at`, `id`", Tables.TaskLinks, ("@id", id))));
    }

    [HttpPost("tasks/{id}/links")]
    public async Task<IActionResult> AddLink(string id, [FromBody] JsonElement body)
    {
        id = RequireUuid(id);
        var me = Me;
        return Ok(await db.TxAsync(async tx =>
        {
            if (await Repo.GetAsync(tx, Tables.Tasks, id) is null) throw ApiException.NotFound("Không tìm thấy công việc.");
            return await Repo.InsertAsync(tx, Tables.TaskLinks, body, me, new Row { ["task_id"] = id });
        }));
    }

    [HttpDelete("links/{id}")]
    public async Task<IActionResult> DeleteLink(string id)
    {
        id = RequireUuid(id);
        var me = Me;
        await db.TxAsync(async tx => { await Repo.DeleteAsync(tx, Tables.TaskLinks, id, me); return 0; });
        return NoContent();
    }

    internal static DateTime ParseUtc(string iso)
    {
        if (!DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d))
            throw ApiException.BadRequest("Ngày giờ không hợp lệ: " + iso);
        return d.UtcDateTime;
    }
}
