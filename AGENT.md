# AGENT.md — điểm vào cho AI / lập trình viên tiếp quản

> Đọc file này **trước tiên**. Nó ngắn, đúng sự thật tại thời điểm cập nhật cuối (xem `docs/HANDOVER.md` → "Nhật ký phiên").
> Nếu bạn là AI: sau khi làm xong, **cập nhật `docs/HANDOVER.md`** (mục 7 bên dưới) rồi mới kết thúc.

## 1. Dự án là gì

**SORA Executive Workspace** — web app điều hành cho **Giám đốc** và **Thư ký** (2 tài khoản quyền ngang nhau, chung một
dữ liệu, đồng bộ thời gian thực, có nhật ký ai sửa gì lúc nào): công việc, giao việc & đôn đốc, lịch (có lặp), đề xuất
xếp lịch, nhắc việc, mục tiêu, báo cáo tuần, danh bạ, nhật ký thay đổi. Thêm vai trò **Quản trị viên (`admin`)**: quản lý tài khoản
(xem §5 quy tắc 11).

Bản gốc là **React + Supabase (PostgreSQL/RLS/Realtime)** — thư mục `sora-executive-workspace/` (chỉ để tham chiếu, không sửa).
Bản hiện tại là **ASP.NET Core 10 + MariaDB/MySQL + React (SPA) + SignalR**, nằm trong `SRV_Demo/`.

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| CSDL | **MariaDB 10.11** (host `db73041.public.databaseasp.net`, DB `db73041`) — tương thích MySQL 8 | Dữ liệu **thật**, không phải mock |
| Truy cập dữ liệu | `MySqlConnector` 2.4 (không EF/Dapper) | `Data/Db.cs`, `Data/Repo.cs`, `Data/Tables.cs` |
| Backend | ASP.NET Core 10, controllers JSON (`/api/*`), cookie auth, SignalR (`/hubs/workspace`) | |
| Frontend | React 18 + TypeScript + Vite + Tailwind (`SRV_Demo/ClientApp`) | build ra `SRV_Demo/wwwroot/app`, phục vụ tại `/app/` |
| Test | xUnit integration (`SRV_Demo.Tests`, 32 test) + `tsx --test` (19 test logic thuần) | |

## 2. Bản đồ thư mục

```
AGENT.md · CLAUDE.md · AGENTS.md      <- bạn đang ở đây (CLAUDE.md/AGENTS.md chỉ trỏ về đây)
README.md                             <- giới thiệu ngắn cho con người
docs/                                 <- tài liệu bàn giao (xem bảng mục 3)
scripts/build-client.ps1              <- typecheck (+test) + build React vào wwwroot/app
scripts/run-dev.ps1 [-Sandbox]        <- chạy server http://localhost:5267
SRV_Demo.slnx
SRV_Demo/                             <- project ASP.NET
  Program.cs                          <- DI, auth cookie, SignalR, pipeline, CLI hook, auto-migrate
  Cli.cs                              <- `dotnet run -- cli <lệnh>` (migrate, status, create-user, seed-demo…)
  Api/                                <- AuthController, WorkspaceController, TasksController, CalendarController
  Data/
    Migrations/001_init.sql           <- schema (nhúng vào assembly; tách câu lệnh bằng dòng `-- GO`)
    Migrator.cs                       <- áp migration + bảng schema_migrations
    Tables.cs                         <- metadata cột/bảng + luật nghiệp vụ (TaskRules, EventRules)
    Repo.cs                           <- INSERT/UPDATE/DELETE chung: version, stamp, audit, validate
    Db.cs                             <- kết nối, transaction, Tx, định dạng giá trị
    SandboxDb.cs                      <- chế độ KHÔNG BAO GIỜ commit (dùng cho test/thử UI)
  Services/                           <- AuthService, NotificationService, SeedService, Realtime(Hub), ReminderJob
  Common/                             <- ApiException, ApiErrorMiddleware (lỗi JSON + chặn CSRF)
  ClientApp/                          <- mã nguồn React (src/lib/api.ts, realtime.ts, data.tsx là lớp dữ liệu)
  wwwroot/app/                        <- bundle đã build (được commit để `dotnet run` chạy ngay)
  appsettings.json                    <- mặc định, tracked (không bí mật)
  appsettings.Local.json              <- BÍ MẬT dev (chuỗi kết nối, mật khẩu seed) — untracked
  appsettings.Production.json         <- BÍ MẬT deploy — untracked
SRV_Demo.Tests/                       <- integration test chạy trên DB thật ở chế độ sandbox
sora-executive-workspace/ + .zip      <- mã Supabase gốc (tham chiếu, đừng dùng để chạy)
```

