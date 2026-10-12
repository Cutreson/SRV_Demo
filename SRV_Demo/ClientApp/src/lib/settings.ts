import { useEffect, useState } from 'react';
import { api } from './api';

export type TemplateSlot = [string, string, string]; // [bắt đầu, kết thúc, mã khung: A..F | EF | buffer | review | followup | decide | due | backlog | plan]
export interface AppSettings {
  working_days: number[];
  buffer_percent: number;
  max_block_minutes: number;
  due_soon_days: number[];
  daily_template: Record<string, TemplateSlot[]>; // khóa: '1'..'6' = Thứ 2..Thứ 7
}

export const DEFAULT_SETTINGS: AppSettings = {
  working_days: [1, 2, 3, 4, 5, 6], buffer_percent: 25, max_block_minutes: 90, due_soon_days: [1, 3, 7], daily_template: {},
};

export const SLOT_LABEL: Record<string, string> = {
  review: 'Rà soát', followup: 'Follow-up', decide: 'Giao việc & quyết định', due: 'Hoàn thành việc đến hạn', backlog: 'Xử lý tồn quan trọng',
  plan: 'Lập kế hoạch tuần tới', buffer: 'Dự phòng / phát sinh', EF: 'Mục tiêu E/F',
  A: 'Điều hành A', B: 'Dự án B', C: 'Nhân sự C', D: 'Khách hàng D', E: 'Hệ thống E (deep work)', F: 'Chiến lược F (deep work)',
};

let cache: AppSettings | null = null;

export function useSettings(): AppSettings {
  const [s, setS] = useState<AppSettings>(cache ?? DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    api.settings().then((rows) => {
      if (!alive) return;
      const m = Object.fromEntries(rows.map((x) => [x.key, x.value]));
      cache = { ...DEFAULT_SETTINGS, ...m } as AppSettings;
      cache.buffer_percent = Math.min(35, Math.max(20, Number(cache.buffer_percent) || 25));
      setS(cache);
    }).catch(() => { /* giữ giá trị mặc định */ });
    return () => { alive = false; };
  }, []);
  return s;
}

/** Forget cached settings (called after saving them). */
export function clearSettingsCache() { cache = null; }
