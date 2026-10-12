import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { must, supabase } from './supabase';
import type { CalendarEvent } from './types';
import { expandEvents, type RecurrenceException, type ShownEvent } from './recurrence';

/** Lịch trong khoảng [from, to) — gồm cả lần lặp của sự kiện lặp lại; tự cập nhật realtime. */
export function useEvents(from: Date, to: Date) {
  const [raw, setRaw] = useState<CalendarEvent[]>([]);
  const [exc, setExc] = useState<RecurrenceException[]>([]);
  const [loading, setLoading] = useState(true);
  const fromIso = from.toISOString(), toIso = to.toISOString();
  const chId = useRef(Math.random().toString(36).slice(2));

  const load = useCallback(async () => {
    const [single, recurring, exceptions] = await Promise.all([
      supabase.from('calendar_events').select('*').is('recurrence_rule', null).lt('start_at', toIso).gt('end_at', fromIso).then(must<CalendarEvent[]>),
      supabase.from('calendar_events').select('*').not('recurrence_rule', 'is', null).lt('start_at', toIso).then(must<CalendarEvent[]>),
      supabase.from('recurrence_exceptions').select('*').gte('occurrence_start_at', fromIso).lt('occurrence_start_at', toIso).then(must<RecurrenceException[]>),
    ]);
    setRaw([...single, ...recurring]); setExc(exceptions); setLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`events-${chId.current}-${fromIso}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurrence_exceptions' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, fromIso]);

  const events: ShownEvent[] = useMemo(() => expandEvents(raw, exc, new Date(fromIso), new Date(toIso)), [raw, exc, fromIso, toIso]);
  return { events, raw, loading, reload: load };
}

export { overlaps } from './time';
