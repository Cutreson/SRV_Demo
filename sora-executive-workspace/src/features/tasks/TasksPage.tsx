import { useMemo, useState, type DragEvent } from 'react';
import { assigneeName, useData } from '../../lib/data';
import { setParams, useRoute } from '../../lib/router';
import type { Task, TaskStatus } from '../../lib/types';
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, STATUS_STYLE } from '../../lib/labels';
import { fmtMinutes, fmtVN, relativeDay } from '../../lib/time';
import { CategoryChip, cx, Empty, Modal, PriorityChip, useToast } from '../../components/ui';
import { applyFilter, compareTasks, isFollowUpDue, isOverdue, missingInfo, type TaskFilter } from './taskLogic';
import { QuickCapture } from './QuickCapture';
import { TaskForm } from './TaskForm';

/** Đổi trạng thái nhanh; nếu chuyển sang Hoàn thành mà chưa có kết quả → hỏi kết quả. */
export function useStatusChanger() {
  const d = useData();
  const toast = useToast();
  const [ask, setAsk] = useState<Task | null>(null);
  const [result, setResult] = useState('');
  async function change(t: Task, s: TaskStatus, completion?: string) {
    if (s === t.status) return;
    if (s === 'done' && !(completion ?? t.completion_result)?.trim()) { setAsk(t); setResult(''); return; }
    try {
      await d.updateTask(t, { status: s, ...(completion ? { completion_result: completion } : {}) });
      toast(`${s === 'done' ? 'Đã hoàn thành' : 'Đã chuyển'}: ${t.title}`);
    } catch (x) {
      toast((x as Error).message, 'err');
      if ((x as { kind?: string }).kind === 'conflict') await d.refreshTask(t.id);
    }
  }
  const dialog = (
    <Modal open={!!ask} onClose={() => setAsk(null)} title="Kết quả hoàn thành"
      footer={<>
        <button className="btn-outline" onClick={() => setAsk(null)}>Hủy</button>
        <button className="btn-primary" disabled={!result.trim()} onClick={async () => { const t = ask!; setAsk(null); await change(t, 'done', result.trim()); }}>Xác nhận hoàn thành</button>
      </>}>
      <p className="mb-2 text-sm text-ink-600">{ask?.title}</p>
      <textarea className="input min-h-[80px]" autoFocus value={result} onChange={(e) => setResult(e.target.value)} placeholder="Ghi ngắn kết quả đạt được (bắt buộc)" />
    </Modal>
  );
  return { change, dialog };
}

