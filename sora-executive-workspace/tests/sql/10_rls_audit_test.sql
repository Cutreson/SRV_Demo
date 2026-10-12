-- Kiểm thử RLS + audit + version + ràng buộc trên Postgres cục bộ (chạy sau migrations + stub).
\set ON_ERROR_STOP on
\set dir '11111111-1111-1111-1111-111111111111'
\set sec '22222222-2222-2222-2222-222222222222'
\set out '33333333-3333-3333-3333-333333333333'

insert into auth.users values (:'dir','director@test'), (:'sec','secretary@test'), (:'out','stranger@test');
insert into public.profiles (id, display_name, role) values (:'dir','Giám đốc','director'), (:'sec','Thư ký','secretary');

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

-- 1) Giám đốc tạo task → created_by đúng
begin;
set local role authenticated; set local request.jwt.claim.sub = :'dir';
with x as (insert into public.tasks (title, category_code, created_by) values ('Việc test 1','A', :'sec') returning id, created_by, version)
insert into t_ids select 'task1', id from x where created_by = :'dir' and version = 1;
commit;
do $$ begin if (select count(*) from t_ids where k='task1') <> 1 then raise exception 'FAIL 1: created_by phải là người đăng nhập'; end if; end $$;

-- 2) Thư ký thấy task và sửa đúng version → version 2, updated_by = thư ký
begin;
set local role authenticated; set local request.jwt.claim.sub = :'sec';
do $$ declare n int; begin
  update public.tasks set title = 'Việc test 1 (thư ký sửa)', version = 1 where id = (select v from t_ids where k='task1');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 2: thư ký không sửa được'; end if;
end $$;
commit;
do $$ begin
  if not exists (select 1 from public.tasks where version = 2 and updated_by = '22222222-2222-2222-2222-222222222222'
                 and created_by = '11111111-1111-1111-1111-111111111111') then raise exception 'FAIL 2b: version/updated_by sai'; end if;
end $$;

-- 3) Giám đốc sửa bằng version cũ → xung đột PT409
begin;
set local role authenticated; set local request.jwt.claim.sub = :'dir';
do $$ begin
  begin
    update public.tasks set title = 'ghi đè', version = 1 where id = (select v from t_ids where k='task1');
    raise exception 'FAIL 3: không phát hiện xung đột';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
commit;

-- 4) Không cho done nếu thiếu kết quả; có kết quả thì completed_at được set
begin;
set local role authenticated; set local request.jwt.claim.sub = :'sec';
do $$ begin
  begin
    update public.tasks set status = 'done', version = 2 where id = (select v from t_ids where k='task1');
    raise exception 'FAIL 4: cho done khi thiếu kết quả';
  exception when check_violation then null;
  end;
  update public.tasks set status = 'done', completion_result = 'Đã xong', version = 2 where id = (select v from t_ids where k='task1');
  if (select completed_at from public.tasks where id = (select v from t_ids where k='task1')) is null then raise exception 'FAIL 4b: completed_at'; end if;
  update public.tasks set status = 'doing', version = 3 where id = (select v from t_ids where k='task1');
  if (select completed_at from public.tasks where id = (select v from t_ids where k='task1')) is not null then raise exception 'FAIL 4c: completed_at phải xóa'; end if;
end $$;
commit;

-- 5) Hai người thực hiện cùng lúc bị chặn
begin;
set local role authenticated; set local request.jwt.claim.sub = :'dir';
do $$ declare pid uuid; begin
  insert into public.people (full_name) values ('Người ngoài') returning id into pid;
  begin
    insert into public.tasks (title, assignee_person_id, assignee_profile_id) values ('x', pid, '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL 5: cho phép 2 assignee';
  exception when check_violation then null;
  end;
  insert into public.tasks (title, task_type, assignee_person_id, due_at, next_follow_up_at)
    values ('Việc giao', 'delegated', pid, now() + interval '3 days', now() + interval '1 day');
end $$;
commit;

-- 6) Log nhắc việc có ngày hẹn tiếp → cập nhật next_follow_up_at của task, author = người đăng nhập
begin;
set local role authenticated; set local request.jwt.claim.sub = :'sec';
do $$ declare tid uuid; ts timestamptz := date_trunc('minute', now() + interval '5 days'); begin
  select id into tid from public.tasks where title = 'Việc giao';
  insert into public.task_updates (task_id, note, channel, next_follow_up_at) values (tid, 'Đã nhắc qua Zalo', 'zalo', ts);
  if (select next_follow_up_at from public.tasks where id = tid) <> ts then raise exception 'FAIL 6: follow-up không cập nhật'; end if;
  if (select author_id from public.task_updates where task_id = tid) <> '22222222-2222-2222-2222-222222222222' then raise exception 'FAIL 6b: author'; end if;
