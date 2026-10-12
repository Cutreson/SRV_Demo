import { useCallback, useEffect, useState } from 'react';
import { api, toAppError } from '../../lib/api';
import { ROLE_LABEL } from '../../lib/labels';
import { fmtDateTimeFull } from '../../lib/time';
import type { Role, UserAccount } from '../../lib/types';
import { cx, Empty, Modal, useToast } from '../../components/ui';
import { useAuth } from '../auth/AuthProvider';

const MIN_PASSWORD = 8;

/** Accounts: admin and director create accounts and set passwords (a director cannot touch an admin account). */
export function UsersPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<UserAccount[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<UserAccount | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await api.users()); }
    catch (x) { toast(toAppError(x).message, 'err'); setUsers([]); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const myRole = profile?.role;
  const canManage = (u: UserAccount) => myRole === 'admin' || (myRole === 'director' && u.role !== 'admin');

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Tài khoản</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ Tạo tài khoản</button>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        Quản trị viên và Giám đốc tạo tài khoản và đặt mật khẩu cho người khác. Giám đốc không quản lý được tài khoản Quản trị viên.
        Khi đặt lại mật khẩu, tài khoản đó bị đăng xuất khỏi mọi trình duyệt. Đổi mật khẩu của chính mình ở mục Cấu hình.
      </p>

      {users === null ? <div className="text-sm text-ink-400">Đang tải…</div>
        : users.length === 0 ? <Empty>Chưa có tài khoản.</Empty> : (
          <div className="card divide-y divide-ink-100">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {u.display_name}
                    {u.id === profile?.id && <span className="ml-2 chip bg-ink-100 text-ink-500">Bạn</span>}
                    {!u.active && <span className="ml-2 chip bg-ink-100 text-ink-500">Đã khóa</span>}
                  </div>
                  <div className="truncate text-xs text-ink-500">{u.email}</div>
                </div>
                <span className={cx('chip', u.role === 'admin' ? 'bg-violet-100 text-violet-800' : 'bg-ink-100 text-ink-700')}>{ROLE_LABEL[u.role]}</span>
                <div className="w-36 text-right text-xs text-ink-400">
                  {u.last_login_at ? <>Đăng nhập {fmtDateTimeFull(u.last_login_at)}</> : 'Chưa đăng nhập'}
                </div>
                <button className="btn-outline py-1" disabled={u.id === profile?.id || !canManage(u)} onClick={() => setTarget(u)}
                        title={u.id === profile?.id ? 'Đổi mật khẩu của mình ở mục Cấu hình' : !canManage(u) ? 'Chỉ Quản trị viên được đặt mật khẩu cho tài khoản này' : ''}>
                  Đặt mật khẩu
                </button>
              </div>
            ))}
          </div>
        )}

      <CreateUserModal open={creating} myRole={myRole} onClose={() => setCreating(false)}
        onCreated={(u) => { setCreating(false); toast(`Đã tạo tài khoản ${u.email}.`); void load(); }} />
      <SetPasswordModal user={target} onClose={() => setTarget(null)}
        onDone={(u) => { setTarget(null); toast(`Đã đặt mật khẩu mới cho ${u.display_name}.`); void load(); }} />
    </div>
  );
}

function PasswordField({ value, onChange, label = 'Mật khẩu', autoFocus }: { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label">{label} <span className="text-ink-400">(tối thiểu {MIN_PASSWORD} ký tự)</span></label>
      <div className="flex gap-2">
        <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus={autoFocus}
               value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn-outline whitespace-nowrap" onClick={() => setShow((s) => !s)}>{show ? 'Ẩn' : 'Hiện'}</button>
      </div>
    </div>
  );
}

function CreateUserModal({ open, myRole, onClose, onCreated }:
  { open: boolean; myRole?: Role; onClose: () => void; onCreated: (u: UserAccount) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('secretary');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setEmail(''); setName(''); setRole('secretary'); setPassword(''); setErr(null); } }, [open]);
  const roles: Role[] = myRole === 'admin' ? ['secretary', 'director', 'admin'] : ['secretary', 'director'];
  const valid = email.includes('@') && name.trim().length > 0 && password.length >= MIN_PASSWORD;

  async function save() {
    setBusy(true); setErr(null);
    try { onCreated(await api.createUser({ email: email.trim(), display_name: name.trim(), role, password })); }
    catch (x) { setErr(toAppError(x).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo tài khoản"
      footer={<>
        {err && <span className="mr-auto self-center text-sm text-red-600">{err}</span>}
        <button className="btn-outline" onClick={onClose}>Hủy</button>
        <button className="btn-primary" disabled={!valid || busy} onClick={save}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button>
      </>}>
      <div className="space-y-2">
        <div><label className="label">Email đăng nhập</label>
          <input className="input" type="email" autoComplete="off" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label">Tên hiển thị</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Vai trò</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <PasswordField value={password} onChange={setPassword} />
      </div>
    </Modal>
  );
}

function SetPasswordModal({ user, onClose, onDone }: { user: UserAccount | null; onClose: () => void; onDone: (u: UserAccount) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPassword(''); setErr(null); }, [user]);

  async function save() {
    if (!user) return;
    setBusy(true); setErr(null);
    try { await api.setUserPassword(user.id, password); onDone(user); }
    catch (x) { setErr(toAppError(x).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={user ? `Đặt mật khẩu — ${user.display_name}` : ''}
      footer={<>
        {err && <span className="mr-auto self-center text-sm text-red-600">{err}</span>}
        <button className="btn-outline" onClick={onClose}>Hủy</button>
        <button className="btn-primary" disabled={password.length < MIN_PASSWORD || busy} onClick={save}>{busy ? 'Đang lưu…' : 'Đặt mật khẩu'}</button>
      </>}>
      <p className="mb-3 text-sm text-ink-600">{user?.email}. Tài khoản này sẽ bị đăng xuất khỏi mọi trình duyệt và phải dùng mật khẩu mới.</p>
      <PasswordField value={password} onChange={setPassword} label="Mật khẩu mới" autoFocus />
    </Modal>
  );
}