export function TasksPage() {
  const d = useData();
  const { params } = useRoute();
  const view = params.get('view') === 'kanban' ? 'kanban' : 'table';
  const f: TaskFilter = {
    q: params.get('q') ?? '', category: params.get('cat') ?? '', status: params.get('st') ?? 'open', priority: params.get('pri') ?? '',
    type: params.get('type') ?? '', assignee: params.get('as') ?? '', watcher: params.get('w') ?? '', due: params.get('due') ?? '',
  };
  const openId = params.get('task');
  const { change, dialog } = useStatusChanger();
  const [showCapture, setShowCapture] = useState(() => window.innerWidth >= 640);

  const now = new Date();
  const list = useMemo(() => applyFilter(d.tasks, view === 'kanban' && f.status === 'open' ? { ...f, status: 'all' } : f, now).sort((a, b) => compareTasks(a, b, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.tasks, params.toString(), view]);

  const sel = (key: string, value: string, options: [string, string][], all: string, w = 'w-36') => (
    <select className={cx('input', w)} value={value} onChange={(e) => setParams({ [key]: e.target.value || null })} aria-label={all}>
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Công việc</h1>
        <div className="flex rounded-md border border-ink-200 bg-white p-0.5">
          {(['table', 'kanban'] as const).map((v) => (
            <button key={v} onClick={() => setParams({ view: v === 'table' ? null : v })}
              className={cx('rounded px-3 py-1 text-sm', view === v ? 'bg-ink-900 text-white' : 'text-ink-600')}>
              {v === 'table' ? 'Bảng' : 'Kanban'}
            </button>
          ))}
        </div>
        <button className="btn-outline" onClick={() => setShowCapture((x) => !x)}>Ghi nhanh</button>
        <button className="btn-primary" onClick={() => setParams({ task: 'new' })}>+ Việc mới</button>
      </div>

      {showCapture && <div className="card mb-3 p-3"><QuickCapture /></div>}

      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input w-56" placeholder="Tìm trong tiêu đề, mô tả…" value={f.q} onChange={(e) => setParams({ q: e.target.value || null })} />
        {sel('cat', f.category ?? '', [...d.categories.map((c) => [c.code, `${c.code}. ${c.name}`] as [string, string]), ['none', 'Chưa phân nhóm']], 'Mọi nhóm', 'w-48')}
        <select className="input w-40" value={f.status} onChange={(e) => setParams({ st: e.target.value === 'open' ? null : e.target.value })} aria-label="Trạng thái">
          <option value="open">Đang mở</option>
          <option value="all">Tất cả trạng thái</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {sel('pri', f.priority ?? '', PRIORITY_ORDER.map((p) => [p, PRIORITY_LABEL[p]]), 'Mọi ưu tiên', 'w-32')}
        {sel('type', f.type ?? '', [['self', 'Tự làm'], ['delegated', 'Giao việc']], 'Tự làm + giao', 'w-36')}
        {sel('as', f.assignee ?? '', [
          ...d.profiles.map((p) => [`p:${p.id}`, p.display_name] as [string, string]),
          ...d.people.filter((p) => p.active).map((p) => [`x:${p.id}`, p.full_name] as [string, string]),
          ['none', 'Chưa gán người'],
        ], 'Mọi người thực hiện', 'w-48')}
        {sel('w', f.watcher ?? '', d.profiles.map((p) => [p.id, p.display_name]), 'Mọi người theo dõi', 'w-40')}
        {sel('due', f.due ?? '', [['overdue', 'Quá hạn'], ['today', 'Hạn hôm nay'], ['7d', 'Hạn 7 ngày tới'], ['followup', 'Đến hạn follow-up'], ['nodate', 'Chưa có ngày']], 'Mọi thời hạn', 'w-40')}
        {params.toString().replace(/(^|&)(view|task)=[^&]*/g, '') && (
          <button className="btn-ghost" onClick={() => setParams({ q: null, cat: null, st: null, pri: null, type: null, as: null, w: null, due: null })}>Xóa lọc</button>
        )}
      </div>

      {d.loading ? <div className="text-sm text-ink-400">Đang tải…</div>
        : view === 'table' ? <TaskTable list={list} onOpen={(id) => setParams({ task: id })} onStatus={change} />
        : <Kanban list={list} onOpen={(id) => setParams({ task: id })} onStatus={change} showCancelled={f.status === 'cancelled' || f.status === 'all'} />}

      <TaskForm taskId={openId} onClose={() => setParams({ task: null })} />
      {dialog}
    </div>
  );
}

function DueCell({ t }: { t: Task }) {
  if (!t.due_at) return <span className="text-ink-300">—</span>;
  const od = isOverdue(t);
  return (
    <div className={cx('leading-tight', od && 'font-semibold text-red-600')}>
      <div>{fmtVN(t.due_at)}</div>
      <div className="text-[11px] font-normal text-ink-400">{t.status === 'done' ? '' : relativeDay(t.due_at)}</div>
    </div>
  );
}

function TaskTable({ list, onOpen, onStatus }: { list: Task[]; onOpen: (id: string) => void; onStatus: (t: Task, s: TaskStatus) => void }) {
  const d = useData();
  if (list.length === 0) return <Empty>Không có việc nào khớp bộ lọc.</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="border-b border-ink-100 bg-ink-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-3 py-2">Nhóm</th><th className="px-3 py-2">Công việc</th><th className="px-3 py-2">Người thực hiện</th>
            <th className="px-3 py-2">Deadline</th><th className="px-3 py-2">Follow-up</th><th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Cập nhật</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {list.map((t) => {
            const miss = missingInfo(t);
            return (
              <tr key={t.id} className={cx('cursor-pointer hover:bg-ink-50', !['todo', 'doing', 'waiting', 'paused'].includes(t.status) && 'opacity-60')} onClick={() => onOpen(t.id)}>
                <td className="px-3 py-2 align-top"><CategoryChip c={d.categoryOf(t.category_code)} short /></td>
                <td className="max-w-md px-3 py-2 align-top">
                  <div className="flex flex-wrap items-center gap-1">
                    <PriorityChip p={t.priority} />
                    {t.needs_decision && <span className="chip bg-violet-600 text-white">Cần quyết định</span>}
                    {t.task_type === 'delegated' && <span className="chip bg-ink-100 text-ink-600">Giao</span>}
                    {t.source === 'demo' && <span className="chip bg-violet-50 text-violet-600">Minh họa</span>}
                    <span className="font-medium">{t.title}</span>
                  </div>
                  {t.next_action && <div className="mt-0.5 text-xs text-ink-500">→ {t.next_action}</div>}
                  {miss.length > 0 && <div className="mt-0.5 text-[11px] text-amber-600">Thiếu: {miss.join(', ')}</div>}
                </td>
                <td className="px-3 py-2 align-top text-ink-700">{assigneeName(t, d) || <span className="text-ink-300">—</span>}
                  {t.estimated_minutes ? <div className="text-[11px] text-ink-400">{fmtMinutes(t.estimated_minutes)}</div> : null}</td>
                <td className="whitespace-nowrap px-3 py-2 align-top"><DueCell t={t} /></td>
                <td className={cx('whitespace-nowrap px-3 py-2 align-top', isFollowUpDue(t) && 'font-semibold text-amber-700')}>
                  {t.next_follow_up_at ? fmtVN(t.next_follow_up_at) : <span className="text-ink-300">—</span>}
                </td>
                <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                  <select className={cx('max-w-[150px] cursor-pointer rounded border-0 py-0.5 pl-1.5 pr-6 text-xs font-medium', STATUS_STYLE[t.status])} value={t.status}
                          onChange={(e) => onStatus(t, e.target.value as TaskStatus)} aria-label="Đổi trạng thái">
                    {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-top text-[11px] text-ink-400">{d.profileName(t.updated_by)}<br />{fmtVN(t.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kanban({ list, onOpen, onStatus, showCancelled }:
  { list: Task[]; onOpen: (id: string) => void; onStatus: (t: Task, s: TaskStatus) => void; showCancelled: boolean }) {
  const d = useData();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const cols = STATUS_ORDER.filter((s) => s !== 'cancelled' || showCancelled);
  const onDrop = (s: TaskStatus) => (e: DragEvent) => {
    e.preventDefault(); setOver(null);
    const t = list.find((x) => x.id === e.dataTransfer.getData('text/task'));
    if (t) onStatus(t, s);
  };
  return (
    <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3 overflow-x-auto pb-2">
      {cols.map((s) => {
        const items = list.filter((t) => t.status === s);
        const doneLimited = s === 'done' ? items.slice(0, 30) : items;
        return (
          <section key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={onDrop(s)}
            className={cx('flex min-h-[200px] flex-col rounded-lg bg-ink-100/70 p-2', over === s && 'ring-2 ring-brand-500')}>
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-600">
              {STATUS_LABEL[s]} <span className="text-ink-400">{items.length}</span>
            </h3>
            <div className="flex flex-col gap-2">
              {doneLimited.map((t) => (
                <article key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)} onClick={() => onOpen(t.id)}
                  className={cx('cursor-pointer rounded-md border bg-white p-2 text-sm shadow-sm hover:border-ink-300', isOverdue(t) ? 'border-red-300' : 'border-ink-200')}>
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <CategoryChip c={d.categoryOf(t.category_code)} short /><PriorityChip p={t.priority} />
                    {t.needs_decision && <span className="chip bg-violet-600 text-white">QĐ</span>}
                    {t.source === 'demo' && <span className="chip bg-violet-50 text-violet-600">Minh họa</span>}
                  </div>
                  <div className="font-medium leading-snug">{t.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink-500">
                    {assigneeName(t, d) && <span>{assigneeName(t, d)}</span>}
                    {t.due_at && <span className={cx(isOverdue(t) && 'font-semibold text-red-600')}>Hạn {fmtVN(t.due_at, false)}</span>}
                    {t.next_follow_up_at && <span className={cx(isFollowUpDue(t) && 'font-semibold text-amber-700')}>FU {fmtVN(t.next_follow_up_at, false)}</span>}
                  </div>
                </article>
              ))}
              {s === 'done' && items.length > 30 && <div className="px-1 text-[11px] text-ink-400">+{items.length - 30} việc khác (lọc trạng thái để xem hết)</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
