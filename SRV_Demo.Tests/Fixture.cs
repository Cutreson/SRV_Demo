using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SRV_Demo.Services;

namespace SRV_Demo.Tests;

/// <summary>
/// Boots the real application against the configured MariaDB/MySQL in SANDBOX mode: every write happens inside one
/// transaction that is rolled back when the host is disposed, so the tests leave no data behind.
/// Needs ConnectionStrings:Default (SRV_Demo/appsettings.Development.json or env ConnectionStrings__Default) and a migrated schema.
/// </summary>
public sealed class AppFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("Db:Sandbox", "true");
        builder.UseSetting("Db:AutoMigrate", "false");
        builder.UseSetting("Reminders:BackgroundRefresh", "false");
        builder.ConfigureLogging(l => l.SetMinimumLevel(LogLevel.Warning));
    }
}

public sealed class AppFixture : IAsyncLifetime
{
    public const string Password = "Test-passw0rd!";
    public AppFactory Factory { get; } = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await Factory.DisposeAsync();

    public async Task<ApiClient> SignInAsync(string role = "director")
    {
        var email = $"test-{Guid.NewGuid():N}@example.test";
        var auth = Factory.Services.GetRequiredService<AuthService>();
        var profile = await auth.CreateUserAsync(email, "Tester " + role, role, Password);
        var client = new ApiClient(Factory.CreateClient()) { Email = email, Id = (string)profile["id"]! };
        var login = await client.PostAsync("/api/auth/login", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.Status);
        return client;
    }

    public ApiClient Anonymous() => new(Factory.CreateClient());
}

[CollectionDefinition("api")]
public sealed class ApiCollection : ICollectionFixture<AppFixture>;

public sealed record Reply(HttpStatusCode Status, JsonElement Json)
{
    public string Code => Json.ValueKind == JsonValueKind.Object && Json.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";
    public string Message => Json.ValueKind == JsonValueKind.Object && Json.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
    public JsonElement this[string name] => Json.GetProperty(name);
    public string Str(string name) => Json.GetProperty(name).GetString()!;
    public int Int(string name) => Json.GetProperty(name).GetInt32();
}

public sealed class ApiClient(HttpClient http)
{
    public string Email { get; init; } = "";
    public string Id { get; init; } = "";

    private async Task<Reply> SendAsync(HttpMethod method, string url, object? body, bool csrf)
    {
        using var req = new HttpRequestMessage(method, url);
        if (csrf) req.Headers.Add("X-Requested-With", "sora");
        if (body is not null) req.Content = JsonContent.Create(body);
        using var res = await http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        var json = string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement.Clone();
        return new Reply(res.StatusCode, json);
    }

    public Task<Reply> GetAsync(string url) => SendAsync(HttpMethod.Get, url, null, true);
    public Task<Reply> PostAsync(string url, object? body = null, bool csrf = true) => SendAsync(HttpMethod.Post, url, body ?? new { }, csrf);
    public Task<Reply> PatchAsync(string url, object body) => SendAsync(HttpMethod.Patch, url, body, true);
    public Task<Reply> PutAsync(string url, object body) => SendAsync(HttpMethod.Put, url, body, true);
    public Task<Reply> DeleteAsync(string url) => SendAsync(HttpMethod.Delete, url, null, true);

    /// <summary>POST that must succeed; returns the created row.</summary>
    public async Task<Reply> CreateAsync(string url, object body)
    {
        var r = await PostAsync(url, body);
        Assert.True(r.Status == HttpStatusCode.OK, $"POST {url} → {(int)r.Status} {r.Code} {r.Message}");
        return r;
    }

    public Task<Reply> NewTaskAsync(object? extra = null)
    {
        var body = new Dictionary<string, object?> { ["title"] = "Test task " + Guid.NewGuid().ToString("N")[..6] };
        if (extra is not null)
            foreach (var p in extra.GetType().GetProperties()) body[p.Name] = p.GetValue(extra);
        return CreateAsync("/api/tasks", body);
    }
}
