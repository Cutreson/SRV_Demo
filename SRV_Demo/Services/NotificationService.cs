using System.Globalization;
using System.Text.Json;
using SRV_Demo.Data;

namespace SRV_Demo.Services;

/// <summary>
/// Port of the PostgreSQL function <c>refresh_notifications()</c>: recompute every reminder that should exist,
/// insert missing ones (deduplicated by <c>dedupe_key</c>) and mark the ones that no longer apply as resolved.
/// Safe to call concurrently: the unique dedupe_key + INSERT IGNORE make it idempotent.
/// </summary>
public sealed class NotificationService(Db db)
{
    private static readonly TimeSpan Vietnam = TimeSpan.FromHours(7); // UTC+7, no DST

    private sealed record Want(string Kind, string EntityType, string EntityId, string Dedupe, DateTime At);

    public async Task<int> RefreshAsync()
    {
        return await db.TxAsync(async tx =>
        {
            var now = tx.Now;
            var lead = await SettingIntAsync(tx, "event_lead_minutes", 15);
            var gapDays = await SettingIntAsync(tx, "strategy_gap_days", 7);
            var vnNow = now + Vietnam;
            var monday = vnNow.Date.AddDays(-(((int)vnNow.DayOfWeek + 6) % 7));
            var week = monday.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            var wants = new Dictionary<string, Want>();
            void Add(string kind, string type, string id, DateTime at, DateTime? scheduled = null, string? key = null)
            {
                var dedupe = key ?? $"{kind}:{id}:{new DateTimeOffset(at, TimeSpan.Zero).ToUnixTimeSeconds()}";
                wants[dedupe] = new Want(kind, type, id, dedupe, scheduled ?? at);
            }

            // -- open tasks -----------------------------------------------------------------------------
            var tasks = await tx.QueryAsync(
                "SELECT `id`,`task_type`,`due_at`,`next_follow_up_at`,`needs_decision`,`assignee_profile_id`,`assignee_person_id`," +
                "`next_action`,`created_at` FROM `tasks` WHERE `status` IN ('todo','doing','waiting','paused')", Tables.Tasks);
            foreach (var t in tasks)
            {
                var id = (string)t["id"]!;
                var due = Dt(t["due_at"]);
                var follow = Dt(t["next_follow_up_at"]);
                var created = Dt(t["created_at"])!.Value;
                if (due is { } d)
                {
                    if (d < now) Add("overdue", "task", id, d);
                    else if (d < now.AddDays(1)) Add("due_soon_1", "task", id, d);
                    else if (d < now.AddDays(3)) Add("due_soon_3", "task", id, d);
                    else if (d < now.AddDays(7)) Add("due_soon_7", "task", id, d);
                }
                if (follow is { } f && f <= now) Add("follow_up_due", "task", id, f);
                if (t["needs_decision"] is true) Add("decision_needed", "task", id, created);
                if ((string?)t["task_type"] == "delegated" && t["assignee_person_id"] is null && t["assignee_profile_id"] is null)
                    Add("missing_owner", "task", id, created);
                if (string.IsNullOrWhiteSpace(t["next_action"] as string) && created < now.AddDays(-1))
                    Add("missing_next_action", "task", id, created);
            }

            // -- calendar events starting soon ----------------------------------------------------------
            var soon = await tx.QueryAsync(
                "SELECT `id`,`start_at` FROM `calendar_events` WHERE `status`='confirmed' AND `recurrence_rule` IS NULL " +
                "AND `start_at` > @now AND `start_at` <= @until", Tables.CalendarEvents,
                ("@now", now), ("@until", now.AddMinutes(lead)));
            foreach (var e in soon) Add("event_starting", "calendar_event", (string)e["id"]!, Dt(e["start_at"])!.Value);

            // -- E/F goals without a focus slot within ±gap days -----------------------------------------
            var goals = await tx.QueryAsync(
                "SELECT `id`,`category_code` FROM `goals` WHERE `status`='active' AND `category_code` IN ('E','F')", Tables.Goals);
            if (goals.Count > 0)
            {
                var evs = await tx.QueryAsync(
                    "SELECT e.`task_id` AS task_id, e.`category_code` AS event_cat, t.`goal_id` AS task_goal, t.`category_code` AS task_cat " +
                    "FROM `calendar_events` e LEFT JOIN `tasks` t ON t.`id` = e.`task_id` " +
                    "WHERE e.`status` IN ('confirmed','done') AND e.`event_type` IN ('focus','fixed','flexible') " +
                    "AND e.`start_at` >= @from AND e.`start_at` < @to", null,
                    ("@from", now.AddDays(-gapDays)), ("@to", now.AddDays(gapDays)));
                foreach (var g in goals)
                {
                    var gid = (string)g["id"]!;
                    var cat = (string?)g["category_code"];
                    var covered = evs.Any(e =>
                        (string?)e["task_goal"] == gid ||
                        (e["task_id"] is null && (string?)e["event_cat"] == cat) ||
                        (e["task_goal"] is null && (string?)e["task_cat"] == cat));
                    if (!covered) Add("strategy_gap", "goal", gid, now, now, $"strategy_gap:{gid}:{week}");
                }
            }

            // -- fan out to every active account ----------------------------------------------------------
            // The system administrator is not a participant in the executive workflow, so it gets no reminders.
            var profiles = (await tx.QueryAsync("SELECT `id` FROM `profiles` WHERE `active` = 1 AND `role` <> 'admin'", null))
                .Select(p => (string)p["id"]!).ToList();
            var fresh = new List<(string Id, string Profile, Want W)>();
            foreach (var p in profiles)
                foreach (var w in wants.Values)
                    fresh.Add((Guid.NewGuid().ToString("D"), p, w));

            var inserted = 0;
            foreach (var batch in fresh.Chunk(100))
            {
                var args = new List<(string, object?)>();
                var tuples = new List<string>();
                for (var i = 0; i < batch.Length; i++)
                {
                    var (id, profile, w) = batch[i];
                    tuples.Add($"(@i{i},@p{i},@k{i},@y{i},@e{i},@s{i},@d{i},@c)");
                    args.Add(($"@i{i}", id)); args.Add(($"@p{i}", profile)); args.Add(($"@k{i}", w.Kind));
                    args.Add(($"@y{i}", w.EntityType)); args.Add(($"@e{i}", w.EntityId)); args.Add(($"@s{i}", w.At));
                    args.Add(($"@d{i}", $"{w.Dedupe}:{profile}"));
                }
                args.Add(("@c", now));
                inserted += await tx.ExecAsync(
                    "INSERT IGNORE INTO `notifications` (`id`,`target_profile_id`,`kind`,`entity_type`,`entity_id`,`scheduled_at`,`dedupe_key`,`created_at`) " +
                    "VALUES " + string.Join(",", tuples), args.ToArray());
            }
            if (inserted > 0)
            {
                // Rows that really got inserted keep the ids generated above; publish them to their owners.
                foreach (var batch in fresh.Chunk(200))
                {
                    var ids = batch.Select(b => b.Id).ToArray();
                    var rows = await tx.QueryAsync(
                        $"{Tables.Notifications.Select} WHERE `id` IN ({string.Join(",", ids.Select((_, i) => "@i" + i))})",
                        Tables.Notifications, ids.Select((id, i) => ("@i" + i, (object?)id)).ToArray());
                    foreach (var r in rows) tx.Events.Add(new ChangeEvent("notifications", "INSERT", r, (string)r["target_profile_id"]!));
                }
            }

            // -- resolve reminders whose condition no longer holds ---------------------------------------------
            var open = await tx.QueryAsync(
                "SELECT `id`,`target_profile_id`,`dedupe_key` FROM `notifications` WHERE `resolved_at` IS NULL", null);
            var stale = open.Where(n =>
            {
                var key = (string)n["dedupe_key"]!;
                var suffix = ":" + (string)n["target_profile_id"]!;
                var baseKey = key.EndsWith(suffix, StringComparison.Ordinal) ? key[..^suffix.Length] : key;
                return !wants.ContainsKey(baseKey);
            }).Select(n => (string)n["id"]!).ToList();
            foreach (var batch in stale.Chunk(200))
            {
                var inList = string.Join(",", batch.Select((_, i) => "@i" + i));
                var args = batch.Select((id, i) => ("@i" + i, (object?)id)).Append(("@now", (object?)now)).ToArray();
                await tx.ExecAsync($"UPDATE `notifications` SET `resolved_at` = @now WHERE `resolved_at` IS NULL AND `id` IN ({inList})", args);
                var rows = await tx.QueryAsync($"{Tables.Notifications.Select} WHERE `id` IN ({inList})", Tables.Notifications, args.Take(batch.Length).ToArray());
                foreach (var r in rows) tx.Events.Add(new ChangeEvent("notifications", "UPDATE", r, (string)r["target_profile_id"]!));
            }
            return inserted;
        });
    }

    private static DateTime? Dt(object? iso) =>
        iso is string s ? DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime() : null;

    public static async Task<int> SettingIntAsync(Tx tx, string key, int fallback)
    {
        var rows = await tx.QueryAsync("SELECT `value` FROM `settings` WHERE `key` = @k", Tables.Settings, ("@k", key));
        if (rows.FirstOrDefault()?["value"] is JsonElement { ValueKind: JsonValueKind.Number } n && n.TryGetInt32(out var v)) return v;
        return fallback;
    }
}

