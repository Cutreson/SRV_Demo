# Kiến trúc

## 1. Tổng quan

```
 Trình duyệt (React SPA, /app/)                      ASP.NET Core 10 (SRV_Demo)                       MariaDB 10.11
┌────────────────────────────────┐   HTTPS/JSON   ┌───────────────────────────────────┐  MySqlConnector  ┌──────────────┐
│ features/*  (màn hình)         │ ─────────────► │ ApiErrorMiddleware (lỗi + CSRF)   │ ───────────────► │ db73041      │
│ lib/api.ts  (fetch, AppError)  │  cookie        │ Cookie auth → [Authorize]         │   transaction    │  profiles    │
│ lib/data.tsx (state toàn app)  │ ◄───────────── │ Api/*Controller                   │ ◄─────────────── │  tasks …     │
│ lib/realtime.ts (SignalR)      │                │   └─ Data/Repo (version·audit·rule)│                 │  audit_logs  │
└──────────────▲─────────────────┘                │ Services/* (Auth, Notification…)  │                 └──────────────┘
               │  "change" / "presence"           │ SignalR Hub /hubs/workspace       │
               └────────────────────────────────── └───────────────────────────────────┘
```

- **Một origin**: SPA, `/api/*` và `/hubs/*` cùng host. Không cần CORS. Khi `npm run dev`, Vite proxy `/api`, `/hubs` sang `:5267`.
- **Backend là nguồn sự thật cho mọi luật ghi**: version, người tạo/sửa, audit, ràng buộc "Hoàn thành cần kết quả", chỉ 1 người thực hiện…
- **Frontend giữ logic tính toán thuần** (đề xuất lịch, lịch lặp RRULE, báo cáo tuần, lọc/sắp xếp) y như bản gốc — có unit test
  trong `ClientApp/tests/unit`. Server chỉ lưu và kiểm tra.

## 2. Luồng một thao tác ghi (ví dụ: sửa công việc)

1. `TaskForm` → `data.updateTask(task, patch)` → `api.updateTask(id, task.version, patch)` → `PATCH /api/tasks/{id}` `{...patch, version}`.
2. `ApiErrorMiddleware` kiểm `X-Requested-With: sora`; cookie auth xác thực (và `OnValidatePrincipal` kiểm tài khoản còn `active`, cache 30 s).
3. `TasksController.Update` → `Db.TxAsync` → `Repo.UpdateAsync(tx, Tables.Tasks, id, body, actor)`:
   - `SELECT … FOR UPDATE` dòng hiện tại; so `version` (sai ⇒ `ApiException 409 version_conflict`);
   - gộp các cột *Writable* có trong body; `Tables.TaskRules` (assignee, done⇒result, completed_at);
   - nếu không có gì đổi thật ⇒ trả bản cũ (không tăng version, không audit);
   - `UPDATE … SET …, updated_at, updated_by, version = version + 1 WHERE id AND version = @old`;
   - đọc lại dòng, ghi `audit_logs` (before/after JSON), thêm `ChangeEvent` vào `tx.Events`.
4. `COMMIT`; sau commit `Db` gọi `IRealtime.PublishAsync(events)` → SignalR `change` tới mọi client.
5. Client nhận `change`: `data.tsx` upsert dòng (bỏ bản có `version` cũ hơn); các hook khác (events/priorities/task_updates) tải lại.

## 3. Thành phần backend

| File | Vai trò |
|---|---|
| `Program.cs` | DI, cookie auth, SignalR, JSON snake_case, auto-migrate + seed tài khoản, CLI (`cli …`), header bảo mật |
| `Common/ApiErrorMiddleware.cs` | `ApiException`/`MySqlException`/JSON lỗi → `{code,message}`; chặn non-GET thiếu `X-Requested-With` |
| `Data/Db.cs` | Mở kết nối, ép `sql_mode` strict + UTC một lần cho mỗi kết nối vật lý, `ReadAsync`/`TxAsync`, `Tx`, `Fmt` |
| `Data/SandboxDb.cs` | 1 kết nối + 1 transaction ngoài không commit, mỗi unit-of-work là SAVEPOINT; `Db:Sandbox=true` |
| `Data/Tables.cs` | Metadata cột (kiểu, bắt buộc, enum, khoảng giá trị, ghi được?) + luật nghiệp vụ |
| `Data/Repo.cs` | Insert/Update/Delete/Audit chung theo metadata; chuẩn hóa JSON↔DB |
| `Data/Migrator.cs` | Áp `Migrations/*.sql` (nhúng) một lần, ghi `schema_migrations` |
| `Services/AuthService.cs` | Đăng nhập (PBKDF2 qua `PasswordHasher`), tạo user, đổi mật khẩu, `IsActiveMemberAsync`, `LoginThrottle` |
| `Services/NotificationService.cs` | Tính lại nhắc việc (port `refresh_notifications()`) |
| `Services/ReminderJob.cs` | Chạy tính lại nhắc việc mỗi 15 phút (thay `pg_cron`) |
| `Services/Realtime.cs` | `WorkspaceHub`, `PresenceTracker`, `SignalRRealtime` |
| `Services/SeedService.cs` | Tạo 2 tài khoản lần đầu (`Seed:Users`) + quản trị viên mặc định (`Seed:Admin`); `seed-demo` / `purge-demo` |
| `Api/UsersController.cs` | Danh sách / tạo tài khoản / đặt mật khẩu (admin, director) |
| `Cli.cs` | Lệnh quản trị |

