/** Xếp các sự kiện chồng giờ thành cột cạnh nhau trong một ngày. Đầu vào: phút bắt đầu/kết thúc. */
export interface Placed<T> { item: T; col: number; cols: number }

export function layoutDay<T>(items: T[], range: (x: T) => [number, number]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => range(a)[0] - range(b)[0] || range(b)[1] - range(a)[1]);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let colsEnd: number[] = [];
  let clusterEnd = -1;
  const flush = () => { const n = colsEnd.length; cluster.forEach((p) => (p.cols = n)); out.push(...cluster); cluster = []; colsEnd = []; };
  for (const it of sorted) {
    const [s, e] = range(it);
    if (s >= clusterEnd && cluster.length) flush();
    let col = colsEnd.findIndex((end) => end <= s);
    if (col < 0) { col = colsEnd.length; colsEnd.push(e); } else colsEnd[col] = e;
    cluster.push({ item: it, col, cols: 0 });
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}

export const snap = (min: number, step = 15) => Math.round(min / step) * step;
