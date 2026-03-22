import type { ReactNode } from 'react';
import { AuthGuard } from '@/lib/auth-guard';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard redirectIfAuthenticated>
      {children}
    </AuthGuard>
  );
}
