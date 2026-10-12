import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { assigneeName, useData } from '../../lib/data';
import { useEvents } from '../../lib/events';
import { api } from '../../lib/api';
import { setParams, useRoute } from '../../lib/router';
import { useSettings } from '../../lib/settings';
import { toCsv, weeklyReport } from '../../lib/report';
import type { Task, TaskUpdate } from '../../lib/types';
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../../lib/labels';
import { addDays, fmtDateTimeFull, fmtMinutes, fmtVN, vnDateKey, vnWeekStart } from '../../lib/time';
import { CategoryChip, cx } from '../../components/ui';

export function ReportsPage() {
  const d = useData();
  const settings = useSettings();
  const { params } = useRoute();
  const off = Number(params.get('wk') ?? '0') || 0;
  const weekStart = addDays(vnWeekStart(new Date()), off * 7);
  const weekEnd = addDays(weekStart, 7);
  const { events } = useEvents(weekStart, weekEnd);
  const [updates, setUpdates] = useState<Pick<TaskUpdate, 'task_id' | 'created_at'>[]>([]);
  useEffect(() => {
    let alive = true;
    api.taskUpdatesRange(addDays(weekStart, -1).toISOString(), weekEnd.toISOString())
      .then((rows) => { if (alive) setUpdates(rows); }).catch(() => { /* báo cáo vẫn hiển thị phần còn lại */ });
    return () => { alive = false; };
  }, [weekStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const rep = useMemo(() => weeklyReport({ tasks: d.tasks, updates, events, weekStart, now: new Date(), bufferPercent: settings.buffer_percent }),
    [d.tasks, updates, events, weekStart.getTime(), settings.buffer_percent]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = [...d.categories.map((c) => c.code as string), '—'];

  function exportCsv() {
    const rows: (string | number | null)[][] = [['Báo cáo tuần', `${vnDateKey(weekStart)} → ${vnDateKey(addDays(weekStart, 5))}`], [],
      ['Chỉ số', 'Giá trị'],
      ['Việc tạo mới', rep.created.length], ['Việc hoàn thành', rep.completed.length], ['Việc quá hạn đang mở', rep.overdueOpen.length],
      ['Việc giao còn chờ', rep.delegatedPending.length], ['Không follow-up đúng hạn', rep.missedFollowUps.length],
      ['Tổng giờ đã lên lịch', (rep.totalScheduled / 60).toFixed(1)], ['Tỷ lệ thời gian chiến lược E/F (%)', rep.strategicShare],
      ['Tỷ lệ dự phòng đã dùng (%)', rep.bufferUsedShare], [],
      ['Nhóm', 'Giờ lên lịch', 'Giờ thực tế (lịch đã xong)'],
      ...cats.filter((c) => rep.scheduledByCat[c]).map((c) => [c, ((rep.scheduledByCat[c] ?? 0) / 60).toFixed(1), ((rep.actualByCat[c] ?? 0) / 60).toFixed(1)]),
      [], ['Danh sách', 'Tiêu đề', 'Nhóm', 'Loại', 'Ưu tiên', 'Trạng thái', 'Người thực hiện', 'Deadline', 'Follow-up', 'Hoàn thành lúc', 'Kết quả'],
    ];
    const add = (label: string, list: Task[]) => list.forEach((t) => rows.push([label, t.title, t.category_code, TYPE_LABEL[t.task_type], PRIORITY_LABEL[t.priority],
      STATUS_LABEL[t.status], assigneeName(t, d), t.due_at ? fmtDateTimeFull(t.due_at) : '', t.next_follow_up_at ? fmtDateTimeFull(t.next_follow_up_at) : '',
      t.completed_at ? fmtDateTimeFull(t.completed_at) : '', t.completion_result]));
    add('Hoàn thành', rep.completed); add('Quá hạn', rep.overdueOpen); add('Giao còn chờ', rep.delegatedPending); add('Lỡ follow-up', rep.missedFollowUps);
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bao-cao-tuan-${vnDateKey(weekStart)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="mx-auto max-w-6xl print:max-w-none">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="mr-auto text-lg font-semibold">Báo cáo tuần</h1>
        <button className="btn-ghost px-2" onClick={() => setParams({ wk: String(off - 1) })}>‹</button>
        <span className="text-sm tabular-nums">{fmtVN(weekStart.toISOString(), false)} – {fmtVN(addDays(weekStart, 5).toISOString(), false)}</span>
        <button className="btn-ghost px-2" onClick={() => setParams({ wk: String(off + 1) })}>›</button>
        {off !== 0 && <button className="btn-ghost" onClick={() => setParams({ wk: null })}>Tuần này</button>}
        <button className="btn-outline" onClick={exportCsv}>Xuất CSV</button>
        <button className="btn-primary" onClick={() => window.print()}>In / PDF</button>
      </div>
      <h1 className="mb-3 hidden text-xl font-semibold print:block">SORA – Báo cáo tuần {fmtVN(weekStart.toISOString(), false)} – {fmtVN(addDays(weekStart, 5).toISOString(), false)}</h1>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Tạo mới" v={rep.created.length} />
        <Stat label="Hoàn thành" v={rep.completed.length} good />
        <Stat label="Quá hạn đang mở" v={rep.overdueOpen.length} bad={rep.overdueOpen.length > 0} />
        <Stat label="Việc giao còn chờ" v={rep.delegatedPending.length} />
        <Stat label="Không follow-up đúng hạn" v={rep.missedFollowUps.length} bad={rep.missedFollowUps.length > 0} />
        <Stat label="Thời gian chiến lược E/F" v={`${rep.strategicShare}%`} bad={rep.totalScheduled > 0 && rep.strategicShare < 20} />
        <Stat label="Dự phòng đã dùng" v={`${rep.bufferUsedShare}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Box title={`Giờ theo nhóm (tổng ${fmtMinutes(Math.round(rep.totalScheduled)) || '0'})`}>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-ink-500"><tr><th className="py-1">Nhóm</th><th>Đã lên lịch</th><th>Thực tế*</th><th className="w-1/3" /></tr></thead>
            <tbody>
              {cats.filter((c) => rep.scheduledByCat[c]).map((c) => {
                const cat = d.categoryOf(c);
                return (
                  <tr key={c} className="border-t border-ink-100">
                    <td className="py-1.5">{cat ? <CategoryChip c={cat} /> : 'Chưa phân nhóm'}</td>
                    <td className="tabular-nums">{fmtMinutes(Math.round(rep.scheduledByCat[c]))}</td>
                    <td className="tabular-nums">{fmtMinutes(Math.round(rep.actualByCat[c] ?? 0)) || '—'}</td>
                    <td><div className="h-2 rounded bg-ink-100"><div className="h-2 rounded" style={{ width: `${(rep.scheduledByCat[c] / rep.totalScheduled) * 100}%`, backgroundColor: cat?.color ?? '#94a3b8' }} /></div></td>
                  </tr>
                );
              })}
              {rep.totalScheduled === 0 && <tr><td colSpan={4} className="py-3 text-center text-ink-400">Tuần này chưa có lịch.</td></tr>}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-400">* Giờ thực tế = lịch được đánh dấu “đã xong” trong màn hình Lịch.</p>
        </Box>
        <TaskBox title="Hoàn thành trong tuần" list={rep.completed} showResult />
        <TaskBox title="Quá hạn đang mở" list={rep.overdueOpen} tone="red" />
        <TaskBox title="Việc giao không được follow-up đúng hạn" list={rep.missedFollowUps} tone="amber" />
        <TaskBox title="Việc giao còn chờ" list={rep.delegatedPending} />
        <TaskBox title="Việc tạo mới trong tuần" list={rep.created} />
      </div>
    </div>
  );
}

function Stat({ label, v, good, bad }: { label: string; v: ReactNode; good?: boolean; bad?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', bad ? 'text-red-600' : good ? 'text-emerald-700' : 'text-ink-900')}>{v}</div>
    </div>
  );
}
function Box({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card break-inside-avoid p-3"><h2 className="mb-2 text-sm font-semibold">{title}</h2>{children}</section>;
}
function TaskBox({ title, list, tone, showResult }: { title: string; list: Task[]; tone?: 'red' | 'amber'; showResult?: boolean }) {
  const d = useData();
  return (
    <Box title={`${title} · ${list.length}`}>
      {list.length === 0 ? <p className="text-sm text-ink-400">Không có.</p> : (
        <ul className="divide-y divide-ink-100 text-sm">
          {list.slice(0, 15).map((t) => (
            <li key={t.id} className="py-1.5">
              <div className="flex items-center gap-1.5"><CategoryChip c={d.categoryOf(t.category_code)} short /><a className="truncate hover:underline" href={`#/tasks?st=all&task=${t.id}`}>{t.title}</a></div>
              <div className={cx('text-[11px]', tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : 'text-ink-500')}>
                {assigneeName(t, d) && `${assigneeName(t, d)} · `}{t.due_at && `hạn ${fmtVN(t.due_at)}`}{t.next_follow_up_at && tone === 'amber' ? ` · FU ${fmtVN(t.next_follow_up_at)}` : ''}
                {showResult && t.completion_result ? ` · ${t.completion_result}` : ''}
              </div>
            </li>
          ))}
          {list.length > 15 && <li className="py-1 text-[11px] text-ink-400">+{list.length - 15} việc khác (có trong file CSV)</li>}
        </ul>
      )}
    </Box>
  );
}
