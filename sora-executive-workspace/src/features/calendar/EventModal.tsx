import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../lib/data';
import { must, supabase, toAppError } from '../../lib/supabase';
import type { CalendarEvent, EventType } from '../../lib/types';
import { EVENT_TYPE_LABEL } from '../../lib/labels';
import { addDays, vnDate, vnDateKey, vnParts, vnStartOfDay } from '../../lib/time';
import { buildRule, describeRule, parseRule, type ShownEvent } from '../../lib/recurrence';
import { overlaps, useEvents } from '../../lib/events';
import { cx, Modal, useToast } from '../../components/ui';
import { checkWorkingHours } from './calendarRules';

export interface EventSeed {
  title?: string; start?: Date; end?: Date; task_id?: string | null; category_code?: string | null; event_type?: EventType;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => { const p = vnParts(d); return `${p2(p.hh)}:${p2(p.mm)}`; };
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/**
 * Tạo/sửa lịch. `event` là sự kiện đang hiển thị (có thể là 1 lần của chuỗi lặp).
 * Lịch cố định/khóa: chỉ đổi giờ khi người dùng xác nhận.
 */
export function EventModal(props: { open: boolean; onClose: () => void; event?: ShownEvent | null; seed?: EventSeed }) {
  return props.open ? <EventModalInner {...props} /> : null;
}

function EventModalInner({ open, onClose, event, seed }:
  { open: boolean; onClose: () => void; event?: ShownEvent | null; seed?: EventSeed }) {
  const d = useData();
  const toast = useToast();
  const isEdit = !!event;
  const occurrence = !!event?.parentId;
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmMove, setConfirmMove] = useState(false);

  const init = () => {
    const s = event ? new Date(event.start_at) : seed?.start ?? defaultStart();
    const e = event ? new Date(event.end_at) : seed?.end ?? new Date(s.getTime() + 60 * 60_000);
    const rule = event?.recurrence_rule ? parseRule(event.recurrence_rule) : null;
    return {
      title: event?.title ?? seed?.title ?? '', date: vnDateKey(s), start: hm(s), end: hm(e),
      event_type: (event?.event_type ?? seed?.event_type ?? 'flexible') as EventType,
      category_code: event?.category_code ?? seed?.category_code ?? '', task_id: event?.task_id ?? seed?.task_id ?? '',
      locked: event?.locked ?? false, notes: event?.notes ?? '',
      repeat: rule ? rule.freq : '', byday: rule?.byday ?? [vnParts(s).dow], until: rule?.until ? vnDateKey(rule.until) : '',
    };
  };
  const [f, setF] = useState(init);
  useEffect(() => { if (open) { setF(init()); setErr(null); setScope('one'); setConfirmMove(false); } }, [open, event?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));

  const [y, m, dd] = f.date.split('-').map(Number);
  const [sh, sm] = f.start.split(':').map(Number);
  const [eh, em] = f.end.split(':').map(Number);
  const startAt = y ? vnDate(y, m, dd, sh, sm) : new Date(NaN);
  const endAt = y ? vnDate(y, m, dd, eh, em) : new Date(NaN);
  const valid = f.title.trim() && !isNaN(startAt.getTime()) && endAt > startAt;

  // Trùng giờ trong ngày
  const dayStart = isNaN(startAt.getTime()) ? vnStartOfDay() : vnStartOfDay(startAt);
  const { events: dayEvents } = useEvents(dayStart, addDays(dayStart, 1));
  const clashes = useMemo(() => valid ? dayEvents.filter((x) =>
    !(event && (x.id === event.id || x.id === event.parentId || (x.parentId && x.parentId === (event.parentId ?? event.id)))) &&
    x.status !== 'cancelled' && x.event_type !== 'buffer' && overlaps(x.start_at, x.end_at, startAt, endAt)) : [],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [dayEvents, f.date, f.start, f.end, valid]);
  const hourWarn = valid ? checkWorkingHours(startAt, endAt) : [];

  const timeChanged = isEdit && (new Date(event!.start_at).getTime() !== startAt.getTime() || new Date(event!.end_at).getTime() !== endAt.getTime());
  const needsMoveConfirm = timeChanged && (event!.locked || event!.event_type === 'fixed');

