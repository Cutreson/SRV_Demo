using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SRV_Demo.Data;
using SRV_Demo.Services;

namespace SRV_Demo.Tests;

/// <summary>Account administration: who may create accounts / set passwords, and what a password reset does.</summary>
[Collection("api")]
public sealed class UsersTests(AppFixture app)
{
    private static string NewEmail() => $"user-{Guid.NewGuid():N}@example.test";
    private static string Iso(DateTime utc) => utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    private async Task<ApiClient> LoginAsync(string email, string password)
    {
        var c = app.Anonymous();
        var r = await c.PostAsync("/api/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.OK, r.Status);
        return c;
    }

    [Fact]
    public async Task Admin_creates_accounts_and_sets_passwords_and_the_new_user_can_log_in()
    {
        var admin = await app.SignInAsync("admin");
        var email = NewEmail();

        var created = await admin.PostAsync("/api/users", new { email = email.ToUpperInvariant(), display_name = "Nhân viên mới", role = "secretary", password = "First-pass1" });
        Assert.Equal(HttpStatusCode.OK, created.Status);
        Assert.Equal(email, created.Str("email"));            // emails are normalised to lower case
        Assert.False(created.Json.TryGetProperty("password_hash", out _));

        var user = await LoginAsync(email, "First-pass1");
        Assert.Equal(HttpStatusCode.OK, (await user.GetAsync("/api/bootstrap")).Status);

        var reset = await admin.PutAsync($"/api/users/{created.Str("id")}/password", new { new_password = "Second-pass2" });
        Assert.Equal(HttpStatusCode.NoContent, reset.Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Anonymous().PostAsync("/api/auth/login", new { email, password = "First-pass1" })).Status);
        Assert.Equal(HttpStatusCode.OK, (await app.Anonymous().PostAsync("/api/auth/login", new { email, password = "Second-pass2" })).Status);
    }

    [Fact]
    public async Task Director_manages_director_and_secretary_accounts_but_never_admin_accounts()
    {
        var director = await app.SignInAsync("director");
        var admin = await app.SignInAsync("admin");

        var okSecretary = await director.PostAsync("/api/users", new { email = NewEmail(), display_name = "TK", role = "secretary", password = "Passw0rd-1" });
        Assert.Equal(HttpStatusCode.OK, okSecretary.Status);
        var okDirector = await director.PostAsync("/api/users", new { email = NewEmail(), display_name = "GD", role = "director", password = "Passw0rd-1" });
        Assert.Equal(HttpStatusCode.OK, okDirector.Status);

        var noAdmin = await director.PostAsync("/api/users", new { email = NewEmail(), display_name = "AD", role = "admin", password = "Passw0rd-1" });
        Assert.Equal(HttpStatusCode.Forbidden, noAdmin.Status);

        var takeOver = await director.PutAsync($"/api/users/{admin.Id}/password", new { new_password = "Hijacked-1" });
        Assert.Equal(HttpStatusCode.Forbidden, takeOver.Status);

        var ownerReset = await director.PutAsync($"/api/users/{okSecretary.Str("id")}/password", new { new_password = "Changed-pass-1" });
        Assert.Equal(HttpStatusCode.NoContent, ownerReset.Status);
    }

