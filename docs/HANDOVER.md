# HANDOVER — trạng thái & nhật ký phiên

> File **sống**: cập nhật cuối mỗi phiên làm việc (xem `AGENT.md` §7). Mục mới nhất ở trên cùng của "Nhật ký phiên".

## 1. Trạng thái hiện tại (cập nhật 2026-10-12)

**Đã chuyển xong** toàn bộ ứng dụng `sora-executive-workspace` (React + Supabase) sang **ASP.NET Core 10 + MariaDB/MySQL** trong
`SRV_Demo/`, chạy trên **DB thật** `db73041`. Cả 4 milestone của bản gốc (M1–M4) có đủ chức năng ở bản mới.

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Schema trên DB thật | ✅ đã áp `001_init` (14 bảng), `categories` 6 dòng, `settings` 8 dòng | `cli status` |
| Tài khoản | ✅ 3 tài khoản: `admin@soragroup.vn` (admin, mặc định), `giamdoc@…` (director), `thuky@…` (secretary) | `profiles = 3` |
| Quản lý tài khoản (admin/director tạo tài khoản, đặt mật khẩu) | ✅ API + màn hình **Tài khoản** | 11 test `UsersTests`, đã thử trên UI (sandbox) |
| Dữ liệu nghiệp vụ trên DB thật | **trống** (chưa nạp demo, chưa có dữ liệu thật) | `tasks = 0` |
| Backend API + SignalR | ✅ | 32/32 test integration pass (sandbox) |
| Frontend (React) đã đổi lớp dữ liệu | ✅ | typecheck sạch, 19/19 unit test pass, build OK |
| Chạy end-to-end trong trình duyệt | ✅ (xem "Đã kiểm chứng trên UI") | phiên 2026-10-12 |
| Deploy `http://srv.runasp.net/` | ⏳ **chưa thực hiện** — profile Web Deploy có sẵn, cần build client rồi Publish | `docs/RUNBOOK.md` §7 |
| Tài liệu bàn giao | ✅ `AGENT.md` + `docs/*` | |

### Đã kiểm chứng trên UI (sandbox, trình duyệt thật)
Đăng nhập · Tổng quan (quá hạn, sắp đến hạn, Top 3, cảnh báo mục tiêu E/F thiếu khung, lịch hôm nay) · Ghi nhanh · Danh sách công việc ·
Lịch tuần có mở rộng RRULE · Đề xuất lịch → Xác nhận (batch insert + tự tải lại) · Nhật ký thay đổi (có tác giả) ·
**Realtime**: việc do Thư ký tạo xuất hiện ngay trên tab của Giám đốc, không reload.

### Chỉ được kiểm bằng test API (chưa bấm tay trên UI)
Sửa/xóa/đánh dấu xong sự kiện lịch, kéo-thả đổi giờ, ngăn kéo công việc (lưu + banner xung đột), thêm log nhắc, thêm/xóa tài liệu,
"Ghi nhắc" ở trang Giao việc, sửa mục tiêu, danh bạ, xuất CSV/in báo cáo, lưu cấu hình, đổi mật khẩu, trang Nhắc việc.
Các lời gọi dữ liệu của những màn hình này đã đổi sang `api.*` và typecheck sạch; endpoint tương ứng có test.
**Việc nên làm đầu tiên**: chạy `scripts/run-dev.ps1 -Sandbox` và bấm qua các luồng trên.

## 2. Vấn đề đã biết / việc tồn