Thư mục `SRV_Demo/Controllers`, `Models`, `Views`, `wwwroot/css|js|lib` là **phần dư của template MVC** (không còn route nào dùng).
An toàn để xóa; chưa xóa vì phiên trước không được phép thao tác xóa thư mục.

## 3. Tài liệu

| File | Nội dung |
|---|---|
| `docs/HANDOVER.md` | **Trạng thái hiện tại**, đã làm/chưa làm, vấn đề đã biết, nhật ký phiên — *cập nhật mỗi phiên* |
| `docs/ARCHITECTURE.md` | Kiến trúc, luồng request, realtime, auth, bảo mật, xử lý thời gian |
| `docs/DATABASE.md` | Schema, ánh xạ PostgreSQL→MariaDB, luật nào nằm ở đâu (trigger/RLS đã đi đâu), backup |
| `docs/API.md` | Toàn bộ endpoint REST + hợp đồng SignalR + mã lỗi |
| `docs/MIGRATION_MAP.md` | Từng phần Supabase được thay bằng gì, khác biệt hành vi |
| `docs/RUNBOOK.md` | Cài đặt, chạy, build, test, CLI, deploy (Web Deploy), sao lưu, xử lý sự cố |
| `docs/DECISIONS.md` | Các quyết định kiến trúc và lý do |

## 4. Lệnh thường dùng (PowerShell, chạy từ `D:\SRV_Demo`)

```powershell
# Chạy server (dữ liệu THẬT được ghi) — http://localhost:5267 → chuyển sang /app/
powershell -File scripts/run-dev.ps1
# Chạy server ở chế độ SANDBOX: ghi gì cũng bị rollback khi tắt. DÙNG CÁI NÀY KHI THỬ UI.
powershell -File scripts/run-dev.ps1 -Sandbox

# Build lại giao diện (bắt buộc sau khi sửa ClientApp/src)
powershell -File scripts/build-client.ps1 -Test

# Test backend (≈2 phút vì DB ở xa; không để lại dữ liệu)
dotnet test SRV_Demo.Tests

# Quản trị CSDL (chuỗi kết nối lấy từ SRV_Demo/appsettings.Local.json)
dotnet run --project SRV_Demo --no-launch-profile -- cli status
dotnet run --project SRV_Demo --no-launch-profile -- cli help
```

## 5. Quy tắc bất biến — đừng phá

1. **Không commit bí mật.** Chuỗi kết nối + mật khẩu seed nằm trong `SRV_Demo/appsettings.Local.json` và
   `appsettings.Production.json` (đã `.gitignore`). **Đừng đặt bí mật vào `appsettings.json`/`appsettings.Development.json`** — hai file đó
   đang được git theo dõi (`.gitignore` không bảo vệ file đã tracked). Không dán mật khẩu vào tài liệu, log, commit, chat.
2. **Không xóa công việc / mục tiêu / người / log nhắc việc / cấu hình qua API** — dùng trạng thái *Đã hủy / Ngừng*.
   Chỉ `task_links`, `calendar_events`, `recurrence_exceptions`, `weekly_priorities` được xóa. **Audit log chỉ ghi, không sửa/xóa.**
3. **Mọi ghi dữ liệu đi qua `Repo`** (hoặc có `Repo.AuditAsync` đi kèm) để giữ version, `created_by/updated_by`, audit, realtime.
   Đừng viết `UPDATE tasks …` thủ công trong controller.
4. **Chống ghi đè**: cập nhật bản ghi có `version` phải gửi đúng `version` đang thấy → sai thì `409 version_conflict`.
5. **Hoàn thành (`status = done`) bắt buộc có `completion_result`** — kiểm ở `Tables.TaskRules` *và* CHECK trong DB.
6. **Giờ**: DB lưu **UTC** (`DATETIME(3)`); API trả ISO-8601 có `Z`; giao diện hiển thị/nhập theo giờ Việt Nam (UTC+7, không DST).
   Mọi logic "hôm nay / tuần / ngày làm việc" tính theo giờ VN (`ClientApp/src/lib/time.ts`, `NotificationService`).
7. **`deadline` (`due_at`) và `ngày follow-up` (`next_follow_up_at`) là 2 trường độc lập.**
8. **Thử nghiệm thì dùng sandbox** (`Db__Sandbox=true` / `run-dev.ps1 -Sandbox` / `dotnet test`). Đừng tạo dữ liệu rác trong DB thật;
   không có API xóa nên không dọn được audit.
