-- DỮ LIỆU MINH HỌA — chỉ để thử app. Mọi bản ghi có source = 'demo' và tiêu đề bắt đầu bằng [MINH HỌA].
-- Xóa toàn bộ dữ liệu minh họa: chạy supabase/sql/purge_demo.sql trong SQL Editor.
-- Thời gian tính tương đối theo ngày hiện tại (Asia/Ho_Chi_Minh) để dashboard có nội dung.

do $$
declare
  d0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh')) at time zone 'Asia/Ho_Chi_Minh'; -- 00:00 hôm nay giờ VN
  p_ql uuid; p_kt uuid; p_kd uuid; p_ns uuid;
  g_kpi uuid; g_day uuid; g_tt uuid;
begin
  if exists (select 1 from public.tasks where source = 'demo') then
    raise notice 'Dữ liệu minh họa đã có, bỏ qua.';
    return;
  end if;

  insert into public.people (full_name, department, position, contact_note)
    values ('[MINH HỌA] Trưởng phòng Kỹ thuật', 'Kỹ thuật', 'Trưởng phòng', 'Zalo')
    returning id into p_kt;
  insert into public.people (full_name, department, position, contact_note)
    values ('[MINH HỌA] Trưởng phòng Kinh doanh', 'Kinh doanh', 'Trưởng phòng', 'Zalo / điện thoại')
    returning id into p_kd;
  insert into public.people (full_name, department, position, contact_note)
    values ('[MINH HỌA] PM dự án Setup', 'Dự án', 'PM', 'Zalo')
    returning id into p_ql;
  insert into public.people (full_name, department, position, contact_note)
    values ('[MINH HỌA] Phụ trách Nhân sự', 'HCNS', 'Trưởng bộ phận', 'Email')
    returning id into p_ns;

  insert into public.goals (title, description, category_code, period_type, start_date, due_date, progress, source)
    values ('[MINH HỌA] Ban hành bộ KPI cấp phòng', 'Đầu ra: bộ KPI 5 phòng được duyệt và áp dụng tháng tới', 'E', 'quarter',
            (d0)::date, (d0 + interval '75 days')::date, 20, 'demo')
    returning id into g_kpi;
  insert into public.goals (title, description, category_code, period_type, start_date, due_date, progress, source)
    values ('[MINH HỌA] Phương án dây chuyền dây tự động', 'Đầu ra: concept + kế hoạch đầu tư được duyệt', 'F', 'quarter',
            (d0)::date, (d0 + interval '80 days')::date, 10, 'demo')
    returning id into g_day;
  insert into public.goals (title, description, category_code, period_type, start_date, due_date, progress, source)
    values ('[MINH HỌA] Mở 2 khách hàng mới khu vực phía Bắc', 'Đầu ra: 2 PO đầu tiên', 'F', 'month',
            (d0)::date, (d0 + interval '28 days')::date, 0, 'demo')
    returning id into g_tt;

  insert into public.tasks (title, category_code, task_type, priority, status, needs_decision, due_at, next_follow_up_at,
                            estimated_minutes, next_action, expected_result, assignee_person_id, goal_id, source, completion_result)
  values
   ('[MINH HỌA] Họp giao ban phòng ban đầu tuần', 'A', 'self', 'normal', 'todo', false, d0 + interval '10 hours', null, 60, 'Chuẩn bị danh sách tồn tuần trước', 'Chốt 5 việc ưu tiên tuần', null, null, 'demo', null),
   ('[MINH HỌA] Duyệt báo cáo tuần các phòng', 'A', 'self', 'normal', 'todo', false, d0 + interval '2 days 16 hours', null, 45, 'Đọc báo cáo 5 phòng', 'Phản hồi từng phòng', null, null, 'demo', null),
   ('[MINH HỌA] Xử lý chậm tiến độ dự án Setup', 'B', 'delegated', 'urgent', 'doing', false, d0 - interval '1 day' + interval '17 hours', d0 + interval '9 hours', null, 'Gọi PM xác nhận phương án bù tiến độ', 'Kế hoạch bù tiến độ có mốc', p_ql, null, 'demo', null),
   ('[MINH HỌA] Quyết định phương án xử lý lỗi chất lượng', 'B', 'self', 'high', 'todo', true, d0 + interval '1 day 15 hours', null, 60, 'Xem báo cáo 8D', 'Quyết định phương án và người chịu trách nhiệm', null, null, 'demo', null),
   ('[MINH HỌA] Báo cáo nguyên nhân dừng máy', 'B', 'delegated', 'high', 'waiting', false, d0 + interval '3 days 17 hours', d0 + interval '1 day 9 hours', null, 'Chờ báo cáo từ kỹ thuật', 'Báo cáo nguyên nhân gốc + biện pháp', p_kt, null, 'demo', null),
   ('[MINH HỌA] Đánh giá năng lực trưởng phòng Kỹ thuật', 'C', 'self', 'normal', 'todo', false, d0 + interval '6 days 17 hours', null, 90, 'Lấy dữ liệu KPI quý', 'Biên bản đánh giá', null, null, 'demo', null),
   ('[MINH HỌA] Đề xuất bổ sung nhân sự lắp ráp', 'C', 'delegated', 'normal', 'todo', true, d0 + interval '5 days 17 hours', d0 + interval '2 days 9 hours', null, 'HCNS gửi đề xuất định biên', 'Đề xuất số lượng + chi phí', p_ns, null, 'demo', null),
   ('[MINH HỌA] Gặp khách hàng mới tại Bắc Ninh', 'D', 'self', 'high', 'todo', false, d0 + interval '2 days 14 hours', null, 120, 'Chuẩn bị hồ sơ năng lực', 'Nắm nhu cầu và hẹn khảo sát', null, g_tt, 'demo', null),
   ('[MINH HỌA] Theo dõi báo giá gửi khách hàng', 'D', 'delegated', 'high', 'doing', false, d0 + interval '4 days 17 hours', d0 - interval '1 day' + interval '9 hours', null, 'Nhắc trưởng phòng KD gọi khách', 'Phản hồi của khách về giá', p_kd, g_tt, 'demo', null),
   ('[MINH HỌA] Danh sách khách hàng tiềm năng phía Bắc', 'D', 'delegated', 'normal', 'todo', false, d0 + interval '9 days 17 hours', d0 + interval '3 days 9 hours', null, 'Lọc từ danh sách triển lãm', 'Danh sách 20 khách có người liên hệ', p_kd, g_tt, 'demo', null),
   ('[MINH HỌA] Viết khung KPI phòng Kinh doanh', 'E', 'self', 'high', 'todo', false, d0 + interval '6 days 17 hours', null, 180, 'Liệt kê chỉ tiêu hiện có', 'Bản nháp KPI phòng KD', null, g_kpi, 'demo', null),
   ('[MINH HỌA] Quy trình SRV – rà soát bước duyệt', 'E', 'self', 'normal', 'todo', false, d0 + interval '12 days 17 hours', null, 120, 'Vẽ lưu đồ hiện tại', 'Lưu đồ quy trình mới', null, g_kpi, 'demo', null),
   ('[MINH HỌA] Concept dây chuyền dây tự động', 'F', 'self', 'high', 'todo', false, d0 + interval '13 days 17 hours', null, 240, 'Tổng hợp yêu cầu khách hàng', 'Concept 2 phương án', null, g_day, 'demo', null),
   ('[MINH HỌA] Khảo sát công nghệ ép đầu cos', 'F', 'delegated', 'normal', 'todo', false, d0 + interval '10 days 17 hours', d0 + interval '4 days 9 hours', null, 'Kỹ thuật liên hệ 3 nhà cung cấp', 'Bảng so sánh công nghệ', p_kt, g_day, 'demo', null),
   ('[MINH HỌA] Ký hợp đồng khung nhà cung cấp', 'D', 'self', 'normal', 'todo', true, null, null, 30, null, null, null, null, 'demo', null),
   ('[MINH HỌA] Ghi nhanh: gọi lại anh A về lịch khảo sát', null, 'self', 'normal', 'todo', false, null, d0 + interval '1 day 10 hours', null, null, null, null, null, 'demo', null),
   ('[MINH HỌA] Chốt lịch đào tạo an toàn', 'C', 'delegated', 'low', 'done', false, d0 - interval '2 days' + interval '17 hours', null, null, null, 'Lịch đào tạo đã gửi toàn công ty', p_ns, null, 'demo', 'Đã chốt và gửi thông báo'),
   ('[MINH HỌA] Lập kế hoạch tuần tới', 'A', 'self', 'normal', 'todo', false, d0 + interval '5 days 15 hours', null, 60, 'Xem báo cáo tuần', 'Top 3 – 5 kết quả tuần tới', null, null, 'demo', null);

  -- Lịch minh họa (không phải cam kết có cuộc họp thực)
  insert into public.calendar_events (title, start_at, end_at, event_type, category_code, locked, recurrence_rule, source) values
   ('[MINH HỌA] Giao ban đầu tuần (lặp thứ 2)',
     date_trunc('week', d0 at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' + interval '9 hours',
     date_trunc('week', d0 at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' + interval '10 hours 30 minutes',
     'fixed', 'A', true, 'FREQ=WEEKLY;BYDAY=MO', 'demo'),
   ('[MINH HỌA] Rà soát lịch & Top 3', d0 + interval '8 hours', d0 + interval '8 hours 15 minutes', 'fixed', 'A', false, null, 'demo'),
   ('[MINH HỌA] Deep work: khung KPI phòng KD', d0 + interval '1 day 9 hours', d0 + interval '1 day 10 hours 30 minutes', 'focus', 'E', false, null, 'demo'),
   ('[MINH HỌA] Làm việc với trưởng phòng Kỹ thuật', d0 + interval '13 hours 30 minutes', d0 + interval '14 hours 30 minutes', 'flexible', 'C', false, null, 'demo'),
   ('[MINH HỌA] Dự phòng / phát sinh', d0 + interval '14 hours 30 minutes', d0 + interval '16 hours 45 minutes', 'buffer', null, false, null, 'demo');
end $$;
