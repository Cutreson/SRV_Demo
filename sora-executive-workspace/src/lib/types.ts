export type CategoryCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type TaskType = 'self' | 'delegated';
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'paused' | 'done' | 'cancelled';
export type Role = 'director' | 'secretary';
export type Channel = 'zalo' | 'phone' | 'email' | 'in_person' | 'other';

export interface Profile {
  id: string;
  display_name: string;
  role: Role;
  active: boolean;
}

export interface Person {
  id: string;
  full_name: string;
  department: string | null;
  position: string | null;
  contact_note: string | null;
  active: boolean;
  version: number;
  updated_at: string;
}

export interface Category {
  code: CategoryCode;
  name: string;
  color: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  category_code: CategoryCode | null;
  period_type: 'quarter' | 'month' | 'week';
  start_date: string | null;
  due_date: string | null;
  progress: number;
  status: 'active' | 'achieved' | 'missed' | 'paused' | 'cancelled';
  source: 'user' | 'demo';
  version: number;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category_code: CategoryCode | null;
  task_type: TaskType;
  priority: Priority;
  status: TaskStatus;
  needs_decision: boolean;
  due_at: string | null;
  next_follow_up_at: string | null;
  estimated_minutes: number | null;
  next_action: string | null;
  expected_result: string | null;
  completion_result: string | null;
  completed_at: string | null;
  assignee_profile_id: string | null;
  assignee_person_id: string | null;
  watcher_profile_id: string | null;
  goal_id: string | null;
  source: 'user' | 'quick_capture' | 'demo';
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  version: number;
}

export type TaskDraft = Partial<Omit<Task, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by' | 'version' | 'completed_at'>>;

export interface TaskUpdate {
  id: string;
  task_id: string;
  note: string;
  progress_percent: number | null;
  channel: Channel | null;
  next_follow_up_at: string | null;
  author_id: string | null;
  created_at: string;
}

export interface TaskLink {
  id: string;
  task_id: string;
  label: string | null;
  url: string;
}

export interface AuditLog {
  id: number;
  table_name: string;
  record_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
}

export type NotificationKind = 'overdue' | 'follow_up_due' | 'due_soon_1' | 'due_soon_3' | 'due_soon_7' | 'decision_needed'
  | 'event_starting' | 'missing_owner' | 'missing_next_action' | 'strategy_gap';

export interface AppNotification {
  id: string;
  target_profile_id: string;
  kind: NotificationKind;
  entity_type: 'task' | 'calendar_event' | 'goal';
  entity_id: string;
  scheduled_at: string;
  read_at: string | null;
  resolved_at: string | null;
  dedupe_key: string;
  created_at: string;
}

export type EventType = 'fixed' | 'focus' | 'flexible' | 'urgent' | 'buffer';

export interface CalendarEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  event_type: EventType;
  category_code: CategoryCode | null;
  task_id: string | null;
  locked: boolean;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  timezone: string;
  status: 'confirmed' | 'tentative' | 'cancelled' | 'done';
  notes: string | null;
  source: 'user' | 'scheduler' | 'demo';
  version: number;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface WeeklyPriority {
  id: string;
  week_start: string;
  task_id: string;
  rank: number;
  chosen_by: string | null;
}
