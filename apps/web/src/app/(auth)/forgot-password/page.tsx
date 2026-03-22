'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { authForgotPassword } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await authForgotPassword(email);
      setDevToken(data.devToken ?? null);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
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

        <h1 className="auth-heading">Forgot password?</h1>
        <p className="auth-subheading">
          Enter your email and we&apos;ll send you a reset token
        </p>

        {!submitted ? (
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="fp-email">Email address</label>
              <input
                id="fp-email"
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

            {error && <p className="auth-error">⚠ {error}</p>}

            <button className="auth-btn-primary" type="submit" disabled={loading}>
              {loading ? <><span className="auth-spinner" /> Sending…</> : 'Send reset token'}
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p className="auth-success">
              ✓ If an account with that email exists, a reset token has been generated.
            </p>

            {devToken && (
              <div>
                <p className="auth-info" style={{ marginBottom: 6 }}>
                  <strong>🛠 Dev mode:</strong> Copy the token below and paste it on the Reset
                  Password page. In production this would be sent via email.
                </p>
                <div className="auth-token-box">{devToken}</div>
              </div>
            )}

            <Link
              href={devToken ? `/reset-password?token=${encodeURIComponent(devToken)}` : '/reset-password'}
              className="auth-btn-primary"
              style={{ textDecoration: 'none', textAlign: 'center' }}
            >
              Go to Reset Password →
            </Link>
          </div>
        )}

        <p className="auth-footer">
          <Link href="/login" className="auth-link">← Back to Sign in</Link>
        </p>
      </div>
    </div>
  );
}
