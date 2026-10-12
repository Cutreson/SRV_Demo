import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AuditLog } from '../../lib/types';
import { useData } from '../../lib/data';
import { TABLE_LABEL } from '../../lib/labels';
import { fmtDateTimeFull } from '../../lib/time';
import { Empty } from '../../components/ui';
import { ChangeList } from './RecordHistory';
import { recordTitle } from './diff';

const PAGE = 100;

export function AuditPage() {
  const d = useData();
  const [table, setTable] = useState('');
  const [actor, setActor] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (before?: number) => {
    setLoading(true);
    let q = supabase.from('audit_logs').select('*').order('id', { ascending: false }).limit(PAGE);
    if (table) q = q.eq('table_name', table);
    if (actor) q = q.eq('actor_id', actor);
    if (before) q = q.lt('id', before);
    const r = await q;
    const rows = (r.data ?? []) as AuditLog[];
    setLogs((l) => (before ? [...l, ...rows] : rows));
    setMore(rows.length === PAGE);
    setLoading(false);
  }, [table, actor]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <h1 className="mr-auto text-lg font-semibold">Nhật ký thay đổi</h1>
        <select className="input w-44" value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">Mọi loại dữ liệu</option>
          {Object.entries(TABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input w-40" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">Mọi người</option>
          {d.profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
      </div>
      {logs.length === 0 && !loading ? <Empty>Chưa có thay đổi nào.</Empty> : (
        <div className="card divide-y divide-ink-100">
          {logs.map((l) => (
            <div key={l.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="text-[11px] tabular-nums text-ink-400">{fmtDateTimeFull(l.created_at)}</span>
                <b>{d.profileName(l.actor_id) || 'Hệ thống'}</b>
                <span className="text-ink-500">{l.action === 'INSERT' ? 'tạo' : l.action === 'UPDATE' ? 'sửa' : 'xóa'}</span>
                <span className="chip bg-ink-100 text-ink-600">{TABLE_LABEL[l.table_name] ?? l.table_name}</span>
                <span className="truncate font-medium">{recordTitle(l)}</span>
              </div>
              <ChangeList log={l} />
            </div>
          ))}
        </div>
      )}
      {more && <div className="mt-3 text-center"><button className="btn-outline" disabled={loading} onClick={() => load(logs[logs.length - 1]?.id)}>Xem thêm</button></div>}
      <p className="mt-4 text-xs text-ink-400">Nhật ký chỉ đọc, không ai sửa hay xóa được qua ứng dụng.</p>
    </div>
  );
}
