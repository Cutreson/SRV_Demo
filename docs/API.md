# API (REST + SignalR)

Base: cùng origin, `/api/*`. JSON UTF-8, **snake_case**, thời gian ISO-8601 UTC (`2026-10-12T02:00:00.000Z`), ngày `yyyy-MM-dd`.
Xác thực: cookie `sora.auth` (đặt bởi `POST /api/auth/login`). Mọi `POST/PUT/PATCH/DELETE` phải có header `X-Requested-With: sora`.
Nguồn thật: `SRV_Demo/Api/*.cs` (controller) và `ClientApp/src/lib/api.ts` (client).

## Lỗi

```json
{ "code": "version_conflict", "message": "Người kia vừa cập nhật bản ghi này. …" }
```

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `bad_request` | JSON/tham số sai, thiếu `version` khi sửa bản ghi có phiên bản |
| 401 | `unauthorized` | Chưa đăng nhập / sai mật khẩu / cookie hết hạn / tài khoản bị khóa |
| 403 | `forbidden` | Thiếu `X-Requested-With`; tài khoản bị khóa lúc đăng nhập |
| 404 | `not_found` | Không có bản ghi / khóa cấu hình |
| 409 | `version_conflict` | `version` gửi lên khác bản hiện tại |
| 409 | `duplicate`, `in_use` | Trùng khóa duy nhất; còn tham chiếu |
| 422 | `validation` (và mã con) | Sai kiểu/khoảng/enum; mã con: `tasks_done_requires_result`, `tasks_one_assignee`, `url_invalid`, `event_time_invalid`, `wrong_password`, `weak_password`, `bad_reference` |
| 400 | `use_change_password` | Dùng `PUT /users/{id}/password` cho chính mình (phải dùng `POST /auth/password`) |
| 429 | `too_many_requests` | 5 lần đăng nhập sai |
| 500 | `server_error` | Lỗi không dự kiến (chi tiết ở log server) |

## Xác thực & tài khoản

| Method | Path | Body | Trả về |
|---|---|---|---|
| POST | `/api/auth/login` | `{email,password}` | `{id,display_name,role,active}` + đặt cookie |
| POST | `/api/auth/logout` | `{}` | 204 |
| GET | `/api/auth/me` | — | profile, hoặc **204** nếu chưa đăng nhập |
| POST | `/api/auth/password` | `{current_password,new_password(8–128)}` | 204; các phiên khác của tài khoản bị đăng xuất, phiên này giữ nguyên |
| PATCH | `/api/me` | `{display_name}` | profile (role/active bị bỏ qua) |
| GET | `/api/health` | — | `{status,database,migrations[],utc}` (công khai) |

## Quản lý tài khoản (chỉ `admin` và `director`; vai trò đọc từ DB)

| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/api/users` | — | `[{id,email,display_name,role,active,last_login_at,created_at}]` (admin → director → secretary). Không có hash/phiên bản phiên |
| POST | `/api/users` | `{email,display_name,role: admin\|director\|secretary,password(≥8)}` | Email chuẩn hóa chữ thường; trùng ⇒ 409 `duplicate`. **Director không tạo được `admin`** (403) |
| PUT | `/api/users/{id}/password` | `{new_password}` | 204. Đăng xuất tài khoản đó ở mọi nơi. **Director không đặt được mật khẩu của `admin`** (403). Chính mình ⇒ 400 `use_change_password` |

`secretary` gọi các route trên ⇒ 403. Audit (bảng `profiles`): tạo tài khoản = `INSERT`; đặt/đổi mật khẩu = `UPDATE` với `after_data.password_changed = true`
(không bao giờ có mật khẩu hay hash).

## Dữ liệu chính

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/bootstrap` | `{profiles,people,categories,goals,tasks(≤5000),notifications(của mình, chưa giải quyết ≤1000)}`; `profiles` gồm cả `admin` (để hiện tên trong nhật ký) — UI lọc ra `staff` cho ô chọn người |
| GET | `/api/tasks/{id}` | |
| POST | `/api/tasks` | body = trường của task (`title` bắt buộc). Trả task đầy đủ |
| PATCH | `/api/tasks/{id}` | các trường đổi + **`version`**. Không đổi gì ⇒ trả bản cũ, không tăng version |
| GET | `/api/tasks/{id}/updates` | log nhắc, mới nhất trước |
| POST | `/api/tasks/{id}/updates` | `{note,channel?,next_follow_up_at?,progress_percent?}`; có `next_follow_up_at` ⇒ cập nhật luôn task |
| GET | `/api/task-updates?task_ids=a,b,c&limit=` | ≤500 id (trang Giao việc) |
| GET | `/api/task-updates?from=&to=` | theo `created_at` (báo cáo tuần) |
| GET / POST | `/api/tasks/{id}/links` | `{url(http/https),label?}` |
| DELETE | `/api/links/{id}` | 204 |
| POST / PATCH | `/api/people`, `/api/people/{id}` | PATCH cần `version` |
| POST / PATCH | `/api/goals`, `/api/goals/{id}` | PATCH cần `version` |
| GET | `/api/settings` | `[{key,value,updated_at,updated_by}]` |
| PUT | `/api/settings/{key}` | `{value}` — kiểm theo khóa (xem DATABASE.md §4) |
| GET | `/api/audit?table=&record_id=&actor_id=&before_id=&limit(≤200)` | mới nhất trước (`id DESC`) |

## Lịch

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/events?from=&to=` | `{single[],recurring[],exceptions[]}`; single: giao khoảng `[from,to)`; recurring: `start_at < to`; exceptions: `occurrence_start_at ∈ [from,to)`. **Client** mở rộng RRULE |
| GET | `/api/events/{id}` | |
| POST | `/api/events` | 1 object hoặc **mảng** (≤200, atomic: 1 phần tử sai ⇒ không lưu gì) |
| PATCH | `/api/events/{id}` | + `version` |
| DELETE | `/api/events/{id}` | xóa luôn ngoại lệ của chuỗi (có audit) |
| POST | `/api/event-exceptions` | `{parent_event_id,occurrence_start_at,action:skip|replace,replacement_event_id?}` |

## Top 3 tuần & nhắc việc

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/weekly-priorities?week_start=yyyy-MM-dd` | sắp theo `rank` |
| PUT | `/api/weekly-priorities/{week_start}/{rank 1..3}` | `{task_id|null}`; nguyên tử: gỡ task khỏi hạng cũ rồi đặt/xóa hạng này; trả danh sách của tuần |
| GET | `/api/notifications` | của tài khoản hiện tại |
| POST | `/api/notifications/refresh` | tính lại cho **mọi** tài khoản → `{created, notifications:[của mình]}` |
| POST | `/api/notifications/read` | `{ids:[…]}` — chỉ đánh dấu của chính mình |

## SignalR `/hubs/workspace`

Cần cookie đăng nhập. Server → client (client không gửi gì):

| Sự kiện | Payload |
|---|---|
| `change` | `{ table, action: "INSERT"|"UPDATE"|"DELETE", row }` — `row` là dòng đầy đủ (DELETE: dòng trước khi xóa). `notifications` chỉ gửi cho chủ sở hữu |
| `presence` | `string[]` tên hiển thị đang kết nối |

Bảng có phát: `profiles, people, goals, tasks, task_updates, task_links, calendar_events, recurrence_exceptions, weekly_priorities, settings, notifications`.
