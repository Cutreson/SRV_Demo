using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace SRV_Demo.Tests;

/// <summary>
/// Port of the Supabase-era SQL tests (tests/sql/10_rls_audit_test.sql, 20_notifications_test.sql) to the HTTP API:
/// equal access for both accounts, outsiders blocked, version conflicts, DONE needs a result, audit authorship, reminders.
/// </summary>
[Collection("api")]
public sealed class ApiTests(AppFixture app)
{
    private static string Iso(DateTime utc) => utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    // ---- access & auth ------------------------------------------------------------------------------------
    [Fact]
    public async Task Health_is_public_and_reports_database()
    {
        var r = await app.Anonymous().GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, r.Status);
        Assert.Equal("ok", r.Str("status"));
        Assert.Contains("001_init", r["migrations"].EnumerateArray().Select(x => x.GetString()));
    }

    [Fact]
    public async Task Anonymous_requests_are_rejected_and_me_is_204()
    {
        var anon = app.Anonymous();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/bootstrap")).Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync("/api/tasks", new { title = "x" })).Status);
        Assert.Equal(HttpStatusCode.NoContent, (await anon.GetAsync("/api/auth/me")).Status);
    }

    [Fact]
    public async Task Login_rejects_wrong_password_and_missing_csrf_header()
    {
        var u = await app.SignInAsync();
        var anon = app.Anonymous();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync("/api/auth/login", new { email = u.Email, password = "nope-nope" })).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await anon.PostAsync("/api/auth/login", new { email = u.Email, password = AppFixture.Password }, csrf: false)).Status);
    }

    [Fact]
    public async Task Both_accounts_share_the_same_data_and_deactivation_locks_out()
    {
        var director = await app.SignInAsync("director");
        var secretary = await app.SignInAsync("secretary");
        var task = await director.NewTaskAsync();

        var seen = await secretary.GetAsync($"/api/tasks/{task.Str("id")}");
        Assert.Equal(HttpStatusCode.OK, seen.Status);
        var edit = await secretary.PatchAsync($"/api/tasks/{task.Str("id")}", new { title = "Edited by secretary", version = task.Int("version") });
        Assert.Equal(HttpStatusCode.OK, edit.Status);
        Assert.Equal(secretary.Id, edit.Str("updated_by"));
        Assert.Equal(director.Id, edit.Str("created_by"));

        var auth = app.Factory.Services.GetRequiredService<SRV_Demo.Services.AuthService>();
        await auth.SetActiveAsync(secretary.Email, false);
        Assert.Equal(HttpStatusCode.Unauthorized, (await secretary.GetAsync("/api/bootstrap")).Status);
    }

    [Fact]
    public async Task Profile_rename_works_but_role_and_active_cannot_be_changed()
    {
        var u = await app.SignInAsync("secretary");
        var r = await u.PatchAsync("/api/me", new { display_name = "Tên mới", role = "director", active = false });
        Assert.Equal(HttpStatusCode.OK, r.Status);
        Assert.Equal("Tên mới", r.Str("display_name"));
        Assert.Equal("secretary", r.Str("role"));
        Assert.True(r["active"].GetBoolean());
    }

    [Fact]
    public async Task Password_change_requires_the_current_password()
    {
        var u = await app.SignInAsync();
        var bad = await u.PostAsync("/api/auth/password", new { current_password = "wrong-one", new_password = "Another-pass1" });
        Assert.Equal("wrong_password", bad.Code);
        var weak = await u.PostAsync("/api/auth/password", new { current_password = AppFixture.Password, new_password = "short" });
        Assert.Equal("weak_password", weak.Code);
        var ok = await u.PostAsync("/api/auth/password", new { current_password = AppFixture.Password, new_password = "Another-pass1" });
        Assert.Equal(HttpStatusCode.NoContent, ok.Status);
        var relog = await app.Anonymous().PostAsync("/api/auth/login", new { email = u.Email, password = "Another-pass1" });
        Assert.Equal(HttpStatusCode.OK, relog.Status);
    }

    // ---- tasks ----------------------------------------------------------------------------------------------
    [Fact]
    public async Task Update_bumps_version_and_stale_version_is_a_409_conflict()
    {
        var u = await app.SignInAsync();
        var t = await u.NewTaskAsync();
        Assert.Equal(1, t.Int("version"));

        var v2 = await u.PatchAsync($"/api/tasks/{t.Str("id")}", new { priority = "high", version = 1 });
        Assert.Equal(2, v2.Int("version"));
        Assert.Equal("high", v2.Str("priority"));

        var stale = await u.PatchAsync($"/api/tasks/{t.Str("id")}", new { priority = "low", version = 1 });
        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("version_conflict", stale.Code);

        var noVersion = await u.PatchAsync($"/api/tasks/{t.Str("id")}", new { priority = "low" });
        Assert.Equal(HttpStatusCode.BadRequest, noVersion.Status);
    }

    [Fact]
    public async Task No_op_update_does_not_bump_version_or_write_audit()
    {
        var u = await app.SignInAsync();
        var t = await u.NewTaskAsync(new { priority = "normal" });
        var same = await u.PatchAsync($"/api/tasks/{t.Str("id")}", new { priority = "normal", version = 1 });
        Assert.Equal(1, same.Int("version"));
        var audit = await u.GetAsync($"/api/audit?table=tasks&record_id={t.Str("id")}");
        Assert.Single(audit.Json.EnumerateArray());
    }

    [Fact]
    public async Task Done_requires_a_result_and_completed_at_follows_status()
    {
        var u = await app.SignInAsync();
        var t = await u.NewTaskAsync();
        var id = t.Str("id");

        var refused = await u.PatchAsync($"/api/tasks/{id}", new { status = "done", version = 1 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.Status);
        Assert.Equal("tasks_done_requires_result", refused.Code);
        var blank = await u.PatchAsync($"/api/tasks/{id}", new { status = "done", completion_result = "   ", version = 1 });
        Assert.Equal("tasks_done_requires_result", blank.Code);

        var done = await u.PatchAsync($"/api/tasks/{id}", new { status = "done", completion_result = "Đã chốt", version = 1 });
        Assert.Equal(HttpStatusCode.OK, done.Status);
        Assert.NotEqual(JsonValueKind.Null, done["completed_at"].ValueKind);

        var reopened = await u.PatchAsync($"/api/tasks/{id}", new { status = "doing", version = done.Int("version") });
        Assert.Equal(JsonValueKind.Null, reopened["completed_at"].ValueKind);
    }

    [Fact]
    public async Task Only_one_assignee_kind_and_enum_values_are_validated()
    {
        var u = await app.SignInAsync();
        var person = await u.CreateAsync("/api/people", new { full_name = "Người test" });
        var two = await u.PostAsync("/api/tasks", new { title = "x", assignee_profile_id = u.Id, assignee_person_id = person.Str("id") });
        Assert.Equal("tasks_one_assignee", two.Code);

        var badEnum = await u.PostAsync("/api/tasks", new { title = "x", status = "finished" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, badEnum.Status);
        var blankTitle = await u.PostAsync("/api/tasks", new { title = "   " });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, blankTitle.Status);
        var badEstimate = await u.PostAsync("/api/tasks", new { title = "x", estimated_minutes = 2 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, badEstimate.Status);
    }

    [Fact]
    public async Task Follow_up_note_moves_the_task_follow_up_date_and_is_audited_with_author()
    {
        var u = await app.SignInAsync();
        var t = await u.NewTaskAsync();
        var next = Iso(DateTime.UtcNow.AddDays(2));

        var note = await u.CreateAsync($"/api/tasks/{t.Str("id")}/updates", new { note = "Đã nhắc qua Zalo", channel = "zalo", next_follow_up_at = next });
        Assert.Equal(u.Id, note.Str("author_id"));

        var task = await u.GetAsync($"/api/tasks/{t.Str("id")}");
        Assert.Equal(next, task.Str("next_follow_up_at"));
        Assert.Equal(2, task.Int("version"));

        var list = await u.GetAsync($"/api/tasks/{t.Str("id")}/updates");
        Assert.Single(list.Json.EnumerateArray());

        var audit = await u.GetAsync($"/api/audit?table=tasks&record_id={t.Str("id")}");
        var actions = audit.Json.EnumerateArray().Select(a => a.GetProperty("action").GetString()).ToList();
        Assert.Equal(new[] { "UPDATE", "INSERT" }, actions);
        Assert.All(audit.Json.EnumerateArray(), a => Assert.Equal(u.Id, a.GetProperty("actor_id").GetString()));
    }

    [Fact]
    public async Task Links_must_be_http_and_can_be_deleted_audit_stays()
    {
        var u = await app.SignInAsync();
        var t = await u.NewTaskAsync();
        var bad = await u.PostAsync($"/api/tasks/{t.Str("id")}/links", new { url = "ftp://x/y" });
        Assert.Equal("url_invalid", bad.Code);

        var ok = await u.CreateAsync($"/api/tasks/{t.Str("id")}/links", new { url = "https://example.com/doc", label = "Tài liệu" });
        Assert.Equal(HttpStatusCode.NoContent, (await u.DeleteAsync($"/api/links/{ok.Str("id")}")).Status);
        Assert.Empty((await u.GetAsync($"/api/tasks/{t.Str("id")}/links")).Json.EnumerateArray());

        var audit = await u.GetAsync($"/api/audit?table=task_links&record_id={ok.Str("id")}");
        Assert.Equal(2, audit.Json.GetArrayLength()); // INSERT + DELETE
    }

    [Fact]
    public async Task Tasks_cannot_be_deleted_through_the_api()
    {
        var u = await app.SignInAsync();
        var t = await u.NewTaskAsync();
        var r = await u.DeleteAsync($"/api/tasks/{t.Str("id")}");
        Assert.True(r.Status is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
        Assert.Equal(HttpStatusCode.OK, (await u.GetAsync($"/api/tasks/{t.Str("id")}")).Status);
    }

    // ---- calendar -------------------------------------------------------------------------------------------
    [Fact]
    public async Task Event_end_must_be_after_start_and_window_query_finds_it()
    {
        var u = await app.SignInAsync();
        var start = new DateTime(2031, 3, 3, 2, 0, 0, DateTimeKind.Utc);
        var bad = await u.PostAsync("/api/events", new { title = "Họp", start_at = Iso(start), end_at = Iso(start) });
        Assert.Equal("event_time_invalid", bad.Code);

        var ev = await u.CreateAsync("/api/events", new { title = "Họp giao ban", start_at = Iso(start), end_at = Iso(start.AddHours(1)), event_type = "fixed" });
        var win = await u.GetAsync($"/api/events?from={Iso(start.AddHours(-1))}&to={Iso(start.AddHours(2))}");
        Assert.Contains(ev.Str("id"), win["single"].EnumerateArray().Select(e => e.GetProperty("id").GetString()));

        var empty = await u.GetAsync($"/api/events?from={Iso(start.AddHours(1))}&to={Iso(start.AddHours(2))}"); // touches end only
        Assert.DoesNotContain(ev.Str("id"), empty["single"].EnumerateArray().Select(e => e.GetProperty("id").GetString()));
    }

    [Fact]
    public async Task Batch_insert_is_atomic()
    {
        var u = await app.SignInAsync();
        var s = new DateTime(2031, 4, 7, 3, 0, 0, DateTimeKind.Utc);
        var title = "Batch " + Guid.NewGuid().ToString("N")[..6];
        var rows = new object[]
        {
            new { title, start_at = Iso(s), end_at = Iso(s.AddHours(1)) },
            new { title, start_at = Iso(s.AddHours(2)), end_at = Iso(s.AddHours(1)) }, // invalid
        };
        var r = await u.PostAsync("/api/events", rows);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, r.Status);
        var win = await u.GetAsync($"/api/events?from={Iso(s.AddHours(-1))}&to={Iso(s.AddHours(5))}");
        Assert.DoesNotContain(title, win["single"].EnumerateArray().Select(e => e.GetProperty("title").GetString()));
    }

    [Fact]
    public async Task Deleting_a_series_removes_its_exceptions_and_audits_both()
    {
        var u = await app.SignInAsync();
        var s = new DateTime(2031, 5, 5, 2, 0, 0, DateTimeKind.Utc);
        var series = await u.CreateAsync("/api/events", new { title = "Lặp", start_at = Iso(s), end_at = Iso(s.AddHours(1)), recurrence_rule = "FREQ=WEEKLY;BYDAY=MO" });
        var exc = await u.CreateAsync("/api/event-exceptions", new { parent_event_id = series.Str("id"), occurrence_start_at = Iso(s.AddDays(7)), action = "skip" });

        var win = await u.GetAsync($"/api/events?from={Iso(s.AddDays(6))}&to={Iso(s.AddDays(9))}");
        Assert.Single(win["exceptions"].EnumerateArray());

        Assert.Equal(HttpStatusCode.NoContent, (await u.DeleteAsync($"/api/events/{series.Str("id")}")).Status);
        var after = await u.GetAsync($"/api/events?from={Iso(s.AddDays(6))}&to={Iso(s.AddDays(9))}");
        Assert.Empty(after["exceptions"].EnumerateArray());

        var audit = await u.GetAsync($"/api/audit?table=recurrence_exceptions&record_id={exc.Str("id")}");
        Assert.Equal(new[] { "DELETE", "INSERT" }, audit.Json.EnumerateArray().Select(a => a.GetProperty("action").GetString()));
    }

    // ---- weekly top 3 ---------------------------------------------------------------------------------------
    [Fact]
    public async Task Weekly_priority_moves_a_task_between_ranks_and_can_be_cleared()
    {
        var u = await app.SignInAsync();
        var a = await u.NewTaskAsync();
        var b = await u.NewTaskAsync();
        const string week = "2099-01-05";

        var r1 = await u.PutAsync($"/api/weekly-priorities/{week}/1", new { task_id = a.Str("id") });
        Assert.Single(r1.Json.EnumerateArray());
        await u.PutAsync($"/api/weekly-priorities/{week}/2", new { task_id = b.Str("id") });

        // same task into rank 3 must vacate rank 1
        var r3 = await u.PutAsync($"/api/weekly-priorities/{week}/3", new { task_id = a.Str("id") });
        var ranks = r3.Json.EnumerateArray().ToDictionary(x => x.GetProperty("rank").GetInt32(), x => x.GetProperty("task_id").GetString());
        Assert.Equal(new Dictionary<int, string?> { [2] = b.Str("id"), [3] = a.Str("id") }, ranks);

        var cleared = await u.PutAsync($"/api/weekly-priorities/{week}/2", new { task_id = (string?)null });
        Assert.Single(cleared.Json.EnumerateArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await u.PutAsync($"/api/weekly-priorities/{week}/4", new { task_id = a.Str("id") })).Status);
    }

    // ---- reminders ------------------------------------------------------------------------------------------
    [Fact]
    public async Task Overdue_reminder_reaches_both_accounts_is_idempotent_and_resolves_when_done()
    {
        var director = await app.SignInAsync("director");
        var secretary = await app.SignInAsync("secretary");
        var t = await director.NewTaskAsync(new { due_at = Iso(DateTime.UtcNow.AddDays(-1)) });

        var r1 = await director.PostAsync("/api/notifications/refresh");
        Assert.True(r1["created"].GetInt32() >= 2);
        bool Has(Reply r, string kind) => r["notifications"].EnumerateArray().Any(n =>
            n.GetProperty("entity_id").GetString() == t.Str("id") && n.GetProperty("kind").GetString() == kind);
        Assert.True(Has(r1, "overdue"));
        Assert.False(Has(r1, "missing_next_action")); // created just now: the "missing next action" reminder waits one day

        var r2 = await secretary.PostAsync("/api/notifications/refresh");
        Assert.Equal(0, r2["created"].GetInt32());          // dedupe_key makes the second run a no-op
        Assert.True(Has(r2, "overdue"));                     // …but the secretary sees it too

        var done = await director.PatchAsync($"/api/tasks/{t.Str("id")}", new { status = "done", completion_result = "xong", version = 1 });
        Assert.Equal(HttpStatusCode.OK, done.Status);
        var r3 = await director.PostAsync("/api/notifications/refresh");
        Assert.False(Has(r3, "overdue"));                    // resolved, not deleted
    }

    [Fact]
    public async Task Mark_read_only_touches_my_own_reminders()
    {
        var director = await app.SignInAsync("director");
        var secretary = await app.SignInAsync("secretary");
        await director.NewTaskAsync(new { due_at = Iso(DateTime.UtcNow.AddHours(-3)) });
        var mine = (await director.PostAsync("/api/notifications/refresh"))["notifications"].EnumerateArray().First();
        var id = mine.GetProperty("id").GetString()!;

        Assert.Equal(HttpStatusCode.NoContent, (await secretary.PostAsync("/api/notifications/read", new { ids = new[] { id } })).Status);
        var stillUnread = (await director.GetAsync("/api/notifications")).Json.EnumerateArray().First(n => n.GetProperty("id").GetString() == id);
        Assert.Equal(JsonValueKind.Null, stillUnread.GetProperty("read_at").ValueKind);

        await director.PostAsync("/api/notifications/read", new { ids = new[] { id } });
        var read = (await director.GetAsync("/api/notifications")).Json.EnumerateArray().First(n => n.GetProperty("id").GetString() == id);
        Assert.NotEqual(JsonValueKind.Null, read.GetProperty("read_at").ValueKind);
    }

    // ---- settings / bootstrap -------------------------------------------------------------------------------
    [Fact]
    public async Task Settings_are_validated_and_unknown_keys_rejected()
    {
        var u = await app.SignInAsync();
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await u.PutAsync("/api/settings/buffer_percent", new { value = 99 })).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await u.PutAsync("/api/settings/not_a_setting", new { value = 1 })).Status);
        var ok = await u.PutAsync("/api/settings/buffer_percent", new { value = 30 });
        Assert.Equal(HttpStatusCode.OK, ok.Status);
        var all = await u.GetAsync("/api/settings");
        var buffer = all.Json.EnumerateArray().First(x => x.GetProperty("key").GetString() == "buffer_percent");
        Assert.Equal(30, buffer.GetProperty("value").GetInt32());
    }

    [Fact]
    public async Task Bootstrap_returns_reference_data_and_profiles_without_secrets()
    {
        var u = await app.SignInAsync();
        var b = await u.GetAsync("/api/bootstrap");
        Assert.Equal(6, b["categories"].GetArrayLength());
        Assert.DoesNotContain("password", b.Json.GetRawText());
        Assert.DoesNotContain("email", b["profiles"].GetRawText());
    }
}
