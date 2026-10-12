-- Dấu vết người tạo/sửa, chống ghi đè đồng thời (version), audit log, RLS, realtime.

-- ---------------------------------------------------------------
-- Thành viên hợp lệ = có profile active (director hoặc secretary)
-- ---------------------------------------------------------------
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active);
$$;

-- ---------------------------------------------------------------
-- created_by / updated_by / version cho bảng nghiệp vụ chính
-- Client gửi lại đúng version đang có; nếu người kia đã sửa trước → lỗi PT409.
-- ---------------------------------------------------------------
create or replace function public.tg_stamp_versioned()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.version    := 1;
  else
    if new.version is distinct from old.version then
      raise exception 'version_conflict'
        using errcode = 'PT409',
              detail  = format('Bản ghi đã được cập nhật lên phiên bản %s bởi người khác.', old.version),
              hint    = 'Tải lại dữ liệu mới nhất rồi thực hiện lại thay đổi.';
    end if;
    new.version    := old.version + 1;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

create trigger people_stamp          before insert or update on public.people          for each row execute function public.tg_stamp_versioned();
create trigger goals_stamp           before insert or update on public.goals           for each row execute function public.tg_stamp_versioned();
create trigger tasks_stamp           before insert or update on public.tasks           for each row execute function public.tg_stamp_versioned();
create trigger calendar_events_stamp before insert or update on public.calendar_events for each row execute function public.tg_stamp_versioned();

-- completed_at theo trạng thái
create or replace function public.tg_tasks_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' or new.completed_at is null then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_completion before insert or update on public.tasks for each row execute function public.tg_tasks_completion();

-- created_by cho bảng phụ
create or replace function public.tg_stamp_created_by()
returns trigger
language plpgsql
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;
create trigger task_links_stamp            before insert on public.task_links            for each row execute function public.tg_stamp_created_by();
create trigger recurrence_exceptions_stamp before insert on public.recurrence_exceptions for each row execute function public.tg_stamp_created_by();

create or replace function public.tg_weekly_priorities_stamp()
returns trigger
language plpgsql
as $$
begin
  new.chosen_by := coalesce(auth.uid(), new.chosen_by);
  return new;
end;
$$;
create trigger weekly_priorities_stamp before insert or update on public.weekly_priorities for each row execute function public.tg_weekly_priorities_stamp();

-- Log nhắc việc: tác giả = người đăng nhập; nếu có ngày hẹn tiếp thì cập nhật luôn task
create or replace function public.tg_task_updates_before()
returns trigger
language plpgsql
as $$
begin
  new.author_id  := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  return new;
end;
$$;
create trigger task_updates_before before insert on public.task_updates for each row execute function public.tg_task_updates_before();

create or replace function public.tg_task_updates_after()
returns trigger
language plpgsql
as $$
begin
  if new.next_follow_up_at is not null then
    update public.tasks
       set next_follow_up_at = new.next_follow_up_at
     where id = new.task_id
       and next_follow_up_at is distinct from new.next_follow_up_at;
  end if;
  return null;
end;
$$;
create trigger task_updates_after after insert on public.task_updates for each row execute function public.tg_task_updates_after();

create or replace function public.tg_settings_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger settings_stamp before insert or update on public.settings for each row execute function public.tg_settings_stamp();

create or replace function public.tg_profiles_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.tg_profiles_touch();

-- ---------------------------------------------------------------
-- Audit log: giá trị cũ/mới, người, thời điểm. Không xóa được qua API.
-- ---------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  rec  jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  rid  uuid;
begin
  if rec ? 'id' and (rec->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    rid := (rec->>'id')::uuid;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' - 'version' - 'updated_by'
                        = to_jsonb(old) - 'updated_at' - 'version' - 'updated_by' then
    return null; -- không có thay đổi thực chất
  end if;
  insert into public.audit_logs (table_name, record_id, action, before_data, after_data, actor_id)
  values (tg_table_name, rid, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','people','goals','tasks','task_updates','task_links','calendar_events',
                           'recurrence_exceptions','weekly_priorities','settings']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit()',
                   t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Quyền: không có quyền ẩn danh; mọi bảng bật RLS
-- ---------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.categories from authenticated;
revoke insert, delete on public.notifications from authenticated;
revoke delete on public.tasks, public.goals, public.people, public.task_updates, public.settings from authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles','people','categories','goals','tasks','task_updates','task_links','calendar_events',
                           'recurrence_exceptions','weekly_priorities','notifications','audit_logs','settings']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles: thành viên xem được nhau; mỗi người chỉ sửa hồ sơ của mình (không đổi role)
create policy profiles_select on public.profiles for select to authenticated using (public.is_member());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_member())
  with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy categories_select on public.categories for select to authenticated using (public.is_member());

-- Dữ liệu dùng chung: 2 tài khoản đọc/ghi ngang nhau
do $$
declare t text;
begin
  foreach t in array array['people','goals','tasks','task_updates','task_links','calendar_events',
                           'recurrence_exceptions','weekly_priorities','settings']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_member())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t || '_update', t);
  end loop;
  foreach t in array array['task_links','calendar_events','recurrence_exceptions','weekly_priorities']
  loop
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_member())', t || '_delete', t);
  end loop;
end $$;

-- Nhắc việc: mỗi người chỉ thấy/đánh dấu thông báo của mình
create policy notifications_select on public.notifications for select to authenticated
  using (target_profile_id = auth.uid() and public.is_member());
create policy notifications_update on public.notifications for update to authenticated
  using (target_profile_id = auth.uid() and public.is_member())
  with check (target_profile_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy audit_logs_select on public.audit_logs for select to authenticated using (public.is_member());

-- ---------------------------------------------------------------
-- Realtime (chỉ chạy khi có publication của Supabase)
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.tasks, public.task_updates, public.task_links, public.people, public.goals,
      public.calendar_events, public.recurrence_exceptions, public.weekly_priorities,
      public.notifications, public.settings;
  end if;
end $$;
