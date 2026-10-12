using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using SRV_Demo.Common;
using SRV_Demo.Data;
using SRV_Demo.Services;

namespace SRV_Demo.Api;

/// <summary>Calendar events, recurrence exceptions, weekly top-3 and reminders (notifications).</summary>
public sealed class CalendarController(Db db, NotificationService notifications) : ApiBase
{
    // ---- events ---------------------------------------------------------------------------------------------
    /// <summary>
    /// Window query used by useEvents(): single events overlapping [from,to), recurring series that started before
    /// <c>to</c> (the client expands the RRULE) and the exceptions whose occurrence falls inside the window.
    /// </summary>
    [HttpGet("events")]
    public async Task<IActionResult> Window([FromQuery] string from, [FromQuery] string to)
    {
        var f = TasksController.ParseUtc(from);
        var t = TasksController.ParseUtc(to);
        var args = new (string, object?)[] { ("@from", f), ("@to", t) };
        var single = db.ReadAsync(tx => tx.QueryAsync(
            $"{Tables.CalendarEvents.Select} WHERE `recurrence_rule` IS NULL AND `start_at` < @to AND `end_at` > @from ORDER BY `start_at`",
            Tables.CalendarEvents, args));
        var recurring = db.ReadAsync(tx => tx.QueryAsync(
            $"{Tables.CalendarEvents.Select} WHERE `recurrence_rule` IS NOT NULL AND `start_at` < @to ORDER BY `start_at`",
            Tables.CalendarEvents, args));
        var exceptions = db.ReadAsync(tx => tx.QueryAsync(
            $"{Tables.RecurrenceExceptions.Select} WHERE `occurrence_start_at` >= @from AND `occurrence_start_at` < @to",
            Tables.RecurrenceExceptions, args));
        await Task.WhenAll(single, recurring, exceptions);
        return Ok(new { single = single.Result, recurring = recurring.Result, exceptions = exceptions.Result });
    }

    [HttpGet("events/{id}")]
    public async Task<IActionResult> GetEvent(string id)
    {
        id = RequireUuid(id);
        var row = await db.ReadAsync(tx => Repo.GetAsync(tx, Tables.CalendarEvents, id));
        return row is null ? throw ApiException.NotFound() : Ok(row);
    }

    /// <summary>Body is one event object, or an array of events inserted atomically (schedule proposals).</summary>
    [HttpPost("events")]
    public async Task<IActionResult> CreateEvents([FromBody] JsonElement body)
    {
        var me = Me;
        if (body.ValueKind == JsonValueKind.Array)
        {
            if (body.GetArrayLength() > 200) throw ApiException.BadRequest("Tối đa 200 lịch mỗi lần.");
            return Ok(await db.TxAsync(async tx =>
            {
                var list = new List<Row>();
                foreach (var item in body.EnumerateArray()) list.Add(await Repo.InsertAsync(tx, Tables.CalendarEvents, item, me));
                return list;
            }));
        }
        return Ok(await db.TxAsync(tx => Repo.InsertAsync(tx, Tables.CalendarEvents, body, me)));
    }

    [HttpPatch("events/{id}")]
    public async Task<IActionResult> UpdateEvent(string id, [FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.UpdateAsync(tx, Tables.CalendarEvents, RequireUuid(id), body, Me)));

    /// <summary>Deleting a series also removes its exceptions (FK cascade); those deletions are audited too.</summary>
    [HttpDelete("events/{id}")]
    public async Task<IActionResult> DeleteEvent(string id)
    {
        id = RequireUuid(id);
        var me = Me;
        await db.TxAsync(async tx =>
        {
            var children = await tx.QueryAsync(
                $"{Tables.RecurrenceExceptions.Select} WHERE `parent_event_id` = @id", Tables.RecurrenceExceptions, ("@id", id));
            await Repo.DeleteAsync(tx, Tables.CalendarEvents, id, me);
            foreach (var c in children)
            {
                await Repo.AuditAsync(tx, Tables.RecurrenceExceptions, "DELETE", c, null, me);
                tx.Events.Add(new ChangeEvent("recurrence_exceptions", "DELETE", c));
            }
            return 0;
        });
        return NoContent();
    }

    [HttpPost("event-exceptions")]
    public async Task<IActionResult> CreateException([FromBody] JsonElement body) =>
        Ok(await db.TxAsync(tx => Repo.InsertAsync(tx, Tables.RecurrenceExceptions, body, Me)));

    // ---- weekly top 3 ---------------------------------------------------------------------------------------
    [HttpGet("weekly-priorities")]
    public async Task<IActionResult> Priorities([FromQuery(Name = "week_start")] string weekStart)
    {
        var week = Repo.Coerce(Tables.WeeklyPriorities.Get("week_start"), JsonSerializer.SerializeToElement(weekStart)) as string
                   ?? throw ApiException.BadRequest("week_start không hợp lệ.");
        return Ok(await db.ReadAsync(tx => ListWeek(tx, week)));
    }

