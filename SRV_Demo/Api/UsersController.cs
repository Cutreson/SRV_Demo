using Microsoft.AspNetCore.Mvc;
using SRV_Demo.Common;
using SRV_Demo.Services;

namespace SRV_Demo.Api;

/// <summary>
/// Account administration. Allowed for <c>admin</c> and <c>director</c>:
///  * admin: create any role, set any account's password;
///  * director: create / set the password of director and secretary accounts, but never touch an admin account
///    (otherwise a director could take over the administrator).
/// The role is read from the database on every call, not from the cookie.
/// </summary>
public sealed class UsersController(AuthService auth) : ApiBase
{
    public sealed record CreateUserRequest(string? Email, string? DisplayName, string? Role, string? Password);
    public sealed record SetPasswordRequest(string? NewPassword);

    private async Task<string> ActorRoleAsync()
    {
        var actor = await auth.GetProfileAsync(Me);
        var role = actor?["role"] as string;
        if (actor is null || actor["active"] is not true || role is null || !AuthService.CanManageAccounts(role))
            throw ApiException.Forbidden("Chỉ Quản trị viên hoặc Giám đốc được quản lý tài khoản.");
        return role;
    }

    [HttpGet("users")]
    public async Task<IActionResult> List()
    {
        await ActorRoleAsync();
        return Ok(await auth.ListUsersAsync());
    }

    [HttpPost("users")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
    {
        var actorRole = await ActorRoleAsync();
        var role = (req.Role ?? "").Trim().ToLowerInvariant();
        if (!AuthService.Roles.Contains(role)) throw ApiException.Validation("Vai trò không hợp lệ.");
        if (!AuthService.CanManage(actorRole, role))
            throw ApiException.Forbidden("Chỉ Quản trị viên được tạo hoặc sửa tài khoản Quản trị viên.");

        var created = await auth.CreateUserAsync(req.Email ?? "", req.DisplayName ?? "", role, req.Password ?? "", Me);
        return Ok(new Row
        {
            ["id"] = created["id"], ["email"] = created["email"], ["display_name"] = created["display_name"],
            ["role"] = created["role"], ["active"] = created["active"],
        });
    }

    /// <summary>Sets a new password for any manageable account. The target's existing sessions are revoked.</summary>
    [HttpPut("users/{id}/password")]
    public async Task<IActionResult> SetPassword(string id, [FromBody] SetPasswordRequest req)
    {
        id = RequireUuid(id);
        var actorRole = await ActorRoleAsync();
        if (id == Me) throw ApiException.BadRequest("Dùng mục “Đổi mật khẩu” trong Cấu hình để đổi mật khẩu của chính mình.", "use_change_password");
        var target = await auth.GetProfileAsync(id) ?? throw ApiException.NotFound("Không tìm thấy tài khoản.");
        if (!AuthService.CanManage(actorRole, (string)target["role"]!))
            throw ApiException.Forbidden("Chỉ Quản trị viên được đặt mật khẩu cho tài khoản Quản trị viên.");

        await auth.SetPasswordAsync(id, req.NewPassword ?? "", Me);
        return NoContent();
    }
}
