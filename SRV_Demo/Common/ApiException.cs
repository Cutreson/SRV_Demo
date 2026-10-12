global using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace SRV_Demo.Common;

/// <summary>
/// Error that is safe to show to the user. Serialised by <see cref="ApiErrorMiddleware"/> as
/// <c>{ "code": "...", "message": "..." }</c>; the React client maps <c>code</c> to <c>AppError.kind</c>.
/// </summary>
public sealed class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;

    public static ApiException Validation(string message, string code = "validation") => new(422, code, message);
    public static ApiException BadRequest(string message, string code = "bad_request") => new(400, code, message);
    public static ApiException NotFound(string message = "Không tìm thấy bản ghi.") => new(404, "not_found", message);
    public static ApiException Forbidden(string message = "Tài khoản không có quyền thực hiện thao tác này.") => new(403, "forbidden", message);
    public static ApiException Unauthorized(string message = "Chưa đăng nhập.") => new(401, "unauthorized", message);
    public static ApiException Conflict(string message, string code = "version_conflict") => new(409, code, message);
    public static ApiException TooMany(string message) => new(429, "too_many_requests", message);
}
