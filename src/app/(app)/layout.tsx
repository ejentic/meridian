'use client';

import { AppShell } from '../../components/AppShell';
import { SessionProvider } from '../../components/SessionProvider';

/**
 * Every authenticated screen sits in this route group. Sign-in is outside it, so the shell
 * never has to render a header for nobody.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
