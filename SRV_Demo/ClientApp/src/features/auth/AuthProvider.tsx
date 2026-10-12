import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, AppError, toAppError, UNAUTHORIZED_EVENT } from '../../lib/api';
import { realtime } from '../../lib/realtime';
import type { Profile } from '../../lib/types';

interface AuthState {
  ready: boolean;
  /** Signed-in, active director/secretary account; null when signed out. */
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the account (e.g. after renaming it). */
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Session lives in an HttpOnly cookie; ask the server who we are.
  useEffect(() => {
    let cancel = false;
    api.me()
      .then((p) => { if (!cancel) setProfile(p ?? null); })
      .catch(() => { if (!cancel) setProfile(null); })
      .finally(() => { if (!cancel) setReady(true); });
    return () => { cancel = true; };
  }, []);

  // Any API call answering 401 (cookie expired, account deactivated) returns the user to the login page.
  useEffect(() => {
    const h = () => setProfile(null);
    window.addEventListener(UNAUTHORIZED_EVENT, h);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, h);
  }, []);

  // Realtime connection exists only while signed in.
  useEffect(() => {
    if (profile) void realtime.start(); else void realtime.stop();
  }, [profile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try { setProfile(await api.login(email, password)); }
    catch (e) { throw e instanceof AppError ? e : toAppError(e); }
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } finally { setProfile(null); }
  }, []);

  const refreshProfile = useCallback(async () => {
    try { const p = await api.me(); if (p) setProfile(p); } catch { /* keep current */ }
  }, []);

  return <Ctx.Provider value={{ ready, profile, signIn, signOut, refreshProfile }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth phải nằm trong AuthProvider');
  return v;
}
