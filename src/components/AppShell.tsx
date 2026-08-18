'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MeridianLogo } from './MeridianLogo';
import { useSession } from './SessionProvider';

/**
 * The chrome every authenticated screen sits inside.
 *
 * Navigation is grouped by module, matching how the specification and the worksheets talk
 * about Meridian, so "go to Reviews and open your evaluation" is a literal instruction.
 */

/**
 * A sidebar link that knows whether it is the current module. Detail pages count as their
 * list page ("/orders/12" is still Orders). aria-current is the accessibility contract;
 * the CSS keys off it for the active tint.
 */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { principal, loading, signOut } = useSession();

  // MR-PLT-02. This is computed on the client from the session, and it is deliberately NOT
  // a permissions response from the server. The interface decides what to draw and the API
  // decides what to allow, and the two checks are meant to be independent and therefore
  // capable of disagreeing: that gap is exactly what "it looks correct in the interface but
  // the API allows it" means, and it is what the paired tests in e2e/ exist to detect.
  // Replacing this with a server-supplied list of permitted controls would collapse the two
  // decisions into one and delete a whole class of exercise. It looks like duplication. It
  // is not. Do not remove it.
  const isAdministrator = principal?.role === 'Administrator';

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-brand">
          <MeridianLogo />
        </span>
        <span className="shell-identity">
          {loading ? (
            <span>Loading</span>
          ) : principal === null ? (
            <span>Not signed in</span>
          ) : (
            <>
              <span data-testid="signed-in-name">{principal.fullName}</span>
              <span data-testid="signed-in-role">{principal.role}</span>
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          )}
        </span>
      </header>

      <nav className="shell-sidebar" aria-label="Modules">
        <div className="shell-section">STOREFRONT</div>
        <NavLink href="/products">Products</NavLink>
        <NavLink href="/cart">Cart</NavLink>
        <NavLink href="/orders">Orders</NavLink>

        <div className="shell-section">REVIEWS</div>
        <NavLink href="/evaluations">Evaluations</NavLink>
        <NavLink href="/cycles">Cycles</NavLink>

        {isAdministrator ? (
          <>
            <div className="shell-section">ADMIN</div>
            <NavLink href="/users">Users</NavLink>
            <NavLink href="/admin/products">Product maintenance</NavLink>
          </>
        ) : null}

        <div className="shell-section">ACCOUNT</div>
        <NavLink href="/account/password">Change password</NavLink>
      </nav>

      <main className="shell-main">{children}</main>

      <footer className="shell-footer">
        Meridian is a fictional application used for QA training. Its data and defects are
        intentional training material, not a real product or system.
      </footer>
    </div>
  );
}
