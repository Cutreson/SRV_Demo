-- Kiểm thử nhắc việc: tạo đúng loại, không nhân bản, đổi follow-up thì thông báo cũ được giải quyết.
\set ON_ERROR_STOP on
\set dir '11111111-1111-1111-1111-111111111111'
\set sec '22222222-2222-2222-2222-222222222222'

begin;
set local role authenticated; set local request.jwt.claim.sub = :'dir';
insert into public.tasks (title, due_at, next_action) values ('N-quá hạn', now() - interval '1 hour', 'x');
insert into public.tasks (title, due_at, next_action) values ('N-hạn 2 ngày', now() + interval '2 days', 'x');
insert into public.tasks (title, next_follow_up_at, next_action, task_type, assignee_person_id)
  values ('N-follow', now() - interval '5 minutes', 'x', 'delegated', (select id from public.people limit 1));
insert into public.tasks (title, needs_decision, next_action) values ('N-quyết định', true, 'x');
insert into public.tasks (title, task_type, next_action) values ('N-thiếu người', 'delegated', 'x');
select public.refresh_notifications();
commit;

do $$
declare n int;
begin
  -- mỗi điều kiện tạo cho cả 2 tài khoản
  if (select count(*) from public.notifications n join public.tasks t on t.id = n.entity_id
      where t.title = 'N-quá hạn' and n.kind = 'overdue' and n.resolved_at is null) <> 2 then raise exception 'FAIL N1 overdue'; end if;
  if (select count(*) from public.notifications n join public.tasks t on t.id = n.entity_id
      where t.title = 'N-hạn 2 ngày' and n.kind = 'due_soon_3') <> 2 then raise exception 'FAIL N2 due_soon_3'; end if;
  if (select count(*) from public.notifications n join public.tasks t on t.id = n.entity_id
      where t.title = 'N-follow' and n.kind = 'follow_up_due') <> 2 then raise exception 'FAIL N3 follow'; end if;
  if (select count(*) from public.notifications n join public.tasks t on t.id = n.entity_id
      where t.title = 'N-quyết định' and n.kind = 'decision_needed') <> 2 then raise exception 'FAIL N4 decision'; end if;
  if (select count(*) from public.notifications n join public.tasks t on t.id = n.entity_id
      where t.title = 'N-thiếu người' and n.kind = 'missing_owner') <> 2 then raise exception 'FAIL N5 missing owner'; end if;
  select count(*) into n from public.notifications;
  perform public.refresh_notifications();
  if (select count(*) from public.notifications) <> n then raise exception 'FAIL N6: chạy lại bị nhân bản'; end if;
end $$;

-- Đổi ngày follow-up sang tương lai → thông báo follow-up cũ được giải quyết, không tạo mới
begin;
set local role authenticated; set local request.jwt.claim.sub = :'sec';
update public.tasks set next_follow_up_at = now() + interval '2 days', version = 1 where title = 'N-follow';
select public.refresh_notifications();
commit;
do $$ begin
  if exists (select 1 from public.notifications n join public.tasks t on t.id = n.entity_id
             where t.title = 'N-follow' and n.kind = 'follow_up_due' and n.resolved_at is null) then raise exception 'FAIL N7: thông báo cũ còn mở'; end if;
end $$;

-- Hoàn thành việc quá hạn → hết cảnh báo; đánh dấu đã xem không giải quyết nghĩa vụ
begin;
set local role authenticated; set local request.jwt.claim.sub = :'dir';
update public.notifications set read_at = now() where kind = 'decision_needed';
update public.tasks set status = 'done', completion_result = 'xong', version = 1 where title = 'N-quá hạn';
select public.refresh_notifications();
commit;
do $$ begin
  if exists (select 1 from public.notifications n join public.tasks t on t.id = n.entity_id
             where t.title = 'N-quá hạn' and n.resolved_at is null) then raise exception 'FAIL N8: việc đã xong vẫn cảnh báo'; end if;
  if not exists (select 1 from public.notifications where kind = 'decision_needed' and read_at is not null and resolved_at is null)
    then raise exception 'FAIL N9: đã xem không được xóa nghĩa vụ'; end if;
end $$;

-- Người lạ không gọi được
begin;
set local role authenticated; set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  begin perform public.refresh_notifications(); raise exception 'FAIL N10'; exception when insufficient_privilege then null; end;
end $$;
commit;

-- Mục tiêu chiến lược F không có khung tập trung → strategy_gap; có lịch focus → hết
insert into public.goals (title, category_code) values ('N-mục tiêu F', 'F');
select public.refresh_notifications();
do $$ begin
  if (select count(*) from public.notifications n join public.goals g on g.id = n.entity_id where g.title = 'N-mục tiêu F' and n.resolved_at is null) <> 2
    then raise exception 'FAIL N11 strategy gap'; end if;
end $$;
insert into public.calendar_events (title, start_at, end_at, event_type, category_code)
  values ('Deep work F', now() + interval '1 day', now() + interval '1 day 90 minutes', 'focus', 'F');
select public.refresh_notifications();
do $$ begin
  if exists (select 1 from public.notifications n join public.goals g on g.id = n.entity_id where g.title = 'N-mục tiêu F' and n.resolved_at is null)
    then raise exception 'FAIL N12 strategy gap không tự giải quyết'; end if;
end $$;

select 'ALL NOTIFICATION TESTS PASSED' as result;
