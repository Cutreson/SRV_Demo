import type { AuditLog } from '../../lib/types';

const IGNORE = new Set(['updated_at', 'updated_by', 'version', 'created_at', 'created_by', 'id']);

export interface FieldChange { field: string; before: unknown; after: unknown }

/** Các trường thay đổi thực chất giữa before/after của một dòng audit. */
export function changedFields(log: Pick<AuditLog, 'action' | 'before_data' | 'after_data'>): FieldChange[] {
  const b = log.before_data ?? {}, a = log.after_data ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: FieldChange[] = [];
  keys.forEach((k) => {
    if (IGNORE.has(k)) return;
    const bv = (b as Record<string, unknown>)[k], av = (a as Record<string, unknown>)[k];
    if (log.action === 'INSERT' && (av === null || av === undefined || av === '' || av === false)) return;
    if (JSON.stringify(bv) !== JSON.stringify(av)) out.push({ field: k, before: bv, after: av });
  });
  return out;
}

export function recordTitle(log: Pick<AuditLog, 'before_data' | 'after_data'>): string {
  const r = (log.after_data ?? log.before_data ?? {}) as Record<string, unknown>;
  return String(r.title ?? r.full_name ?? r.note ?? r.label ?? r.key ?? r.display_name ?? '');
}