9. Sửa schema = **thêm file migration mới** `Data/Migrations/00N_*.sql` (không sửa file đã áp). Cập nhật `Data/Tables.cs` và `docs/DATABASE.md`.
10. Sửa hợp đồng API = cập nhật `docs/API.md` + `ClientApp/src/lib/api.ts` + (nếu cần) `Tables.cs`, và thêm test.
11. **Quản lý tài khoản** (`Api/UsersController`, `Services/AuthService`): chỉ `admin` và `director` được tạo tài khoản / đặt mật khẩu
    người khác; **director không được tạo hoặc đặt mật khẩu cho tài khoản `admin`** (tránh chiếm quyền). Vai trò được đọc từ DB mỗi lần gọi.
    Đặt/đổi mật khẩu tăng `profiles.session_version` ⇒ mọi cookie cũ của tài khoản đó bị loại (≤ 30 s). `admin` không nhận nhắc việc và
    không xuất hiện ở ô chọn người thực hiện/theo dõi (`data.staff`). Mật khẩu không bao giờ vào audit/log.

## 6. Bẫy đã gặp

- **DB là MariaDB 10.11, không phải MySQL**, và mặc định `sql_mode` *không strict*, múi giờ session Berlin → `Db.cs` ép
  `STRICT_TRANS_TABLES` + `time_zone='+00:00'` cho mỗi kết nối. Không dùng `NOW()`; truyền thời gian từ ứng dụng (`Tx.Now`).
- **MySqlConnector trả `CHAR(36)` thành `Guid`** (cả `GetValue` lẫn `ExecuteScalar`) → luôn đi qua `Fmt.ToJsonValue` /
  `Tx.QueryAsync` / `Tx.ScalarAsync` (đã chuẩn hóa thành `string`). Đừng cast `(string)reader[...]` trực tiếp.
- `ConnectionReset=false` (khởi tạo session một lần cho mỗi kết nối vật lý) — đừng để lại biến session/temporary table.
- Chuỗi kết nối có mật khẩu chứa `=`/`@`/`!`: `MySqlConnectionStringBuilder` parse được cả khi có hay không có dấu nháy (đã kiểm tra);
  dùng `Pwd='...'` cho an toàn.
- Hosted MariaDB bật binary log → thường **cấm `CREATE TRIGGER`**; vì vậy toàn bộ trigger/RLS của Postgres được chuyển sang tầng ứng dụng.
- Windows PowerShell 5.1: gửi JSON có tiếng Việt phải mã hóa UTF-8 bằng tay (`[Text.Encoding]::UTF8.GetBytes`) và file `.ps1`
  không BOM bị đọc như ANSI. Dùng ASCII trong script hoặc `-Encoding UTF8`.
- `Invoke-RestMethod -Headers` **gắn header vào `WebSession`** và dùng lại ở các lệnh sau → test CSRF phải dùng phiên mới.
- Cookie auth `SameSite=Lax` + header `X-Requested-With: sora` bắt buộc cho mọi non-GET dưới `/api` (client `api.ts` tự gắn).
- Tắt server dev trước khi `dotnet build` (file `SRV_Demo.exe` bị khóa).

## 7. Quy trình bàn giao (làm cuối mỗi phiên)

1. Thêm 1 mục vào **"Nhật ký phiên"** trong `docs/HANDOVER.md` (ngày, mục tiêu, đã làm, kết quả kiểm chứng, việc dở dang).
2. Cập nhật **"Trạng thái hiện tại"** và **"Vấn đề đã biết"** nếu thay đổi.
3. Nếu đổi schema/API/kiến trúc: sửa `docs/DATABASE.md` / `docs/API.md` / `docs/ARCHITECTURE.md` / `docs/DECISIONS.md` tương ứng.
4. Chạy `scripts/build-client.ps1 -Test` và `dotnet test SRV_Demo.Tests`; ghi kết quả (số test pass) vào HANDOVER.
5. Trước khi commit: `appsettings.Local.json`, `appsettings.Production.json`, `*.publishSettings` phải bị ignore
   (`git check-ignore -v <file>`). Repo do Visual Studio tạo; `git` không có trong PATH — dùng git đi kèm Visual Studio (đường dẫn ở HANDOVER mục 2).

## 8. Tài khoản & bí mật (không ghi giá trị ở đây)

- Tài khoản đã tạo trên DB thật: `admin@soragroup.vn` (admin — mặc định, mật khẩu do chủ dự án đặt, lưu ở `Seed:Admin:Password`
  trong `appsettings.Local.json`; **nên đổi**), `giamdoc@soragroup.vn` (director), `thuky@soragroup.vn` (secretary).
  Mật khẩu ban đầu là chuỗi ngẫu nhiên nằm ở `SRV_Demo/appsettings.Local.json` → `Seed:Users` — **nên đổi** ở màn hình
  Cấu hình → Tài khoản của tôi, rồi xóa mật khẩu khỏi file cấu hình (không cần nữa vì bảng `profiles` đã có dữ liệu).
- Chuỗi kết nối DB: `ConnectionStrings:Default` trong `appsettings.Local.json` (dev) và `appsettings.Production.json` (deploy).
  Có thể ghi đè bằng biến môi trường `ConnectionStrings__Default`.
