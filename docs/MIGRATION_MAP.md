# Bản đồ chuyển đổi: Supabase/React → ASP.NET Core + MariaDB

Nguồn: `sora-executive-workspace/` (giữ nguyên làm tham chiếu). Đích: `SRV_Demo/`.

## 1. Thay thế theo thành phần

| Bản gốc (Supabase) | Bản mới | Vị trí |
|---|---|---|
| PostgreSQL schema `supabase/migrations/*_schema.sql` | MariaDB schema | `Data/Migrations/001_init.sql` |
| Triggers/RLS/Audit `…_triggers_rls_audit.sql` | Tầng ứng dụng (`Repo`, `Tables`, `[Authorize]`) | `Data/Repo.cs`, `Data/Tables.cs`, `Api/*` |
| `refresh_notifications()` + pg_cron `…_notifications.sql` | `NotificationService` + `ReminderJob` | `Services/` |
| `supabase/seed.sql`, `purge_demo.sql` | `cli seed-demo`, `cli purge-demo` | `Services/SeedService.cs`, `Cli.cs` |
| `supabase/sql/create_profiles.sql` | `Seed:Users` + `cli create-user` | `appsettings.*.json`, `Cli.cs` |
| Supabase Auth (email+password) | Cookie auth + bảng `profiles` | `Services/AuthService.cs`, `Api/AuthController.cs` |
| PostgREST (`supabase.from(...)`) | REST controllers có kiểu | `Api/*`, `ClientApp/src/lib/api.ts` |
| Supabase Realtime (postgres_changes + presence) | SignalR hub | `Services/Realtime.cs`, `ClientApp/src/lib/realtime.ts` |
| `tests/sql/*` (Postgres cục bộ) | xUnit integration trên DB thật (sandbox) | `SRV_Demo.Tests/` |
| `tests/unit/*` | giữ nguyên | `ClientApp/tests/unit/` |
| Deploy Vercel (static) | Web Deploy lên IIS (`srv.runasp.net`) | `Properties/PublishProfiles/*.pubxml` |
| `.env` (`VITE_SUPABASE_*`) | `ConnectionStrings:Default` (server-side), không còn env cho frontend | `appsettings*.json` |

## 2. Từng file React đã đổi

| File | Thay đổi |
|---|---|
| `lib/supabase.ts` | **Xóa** → `lib/api.ts` (`AppError`, `toAppError`, `api.*`) |
| `lib/realtime.ts` | **Mới** (SignalR) |
| `lib/data.tsx` | `reload` = `api.bootstrap()`; realtime = `realtime.on(...)`; `refreshNotifications` = 1 lời gọi |
| `lib/events.ts` | `api.events(from,to)`; reload có debounce khi có `change` |
| `lib/settings.ts` | `api.settings()`; thêm `clearSettingsCache()` |
| `features/auth/AuthProvider.tsx`, `LoginPage.tsx` | Phiên cookie; bỏ `session`, `notMember`, `supabaseConfigured` |
| `App.tsx` | Gate chỉ dựa `profile` |
| `features/tasks/TaskForm.tsx` | log nhắc/tài liệu qua `api`; lỗi URL lấy từ server |
| `features/delegated/DelegatedPage.tsx` | `api.taskUpdatesFor`, realtime `task_updates` |
| `features/calendar/{CalendarPage,EventModal,ScheduleProposals}.tsx` | `api.createEvent/updateEvent/deleteEvent/createException/createEvents` |
| `features/dashboard/DashboardPage.tsx` | Top 3: `api.setPriority` (nguyên tử) thay chuỗi delete/update/insert |
| `features/goals/GoalsPage.tsx` | `api.createGoal/updateGoal` |
| `features/audit/{AuditPage,RecordHistory}.tsx` | `api.audit` |
| `features/reports/ReportsPage.tsx` | `api.taskUpdatesRange` |
| `features/settings/SettingsPage.tsx` | `api.putSetting`; **thêm** đổi mật khẩu; bỏ ghi chú "làm trong Supabase" |
| `vite.config.ts` | `base:'/app/'`, `outDir:'../wwwroot/app'`, proxy `/api` & `/hubs` |
| `package.json` | bỏ `@supabase/supabase-js`, `test:sql`; thêm `@microsoft/signalr` |

Không đổi: `scheduler.ts`, `recurrence.ts`, `report.ts`, `time.ts`, `taskLogic.ts`, `labels.ts`, `router.ts`, `ui.tsx`,
`calendarRules.ts`, `layout.ts`, `diff.ts`, `InboxPage`, `PeoplePage`, `TasksPage`, `QuickCapture` và CSS/Tailwind.

## 3. Khác biệt hành vi cần biết

| Chủ đề | Bản gốc | Bản mới |
|---|---|---|
| Mã lỗi xung đột | Postgres `PT409` | HTTP 409 + `code: version_conflict` (UI vẫn hiện cùng thông báo) |
| Sửa không đổi gì | Vẫn tăng `version` (audit bỏ qua) | **Không** tăng version, không audit |
| `version` khi sửa | Tùy chọn (thiếu thì không kiểm) | **Bắt buộc** với task/goal/person/event |
| Top 3 | 3–4 lời gọi riêng lẻ phía client | 1 lời gọi nguyên tử `PUT /weekly-priorities/{week}/{rank}` |
| Thêm lịch hàng loạt (đề xuất lịch) | 1 INSERT nhiều dòng | `POST /api/events` mảng, nguyên tử, tối đa 200 |
| Xóa lịch lặp | FK cascade âm thầm | cascade + ghi audit từng ngoại lệ bị xóa |
| Tạo tài khoản, đặt mật khẩu | Bảng điều khiển Supabase | Màn hình **Tài khoản** (admin/director) hoặc `cli create-user / set-password`; tự đổi mật khẩu trong Cấu hình |
| Khóa/mở tài khoản | Bảng điều khiển Supabase | `cli deactivate / activate` (chưa có UI) |
| Vai trò | `director`, `secretary` | thêm `admin` (quản trị viên; không nhận nhắc việc) |
| Tính lại nhắc việc | Hàm DB + pg_cron | C# (`NotificationService`); lịch 15′ trong tiến trình app (cần app đang chạy) |
| Làm mới token | Supabase tự làm | Cookie trượt 7 ngày |
| Cột thời gian trong audit JSON | `2026-10-12T07:00:00+00:00` | `2026-10-12T07:00:00.000Z` (UI chỉ dùng `new Date`/regex ngày) |
| `settings` ghi | RLS cho phép insert/update | Chỉ khóa đã biết, kiểm khoảng giá trị |

## 4. Chưa/không chuyển

- `docs/SORA_Executive_Workspace_Claude_Spec.md` (đặc tả gốc được README gốc nhắc tới) **không có trong gói zip** — chưa tìm thấy.
- Thông báo đẩy (push) ngoài trình duyệt: bản gốc cũng không có.
- Đa instance / scale-out: chưa hỗ trợ (xem ARCHITECTURE §6).
