// Mọi thời điểm lưu UTC; hiển thị và nhập theo giờ Việt Nam (UTC+7, không có giờ mùa hè).
export const TZ = 'Asia/Ho_Chi_Minh';
const OFFSET_MIN = 7 * 60;

/** Các thành phần ngày giờ theo giờ VN của một thời điểm. */
export function vnParts(d: Date) {
  const s = new Date(d.getTime() + OFFSET_MIN * 60_000);
  return {
    y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate(),
    hh: s.getUTCHours(), mm: s.getUTCMinutes(),
    dow: s.getUTCDay(), // 0 = Chủ nhật
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Thời điểm UTC tương ứng với ngày/giờ VN. */
export function vnDate(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MIN * 60_000);
}

/** 00:00 giờ VN của ngày chứa thời điểm `d`. */
export function vnStartOfDay(d: Date = new Date()): Date {
  const p = vnParts(d);
  return vnDate(p.y, p.m, p.d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Thứ 2 (00:00 VN) của tuần chứa `d`. */
export function vnWeekStart(d: Date = new Date()): Date {
  const start = vnStartOfDay(d);
  const dow = vnParts(d).dow; // 0..6
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(start, -back);
}

/** 'YYYY-MM-DD' theo giờ VN. */
export function vnDateKey(d: Date | string): string {
  const p = vnParts(typeof d === 'string' ? new Date(d) : d);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

/** Giá trị cho <input type="datetime-local"> theo giờ VN. */
export function toInputDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = vnParts(new Date(iso));
  return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.hh)}:${p2(p.mm)}`;
}

/** Đọc giá trị datetime-local (hiểu là giờ VN) → ISO UTC. */
export function fromInputDateTime(v: string): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return vnDate(+m[1], +m[2], +m[3], +m[4], +m[5]).toISOString();
}

/** Đọc giá trị <input type="date"> + giờ mặc định (giờ VN) → ISO UTC. */
export function fromInputDate(v: string, hh: number, mm = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return vnDate(+m[1], +m[2], +m[3], hh, mm).toISOString();
}

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "T3 14/10 09:00" (bỏ giờ nếu showTime = false). */
export function fmtVN(iso: string | null | undefined, showTime = true): string {
  if (!iso) return '';
  const p = vnParts(new Date(iso));
  const date = `${WD[p.dow]} ${p2(p.d)}/${p2(p.m)}`;
  return showTime ? `${date} ${p2(p.hh)}:${p2(p.mm)}` : date;
}

export function fmtDateTimeFull(iso: string): string {
  const p = vnParts(new Date(iso));
  return `${p2(p.d)}/${p2(p.m)}/${p.y} ${p2(p.hh)}:${p2(p.mm)}`;
}

/** Mô tả tương đối ngắn: "quá 2 ngày", "hôm nay", "còn 3 ngày". */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const diff = Math.round((vnStartOfDay(new Date(iso)).getTime() - vnStartOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return 'hôm nay';
  if (diff === 1) return 'ngày mai';
  if (diff === -1) return 'hôm qua';
  return diff < 0 ? `quá ${-diff} ngày` : `còn ${diff} ngày`;
}

export function fmtMinutes(min: number | null | undefined): string {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h${p2(m)}` : `${h}h`) : `${m}p`;
}

/** Hai khoảng thời gian giao nhau. */
export const overlaps = (aS: string | Date, aE: string | Date, bS: string | Date, bE: string | Date) =>
  new Date(aS) < new Date(bE) && new Date(bS) < new Date(aE);
