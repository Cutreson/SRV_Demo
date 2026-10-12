import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { assigneeName, useData } from '../../lib/data';
import { useAuth } from '../auth/AuthProvider';
import { useEvents } from '../../lib/events';
import { must, supabase, toAppError } from '../../lib/supabase';
import { navigate, setParams, useRoute } from '../../lib/router';
import { SLOT_LABEL, useSettings } from '../../lib/settings';
import type { Task, WeeklyPriority } from '../../lib/types';
import { STATUS_LABEL, STATUS_ORDER } from '../../lib/labels';
import { addDays, fmtMinutes, fmtVN, relativeDay, vnDateKey, vnParts, vnStartOfDay, vnWeekStart } from '../../lib/time';
import type { ShownEvent } from '../../lib/recurrence';
import { CategoryChip, cx, Empty, PriorityChip, useToast } from '../../components/ui';
import { compareTasks, isDueToday, isDueWithin, isFollowUpDue, isOpen, isOverdue } from '../tasks/taskLogic';
import { TaskForm } from '../tasks/TaskForm';
import { EventModal, type EventSeed } from '../calendar/EventModal';
import { freeMinutes, LUNCH_END, LUNCH_START, WORK_END, WORK_START } from '../calendar/calendarRules';

const minOfDay = (iso: string, day: Date) => Math.round((new Date(iso).getTime() - day.getTime()) / 60_000);
const hmLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function DashboardPage() {
  const d = useData();
  const { profile } = useAuth();
  const toast = useToast();
  const settings = useSettings();
  const { params } = useRoute();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  // Bộ lọc
  const fWatcher = params.get('w') ?? '', fCat = params.get('cat') ?? '', fStatus = params.get('st') ?? '';
  const weekOffset = Number(params.get('wk') ?? '0') || 0;
  const weekStart = addDays(vnWeekStart(now), weekOffset * 7);
  const weekEnd = addDays(weekStart, 7);
  const today = vnStartOfDay(now);

  const tasks = useMemo(() => d.tasks.filter((t) =>
    (!fWatcher || t.watcher_profile_id === fWatcher) && (!fCat || t.category_code === fCat) && (!fStatus || t.status === fStatus)), [d.tasks, fWatcher, fCat, fStatus]);
  const open = useMemo(() => tasks.filter(isOpen).sort((a, b) => compareTasks(a, b, now)), [tasks, now]);

  const overdue = open.filter((t) => isOverdue(t, now));
  const followUp = open.filter((t) => isFollowUpDue(t, now) || (t.next_follow_up_at && vnDateKey(t.next_follow_up_at) === vnDateKey(now)));
  const decision = open.filter((t) => t.needs_decision);
  const soon = open.filter((t) => isDueWithin(t, 7, now));
  const todayTasks = open.filter((t) => isDueToday(t, now) || (t.next_follow_up_at && vnDateKey(t.next_follow_up_at) === vnDateKey(now)));

  // Lịch hôm nay + tuần
  const { events: weekEvents } = useEvents(weekStart, weekEnd);
  const { events: todayEventsAll } = useEvents(today, addDays(today, 1));
  const todayEvents = todayEventsAll.filter((e) => e.status !== 'cancelled');
  const isWorkday = settings.working_days.includes(vnParts(now).dow === 0 ? 7 : vnParts(now).dow);
  const busy = todayEvents.filter((e) => e.event_type !== 'buffer').map((e) => [Math.max(0, minOfDay(e.start_at, today)), Math.min(24 * 60, minOfDay(e.end_at, today))] as [number, number]);
  const free = freeMinutes(busy, settings.buffer_percent, isWorkday);

  // Top 3 tuần
  const [top, setTop] = useState<WeeklyPriority[]>([]);
  const weekKey = vnDateKey(weekStart);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('weekly_priorities').select('*').eq('week_start', weekKey).order('rank')
      .then((r) => { if (alive && !r.error) setTop(r.data as WeeklyPriority[]); });
    load();
    const ch = supabase.channel(`top3-${weekKey}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_priorities' }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [weekKey]);

  const suggestion = useMemo(() => {
    const strategicLow = (t: Task) => (t.category_code === 'E' || t.category_code === 'F' ? 0 : 1);
    return d.tasks.filter((t) => isOpen(t) && t.task_type === 'self')
      .sort((a, b) => compareTasks(a, b, now) || strategicLow(a) - strategicLow(b)).slice(0, 3);
  }, [d.tasks, now]);

  async function setRank(rank: number, taskId: string) {
    try {
      const existing = top.find((x) => x.rank === rank);
      const dup = top.find((x) => x.task_id === taskId && x.rank !== rank);
      if (dup) must(await supabase.from('weekly_priorities').delete().eq('id', dup.id).select());
      if (!taskId) { if (existing) must(await supabase.from('weekly_priorities').delete().eq('id', existing.id).select()); }
      else if (existing) must(await supabase.from('weekly_priorities').update({ task_id: taskId }).eq('id', existing.id).select());
      else must(await supabase.from('weekly_priorities').insert({ week_start: weekKey, rank, task_id: taskId }).select());
      const r = await supabase.from('weekly_priorities').select('*').eq('week_start', weekKey).order('rank');
      if (!r.error) setTop(r.data as WeeklyPriority[]);
    } catch (x) { toast(toAppError(x).message, 'err'); }
  }
  async function acceptSuggestion() {
    for (let i = 0; i < suggestion.length; i++) {
      if (!top.find((x) => x.rank === i + 1)) await setRank(i + 1, suggestion[i].id);
    }
    toast('Đã chốt Top 3.');
  }

  // Thời gian theo nhóm A–F trong tuần
  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of weekEvents) {
      if (e.status === 'cancelled' || e.event_type === 'buffer') continue;
      const cat = e.category_code ?? d.tasks.find((t) => t.id === e.task_id)?.category_code ?? '—';
      m[cat] = (m[cat] ?? 0) + (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 60_000;
    }
    return m;
  }, [weekEvents, d.tasks]);
  const totalMin = Object.values(byCat).reduce((a, b) => a + b, 0);
  const efShare = totalMin ? Math.round((((byCat.E ?? 0) + (byCat.F ?? 0)) / totalMin) * 100) : 0;

  const goals = d.goals.filter((g) => g.status === 'active' && (!fCat || g.category_code === fCat))
    .sort((a, b) => (a.category_code === 'E' || a.category_code === 'F' ? 0 : 1) - (b.category_code === 'E' || b.category_code === 'F' ? 0 : 1));
  const gapGoals = new Set(d.notifications.filter((n) => n.kind === 'strategy_gap').map((n) => n.entity_id));

  const [openTask, setOpenTask] = useState<string | null>(null);
  const [eventSeed, setEventSeed] = useState<EventSeed | null>(null);
  const [editEvent, setEditEvent] = useState<ShownEvent | null>(null);
  const [q, setQ] = useState('');

  const filterSel = (key: string, value: string, opts: [string, string][], all: string) => (
    <select className="input w-auto py-1 text-xs" value={value} onChange={(e) => setParams({ [key]: e.target.value || null })} aria-label={all}>
      <option value="">{all}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div className="mx-auto max-w-7xl">
      {/* Thanh công cụ */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Hôm nay · {fmtVN(now.toISOString(), false)}</h1>
          <p className="text-xs text-ink-500">Xin chào {profile?.display_name}{d.online.length > 1 ? ' · đang cùng làm việc: ' + d.online.join(', ') : ''}</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); navigate('/tasks', { q, st: 'all' }); }}>
          <input className="input w-56" placeholder="Tìm toàn bộ công việc…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <button className="btn-outline" onClick={() => window.dispatchEvent(new Event('open-capture'))}>+ Ghi nhanh</button>
        <button className="btn-outline" onClick={() => setEventSeed({})}>+ Lịch mới</button>
        <button className="btn-primary" onClick={() => setOpenTask('new')}>+ Việc mới</button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-500">Lọc:</span>
        {filterSel('w', fWatcher, d.profiles.map((p) => [p.id, `Theo dõi: ${p.display_name}`]), 'Mọi người theo dõi')}
        {filterSel('cat', fCat, d.categories.map((c) => [c.code, `${c.code}. ${c.name}`]), 'Mọi nhóm')}
        {filterSel('st', fStatus, STATUS_ORDER.filter((s) => s !== 'done' && s !== 'cancelled').map((s) => [s, STATUS_LABEL[s]]), 'Mọi trạng thái')}
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-ghost px-2 py-1" onClick={() => setParams({ wk: String(weekOffset - 1) })}>‹</button>
          <span className="tabular-nums">Tuần {fmtVN(weekStart.toISOString(), false)} – {fmtVN(addDays(weekStart, 5).toISOString(), false)}</span>
          <button className="btn-ghost px-2 py-1" onClick={() => setParams({ wk: String(weekOffset + 1) })}>›</button>
          {weekOffset !== 0 && <button className="btn-ghost px-2 py-1" onClick={() => setParams({ wk: null })}>Tuần này</button>}
        </div>
      </div>

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Kpi label="Việc cần làm hôm nay" value={todayTasks.length} onClick={() => navigate('/tasks', { due: 'today' })} />
        <Kpi label="Quá hạn" value={overdue.length} tone={overdue.length ? 'red' : undefined} onClick={() => navigate('/tasks', { due: 'overdue' })} />
        <Kpi label="Follow-up đến hạn" value={followUp.length} tone={followUp.length ? 'amber' : undefined} onClick={() => navigate('/delegated')} />
        <Kpi label="Chờ quyết định" value={decision.length} tone={decision.length ? 'violet' : undefined} />
        <Kpi label="Thời gian trống hôm nay" value={isWorkday ? fmtMinutes(free.free) || '0' : '—'}
             sub={isWorkday ? `đã trừ ${settings.buffer_percent}% dự phòng (${fmtMinutes(free.reserve)})` : 'Ngày nghỉ'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Cột trái: timeline + Top 3 */}
        <div className="space-y-4">
          <Card title="Lịch hôm nay" action={<a className="text-xs text-blue-700" href="#/calendar">Mở lịch →</a>}>
            <Timeline day={today} events={todayEvents} now={now} template={settings.daily_template[String(vnParts(now).dow)] ?? []}
              onPick={(e) => setEditEvent(e)} onEmpty={(m) => setEventSeed({ start: new Date(today.getTime() + m * 60_000), end: new Date(today.getTime() + (m + 60) * 60_000) })} />
          </Card>

          <Card title={`Top 3 ưu tiên tuần`} action={top.length < 3 && suggestion.length > 0 ? <button className="text-xs text-blue-700" onClick={acceptSuggestion}>Chốt gợi ý</button> : null}>
            <ol className="space-y-2">
              {[1, 2, 3].map((rank) => {
                const cur = top.find((x) => x.rank === rank);
                const t = cur ? d.tasks.find((x) => x.id === cur.task_id) : undefined;
                const hint = !cur ? suggestion[rank - 1] : undefined;
                return (
                  <li key={rank} className="flex items-start gap-2">
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[11px] font-bold text-white">{rank}</span>
                    <div className="min-w-0 flex-1">
                      <select className={cx('input py-1 text-sm', t?.status === 'done' && 'line-through')} value={cur?.task_id ?? ''} onChange={(e) => setRank(rank, e.target.value)}>
                        <option value="">{hint ? `Gợi ý: ${hint.title}` : '— Chọn việc —'}</option>
                        {d.tasks.filter((x) => isOpen(x) || x.id === cur?.task_id).sort((a, b) => compareTasks(a, b, now)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                      </select>
                      {t && <div className="mt-0.5 text-[11px] text-ink-500">{t.due_at ? `Hạn ${fmtVN(t.due_at)}` : 'Chưa có hạn'} · {STATUS_LABEL[t.status]}{cur?.chosen_by ? ` · chốt bởi ${d.profileName(cur.chosen_by)}` : ''}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title="Thời gian theo nhóm (tuần)" action={<span className={cx('text-xs', efShare < 20 ? 'text-red-600' : 'text-emerald-700')}>Chiến lược E+F: {efShare}%</span>}>
            {totalMin === 0 ? <Empty>Tuần này chưa có lịch.</Empty> : (
              <div className="space-y-1.5">
                {[...d.categories.map((c) => c.code as string), '—'].filter((k) => byCat[k]).map((k) => {
                  const c = d.categoryOf(k);
                  return (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      <span className="w-5 font-semibold" style={{ color: c?.color }}>{k}</span>
                      <div className="h-3 flex-1 rounded bg-ink-100">
                        <div className="h-3 rounded" style={{ width: `${(byCat[k] / totalMin) * 100}%`, backgroundColor: c?.color ?? '#94a3b8' }} />
                      </div>
                      <span className="w-12 text-right tabular-nums text-ink-600">{fmtMinutes(Math.round(byCat[k]))}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Cột phải: danh sách + mục tiêu */}
        <div className="grid content-start gap-4 md:grid-cols-2">
          <TaskList title="Cần quyết định" tone="violet" list={decision} onOpen={setOpenTask} empty="Không có việc chờ quyết định." />
          <TaskList title="Cần follow-up" tone="amber" list={followUp} onOpen={setOpenTask} empty="Không có việc cần đôn đốc." showFollow more={() => navigate('/delegated')} />
          <TaskList title="Quá hạn" tone="red" list={overdue} onOpen={setOpenTask} empty="Không có việc quá hạn." more={() => navigate('/tasks', { due: 'overdue' })} />
          <TaskList title="Sắp đến hạn (7 ngày)" list={soon} onOpen={setOpenTask} empty="Không có hạn trong 7 ngày tới." more={() => navigate('/tasks', { due: '7d' })} />
          <div className="md:col-span-2">
            <Card title="Mục tiêu đang theo đuổi" action={<a className="text-xs text-blue-700" href="#/goals">Tất cả mục tiêu →</a>}>
              {goals.length === 0 ? <Empty>Chưa có mục tiêu.</Empty> : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {goals.slice(0, 6).map((g) => (
                    <div key={g.id} className="rounded-md border border-ink-100 p-2">
                      <div className="mb-1 flex items-center gap-1.5 text-sm"><CategoryChip c={d.categoryOf(g.category_code)} short /><span className="truncate font-medium">{g.title}</span></div>
                      <div className="h-1.5 rounded bg-ink-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${g.progress}%` }} /></div>
                      <div className="mt-1 flex justify-between text-[11px] text-ink-500">
                        <span>{Math.round(g.progress)}%{g.due_date ? ` · hạn ${g.due_date.split('-').reverse().join('/')}` : ''}</span>
                        <span>{d.tasks.filter((t) => t.goal_id === g.id && isOpen(t)).length} việc mở</span>
                      </div>
                      {gapGoals.has(g.id) && (
                        <div className="mt-1 flex items-center justify-between gap-2 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                          7 ngày chưa có khung tập trung.
                          <button className="underline" onClick={() => setEventSeed({ title: `Tập trung: ${g.title}`, category_code: g.category_code, event_type: 'focus' })}>Đặt lịch</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <TaskForm taskId={openTask} onClose={() => setOpenTask(null)} />
      <EventModal open={!!eventSeed} seed={eventSeed ?? undefined} onClose={() => setEventSeed(null)} />
      <EventModal open={!!editEvent} event={editEvent} onClose={() => setEditEvent(null)} />
    </div>
  );
}

