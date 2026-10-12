-- Nhắc việc: tính lại toàn bộ thông báo cần có, tạo thông báo mới (chống trùng bằng dedupe_key)
-- và đánh dấu "đã giải quyết" (resolved_at) những thông báo không còn đúng (VD đã đổi ngày follow-up).
-- Chạy định kỳ 15 phút (pg_cron) và khi người dùng mở app (RPC).

create index if not exists notifications_open_idx on public.notifications (target_profile_id) where resolved_at is null;

create or replace function public.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.settings where key = p_key), p_default);
$$;

create or replace function public.refresh_notifications()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_now      timestamptz := now();
  v_lead     int := public.setting_int('event_lead_minutes', 15);
  v_gap_days int := public.setting_int('strategy_gap_days', 7);
  v_week     date := (date_trunc('week', (v_now at time zone 'Asia/Ho_Chi_Minh')))::date;
  v_new      int;
begin
  -- Chỉ thành viên (hoặc job hệ thống không có auth.uid()) được chạy
  if auth.uid() is not null and not public.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  create temp table if not exists _want (
    kind text, entity_type text, entity_id uuid, dedupe text, scheduled_at timestamptz
  ) on commit drop;
  truncate _want;

  -- Công việc đang mở
  insert into _want
  select k.kind, 'task', t.id, k.kind || ':' || t.id || ':' || coalesce(extract(epoch from k.at)::bigint::text, '-'), coalesce(k.at, v_now)
  from public.tasks t
  cross join lateral (values
    ('overdue',         case when t.due_at < v_now then t.due_at end),
    ('follow_up_due',   case when t.next_follow_up_at <= v_now then t.next_follow_up_at end),
    ('due_soon_1',      case when t.due_at >= v_now and t.due_at < v_now + interval '1 day' then t.due_at end),
    ('due_soon_3',      case when t.due_at >= v_now + interval '1 day' and t.due_at < v_now + interval '3 days' then t.due_at end),
    ('due_soon_7',      case when t.due_at >= v_now + interval '3 days' and t.due_at < v_now + interval '7 days' then t.due_at end),
    ('decision_needed', case when t.needs_decision then t.created_at end),
    ('missing_owner',   case when t.task_type = 'delegated' and t.assignee_person_id is null and t.assignee_profile_id is null then t.created_at end),
    ('missing_next_action', case when coalesce(trim(t.next_action), '') = '' and t.created_at < v_now - interval '1 day' then t.created_at end)
  ) as k(kind, at)
  where t.status in ('todo','doing','waiting','paused') and k.at is not null;

  -- Lịch sắp bắt đầu
  insert into _want
  select 'event_starting', 'calendar_event', e.id, 'event_starting:' || e.id || ':' || extract(epoch from e.start_at)::bigint, e.start_at
  from public.calendar_events e
  where e.status = 'confirmed' and e.recurrence_rule is null
    and e.start_at > v_now and e.start_at <= v_now + make_interval(mins => v_lead);

  -- Mục tiêu chiến lược E/F không có khung tập trung trong 7 ngày (đã qua + sắp tới)
  insert into _want
  select 'strategy_gap', 'goal', g.id, 'strategy_gap:' || g.id || ':' || v_week, v_now
  from public.goals g
  where g.status = 'active' and g.category_code in ('E','F')
    and not exists (
      select 1 from public.calendar_events e
      left join public.tasks t on t.id = e.task_id
      where e.status in ('confirmed','done') and e.event_type in ('focus','fixed','flexible')
        and e.start_at >= v_now - make_interval(days => v_gap_days) and e.start_at < v_now + make_interval(days => v_gap_days)
        and (t.goal_id = g.id or (e.task_id is null and e.category_code = g.category_code) or (t.goal_id is null and t.category_code = g.category_code))
    );

  -- Tạo cho mọi tài khoản đang hoạt động (2 người cùng điều hành)
  insert into public.notifications (target_profile_id, kind, entity_type, entity_id, scheduled_at, dedupe_key)
  select p.id, w.kind, w.entity_type, w.entity_id, w.scheduled_at, w.dedupe || ':' || p.id
  from _want w cross join public.profiles p
  where p.active
  on conflict (dedupe_key) do nothing;
  get diagnostics v_new = row_count;

  -- Thông báo không còn đúng → đã giải quyết (không xóa)
  update public.notifications n set resolved_at = v_now
  where n.resolved_at is null
    and not exists (select 1 from _want w where w.dedupe || ':' || n.target_profile_id = n.dedupe_key);

  return v_new;
end;
$$;

revoke all on function public.refresh_notifications() from public, anon;
grant execute on function public.refresh_notifications() to authenticated;

-- Lịch chạy 15 phút/lần nếu project đã bật pg_cron (Database → Extensions → pg_cron)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule(jobid) from cron.job where jobname = 'sora_refresh_notifications';
      perform cron.schedule('sora_refresh_notifications', '*/15 * * * *', 'select public.refresh_notifications()');
    exception when others then
      raise notice 'Không bật được pg_cron (%). App vẫn tự làm mới nhắc việc khi mở.', sqlerrm;
    end;
  end if;
end $$;
