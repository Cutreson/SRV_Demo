import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../lib/data';
import { supabase, must, toAppError } from '../../lib/supabase';
import type { Channel, Task, TaskDraft, TaskLink, TaskUpdate } from '../../lib/types';
import { CHANNEL_LABEL, PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL } from '../../lib/labels';
import { fmtDateTimeFull, fmtVN, fromInputDateTime, toInputDateTime } from '../../lib/time';
import { cx, Drawer, Modal, useToast } from '../../components/ui';
import { RecordHistory } from '../audit/RecordHistory';
import { missingInfo } from './taskLogic';

type Form = {
  title: string; description: string; category_code: string; task_type: 'self' | 'delegated'; priority: Task['priority'];
  status: Task['status']; needs_decision: boolean; due_at: string; next_follow_up_at: string; estimated_minutes: string;
  next_action: string; expected_result: string; completion_result: string; assignee: string; watcher_profile_id: string;
  goal_id: string; notes: string;
};

function toForm(t?: Task): Form {
  return {
    title: t?.title ?? '', description: t?.description ?? '', category_code: t?.category_code ?? '',
    task_type: t?.task_type ?? 'self', priority: t?.priority ?? 'normal', status: t?.status ?? 'todo',
    needs_decision: t?.needs_decision ?? false, due_at: toInputDateTime(t?.due_at), next_follow_up_at: toInputDateTime(t?.next_follow_up_at),
    estimated_minutes: t?.estimated_minutes ? String(t.estimated_minutes) : '', next_action: t?.next_action ?? '',
    expected_result: t?.expected_result ?? '', completion_result: t?.completion_result ?? '',
    assignee: t?.assignee_profile_id ? `p:${t.assignee_profile_id}` : t?.assignee_person_id ? `x:${t.assignee_person_id}` : '',
    watcher_profile_id: t?.watcher_profile_id ?? '', goal_id: t?.goal_id ?? '', notes: t?.notes ?? '',
  };
}

function toDraft(f: Form): TaskDraft {
  const n = (s: string) => (s.trim() ? s.trim() : null);
  return {
    title: f.title.trim(), description: n(f.description), category_code: (f.category_code || null) as Task['category_code'],
    task_type: f.task_type, priority: f.priority, status: f.status, needs_decision: f.needs_decision,
    due_at: fromInputDateTime(f.due_at), next_follow_up_at: fromInputDateTime(f.next_follow_up_at),
    estimated_minutes: f.estimated_minutes ? Math.max(5, Math.round(Number(f.estimated_minutes))) : null,
    next_action: n(f.next_action), expected_result: n(f.expected_result), completion_result: n(f.completion_result),
    assignee_profile_id: f.assignee.startsWith('p:') ? f.assignee.slice(2) : null,
    assignee_person_id: f.assignee.startsWith('x:') ? f.assignee.slice(2) : null,
    watcher_profile_id: f.watcher_profile_id || null, goal_id: f.goal_id || null, notes: n(f.notes),
  };
}