    [Fact]
    public async Task Secretary_cannot_list_create_or_reset()
    {
        var secretary = await app.SignInAsync("secretary");
        var other = await app.SignInAsync("director");
        Assert.Equal(HttpStatusCode.Forbidden, (await secretary.GetAsync("/api/users")).Status);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await secretary.PostAsync("/api/users", new { email = NewEmail(), display_name = "x", role = "secretary", password = "Passw0rd-1" })).Status);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await secretary.PutAsync($"/api/users/{other.Id}/password", new { new_password = "Passw0rd-1" })).Status);
    }

    [Fact]
    public async Task List_is_available_to_admin_and_director_and_never_exposes_secrets()
    {
        var director = await app.SignInAsync("director");
        var r = await director.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.OK, r.Status);
        Assert.Contains(director.Email, r.Json.EnumerateArray().Select(u => u.GetProperty("email").GetString()));
        Assert.DoesNotContain("password", r.Json.GetRawText());
        Assert.DoesNotContain("session_version", r.Json.GetRawText());
    }

    [Fact]
    public async Task Validation_duplicate_email_weak_password_and_bad_role()
    {
        var admin = await app.SignInAsync("admin");
        var email = NewEmail();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/users", new { email, display_name = "A", role = "secretary", password = "Passw0rd-1" })).Status);

        var dup = await admin.PostAsync("/api/users", new { email, display_name = "B", role = "secretary", password = "Passw0rd-1" });
        Assert.Equal(HttpStatusCode.Conflict, dup.Status);
        Assert.Equal("duplicate", dup.Code);

        var weak = await admin.PostAsync("/api/users", new { email = NewEmail(), display_name = "C", role = "secretary", password = "short" });
        Assert.Equal("weak_password", weak.Code);
        var badRole = await admin.PostAsync("/api/users", new { email = NewEmail(), display_name = "D", role = "superuser", password = "Passw0rd-1" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, badRole.Status);
        var badEmail = await admin.PostAsync("/api/users", new { email = "not-an-email", display_name = "E", role = "secretary", password = "Passw0rd-1" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, badEmail.Status);
    }

    [Fact]
    public async Task Resetting_a_password_signs_the_account_out_everywhere()
    {
        var admin = await app.SignInAsync("admin");
        var victim = await app.SignInAsync("secretary");
        Assert.Equal(HttpStatusCode.OK, (await victim.GetAsync("/api/bootstrap")).Status);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsync($"/api/users/{victim.Id}/password", new { new_password = "Brand-new-1" })).Status);

        Assert.Equal(HttpStatusCode.Unauthorized, (await victim.GetAsync("/api/bootstrap")).Status);
        Assert.Equal(HttpStatusCode.NoContent, (await victim.GetAsync("/api/auth/me")).Status);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/bootstrap")).Status);   // the actor is unaffected
    }

    [Fact]
    public async Task Changing_my_own_password_keeps_this_session_but_revokes_other_sessions()
    {
        var first = await app.SignInAsync("director");
        var second = await LoginAsync(first.Email, AppFixture.Password);   // a second browser
        Assert.Equal(HttpStatusCode.OK, (await second.GetAsync("/api/bootstrap")).Status);

        var change = await first.PostAsync("/api/auth/password", new { current_password = AppFixture.Password, new_password = "Own-new-pass1" });
        Assert.Equal(HttpStatusCode.NoContent, change.Status);

        Assert.Equal(HttpStatusCode.OK, (await first.GetAsync("/api/bootstrap")).Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await second.GetAsync("/api/bootstrap")).Status);
    }

    [Fact]
    public async Task Own_password_must_go_through_the_change_password_flow()
    {
        var admin = await app.SignInAsync("admin");
        var r = await admin.PutAsync($"/api/users/{admin.Id}/password", new { new_password = "Another-pass1" });
        Assert.Equal(HttpStatusCode.BadRequest, r.Status);
        Assert.Equal("use_change_password", r.Code);
    }

    [Fact]
    public async Task Audit_records_who_created_an_account_and_that_a_password_changed_without_the_secret()
    {
        var admin = await app.SignInAsync("admin");
        var created = await admin.CreateAsync("/api/users", new { email = NewEmail(), display_name = "Có audit", role = "secretary", password = "Super-secret-1" });
        await admin.PutAsync($"/api/users/{created.Str("id")}/password", new { new_password = "Super-secret-2" });

        var audit = await admin.GetAsync("/api/audit?table=profiles&limit=50");
        var mine = audit.Json.EnumerateArray()
            .Where(a => a.GetProperty("after_data").ValueKind == JsonValueKind.Object &&
                        a.GetProperty("after_data").GetProperty("id").GetString() == created.Str("id")).ToList();

        Assert.Equal(2, mine.Count);
        Assert.All(mine, a => Assert.Equal(admin.Id, a.GetProperty("actor_id").GetString()));
        var changed = mine.First(a => a.GetProperty("action").GetString() == "UPDATE");
        Assert.True(changed.GetProperty("after_data").GetProperty("password_changed").GetBoolean());
        Assert.DoesNotContain("Super-secret", audit.Json.GetRawText());
        Assert.DoesNotContain("password_hash", audit.Json.GetRawText());
    }

    [Fact]
    public async Task Admin_gets_no_reminders_and_is_not_offered_as_a_participant_data_source()
    {
        var director = await app.SignInAsync("director");
        var admin = await app.SignInAsync("admin");
        var task = await director.NewTaskAsync(new { due_at = Iso(DateTime.UtcNow.AddDays(-2)) });

        var forDirector = await director.PostAsync("/api/notifications/refresh");
        Assert.Contains(task.Str("id"), forDirector["notifications"].EnumerateArray().Select(n => n.GetProperty("entity_id").GetString()));

        var forAdmin = await admin.PostAsync("/api/notifications/refresh");
        Assert.Empty(forAdmin["notifications"].EnumerateArray());

        // the admin can still open the workspace data and sees the account in the profile list (names in audit rows)
        var boot = await admin.GetAsync("/api/bootstrap");
        Assert.Equal(HttpStatusCode.OK, boot.Status);
        Assert.Contains("admin", boot["profiles"].EnumerateArray().Select(p => p.GetProperty("role").GetString()));
    }

    [Fact]
    public async Task Default_admin_is_created_once_and_an_existing_password_is_never_overwritten()
    {
        var email = NewEmail();
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Seed:Admin:Email"] = email,
            ["Seed:Admin:Password"] = "Default-pass-1",
            ["Seed:Admin:DisplayName"] = "Quản trị mặc định",
        }).Build();
        var sp = app.Factory.Services;
        var seed = new SeedService(sp.GetRequiredService<Db>(), sp.GetRequiredService<AuthService>(), cfg, NullLogger<SeedService>.Instance);

        Assert.True(await seed.EnsureDefaultAdminAsync());
        Assert.False(await seed.EnsureDefaultAdminAsync());     // second start-up: nothing to do

        var admin = await LoginAsync(email, "Default-pass-1");
        var changed = await admin.PostAsync("/api/auth/password", new { current_password = "Default-pass-1", new_password = "Chosen-by-admin-1" });
        Assert.Equal(HttpStatusCode.NoContent, changed.Status);
        Assert.False(await seed.EnsureDefaultAdminAsync());     // still no reset to the default
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Anonymous().PostAsync("/api/auth/login", new { email, password = "Default-pass-1" })).Status);
        Assert.Equal(HttpStatusCode.OK, (await app.Anonymous().PostAsync("/api/auth/login", new { email, password = "Chosen-by-admin-1" })).Status);
    }
}
