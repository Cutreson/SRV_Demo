import { useEffect, useState } from 'react';

/** Router tối giản theo hash (#/tasks?view=kanban) — không cần cấu hình rewrite khi deploy. */
export function parseHash(h: string = window.location.hash) {
  const raw = h.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(qs) };
}

export function useRoute() {
  const [r, setR] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(path: string, params?: Record<string, string | null | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v) q.set(k, v); });
  const s = q.toString();
  window.location.hash = path + (s ? `?${s}` : '');
}

/** Cập nhật tham số của route hiện tại (giữ path). */
export function setParams(patch: Record<string, string | null | undefined>) {
  const { path, params } = parseHash();
  Object.entries(patch).forEach(([k, v]) => { if (v) params.set(k, v); else params.delete(k); });
  const s = params.toString();
  history.replaceState(null, '', `#${path}${s ? `?${s}` : ''}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
