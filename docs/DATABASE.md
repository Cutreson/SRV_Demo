# Cơ sở dữ liệu

**Máy chủ**: `db73041.public.databaseasp.net:3306` · **DB**: `db73041` · **User**: `db73041` (ALL PRIVILEGES trên DB này) · mật khẩu: xem
`SRV_Demo/appsettings.Local.json` (file không được commit; đừng chép vào tài liệu).
**Engine**: MariaDB 10.11.15 (log-bin bật). Schema viết để chạy được cả trên **MySQL 8.0.16+**.
Charset `utf8mb4`, collation `utf8mb4_unicode_ci`, engine InnoDB.

Quản lý schema: `SRV_Demo/Data/Migrations/NNN_*.sql` → `Migrator` (tự chạy khi app khởi động, hoặc `cli migrate`). Phiên bản đã áp: bảng `schema_migrations`.

## 1. Bảng

| Bảng | Khóa | Ghi chú |
|---|---|---|
| `profiles` | `id` CHAR(36) | **Gộp** `auth.users` + `profiles` của Supabase: thêm `email` (UNIQUE), `password_hash`, `last_login_at`, `session_version` (migration 002). `role` ∈ admin/director/secretary (CHECK `chk_profiles_role_v2`) |
| `people` | `id` | Danh bạ người được giao việc (không có tài khoản). Có `version` |
| `categories` | `code` CHAR(1) | A–F, dữ liệu danh mục cố định (đã seed trong migration) |
| `goals` | `id` | Mục tiêu; `progress` DECIMAL(5,2) 0–100; `source` user/demo. Có `version` |
| `tasks` | `id` | Công việc. CHECK: một người thực hiện, `done` ⇒ có `completion_result`. FK `goal_id` ON DELETE SET NULL. Có `version` |
| `task_updates` | `id` | Log nhắc việc/follow-up (FK `task_id` CASCADE). Không sửa/xóa |
| `task_links` | `id` | Tài liệu liên quan; CHECK URL `^https?://` |
| `calendar_events` | `id` | Lịch; CHECK `end_at > start_at`; `recurrence_rule` (RRULE con); có `version` |
| `recurrence_exceptions` | `id` | Bỏ/thay thế 1 lần của lịch lặp; UNIQUE (parent, occurrence) |
| `weekly_priorities` | `id` | Top 3 tuần; UNIQUE (week_start, rank) và (week_start, task_id) |
| `notifications` | `id` | Nhắc việc theo từng tài khoản; `dedupe_key` UNIQUE |
| `audit_logs` | `id` BIGINT AI | `before_data`/`after_data` JSON, `actor_id`, `created_at` |
| `settings` | `key` | `value` JSON (xem mục 4) |
| `schema_migrations` | `version` | Do `Migrator` tạo |

Cột chung "có dấu vết": `created_at, updated_at, created_by, updated_by, version` (bảng *Versioned*).

## 2. Ánh xạ kiểu PostgreSQL → MariaDB/MySQL

| PostgreSQL | Ở đây | Lý do |
|---|---|---|
| `uuid` + `gen_random_uuid()` | `CHAR(36)`, UUID do ứng dụng sinh | Portable (MariaDB có `UUID` riêng, MySQL thì không) |
| `timestamptz` + `now()` | `DATETIME(3)` UTC, ứng dụng gán giá trị | `NOW()` phụ thuộc múi giờ session (server ở Berlin) |
| `jsonb` | `JSON` (MariaDB: LONGTEXT + `JSON_VALID`) | |
| `text` + `check (length(trim(x))>0)` | `VARCHAR(n)`/`TEXT` + `CHECK (CHAR_LENGTH(TRIM(x)) > 0)` | giới hạn độ dài để index/validate |
| `boolean` | `TINYINT(1)` | |
| `numeric(5,2)` | `DECIMAL(5,2)` | |
| `int generated always as identity` | `BIGINT AUTO_INCREMENT` | |
| `num_nonnulls(a,b) <= 1` | `a IS NULL OR b IS NULL` | |
| `url ~* '^https?://'` | `url REGEXP '^https?://'` | |
| index `where resolved_at is null` | index thường `(target_profile_id, resolved_at)` | không có partial index |
| `on conflict do nothing` | `INSERT IGNORE` | |

## 3. Luật nghiệp vụ: trước đây ở đâu → bây giờ ở đâu

