import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { must, supabase, toAppError } from './supabase';
import type { AppNotification, Category, Goal, Person, Profile, Task, TaskDraft } from './types';
import { NOTIF_LABEL } from './labels';
import { useAuth } from '../features/auth/AuthProvider';

interface DataState {
  loading: boolean;
  error: string | null;
  profiles: Profile[];
  people: Person[];
  categories: Category[];
  goals: Goal[];
  tasks: Task[];
  notifications: AppNotification[]; // của tài khoản đang đăng nhập, chưa được giải quyết
  online: string[]; // tên người đang mở app
  live: boolean;    // kết nối realtime đang hoạt động
}

interface DataApi extends DataState {
  reload: () => Promise<void>;
  createTask: (draft: TaskDraft & { title: string }) => Promise<Task>;
  /** Cập nhật có kiểm tra version: nếu người kia đã sửa trước sẽ ném AppError('conflict'). */
  updateTask: (task: Pick<Task, 'id' | 'version'>, patch: TaskDraft) => Promise<Task>;
  refreshTask: (id: string) => Promise<Task | null>;
  createPerson: (p: Pick<Person, 'full_name'> & Partial<Person>) => Promise<Person>;
  updatePerson: (p: Pick<Person, 'id' | 'version'>, patch: Partial<Person>) => Promise<Person>;
  profileName: (id: string | null | undefined) => string;
  personName: (id: string | null | undefined) => string;
  categoryOf: (code: string | null | undefined) => Category | undefined;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;
}

const Ctx = createContext<DataApi | null>(null);

