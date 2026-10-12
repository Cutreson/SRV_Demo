// Lịch lặp theo tập con RRULE: FREQ=DAILY|WEEKLY; INTERVAL; BYDAY=MO,TU,…; COUNT; UNTIL=YYYYMMDD[THHMMSSZ]
// Giờ trong ngày giữ nguyên theo giờ Việt Nam của sự kiện gốc.
import type { CalendarEvent } from './types';
import { addDays, vnDate, vnParts, vnStartOfDay } from './time';

export interface Rule {
  freq: 'DAILY' | 'WEEKLY';
  interval: number;
  byday: number[]; // 0=CN … 6=T7
  count?: number;
  until?: Date;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRule(rule: string): Rule | null {
  const parts = Object.fromEntries(rule.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((kv) => {
    const [k, v] = kv.split('='); return [k.toUpperCase(), (v ?? '').toUpperCase()];
  }));
  if (parts.FREQ !== 'DAILY' && parts.FREQ !== 'WEEKLY') return null;
  const r: Rule = { freq: parts.FREQ, interval: Math.max(1, parseInt(parts.INTERVAL || '1', 10) || 1), byday: [] };
  if (parts.BYDAY) r.byday = parts.BYDAY.split(',').map((d: string) => DAYS.indexOf(d.slice(-2))).filter((x: number) => x >= 0);
  if (parts.COUNT) r.count = Math.max(1, parseInt(parts.COUNT, 10));
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(parts.UNTIL);
    if (m) r.until = m[4] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : vnDate(+m[1], +m[2], +m[3], 23, 59);
  }
  return r;
}

export function buildRule(r: Rule): string {
  const s = [`FREQ=${r.freq}`];
  if (r.interval > 1) s.push(`INTERVAL=${r.interval}`);
  if (r.byday.length) s.push(`BYDAY=${r.byday.map((d) => DAYS[d]).join(',')}`);
  if (r.count) s.push(`COUNT=${r.count}`);
  if (r.until) {
    const p = vnParts(r.until);
    s.push(`UNTIL=${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`);
  }
  return s.join(';');
}

/** Mô tả tiếng Việt ngắn gọn. */
export function describeRule(rule: string | null): string {
  if (!rule) return '';
  const r = parseRule(rule);
  if (!r) return 'Lặp lại (không hỗ trợ hiển thị)';
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  let s = r.freq === 'DAILY' ? (r.interval > 1 ? `Mỗi ${r.interval} ngày` : 'Hằng ngày') : (r.interval > 1 ? `Mỗi ${r.interval} tuần` : 'Hằng tuần');
  if (r.byday.length) s += ' vào ' + r.byday.map((d) => wd[d]).join(', ');
  if (r.count) s += `, ${r.count} lần`;
  if (r.until) { const p = vnParts(r.until); s += `, đến ${p.d}/${p.m}/${p.y}`; }
  return s;
}

export interface Occurrence { start: Date; end: Date }

/** Liệt kê các lần xảy ra giao với [from, to). Giới hạn an toàn 2000 lần lặp. */
export function occurrences(startAt: Date, endAt: Date, rule: string, from: Date, to: Date): Occurrence[] {
  const r = parseRule(rule);
  const dur = endAt.getTime() - startAt.getTime();
  if (!r) return startAt < to && endAt > from ? [{ start: startAt, end: endAt }] : [];
  const sp = vnParts(startAt);
  const firstDay = vnStartOfDay(startAt);
  const firstWeekMon = addDays(firstDay, -((sp.dow + 6) % 7));
  const byday = r.byday.length ? r.byday : (r.freq === 'WEEKLY' ? [sp.dow] : []);
  const out: Occurrence[] = [];
  let n = 0;
  for (let i = 0; i < 2000; i++) {
    const day = addDays(firstDay, i);
    const p = vnParts(day);
    const s = vnDate(p.y, p.m, p.d, sp.hh, sp.mm);
    if (s >= to) break;
    if (r.until && s > r.until) break;
    let hit: boolean;
    if (r.freq === 'DAILY') hit = i % r.interval === 0 && (byday.length === 0 || byday.includes(p.dow));
    else {
      const weeks = Math.floor((day.getTime() - firstWeekMon.getTime()) / (7 * 86_400_000));
      hit = weeks % r.interval === 0 && byday.includes(p.dow);
    }
    if (!hit || s < startAt) continue;
    n++;
    if (r.count && n > r.count) break;
    const e = new Date(s.getTime() + dur);
    if (e > from) out.push({ start: s, end: e });
  }
  return out;
}

export interface RecurrenceException {
  parent_event_id: string;
  occurrence_start_at: string;
  action: 'skip' | 'replace';
  replacement_event_id: string | null;
}

/** Sự kiện hiển thị: lần lặp mang id dạng `<parentId>@<isoStart>` và `parentId`. */
export type ShownEvent = CalendarEvent & { parentId?: string; occurrenceStart?: string };

export function expandEvents(events: CalendarEvent[], exceptions: RecurrenceException[], from: Date, to: Date): ShownEvent[] {
  const skip = new Set(exceptions.map((x) => `${x.parent_event_id}|${new Date(x.occurrence_start_at).getTime()}`));
  const out: ShownEvent[] = [];
  for (const e of events) {
    if (e.status === 'cancelled') continue;
    if (!e.recurrence_rule) {
      if (new Date(e.start_at) < to && new Date(e.end_at) > from) out.push(e);
      continue;
    }
    for (const o of occurrences(new Date(e.start_at), new Date(e.end_at), e.recurrence_rule, from, to)) {
      if (skip.has(`${e.id}|${o.start.getTime()}`)) continue;
      out.push({ ...e, id: `${e.id}@${o.start.toISOString()}`, start_at: o.start.toISOString(), end_at: o.end.toISOString(),
        parentId: e.id, occurrenceStart: o.start.toISOString() });
    }
  }
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}
