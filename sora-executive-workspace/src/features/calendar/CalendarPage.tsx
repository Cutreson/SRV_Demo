import { useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useData } from '../../lib/data';
import { overlaps, useEvents } from '../../lib/events';
import { must, supabase, toAppError } from '../../lib/supabase';
import { setParams, useRoute } from '../../lib/router';
import { SLOT_LABEL, useSettings } from '../../lib/settings';
import type { CalendarEvent, Task } from '../../lib/types';
import { EVENT_TYPE_LABEL } from '../../lib/labels';
import { addDays, fmtMinutes, fmtVN, vnDateKey, vnParts, vnStartOfDay, vnWeekStart } from '../../lib/time';
import type { ShownEvent } from '../../lib/recurrence';
import { CategoryChip, cx, useToast } from '../../components/ui';
import { EventModal, type EventSeed } from './EventModal';
import { freeMinutes, LUNCH_END, LUNCH_START, WORK_END, WORK_START } from './calendarRules';
import { layoutDay, snap } from './layout';
import { isOpen } from '../tasks/taskLogic';
import { ScheduleProposals } from './ScheduleProposals';

const VIEW_START = 7 * 60, VIEW_END = 18 * 60, PX = 1.1; // px mỗi phút
const WD = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mOf = (iso: string, day: Date) => Math.round((new Date(iso).getTime() - day.getTime()) / 60_000);

interface Drag { ev: ShownEvent; mode: 'move' | 'resize'; x0: number; y0: number; dMin: number; dDay: number }

