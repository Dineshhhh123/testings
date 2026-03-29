'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { authRegister, setAuthToken } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [adminId, setAdminId]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

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
      const data = await authRegister(email, password, fullName, adminId);
      setAuthToken(data.token);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <div className="auth-logo">A</div>
        </div>

        <h1 className="auth-heading">Create your account</h1>
        <p className="auth-subheading">
          Get started with ABC Automations — free to try
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-name">Full name</label>
            <input
              id="reg-name"
              className="auth-input"
              type="text"
              placeholder="Jane Smith"
              autoComplete="name"
              required
              disabled={loading}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-email">Email address</label>
            <input
              id="reg-email"
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={loading}
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
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
            <label className="auth-label" htmlFor="reg-confirm">Confirm password</label>
            <input
              id="reg-confirm"
              className="auth-input"
              type="password"
              placeholder="Repeat your password"
              autoComplete="new-password"
              required
              disabled={loading}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-admin-id">Admin Invite Code</label>
            <input
              id="reg-admin-id"
              className="auth-input"
              type="text"
              placeholder="Required to create account"
              required
              disabled={loading}
              value={adminId}
              onChange={e => setAdminId(e.target.value)}
            />
          </div>

          {error && <p className="auth-error">⚠ {error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={loading}>
            {loading ? <><span className="auth-spinner" /> Creating account…</> : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link href="/login" className="auth-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
