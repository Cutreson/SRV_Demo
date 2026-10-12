import type { CalendarEvent, Task, TaskUpdate } from './types';
import { addDays, vnDateKey, vnParts } from './time';
import { freeMinutes } from '../features/calendar/calendarRules';

const OPEN = ['todo', 'doing', 'waiting', 'paused'];
const inRange = (iso: string | null, a: Date, b: Date) => !!iso && new Date(iso) >= a && new Date(iso) < b;

export interface WeeklyReport {
  created: Task[];
  completed: Task[];
  overdueOpen: Task[];            // đang mở và đã quá hạn tại thời điểm cuối kỳ (hoặc bây giờ nếu tuần chưa hết)
  delegatedPending: Task[];
  missedFollowUps: Task[];         // có ngày follow-up trong kỳ (đã qua) nhưng không có log nhắc từ ngày đó
  scheduledByCat: Record<string, number>; // phút
  actualByCat: Record<string, number>;    // phút – lịch được đánh dấu “đã xong”
  totalScheduled: number;
  strategicShare: number;          // % E+F trên tổng giờ đã lên lịch
  bufferUsedShare: number;         // % phần dự phòng bị dùng
}

export function weeklyReport(inp: {
  tasks: Task[]; updates: Pick<TaskUpdate, 'task_id' | 'created_at'>[]; events: CalendarEvent[]; weekStart: Date; now: Date; bufferPercent: number;
}): WeeklyReport {
  const { tasks, updates, events, weekStart, now } = inp;
  const weekEnd = addDays(weekStart, 7);
  const cutoff = now < weekEnd ? now : weekEnd;
  const created = tasks.filter((t) => inRange(t.created_at, weekStart, weekEnd));
  const completed = tasks.filter((t) => t.status === 'done' && inRange(t.completed_at, weekStart, weekEnd));
  const overdueOpen = tasks.filter((t) => OPEN.includes(t.status) && t.due_at && new Date(t.due_at) < cutoff);
  const delegatedPending = tasks.filter((t) => t.task_type === 'delegated' && OPEN.includes(t.status));
  const missedFollowUps = tasks.filter((t) => {
    if (t.task_type !== 'delegated' || !t.next_follow_up_at) return false;
    const fu = new Date(t.next_follow_up_at);
    if (!(fu >= weekStart && fu < cutoff)) return false;
    // Hạn follow-up đã qua ít nhất nửa ngày làm việc mà không có log nhắc nào kể từ (fu - 1 ngày)
    if (cutoff.getTime() - fu.getTime() < 4 * 3600_000) return false;
    return !updates.some((u) => u.task_id === t.id && new Date(u.created_at) >= addDays(fu, -1));
  });

  const scheduledByCat: Record<string, number> = {}, actualByCat: Record<string, number> = {};
  const catOf = (e: CalendarEvent) => e.category_code ?? tasks.find((t) => t.id === e.task_id)?.category_code ?? '—';
  const perDay = new Map<string, [number, number][]>();
  for (const e of events) {
    if (e.status === 'cancelled' || e.event_type === 'buffer') continue;
    if (!(new Date(e.start_at) < weekEnd && new Date(e.end_at) > weekStart)) continue;
    const mins = (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 60_000;
    const c = catOf(e);
    scheduledByCat[c] = (scheduledByCat[c] ?? 0) + mins;
    if (e.status === 'done') actualByCat[c] = (actualByCat[c] ?? 0) + mins;
    const key = vnDateKey(e.start_at);
    const dayStart = new Date(key + 'T00:00:00+07:00');
    const s = (new Date(e.start_at).getTime() - dayStart.getTime()) / 60_000, en = (new Date(e.end_at).getTime() - dayStart.getTime()) / 60_000;
    perDay.set(key, [...(perDay.get(key) ?? []), [s, Math.min(en, 1440)]]);
  }
  const totalScheduled = Object.values(scheduledByCat).reduce((a, b) => a + b, 0);
  const strategic = (scheduledByCat.E ?? 0) + (scheduledByCat.F ?? 0);

  let reserveTotal = 0, reserveUsed = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    if (vnParts(day).dow === 0) continue;
    const f = freeMinutes(perDay.get(vnDateKey(day)) ?? [], inp.bufferPercent, true);
    reserveTotal += f.reserve;
    reserveUsed += Math.max(0, Math.min(f.reserve, f.busy - (f.total - f.reserve)));
  }
  return {
    created, completed, overdueOpen, delegatedPending, missedFollowUps, scheduledByCat, actualByCat, totalScheduled,
    strategicShare: totalScheduled ? Math.round((strategic / totalScheduled) * 100) : 0,
    bufferUsedShare: reserveTotal ? Math.round((reserveUsed / reserveTotal) * 100) : 0,
  };
}

/** CSV an toàn cho Excel (BOM UTF-8, dấu ; không dùng; escape "). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s; // chống CSV injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
