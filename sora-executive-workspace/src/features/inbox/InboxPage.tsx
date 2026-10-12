import { useMemo, useState } from 'react';
import { assigneeName, useData } from '../../lib/data';
import type { AppNotification, NotificationKind, Task } from '../../lib/types';
import { NOTIF_LABEL, NOTIF_ORDER, NOTIF_TONE } from '../../lib/labels';
import { fmtVN, fromInputDateTime, relativeDay, toInputDateTime } from '../../lib/time';
import { cx, Empty, useToast } from '../../components/ui';
import { TaskForm } from '../tasks/TaskForm';
import { EventModal, type EventSeed } from '../calendar/EventModal';
import { FollowUpDialog } from '../delegated/DelegatedPage';

/** Nhắc việc: đánh dấu “đã xem” chỉ làm mờ, KHÔNG xóa nghĩa vụ — thông báo tự hết khi điều kiện không còn. */
export function InboxPage() {
  const d = useData();
  const toast = useToast();
  const [showRead, setShowRead] = useState(true);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [seed, setSeed] = useState<EventSeed | null>(null);
  const [logFor, setLogFor] = useState<Task | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  const groups = useMemo(() => {
    const m = new Map<NotificationKind, AppNotification[]>();
    for (const n of d.notifications) {
      if (!showRead && n.read_at) continue;
      m.set(n.kind, [...(m.get(n.kind) ?? []), n]);
    }
    return NOTIF_ORDER.filter((k) => m.get(k)?.length).map((k) => [k, m.get(k)!] as const);
  }, [d.notifications, showRead]);
  const unread = d.notifications.filter((n) => !n.read_at);

  async function changeFollowUp(t: Task, v: string) {
    try { await d.updateTask(t, { next_follow_up_at: fromInputDateTime(v) }); toast('Đã đổi ngày follow-up.'); }
    catch (x) { toast((x as Error).message, 'err'); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Nhắc việc <span className="text-ink-400">{d.notifications.length}</span></h1>
        <label className="flex items-center gap-1 text-sm text-ink-600"><input type="checkbox" checked={showRead} onChange={(e) => setShowRead(e.target.checked)} /> Hiện cả mục đã xem</label>
        {unread.length > 0 && <button className="btn-outline" onClick={() => d.markNotificationsRead(unread.map((n) => n.id))}>Đánh dấu đã xem tất cả</button>}
        {perm === 'default' && <button className="btn-outline" onClick={async () => setPerm(await Notification.requestPermission())}>Bật thông báo trình duyệt</button>}
        <button className="btn-ghost" onClick={() => d.refreshNotifications()}>Làm mới</button>
      </div>
      {perm === 'granted' && <p className="mb-3 text-xs text-ink-500">Thông báo trình duyệt đã bật — chỉ hiện khi app đang mở trong trình duyệt.</p>}
      {groups.length === 0 && <Empty>Không có việc cần nhắc. 👍</Empty>}
      {groups.map(([kind, items]) => (
        <section key={kind} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{NOTIF_LABEL[kind]} · {items.length}</h2>
          <div className="space-y-2">
            {items.map((n) => {
              const t = n.entity_type === 'task' ? d.tasks.find((x) => x.id === n.entity_id) : undefined;
              const g = n.entity_type === 'goal' ? d.goals.find((x) => x.id === n.entity_id) : undefined;
              return (
                <div key={n.id} className={cx('card border-l-4 p-3', NOTIF_TONE[kind], n.read_at && 'opacity-60')}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t?.title ?? g?.title ?? (n.entity_type === 'calendar_event' ? 'Lịch sắp bắt đầu' : '(đã xóa)')}</div>
                      {t && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-500">
                          {assigneeName(t, d) && <span>{assigneeName(t, d)}</span>}
                          {t.due_at && <span>Hạn {fmtVN(t.due_at)} ({relativeDay(t.due_at)})</span>}
                          {t.next_follow_up_at && <span>FU {fmtVN(t.next_follow_up_at)}</span>}
                          {t.next_action && <span>→ {t.next_action}</span>}
                        </div>
                      )}
                      {n.entity_type === 'calendar_event' && <div className="text-xs text-ink-500">Bắt đầu {fmtVN(n.scheduled_at)}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {t && <button className="btn-outline py-1 text-xs" onClick={() => setOpenTask(t.id)}>Mở việc</button>}
                      {t && <button className="btn-outline py-1 text-xs" onClick={() => setSeed({ title: t.title, task_id: t.id, category_code: t.category_code,
                        start: undefined, event_type: t.category_code === 'E' || t.category_code === 'F' ? 'focus' : 'flexible' })}>Lên lịch</button>}
                      {t && t.task_type === 'delegated' && <button className="btn-outline py-1 text-xs" onClick={() => setLogFor(t)}>Ghi nhắc</button>}
                      {t && (kind === 'follow_up_due' || kind === 'missing_owner') && (
                        <input type="datetime-local" className="input w-auto py-0.5 text-xs" title="Đổi ngày follow-up"
                          defaultValue={toInputDateTime(t.next_follow_up_at)} onBlur={(e) => e.target.value !== toInputDateTime(t.next_follow_up_at) && changeFollowUp(t, e.target.value)} />
                      )}
                      {g && <button className="btn-outline py-1 text-xs" onClick={() => setSeed({ title: `Tập trung: ${g.title}`, category_code: g.category_code, event_type: 'focus' })}>Đặt khung tập trung</button>}
                      {!n.read_at && <button className="btn-ghost py-1 text-xs" onClick={() => d.markNotificationsRead([n.id])}>Đã xem</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className="mt-6 text-xs text-ink-400">“Đã xem” chỉ làm mờ mục nhắc. Mục nhắc tự biến mất khi việc được xử lý (hoàn thành, đổi hạn, đặt ngày follow-up mới…).</p>
      <TaskForm taskId={openTask} onClose={() => setOpenTask(null)} />
      <EventModal open={!!seed} seed={seed ?? undefined} onClose={() => setSeed(null)} />
      <FollowUpDialog task={logFor} onClose={() => setLogFor(null)} />
    </div>
  );
}