  function payload(): Partial<CalendarEvent> {
    const rule = f.repeat ? buildRule({
      freq: f.repeat as 'DAILY' | 'WEEKLY', interval: 1, byday: f.repeat === 'WEEKLY' ? f.byday : f.byday.length === 6 ? [] : f.byday,
      until: f.until ? vnDate(+f.until.slice(0, 4), +f.until.slice(5, 7), +f.until.slice(8, 10), 23, 59) : undefined,
    }) : null;
    return {
      title: f.title.trim(), start_at: startAt.toISOString(), end_at: endAt.toISOString(), event_type: f.event_type,
      category_code: (f.category_code || null) as CalendarEvent['category_code'], task_id: f.task_id || null, locked: f.locked,
      notes: f.notes.trim() || null, recurrence_rule: rule,
    };
  }

  async function save() {
    if (!valid) { setErr('Kiểm tra tiêu đề và giờ bắt đầu/kết thúc.'); return; }
    if (needsMoveConfirm && !confirmMove) { setErr('Đây là lịch cố định/đã khóa. Tích xác nhận đổi giờ để lưu.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = payload();
      if (!isEdit) {
        must(await supabase.from('calendar_events').insert(body).select().single());
      } else if (occurrence && scope === 'one') {
        // Chỉ lần này: bỏ lần lặp gốc + tạo sự kiện thay thế
        const repl = must(await supabase.from('calendar_events').insert({ ...body, recurrence_rule: null }).select().single()) as CalendarEvent;
        must(await supabase.from('recurrence_exceptions').insert({ parent_event_id: event!.parentId, occurrence_start_at: event!.occurrenceStart,
          action: 'replace', replacement_event_id: repl.id }).select().single());
      } else {
        const id = event!.parentId ?? event!.id;
        const parent = event!.parentId ? must(await supabase.from('calendar_events').select('*').eq('id', id).single()) as CalendarEvent : event!;
        let patch = body;
        if (event!.parentId) {
          // Sửa cả chuỗi: giữ ngày bắt đầu gốc, chỉ đổi giờ trong ngày
          const ps = vnParts(new Date(parent.start_at));
          const ns = vnDate(ps.y, ps.m, ps.d, sh, sm), ne = vnDate(ps.y, ps.m, ps.d, eh, em);
          patch = { ...body, start_at: ns.toISOString(), end_at: ne.toISOString() };
        }
        must(await supabase.from('calendar_events').update({ ...patch, version: parent.version }).eq('id', id).select().single());
      }
      toast(isEdit ? 'Đã cập nhật lịch.' : 'Đã thêm lịch.');
      onClose();
    } catch (x) { setErr(toAppError(x).message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!event) return;
    if (!confirm(occurrence && scope === 'one' ? 'Bỏ lần này của lịch lặp?' : 'Xóa lịch này?')) return;
    setBusy(true);
    try {
      if (occurrence && scope === 'one') {
        must(await supabase.from('recurrence_exceptions').insert({ parent_event_id: event.parentId, occurrence_start_at: event.occurrenceStart, action: 'skip' }).select().single());
      } else {
        const r = await supabase.from('calendar_events').delete().eq('id', event.parentId ?? event.id);
        if (r.error) throw r.error;
      }
      toast('Đã xóa.'); onClose();
    } catch (x) { setErr(toAppError(x).message); } finally { setBusy(false); }
  }

  async function markDone() {
    if (!event || occurrence) return;
    try {
      must(await supabase.from('calendar_events').update({ status: event.status === 'done' ? 'confirmed' : 'done', version: event.version }).eq('id', event.id).select().single());
      onClose();
    } catch (x) { setErr(toAppError(x).message); }
  }

  const openTasks = d.tasks.filter((t) => ['todo', 'doing', 'waiting', 'paused'].includes(t.status) || t.id === f.task_id);

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Sửa lịch' : 'Lịch mới'} wide
      footer={<>
        {err && <span className="mr-auto self-center text-sm text-red-600">{err}</span>}
        {isEdit && <button className="btn-ghost mr-auto text-red-600" onClick={remove} disabled={busy}>Xóa</button>}
        {isEdit && !occurrence && <button className="btn-outline" onClick={markDone}>{event!.status === 'done' ? 'Bỏ đánh dấu đã xong' : 'Đánh dấu đã xong'}</button>}
        <button className="btn-outline" onClick={onClose}>Hủy</button>
        <button className="btn-primary" onClick={save} disabled={busy || !valid}>Lưu</button>
      </>}>
      {occurrence && (
        <div className="mb-3 flex gap-4 rounded-md bg-ink-50 p-2 text-sm">
          <span className="text-ink-600">Lịch lặp ({describeRule(event!.recurrence_rule)}):</span>
          <label className="flex items-center gap-1"><input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} /> Chỉ lần này</label>
          <label className="flex items-center gap-1"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> Cả chuỗi</label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="col-span-2 sm:col-span-6">
          <label className="label">Tiêu đề *</label>
          <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus={!isEdit} />
        </div>
        <div className="col-span-2 sm:col-span-2"><label className="label">Ngày</label>
          <input type="date" className="input" value={f.date} onChange={(e) => set('date', e.target.value)} disabled={occurrence && scope === 'all'} /></div>
        <div><label className="label">Từ</label><input type="time" step={900} className="input" value={f.start} onChange={(e) => set('start', e.target.value)} /></div>
        <div><label className="label">Đến</label><input type="time" step={900} className="input" value={f.end} onChange={(e) => set('end', e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-2"><label className="label">Loại lịch</label>
          <select className="input" value={f.event_type} onChange={(e) => set('event_type', e.target.value as EventType)}>
            {(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((k) => <option key={k} value={k}>{EVENT_TYPE_LABEL[k]}</option>)}
          </select></div>
        <div className="col-span-2 sm:col-span-3"><label className="label">Nhóm</label>
          <select className="input" value={f.category_code} onChange={(e) => set('category_code', e.target.value)}>
            <option value="">— Theo công việc / không —</option>
            {d.categories.map((c) => <option key={c.code} value={c.code}>{c.code}. {c.name}</option>)}
          </select></div>
        <div className="col-span-2 sm:col-span-3"><label className="label">Gắn với công việc</label>
          <select className="input" value={f.task_id} onChange={(e) => set('task_id', e.target.value)}>
            <option value="">— Độc lập —</option>
            {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select></div>
        {(!occurrence || scope === 'all') && (
          <div className="col-span-2 sm:col-span-6">
            <label className="label">Lặp lại</label>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-40" value={f.repeat} onChange={(e) => set('repeat', e.target.value)}>
                <option value="">Không lặp</option><option value="DAILY">Hằng ngày</option><option value="WEEKLY">Hằng tuần</option>
              </select>
              {f.repeat && [1, 2, 3, 4, 5, 6].map((dw) => (
                <label key={dw} className={cx('cursor-pointer rounded border px-2 py-1 text-xs', f.byday.includes(dw) ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200')}>
                  <input type="checkbox" className="hidden" checked={f.byday.includes(dw)}
                    onChange={(e) => set('byday', e.target.checked ? [...f.byday, dw].sort() : f.byday.filter((x) => x !== dw))} />{WD[dw]}
                </label>
              ))}
              {f.repeat && <span className="text-xs text-ink-500">đến</span>}
              {f.repeat && <input type="date" className="input w-40" value={f.until} onChange={(e) => set('until', e.target.value)} />}
            </div>
          </div>
        )}
        <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-6">
          <input type="checkbox" checked={f.locked} onChange={(e) => set('locked', e.target.checked)} />
          Khóa giờ (không cho kéo thả / không để đề xuất lịch di chuyển)
        </label>
        <div className="col-span-2 sm:col-span-6"><label className="label">Ghi chú</label>
          <textarea className="input min-h-[48px]" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
      {needsMoveConfirm && (
        <label className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          <input type="checkbox" checked={confirmMove} onChange={(e) => setConfirmMove(e.target.checked)} />
          Tôi xác nhận đổi giờ lịch cố định/đã khóa này.
        </label>
      )}
      {(clashes.length > 0 || hourWarn.length > 0) && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {clashes.length > 0 && <div><b>Trùng giờ với:</b> {clashes.map((c) => `${c.title} (${hm(new Date(c.start_at))}–${hm(new Date(c.end_at))})`).join('; ')}</div>}
          {hourWarn.map((w) => <div key={w}>{w}</div>)}
          <div className="mt-1 text-amber-700">Vẫn có thể lưu nếu đây là chủ đích.</div>
        </div>
      )}
    </Modal>
  );
}

function defaultStart(): Date {
  // Mốc 30 phút kế tiếp
  const now = new Date();
  const p = vnParts(now);
  const mins = p.hh * 60 + p.mm;
  const next = Math.ceil((mins + 1) / 30) * 30;
  return vnDate(p.y, p.m, p.d, Math.floor(next / 60), next % 60);
}
