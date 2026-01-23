import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid transparent',
      }}
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
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px 88px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ width: 38, height: 38, borderRadius: 14, background: '#f0eefe', display: 'grid', placeItems: 'center', fontWeight: 900 }}>
              ₨
            </div>
            <div>
              <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>gameofchores.fun</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{role === 'parent' ? 'Parent' : role === 'child' ? 'Kid' : 'Member'}</div>
            </div>
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{email}</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{role}</div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 999, background: '#f6d7a3', display: 'grid', placeItems: 'center', fontWeight: 900 }}>
              {initial}
            </div>
            <a href="/logout" title="Logout" style={{ textDecoration: 'none', padding: 10, borderRadius: 12, border: '1px solid #eee', background: 'white' }}>
              ↩
            </a>
          </div>
        </header>

        {children}
      </div>

      <nav
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: 'white',
          borderTop: '1px solid #eee',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 10, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
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
