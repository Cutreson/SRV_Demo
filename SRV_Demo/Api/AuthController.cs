using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SRV_Demo.Common;
using SRV_Demo.Data;
using SRV_Demo.Services;

namespace SRV_Demo.Api;

/// <summary>Base for authenticated API controllers: every route needs an active account.</summary>
[ApiController, Authorize, Route("api")]
public abstract class ApiBase : ControllerBase
{
    /// <summary>Claim carrying <c>profiles.session_version</c>; a password reset bumps it and thereby revokes old cookies.</summary>
    public const string SessionVersionClaim = "sv";

    protected string Me => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw ApiException.Unauthorized();

    protected static string RequireUuid(string? id)
    {
        if (!Repo.IsUuid(id)) throw ApiException.NotFound();
        return id!.ToLowerInvariant();
    }

    protected static Row PublicProfile(Row p) => new()
    {
        ["id"] = p["id"], ["display_name"] = p["display_name"], ["role"] = p["role"], ["active"] = p["active"],
    };
}

[ApiController, Route("api/auth")]
public sealed class AuthController(AuthService auth, LoginThrottle throttle, Db db) : ControllerBase
{
    public sealed record LoginRequest(string? Email, string? Password);
    public sealed record PasswordRequest(string? CurrentPassword, string? NewPassword);

    [HttpPost("login"), AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var key = AuthService.NormalizeEmail(req.Email) + "|" + HttpContext.Connection.RemoteIpAddress;
        throttle.EnsureAllowed(key);
        var profile = await auth.LoginAsync(req.Email ?? "", req.Password ?? "");
        if (profile is null)
        {
            throttle.Failed(key);
            throw ApiException.Unauthorized("Sai email hoặc mật khẩu.");
        }
        throttle.Succeeded(key);

        await SignInAsync((string)profile["id"]!, (string)profile["display_name"]!, (string)profile["role"]!,
            Convert.ToInt32(profile["session_version"]));
        return Ok(new Row
        {
            ["id"] = profile["id"], ["display_name"] = profile["display_name"], ["role"] = profile["role"], ["active"] = true,
        });
    }

    [HttpPost("logout"), AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    /// <summary>
    /// Current account, or 204 when signed out (a 204 instead of 401 keeps the browser console clean on the login screen).
    /// The React app calls this once at start-up.
    /// </summary>
    [HttpGet("me"), AllowAnonymous]
    public async Task<IActionResult> Me()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null) return NoContent();
        var p = await db.ReadAsync(tx => Repo.GetAsync(tx, Tables.Profiles, id));
        if (p is null || p["active"] is not true) return NoContent();
        return Ok(new Row { ["id"] = p["id"], ["display_name"] = p["display_name"], ["role"] = p["role"], ["active"] = true });
    }

    /// <summary>Changes the caller's own password; other sessions of this account are signed out, this one stays signed in.</summary>
    [HttpPost("password"), Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] PasswordRequest req)
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var version = await auth.ChangePasswordAsync(id, req.CurrentPassword ?? "", req.NewPassword ?? "");
        await SignInAsync(id, User.FindFirstValue(ClaimTypes.Name) ?? "", User.FindFirstValue(ClaimTypes.Role) ?? "", version);
        return NoContent();
    }

    private Task SignInAsync(string id, string name, string role, int sessionVersion)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, id),
            new(ClaimTypes.Name, name),
            new(ClaimTypes.Role, role),
            new(ApiBase.SessionVersionClaim, sessionVersion.ToString()),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
        return HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal,
            new AuthenticationProperties { IsPersistent = true });
    }
}