    /// <summary>
    /// Sets (or clears, when <c>task_id</c> is null) rank 1..3 of a week atomically. A task can hold only one rank per
    /// week, so it is removed from its previous rank first. Returns the week's list.
    /// </summary>
    [HttpPut("weekly-priorities/{weekStart}/{rank:int}")]
    public async Task<IActionResult> SetPriority(string weekStart, int rank, [FromBody] JsonElement body)
    {
        if (rank is < 1 or > 3) throw ApiException.BadRequest("Thứ tự phải từ 1 đến 3.");
        var week = Repo.Coerce(Tables.WeeklyPriorities.Get("week_start"), JsonSerializer.SerializeToElement(weekStart)) as string
                   ?? throw ApiException.BadRequest("week_start không hợp lệ.");
        string? taskId = null;
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("task_id", out var t) && t.ValueKind == JsonValueKind.String)
            taskId = RequireUuid(t.GetString());
        var me = Me;

        return Ok(await db.TxAsync(async tx =>
        {
            var existing = (await tx.QueryAsync(
                $"{Tables.WeeklyPriorities.Select} WHERE `week_start` = @w AND `rank` = @r FOR UPDATE",
                Tables.WeeklyPriorities, ("@w", week), ("@r", rank))).FirstOrDefault();

            if (taskId is not null)
            {
                var dup = (await tx.QueryAsync(
                    $"{Tables.WeeklyPriorities.Select} WHERE `week_start` = @w AND `task_id` = @t AND `rank` <> @r FOR UPDATE",
                    Tables.WeeklyPriorities, ("@w", week), ("@t", taskId), ("@r", rank))).FirstOrDefault();
                if (dup is not null) await Repo.DeleteAsync(tx, Tables.WeeklyPriorities, (string)dup["id"]!, me);
            }

            if (taskId is null)
            {
                if (existing is not null) await Repo.DeleteAsync(tx, Tables.WeeklyPriorities, (string)existing["id"]!, me);
            }
            else if (existing is not null)
            {
                var patch = JsonSerializer.SerializeToElement(new Dictionary<string, string> { ["task_id"] = taskId });
                await Repo.UpdateAsync(tx, Tables.WeeklyPriorities, (string)existing["id"]!, patch, me,
                    requireVersion: false, forced: new Row { ["chosen_by"] = me });
            }
            else
            {
                if (await Repo.GetAsync(tx, Tables.Tasks, taskId) is null) throw ApiException.NotFound("Không tìm thấy công việc.");
                await Repo.InsertAsync(tx, Tables.WeeklyPriorities, default, me,
                    new Row { ["week_start"] = week, ["task_id"] = taskId, ["rank"] = rank });
            }
            return await ListWeek(tx, week);
        }));
    }

    private static Task<List<Row>> ListWeek(Tx tx, string week) =>
        tx.QueryAsync($"{Tables.WeeklyPriorities.Select} WHERE `week_start` = @w ORDER BY `rank`", Tables.WeeklyPriorities, ("@w", week));

    // ---- reminders ------------------------------------------------------------------------------------------
    [HttpGet("notifications")]
    public async Task<IActionResult> MyNotifications() => Ok(await db.ReadAsync(tx => Mine(tx, Me)));

    /// <summary>Recomputes reminders for everyone, then returns the caller's open reminders.</summary>
    [HttpPost("notifications/refresh")]
    public async Task<IActionResult> Refresh()
    {
        var created = await notifications.RefreshAsync();
        var me = Me;
        return Ok(new { created, notifications = await db.ReadAsync(tx => Mine(tx, me)) });
    }

    /// <summary>"Seen" only dims a reminder; it stays until its condition clears (see NotificationService).</summary>
    [HttpPost("notifications/read")]
    public async Task<IActionResult> MarkRead([FromBody] JsonElement body)
    {
        var me = Me;
        var ids = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("ids", out var arr) && arr.ValueKind == JsonValueKind.Array
            ? arr.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).Where(Repo.IsUuid).Distinct().Take(500).ToArray()
            : [];
        if (ids.Length == 0) return NoContent();
        await db.TxAsync(async tx =>
        {
            var inList = string.Join(",", ids.Select((_, i) => "@i" + i));
            var args = ids.Select((id, i) => ("@i" + i, (object?)id.ToLowerInvariant())).Concat([("@me", (object?)me), ("@now", tx.Now)]).ToArray();
            await tx.ExecAsync(
                $"UPDATE `notifications` SET `read_at` = @now WHERE `target_profile_id` = @me AND `read_at` IS NULL AND `id` IN ({inList})", args);
            return 0;
        });
        return NoContent();
    }

    private static Task<List<Row>> Mine(Tx tx, string me) => tx.QueryAsync(
        $"{Tables.Notifications.Select} WHERE `target_profile_id` = @me AND `resolved_at` IS NULL ORDER BY `scheduled_at` LIMIT 1000",
        Tables.Notifications, ("@me", me));
}
