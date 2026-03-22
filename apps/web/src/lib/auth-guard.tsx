'use client';

import { useRouter } from 'next/navigation';
import { useEffect, ReactNode } from 'react';
import { isAuthenticated } from './api';

interface AuthGuardProps {
  children: ReactNode;
  /** If true, redirects authenticated users away to /dashboard (for auth pages) */
  redirectIfAuthenticated?: boolean;
}

/**
 * AuthGuard — client-side authentication guard.
 * - Default: redirects unauthenticated users to /login.
 * - With redirectIfAuthenticated: redirects already-authenticated users to /dashboard.
 */
export function AuthGuard({ children, redirectIfAuthenticated = false }: AuthGuardProps) {
  const router = useRouter();

  useEffect(() => {
    const authed = isAuthenticated();
    if (redirectIfAuthenticated && authed) {
      router.replace('/dashboard');
    } else if (!redirectIfAuthenticated && !authed) {
      router.replace('/login');
    }
  }, [router, redirectIfAuthenticated]);

  return <>{children}</>;
}
