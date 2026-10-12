import { useState } from 'react';
import { useData } from '../../lib/data';
import type { Person } from '../../lib/types';
import { Empty, Modal, useToast } from '../../components/ui';
import { AddPersonModal } from '../tasks/TaskForm';
import { isOpen } from '../tasks/taskLogic';

export function PeoplePage() {
  const d = useData();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Person | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const openCount = (id: string) => d.tasks.filter((t) => t.assignee_person_id === id && isOpen(t)).length;
  const list = d.people.filter((p) => showInactive || p.active);

  async function saveEdit() {
    if (!edit) return;
    const orig = d.people.find((p) => p.id === edit.id)!;
    try {
      await d.updatePerson(orig, { full_name: edit.full_name.trim(), department: edit.department || null, position: edit.position || null,
        contact_note: edit.contact_note || null, active: edit.active });
      setEdit(null); toast('Đã lưu.');
    } catch (x) { toast((x as Error).message, 'err'); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Danh bạ người được giao việc</h1>
        <label className="flex items-center gap-1 text-sm text-ink-600"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Hiện người đã ngừng</label>
        <button className="btn-primary" onClick={() => setAdding(true)}>+ Thêm người</button>
      </div>
      <p className="mb-3 text-xs text-ink-500">Trưởng phòng, PM, nhân sự… không cần tài khoản. Không xóa người đã có việc – chuyển sang “ngừng”.</p>
      {list.length === 0 ? <Empty>Chưa có ai trong danh bạ.</Empty> : (
        <div className="card divide-y divide-ink-100">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.full_name} {!p.active && <span className="chip bg-ink-100 text-ink-500">Ngừng</span>}</div>
                <div className="text-xs text-ink-500">{[p.position, p.department, p.contact_note].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-xs text-ink-500">{openCount(p.id)} việc đang mở</div>
              <button className="btn-ghost" onClick={() => setEdit({ ...p })}>Sửa</button>
            </div>
          ))}
        </div>
      )}
      <AddPersonModal open={adding} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); toast('Đã thêm.'); }} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Sửa thông tin"
        footer={<><button className="btn-outline" onClick={() => setEdit(null)}>Hủy</button><button className="btn-primary" disabled={!edit?.full_name.trim()} onClick={saveEdit}>Lưu</button></>}>
        {edit && (
          <div className="space-y-2">
            <div><label className="label">Họ tên</label><input className="input" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Phòng ban</label><input className="input" value={edit.department ?? ''} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></div>
              <div><label className="label">Chức vụ</label><input className="input" value={edit.position ?? ''} onChange={(e) => setEdit({ ...edit, position: e.target.value })} /></div>
            </div>
            <div><label className="label">Liên hệ</label><input className="input" value={edit.contact_note ?? ''} onChange={(e) => setEdit({ ...edit, contact_note: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Đang hoạt động</label>
          </div>
        )}
      </Modal>
    </div>
  );
}
