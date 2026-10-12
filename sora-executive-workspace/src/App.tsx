import { useEffect, useState, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { DataProvider, useData } from './lib/data';
import { navigate, useRoute } from './lib/router';
import { ROLE_LABEL } from './lib/labels';
import { cx, Modal, ToastProvider } from './components/ui';
import { TasksPage } from './features/tasks/TasksPage';
import { PeoplePage } from './features/people/PeoplePage';
import { AuditPage } from './features/audit/AuditPage';
import { QuickCapture } from './features/tasks/QuickCapture';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DelegatedPage } from './features/delegated/DelegatedPage';
import { InboxPage } from './features/inbox/InboxPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { GoalsPage } from './features/goals/GoalsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SettingsPage } from './features/settings/SettingsPage';

interface NavItem { path: string; label: string; render: () => ReactNode }

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Tổng quan', render: () => <DashboardPage /> },
  { path: '/calendar', label: 'Lịch', render: () => <CalendarPage /> },
  { path: '/tasks', label: 'Công việc', render: () => <TasksPage /> },
  { path: '/delegated', label: 'Giao việc', render: () => <DelegatedPage /> },
  { path: '/inbox', label: 'Nhắc việc', render: () => <InboxPage /> },
  { path: '/goals', label: 'Mục tiêu', render: () => <GoalsPage /> },
  { path: '/reports', label: 'Báo cáo', render: () => <ReportsPage /> },
  { path: '/people', label: 'Danh bạ', render: () => <PeoplePage /> },
  { path: '/audit', label: 'Nhật ký', render: () => <AuditPage /> },
  { path: '/settings', label: 'Cấu hình', render: () => <SettingsPage /> },
];
const DEFAULT_PATH = '/dashboard';

function Shell() {
  const { profile, signOut } = useAuth();
  const d = useData();
  const { path } = useRoute();
  const [menu, setMenu] = useState(false);
  const [capture, setCapture] = useState(false);
  const item = NAV.find((n) => n.path === path);

  useEffect(() => { if (!item) navigate(DEFAULT_PATH); }, [item]);
  // Phím tắt: N = ghi nhanh
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) { e.preventDefault(); setCapture(true); }
    };
    const open = () => setCapture(true);
    window.addEventListener('keydown', k);
    window.addEventListener('open-capture', open);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('open-capture', open); };
  }, []);

  const others = d.online.filter((n) => n !== profile?.display_name);
  const unread = d.notifications.filter((n) => !n.read_at).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 print:hidden border-b border-ink-800 bg-ink-900 text-white">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-3 px-3 sm:px-4">
          <button className="lg:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu">☰</button>
          <a href="#/dashboard" className="flex items-baseline gap-1.5 font-semibold">
            <span className="text-brand-500">SORA</span><span className="hidden text-sm text-ink-200 2xl:inline">Executive Workspace</span>
          </a>
          <nav className={cx('absolute left-0 right-0 top-12 flex-col bg-ink-900 lg:static lg:flex lg:flex-row lg:gap-0', menu ? 'flex' : 'hidden')}>
            {NAV.map((n) => (
              <a key={n.path} href={`#${n.path}`} onClick={() => setMenu(false)}
                 className={cx('whitespace-nowrap px-4 py-2 text-sm lg:rounded-md lg:px-2 lg:py-1.5', path === n.path ? 'bg-ink-800 text-white' : 'text-ink-300 hover:text-white')}>
                {n.label}
                {n.path === '/inbox' && unread > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <button className="btn-accent whitespace-nowrap py-1" onClick={() => setCapture(true)} title="Phím tắt: N">+ Ghi nhanh</button>
            <span className={cx('hidden items-center gap-1 whitespace-nowrap 2xl:flex', d.live ? 'text-emerald-400' : 'text-amber-400')} title={d.live ? 'Đồng bộ thời gian thực' : 'Đang kết nối lại…'}>
              ● {d.live ? (others.length ? `${others.join(', ')} đang online` : 'Đồng bộ') : 'Mất kết nối'}
            </span>
            <span className="hidden whitespace-nowrap text-ink-300 2xl:inline">{profile?.display_name} · {profile && ROLE_LABEL[profile.role]}</span>
            <button className="whitespace-nowrap text-ink-300 hover:text-white" onClick={signOut} title={profile ? `${profile.display_name} · ${ROLE_LABEL[profile.role]}` : ''}>Đăng xuất</button>
          </div>
        </div>
      </header>
      {d.error && <div className="bg-red-600 px-4 py-2 text-sm text-white">{d.error} <button className="underline" onClick={d.reload}>Thử lại</button></div>}
      <main className="px-3 py-4 sm:px-4">{item?.render()}</main>
      <Modal open={capture} onClose={() => setCapture(false)} title="Ghi nhanh việc mới" wide>
        <QuickCapture autoFocus onDone={() => setCapture(false)} />
      </Modal>
    </div>
  );
}

function Gate() {
  const { ready, session, profile } = useAuth();
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-sm text-ink-400">Đang tải…</div>;
  if (!session || !profile) return <LoginPage />;
  return <DataProvider><Shell /></DataProvider>;
}

export default function App() {
  return <ToastProvider><AuthProvider><Gate /></AuthProvider></ToastProvider>;
}
