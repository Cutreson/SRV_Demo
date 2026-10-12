import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Category, Priority, TaskStatus } from '../lib/types';
import { PRIORITY_LABEL, PRIORITY_STYLE, STATUS_LABEL, STATUS_STYLE } from '../lib/labels';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function StatusChip({ s }: { s: TaskStatus }) {
  return <span className={cx('chip', STATUS_STYLE[s])}>{STATUS_LABEL[s]}</span>;
}
export function PriorityChip({ p }: { p: Priority }) {
  if (p === 'normal') return null;
  return <span className={cx('chip', PRIORITY_STYLE[p])}>{PRIORITY_LABEL[p]}</span>;
}
export function CategoryChip({ c, short }: { c?: Category; short?: boolean }) {
  if (!c) return <span className="chip bg-ink-50 text-ink-400">—</span>;
  return (
    <span className="chip text-white" style={{ backgroundColor: c.color }} title={`${c.code}. ${c.name}`}>
      {short ? c.code : `${c.code} · ${c.name}`}
    </span>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }:
  { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 sm:pt-16" onMouseDown={onClose}>
      <div className={cx('w-full rounded-xl bg-white shadow-2xl', wide ? 'max-w-3xl' : 'max-w-md')}
           onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, title, onClose, children, footer }:
  { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-900/30" onMouseDown={onClose}>
      <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <div className="min-w-0 text-sm font-semibold">{title}</div>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">{children}</div>;
}

// ---- Toast ----
type Toast = { id: number; text: string; tone: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {list.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm shadow-lg',
            t.tone === 'err' ? 'bg-red-600 text-white' : t.tone === 'info' ? 'bg-ink-800 text-white' : 'bg-emerald-600 text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
