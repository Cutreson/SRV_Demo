# SORA Executive Workspace

Web app điều hành cho **Giám đốc** và **Thư ký** — hai tài khoản quyền ngang nhau, cùng một dữ liệu, đồng bộ thời gian thực, có nhật ký ai sửa gì lúc nào.

Đặc tả gốc: `docs/SORA_Executive_Workspace_Claude_Spec.md`.

## Tiến độ theo milestone

| Milestone | Nội dung | Trạng thái |
|---|---|---|
| M1 | Auth + RLS + CSDL + công việc (bảng/Kanban/ghi nhanh) + realtime + audit + danh bạ | ✅ |
| M2 | Dashboard + theo dõi việc giao + nhắc việc (inbox) | ✅ |
| M3 | Lịch ngày/tuần + lịch lặp + phát hiện trùng + kế hoạch tuần + đề xuất xếp lịch | ✅ |
| M4 | Mục tiêu + báo cáo tuần (CSV, in PDF) + cấu hình + QA + hướng dẫn deploy | ✅ |

## Công nghệ

- React 18 + TypeScript + Vite + Tailwind CSS
- Lịch ngày/tuần là component tự viết (không dùng FullCalendar) để kiểm soát đúng quy tắc T2–T7, 08–17, nghỉ trưa,
  khung dự phòng, khóa lịch cố định và kéo thả có kiểm tra trùng — ít phụ thuộc hơn và đã kiểm thử kéo thả.
- Supabase: PostgreSQL + Auth + Row Level Security + Realtime
- Deploy: Vercel (hoặc bất kỳ host tĩnh nào — app dùng hash router nên không cần cấu hình rewrite)

## Cấu trúc

```
supabase/
  migrations/   schema · trigger (version, created_by/updated_by) · audit · RLS · realtime
  seed.sql      DỮ LIỆU MINH HỌA (18 việc, 3 mục tiêu, 4 người) – gắn nhãn [MINH HỌA], source = 'demo'
  sql/          create_profiles.sql (cấp quyền 2 tài khoản) · purge_demo.sql (xóa dữ liệu minh họa)
src/
  lib/          supabase client · giờ VN · nhãn tiếng Việt · data provider (realtime, presence) · router
  lib/          … · recurrence (RRULE) · scheduler (đề xuất lịch) · report (báo cáo tuần) · settings
  features/     auth · dashboard · calendar · tasks · delegated · inbox · goals · reports · people · audit · settings
  components/   UI dùng chung
tests/
  unit/         test logic: giờ VN, lọc/sắp xếp việc, lịch lặp, thời gian trống, thuật toán đề xuất lịch, báo cáo tuần, CSV
  sql/          test RLS/audit/xung đột trên Postgres cục bộ – chạy bằng `npm run test:sql`
```

## Cài đặt lần đầu

### 1. Tạo project Supabase
1. Vào https://supabase.com → New project (region gần nhất: Singapore).
2. **SQL Editor** → chạy lần lượt các file trong `supabase/migrations/` theo thứ tự tên file.
   (Hoặc dùng Supabase CLI: `supabase link --project-ref <ref>` rồi `supabase db push`.)
3. (Tùy chọn) chạy `supabase/seed.sql` để có dữ liệu minh họa.
4. **Authentication → Providers → Email**: tắt *Allow new users to sign up* (không mở tự đăng ký).

### 2. Tạo 2 tài khoản
1. **Authentication → Users → Add user** → tạo user cho Giám đốc và Thư ký (đặt mật khẩu, tích *Auto Confirm User*).
2. Mở `supabase/sql/create_profiles.sql`, thay 2 email, chạy trong SQL Editor.
   Tài khoản đăng nhập được nhưng **không có profile sẽ không thấy dữ liệu gì** (RLS chặn).

### 3. Chạy local
```bash
cp .env.example .env      # điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY (Project Settings → API)
npm install               # lần đầu sẽ tạo package-lock.json – nên commit file này
npm run dev               # http://localhost:5173
```
Chỉ dùng **anon key** ở frontend. Không bao giờ đặt `service_role` key vào `.env` của app.

### 4. Deploy Vercel
1. Import repo GitHub vào Vercel (Framework: Vite, Build: `npm run build`, Output: `dist`).
2. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Supabase → Authentication → URL Configuration: thêm domain Vercel vào *Site URL*.

## Kiểm thử
```bash
npm test            # unit test logic
npm run typecheck   # kiểm tra kiểu TypeScript
npm run test:sql    # cần Postgres 15/16 cài sẵn (initdb, pg_ctl, psql trong PATH)
```
`test:sql` dựng Postgres tạm, chạy migrations + test: 2 tài khoản đọc/ghi ngang nhau, người lạ & anon bị chặn,
xung đột phiên bản (PT409), không cho Hoàn thành khi thiếu kết quả, audit ghi đúng tác giả, không xóa được audit.