type Row = { id: string; version?: number };
function upsert<T extends Row>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i < 0) return [...list, row];
  if ((list[i].version ?? 0) > (row.version ?? 0)) return list; // bỏ bản cũ đến muộn
  const next = list.slice();
  next[i] = row;
  return next;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [s, setS] = useState<DataState>({
    loading: true, error: null, profiles: [], people: [], categories: [], goals: [], tasks: [], notifications: [], online: [], live: false,
  });
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const [profiles, people, categories, goals, tasks, notifications] = await Promise.all([
        supabase.from('profiles').select('id,display_name,role,active').order('role').then(must<Profile[]>),
        supabase.from('people').select('*').order('full_name').then(must<Person[]>),
        supabase.from('categories').select('*').order('code').then(must<Category[]>),
        supabase.from('goals').select('*').order('due_date', { nullsFirst: false }).then(must<Goal[]>),
        supabase.from('tasks').select('*').order('due_at', { nullsFirst: false }).limit(5000).then(must<Task[]>),
        supabase.from('notifications').select('*').is('resolved_at', null).order('scheduled_at').limit(1000).then(must<AppNotification[]>),
      ]);
      if (mounted.current) setS((o) => ({ ...o, loading: false, error: null, profiles, people, categories, goals, tasks, notifications }));
    } catch (e) {
      if (mounted.current) setS((o) => ({ ...o, loading: false, error: toAppError(e).message }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
  }, [reload]);

  // Realtime: thay đổi của người kia hiện ngay; presence: ai đang mở app
  useEffect(() => {
    if (!profile) return;
    const apply = <K extends 'tasks' | 'people' | 'goals'>(key: K) =>
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        setS((o) => {
          const list = o[key] as unknown as Row[];
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as Row).id;
            return { ...o, [key]: list.filter((x) => x.id !== id) };
          }
          return { ...o, [key]: upsert(list, payload.new as unknown as Row) };
        });
      };
    const ch = supabase
      .channel('workspace', { config: { presence: { key: profile.id } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, apply('tasks'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, apply('people'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, apply('goals'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as AppNotification;
        if (payload.eventType === 'INSERT' && !n.read_at) browserNotify(n);
        setS((o) => ({
          ...o,
          notifications: n.resolved_at
            ? o.notifications.filter((x) => x.id !== n.id)
            : upsert(o.notifications, n),
        }));
      })
      .on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState<{ name: string }>();
        const names = Object.values(st).flat().map((x) => x.name);
        setS((o) => ({ ...o, online: Array.from(new Set(names)) }));
      })
      .subscribe((status) => {
        setS((o) => ({ ...o, live: status === 'SUBSCRIBED' }));
        if (status === 'SUBSCRIBED') {
          ch.track({ name: profile.display_name });
          reload(); // đồng bộ lại sau khi (tái) kết nối để không lỡ thay đổi
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [profile, reload]);

  const createTask = useCallback<DataApi['createTask']>(async (draft) => {
    const row = must(await supabase.from('tasks').insert(draft).select().single()) as Task;
    setS((o) => ({ ...o, tasks: upsert(o.tasks, row) }));
    return row;
  }, []);

  const updateTask = useCallback<DataApi['updateTask']>(async (task, patch) => {
    const res = await supabase.from('tasks').update({ ...patch, version: task.version }).eq('id', task.id).select().single();
    const row = must(res) as Task;
    setS((o) => ({ ...o, tasks: upsert(o.tasks, row) }));
    return row;
  }, []);

  const refreshTask = useCallback<DataApi['refreshTask']>(async (id) => {
    const res = await supabase.from('tasks').select('*').eq('id', id).maybeSingle();
    const row = must(res) as Task | null;
    if (row) setS((o) => ({ ...o, tasks: o.tasks.map((t) => (t.id === id ? row : t)) }));
    return row;
  }, []);

  const createPerson = useCallback<DataApi['createPerson']>(async (p) => {
    const row = must(await supabase.from('people').insert(p).select().single()) as Person;
    setS((o) => ({ ...o, people: upsert(o.people, row) }));
    return row;
  }, []);

  const updatePerson = useCallback<DataApi['updatePerson']>(async (p, patch) => {
    const row = must(await supabase.from('people').update({ ...patch, version: p.version }).eq('id', p.id).select().single()) as Person;
    setS((o) => ({ ...o, people: upsert(o.people, row) }));
    return row;
  }, []);

  const refreshNotifications = useCallback(async () => {
    const { error } = await supabase.rpc('refresh_notifications');
    if (error) return;
    const r = await supabase.from('notifications').select('*').is('resolved_at', null).order('scheduled_at').limit(1000);
    if (!r.error && mounted.current) setS((o) => ({ ...o, notifications: r.data as AppNotification[] }));
  }, []);

  const markNotificationsRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const at = new Date().toISOString();
    setS((o) => ({ ...o, notifications: o.notifications.map((n) => (ids.includes(n.id) ? { ...n, read_at: at } : n)) }));
    await supabase.from('notifications').update({ read_at: at }).in('id', ids);
  }, []);

  // Làm mới nhắc việc khi mở app, mỗi 5 phút, và ngay sau khi công việc thay đổi
  useEffect(() => {
    if (!profile) return;
    refreshNotifications();
    const t = setInterval(refreshNotifications, 5 * 60_000);
    return () => clearInterval(t);
  }, [profile, refreshNotifications]);
  const taskSig = s.tasks.reduce((a, t) => a + t.version, 0) + ':' + s.tasks.length;
  useEffect(() => {
    if (!profile || s.loading) return;
    const t = setTimeout(refreshNotifications, 1500);
    return () => clearTimeout(t);
  }, [taskSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo<DataApi>(() => {
    const prof = new Map(s.profiles.map((p) => [p.id, p.display_name]));
    const ppl = new Map(s.people.map((p) => [p.id, p.full_name]));
    const cat = new Map(s.categories.map((c) => [c.code as string, c]));
    return {
      ...s, reload, createTask, updateTask, refreshTask, createPerson, updatePerson, refreshNotifications, markNotificationsRead,
      profileName: (id) => (id ? prof.get(id) ?? '—' : ''),
      personName: (id) => (id ? ppl.get(id) ?? '—' : ''),
      categoryOf: (code) => (code ? cat.get(code) : undefined),
    };
  }, [s, reload, createTask, updateTask, refreshTask, createPerson, updatePerson, refreshNotifications, markNotificationsRead]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useData(): DataApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData phải nằm trong DataProvider');
  return v;
}

/** Tên người thực hiện (tài khoản hoặc danh bạ). */
export function assigneeName(t: Task, d: Pick<DataApi, 'profileName' | 'personName'>): string {
  if (t.assignee_profile_id) return d.profileName(t.assignee_profile_id);
  if (t.assignee_person_id) return d.personName(t.assignee_person_id);
  return '';
}

/** Thông báo trình duyệt — chỉ khi người dùng đã cấp quyền và tab đang mở. */
function browserNotify(n: AppNotification) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification('SORA – ' + NOTIF_LABEL[n.kind], { body: 'Mở mục Nhắc việc để xem chi tiết.', tag: n.dedupe_key });
  } catch { /* trình duyệt không hỗ trợ */ }
}
