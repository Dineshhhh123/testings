'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { authResetPassword } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [token, setToken]     = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Pre-fill token from query string
  useEffect(() => {
    const t = params.get('token');
    if (t) setToken(t);
  }, [params]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authResetPassword(token, password);
      setSuccess(true);
      // Redirect to login after 2.5 seconds
      setTimeout(() => router.push('/login'), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="auth-success">
          ✓ Password reset successfully! Redirecting you to Sign in…
        </p>
        <Link href="/login" className="auth-btn-primary" style={{ textDecoration: 'none', textAlign: 'center' }}>
          Go to Sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label className="auth-label" htmlFor="rp-token">Reset token</label>
        <input
          id="rp-token"
          className="auth-input"
          type="text"
          placeholder="Paste your reset token here"
          required
          disabled={loading}
          value={token}
          onChange={e => setToken(e.target.value)}
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="rp-password">New password</label>
        <input
          id="rp-password"
          className="auth-input"
          type="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          required
          disabled={loading}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="rp-confirm">Confirm new password</label>
        <input
          id="rp-confirm"
          className="auth-input"
          type="password"
          placeholder="Repeat your new password"
          autoComplete="new-password"
          required
          disabled={loading}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
        />
      </div>

      {error && <p className="auth-error">⚠ {error}</p>}

      <button className="auth-btn-primary" type="submit" disabled={loading}>
        {loading ? <><span className="auth-spinner" /> Resetting…</> : 'Reset password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <div className="auth-logo">A</div>
        </div>

        <h1 className="auth-heading">Reset your password</h1>
        <p className="auth-subheading">
          Enter your reset token and choose a new password
        </p>

        <Suspense fallback={<p className="auth-subheading">Loading…</p>}>
          <ResetForm />
        </Suspense>

        <p className="auth-footer">
          <Link href="/login" className="auth-link">← Back to Sign in</Link>
        </p>
      </div>
    </div>
  );
}