| Luật (bản Supabase) | Cơ chế cũ | Cơ chế mới |
|---|---|---|
| `created_by/updated_by/created_at/updated_at/version` | trigger `tg_stamp_versioned` | `Repo.InsertAsync/UpdateAsync` (theo `TableDef.Stamp`) |
| Xung đột phiên bản (mã `PT409`) | trigger ném `PT409` | `Repo.UpdateAsync` ⇒ HTTP **409** `version_conflict` (+ `WHERE version = @old`) |
| `completed_at` theo trạng thái | trigger `tg_tasks_completion` | `Tables.TaskRules` |
| `done` cần `completion_result` | CHECK `tasks_done_requires_result` | `Tables.TaskRules` (422) **và** CHECK `chk_tasks_done_requires_result` |
| Một người thực hiện | CHECK `tasks_one_assignee` | `Tables.TaskRules` (422) **và** CHECK `chk_tasks_one_assignee` |
| `author_id`, `created_at` của log nhắc | trigger `tg_task_updates_before` | `Stamp.Author` |
| Ngày hẹn tiếp cập nhật `tasks.next_follow_up_at` | trigger `tg_task_updates_after` | `TasksController.AddUpdate` (cùng transaction, có audit + version task +1) |
| Audit log | trigger `tg_audit` (bỏ qua cập nhật không đổi) | `Repo.AuditAsync`; update không đổi gì ⇒ không ghi, không tăng version |
| `refresh_notifications()` + `pg_cron` 15′ | hàm PL/pgSQL | `NotificationService.RefreshAsync` + `ReminderJob` |
| RLS "chỉ thành viên" | policy + `is_member()` | `[Authorize]` + `AuthService.IsActiveMemberAsync` |
| RLS thông báo của riêng mình | policy | truy vấn lọc `target_profile_id = @me` |
| Không xóa task/goal/people/updates/settings; audit chỉ đọc | `revoke delete` | không có endpoint tương ứng |
| Realtime | `supabase_realtime` publication | SignalR `change` sau commit |

CHECK trong DB là **lớp phòng thủ thứ hai**; lớp thứ nhất (thông báo lỗi tiếng Việt, mã lỗi) là tầng ứng dụng. `ApiErrorMiddleware` ánh xạ
lỗi MariaDB 4025 / MySQL 3819 (CHECK), 1062, 1452, 1451 sang JSON lỗi.

## 4. Cấu hình (`settings`)

| key | kiểu | mặc định | hợp lệ (API) |
|---|---|---|---|
| `working_days` | int[] ISO 1=T2…7=CN | `[1,2,3,4,5,6]` | mảng 1..7 |
| `working_hours` | `[{start,end}]` | 08:00–12:00, 13:00–17:00 | mảng |
| `buffer_percent` | int | 25 | 20–35 |
| `due_soon_days` | int[] | `[1,3,7]` | 1..90 |
| `event_lead_minutes` | int | 15 | 1–240 |
| `max_block_minutes` | int | 90 | 15–240 |
| `strategy_gap_days` | int | 7 | 1–60 |
| `daily_template` | object `{"1":[[start,end,code],…],…}` | xem migration | object |

## 5. Phiên kết nối (`Db.cs`)

Mỗi kết nối vật lý chạy một lần:
`SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', time_zone='+00:00'`.
(Server mặc định chỉ có `NO_ENGINE_SUBSTITUTION` ⇒ nếu không ép strict, dữ liệu sai bị cắt/âm thầm sửa.)
Chuỗi kết nối được bổ sung: `DateTimeKind=Utc`, `ConnectionReset=false`, `MaximumPoolSize=10` (nếu không tự chỉ định).

## 6. Tạo dữ liệu / dọn dẹp

- Lần đầu: app tự áp migration và tạo 2 tài khoản từ `Seed:Users` khi bảng `profiles` trống, rồi tạo quản trị viên mặc định từ `Seed:Admin`
  nếu email đó chưa tồn tại (xem RUNBOOK §2).
- Migration `002_admin_role_and_sessions` (đã áp lên DB thật 2026-10-12): thêm vai trò `admin` và `profiles.session_version`.
  `session_version` tăng mỗi lần đặt/đổi mật khẩu; cookie mang claim `sv` và bị loại nếu khác giá trị trong DB.
- Dữ liệu minh họa (nhãn `[MINH HỌA]`, `source='demo'`): `cli seed-demo` / `cli purge-demo` (xóa có audit; bản ghi audit vẫn còn).
- **Không** chạy `seed-demo` trên DB thật nếu chưa cần: audit log không xóa được qua ứng dụng.

## 7. Sao lưu

Không có backup tự động của Supabase. Dùng `mysqldump`/MariaDB dump từ máy có client:

```bash
mysqldump -h db73041.public.databaseasp.net -u db73041 -p --single-transaction --routines db73041 > sora_YYYY-MM-DD.sql
```
Hoặc dùng công cụ sao lưu của nhà cung cấp hosting (databaseasp.net / monsterasp.net). Báo cáo tuần vẫn xuất được CSV trong app.
