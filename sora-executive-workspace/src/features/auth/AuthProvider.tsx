import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, toAppError } from '../../lib/supabase';
import type { Profile } from '../../lib/types';

interface AuthState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Đăng nhập thành công nhưng tài khoản chưa có hồ sơ director/secretary. */
  notMember: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notMember, setNotMember] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancel = false;
    async function load() {
      if (!session) { setProfile(null); setNotMember(false); setReady(true); return; }
      const { data, error } = await supabase.from('profiles').select('id,display_name,role,active')
        .eq('id', session.user.id).maybeSingle();
      if (cancel) return;
      const p = (data as Profile | null);
      setProfile(p && p.active ? p : null);
      setNotMember(!error && !(p && p.active));
      setReady(true);
    }
    setReady(false);
    load();
    return () => { cancel = true; };
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: AuthState = {
    ready, session, profile, notMember,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw toAppError(error.message === 'Invalid login credentials' ? new Error('Sai email hoặc mật khẩu.') : error);
    },
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth phải nằm trong AuthProvider');
  return v;
}
