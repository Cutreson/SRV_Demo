import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { api, toAppError } from '../../lib/api';
import { useData } from '../../lib/data';
import { clearSettingsCache, SLOT_LABEL, useSettings, type TemplateSlot } from '../../lib/settings';
import { useToast } from '../../components/ui';

const DAY = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'EF', 'review', 'followup', 'decide', 'due', 'backlog', 'plan', 'buffer'];

export function SettingsPage() {
  const s = useSettings();
  const { profile, refreshProfile } = useAuth();
  const d = useData();
  const toast = useToast();
  const [buffer, setBuffer] = useState(25);
  const [block, setBlock] = useState(90);
  const [gap, setGap] = useState(7);
  const [lead, setLead] = useState(15);
  const [tmpl, setTmpl] = useState<Record<string, TemplateSlot[]>>({});
  const [name, setName] = useState(profile?.display_name ?? '');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');

  useEffect(() => {
    setBuffer(s.buffer_percent); setBlock(s.max_block_minutes || 90); setTmpl(s.daily_template);
    api.settings().then((rows) => {
      for (const x of rows) {
        if (x.key === 'strategy_gap_days') setGap(Number(x.value));
        else if (x.key === 'event_lead_minutes') setLead(Number(x.value));
      }
    }).catch(() => { /* giữ giá trị hiện tại */ });
  }, [s]);

  async function save() {
    try {
      const rows = [
        ['buffer_percent', Math.min(35, Math.max(20, buffer))], ['max_block_minutes', Math.min(120, Math.max(30, block))],
        ['strategy_gap_days', Math.max(1, gap)], ['event_lead_minutes', Math.max(5, lead)], ['daily_template', tmpl],
      ] as const;
      for (const [key, value] of rows) await api.putSetting(key, value);
      clearSettingsCache();
      toast('Đã lưu cấu hình. Tải lại trang để áp dụng ở mọi màn hình.');
    } catch (x) { toast(toAppError(x).message, 'err'); }
  }
  async function saveName() {
    if (!profile || !name.trim()) return;
    try {
      await api.updateMe(name.trim());
      await refreshProfile();
      await d.reload();
      toast('Đã đổi tên hiển thị.');
    } catch (x) { toast(toAppError(x).message, 'err'); }
  }
  async function savePassword() {
    if (newPw.length < 8) { toast('Mật khẩu mới cần tối thiểu 8 ký tự.', 'err'); return; }
    if (newPw !== newPw2) { toast('Hai lần nhập mật khẩu mới chưa khớp.', 'err'); return; }
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(''); setNewPw(''); setNewPw2('');
      toast('Đã đổi mật khẩu.');
    } catch (x) { toast(toAppError(x).message, 'err'); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold">Cấu hình</h1>
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Thời gian & nhắc việc (dùng chung cho 2 tài khoản)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Dự phòng tối thiểu mỗi ngày: {buffer}%</label>
            <input type="range" min={20} max={35} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} className="w-full" />
            <p className="text-[11px] text-ink-500">Đề xuất lịch không chiếm phần này (trừ khi bật “cho phép dùng dự phòng”).</p></div>
          <div><label className="label">Khung làm việc tối đa cho 1 block (phút)</label>
            <input type="number" min={30} max={120} step={15} className="input" value={block} onChange={(e) => setBlock(Number(e.target.value))} /></div>
          <div><label className="label">Cảnh báo mục tiêu E/F nếu không có khung tập trung trong (ngày)</label>
            <input type="number" min={1} max={30} className="input" value={gap} onChange={(e) => setGap(Number(e.target.value))} /></div>
          <div><label className="label">Nhắc lịch sắp bắt đầu trước (phút)</label>
            <input type="number" min={5} max={120} step={5} className="input" value={lead} onChange={(e) => setLead(Number(e.target.value))} /></div>
        </div>
        <p className="mt-3 text-[11px] text-ink-500">Giờ làm việc: Thứ 2–Thứ 7, 08:00–12:00 và 13:00–17:00. Chủ nhật không tự xếp lịch.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold">Khung ưu tiên theo ngày (gợi ý, không khóa cứng)</h2>
        <p className="mb-3 text-[11px] text-ink-500">Dùng để hiển thị trên lịch và chấm điểm khi đề xuất lịch. Không tự sinh sự kiện.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead><tr className="text-left text-ink-500"><th className="py-1">Ngày</th>{(tmpl['1'] ?? []).map(([a, b], i) => <th key={i}>{a}–{b}</th>)}</tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6].map((dw) => (
                <tr key={dw} className="border-t border-ink-100">
                  <td className="py-1.5 font-medium">{DAY[dw]}</td>
                  {(tmpl[String(dw)] ?? []).map((slot, i) => (
                    <td key={i} className="pr-1">
                      <select className="input py-1 text-xs" value={slot[2]} onChange={(e) => {
                        const next = { ...tmpl, [String(dw)]: (tmpl[String(dw)] ?? []).map((x, j) => (j === i ? [x[0], x[1], e.target.value] as TemplateSlot : x)) };
                        setTmpl(next);
                      }}>
                        {CODES.map((c) => <option key={c} value={c}>{SLOT_LABEL[c] ?? c}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={save}>Lưu cấu hình</button></div>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Tài khoản của tôi</h2>
        <div className="flex gap-2"><input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-outline" onClick={saveName}>Đổi tên hiển thị</button></div>

        <h3 className="mb-2 mt-5 text-sm font-medium">Đổi mật khẩu</h3>
        <div className="grid max-w-xl gap-2 sm:grid-cols-3">
          <input type="password" autoComplete="current-password" className="input" placeholder="Mật khẩu hiện tại" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
          <input type="password" autoComplete="new-password" className="input" placeholder="Mật khẩu mới (≥ 8 ký tự)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input type="password" autoComplete="new-password" className="input" placeholder="Nhập lại mật khẩu mới" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
        </div>
        <div className="mt-2"><button className="btn-outline" disabled={!curPw || !newPw} onClick={savePassword}>Đổi mật khẩu</button></div>
        <p className="mt-2 text-[11px] text-ink-500">
          Tạo tài khoản và đặt mật khẩu cho người khác: Quản trị viên / Giám đốc dùng mục <b>Tài khoản</b>. Khóa tài khoản: lệnh <code>cli deactivate</code> (docs/RUNBOOK.md).
          Đổi mật khẩu sẽ đăng xuất các trình duyệt khác của bạn.
        </p>
      </section>
    </div>
  );
}
