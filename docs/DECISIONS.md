# Quyết định kiến trúc (ADR rút gọn)

Định dạng: **Bối cảnh → Quyết định → Hệ quả**. Thêm mục mới ở cuối, đừng sửa lịch sử (đánh dấu *Thay thế bởi ADR-n* nếu đổi ý).

## ADR-1 — Giữ React SPA, chỉ thay lớp dữ liệu
- **Bối cảnh**: yêu cầu "chuyển sang MySQL và ASP.NET". UI gốc ~150 KB TSX, đã có unit test cho logic lịch/đề xuất/báo cáo.
- **Quyết định**: backend ASP.NET phục vụ REST + SignalR; React giữ nguyên, chỉ thay `supabase.ts`/`data.tsx` và ~14 điểm gọi dữ liệu.
- **Hệ quả**: rủi ro hồi quy UI thấp; build tách (Node → `wwwroot/app`). Muốn Razor thuần phải viết lại UI.

## ADR-2 — Không dùng trigger/stored procedure; luật ở tầng ứng dụng
- **Bối cảnh**: MariaDB hosting bật binary log (`10.11.15-MariaDB-log`), thường cấm tạo trigger/function khi không có SUPER.
- **Quyết định**: version, stamp, audit, completed_at, lan truyền follow-up, tính nhắc việc nằm ở C# (`Repo`, `Tables`, `NotificationService`); DB giữ CHECK/FK/UNIQUE.
- **Hệ quả**: ai ghi thẳng vào DB (bỏ qua app) sẽ không có audit/version → mọi ghi phải qua `Repo` (AGENT.md §5.3).

## ADR-3 — MySqlConnector + metadata tự viết, không EF Core/Dapper
- **Bối cảnh**: cần chạy được trên MariaDB 10.11 *và* MySQL 8, .NET 10; ~12 bảng có mẫu ghi giống nhau (stamp/version/audit).
- **Quyết định**: `Tables.cs` mô tả cột/luật; `Repo` sinh SQL tham số hóa; đọc ra `Dictionary<string,object?>` đã chuẩn hóa → JSON.
- **Hệ quả**: ít mã lặp, không phụ thuộc provider EF cho .NET 10; đổi lại phải tự duy trì ánh xạ cột (kiểm bằng test + `docs/DATABASE.md`).

## ADR-4 — Chế độ Sandbox (không commit)
- **Bối cảnh**: chỉ có **một** DB (thật). Audit log không xóa được, nên test/thử UI trên DB thật sẽ để rác vĩnh viễn.
- **Quyết định**: `SandboxDb` = 1 kết nối + 1 transaction ngoài, mỗi unit-of-work là SAVEPOINT, rollback khi tắt. Bật bằng `Db:Sandbox=true`.
- **Hệ quả**: test và thử UI không làm bẩn DB; request bị tuần tự hóa (chỉ dùng dev/test); isolation `READ COMMITTED`.

## ADR-5 — Cookie auth + SignalR thay Supabase Auth/Realtime
- **Quyết định**: cookie HttpOnly `SameSite=Lax` + header CSRF tùy biến; hub SignalR phát `change` **sau commit** kèm dòng đầy đủ.
- **Hệ quả**: không có token trong JS; giả định 1 instance (xem ARCHITECTURE §6).

## ADR-6 — Thời gian UTC trong DB, giờ VN ở UI
- **Quyết định**: `DATETIME(3)` UTC; ứng dụng gán mọi dấu thời gian (`Tx.Now`), session `time_zone='+00:00'`; Việt Nam UTC+7 cố định (không DST).

## ADR-7 — `PUT /weekly-priorities/{week}/{rank}` nguyên tử
- **Bối cảnh**: client gốc làm 3–4 lời gọi (xóa trùng, xóa/cập nhật/chèn, tải lại) ⇒ dễ vi phạm UNIQUE khi 2 người cùng chỉnh.
- **Quyết định**: một endpoint nguyên tử trả lại danh sách của tuần.

## ADR-8 — Update không đổi gì thì không tăng version
- **Bối cảnh**: bản gốc tăng `version` kể cả khi không đổi, gây banner "người kia vừa sửa" thừa.
- **Quyết định**: so sánh theo cột; không đổi ⇒ trả bản hiện tại, không audit. Kiểm tra version vẫn chạy trước nên client cũ vẫn nhận 409.

## ADR-10 — Vai trò `admin` và quyền quản lý tài khoản
- **Bối cảnh**: người dùng yêu cầu tài khoản mặc định `admin@soragroup.vn` và để admin + giám đốc tạo tài khoản / đặt mật khẩu.
- **Quyết định**: thêm vai trò `admin` (migration 002). `admin` và `director` quản lý tài khoản; **director không quản lý `admin`**
  (tránh việc một tài khoản làm việc thường chiếm quyền quản trị bằng cách đặt lại mật khẩu). `admin` mở được dữ liệu làm việc nhưng
  không nhận nhắc việc và không là người thực hiện/theo dõi (không phải người tham gia quy trình điều hành).
  Vai trò được đọc từ DB mỗi lần gọi, không tin claim trong cookie.
- **Hệ quả**: nếu muốn director quản lý được cả admin, sửa `AuthService.CanManage` (một dòng) và test `Director_manages_…`.

## ADR-11 — Đặt/đổi mật khẩu thu hồi phiên cũ (`session_version`)
- **Quyết định**: cột `profiles.session_version`; cookie mang claim `sv`; `OnValidatePrincipal` so với giá trị cache 30 s trong DB.
  Cookie cấp trước khi có claim coi như version 1. Tự đổi mật khẩu thì cấp lại cookie cho phiên hiện tại, loại các phiên khác.
- **Hệ quả**: đặt lại mật khẩu vì nghi lộ ⇒ kẻ giữ cookie cũ mất quyền trong ≤ 30 s.

## ADR-12 — Quản trị viên mặc định sinh từ cấu hình, không hard-code mật khẩu trong mã
- **Quyết định**: `Seed:Admin` (Email/DisplayName/Password) ở `appsettings.Local.json`; `SeedService.EnsureDefaultAdminAsync` chỉ tạo khi
  email chưa tồn tại, không bao giờ đặt lại mật khẩu của tài khoản có sẵn.
- **Hệ quả**: đổi mật khẩu trong ứng dụng là vĩnh viễn; cấu hình chỉ có tác dụng với DB mới/rỗng email đó.

## ADR-9 — Bí mật nằm trong file *không được theo dõi bởi git*
- **Bối cảnh**: Visual Studio đã tạo repo git và đã commit `appsettings.Development.json` (nội dung gốc, không bí mật). `.gitignore`
  không có tác dụng với file đã được theo dõi, nên đặt bí mật vào file đó sẽ bị commit nhầm.
- **Quyết định**: bí mật dev nằm ở `SRV_Demo/appsettings.Local.json` (mới, ignore, nạp tùy chọn ở mọi môi trường, ưu tiên cao hơn
  `appsettings.{Env}.json`, thấp hơn biến môi trường); `appsettings.Production.json` (ignore) mang chuỗi kết nối khi deploy.
  `appsettings.Local*.json` có `CopyToPublishDirectory=Never`. Mật khẩu seed chỉ dùng lần đầu.
- **Hệ quả**: file tracked (`appsettings.json`, `appsettings.Development.json`) không chứa bí mật; `appsettings.Production.json` được
  Web Deploy mang lên server (host chia sẻ không có kho bí mật).
