import { useRef, useState, type FormEvent } from 'react';
import { useData } from '../../lib/data';
import { fromInputDate } from '../../lib/time';
import { useToast } from '../../components/ui';

/**
 * Ghi nhanh < 30 giây: tiêu đề + (deadline hoặc ngày kiểm tra) + người phụ trách (tùy chọn).
 * Có người phụ trách trong danh bạ → tự thành việc giao (delegated).
 */
export function QuickCapture({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const { createTask, people } = useData();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [follow, setFollow] = useState('');
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createTask({
        title: title.trim(),
        source: 'quick_capture',
        due_at: due ? fromInputDate(due, 17) : null,             // hạn: 17:00 ngày đó
        next_follow_up_at: follow ? fromInputDate(follow, 9) : null, // kiểm tra: 09:00 ngày đó
        assignee_person_id: person || null,
        task_type: person ? 'delegated' : 'self',
      });
      toast('Đã ghi việc. Bổ sung chi tiết sau trong danh sách.');
      setTitle(''); setDue(''); setFollow(''); setPerson('');
      titleRef.current?.focus();
      onDone?.();
    } catch (x) {
      toast((x as Error).message, 'err');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
      <div className="col-span-2 sm:col-span-1">
        <label className="label" htmlFor="qc-title">Ghi nhanh việc mới</label>
        <input id="qc-title" ref={titleRef} autoFocus={autoFocus} className="input" placeholder="VD: Gọi anh A chốt lịch khảo sát"
               value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
      </div>
      <div>
        <label className="label" htmlFor="qc-due">Deadline</label>
        <input id="qc-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="qc-fu">Ngày kiểm tra</label>
        <input id="qc-fu" type="date" className="input" value={follow} onChange={(e) => setFollow(e.target.value)} />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="label" htmlFor="qc-p">Giao cho</label>
        <select id="qc-p" className="input" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">— Tự làm —</option>
          {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>
      <button className="btn-accent col-span-2 sm:col-span-1" disabled={busy || !title.trim()}>+ Ghi</button>
    </form>
  );
}