| # | Vấn đề | Mức | Gợi ý |
|---|---|---|---|
| 1 | **Bí mật đã xuất hiện trong lịch sử trò chuyện** (mật khẩu DB; mật khẩu seed của 2 tài khoản; mật khẩu mặc định của admin) | Cao | Đổi mật khẩu DB ở nhà cung cấp + cập nhật các file appsettings; đổi mật khẩu 3 tài khoản (Cấu hình → Đổi mật khẩu) rồi xóa `Seed:Users[].Password` và `Seed:Admin:Password` khỏi `appsettings.Local.json` |
| 11 | `SRV_Demo/appsettings.json` (**file tracked**) hiện chứa chuỗi kết nối **kèm mật khẩu DB** — do người dùng chỉnh tay, không phải do phiên này. Nếu commit, mật khẩu vào lịch sử git | Cao | Xóa `ConnectionStrings:Default` khỏi `appsettings.json` (để trống như bản gốc); `appsettings.Local.json` / `appsettings.Production.json` đã có chuỗi kết nối và được ưu tiên cao hơn |
| 12 | Tài khoản `admin@soragroup.vn` dùng mật khẩu mặc định đơn giản do chủ dự án đặt; site công khai `srv.runasp.net` | Trung bình | Đổi ngay sau khi deploy; cân nhắc buộc đổi mật khẩu lần đầu đăng nhập (chưa làm) |
| 13 | Chưa có UI khóa/mở tài khoản (chỉ `cli deactivate/activate`) và chưa có đổi vai trò | Thấp | Thêm vào `UsersPage` + endpoint nếu cần |
| 2 | Phần dư template MVC chưa xóa: `SRV_Demo/Controllers`, `Models`, `Views`, `wwwroot/css`, `wwwroot/js`, `wwwroot/lib` | Thấp | Xóa thư mục (không có route nào dùng; đã kiểm tra build) |
| 3 | 2 dòng audit đầu tiên (INSERT `profiles`) có `record_id = NULL` (tạo trước khi sửa lỗi `Guid`→`string`); id nằm trong `after_data.id` | Rất thấp | Bỏ qua (audit không sửa) |
| 4 | Không tìm thấy `docs/SORA_Executive_Workspace_Claude_Spec.md` (README gốc nhắc tới) | Thông tin | Xin lại file nếu cần đối chiếu đặc tả |
| 5 | Test backend ≈ 2 phút (độ trễ mạng tới DB) | Thấp | Chấp nhận; hoặc đặt DB cục bộ cho CI |
| 6 | Presence/throttle đăng nhập ở bộ nhớ ⇒ chỉ 1 instance | Thấp | Backplane/Redis nếu scale-out |
| 7 | `ReminderJob` chỉ chạy khi tiến trình app còn sống (IIS shared có thể ngủ khi không có request) | Thấp | Client mở app sẽ tự gọi `refresh`; có thể thêm ping định kỳ |
| 8 | `appsettings.Production.json` đang chứa mật khẩu DB (để Web Deploy mang lên server) | Trung bình | Chấp nhận cho hosting chia sẻ, hoặc đặt biến môi trường trên host |
| 9 | Repo git do Visual Studio tạo (2 commit); toàn bộ công việc của phiên này **chưa commit** (`git status`). `git` không có trong PATH — dùng git của VS: `C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe` | Thông tin | Commit qua Visual Studio. Trước khi commit kiểm tra `appsettings.Local.json`/`Production.json`/`*.publishSettings` đang bị ignore |
| 10 | Có `srv.runasp.net-WebDeploy.publishSettings` ở gốc repo (chứa thông tin đăng nhập deploy; đã bị `.gitignore` bắt) — **chưa được đọc** | Thông tin | Giữ ngoài git; không dán vào chat |

## 3. Gợi ý bước tiếp theo

1. Xử lý mục 1 (xoay bí mật).
2. Bấm tay các luồng "chỉ kiểm bằng test API" ở trên (sandbox).
3. Build client + Publish lên `srv.runasp.net`, kiểm `/api/health`.
4. (Tùy chọn) `cli seed-demo` nếu muốn dữ liệu minh họa — lưu ý audit không xóa được.
5. (Tùy chọn) Playwright E2E chạy với `Db__Sandbox=true`; GitHub Actions chạy `build-client` + `dotnet test`.

## 4. Quyết định quan trọng (tóm tắt, chi tiết ở `docs/DECISIONS.md`)

- Giữ React, chỉ thay lớp dữ liệu (không viết lại UI thành Razor).
- Không dùng trigger/stored procedure DB: mọi luật ở tầng ứng dụng (host MariaDB bật binary log).
- MySqlConnector + metadata tự viết thay vì EF Core (kiểm soát SQL, tương thích MariaDB/MySQL, ít phụ thuộc).
- Chế độ **sandbox** (không commit) cho test và thử UI trên DB thật.
- Cookie auth + SignalR thay Supabase Auth/Realtime.

## 5. Nhật ký phiên

### 2026-10-12 (phiên 2) — Vai trò admin + quản lý tài khoản
**Yêu cầu**: tạo tài khoản mặc định `admin@soragroup.vn` (mật khẩu do chủ dự án đặt); admin và giám đốc tạo tài khoản và đặt mật khẩu cho tài khoản khác.

