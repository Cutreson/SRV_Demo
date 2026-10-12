import { useState } from 'react';
import { useData } from '../../lib/data';
import { must, supabase, toAppError } from '../../lib/supabase';
import type { Goal } from '../../lib/types';
import { STATUS_LABEL } from '../../lib/labels';
import { fmtVN } from '../../lib/time';
import { CategoryChip, cx, Empty, Modal, useToast } from '../../components/ui';
import { isOpen } from '../tasks/taskLogic';
import { TaskForm } from '../tasks/TaskForm';
import { EventModal, type EventSeed } from '../calendar/EventModal';

const PERIOD: Record<Goal['period_type'], string> = { quarter: 'Quý', month: 'Tháng', week: 'Tuần' };
const GSTATUS: Record<Goal['status'], string> = { active: 'Đang theo đuổi', achieved: 'Đạt', missed: 'Không đạt', paused: 'Tạm dừng', cancelled: 'Hủy' };

export function GoalsPage() {
  const d = useData();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Goal> | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [seed, setSeed] = useState<EventSeed | null>(null);
  const [status, setStatus] = useState<Goal['status'] | ''>('active');
  const gap = new Set(d.notifications.filter((n) => n.kind === 'strategy_gap').map((n) => n.entity_id));
  const list = d.goals.filter((g) => !status || g.status === status);

  async function save() {
    if (!edit?.title?.trim()) return;
    const body = {
      title: edit.title.trim(), description: edit.description || null, category_code: edit.category_code || null,
      period_type: edit.period_type ?? 'month', start_date: edit.start_date || null, due_date: edit.due_date || null,
      progress: Math.min(100, Math.max(0, Number(edit.progress ?? 0))), status: edit.status ?? 'active',
    };
    try {
      if (edit.id) must(await supabase.from('goals').update({ ...body, version: edit.version }).eq('id', edit.id).select().single());
      else must(await supabase.from('goals').insert(body).select().single());
      await d.reload(); setEdit(null); toast('Đã lưu mục tiêu.');
    } catch (x) { toast(toAppError(x).message, 'err'); }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Mục tiêu</h1>
        <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value as Goal['status'])}>
          <option value="">Mọi trạng thái</option>
          {(Object.keys(GSTATUS) as Goal['status'][]).map((k) => <option key={k} value={k}>{GSTATUS[k]}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setEdit({ period_type: 'month', progress: 0, status: 'active' })}>+ Mục tiêu mới</button>
      </div>
      {list.length === 0 && <Empty>Chưa có mục tiêu.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((g) => {
          const tasks = d.tasks.filter((t) => t.goal_id === g.id);
          const openT = tasks.filter(isOpen), done = tasks.filter((t) => t.status === 'done');
          return (
            <section key={g.id} className="card p-4">
              <div className="mb-2 flex items-start gap-2">
                <CategoryChip c={d.categoryOf(g.category_code)} short />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold leading-snug">{g.title} {g.source === 'demo' && <span className="chip bg-violet-50 text-violet-600">Minh họa</span>}</h2>
                  <div className="text-xs text-ink-500">{PERIOD[g.period_type]} · {GSTATUS[g.status]}{g.due_date ? ` · hạn ${g.due_date.split('-').reverse().join('/')}` : ''}</div>
                </div>
                <button className="btn-ghost py-1 text-xs" onClick={() => setEdit({ ...g })}>Sửa</button>
              </div>
              {g.description && <p className="mb-2 text-sm text-ink-600">{g.description}</p>}
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 rounded bg-ink-100"><div className="h-2 rounded bg-emerald-500" style={{ width: `${g.progress}%` }} /></div>
                <span className="w-10 text-right text-sm tabular-nums">{Math.round(g.progress)}%</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-400">Tiến độ do người dùng cập nhật · {done.length}/{tasks.length} việc liên kết đã xong</p>
              {gap.has(g.id) && (
                <div className="mt-2 flex items-center justify-between rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                  7 ngày qua/tới chưa có khung tập trung cho mục tiêu này.
                  <button className="font-medium underline" onClick={() => setSeed({ title: `Tập trung: ${g.title}`, category_code: g.category_code, event_type: 'focus' })}>Đặt lịch</button>
                </div>
              )}
              {openT.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {openT.slice(0, 5).map((t) => (
                    <li key={t.id} className="flex cursor-pointer justify-between gap-2 rounded px-1 hover:bg-ink-50" onClick={() => setOpenTask(t.id)}>
                      <span className="truncate">{t.title}</span>
                      <span className="shrink-0 text-[11px] text-ink-400">{STATUS_LABEL[t.status]}{t.due_at ? ` · ${fmtVN(t.due_at, false)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button className="mt-2 text-xs text-blue-700" onClick={() => setOpenTask('new')}>+ Thêm việc cho mục tiêu</button>
            </section>
          );
        })}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Sửa mục tiêu' : 'Mục tiêu mới'}
        footer={<><button className="btn-outline" onClick={() => setEdit(null)}>Hủy</button><button className="btn-primary" disabled={!edit?.title?.trim()} onClick={save}>Lưu</button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><label className="label">Tên mục tiêu *</label><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus /></div>
            <div className="col-span-2"><label className="label">Kết quả đầu ra</label><textarea className="input min-h-[60px]" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div><label className="label">Nhóm</label>
              <select className="input" value={edit.category_code ?? ''} onChange={(e) => setEdit({ ...edit, category_code: (e.target.value || null) as Goal['category_code'] })}>
                <option value="">—</option>{d.categories.map((c) => <option key={c.code} value={c.code}>{c.code}. {c.name}</option>)}
              </select></div>
            <div><label className="label">Kỳ</label>
              <select className="input" value={edit.period_type} onChange={(e) => setEdit({ ...edit, period_type: e.target.value as Goal['period_type'] })}>
                {(Object.keys(PERIOD) as Goal['period_type'][]).map((k) => <option key={k} value={k}>{PERIOD[k]}</option>)}
              </select></div>
            <div><label className="label">Bắt đầu</label><input type="date" className="input" value={edit.start_date ?? ''} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></div>
            <div><label className="label">Hạn</label><input type="date" className="input" value={edit.due_date ?? ''} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Tiến độ: {Math.round(Number(edit.progress ?? 0))}%</label>
              <input type="range" min={0} max={100} step={5} className="w-full" value={Number(edit.progress ?? 0)} onChange={(e) => setEdit({ ...edit, progress: Number(e.target.value) })} /></div>
            <div className="col-span-2"><label className="label">Trạng thái</label>
              <div className="flex flex-wrap gap-1">{(Object.keys(GSTATUS) as Goal['status'][]).map((k) => (
                <button key={k} type="button" onClick={() => setEdit({ ...edit, status: k })}
                  className={cx('rounded border px-2 py-1 text-xs', edit.status === k ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200')}>{GSTATUS[k]}</button>
              ))}</div></div>
          </div>
        )}
      </Modal>
      <TaskForm taskId={openTask} onClose={() => setOpenTask(null)} />
      <EventModal open={!!seed} seed={seed ?? undefined} onClose={() => setSeed(null)} />
    </div>
  );
}
