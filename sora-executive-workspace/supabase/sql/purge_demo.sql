-- Xóa toàn bộ DỮ LIỆU MINH HỌA (source = 'demo' hoặc tên bắt đầu bằng [MINH HỌA]). Chạy trong Supabase SQL Editor.
begin;
delete from public.weekly_priorities where task_id in (select id from public.tasks where source = 'demo');
delete from public.calendar_events  where source = 'demo' or task_id in (select id from public.tasks where source = 'demo');
delete from public.tasks  where source = 'demo';
delete from public.goals  where source = 'demo';
delete from public.people where full_name like '[MINH HỌA]%' and not exists (select 1 from public.tasks t where t.assignee_person_id = people.id);
commit;
