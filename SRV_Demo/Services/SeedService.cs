using System.Globalization;
using System.Text.Json;
using SRV_Demo.Data;

namespace SRV_Demo.Services;

/// <summary>First-run account bootstrap and the optional illustrative data (port of supabase/seed.sql + purge_demo.sql).</summary>
public sealed class SeedService(Db db, AuthService auth, IConfiguration cfg, ILogger<SeedService> log)
{
    public const string DemoPrefix = "[MINH HỌA]";

    /// <summary>
    /// Creates the two accounts from <c>Seed:Users</c> when the profiles table is empty.
    /// Passwords come from configuration only and are never logged.
    /// </summary>
    public async Task<int> EnsureUsersAsync()
    {
        if (await auth.CountProfilesAsync() > 0) return 0;
        var created = 0;
        foreach (var u in cfg.GetSection("Seed:Users").GetChildren())
        {
            var email = u["Email"]; var pw = u["Password"];
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(pw)) continue;
            await auth.CreateUserAsync(email, u["DisplayName"] ?? email, u["Role"] ?? "secretary", pw);
            created++;
            log.LogInformation("Seeded account {Email} ({Role})", email, u["Role"]);
        }
        if (created == 0)
            log.LogWarning("No accounts exist and Seed:Users is empty. Create one with: dotnet run -- cli create-user --email … --name … --role director --password …");
        return created;
    }

    /// <summary>
    /// Makes sure the default administrator exists (<c>Seed:Admin</c>: Email default admin@soragroup.vn, DisplayName, Password).
    /// Only creates a missing account — it never resets the password of an existing one, so changing the password in the app
    /// sticks. Without <c>Seed:Admin:Password</c> nothing happens (no password is hard-coded in the source).
    /// </summary>
    public async Task<bool> EnsureDefaultAdminAsync()
    {
        var section = cfg.GetSection("Seed:Admin");
        var email = section["Email"];
        if (string.IsNullOrWhiteSpace(email)) email = DefaultAdminEmail;
        var password = section["Password"];
        if (string.IsNullOrWhiteSpace(password)) return false;
        if (await auth.EmailExistsAsync(email)) return false;

        await auth.CreateUserAsync(email, section["DisplayName"] ?? "Quản trị viên", AuthService.Admin, password);
        log.LogInformation("Created default administrator account {Email}", email);
        return true;
    }

    public const string DefaultAdminEmail = "admin@soragroup.vn";

    // ---- demo data ------------------------------------------------------------------------------------------
    private static JsonElement J(Dictionary<string, object?> d) => JsonSerializer.SerializeToElement(d);

    public async Task<bool> SeedDemoAsync()
    {
        return await db.TxAsync(async tx =>
        {
            var existing = Convert.ToInt32(await tx.ScalarAsync("SELECT COUNT(*) FROM `tasks` WHERE `source` = 'demo'"));
            if (existing > 0) return false;

            // 00:00 today in Vietnam (UTC+7) expressed in UTC
            var vnNow = tx.Now.AddHours(7);
            var d0 = DateTime.SpecifyKind(vnNow.Date.AddHours(-7), DateTimeKind.Utc);
            var monday = d0.AddDays(-(((int)vnNow.DayOfWeek + 6) % 7));
            DateTime At(double days, double hours = 0) => d0.AddDays(days).AddHours(hours);
            string Day(double days) => vnNow.Date.AddDays(days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            string T(string s) => $"{DemoPrefix} {s}";

            async Task<string> Person(string name, string dept, string pos, string contact) =>
                (string)(await Repo.InsertAsync(tx, Tables.People, J(new()
                    { ["full_name"] = T(name), ["department"] = dept, ["position"] = pos, ["contact_note"] = contact }), null))["id"]!;
            async Task<string> Goal(string title, string desc, string cat, string period, int days, int progress) =>
                (string)(await Repo.InsertAsync(tx, Tables.Goals, J(new()
                {
                    ["title"] = T(title), ["description"] = desc, ["category_code"] = cat, ["period_type"] = period,
                    ["start_date"] = Day(0), ["due_date"] = Day(days), ["progress"] = progress, ["source"] = "demo",
                }), null))["id"]!;

            var pKt = await Person("Trưởng phòng Kỹ thuật", "Kỹ thuật", "Trưởng phòng", "Zalo");
            var pKd = await Person("Trưởng phòng Kinh doanh", "Kinh doanh", "Trưởng phòng", "Zalo / điện thoại");
            var pQl = await Person("PM dự án Setup", "Dự án", "PM", "Zalo");
            var pNs = await Person("Phụ trách Nhân sự", "HCNS", "Trưởng bộ phận", "Email");

            var gKpi = await Goal("Ban hành bộ KPI cấp phòng", "Đầu ra: bộ KPI 5 phòng được duyệt và áp dụng tháng tới", "E", "quarter", 75, 20);
            var gDay = await Goal("Phương án dây chuyền dây tự động", "Đầu ra: concept + kế hoạch đầu tư được duyệt", "F", "quarter", 80, 10);
            var gTt = await Goal("Mở 2 khách hàng mới khu vực phía Bắc", "Đầu ra: 2 PO đầu tiên", "F", "month", 28, 0);

            async Task Task_(string title, string? cat, string type, string priority, string status, bool decision, DateTime? due,
                DateTime? follow, int? minutes, string? next, string? expected, string? person, string? goal, string? result = null) =>
                await Repo.InsertAsync(tx, Tables.Tasks, J(new()
                {
                    ["title"] = T(title), ["category_code"] = cat, ["task_type"] = type, ["priority"] = priority, ["status"] = status,
                    ["needs_decision"] = decision, ["due_at"] = due, ["next_follow_up_at"] = follow, ["estimated_minutes"] = minutes,
                    ["next_action"] = next, ["expected_result"] = expected, ["assignee_person_id"] = person, ["goal_id"] = goal,
                    ["source"] = "demo", ["completion_result"] = result,
                }), null);

            await Task_("Họp giao ban phòng ban đầu tuần", "A", "self", "normal", "todo", false, At(0, 10), null, 60, "Chuẩn bị danh sách tồn tuần trước", "Chốt 5 việc ưu tiên tuần", null, null);
            await Task_("Duyệt báo cáo tuần các phòng", "A", "self", "normal", "todo", false, At(2, 16), null, 45, "Đọc báo cáo 5 phòng", "Phản hồi từng phòng", null, null);
            await Task_("Xử lý chậm tiến độ dự án Setup", "B", "delegated", "urgent", "doing", false, At(-1, 17), At(0, 9), null, "Gọi PM xác nhận phương án bù tiến độ", "Kế hoạch bù tiến độ có mốc", pQl, null);
            await Task_("Quyết định phương án xử lý lỗi chất lượng", "B", "self", "high", "todo", true, At(1, 15), null, 60, "Xem báo cáo 8D", "Quyết định phương án và người chịu trách nhiệm", null, null);
            await Task_("Báo cáo nguyên nhân dừng máy", "B", "delegated", "high", "waiting", false, At(3, 17), At(1, 9), null, "Chờ báo cáo từ kỹ thuật", "Báo cáo nguyên nhân gốc + biện pháp", pKt, null);
            await Task_("Đánh giá năng lực trưởng phòng Kỹ thuật", "C", "self", "normal", "todo", false, At(6, 17), null, 90, "Lấy dữ liệu KPI quý", "Biên bản đánh giá", null, null);
            await Task_("Đề xuất bổ sung nhân sự lắp ráp", "C", "delegated", "normal", "todo", true, At(5, 17), At(2, 9), null, "HCNS gửi đề xuất định biên", "Đề xuất số lượng + chi phí", pNs, null);
            await Task_("Gặp khách hàng mới tại Bắc Ninh", "D", "self", "high", "todo", false, At(2, 14), null, 120, "Chuẩn bị hồ sơ năng lực", "Nắm nhu cầu và hẹn khảo sát", null, gTt);
            await Task_("Theo dõi báo giá gửi khách hàng", "D", "delegated", "high", "doing", false, At(4, 17), At(-1, 9), null, "Nhắc trưởng phòng KD gọi khách", "Phản hồi của khách về giá", pKd, gTt);
            await Task_("Danh sách khách hàng tiềm năng phía Bắc", "D", "delegated", "normal", "todo", false, At(9, 17), At(3, 9), null, "Lọc từ danh sách triển lãm", "Danh sách 20 khách có người liên hệ", pKd, gTt);
            await Task_("Viết khung KPI phòng Kinh doanh", "E", "self", "high", "todo", false, At(6, 17), null, 180, "Liệt kê chỉ tiêu hiện có", "Bản nháp KPI phòng KD", null, gKpi);
            await Task_("Quy trình SRV – rà soát bước duyệt", "E", "self", "normal", "todo", false, At(12, 17), null, 120, "Vẽ lưu đồ hiện tại", "Lưu đồ quy trình mới", null, gKpi);
            await Task_("Concept dây chuyền dây tự động", "F", "self", "high", "todo", false, At(13, 17), null, 240, "Tổng hợp yêu cầu khách hàng", "Concept 2 phương án", null, gDay);
            await Task_("Khảo sát công nghệ ép đầu cos", "F", "delegated", "normal", "todo", false, At(10, 17), At(4, 9), null, "Kỹ thuật liên hệ 3 nhà cung cấp", "Bảng so sánh công nghệ", pKt, gDay);
            await Task_("Ký hợp đồng khung nhà cung cấp", "D", "self", "normal", "todo", true, null, null, 30, null, null, null, null);
            await Task_("Ghi nhanh: gọi lại anh A về lịch khảo sát", null, "self", "normal", "todo", false, null, At(1, 10), null, null, null, null, null);
            await Task_("Chốt lịch đào tạo an toàn", "C", "delegated", "low", "done", false, At(-2, 17), null, null, null, "Lịch đào tạo đã gửi toàn công ty", pNs, null, "Đã chốt và gửi thông báo");
            await Task_("Lập kế hoạch tuần tới", "A", "self", "normal", "todo", false, At(5, 15), null, 60, "Xem báo cáo tuần", "Top 3 – 5 kết quả tuần tới", null, null);

            async Task Event_(string title, DateTime start, DateTime end, string type, string? cat, bool locked, string? rrule) =>
                await Repo.InsertAsync(tx, Tables.CalendarEvents, J(new()
                {
                    ["title"] = T(title), ["start_at"] = start, ["end_at"] = end, ["event_type"] = type, ["category_code"] = cat,
                    ["locked"] = locked, ["recurrence_rule"] = rrule, ["source"] = "demo",
                }), null);

            await Event_("Giao ban đầu tuần (lặp thứ 2)", monday.AddHours(9), monday.AddHours(10.5), "fixed", "A", true, "FREQ=WEEKLY;BYDAY=MO");
            await Event_("Rà soát lịch & Top 3", At(0, 8), At(0, 8.25), "fixed", "A", false, null);
            await Event_("Deep work: khung KPI phòng KD", At(1, 9), At(1, 10.5), "focus", "E", false, null);
            await Event_("Làm việc với trưởng phòng Kỹ thuật", At(0, 13.5), At(0, 14.5), "flexible", "C", false, null);
            await Event_("Dự phòng / phát sinh", At(0, 14.5), At(0, 16.75), "buffer", null, false, null);
            return true;
        });
    }

    /// <summary>Removes everything created by <see cref="SeedDemoAsync"/> (audit rows are kept).</summary>
    public async Task<int> PurgeDemoAsync()
    {
        return await db.TxAsync(async tx =>
        {
            var removed = 0;
            async Task DeleteAll(TableDef t, string where, params (string, object?)[] args)
            {
                var rows = await tx.QueryAsync($"SELECT `id` FROM `{t.Name}` WHERE {where}", null, args);
                foreach (var r in rows) { await Repo.DeleteAsync(tx, t, (string)r["id"]!, null); removed++; }
            }

            const string demoTasks = "(SELECT `id` FROM `tasks` WHERE `source` = 'demo')";
            await DeleteAll(Tables.WeeklyPriorities, $"`task_id` IN {demoTasks}");
            await DeleteAll(Tables.TaskUpdates, $"`task_id` IN {demoTasks}");
            await DeleteAll(Tables.TaskLinks, $"`task_id` IN {demoTasks}");
            await DeleteAll(Tables.CalendarEvents, $"`source` = 'demo' OR `task_id` IN {demoTasks}");
            await DeleteAll(Tables.Tasks, "`source` = 'demo'");
            await DeleteAll(Tables.Goals, "`source` = 'demo'");
            await DeleteAll(Tables.People,
                "`full_name` LIKE @p AND NOT EXISTS (SELECT 1 FROM `tasks` t WHERE t.`assignee_person_id` = `people`.`id`)", ("@p", DemoPrefix + "%"));
            return removed;
        });
    }
}
