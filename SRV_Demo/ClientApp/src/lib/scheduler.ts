// Thuật toán đề xuất lịch – không AI, giải thích được (đặc tả mục 9).
// Chỉ trả về ĐỀ XUẤT; việc tạo lịch chỉ xảy ra khi người dùng bấm Xác nhận.
import type { CalendarEvent, Priority, Task } from './types';
import { addDays, vnParts, vnStartOfDay } from './time';

export const WORK_SEGMENTS: [number, number][] = [[8 * 60, 12 * 60], [13 * 60, 17 * 60]];
const STEP = 15;

export interface SchedulerInput {
  tasks: Task[];
  events: Pick<CalendarEvent, 'start_at' | 'end_at' | 'event_type' | 'status' | 'task_id'>[]; // đã mở rộng lịch lặp
  weekStart: Date;          // Thứ 2 00:00 giờ VN
  now: Date;
  bufferPercent: number;    // 20–35
  maxBlock: number;         // phút, mặc định 90
  template: Record<string, [string, string, string][]>; // '1'..'6'
  allowBuffer?: boolean;
  workingDays?: number[];   // ISO 1..7, mặc định 1..6
}

export interface Proposal { taskId: string; start: Date; end: Date; reasons: string[]; score: number }
export interface Unplaced { taskId: string; reason: string }
export interface SchedulerResult { proposals: Proposal[]; unplaced: Unplaced[]; warnings: string[]; ranking: { taskId: string; why: string }[] }

const PRI: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRI_LABEL: Record<Priority, string> = { urgent: 'khẩn', high: 'ưu tiên cao', normal: 'ưu tiên thường', low: 'ưu tiên thấp' };
const toMin = (s: string) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
const isStrategic = (t: Task) => t.category_code === 'E' || t.category_code === 'F';

/** Khoảng phút [s,e) trong ngày `day` của một sự kiện (cắt theo ngày). */
function minutesIn(day: Date, startIso: string, endIso: string): [number, number] | null {
  const s = (new Date(startIso).getTime() - day.getTime()) / 60_000, e = (new Date(endIso).getTime() - day.getTime()) / 60_000;
  if (e <= 0 || s >= 1440) return null;
  return [Math.max(0, s), Math.min(1440, e)];
}

function subtract(free: [number, number][], busy: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of free) {
    if (busy[1] <= a || busy[0] >= b) { out.push([a, b]); continue; }
    if (busy[0] > a) out.push([a, busy[0]]);
    if (busy[1] < b) out.push([busy[1], b]);
  }
  return out;
}

const segMinutes = (s: number, e: number) => WORK_SEGMENTS.reduce((acc, [a, b]) => acc + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);

