import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await signIn(email.trim(), password); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">SORA</div>
          <h1 className="mt-1 text-xl font-semibold text-white">Executive Workspace</h1>
        </div>
        <form onSubmit={submit} className="rounded-xl bg-white p-6 shadow-xl">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" className="input mb-3" value={email}
                 onChange={(e) => setEmail(e.target.value)} required />
          <label className="label" htmlFor="pw">Mật khẩu</label>
          <input id="pw" type="password" autoComplete="current-password" className="input mb-4" value={password}
                 onChange={(e) => setPassword(e.target.value)} required />
          {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
          <p className="mt-4 text-center text-[11px] text-ink-400">Không mở đăng ký. Tài khoản do quản trị tạo.</p>
        </form>
      </div>
    </div>
  );
}
