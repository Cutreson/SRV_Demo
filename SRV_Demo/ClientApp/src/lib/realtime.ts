import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';

/**
 * SignalR client (replaces Supabase Realtime). One connection shared by the whole app.
 * Server → client messages (see SRV_Demo/Services/Realtime.cs):
 *   "change"   { table, action, row }  – a committed row change
 *   "presence" string[]                – display names of connected users
 *
 * Reconnection: SignalR's automatic reconnect covers short outages; when it gives up (server down for a minute+)
 * or the first connect fails, `scheduleRestart` keeps trying every 5 s until `stop()` is called.
 */
export interface ChangeEvent<T = Record<string, unknown>> {
  table: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  row: T;
}

type ChangeHandler = (e: ChangeEvent) => void;

class Realtime {
  private conn: HubConnection | null = null;
  private wantRunning = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers = new Map<string, Set<ChangeHandler>>();
  private presence = new Set<(names: string[]) => void>();
  private status = new Set<(live: boolean) => void>();
  private lastPresence: string[] = [];

  /** Idempotent. Resolves once the first connect attempt finished (successful or not). */
  async start(): Promise<void> {
    this.wantRunning = true;
    if (this.conn) return;
    const c = new HubConnectionBuilder()
      .withUrl('/hubs/workspace')
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.None)
      .build();
    this.conn = c;
    c.on('change', (e: ChangeEvent) => {
      this.handlers.get(e.table)?.forEach((h) => h(e));
      this.handlers.get('*')?.forEach((h) => h(e));
    });
    c.on('presence', (names: string[]) => { this.lastPresence = names; this.presence.forEach((h) => h(names)); });
    c.onreconnecting(() => this.emitStatus(false));
    c.onreconnected(() => this.emitStatus(true));
    c.onclose(() => {
      this.emitStatus(false);
      if (this.conn === c) this.conn = null;
      this.scheduleRestart();
    });
    try {
      await c.start();
      this.emitStatus(true);
    } catch {
      this.emitStatus(false);
      if (this.conn === c) this.conn = null;
      this.scheduleRestart();
    }
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const c = this.conn;
    this.conn = null;
    this.lastPresence = [];
    if (c) { try { await c.stop(); } catch { /* ignore */ } }
    this.emitStatus(false);
  }

  private scheduleRestart() {
    if (!this.wantRunning || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.wantRunning && !this.conn) void this.start();
    }, 5000);
  }

  /** Subscribe to changes of one table ('*' = every table). Returns the unsubscribe function. */
  on(table: string, handler: ChangeHandler): () => void {
    let set = this.handlers.get(table);
    if (!set) this.handlers.set(table, (set = new Set()));
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  onPresence(h: (names: string[]) => void): () => void {
    this.presence.add(h);
    h(this.lastPresence);
    return () => { this.presence.delete(h); };
  }

  onStatus(h: (live: boolean) => void): () => void {
    this.status.add(h);
    h(this.conn?.state === HubConnectionState.Connected);
    return () => { this.status.delete(h); };
  }

  private emitStatus(live: boolean) { this.status.forEach((h) => h(live)); }
}

export const realtime = new Realtime();

/** Coalesces bursts of events (e.g. a batch insert) into one call. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...a: A) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as ((...a: A) => void) & { cancel: () => void };
  wrapped.cancel = () => { if (t) clearTimeout(t); };
  return wrapped;
}
