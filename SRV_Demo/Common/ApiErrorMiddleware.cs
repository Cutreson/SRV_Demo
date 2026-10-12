using System.Text.Json;
using MySqlConnector;

namespace SRV_Demo.Common;

/// <summary>
/// Turns exceptions thrown below /api into JSON <c>{code,message}</c> responses and enforces a CSRF guard:
/// every non-GET API call must carry <c>X-Requested-With: sora</c> (a header a cross-site form cannot set).
/// </summary>
public sealed class ApiErrorMiddleware(RequestDelegate next, ILogger<ApiErrorMiddleware> log)
{
    public const string CsrfHeader = "X-Requested-With";
    public const string CsrfValue = "sora";

    public async Task InvokeAsync(HttpContext ctx)
    {
        var isApi = ctx.Request.Path.StartsWithSegments("/api");
        if (!isApi) { await next(ctx); return; }

        try
        {
            var safe = HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method) || HttpMethods.IsOptions(ctx.Request.Method);
            if (!safe && ctx.Request.Headers[CsrfHeader] != CsrfValue)
                throw ApiException.Forbidden("Thiếu tiêu đề bảo vệ CSRF.");
            await next(ctx);
        }
        catch (ApiException e)
        {
            await Write(ctx, e.Status, e.Code, e.Message);
        }
        catch (MySqlException e) when (Map(e) is { } mapped)
        {
            log.LogWarning(e, "DB constraint error {Number}", e.Number);
            await Write(ctx, mapped.Status, mapped.Code, mapped.Message);
        }
        catch (JsonException e)
        {
            await Write(ctx, 400, "bad_request", "Dữ liệu gửi lên không hợp lệ: " + e.Message);
        }
        catch (BadHttpRequestException e)
        {
            await Write(ctx, 400, "bad_request", e.Message);
        }
        catch (Exception e)
        {
            log.LogError(e, "Unhandled error on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
            await Write(ctx, 500, "server_error", "Lỗi máy chủ. Thử lại sau hoặc báo quản trị viên.");
        }
    }

    // MariaDB: 4025 = CHECK failed, 1062 = duplicate key, 1452 = FK parent missing, 1451 = FK child exists.
    // MySQL 8: 3819 = CHECK failed.
    private static ApiException? Map(MySqlException e)
    {
        var msg = e.Message;
        switch (e.Number)
        {
            case 4025 or 3819:
                if (msg.Contains("done_requires_result")) return ApiException.Validation("Cần ghi kết quả trước khi đánh dấu Hoàn thành.", "tasks_done_requires_result");
                if (msg.Contains("one_assignee")) return ApiException.Validation("Chỉ chọn một người thực hiện.", "tasks_one_assignee");
                if (msg.Contains("task_links_url")) return ApiException.Validation("Đường dẫn phải bắt đầu bằng http:// hoặc https://", "url_invalid");
                return ApiException.Validation("Dữ liệu không hợp lệ: " + msg);
            case 1062:
                return ApiException.Conflict("Bản ghi bị trùng (đã tồn tại).", "duplicate");
            case 1452:
                return ApiException.Validation("Bản ghi tham chiếu không tồn tại.", "bad_reference");
            case 1451:
                return ApiException.Conflict("Bản ghi đang được sử dụng nên không xóa được.", "in_use");
            default:
                return null;
        }
    }

    private static Task Write(HttpContext ctx, int status, string code, string message)
    {
        if (ctx.Response.HasStarted) return Task.CompletedTask;
        ctx.Response.Clear();
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(new { code, message });
    }
}
