using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using SRV_Demo;
using SRV_Demo.Common;
using SRV_Demo.Data;
using SRV_Demo.Services;

var builder = WebApplication.CreateBuilder(args);

// Untracked, machine-local overrides (real connection string, first-run passwords). Never committed or published.
// Precedence: appsettings.json < appsettings.{Environment}.json < appsettings.Local.json < env vars < command line.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();
builder.Configuration.AddCommandLine(args);

// ---- services -------------------------------------------------------------------------------------------------
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddSingleton<IRealtime, SignalRRealtime>();
if (builder.Configuration.GetValue<bool>("Db:Sandbox"))
    builder.Services.AddSingleton<Db, SandboxDb>(); // never commits; see Data/SandboxDb.cs
else
    builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<Migrator>();
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddSingleton<NotificationService>();
builder.Services.AddSingleton<SeedService>();
builder.Services.AddHostedService<ReminderJob>();

builder.Services.AddControllers().AddJsonOptions(o =>
{
    // API contract = snake_case JSON, identical to the column names the React app already used with Supabase.
    o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.JsonSerializerOptions.DictionaryKeyPolicy = null; // row dictionaries keep their column names untouched
});

builder.Services.AddSignalR().AddJsonProtocol(o =>
{
    o.PayloadSerializerOptions.PropertyNamingPolicy = null;
    o.PayloadSerializerOptions.DictionaryKeyPolicy = null;
});

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "sora.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(7);
        o.SlidingExpiration = true;
        // The SPA expects plain status codes, not redirects to a login page.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
        // A deactivated account, or one whose password was reset (session_version bumped), loses access within ~30 s
        // even though its cookie is still valid. Cookies issued before session_version existed count as version 1.
        o.Events.OnValidatePrincipal = async ctx =>
        {
            var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var claimVersion = int.TryParse(ctx.Principal?.FindFirstValue(SRV_Demo.Api.ApiBase.SessionVersionClaim), out var v) ? v : 1;
            var auth = ctx.HttpContext.RequestServices.GetRequiredService<AuthService>();
            var session = id is null ? null : await auth.GetSessionAsync(id);
            if (session is null || !session.Active || session.Version != claimVersion)
            {
                ctx.RejectPrincipal();
                await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

// ---- admin CLI: dotnet run --project SRV_Demo -- cli <command> --------------------------------------------------
if (args.Length > 0 && args[0] == "cli")
    return await Cli.RunAsync(app.Services, args.Skip(1).ToArray());

// ---- startup: schema + first-run accounts ------------------------------------------------------------------------
if (app.Configuration.GetValue("Db:AutoMigrate", true))
{
    try
    {
        var applied = await app.Services.GetRequiredService<Migrator>().MigrateAsync();
        if (applied.Count > 0) app.Logger.LogInformation("Applied migrations: {Migrations}", string.Join(", ", applied));
        var seed = app.Services.GetRequiredService<SeedService>();
        await seed.EnsureUsersAsync();
        await seed.EnsureDefaultAdminAsync();
    }
    catch (Exception e)
    {
        // Keep the process alive so /api/health can report the problem instead of a crash loop.
        app.Logger.LogError(e, "Database initialisation failed");
    }
}

// ---- pipeline ----------------------------------------------------------------------------------------------------
if (!app.Environment.IsDevelopment())
{
    app.UseHsts(); // header is only emitted on HTTPS responses
    // Opt-in: some shared hosts terminate TLS elsewhere and have no HTTPS binding the app can see.
    if (app.Configuration.GetValue("Http:RedirectToHttps", false)) app.UseHttpsRedirection();
}

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "same-origin";
    await next();
});

app.UseMiddleware<ApiErrorMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Redirect("/app/")).ExcludeFromDescription();
app.MapControllers();
app.MapHub<WorkspaceHub>("/hubs/workspace");

app.Run();
return 0;

/// <summary>Exposed for WebApplicationFactory in SRV_Demo.Tests.</summary>
public partial class Program;
