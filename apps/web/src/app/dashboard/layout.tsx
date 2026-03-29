 'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { clearAuthToken, getCurrentUser } from '@/lib/api';


const navItems = [
  { href: '/dashboard/whatsapp',       label: '💬 WhatsApp' },
  { href: '/dashboard/knowledge',      label: '📚 Knowledge base' },
  { href: '/dashboard/pricing',        label: '💰 Pricing' },
  { href: '/dashboard/leads',          label: '👥 Leads' },
  { href: '/dashboard/conversations',  label: '🗨️ Conversations' },
  { href: '/dashboard/quotations',     label: '📄 Quotations' },
  { href: '/dashboard/orders',         label: '📦 Orders' },
];

function DashboardSidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  // Must be null on first render (matches SSR) — populated after mount via useEffect
  const [user, setUser] = useState<{ userId: string; email: string } | null>(null);
  useEffect(() => { setUser(getCurrentUser()); }, []);

  function handleLogout() {
    clearAuthToken();
    router.push('/login');
  }


  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-header">
        <span className="dashboard-logo">A</span>
        <div>
          <div className="dashboard-brand">ABC Automations</div>
          <div className="dashboard-subbrand">AI sales workspace</div>
        </div>
      </div>

      <nav className="dashboard-nav">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (pathname?.startsWith(item.href) && item.href !== '/dashboard');
          const className = isActive
            ? 'dashboard-nav-item dashboard-nav-item--active'
            : 'dashboard-nav-item';
          return (
            <Link key={item.href} href={item.href} className={className}>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout at the bottom of sidebar */}
      <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {user?.email && (
          <div className="dashboard-subbrand" style={{ marginBottom: 8, wordBreak: 'break-all', paddingLeft: 4 }}>
            {user.email}
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            padding: '7px 10px',
            borderRadius: 8,
            background: 'rgba(220,38,38,0.07)',
            border: '1px solid rgba(220,38,38,0.2)',
            color: '#dc2626',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,38,38,0.13)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,38,38,0.07)')}
        >
          🚪 Sign out
        </button>
      </div>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <main className="page-shell">
        <div className="dashboard-shell">
          <DashboardSidebar />
          <div className="dashboard-content">
            <div className="container">{children}</div>
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}


