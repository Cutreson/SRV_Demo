import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, toAppError } from './api';
import { realtime, debounce, type ChangeEvent } from './realtime';
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
  /** Accounts that take part in the workflow (director, secretary) — use for pickers/filters. `profiles` also holds the admin. */
  staff: Profile[];
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
      const b = await api.bootstrap();
      if (mounted.current) setS((o) => ({ ...o, loading: false, error: null, ...b }));
    } catch (e) {
      if (mounted.current) setS((o) => ({ ...o, loading: false, error: toAppError(e).message }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
  }, [reload]);

  // Realtime (SignalR): thay đổi của người kia hiện ngay; presence: ai đang mở app
  useEffect(() => {
    if (!profile) return;
    const apply = <K extends 'tasks' | 'people' | 'goals'>(key: K) => (e: ChangeEvent) => {
      setS((o) => {
        const list = o[key] as unknown as Row[];
        if (e.action === 'DELETE') return { ...o, [key]: list.filter((x) => x.id !== (e.row as unknown as Row).id) };
        return { ...o, [key]: upsert(list, e.row as unknown as Row) };
      });
    };
    const offs = [
      realtime.on('tasks', apply('tasks')),
      realtime.on('people', apply('people')),
      realtime.on('goals', apply('goals')),
      realtime.on('profiles', () => { void reload(); }),
      realtime.on('notifications', (e) => {
        const n = e.row as unknown as AppNotification;
        if (e.action === 'INSERT' && !n.read_at) browserNotify(n);
        setS((o) => ({
          ...o,
          notifications: n.resolved_at ? o.notifications.filter((x) => x.id !== n.id) : upsert(o.notifications, n),
        }));
      }),
      realtime.onPresence((names) => setS((o) => ({ ...o, online: Array.from(new Set(names)) }))),
    ];
    let wasLive = false;
    offs.push(realtime.onStatus((live) => {
      setS((o) => ({ ...o, live }));
      if (live && wasLive === false) { wasLive = true; reload(); } // đồng bộ lại sau khi (tái) kết nối để không lỡ thay đổi
      if (!live) wasLive = false;
    }));
    return () => { offs.forEach((off) => off()); };
  }, [profile, reload]);

  const createTask = useCallback<DataApi['createTask']>(async (draft) => {
    const row = await api.createTask(draft);
    setS((o) => ({ ...o, tasks: upsert(o.tasks, row) }));
    return row;
  }, []);

  const updateTask = useCallback<DataApi['updateTask']>(async (task, patch) => {
    const row = await api.updateTask(task.id, task.version, patch);
    setS((o) => ({ ...o, tasks: upsert(o.tasks, row) }));
    return row;
  }, []);

  const refreshTask = useCallback<DataApi['refreshTask']>(async (id) => {
    try {
      const row = await api.getTask(id);
      setS((o) => ({ ...o, tasks: o.tasks.some((t) => t.id === id) ? o.tasks.map((t) => (t.id === id ? row : t)) : [...o.tasks, row] }));
      return row;
    } catch (e) {
      if (toAppError(e).code === 'not_found') return null;
      throw e;
    }
  }, []);

  const createPerson = useCallback<DataApi['createPerson']>(async (p) => {
    const row = await api.createPerson(p);
    setS((o) => ({ ...o, people: upsert(o.people, row) }));
    return row;
  }, []);

  const updatePerson = useCallback<DataApi['updatePerson']>(async (p, patch) => {
    const row = await api.updatePerson(p.id, p.version, patch);
    setS((o) => ({ ...o, people: upsert(o.people, row) }));
    return row;
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const r = await api.refreshNotifications();
      if (mounted.current) setS((o) => ({ ...o, notifications: r.notifications }));
    } catch { /* thử lại ở lần sau */ }
  }, []);

  const markNotificationsRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const at = new Date().toISOString();
    setS((o) => ({ ...o, notifications: o.notifications.map((n) => (ids.includes(n.id) ? { ...n, read_at: at } : n)) }));
    try { await api.markNotificationsRead(ids); } catch { /* đã cập nhật tạm trên giao diện */ }
  }, []);

  // Làm mới nhắc việc khi mở app, mỗi 5 phút, và ngay sau khi công việc thay đổi
  useEffect(() => {
    if (!profile) return;
    refreshNotifications();
    const t = setInterval(refreshNotifications, 5 * 60_000);
    return () => clearInterval(t);
  }, [profile, refreshNotifications]);

  const refreshSoon = useMemo(() => debounce(() => { void refreshNotifications(); }, 1500), [refreshNotifications]);
  const taskSig = s.tasks.reduce((a, t) => a + t.version, 0) + ':' + s.tasks.length;
  useEffect(() => {
    if (!profile || s.loading) return;
    refreshSoon();
    return () => refreshSoon.cancel();
  }, [taskSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const api_ = useMemo<DataApi>(() => {
    const prof = new Map(s.profiles.map((p) => [p.id, p.display_name]));
    const ppl = new Map(s.people.map((p) => [p.id, p.full_name]));
    const cat = new Map(s.categories.map((c) => [c.code as string, c]));
    return {
      ...s, staff: s.profiles.filter((p) => p.role !== 'admin'), reload, createTask, updateTask, refreshTask, createPerson, updatePerson, refreshNotifications, markNotificationsRead,
      profileName: (id) => (id ? prof.get(id) ?? '—' : ''),
      personName: (id) => (id ? ppl.get(id) ?? '—' : ''),
      categoryOf: (code) => (code ? cat.get(code) : undefined),
    };
  }, [s, reload, createTask, updateTask, refreshTask, createPerson, updatePerson, refreshNotifications, markNotificationsRead]);

  return <Ctx.Provider value={api_}>{children}</Ctx.Provider>;
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