function Kpi({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: string; tone?: 'red' | 'amber' | 'violet'; onClick?: () => void }) {
  const c = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'violet' ? 'text-violet-700' : 'text-ink-900';
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="card p-3 text-left enabled:hover:border-ink-300">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', c)}>{value}</div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </button>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-3">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function TaskList({ title, list, onOpen, empty, tone, showFollow, more }:
  { title: string; list: Task[]; onOpen: (id: string) => void; empty: string; tone?: 'red' | 'amber' | 'violet'; showFollow?: boolean; more?: () => void }) {
  const d = useData();
  const bar = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'violet' ? 'bg-violet-500' : 'bg-ink-300';
  return (
    <section className="card overflow-hidden">
      <div className={cx('h-1', bar)} />
      <div className="flex items-center justify-between px-3 pt-2">
        <h2 className="text-sm font-semibold">{title} <span className="text-ink-400">{list.length}</span></h2>
        {more && list.length > 6 && <button className="text-xs text-blue-700" onClick={more}>Xem tất cả →</button>}
      </div>
      {list.length === 0 ? <p className="px-3 pb-3 pt-1 text-sm text-ink-400">{empty}</p> : (
        <ul className="divide-y divide-ink-100">
          {list.slice(0, 6).map((t) => (
            <li key={t.id} className="cursor-pointer px-3 py-2 hover:bg-ink-50" onClick={() => onOpen(t.id)}>
              <div className="flex items-center gap-1.5 text-sm">
                <CategoryChip c={d.categoryOf(t.category_code)} short /><PriorityChip p={t.priority} />
                <span className="truncate">{t.title}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-500">
                {assigneeName(t, d) && <span>{assigneeName(t, d)}</span>}
                {t.due_at && <span className={cx(isOverdue(t) && 'font-semibold text-red-600')}>Hạn {fmtVN(t.due_at)} ({relativeDay(t.due_at)})</span>}
                {showFollow && t.next_follow_up_at && <span className="font-semibold text-amber-700">FU {fmtVN(t.next_follow_up_at)}</span>}
                {t.next_action && <span className="truncate">→ {t.next_action}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Timeline 08:00–17:00, nghỉ trưa 12–13; khung ưu tiên của template hiển thị mờ phía sau (không khóa). */
function Timeline({ day, events, now, template, onPick, onEmpty }:
  { day: Date; events: ShownEvent[]; now: Date; template: [string, string, string][]; onPick: (e: ShownEvent) => void; onEmpty: (minuteOfDay: number) => void }) {
  const d = useData();
  const PX = 0.9; // px mỗi phút
  const top = (m: number) => (m - WORK_START) * PX;
  const h = (WORK_END - WORK_START) * PX;
  const nowMin = minOfDay(now.toISOString(), day);
  const toMin = (s: string) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
  const visible = events.filter((e) => minOfDay(e.end_at, day) > WORK_START && minOfDay(e.start_at, day) < WORK_END);
  const outside = events.length - visible.length;
  return (
    <div>
      <div className="relative ml-10" style={{ height: h }}
        onClick={(e) => { if (e.target !== e.currentTarget) return; const y = e.nativeEvent.offsetY; const m = Math.floor((y / PX + WORK_START) / 30) * 30; onEmpty(m); }}>
        {Array.from({ length: 10 }, (_, i) => WORK_START + i * 60).map((m) => (
          <div key={m} className="pointer-events-none absolute -left-10 w-full border-t border-ink-100 text-[10px] text-ink-400" style={{ top: top(m) }}>
            <span className="absolute -top-2 left-0 w-9 bg-white">{hmLabel(m)}</span>
          </div>
        ))}
        {template.map(([s, e, code], i) => (
          <div key={i} className="pointer-events-none absolute left-0 right-0 border-l-2 border-dashed border-ink-200 pl-1 text-[10px] text-ink-300"
            style={{ top: top(toMin(s)), height: (toMin(e) - toMin(s)) * PX }}>{SLOT_LABEL[code] ?? code}</div>
        ))}
        <div className="pointer-events-none absolute left-0 right-0 bg-ink-100/80 text-center text-[10px] leading-[54px] text-ink-400" style={{ top: top(LUNCH_START), height: (LUNCH_END - LUNCH_START) * PX }}>Nghỉ trưa</div>
        {visible.map((e) => {
          const s = Math.max(WORK_START, minOfDay(e.start_at, day)), en = Math.min(WORK_END, minOfDay(e.end_at, day));
          const t = e.task_id ? d.tasks.find((x) => x.id === e.task_id) : undefined;
          const c = d.categoryOf(e.category_code ?? t?.category_code);
          return (
            <button key={e.id} onClick={() => onPick(e)} title={e.title}
              className={cx('absolute left-1 right-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm',
                e.event_type === 'buffer' ? 'border border-dashed border-ink-300 bg-ink-50 text-ink-500' : 'text-white', e.status === 'done' && 'opacity-50')}
              style={{ top: top(s), height: Math.max(16, (en - s) * PX - 2), backgroundColor: e.event_type === 'buffer' ? undefined : c?.color ?? '#475569' }}>
              <b>{hmLabel(minOfDay(e.start_at, day))}</b> {e.event_type === 'fixed' || e.locked ? '🔒 ' : ''}{e.title}
            </button>
          );
        })}
        {nowMin >= WORK_START && nowMin <= WORK_END && (
          <div className="pointer-events-none absolute left-0 right-0 border-t-2 border-red-500" style={{ top: top(nowMin) }} />
        )}
      </div>
      {outside > 0 && <p className="mt-1 text-[11px] text-ink-400">+{outside} lịch ngoài giờ làm việc.</p>}
      <p className="mt-1 text-[11px] text-ink-400">Bấm vào chỗ trống để thêm lịch. Khung mờ là gợi ý phân bổ, không khóa.</p>
    </div>
  );
}