end $$;
commit;

-- 7) Người đăng nhập nhưng không có profile: không thấy, không ghi được
begin;
set local role authenticated; set local request.jwt.claim.sub = :'out';
do $$ begin
  if (select count(*) from public.tasks) <> 0 then raise exception 'FAIL 7: người ngoài thấy task'; end if;
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'FAIL 7b: người ngoài thấy audit'; end if;
  begin
    insert into public.tasks (title) values ('hack');
    raise exception 'FAIL 7c: người ngoài ghi được';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- 8) anon bị chặn hoàn toàn
begin;
set local role anon;
do $$ begin
  begin
    perform 1 from public.tasks limit 1;
    raise exception 'FAIL 8: anon đọc được';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- 9) Không ghi/xóa audit, không xóa task qua API
begin;
set local role authenticated; set local request.jwt.claim.sub = :'dir';
do $$ begin
  begin delete from public.audit_logs; raise exception 'FAIL 9: xóa được audit'; exception when insufficient_privilege then null; end;
  begin insert into public.audit_logs (table_name, action) values ('x','INSERT'); raise exception 'FAIL 9b'; exception when insufficient_privilege then null; end;
  begin delete from public.tasks; raise exception 'FAIL 9c: xóa được task'; exception when insufficient_privilege then null; end;
  begin update public.profiles set role = 'director' where id = auth.uid(); raise exception 'FAIL 9d: tự đổi role'; exception when insufficient_privilege then null; end;
end $$;
commit;

-- 10) Audit ghi đúng tác giả, đúng giá trị cũ/mới
do $$ declare tid uuid := (select v from t_ids where k='task1'); begin
  if not exists (select 1 from public.audit_logs where record_id = tid and action = 'INSERT' and actor_id = '11111111-1111-1111-1111-111111111111')
    then raise exception 'FAIL 10: audit INSERT'; end if;
  if not exists (select 1 from public.audit_logs where record_id = tid and action = 'UPDATE' and actor_id = '22222222-2222-2222-2222-222222222222'
                 and before_data->>'title' = 'Việc test 1' and after_data->>'title' = 'Việc test 1 (thư ký sửa)')
    then raise exception 'FAIL 10b: audit UPDATE'; end if;
  if exists (select 1 from public.audit_logs where record_id = tid and after_data->>'title' = 'ghi đè')
    then raise exception 'FAIL 10c: audit ghi bản bị từ chối'; end if;
end $$;

-- 11) Thông báo: mỗi người chỉ thấy của mình, chỉ được sửa read_at
insert into public.notifications (target_profile_id, kind, entity_type, entity_id, dedupe_key)
  values (:'dir','overdue','task',(select v from t_ids where k='task1'),'t1'), (:'sec','overdue','task',(select v from t_ids where k='task1'),'t2');
begin;
set local role authenticated; set local request.jwt.claim.sub = :'sec';
do $$ begin
  if (select count(*) from public.notifications) <> 1 then raise exception 'FAIL 11: thấy thông báo người khác'; end if;
  update public.notifications set read_at = now();
  begin update public.notifications set kind = 'due_soon_1'; raise exception 'FAIL 11b'; exception when insufficient_privilege then null; end;
end $$;
commit;

select 'ALL RLS/AUDIT TESTS PASSED' as result;
