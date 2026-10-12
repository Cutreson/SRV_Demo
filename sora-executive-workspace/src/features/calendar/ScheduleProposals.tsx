import { useMemo, useState } from 'react';
import { useData } from '../../lib/data';
import { useEvents } from '../../lib/events';
import { supabase, toAppError } from '../../lib/supabase';
import { useSettings } from '../../lib/settings';
import { proposeSchedule } from '../../lib/scheduler';
import { addDays, fmtMinutes, fmtVN, overlaps, vnDateKey, vnParts } from '../../lib/time';
import { CategoryChip, cx, Modal, useToast } from '../../components/ui';
import { expandEvents } from '../../lib/recurrence';
import type { CalendarEvent } from '../../lib/types';

const hm = (d: Date) => { const p = vnParts(d); return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`; };
const WD = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** Đề xuất lịch: chỉ tạo lịch khi người dùng bấm Xác nhận; không di chuyển lịch đã có. */
export function ScheduleProposals({ weekStart, onClose }: { weekStart: Date; onClose: () => void }) {
  const d = useData();
  const toast = useToast();
  const settings = useSettings();
  const { events, loading } = useEvents(weekStart, addDays(weekStart, 7));
  const [allowBuffer, setAllowBuffer] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);

  const result = useMemo(() => proposeSchedule({
    tasks: d.tasks, events, weekStart, now, bufferPercent: settings.buffer_percent, maxBlock: settings.max_block_minutes || 90,
    template: settings.daily_template, allowBuffer, workingDays: settings.working_days,
  }), [d.tasks, events, weekStart, now, settings, allowBuffer]);

  const title = (id: string) => d.tasks.find((t) => t.id === id)?.title ?? '';
  const taskOf = (id: string) => d.tasks.find((t) => t.id === id);
  const byDay = new Map<string, number[]>();
  result.proposals.forEach((p, i) => { const k = vnDateKey(p.start); byDay.set(k, [...(byDay.get(k) ?? []), i]); });
  const chosen = result.proposals.filter((_, i) => !skip.has(i));

  async function confirmAll() {
    setBusy(true);
    try {
      // Kiểm tra lại trùng giờ với dữ liệu mới nhất (người kia có thể vừa thêm lịch)
      const r = await supabase.from('calendar_events').select('*').lt('start_at', addDays(weekStart, 7).toISOString()).gt('end_at', weekStart.toISOString());
      const r2 = await supabase.from('calendar_events').select('*').not('recurrence_rule', 'is', null);
      const latest = expandEvents([...((r.data ?? []) as CalendarEvent[]).filter((e) => !e.recurrence_rule), ...((r2.data ?? []) as CalendarEvent[])], [], weekStart, addDays(weekStart, 7))
        .filter((e) => e.status !== 'cancelled' && (e.event_type !== 'buffer' || !allowBuffer));
      const ok = chosen.filter((p) => !latest.some((e) => overlaps(e.start_at, e.end_at, p.start, p.end)));
      const rows = ok.map((p) => {
        const t = taskOf(p.taskId);
        return { title: t?.title ?? 'Việc', start_at: p.start.toISOString(), end_at: p.end.toISOString(), task_id: p.taskId,
          category_code: t?.category_code ?? null, event_type: t && (t.category_code === 'E' || t.category_code === 'F') ? 'focus' : 'flexible',
          source: 'scheduler', notes: 'Đề xuất: ' + p.reasons.join('; ') };
      });
      if (rows.length) { const ins = await supabase.from('calendar_events').insert(rows); if (ins.error) throw ins.error; }
      const skipped = chosen.length - ok.length;
      toast(`Đã thêm ${rows.length} khung lịch.${skipped ? ` Bỏ ${skipped} khung vì vừa bị trùng.` : ''}`, skipped ? 'info' : 'ok');
      onClose();
    } catch (x) { toast(toAppError(x).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} wide title={`Đề xuất lịch tuần ${fmtVN(weekStart.toISOString(), false)} – ${fmtVN(addDays(weekStart, 5).toISOString(), false)}`}
      footer={<>
        <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={allowBuffer} onChange={(e) => { setAllowBuffer(e.target.checked); setSkip(new Set()); }} />
          Cho phép dùng thời gian dự phòng ({settings.buffer_percent}%)</label>
        <button className="btn-outline" onClick={onClose}>Đóng</button>
        <button className="btn-primary" disabled={busy || chosen.length === 0} onClick={confirmAll}>Xác nhận {chosen.length} khung</button>
      </>}>
      {loading ? <p className="text-sm text-ink-400">Đang tính…</p> : (
        <div className="space-y-4 text-sm">
          <p className="text-xs text-ink-500">
            Quy tắc: không đè lên lịch đã có, không xếp giờ nghỉ trưa / Chủ nhật, giữ {allowBuffer ? '0' : settings.buffer_percent}% dự phòng mỗi ngày,
            chia việc dài thành khung ≤ {settings.max_block_minutes} phút. Thứ tự: quá hạn → deadline gần → ưu tiên → việc chiến lược đang thiếu thời gian.
            Chưa có gì được lưu cho đến khi bấm Xác nhận.
          </p>
          {result.warnings.length > 0 && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{result.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
          {result.proposals.length === 0 && <p className="text-ink-500">Không có đề xuất nào (cần việc tự làm, chưa xong, có thời lượng ước tính).</p>}
          {[...byDay.entries()].map(([k, idx]) => (
            <div key={k}>
              <div className="mb-1 text-xs font-semibold text-ink-600">{WD[vnParts(result.proposals[idx[0]].start).dow]} {k.slice(8)}/{k.slice(5, 7)}</div>
              <ul className="space-y-1">
                {idx.map((i) => {
                  const p = result.proposals[i]; const t = taskOf(p.taskId);
                  return (
                    <li key={i} className={cx('flex items-start gap-2 rounded border p-2', skip.has(i) ? 'border-ink-100 opacity-50' : 'border-ink-200')}>
                      <input type="checkbox" className="mt-1" checked={!skip.has(i)} onChange={(e) => { const n = new Set(skip); if (e.target.checked) n.delete(i); else n.add(i); setSkip(n); }} />
                      <span className="w-24 shrink-0 tabular-nums font-medium">{hm(p.start)}–{hm(p.end)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1"><CategoryChip c={d.categoryOf(t?.category_code)} short /><span className="truncate">{title(p.taskId)}</span></div>
                        <div className="text-[11px] text-ink-500">Lý do: {p.reasons.join(', ') || 'khung trống phù hợp'}{t?.due_at ? ` · hạn ${fmtVN(t.due_at)}` : ''}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {result.unplaced.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-ink-600">Chưa xếp được</div>
              <ul className="space-y-1 text-xs">
                {result.unplaced.map((u) => <li key={u.taskId} className="rounded bg-ink-50 p-1.5"><b>{title(u.taskId)}</b> — {u.reason}</li>)}
              </ul>
            </div>
          )}
          {result.ranking.length > 0 && (
            <details className="text-xs text-ink-500">
              <summary className="cursor-pointer">Thứ tự xét việc ({result.ranking.length})</summary>
              <ol className="mt-1 list-decimal pl-5">{result.ranking.map((r) => {
                const t = taskOf(r.taskId);
                return <li key={r.taskId}>{title(r.taskId)} — {r.why}{t?.estimated_minutes ? ` · ${fmtMinutes(t.estimated_minutes)}` : ''}</li>;
              })}</ol>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
