'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { me, signOut as signOutRequest } from '../api/auth';
import type { Me } from '../shared/types';

/**
 * Holds who is signed in, for rendering only.
 *
 * MR-PLT-05 requires a role change to take effect on the next request, so nothing here is
 * authoritative for permission. Every action still calls the API, which re-reads the role
 * from the user record on the server. This context decides what a screen draws; it never
 * decides what the server allows, and the two are meant to be capable of disagreeing per
 * MR-PLT-02.
 */
interface SessionValue {
  principal: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession used outside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [principal, setPrincipal] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await me();
    if (result.ok) {
      setPrincipal(result.data);
    } else {
      // 401 is the only refusal /me can give a live browser, and MR-PLT-03 says the
      // interface returns the user to sign-in when it arrives.
      setPrincipal(null);
      router.replace('/signin?reason=session-ended');
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    // MR-PLT-04: the record is deleted server side. The refusal on the way out is ignored
    // deliberately, because signing out of an already expired session still ends here.
    await signOutRequest();
    setPrincipal(null);
    router.replace('/signin');
  }, [router]);

  return (
    <SessionContext.Provider value={{ principal, loading, refresh, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
