import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AuditLog } from '../../lib/types';
import { useData } from '../../lib/data';
import { FIELD_LABEL, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../../lib/labels';
import { fmtDateTimeFull, fmtVN } from '../../lib/time';
import { changedFields } from './diff';

/** Hiển thị giá trị thân thiện (ngày giờ VN, tên người, nhãn trạng thái…). */
export function useValueFormatter() {
  const d = useData();
  return (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '∅';
    if (typeof v === 'boolean') return v ? 'Có' : 'Không';
    const s = String(v);
    if (field === 'status') return STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s;
    if (field === 'priority') return PRIORITY_LABEL[s as keyof typeof PRIORITY_LABEL] ?? s;
    if (field === 'task_type') return TYPE_LABEL[s as keyof typeof TYPE_LABEL] ?? s;
    if (field.endsWith('profile_id') || field === 'author_id' || field === 'chosen_by') return d.profileName(s);
    if (field === 'assignee_person_id') return d.personName(s);
    if (field === 'goal_id') return d.goals.find((g) => g.id === s)?.title ?? s;
    if (field === 'category_code') return d.categoryOf(s) ? `${s}. ${d.categoryOf(s)!.name}` : s;
    if (/_at$/.test(field) && /^\d{4}-\d{2}-\d{2}T/.test(s)) return fmtVN(s);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  };
}

export function ChangeList({ log }: { log: AuditLog }) {
  const fmt = useValueFormatter();
  const ch = changedFields(log);
  if (log.action === 'DELETE') return <div className="text-xs text-red-700">Đã xóa</div>;
  if (ch.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {ch.map((c) => (
        <li key={c.field}>
          <span className="text-ink-500">{FIELD_LABEL[c.field] ?? c.field}:</span>{' '}
          {log.action === 'UPDATE' && <><span className="text-ink-400 line-through">{fmt(c.field, c.before)}</span> → </>}
          <span className="font-medium text-ink-800">{fmt(c.field, c.after)}</span>
        </li>
      ))}
    </ul>
  );
}

export function RecordHistory({ table, recordId }: { table: string; recordId: string }) {
  const d = useData();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  useEffect(() => {
    supabase.from('audit_logs').select('*').eq('table_name', table).eq('record_id', recordId)
      .order('created_at', { ascending: false }).limit(100)
      .then((r) => setLogs(r.error ? [] : (r.data as AuditLog[])));
  }, [table, recordId]);
  if (!logs) return <div className="text-sm text-ink-400">Đang tải…</div>;
  if (logs.length === 0) return <div className="text-sm text-ink-400">Chưa có lịch sử.</div>;
  return (
    <ol className="space-y-2">
      {logs.map((l) => (
        <li key={l.id} className="rounded-md border border-ink-100 p-2">
          <div className="text-[11px] text-ink-500">
            {fmtDateTimeFull(l.created_at)} · <b>{d.profileName(l.actor_id) || 'Hệ thống'}</b> ·{' '}
            {l.action === 'INSERT' ? 'tạo mới' : l.action === 'UPDATE' ? 'cập nhật' : 'xóa'}
          </div>
          <ChangeList log={l} />
        </li>
      ))}
    </ol>
  );
}