export function CalendarPage() {
  const d = useData();
  const toast = useToast();
  const settings = useSettings();
  const { params } = useRoute();
  const view = params.get('v') === 'day' ? 'day' : 'week';
  const anchor = params.get('d') ? new Date(params.get('d')! + 'T00:00:00+07:00') : new Date();
  const showSunday = params.get('sun') === '1';
  const start = view === 'day' ? vnStartOfDay(anchor) : vnWeekStart(anchor);
  const nDays = view === 'day' ? 1 : showSunday ? 7 : 6;
  const days = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  const { events, raw, reload } = useEvents(start, addDays(start, nDays));
  const [seed, setSeed] = useState<EventSeed | null>(null);
  const [edit, setEdit] = useState<ShownEvent | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [showProposals, setShowProposals] = useState(false);
  const colRef = useRef<HTMLDivElement>(null);
  const now = new Date();

  const catOf = (e: ShownEvent) => d.categoryOf(e.category_code ?? d.tasks.find((t) => t.id === e.task_id)?.category_code);

  // Việc chưa có lịch phía trước (để kéo vào lịch)
  const scheduledTaskIds = new Set(raw.filter((e) => e.task_id && new Date(e.end_at) > now).map((e) => e.task_id));
  const unscheduled = d.tasks.filter((t) => isOpen(t) && t.task_type === 'self' && !scheduledTaskIds.has(t.id))
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')).slice(0, 30);

  const go = (delta: number) => setParams({ d: vnDateKey(addDays(start, delta * (view === 'day' ? 1 : 7))) });

  // ----- Lưu thay đổi giờ (kéo thả) -----
  async function moveEvent(ev: ShownEvent, newStart: Date, newEnd: Date) {
    if (newEnd <= newStart) return;
    const clash = events.find((x) => x.id !== ev.id && x.status !== 'cancelled' && x.event_type !== 'buffer' && ev.event_type !== 'buffer' &&
      overlaps(x.start_at, x.end_at, newStart, newEnd));
    if (clash) { toast(`Không đổi được: trùng giờ với “${clash.title}”.`, 'err'); return; }
    if ((ev.locked || ev.event_type === 'fixed') && !confirm(`“${ev.title}” là lịch cố định/đã khóa. Xác nhận đổi sang ${fmtVN(newStart.toISOString())}?`)) return;
    try {
      if (ev.parentId) {
        if (!confirm('Đây là lịch lặp. Chỉ đổi lần này?')) return;
        const repl = must(await supabase.from('calendar_events').insert({
          title: ev.title, start_at: newStart.toISOString(), end_at: newEnd.toISOString(), event_type: ev.event_type, category_code: ev.category_code,
          task_id: ev.task_id, locked: ev.locked, notes: ev.notes, source: ev.source,
        }).select().single()) as CalendarEvent;
        must(await supabase.from('recurrence_exceptions').insert({ parent_event_id: ev.parentId, occurrence_start_at: ev.occurrenceStart, action: 'replace', replacement_event_id: repl.id }).select().single());
      } else {
        must(await supabase.from('calendar_events').update({ start_at: newStart.toISOString(), end_at: newEnd.toISOString(), version: ev.version }).eq('id', ev.id).select().single());
      }
      toast('Đã đổi giờ.');
      reload();
    } catch (x) { toast(toAppError(x).message, 'err'); reload(); }
  }

  function onPointerDown(e: RPointerEvent, ev: ShownEvent, mode: Drag['mode']) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ ev, mode, x0: e.clientX, y0: e.clientY, dMin: 0, dDay: 0 });
  }
  function onPointerMove(e: RPointerEvent) {
    if (!drag) return;
    const colW = (colRef.current?.getBoundingClientRect().width ?? 200);
    const dMin = snap((e.clientY - drag.y0) / PX);
    const dDay = drag.mode === 'move' && view === 'week' ? Math.round((e.clientX - drag.x0) / colW) : 0;
    if (dMin !== drag.dMin || dDay !== drag.dDay) setDrag({ ...drag, dMin, dDay });
  }
  function onPointerUp() {
    if (!drag) return;
    const { ev, mode, dMin, dDay } = drag;
    setDrag(null);
    if (dMin === 0 && dDay === 0) { setEdit(ev); return; } // bấm = mở
    const s = new Date(ev.start_at), en = new Date(ev.end_at);
    if (mode === 'move') moveEvent(ev, new Date(s.getTime() + (dMin + dDay * 1440) * 60_000), new Date(en.getTime() + (dMin + dDay * 1440) * 60_000));
    else moveEvent(ev, s, new Date(Math.max(s.getTime() + 15 * 60_000, en.getTime() + dMin * 60_000)));
  }

  async function dropTask(t: Task, day: Date, minute: number) {
    const dur = Math.min(t.estimated_minutes ?? 60, settings.max_block_minutes || 90);
    setSeed({ title: t.title, task_id: t.id, category_code: t.category_code, event_type: t.category_code === 'E' || t.category_code === 'F' ? 'focus' : 'flexible',
      start: new Date(day.getTime() + minute * 60_000), end: new Date(day.getTime() + (minute + dur) * 60_000) });
  }

  const height = (VIEW_END - VIEW_START) * PX;
  const y = (m: number) => (m - VIEW_START) * PX;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Lịch</h1>
        <div className="flex rounded-md border border-ink-200 bg-white p-0.5">
          {(['day', 'week'] as const).map((v) => (
            <button key={v} onClick={() => setParams({ v: v === 'week' ? null : v })} className={cx('rounded px-3 py-1 text-sm', view === v ? 'bg-ink-900 text-white' : 'text-ink-600')}>
              {v === 'day' ? 'Ngày' : 'Tuần'}
            </button>
          ))}
        </div>
        <button className="btn-ghost px-2" onClick={() => go(-1)} aria-label="Trước">‹</button>
        <button className="btn-outline py-1" onClick={() => setParams({ d: null })}>Hôm nay</button>
        <button className="btn-ghost px-2" onClick={() => go(1)} aria-label="Sau">›</button>
        <span className="text-sm font-medium tabular-nums">
          {view === 'day' ? fmtVN(start.toISOString(), false) : `${fmtVN(start.toISOString(), false)} – ${fmtVN(addDays(start, nDays - 1).toISOString(), false)}`}
        </span>
        {view === 'week' && <label className="ml-2 flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={showSunday} onChange={(e) => setParams({ sun: e.target.checked ? '1' : null })} /> Hiện CN</label>}
        <div className="ml-auto flex gap-2">
          <button className="btn-accent" onClick={() => setShowProposals(true)}>Đề xuất lịch</button>
          <button className="btn-primary" onClick={() => setSeed({})}>+ Lịch mới</button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-ink-500">
        {(Object.keys(EVENT_TYPE_LABEL) as (keyof typeof EVENT_TYPE_LABEL)[]).map((k) => (
          <span key={k} className="flex items-center gap-1"><span className={cx('inline-block h-3 w-4 rounded-sm', typeStyle(k, '#64708a').cls)} style={typeStyle(k, '#64708a').style} />{EVENT_TYPE_LABEL[k]}</span>
        ))}
        <span>· Kéo để đổi giờ, kéo mép dưới để đổi thời lượng · Bấm chỗ trống để thêm lịch · Kéo việc từ cột phải vào lịch</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        <div className="card overflow-x-auto">
          <div style={{ minWidth: view === 'week' ? 760 : 320 }}>
            {/* Tiêu đề ngày */}
            <div className="grid border-b border-ink-100" style={{ gridTemplateColumns: `52px repeat(${nDays}, 1fr)` }}>
              <div />
              {days.map((day) => {
                const p = vnParts(day);
                const isToday = vnDateKey(day) === vnDateKey(now);
                const dayEv = events.filter((e) => e.event_type !== 'buffer' && e.status !== 'cancelled' && vnDateKey(e.start_at) === vnDateKey(day));
                const fm = freeMinutes(dayEv.map((e) => [mOf(e.start_at, day), mOf(e.end_at, day)]), settings.buffer_percent, p.dow !== 0);
                return (
                  <button key={day.toISOString()} className={cx('border-l border-ink-100 px-2 py-1.5 text-left', isToday && 'bg-brand-50')}
                    onClick={() => setParams({ v: 'day', d: vnDateKey(day) })}>
                    <div className={cx('text-xs font-semibold', isToday ? 'text-brand-700' : 'text-ink-700')}>{WD[p.dow]} {p.d}/{p.m}</div>
                    <div className="text-[10px] text-ink-400">{p.dow === 0 ? 'Nghỉ' : `trống ${fmtMinutes(fm.free) || '0'} · dự phòng ${fmtMinutes(fm.reserve)}`}</div>
                  </button>
                );
              })}
            </div>
            {/* Lưới */}
            <div className="relative grid select-none" style={{ gridTemplateColumns: `52px repeat(${nDays}, 1fr)`, height }}
              onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
              <div className="relative">
                {Array.from({ length: (VIEW_END - VIEW_START) / 60 + 1 }, (_, i) => VIEW_START + i * 60).map((m) => (
                  <div key={m} className="absolute right-1 -translate-y-1.5 text-[10px] text-ink-400" style={{ top: y(m) }}>{hm(m)}</div>
                ))}
              </div>
              {days.map((day, di) => {
                const p = vnParts(day);
                const dayEvents = events.filter((e) => mOf(e.end_at, day) > VIEW_START && mOf(e.start_at, day) < VIEW_END && vnDateKey(e.start_at) === vnDateKey(day));
                const placed = layoutDay(dayEvents, (e) => [mOf(e.start_at, day), mOf(e.end_at, day)]);
                const tmpl = settings.daily_template[String(p.dow)] ?? [];
                const toMin = (s: string) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
                return (
                  <div key={day.toISOString()} ref={di === 0 ? colRef : undefined} className={cx('relative border-l border-ink-100', p.dow === 0 && 'bg-ink-50')}
                    onClick={(e) => { if (e.target !== e.currentTarget) return; const m = snap(e.nativeEvent.offsetY / PX + VIEW_START, 30); setSeed({ start: new Date(day.getTime() + m * 60_000), end: new Date(day.getTime() + (m + 60) * 60_000) }); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const t = d.tasks.find((x) => x.id === e.dataTransfer.getData('text/task')); if (t) dropTask(t, day, snap(e.nativeEvent.offsetY / PX + VIEW_START, 15)); }}>
                    {/* nền: ngoài giờ, nghỉ trưa, giờ tròn, khung ưu tiên */}
                    <div className="pointer-events-none absolute inset-x-0 bg-ink-50" style={{ top: 0, height: y(WORK_START) }} />
                    <div className="pointer-events-none absolute inset-x-0 bg-ink-50" style={{ top: y(WORK_END), bottom: 0 }} />
                    <div className="pointer-events-none absolute inset-x-0 bg-ink-100/80" style={{ top: y(LUNCH_START), height: (LUNCH_END - LUNCH_START) * PX }} />
                    {Array.from({ length: (VIEW_END - VIEW_START) / 60 }, (_, i) => VIEW_START + i * 60).map((m) => (
                      <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-ink-100" style={{ top: y(m) }} />
                    ))}
                    {p.dow !== 0 && tmpl.map(([s, , code], i) => (
                      <div key={i} className="pointer-events-none absolute inset-x-0 truncate px-1 text-[9px] text-ink-300" style={{ top: y(toMin(s)) + 1 }}>{SLOT_LABEL[code] ?? code}</div>
                    ))}
                    {vnDateKey(day) === vnDateKey(now) && (
                      <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: y(mOf(now.toISOString(), day)) }} />
                    )}
                    {placed.map(({ item: ev, col, cols }) => {
                      const dragging = drag?.ev.id === ev.id;
                      let s = mOf(ev.start_at, day), en = mOf(ev.end_at, day);
                      if (dragging && drag.mode === 'move') { s += drag.dMin; en += drag.dMin; }
                      if (dragging && drag.mode === 'resize') en = Math.max(s + 15, en + drag.dMin);
                      const c = catOf(ev);
                      const st = typeStyle(ev.event_type, c?.color ?? '#475569');
                      const task = ev.task_id ? d.tasks.find((t) => t.id === ev.task_id) : undefined;
                      return (
                        <div key={ev.id} role="button" tabIndex={0} title={`${ev.title}\n${hm(s)}–${hm(en)} · ${EVENT_TYPE_LABEL[ev.event_type]}`}
                          onPointerDown={(e) => onPointerDown(e, ev, 'move')}
                          onKeyDown={(e) => { if (e.key === 'Enter') setEdit(ev); }}
                          className={cx('absolute z-10 cursor-grab overflow-hidden rounded px-1 py-0.5 text-[11px] leading-tight shadow-sm', st.cls,
                            dragging && 'z-30 opacity-80 ring-2 ring-brand-500', ev.status === 'done' && 'opacity-50')}
                          style={{ ...st.style, top: y(s), height: Math.max(14, (en - s) * PX - 1),
                            left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
                            transform: dragging && drag.dDay ? `translateX(${drag.dDay * 100 * cols}%)` : undefined }}>
                          <div className="font-semibold">{hm(s)}{ev.locked || ev.event_type === 'fixed' ? ' 🔒' : ''}{ev.recurrence_rule ? ' ↻' : ''}</div>
                          <div className={cx(ev.status === 'done' && 'line-through')}>{ev.title}</div>
                          {task && <div className="opacity-80">{task.status === 'done' ? '✓ ' : ''}việc: {task.title.slice(0, 40)}</div>}
                          {!ev.parentId && !ev.locked && ev.event_type !== 'fixed' && (
                            <div className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => onPointerDown(e, ev, 'resize')} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="card h-fit p-3">
          <h2 className="mb-1 text-sm font-semibold">Việc chưa có lịch</h2>
          <p className="mb-2 text-[11px] text-ink-500">Kéo vào lịch để giữ chỗ. Việc dài nên chia thành nhiều khung (tối đa {settings.max_block_minutes} phút/khung).</p>
          <ul className="max-h-[640px] space-y-1.5 overflow-y-auto">
            {unscheduled.map((t) => (
              <li key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)}
                className="cursor-grab rounded border border-ink-200 bg-white p-1.5 text-xs hover:border-ink-400">
                <div className="flex items-center gap-1"><CategoryChip c={d.categoryOf(t.category_code)} short /><span className="truncate font-medium">{t.title}</span></div>
                <div className="text-[10px] text-ink-500">{t.estimated_minutes ? fmtMinutes(t.estimated_minutes) : 'chưa ước tính'}{t.due_at ? ` · hạn ${fmtVN(t.due_at)}` : ''}</div>
              </li>
            ))}
            {unscheduled.length === 0 && <li className="text-xs text-ink-400">Mọi việc tự làm đều đã có lịch.</li>}
          </ul>
        </aside>
      </div>

      <EventModal open={!!seed} seed={seed ?? undefined} onClose={() => { setSeed(null); reload(); }} />
      <EventModal open={!!edit} event={edit} onClose={() => { setEdit(null); reload(); }} />
      {showProposals && <ScheduleProposals weekStart={vnWeekStart(anchor)} onClose={() => { setShowProposals(false); reload(); }} />}
    </div>
  );
}

/** Kiểu hiển thị theo loại lịch; màu theo nhóm A–F. */
function typeStyle(t: CalendarEvent['event_type'], color: string): { cls: string; style: CSSProperties } {
  switch (t) {
    case 'fixed': return { cls: 'text-white', style: { backgroundColor: color } };
    case 'focus': return { cls: 'text-white border-l-4 border-black/30', style: { backgroundColor: color, backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,.12) 0 6px, transparent 6px 12px)' } };
    case 'flexible': return { cls: 'text-ink-900 border', style: { backgroundColor: color + '33', borderColor: color } };
    case 'urgent': return { cls: 'text-white border-2 border-red-600', style: { backgroundColor: '#dc2626' } };
    case 'buffer': return { cls: 'border border-dashed border-ink-300 bg-white/70 text-ink-500', style: {} };
  }
}
