-- SORA Executive Workspace — schema V1
-- Mọi thời điểm lưu UTC (timestamptz); giao diện hiển thị Asia/Ho_Chi_Minh.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Người dùng hệ thống (2 tài khoản quyền ngang nhau)
-- ---------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role         text not null check (role in ('director','secretary')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Danh bạ người được giao việc (không có tài khoản)
create table public.people (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null check (length(trim(full_name)) > 0),
  department   text,
  position     text,
  contact_note text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  updated_by   uuid references public.profiles(id),
  version      int not null default 1
);

create table public.categories (
  code  char(1) primary key check (code in ('A','B','C','D','E','F')),
  name  text not null,
  color text not null
);

create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) > 0),
  description   text,
  category_code char(1) references public.categories(code),
  period_type   text not null default 'month' check (period_type in ('quarter','month','week')),
  start_date    date,
  due_date      date,
  progress      numeric(5,2) not null default 0 check (progress between 0 and 100),
  status        text not null default 'active' check (status in ('active','achieved','missed','paused','cancelled')),
  source        text not null default 'user' check (source in ('user','demo')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  version       int not null default 1
);

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (length(trim(title)) > 0),
  description         text,
  category_code       char(1) references public.categories(code),
  task_type           text not null default 'self' check (task_type in ('self','delegated')),
  priority            text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  status              text not null default 'todo' check (status in ('todo','doing','waiting','paused','done','cancelled')),
  needs_decision      boolean not null default false,
  due_at              timestamptz,
  next_follow_up_at   timestamptz,
  estimated_minutes   int check (estimated_minutes is null or estimated_minutes between 5 and 6000),
  next_action         text,
  expected_result     text,
  completion_result   text,
  completed_at        timestamptz,
  assignee_profile_id uuid references public.profiles(id),
  assignee_person_id  uuid references public.people(id),
  watcher_profile_id  uuid references public.profiles(id),
  goal_id             uuid references public.goals(id) on delete set null,
  source              text not null default 'user' check (source in ('user','quick_capture','demo')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_by          uuid references public.profiles(id),
  version             int not null default 1,
  -- chỉ một trong hai người thực hiện; được phép chưa gán khi nhập nhanh
  constraint tasks_one_assignee check (num_nonnulls(assignee_profile_id, assignee_person_id) <= 1),
  -- không cho done nếu chưa ghi kết quả
  constraint tasks_done_requires_result check (status <> 'done' or length(trim(coalesce(completion_result,''))) > 0)
);

create table public.task_updates (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks(id) on delete cascade,
  note              text not null check (length(trim(note)) > 0),
  progress_percent  int check (progress_percent between 0 and 100),
  channel           text check (channel in ('zalo','phone','email','in_person','other')),
  next_follow_up_at timestamptz,
  author_id         uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

create table public.task_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  label      text,
  url        text not null check (url ~* '^https?://'),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table public.calendar_events (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (length(trim(title)) > 0),
  start_at             timestamptz not null,
  end_at               timestamptz not null,
  event_type           text not null default 'flexible' check (event_type in ('fixed','focus','flexible','urgent','buffer')),
  category_code        char(1) references public.categories(code),
  task_id              uuid references public.tasks(id) on delete set null,
  locked               boolean not null default false,
  recurrence_rule      text,
  recurrence_parent_id uuid references public.calendar_events(id) on delete cascade,
  timezone             text not null default 'Asia/Ho_Chi_Minh',
  status               text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled','done')),
  notes                text,
  source               text not null default 'user' check (source in ('user','scheduler','demo')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.profiles(id),
  updated_by           uuid references public.profiles(id),
  version              int not null default 1,
  constraint calendar_events_time check (end_at > start_at)
);

create table public.recurrence_exceptions (
  id                   uuid primary key default gen_random_uuid(),
  parent_event_id      uuid not null references public.calendar_events(id) on delete cascade,
  occurrence_start_at  timestamptz not null,
  action               text not null check (action in ('skip','replace')),
  replacement_event_id uuid references public.calendar_events(id) on delete set null,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.profiles(id),
  unique (parent_event_id, occurrence_start_at)
);

create table public.weekly_priorities (
  id         uuid primary key default gen_random_uuid(),
  week_start date not null,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  rank       int not null check (rank between 1 and 3),
  chosen_by  uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (week_start, rank),
  unique (week_start, task_id)
);

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  kind              text not null check (kind in ('overdue','follow_up_due','due_soon_1','due_soon_3','due_soon_7',
                                                  'decision_needed','event_starting','missing_owner','missing_next_action',
                                                  'strategy_gap')),
  entity_type       text not null check (entity_type in ('task','calendar_event','goal')),
  entity_id         uuid not null,
  scheduled_at      timestamptz not null default now(),
  read_at           timestamptz,
  resolved_at       timestamptz,
  dedupe_key        text not null unique,
  created_at        timestamptz not null default now()
);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data  jsonb,
  actor_id    uuid,
  created_at  timestamptz not null default now()
);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