export function proposeSchedule(inp: SchedulerInput): SchedulerResult {
  const { now, weekStart, maxBlock } = inp;
  const workingDays = inp.workingDays ?? [1, 2, 3, 4, 5, 6];
  const warnings: string[] = [];
  const active = inp.events.filter((e) => e.status !== 'cancelled');

  // 1) Ngày làm việc trong tuần (từ hôm nay), slot trống và sức chứa sau khi giữ dự phòng
  interface Day { day: Date; dow: number; free: [number, number][]; capacity: number; templ: [number, number, string][] }
  const days: Day[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const dow = vnParts(day).dow;
    if (!workingDays.includes(dow === 0 ? 7 : dow)) continue;
    if (addDays(day, 1) <= now) continue;
    let free: [number, number][] = WORK_SEGMENTS.map(([a, b]) => [a, b]);
    const nowMin = (now.getTime() - day.getTime()) / 60_000;
    if (nowMin > 0) free = subtract(free, [0, Math.ceil(nowMin / STEP) * STEP]);
    let used = 0;
    for (const e of active) {
      const r = minutesIn(day, e.start_at, e.end_at);
      if (!r) continue;
      if (e.event_type === 'buffer' && inp.allowBuffer) continue; // cho phép dùng khung dự phòng
      free = subtract(free, r);
      if (e.event_type !== 'buffer') used += segMinutes(r[0], r[1]);
    }
    const total = segMinutes(0, 1440);
    const reserve = inp.allowBuffer ? 0 : Math.round((total * inp.bufferPercent) / 100);
    const capacity = Math.max(0, total - reserve - used);
    const templ = (inp.template[String(dow)] ?? []).map(([s, e, c]) => [toMin(s), toMin(e), c] as [number, number, string]);
    days.push({ day, dow, free: free.filter(([a, b]) => b - a >= 30), capacity, templ });
  }

  // 2) Việc cần xếp: chưa xong, có ước tính, trừ phần đã có lịch từ nay về sau
  const scheduledAhead = new Map<string, number>();
  for (const e of active) {
    if (!e.task_id || new Date(e.end_at) <= now) continue;
    scheduledAhead.set(e.task_id, (scheduledAhead.get(e.task_id) ?? 0) + (new Date(e.end_at).getTime() - Math.max(now.getTime(), new Date(e.start_at).getTime())) / 60_000);
  }
  const strategicMinutes = active.filter((e) => e.task_id && inp.tasks.find((t) => t.id === e.task_id && isStrategic(t)))
    .reduce((a, e) => a + (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 60_000, 0);
  const strategicStarved = strategicMinutes < 180; // < 3 giờ chiến lược trong tuần

  const unplaced: Unplaced[] = [];
  const candidates = inp.tasks.filter((t) => ['todo', 'doing', 'paused'].includes(t.status) && t.task_type === 'self');
  for (const t of candidates) if (!t.estimated_minutes) unplaced.push({ taskId: t.id, reason: 'Chưa có thời lượng ước tính.' });
  const work = candidates.filter((t) => t.estimated_minutes)
    .map((t) => ({ t, remaining: Math.ceil(Math.max(0, t.estimated_minutes! - (scheduledAhead.get(t.id) ?? 0)) / STEP) * STEP }))
    .filter((x) => x.remaining >= 15);

  // 3) Xếp hạng: quá hạn → deadline gần → ưu tiên → chiến lược thiếu thời gian
  const rankKey = (t: Task) => [
    t.due_at && new Date(t.due_at) < now ? 0 : 1,
    t.due_at ? new Date(t.due_at).getTime() : Number.MAX_SAFE_INTEGER,
    PRI[t.priority],
    isStrategic(t) && strategicStarved ? 0 : 1,
  ];
  work.sort((a, b) => { const ka = rankKey(a.t), kb = rankKey(b.t); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  const ranking = work.map(({ t }) => ({
    taskId: t.id,
    why: [t.due_at && new Date(t.due_at) < now ? 'đã quá hạn' : t.due_at ? 'có deadline' : 'chưa có deadline', PRI_LABEL[t.priority],
      isStrategic(t) && strategicStarved ? 'chiến lược đang thiếu thời gian trong tuần' : ''].filter(Boolean).join(', '),
  }));

  // 4–6) Chia block và chọn slot tốt nhất
  const proposals: Proposal[] = [];
  for (const { t, remaining } of work) {
    let left = remaining;
    const blockMax = isStrategic(t) ? Math.max(maxBlock, 90) : maxBlock;
    const deadline = t.due_at ? new Date(t.due_at) : null;
    while (left >= 15) {
      // Block 30–blockMax phút; tránh để thừa một mẩu < 30'
      const size = left <= blockMax ? left : (left - blockMax < 30 ? left - 30 : blockMax);
      let best: { di: number; s: number; score: number; reasons: string[] } | null = null;
      for (let di = 0; di < days.length; di++) {
        const D = days[di];
        if (D.capacity < size) continue;
        for (const [a, b] of D.free) {
          for (let s = a; s + size <= b; s += STEP) {
            const e = s + size;
            const endAbs = new Date(D.day.getTime() + e * 60_000);
            if (deadline && endAbs > deadline && deadline > now) continue; // phải xong trước deadline
            let score = 0; const reasons: string[] = [];
            const slot = D.templ.find(([ts, te]) => s < te && e > ts);
            if (slot) {
              const code = slot[2];
              if (code === t.category_code || (code === 'EF' && isStrategic(t))) { score += 3; reasons.push('đúng khung ưu tiên nhóm ' + t.category_code); }
              else if (code === 'buffer') { score -= 2; }
            }
            if (deadline) { score += Math.max(0, 2 - di * 0.4); }
            if (isStrategic(t) && e <= 12 * 60) { score += 2; if (!reasons.some((r) => r.includes('buổi sáng'))) reasons.push('deep work buổi sáng'); }
            if (s === a || e === b) { score += 1; }
            if (e > 16 * 60 + 30) score -= 1.5;
            score -= di * 0.05; // sớm hơn một chút
            if (!best || score > best.score) best = { di, s, score, reasons };
          }
        }
      }
      if (!best) break;
      const D = days[best.di];
      const start = new Date(D.day.getTime() + best.s * 60_000), end = new Date(D.day.getTime() + (best.s + size) * 60_000);
      const reasons = [...best.reasons];
      if (deadline && deadline > now) reasons.push('kịp trước deadline');
      if (deadline && deadline <= now) reasons.push('việc đã quá hạn – xếp sớm nhất có thể');
      proposals.push({ taskId: t.id, start, end, reasons, score: Math.round(best.score * 10) / 10 });
      D.free = subtract(D.free, [best.s, best.s + size]).filter(([a, b]) => b - a >= 15);
      D.capacity -= size;
      left -= size;
    }
    if (left >= 15) {
      const infeasible = deadline && deadline > now && deadline < addDays(weekStart, 7);
      unplaced.push({ taskId: t.id, reason: infeasible
        ? `Không đủ thời gian trống trước deadline (còn thiếu ${Math.round(left)} phút). Gợi ý: chia nhỏ, đổi hạn hoặc giao bớt.`
        : `Tuần này không còn đủ chỗ trống (còn ${Math.round(left)} phút chưa xếp${inp.allowBuffer ? '' : '; đang giữ ' + inp.bufferPercent + '% dự phòng'}).` });
      if (infeasible) warnings.push(`“${t.title}”: deadline không khả thi với lịch hiện tại.`);
    }
  }
  return { proposals: proposals.sort((a, b) => a.start.getTime() - b.start.getTime()), unplaced, warnings, ranking };
}

/** Ngày bắt đầu tuần hiện tại tính từ `now` (tiện cho test). */
export const weekOf = (now: Date) => { const d = vnStartOfDay(now); const dow = vnParts(now).dow; return addDays(d, -((dow + 6) % 7)); };
