import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import RewardsLayer from '../../components/rewards/RewardsLayer';

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="gocNavLink"
    >
      {label}
    </a>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle();

  const role = roleRow?.role ?? 'unknown';

  const email = data.user.email ?? '';
  const initial = email ? email.slice(0, 1).toUpperCase() : 'U';

  const parentTabs = [
    { href: '/admin/assignments', label: 'Schedule' },
    { href: '/dashboard', label: 'Family Overview' },
    { href: '/admin/approvals', label: 'Approvals' },
    { href: '/admin/backfill', label: 'Backfill' },
    { href: '/admin/chores', label: 'Manage Chores' },
    { href: '/household', label: 'Expenses' },
    { href: '/purchases', label: 'Purchases' },
    { href: '/reports', label: 'Reports' },
  ];
  const childTabs = [
    { href: '/dashboard', label: 'My Wallet' },
    { href: '/chores', label: 'Chores' },
    { href: '/transactions', label: 'Allocations' },
    { href: '/purchases', label: 'Purchases' },
    { href: '/reports', label: 'Reports' },
  ];

  const tabs = role === 'parent' ? parentTabs : role === 'child' ? childTabs : [{ href: '/dashboard', label: 'Dashboard' }];

  return (
    <div className="gocShell">
      <div className="gocContainer">
        <header className="gocHeader">
          <a href="/dashboard" className="gocBrand">
            <div className="gocLogoBox" aria-hidden>
              <img
                src="/art/chorex-login.png"
                alt=""
                width={44}
                height={44}
                style={{ width: 44, height: 44, objectFit: 'cover' }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>Game of Chores</div>
              <div style={{ opacity: 0.85, fontSize: 12 }}>
                {role === 'parent' ? 'Parent' : role === 'child' ? 'Kid' : 'Member'} • gameofchores.fun
              </div>
            </div>
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="gocHeaderCard" style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 900, fontSize: 13 }}>{email}</div>
              <div style={{ opacity: 0.85, fontSize: 12 }}>{role}</div>
            </div>
            <div className="gocHeaderCard" style={{ width: 44, height: 44, borderRadius: 999, display: 'grid', placeItems: 'center', fontWeight: 950 }}>
              {initial}
            </div>
            <a href="/logout" title="Logout" className="gocHeaderCard" style={{ textDecoration: 'none', padding: 12 }}>
              ↩
            </a>
          </div>
        </header>

        {children}

        {/* Global rewards overlay (kid-friendly animations & sounds) */}
        <RewardsLayer />
      </div>

      <nav className="gocNav">
        <div className="gocNavInner">
          {tabs.map((t) => (
            <NavLink key={t.href} href={t.href} label={t.label} />
          ))}
          {role === 'parent' ? <NavLink href="/admin/kids" label="Kids" /> : null}
          {role === 'parent' ? <NavLink href="/admin/settings" label="Admin" /> : null}
        </div>
      </nav>
    </div>
  );
}