## 4. Thành phần frontend (`SRV_Demo/ClientApp/src`)

| File | Vai trò |
|---|---|
| `lib/api.ts` | Tất cả lời gọi REST (có kiểu), `AppError` (kind: conflict/validation/permission/auth/network) |
| `lib/realtime.ts` | Kết nối SignalR dùng chung, `on(table, handler)`, presence, tự nối lại |
| `lib/data.tsx` | `DataProvider`: nạp `/api/bootstrap`, giữ state tasks/people/goals/notifications, áp dụng realtime, làm mới nhắc việc |
| `lib/events.ts` | `useEvents(from,to)` = sự kiện đơn + lặp (mở rộng RRULE phía client) + ngoại lệ |
| `features/auth/AuthProvider.tsx` | Phiên = cookie HttpOnly; hỏi `/api/auth/me`; 401 bất kỳ ⇒ về trang đăng nhập |
| `lib/{scheduler,recurrence,report,time}.ts`, `features/tasks/taskLogic.ts` | Logic thuần giữ nguyên từ bản gốc |

## 5. Xác thực & phân quyền

- Ba vai trò: `director` và `secretary` **quyền ngang nhau** trên dữ liệu làm việc; `admin` (quản trị viên) cũng mở được toàn bộ dữ liệu
  nhưng **không nhận nhắc việc** và không xuất hiện ở ô chọn người thực hiện/theo dõi. Không có tự đăng ký.
- Quản lý tài khoản (`Api/UsersController`): `admin` tạo/đặt mật khẩu mọi tài khoản; `director` làm được với `director`/`secretary` nhưng
  **không** với `admin`. Cookie mang claim `sv` (= `profiles.session_version`); đặt/đổi mật khẩu tăng nó ⇒ cookie cũ bị loại ≤ 30 s
  (xem `AuthService.GetSessionAsync`).
- Cookie `sora.auth`: `HttpOnly`, `SameSite=Lax`, `Secure` khi request là HTTPS, trượt 7 ngày. Mật khẩu băm bằng
  `Microsoft.AspNetCore.Identity.PasswordHasher` (PBKDF2-HMAC-SHA512, tự nâng cấp hash).
- Mọi route `/api/*` (trừ `auth/login`, `auth/logout`, `auth/me`, `health`) cần `[Authorize]`. Cookie còn hạn nhưng tài khoản
  bị khóa/xóa ⇒ bị loại trong ≤ 30 s.
- Chống dò mật khẩu: 5 lần sai (cùng email + IP) ⇒ khóa 5 phút (trong bộ nhớ).
- CSRF: `SameSite=Lax` + bắt buộc header tùy biến `X-Requested-With: sora` cho non-GET.
- Thay thế RLS: *"chỉ thành viên đang hoạt động"* = `[Authorize]` + `IsActiveMemberAsync`; *"mỗi người chỉ thấy thông báo của mình"* =
  mọi truy vấn notification lọc `target_profile_id = @me`; *"không xóa"* = không có endpoint DELETE cho các bảng đó.

## 6. Realtime

- Hub `/hubs/workspace` (cookie auth). Server → client: `change {table, action, row}` và `presence string[]`.
- Sự kiện chỉ phát **sau commit**. Thông báo nhắc việc gửi riêng tới `target_profile_id` (`Clients.User(id)`).
- Client mất kết nối: SignalR tự nối lại (0/2/5/10/30 s) rồi `realtime.ts` thử lại mỗi 5 s; khi nối lại `DataProvider` tải lại `bootstrap`.
- **Giả định một instance** (presence và throttle ở bộ nhớ). Nếu scale-out cần backplane (Redis) và lưu throttle ngoài.

## 7. Thời gian

| Nơi | Quy ước |
|---|---|
| DB | `DATETIME(3)` = UTC. Cột `DATE` (`start_date`, `due_date`, `week_start`) = ngày lịch VN, không múi giờ |
| API | Chuỗi ISO-8601 UTC `yyyy-MM-ddTHH:mm:ss.fffZ`; ngày `yyyy-MM-dd` |
| UI | Nhập/hiển thị giờ VN (UTC+7) qua `lib/time.ts` |
| Server logic | `Tx.Now` (UTC, cắt ms). "Tuần" = Thứ 2 → CN theo giờ VN (`NotificationService`, `SeedService`) |

## 8. Hiệu năng (đo từ máy dev tại VN → DB châu Âu, ~150–250 ms/vòng)

- `GET /api/bootstrap` ≈ 1.2 s (6 truy vấn song song). `POST /api/notifications/refresh` ≈ 2 s (nhiều truy vấn tuần tự trong 1 transaction).
- Mỗi request tốn ít nhất 1 vòng mạng tới DB; pool tối đa 10 kết nối (hosting chia sẻ thường giới hạn). Khi host app và DB gần nhau sẽ nhanh hơn nhiều.