-- ---------------------------------------------------------------
-- Index bắt buộc
-- ---------------------------------------------------------------
create index tasks_status_due_idx      on public.tasks (status, due_at);
create index tasks_follow_up_idx       on public.tasks (next_follow_up_at);
create index tasks_category_idx        on public.tasks (category_code);
create index tasks_goal_idx            on public.tasks (goal_id);
create index calendar_events_range_idx on public.calendar_events (start_at, end_at);
create index task_updates_task_idx     on public.task_updates (task_id, created_at);
create index notifications_target_idx  on public.notifications (target_profile_id, read_at);
create index audit_logs_record_idx     on public.audit_logs (table_name, record_id, created_at desc);
create index audit_logs_created_idx    on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------
-- Dữ liệu danh mục & cấu hình mặc định (không phải dữ liệu minh họa)
-- ---------------------------------------------------------------
insert into public.categories (code, name, color) values
  ('A','Điều hành định kỳ','#2563EB'),
  ('B','Quản lý dự án','#EA580C'),
  ('C','Quản lý nhân sự','#7C3AED'),
  ('D','Khách hàng & kinh doanh','#059669'),
  ('E','Xây dựng hệ thống','#0891B2'),
  ('F','Chiến lược & phát triển','#BE123C');

insert into public.settings (key, value) values
  ('working_days',      '[1,2,3,4,5,6]'::jsonb),                              -- ISO: 1=Thứ 2 … 6=Thứ 7
  ('working_hours',     '[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}]'::jsonb),
  ('buffer_percent',    '25'::jsonb),                                         -- cho phép 20–35
  ('due_soon_days',     '[1,3,7]'::jsonb),
  ('event_lead_minutes','15'::jsonb),
  ('max_block_minutes', '90'::jsonb),
  ('strategy_gap_days', '7'::jsonb),
  ('daily_template', '{
    "1":[["08:15","09:00","review"],["09:00","10:30","A"],["10:30","12:00","B"],["13:00","14:30","decide"],["14:30","16:45","buffer"]],
    "2":[["08:15","09:00","followup"],["09:00","10:30","E"],["10:30","12:00","E"],["13:00","14:30","C"],["14:30","16:45","buffer"]],
    "3":[["08:15","09:00","followup"],["09:00","10:30","D"],["10:30","12:00","D"],["13:00","14:30","B"],["14:30","16:45","buffer"]],
    "4":[["08:15","09:00","followup"],["09:00","10:30","F"],["10:30","12:00","F"],["13:00","14:30","F"],["14:30","16:45","buffer"]],
    "5":[["08:15","09:00","B"],["09:00","10:30","C"],["10:30","12:00","decide"],["13:00","14:30","due"],["14:30","16:45","buffer"]],
    "6":[["08:15","09:00","review"],["09:00","10:30","EF"],["10:30","12:00","backlog"],["13:00","14:30","plan"],["14:30","16:45","buffer"]]
  }'::jsonb);
