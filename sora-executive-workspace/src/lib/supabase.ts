import { createClient, type PostgrestError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } },
});

/** Lỗi chuẩn hóa để hiển thị tiếng Việt. */
export class AppError extends Error {
  constructor(message: string, public kind: 'conflict' | 'validation' | 'permission' | 'network' | 'other' = 'other') {
    super(message);
  }
}

export function toAppError(e: PostgrestError | Error | null | unknown): AppError {
  if (!e) return new AppError('Lỗi không xác định');
  if (e instanceof AppError) return e;
  const err = e as Partial<PostgrestError> & { message?: string };
  const msg = err.message ?? String(e);
  if (err.code === 'PT409' || msg.includes('version_conflict')) {
    return new AppError('Người kia vừa cập nhật bản ghi này. Hãy tải lại để xem thay đổi mới nhất rồi sửa tiếp.', 'conflict');
  }
  if (err.code === '23514') {
    if (msg.includes('tasks_done_requires_result')) return new AppError('Cần ghi kết quả trước khi đánh dấu Hoàn thành.', 'validation');
    if (msg.includes('tasks_one_assignee')) return new AppError('Chỉ chọn một người thực hiện.', 'validation');
    return new AppError('Dữ liệu không hợp lệ: ' + msg, 'validation');
  }
  if (err.code === '42501') return new AppError('Tài khoản không có quyền thực hiện thao tác này.', 'permission');
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new AppError('Mất kết nối mạng. Thử lại khi có mạng.', 'network');
  return new AppError(msg);
}

export function must<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}