## Quy tắc dữ liệu quan trọng
- **Giờ**: lưu UTC, hiển thị và nhập theo giờ Việt Nam (UTC+7).
- **Chống ghi đè**: mỗi bản ghi có `version`; app gửi lại version đang có, nếu người kia đã sửa trước thì DB từ chối (mã `PT409`) và app yêu cầu tải bản mới.
- **Hoàn thành** bắt buộc có `completion_result` (ràng buộc ở DB, không chỉ ở giao diện).
- **Không xóa** công việc/mục tiêu/người qua app – dùng trạng thái *Đã hủy* / *Ngừng*. Audit log chỉ đọc.
- **Deadline** (hạn kết quả) và **ngày follow-up** (ngày cần đôn đốc) là 2 trường độc lập.

## Sao lưu
- Supabase gói Pro có backup tự động hằng ngày; gói Free nên xuất định kỳ:
  `pg_dump "<connection string>" --schema=public -Fc -f sora_$(date +%F).dump`
  (connection string ở Project Settings → Database).
- Báo cáo tuần (M4) có xuất CSV.

## Nhắc việc
- Hàm `refresh_notifications()` tính lại toàn bộ: quá hạn, follow-up đến hạn, hạn 1/3/7 ngày, chờ quyết định, lịch sắp bắt đầu,
  việc giao chưa có người, việc thiếu hành động tiếp theo, mục tiêu E/F 7 ngày chưa có khung tập trung.
- Chống trùng bằng `dedupe_key` (gắn cả mốc thời gian), nên đổi deadline/follow-up sẽ tự đóng thông báo cũ và tạo thông báo mới.
- Chạy khi mở app, mỗi 5 phút khi app đang mở, sau mỗi thay đổi công việc, và mỗi 15 phút bằng **pg_cron**
  (bật tại Database → Extensions → pg_cron rồi chạy lại migration `…0003_notifications.sql`).
- “Đã xem” chỉ làm mờ; nghĩa vụ chỉ hết khi điều kiện hết (hoàn thành, đổi hạn…). Thông báo trình duyệt chỉ hiện khi app đang mở.

## Cách dùng hằng ngày
| Lúc | Việc | Màn hình |
|---|---|---|
| 08:00 | Xem việc hôm nay, quá hạn, follow-up, chờ quyết định; chốt Top 3 | Tổng quan |
| Khi có phát sinh (Zalo, họp) | Bấm **+ Ghi nhanh** (phím N): tiêu đề + deadline/ngày kiểm tra + giao cho ai | mọi màn hình |
| Giao việc | Tạo việc loại *Giao việc*: kết quả mong đợi, deadline, ngày follow-up | Công việc → + Việc mới |
| Đôn đốc | Thư ký bấm **Ghi nhắc**: kênh, kết quả, ngày hẹn tiếp | Giao việc / Nhắc việc |
| Việc tự làm | Nhập ước tính → **Đề xuất lịch** → chọn khung → Xác nhận | Lịch |
| 16:45 | Đánh dấu kết quả, dời lịch chưa làm, xem việc ngày mai | Tổng quan / Lịch |
| Thứ 7 | Báo cáo tuần (xuất CSV / in PDF), chốt Top 3 tuần sau, đề xuất lịch tuần sau | Báo cáo / Lịch |

## Đề xuất lịch (không dùng AI)
1. Tìm khung trống 15 phút trong T2–T7, 08–12 & 13–17, trừ lịch đã có (kể cả lịch lặp).
2. Giữ tối thiểu 25% (cấu hình 20–35%) mỗi ngày làm dự phòng, trừ khi bật “cho phép dùng dự phòng”.
3. Xếp thứ tự: quá hạn → deadline gần → ưu tiên → việc E/F khi tuần đang thiếu giờ chiến lược (có hiển thị lý do).
4. Chia việc dài thành khung 30–90 phút; E/F ưu tiên buổi sáng và khung ưu tiên của template.
5. Không đè lịch, không vượt giờ, không di chuyển lịch cố định/khóa; chỉ lưu khi bấm **Xác nhận** (kiểm tra trùng lần nữa ngay lúc lưu).
6. Deadline không khả thi → cảnh báo, gợi ý chia nhỏ/đổi hạn/giao bớt; không tự dời deadline.

## Phím tắt
- `N` – ghi nhanh việc mới (ở bất kỳ màn hình nào).
