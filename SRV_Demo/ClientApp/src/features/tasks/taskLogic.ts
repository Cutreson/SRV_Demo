import type { Priority, Task, TaskStatus } from '../../lib/types';
import { addDays, vnStartOfDay } from '../../lib/time';

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'waiting', 'paused'];
export const isOpen = (t: Pick<Task, 'status'>) => OPEN_STATUSES.includes(t.status);

export const isOverdue = (t: Pick<Task, 'status' | 'due_at'>, now = new Date()) =>
  isOpen(t) && !!t.due_at && new Date(t.due_at) < now;

export const isFollowUpDue = (t: Pick<Task, 'status' | 'next_follow_up_at'>, now = new Date()) =>
  isOpen(t) && !!t.next_follow_up_at && new Date(t.next_follow_up_at) <= now;

/** Hạn rơi vào trong `days` ngày tới (tính theo ngày VN, chưa quá hạn). */
export const isDueWithin = (t: Pick<Task, 'status' | 'due_at'>, days: number, now = new Date()) =>
  isOpen(t) && !!t.due_at && new Date(t.due_at) >= now && new Date(t.due_at) < addDays(vnStartOfDay(now), days + 1);

export const isDueToday = (t: Pick<Task, 'status' | 'due_at'>, now = new Date()) =>
  isOpen(t) && !!t.due_at && new Date(t.due_at) < addDays(vnStartOfDay(now), 1) && new Date(t.due_at) >= vnStartOfDay(now);

const PRI: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Quá hạn trước → deadline gần → ưu tiên cao → tạo trước. */
export function compareTasks(a: Task, b: Task, now = new Date()): number {
  const oa = isOverdue(a, now) ? 0 : 1, ob = isOverdue(b, now) ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const ca = isOpen(a) ? 0 : 1, cb = isOpen(b) ? 0 : 1;
  if (ca !== cb) return ca - cb;
  const da = a.due_at ? Date.parse(a.due_at) : Infinity, db = b.due_at ? Date.parse(b.due_at) : Infinity;
  if (da !== db) return da - db;
  if (PRI[a.priority] !== PRI[b.priority]) return PRI[a.priority] - PRI[b.priority];
  return Date.parse(a.created_at) - Date.parse(b.created_at);
}

/** Những thông tin còn thiếu cần bổ sung (không chặn lưu). */
export function missingInfo(t: Task): string[] {
  const m: string[] = [];
  if (!isOpen(t)) return m;
  if (!t.category_code) m.push('nhóm');
  if (t.task_type === 'delegated' && !t.assignee_person_id && !t.assignee_profile_id) m.push('người thực hiện');
  if (t.task_type === 'delegated' && !t.next_follow_up_at) m.push('ngày follow-up');
  if (!t.next_action) m.push('hành động tiếp theo');
  if (!t.due_at && !t.next_follow_up_at) m.push('deadline / ngày kiểm tra');
  return m;
}

export interface TaskFilter {
  q?: string;
  category?: string;      // 'A'..'F' | 'none'
  status?: string;        // TaskStatus | 'open' | 'all'
  priority?: string;
  type?: string;          // self | delegated
  assignee?: string;      // 'p:<profileId>' | 'x:<personId>' | 'none'
  watcher?: string;       // profile id
  due?: string;           // overdue | today | 7d | nodate | followup
}

export function applyFilter(list: Task[], f: TaskFilter, now = new Date()): Task[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter((t) => {
    const st = f.status || 'open';
    if (st === 'open' && !isOpen(t)) return false;
    if (st !== 'open' && st !== 'all' && t.status !== st) return false;
    if (f.category) {
      if (f.category === 'none' ? t.category_code !== null : t.category_code !== f.category) return false;
    }
    if (f.priority && t.priority !== f.priority) return false;
    if (f.type && t.task_type !== f.type) return false;
    if (f.watcher && t.watcher_profile_id !== f.watcher) return false;
    if (f.assignee) {
      if (f.assignee === 'none') { if (t.assignee_person_id || t.assignee_profile_id) return false; }
      else if (f.assignee.startsWith('p:')) { if (t.assignee_profile_id !== f.assignee.slice(2)) return false; }
      else if (f.assignee.startsWith('x:')) { if (t.assignee_person_id !== f.assignee.slice(2)) return false; }
    }
    if (f.due === 'overdue' && !isOverdue(t, now)) return false;
    if (f.due === 'today' && !isDueToday(t, now)) return false;
    if (f.due === '7d' && !isDueWithin(t, 7, now)) return false;
    if (f.due === 'nodate' && (t.due_at || t.next_follow_up_at)) return false;
    if (f.due === 'followup' && !isFollowUpDue(t, now)) return false;
    if (q) {
      const hay = [t.title, t.description, t.next_action, t.expected_result, t.notes].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
