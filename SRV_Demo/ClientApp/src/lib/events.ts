import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { debounce, realtime } from './realtime';
import type { CalendarEvent } from './types';
import { expandEvents, type RecurrenceException, type ShownEvent } from './recurrence';

/** Lịch trong khoảng [from, to) — gồm cả lần lặp của sự kiện lặp lại; tự cập nhật realtime. */
export function useEvents(from: Date, to: Date) {
  const [raw, setRaw] = useState<CalendarEvent[]>([]);
  const [exc, setExc] = useState<RecurrenceException[]>([]);
  const [loading, setLoading] = useState(true);
  const fromIso = from.toISOString(), toIso = to.toISOString();

  const load = useCallback(async () => {
    try {
      const r = await api.events(fromIso, toIso);
      setRaw([...r.single, ...r.recurring]);
      setExc(r.exceptions);
    } finally {
      setLoading(false);
    }
  }, [fromIso, toIso]);

  useEffect(() => {
    void load();
    // A batch insert emits many events; reload once.
    const again = debounce(() => { void load(); }, 150);
    const offs = [realtime.on('calendar_events', again), realtime.on('recurrence_exceptions', again)];
    return () => { again.cancel(); offs.forEach((off) => off()); };
  }, [load]);

  const events: ShownEvent[] = useMemo(() => expandEvents(raw, exc, new Date(fromIso), new Date(toIso)), [raw, exc, fromIso, toIso]);
  return { events, raw, loading, reload: load };
}

export { overlaps } from './time';
