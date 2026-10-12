import { useEffect, useMemo, useState } from 'react';
import { assigneeName, useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { Channel, Task, TaskUpdate } from '../../lib/types';
import { CHANNEL_LABEL, STATUS_LABEL } from '../../lib/labels';
import { addDays, fmtVN, fromInputDateTime, relativeDay, toInputDateTime, vnDate, vnParts, vnStartOfDay } from '../../lib/time';
import { CategoryChip, cx, Empty, Modal, PriorityChip, useToast } from '../../components/ui';
import { compareTasks, isFollowUpDue, isOpen, isOverdue } from '../tasks/taskLogic';
import { TaskForm } from '../tasks/TaskForm';
import { useStatusChanger } from '../tasks/TasksPage';

type Group = 'followup' | 'overdue' | 'confirm' | 'other';
const GROUP_LABEL: Record<Group, string> = {
  followup: 'Cần đôn đốc (đến ngày follow-up)', overdue: 'Quá hạn kết quả', confirm: 'Đã báo xong – chờ xác nhận', other: 'Đang theo dõi',
};

/** Theo dõi việc đã giao: deadline (hạn kết quả) và ngày follow-up (ngày cần đôn đốc) tách riêng. */
export function DelegatedPage() {
  const d = useData();
  const now = new Date();
  const [person, setPerson] = useState('');
  const [latest, setLatest] = useState<Record<string, TaskUpdate>>({});
  const [logFor, setLogFor] = useState<Task | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const { change, dialog } = useStatusChanger();

  const list = useMemo(() => d.tasks.filter((t) => t.task_type === 'delegated' && isOpen(t) &&
    (!person || (person === 'none' ? !t.assignee_person_id && !t.assignee_profile_id : `x:${t.assignee_person_id}` === person || `p:${t.assignee_profile_id}` === person)))
    .sort((a, b) => compareTasks(a, b, now)), [d.tasks, person]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = list.map((t) => t.id).join(',');
  useEffect(() => {
    if (!ids) { setLatest({}); return; }
    let alive = true;
    const load = () => supabase.from('task_updates').select('*').in('task_id', ids.split(',')).order('created_at', { ascending: false }).limit(1000)
      .then((r) => {
        if (!alive || r.error) return;
        const m: Record<string, TaskUpdate> = {};
        for (const u of r.data as TaskUpdate[]) if (!m[u.task_id]) m[u.task_id] = u;
        setLatest(m);
      });
    load();
    const ch = supabase.channel(`deleg-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_updates' }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [ids]);

  const groupOf = (t: Task): Group => t.status === 'waiting' ? 'confirm' : isFollowUpDue(t, now) ? 'followup' : isOverdue(t, now) ? 'overdue' : 'other';
  const groups: Group[] = ['followup', 'overdue', 'confirm', 'other'];
  // Follow-up đã qua mà chưa có log nhắc sau thời điểm đó = không được follow-up đúng hạn
  const missed = (t: Task) => t.next_follow_up_at && new Date(t.next_follow_up_at) < addDays(vnStartOfDay(now), 0) &&
    (!latest[t.id] || new Date(latest[t.id].created_at) < new Date(t.next_follow_up_at));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Theo dõi việc đã giao</h1>
        <select className="input w-56" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Người được giao">
          <option value="">Mọi người được giao</option>
          {d.people.filter((p) => p.active).map((p) => <option key={p.id} value={`x:${p.id}`}>{p.full_name}</option>)}
          {d.profiles.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.display_name}</option>)}
          <option value="none">Chưa có người phụ trách</option>
        </select>
        <a className="btn-primary" href="#/tasks?task=new">+ Giao việc mới</a>
      </div>
      {list.length === 0 && <Empty>Không có việc giao nào đang mở.</Empty>}
      {groups.map((g) => {
        const items = list.filter((t) => groupOf(t) === g);
        if (!items.length) return null;
        return (
          <section key={g} className="mb-5">
            <h2 className={cx('mb-2 text-xs font-semibold uppercase tracking-wide', g === 'followup' ? 'text-amber-700' : g === 'overdue' ? 'text-red-600' : 'text-ink-500')}>
              {GROUP_LABEL[g]} · {items.length}
            </h2>
            <div className="card divide-y divide-ink-100">
              {items.map((t) => {
                const u = latest[t.id];
                return (
                  <div key={t.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_170px_170px_auto] md:items-center">
                    <div className="min-w-0 cursor-pointer" onClick={() => setOpenTask(t.id)}>
                      <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        <CategoryChip c={d.categoryOf(t.category_code)} short /><PriorityChip p={t.priority} />
                        <span className="font-medium">{t.title}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-ink-600"><b>{assigneeName(t, d) || <span className="text-red-600">Chưa có người</span>}</b>
                        {t.expected_result && <> · Kết quả cần: {t.expected_result}</>}</div>
                      <div className="mt-0.5 text-[11px] text-ink-400">
                        {u ? <>Nhắc gần nhất {fmtVN(u.created_at)}{u.channel ? ` (${CHANNEL_LABEL[u.channel]})` : ''}: “{u.note}” — {d.profileName(u.author_id)}</> : 'Chưa có lần nhắc nào'}
                        {missed(t) && <span className="ml-1 font-semibold text-red-600">· Lỡ hẹn follow-up</span>}
                      </div>
                    </div>
                    <div className="text-xs">
                      <div className="text-ink-400">Deadline</div>
                      <div className={cx(isOverdue(t, now) && 'font-semibold text-red-600')}>{t.due_at ? `${fmtVN(t.due_at)} · ${relativeDay(t.due_at)}` : '—'}</div>
                    </div>
                    <div className="text-xs">
                      <div className="text-ink-400">Follow-up</div>
                      <div className={cx(isFollowUpDue(t, now) && 'font-semibold text-amber-700')}>{t.next_follow_up_at ? `${fmtVN(t.next_follow_up_at)} · ${relativeDay(t.next_follow_up_at)}` : <span className="text-red-600">chưa đặt</span>}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 md:justify-end">
                      <button className="btn-outline py-1 text-xs" onClick={() => setLogFor(t)}>Ghi nhắc</button>
                      {t.status !== 'waiting'
                        ? <button className="btn-ghost py-1 text-xs" onClick={() => change(t, 'waiting')} title="Người phụ trách báo đã xong">Báo xong</button>
                        : <button className="btn-accent py-1 text-xs" onClick={() => change(t, 'done')}>Xác nhận hoàn thành</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-ink-400">Trạng thái: {STATUS_LABEL.waiting} = người phụ trách đã báo xong; một trong hai tài khoản bấm “Xác nhận hoàn thành” (cần ghi kết quả).</p>
      <FollowUpDialog task={logFor} onClose={() => setLogFor(null)} />
      <TaskForm taskId={openTask} onClose={() => setOpenTask(null)} />
      {dialog}
    </div>
  );
}

/** Thư ký ghi log nhắc việc: kênh, kết quả, ngày hẹn tiếp (cập nhật luôn follow-up của việc). */
export function FollowUpDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const d = useData();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState<Channel>('zalo');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!task) return;
    setNote(''); setChannel('zalo');
    // Mặc định hẹn lại sau 2 ngày làm việc, 09:00
    let day = addDays(vnStartOfDay(new Date()), 2);
    if (vnParts(day).dow === 0) day = addDays(day, 1);
    const p = vnParts(day);
    setNext(toInputDateTime(vnDate(p.y, p.m, p.d, 9).toISOString()));
  }, [task]);
  async function save() {
    if (!task || !note.trim()) return;
    setBusy(true);
    try {
      must(await supabase.from('task_updates').insert({ task_id: task.id, note: note.trim(), channel, next_follow_up_at: fromInputDateTime(next) }).select().single());
      await d.refreshTask(task.id);
      toast('Đã ghi nhắc việc.'); onClose();
    } catch (x) { toast((x as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!task} onClose={onClose} title="Ghi lần nhắc việc"
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy || !note.trim()} onClick={save}>Lưu</button></>}>
      <p className="mb-3 text-sm text-ink-600">{task?.title} — <b>{task ? assigneeName(task, d) : ''}</b></p>
      <div className="space-y-2">
        <div><label className="label">Kênh</label>
          <div className="flex flex-wrap gap-1">{(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)} className={cx('rounded border px-2 py-1 text-xs', channel === c ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200')}>{CHANNEL_LABEL[c]}</button>
          ))}</div></div>
        <div><label className="label">Kết quả trao đổi *</label>
          <textarea className="input min-h-[70px]" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Anh A hẹn thứ 5 gửi báo cáo" /></div>
        <div><label className="label">Ngày hẹn kiểm tra tiếp</label>
          <input type="datetime-local" className="input" value={next} onChange={(e) => setNext(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