export function TaskForm({ taskId, onClose }: { taskId: string | 'new' | null; onClose: () => void }) {
  const d = useData();
  const toast = useToast();
  const live = taskId && taskId !== 'new' ? d.tasks.find((t) => t.id === taskId) : undefined;
  const [base, setBase] = useState<Task | undefined>(live);  // phiên bản lúc bắt đầu sửa
  const [f, setF] = useState<Form>(() => toForm(live));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<'log' | 'links' | 'history'>('log');
  const [addPerson, setAddPerson] = useState(false);

  // Mở việc khác → nạp lại form
  useEffect(() => {
    const t = taskId && taskId !== 'new' ? d.tasks.find((x) => x.id === taskId) : undefined;
    setBase(t); setF(toForm(t)); setDirty(false); setErr(null); setConflict(false);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Người kia sửa trong lúc mình đang mở
  const remoteChanged = !!(live && base && live.version > base.version);
  useEffect(() => {
    if (remoteChanged && !dirty) { setBase(live); setF(toForm(live)); }
  }, [remoteChanged, dirty, live]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((o) => ({ ...o, [k]: v })); setDirty(true); };
  const isNew = taskId === 'new';
  const doneNeedsResult = f.status === 'done' && !f.completion_result.trim();

  async function save() {
    setErr(null);
    if (!f.title.trim()) { setErr('Cần nhập tiêu đề.'); return; }
    if (doneNeedsResult) { setErr('Cần ghi kết quả trước khi đánh dấu Hoàn thành.'); return; }
    if (f.task_type === 'delegated' && !f.assignee) { setErr('Việc giao cần chọn người thực hiện.'); return; }
    setBusy(true);
    try {
      if (isNew) {
        await d.createTask({ ...toDraft(f), title: f.title.trim() });
        toast('Đã tạo việc.');
        onClose();
      } else if (base) {
        const row = await d.updateTask(base, toDraft(f));
        setBase(row); setF(toForm(row)); setDirty(false);
        toast('Đã lưu.');
      }
    } catch (x) {
      const e = toAppError(x);
      if (e.kind === 'conflict') setConflict(true);
      setErr(e.message);
    } finally { setBusy(false); }
  }

  async function reloadLatest() {
    if (!base) return;
    const row = await d.refreshTask(base.id);
    if (row) { setBase(row); setF(toForm(row)); setDirty(false); setConflict(false); setErr(null); }
  }

  const assigneeOptions = useMemo(() => [
    ...d.profiles.map((p) => ({ v: `p:${p.id}`, l: `${p.display_name} (tài khoản)` })),
    ...d.people.filter((p) => p.active || `x:${p.id}` === f.assignee)
      .map((p) => ({ v: `x:${p.id}`, l: p.full_name + (p.department ? ` – ${p.department}` : '') })),
  ], [d.profiles, d.people, f.assignee]);

  if (!taskId) return null;
  const missing = live ? missingInfo(live) : [];

  return (
    <Drawer open onClose={() => { if (!dirty || confirm('Có thay đổi chưa lưu. Đóng không lưu?')) onClose(); }}
      title={isNew ? 'Việc mới' : <span className="truncate">{live?.title ?? 'Công việc'}</span>}
      footer={<>
        {err && <span className="mr-auto self-center text-sm text-red-600">{err}</span>}
        <button className="btn-outline" onClick={onClose}>Đóng</button>
        <button className="btn-primary" onClick={save} disabled={busy || (!dirty && !isNew)}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </>}>
      {(remoteChanged && dirty) || conflict ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>{d.profileName(live?.updated_by)}</b> vừa cập nhật việc này{live ? ` lúc ${fmtVN(live.updated_at)}` : ''}.
          Thay đổi của anh/chị chưa được lưu để tránh ghi đè.
          <div className="mt-2 flex gap-2">
            <button className="btn-outline py-1" onClick={reloadLatest}>Tải bản mới nhất (bỏ thay đổi của tôi)</button>
          </div>
        </div>
      ) : null}
      {live?.source === 'demo' && <div className="mb-3 rounded bg-violet-50 px-2 py-1 text-xs text-violet-700">DỮ LIỆU MINH HỌA</div>}
      {missing.length > 0 && (
        <div className="mb-3 text-xs text-amber-700">Còn thiếu: {missing.join(', ')}.</div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-6">
          <label className="label">Tiêu đề *</label>
          <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={300} autoFocus={isNew} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Nhóm</label>
          <select className="input" value={f.category_code} onChange={(e) => set('category_code', e.target.value)}>
            <option value="">— Chưa phân nhóm —</option>
            {d.categories.map((c) => <option key={c.code} value={c.code}>{c.code}. {c.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Loại</label>
          <select className="input" value={f.task_type} onChange={(e) => set('task_type', e.target.value as Form['task_type'])}>
            {(['self', 'delegated'] as const).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Ưu tiên</label>
          <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Form['priority'])}>
            {PRIORITY_ORDER.map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Trạng thái</label>
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as Form['status'])}>
            {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Deadline (hạn kết quả)</label>
          <input type="datetime-local" className="input" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Ngày follow-up (cần đôn đốc)</label>
          <input type="datetime-local" className="input" value={f.next_follow_up_at} onChange={(e) => set('next_follow_up_at', e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <label className="label">Người thực hiện {f.task_type === 'delegated' && '*'}</label>
          <div className="flex gap-1">
            <select className="input" value={f.assignee} onChange={(e) => set('assignee', e.target.value)}>
              <option value="">— Chưa gán —</option>
              {assigneeOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <button type="button" className="btn-outline shrink-0 px-2" title="Thêm người vào danh bạ" onClick={() => setAddPerson(true)}>+</button>
          </div>
        </div>
        <div className="sm:col-span-3">
          <label className="label">Người theo dõi</label>
          <select className="input" value={f.watcher_profile_id} onChange={(e) => set('watcher_profile_id', e.target.value)}>
            <option value="">— Chưa chọn —</option>
            {d.profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-6">
          <label className="label">Hành động tiếp theo</label>
          <input className="input" value={f.next_action} onChange={(e) => set('next_action', e.target.value)} placeholder="Bước cụ thể kế tiếp" />
        </div>
        <div className="sm:col-span-6">
          <label className="label">Kết quả mong đợi</label>
          <input className="input" value={f.expected_result} onChange={(e) => set('expected_result', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Ước tính (phút)</label>
          <input type="number" min={5} step={15} className="input" value={f.estimated_minutes} onChange={(e) => set('estimated_minutes', e.target.value)} />
        </div>
        <div className="sm:col-span-4">
          <label className="label">Mục tiêu liên kết</label>
          <select className="input" value={f.goal_id} onChange={(e) => set('goal_id', e.target.value)}>
            <option value="">— Không —</option>
            {d.goals.filter((g) => g.status === 'active' || g.id === f.goal_id).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <input type="checkbox" checked={f.needs_decision} onChange={(e) => set('needs_decision', e.target.checked)} />
          Cần Giám đốc quyết định
        </label>
        <div className="sm:col-span-6">
          <label className="label">Mô tả</label>
          <textarea className="input min-h-[64px]" value={f.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="sm:col-span-6">
          <label className={cx('label', doneNeedsResult && 'text-red-600')}>
            Kết quả hoàn thành {f.status === 'done' && '* (bắt buộc khi Hoàn thành)'}
          </label>
          <textarea className={cx('input min-h-[52px]', doneNeedsResult && 'border-red-400')} value={f.completion_result}
                    onChange={(e) => set('completion_result', e.target.value)} placeholder="Ghi ngắn kết quả đạt được" />
        </div>
        <div className="sm:col-span-6">
          <label className="label">Ghi chú</label>
          <textarea className="input min-h-[52px]" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>

      {live && (
        <div className="mt-3 text-[11px] text-ink-400">
          Tạo bởi {d.profileName(live.created_by) || 'hệ thống'} · {fmtDateTimeFull(live.created_at)} — Sửa lần cuối bởi{' '}
          {d.profileName(live.updated_by) || 'hệ thống'} · {fmtDateTimeFull(live.updated_at)} · phiên bản {live.version}
          {live.completed_at && <> · Hoàn thành {fmtDateTimeFull(live.completed_at)}</>}
        </div>
      )}

      {live && (
        <div className="mt-6">
          <div className="mb-3 flex gap-1 border-b border-ink-100">
            {([['log', 'Nhật ký nhắc việc'], ['links', 'Tài liệu'], ['history', 'Lịch sử thay đổi']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={cx('-mb-px border-b-2 px-3 py-1.5 text-sm', tab === k ? 'border-brand-500 font-medium' : 'border-transparent text-ink-500')}>{l}</button>
            ))}
          </div>
          {tab === 'log' && <FollowUpLog task={live} />}
          {tab === 'links' && <Links taskId={live.id} />}
          {tab === 'history' && <RecordHistory table="tasks" recordId={live.id} />}
        </div>
      )}

      <AddPersonModal open={addPerson} onClose={() => setAddPerson(false)} onCreated={(id) => { set('assignee', `x:${id}`); setAddPerson(false); }} />
    </Drawer>
  );
}

function FollowUpLog({ task }: { task: Task }) {
  const d = useData();
  const toast = useToast();
  const [list, setList] = useState<TaskUpdate[]>([]);
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState<Channel | ''>('zalo');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('task_updates').select('*').eq('task_id', task.id).order('created_at', { ascending: false })
      .then((r) => { if (alive && !r.error) setList(r.data as TaskUpdate[]); });
    load();
    const ch = supabase.channel(`tu-${task.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_updates', filter: `task_id=eq.${task.id}` }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [task.id]);

  async function add() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const row = must(await supabase.from('task_updates').insert({
        task_id: task.id, note: note.trim(), channel: channel || null, next_follow_up_at: fromInputDateTime(next),
      }).select().single()) as TaskUpdate;
      setList((l) => [row, ...l.filter((x) => x.id !== row.id)]);
      setNote(''); setNext('');
      if (row.next_follow_up_at) await d.refreshTask(task.id);
      toast('Đã ghi nhật ký.');
    } catch (x) { toast((x as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 rounded-lg bg-ink-50 p-3 sm:grid-cols-6">
        <input className="input sm:col-span-6" placeholder="Đã nhắc gì / kết quả trao đổi" value={note} onChange={(e) => setNote(e.target.value)} />
        <select className="input sm:col-span-2" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </select>
        <div className="sm:col-span-3">
          <input type="datetime-local" className="input" value={next} onChange={(e) => setNext(e.target.value)} title="Ngày hẹn kiểm tra tiếp" />
        </div>
        <button className="btn-primary sm:col-span-1" onClick={add} disabled={busy || !note.trim()}>Ghi</button>
        <p className="text-[11px] text-ink-500 sm:col-span-6">Nhập ngày hẹn tiếp sẽ cập nhật luôn “Ngày follow-up” của việc.</p>
      </div>
      <ul className="mt-3 space-y-2">
        {list.map((u) => (
          <li key={u.id} className="rounded-md border border-ink-100 p-2 text-sm">
            <div className="text-[11px] text-ink-400">
              {fmtDateTimeFull(u.created_at)} · {d.profileName(u.author_id)} {u.channel && `· ${CHANNEL_LABEL[u.channel]}`}
              {u.next_follow_up_at && <> · hẹn tiếp <b className="text-ink-600">{fmtVN(u.next_follow_up_at)}</b></>}
            </div>
            <div>{u.note}</div>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-ink-400">Chưa có lần nhắc nào.</li>}
      </ul>
    </div>
  );
}

function Links({ taskId }: { taskId: string }) {
  const toast = useToast();
  const [list, setList] = useState<TaskLink[]>([]);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    supabase.from('task_links').select('*').eq('task_id', taskId).order('created_at').then((r) => { if (!r.error) setList(r.data as TaskLink[]); });
  }, [taskId]);
  async function add() {
    try {
      const row = must(await supabase.from('task_links').insert({ task_id: taskId, url: url.trim(), label: label.trim() || null }).select().single()) as TaskLink;
      setList((l) => [...l, row]); setUrl(''); setLabel('');
    } catch (x) { toast(/url/i.test((x as Error).message) ? 'Đường dẫn phải bắt đầu bằng http:// hoặc https://' : (x as Error).message, 'err'); }
  }
  async function remove(id: string) {
    const r = await supabase.from('task_links').delete().eq('id', id);
    if (r.error) toast(toAppError(r.error).message, 'err'); else setList((l) => l.filter((x) => x.id !== id));
  }
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input" placeholder="Tên tài liệu" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn-primary" onClick={add} disabled={!url.trim()}>Thêm</button>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {list.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2">
            <a className="truncate text-blue-700 underline" href={l.url} target="_blank" rel="noreferrer noopener">{l.label || l.url}</a>
            <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => remove(l.id)}>Xóa</button>
          </li>
        ))}
        {list.length === 0 && <li className="text-ink-400">Chưa có tài liệu.</li>}
      </ul>
    </div>
  );
}

export function AddPersonModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { createPerson } = useData();
  const toast = useToast();
  const [name, setName] = useState(''); const [dept, setDept] = useState(''); const [pos, setPos] = useState(''); const [contact, setContact] = useState('');
  async function create() {
    try {
      const p = await createPerson({ full_name: name.trim(), department: dept.trim() || null, position: pos.trim() || null, contact_note: contact.trim() || null });
      setName(''); setDept(''); setPos(''); setContact('');
      onCreated(p.id);
    } catch (x) { toast((x as Error).message, 'err'); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Thêm người vào danh bạ"
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" onClick={create} disabled={!name.trim()}>Thêm</button></>}>
      <div className="space-y-2">
        <div><label className="label">Họ tên *</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Phòng ban</label><input className="input" value={dept} onChange={(e) => setDept(e.target.value)} /></div>
          <div><label className="label">Chức vụ</label><input className="input" value={pos} onChange={(e) => setPos(e.target.value)} /></div>
        </div>
        <div><label className="label">Liên hệ</label><input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Zalo / SĐT / email" /></div>
      </div>
    </Modal>
  );
}
