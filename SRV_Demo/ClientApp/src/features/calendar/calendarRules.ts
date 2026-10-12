import { vnParts } from '../../lib/time';

export const WORK_START = 8 * 60, LUNCH_START = 12 * 60, LUNCH_END = 13 * 60, WORK_END = 17 * 60;

/** Cảnh báo khi lịch nằm ngoài giờ làm việc mặc định (T2–T7, 08–12, 13–17). Không chặn lưu. */
export function checkWorkingHours(start: Date, end: Date): string[] {
  const w: string[] = [];
  const s = vnParts(start), e = vnParts(end);
  const sm = s.hh * 60 + s.mm, em = (e.d !== s.d ? 24 * 60 : 0) + e.hh * 60 + e.mm;
  if (s.dow === 0) w.push('Chủ nhật không phải ngày làm việc.');
  if (sm < WORK_START || em > WORK_END) w.push('Ngoài giờ làm việc 08:00–17:00.');
  if (sm < LUNCH_END && em > LUNCH_START) w.push('Chồng lên giờ nghỉ trưa 12:00–13:00.');
  return w;
}

/** Số phút làm việc (trừ nghỉ trưa) bị chiếm bởi khoảng [s, e) trong cùng ngày. */
export function workMinutes(sMin: number, eMin: number): number {
  const seg = (a: number, b: number) => Math.max(0, Math.min(eMin, b) - Math.max(sMin, a));
  return seg(WORK_START, LUNCH_START) + seg(LUNCH_END, WORK_END);
}

/** Gộp các khoảng [s,e) phút trong ngày (đã sắp xếp hoặc chưa) thành các khoảng không chồng nhau. */
export function mergeIntervals(list: [number, number][]): [number, number][] {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); // bản sao, không sửa mảng đầu vào
  }
  return out;
}

/**
 * Thời gian trống trong ngày làm việc (phút): tổng giờ làm − giờ đã có lịch (trừ lịch “dự phòng”) − phần dự phòng tối thiểu.
 * `busy` là các khoảng phút-trong-ngày của lịch không phải buffer.
 */
export function freeMinutes(busy: [number, number][], bufferPercent: number, isWorkday: boolean) {
  if (!isWorkday) return { total: 0, busy: 0, reserve: 0, free: 0 };
  const total = workMinutes(WORK_START, WORK_END);
  const used = mergeIntervals(busy).reduce((a, [s, e]) => a + workMinutes(s, e), 0);
  const reserve = Math.round((total * bufferPercent) / 100);
  return { total, busy: used, reserve, free: Math.max(0, total - used - reserve) };
}