**Đã làm**
- Migration `002_admin_role_and_sessions` (đã áp lên DB thật): `role` thêm `admin`; cột `session_version`.
- `AuthService`: vai trò admin, `CanManage` (director không quản lý admin), `ListUsersAsync`, `SetPasswordAsync` (tăng `session_version`, ghi audit
  `password_changed` không kèm bí mật), `GetSessionAsync` (cache 30 s) thay `IsActiveMemberAsync`; đổi mật khẩu của mình cấp lại cookie.
- `Api/UsersController`: `GET/POST /api/users`, `PUT /api/users/{id}/password`. `SeedService.EnsureDefaultAdminAsync` + CLI `ensure-admin`.
- Admin bị loại khỏi nhắc việc (`NotificationService`) và khỏi các ô chọn người (`data.staff`).
- UI: trang **Tài khoản** (`features/users/UsersPage.tsx`, hiện cho admin/director), nhãn vai trò, nhật ký hiển thị "Đã đổi mật khẩu".
- Tạo tài khoản admin mặc định trên DB thật bằng `cli ensure-admin` (`Seed:Admin` trong `appsettings.Local.json`).
- Sửa lỗi: `TableDef.Find` ném `KeyNotFoundException` với cột ngoài metadata (test mới phát hiện).
- Sửa tài liệu: chuỗi kết nối **không** bắt buộc đặt mật khẩu trong nháy (đã kiểm tra parser).

**Kiểm chứng**: `dotnet test SRV_Demo.Tests` 32/32 (11 test mới); `npm test` 19/19; typecheck sạch; đăng nhập admin thật thành công (sandbox);
trang Tài khoản: director thấy nút "Đặt mật khẩu" bị khóa với admin và với chính mình, đặt mật khẩu cho thư ký → 204 (sandbox, đã rollback).
DB thật sau phiên: `profiles=3`, `tasks=0`.

**Lưu ý**: phát hiện `appsettings.json` (tracked) bị chỉnh tay để chứa mật khẩu DB — xem mục 2 #11. Không sửa/hoàn tác vì là thay đổi của người dùng.

### 2026-10-12 — Chuyển Supabase → ASP.NET + MariaDB (phiên đầu)
**Mục tiêu (từ người dùng)**: chuyển `sora-executive-workspace` sang MySQL + ASP.NET trong `SRV_Demo`, dùng DB thật, tạo `AGENT.md` và tài liệu bàn giao.

**Đã làm**
- Khảo sát: DB thật là **MariaDB 10.11.15**, trống, quyền ALL trên `db73041`, `sql_mode` không strict, múi giờ Berlin.
- Backend: `Data/*` (Db, Repo, Tables, Migrator, SandboxDb), `Services/*`, `Api/*`, `Cli.cs`, `Program.cs`; schema `001_init.sql` đã áp lên DB thật.
- Tạo 2 tài khoản (mật khẩu ngẫu nhiên trong `appsettings.Local.json`, **không** đưa vào tài liệu).
- Phát hiện giữa phiên: người dùng đã tạo repo git bằng Visual Studio (2 commit). Đã (a) chuyển bí mật sang `appsettings.Local.json`
  (untracked) và khôi phục `.gitignore`/`appsettings.Development.json` về đúng bản đã commit + thêm luật ignore của dự án;
  (b) `README.md` (stub `# SRV_Demo`) được thay bằng README thật. Chưa commit gì.
- Frontend: sao chép vào `SRV_Demo/ClientApp`, thay `supabase.ts` bằng `api.ts` + `realtime.ts`, sửa 14 file; build ra `wwwroot/app`.
- Test: 21 integration (sandbox) + giữ 19 unit; sửa 3 lỗi phát hiện nhờ test/chạy thật: `CHAR(36)`→`Guid` (reads + scalar), UTF-8 sai ⇒ 500,
  `/auth/me` trả 401 gây nhiễu console.
- Thêm: đổi mật khẩu trong UI, CLI quản trị, `ReminderJob` (thay pg_cron), header bảo mật, `CopyToPublishDirectory=Never` cho file bí mật.
- Tài liệu: `AGENT.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/*`.

**Kết quả kiểm chứng**
- `dotnet build` 0 cảnh báo / 0 lỗi; `dotnet test SRV_Demo.Tests` → 21/21; `npm test` → 19/19; `npm run typecheck` sạch.
- Sau toàn bộ test + thử UI: DB thật vẫn `tasks=0`, `profiles=2`, `audit_logs=2` (sandbox không để lại gì).
- `dotnet publish` không mang `ClientApp/` hay `appsettings.Local*.json`; chạy thử môi trường Production → `/api/health` ok.

**Dở dang**: xem mục 2 & 3. Chưa deploy.
