import type {
  AppNotification, AuditLog, CalendarEvent, Category, Goal, Person, Profile, Role, Task, TaskDraft, TaskLink, TaskUpdate, UserAccount,
  WeeklyPriority,
} from './types';
import type { RecurrenceException } from './recurrence';

/**
 * REST client for the ASP.NET Core backend (replaces @supabase/supabase-js).
 * Same origin as the page: in production the SPA is served from /app/ by the same host as /api; in `npm run dev`
 * Vite proxies /api and /hubs to the ASP.NET dev server (see vite.config.ts).
 * Contract: docs/API.md.
 */

/** Normalised error shown in Vietnamese in the UI. `kind` drives special handling (e.g. version conflict). */
export class AppError extends Error {
  constructor(message: string, public kind: 'conflict' | 'validation' | 'permission' | 'auth' | 'network' | 'other' = 'other', public code?: string) {
    super(message);
  }
}

export function toAppError(e: unknown): AppError {
  if (!e) return new AppError('Lỗi không xác định');
  if (e instanceof AppError) return e;
  const msg = (e as { message?: string }).message ?? String(e);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new AppError('Mất kết nối mạng. Thử lại khi có mạng.', 'network');
  return new AppError(msg);
}

export const UNAUTHORIZED_EVENT = 'sora:unauthorized';

type Query = Record<string, string | number | boolean | null | undefined>;

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let url = '/api' + path;
  if (query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    const s = q.toString();
    if (s) url += '?' + s;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'sora', // CSRF guard required by the server on every non-GET call
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AppError('Mất kết nối mạng. Thử lại khi có mạng.', 'network');
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { /* non-JSON error page */ } }

  if (!res.ok) {
    const err = (data ?? {}) as { code?: string; message?: string };
    const message = err.message ?? `Lỗi máy chủ (${res.status}).`;
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const kind = res.status === 409 && err.code === 'version_conflict' ? 'conflict'
      : res.status === 401 ? 'auth'
      : res.status === 403 ? 'permission'
      : res.status === 400 || res.status === 422 ? 'validation' : 'other';
    throw new AppError(message, kind, err.code);
  }
  return data as T;
}

const get = <T>(p: string, q?: Query) => request<T>('GET', p, undefined, q);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b);
const del = (p: string) => request<void>('DELETE', p);

export interface Bootstrap {
  profiles: Profile[];
  people: Person[];
  categories: Category[];
  goals: Goal[];
  tasks: Task[];
  notifications: AppNotification[];
}

export interface EventWindow {
  single: CalendarEvent[];
  recurring: CalendarEvent[];
  exceptions: RecurrenceException[];
}

export const api = {
  // ---- auth / account ----
  login: (email: string, password: string) => post<Profile>('/auth/login', { email, password }),
  logout: () => post<void>('/auth/logout'),
  /** Current account, or undefined (HTTP 204) when signed out. */
  me: () => get<Profile | undefined>('/auth/me'),
  changePassword: (current_password: string, new_password: string) => post<void>('/auth/password', { current_password, new_password }),
  updateMe: (display_name: string) => patch<Profile>('/me', { display_name }),

  // ---- account administration (admin / director) ----
  users: () => get<UserAccount[]>('/users'),
  createUser: (b: { email: string; display_name: string; role: Role; password: string }) => post<UserAccount>('/users', b),
  /** Sets another account's password and signs that account out of every browser. */
  setUserPassword: (id: string, new_password: string) => put<void>(`/users/${id}/password`, { new_password }),

  // ---- data ----
  bootstrap: () => get<Bootstrap>('/bootstrap'),
  settings: () => get<{ key: string; value: unknown }[]>('/settings'),
  putSetting: (key: string, value: unknown) => put<void>(`/settings/${encodeURIComponent(key)}`, { value }),
  audit: (q: { table?: string; record_id?: string; actor_id?: string; before_id?: number; limit?: number }) => get<AuditLog[]>('/audit', q),

  // ---- tasks ----
  getTask: (id: string) => get<Task>(`/tasks/${id}`),
  createTask: (draft: TaskDraft) => post<Task>('/tasks', draft),
  /** `version` must be the version the user was editing; the server answers 409 version_conflict if someone saved first. */
  updateTask: (id: string, version: number, p: TaskDraft) => patch<Task>(`/tasks/${id}`, { ...p, version }),
  taskUpdates: (taskId: string) => get<TaskUpdate[]>(`/tasks/${taskId}/updates`),
  addTaskUpdate: (taskId: string, b: { note: string; channel?: string | null; next_follow_up_at?: string | null; progress_percent?: number | null }) =>
    post<TaskUpdate>(`/tasks/${taskId}/updates`, b),
  taskUpdatesFor: (taskIds: string[], limit = 1000) => get<TaskUpdate[]>('/task-updates', { task_ids: taskIds.join(','), limit }),
  taskUpdatesRange: (from: string, to: string) => get<TaskUpdate[]>('/task-updates', { from, to, limit: 5000 }),
  taskLinks: (taskId: string) => get<TaskLink[]>(`/tasks/${taskId}/links`),
  addTaskLink: (taskId: string, b: { url: string; label: string | null }) => post<TaskLink>(`/tasks/${taskId}/links`, b),
  deleteLink: (id: string) => del(`/links/${id}`),

  // ---- people / goals ----
  createPerson: (p: Partial<Person>) => post<Person>('/people', p),
  updatePerson: (id: string, version: number, p: Partial<Person>) => patch<Person>(`/people/${id}`, { ...p, version }),
  createGoal: (g: Partial<Goal>) => post<Goal>('/goals', g),
  updateGoal: (id: string, version: number, g: Partial<Goal>) => patch<Goal>(`/goals/${id}`, { ...g, version }),

  // ---- calendar ----
  events: (from: string, to: string) => get<EventWindow>('/events', { from, to }),
  getEvent: (id: string) => get<CalendarEvent>(`/events/${id}`),
  createEvent: (e: Partial<CalendarEvent>) => post<CalendarEvent>('/events', e),
  createEvents: (rows: Partial<CalendarEvent>[]) => post<CalendarEvent[]>('/events', rows),
  updateEvent: (id: string, version: number, p: Partial<CalendarEvent>) => patch<CalendarEvent>(`/events/${id}`, { ...p, version }),
  deleteEvent: (id: string) => del(`/events/${id}`),
  createException: (b: { parent_event_id: string; occurrence_start_at: string; action: 'skip' | 'replace'; replacement_event_id?: string }) =>
    post<RecurrenceException>('/event-exceptions', b),

  // ---- weekly top 3 ----
  weeklyPriorities: (weekStart: string) => get<WeeklyPriority[]>('/weekly-priorities', { week_start: weekStart }),
  setPriority: (weekStart: string, rank: number, taskId: string | null) =>
    put<WeeklyPriority[]>(`/weekly-priorities/${weekStart}/${rank}`, { task_id: taskId }),

  // ---- reminders ----
  refreshNotifications: () => post<{ created: number; notifications: AppNotification[] }>('/notifications/refresh'),
  markNotificationsRead: (ids: string[]) => post<void>('/notifications/read', { ids }),
};
