import type { Channel, EventType, NotificationKind, Priority, TaskStatus, TaskType } from './types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Cần làm',
  doing: 'Đang làm',
  waiting: 'Chờ phản hồi / xác nhận',
  paused: 'Tạm dừng',
  done: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
export const STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'waiting', 'paused', 'done', 'cancelled'];
export const STATUS_STYLE: Record<TaskStatus, string> = {
  todo: 'bg-ink-100 text-ink-700',
  doing: 'bg-blue-100 text-blue-800',
  waiting: 'bg-amber-100 text-amber-800',
  paused: 'bg-ink-200 text-ink-600',
  done: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-ink-100 text-ink-400 line-through',
};

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Khẩn', high: 'Cao', normal: 'Thường', low: 'Thấp' };
export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];
export const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: 'bg-red-600 text-white',
  high: 'bg-red-100 text-red-700',
  normal: 'bg-ink-100 text-ink-600',
  low: 'bg-ink-50 text-ink-400',
};

export const TYPE_LABEL: Record<TaskType, string> = { self: 'Tự làm', delegated: 'Giao việc' };

export const CHANNEL_LABEL: Record<Channel, string> = {
  zalo: 'Zalo', phone: 'Điện thoại', email: 'Email', in_person: 'Trực tiếp', other: 'Khác',
};

export const ROLE_LABEL = { director: 'Giám đốc', secretary: 'Thư ký' } as const;

/** Nhãn tiếng Việt cho tên trường (dùng ở nhật ký thay đổi). */
export const FIELD_LABEL: Record<string, string> = {
  title: 'Tiêu đề', description: 'Mô tả', category_code: 'Nhóm', task_type: 'Loại', priority: 'Ưu tiên', status: 'Trạng thái',
  needs_decision: 'Cần quyết định', due_at: 'Deadline', next_follow_up_at: 'Ngày follow-up', estimated_minutes: 'Ước tính (phút)',
  next_action: 'Hành động tiếp theo', expected_result: 'Kết quả mong đợi', completion_result: 'Kết quả hoàn thành',
  completed_at: 'Hoàn thành lúc', assignee_profile_id: 'Người thực hiện (tài khoản)', assignee_person_id: 'Người thực hiện',
  watcher_profile_id: 'Người theo dõi', goal_id: 'Mục tiêu', notes: 'Ghi chú', full_name: 'Họ tên', department: 'Phòng ban',
  position: 'Chức vụ', contact_note: 'Liên hệ', active: 'Đang hoạt động', note: 'Nội dung', channel: 'Kênh', url: 'Đường dẫn',
  label: 'Nhãn', progress: 'Tiến độ', progress_percent: 'Tiến độ %', start_at: 'Bắt đầu', end_at: 'Kết thúc', event_type: 'Loại lịch',
  locked: 'Khóa', recurrence_rule: 'Lặp lại', period_type: 'Kỳ', start_date: 'Ngày bắt đầu', due_date: 'Hạn', value: 'Giá trị',
  display_name: 'Tên hiển thị', rank: 'Thứ tự', week_start: 'Tuần',
};

export const TABLE_LABEL: Record<string, string> = {
  tasks: 'Công việc', task_updates: 'Log nhắc việc', task_links: 'Tài liệu', people: 'Danh bạ', goals: 'Mục tiêu',
  calendar_events: 'Lịch', recurrence_exceptions: 'Ngoại lệ lịch lặp', weekly_priorities: 'Top 3', settings: 'Cấu hình', profiles: 'Tài khoản',
};


export const NOTIF_LABEL: Record<NotificationKind, string> = {
  overdue: 'Quá hạn',
  follow_up_due: 'Cần follow-up',
  due_soon_1: 'Hạn trong 1 ngày',
  due_soon_3: 'Hạn trong 3 ngày',
  due_soon_7: 'Hạn trong 7 ngày',
  decision_needed: 'Chờ quyết định',
  event_starting: 'Lịch sắp bắt đầu',
  missing_owner: 'Chưa có người phụ trách',
  missing_next_action: 'Thiếu hành động tiếp theo',
  strategy_gap: 'Mục tiêu chiến lược chưa có khung tập trung',
};
export const NOTIF_ORDER: NotificationKind[] = ['overdue', 'follow_up_due', 'event_starting', 'due_soon_1', 'decision_needed',
  'due_soon_3', 'due_soon_7', 'strategy_gap', 'missing_owner', 'missing_next_action'];
export const NOTIF_TONE: Record<NotificationKind, string> = {
  overdue: 'border-l-red-500', follow_up_due: 'border-l-amber-500', due_soon_1: 'border-l-orange-400', due_soon_3: 'border-l-yellow-400',
  due_soon_7: 'border-l-ink-300', decision_needed: 'border-l-violet-500', event_starting: 'border-l-blue-500', missing_owner: 'border-l-ink-400',
  missing_next_action: 'border-l-ink-300', strategy_gap: 'border-l-rose-600',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  fixed: 'Cố định', focus: 'Tập trung', flexible: 'Linh hoạt', urgent: 'Khẩn', buffer: 'Dự phòng',
};
