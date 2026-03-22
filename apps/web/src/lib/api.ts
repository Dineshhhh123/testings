'use client';

// Empty string = same-origin requests → Next.js rewrites proxy them to the backend.
// Set NEXT_PUBLIC_API_BASE_URL only if you need to hit a remote backend directly.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';


// ─── Token helpers ────────────────────────────────────────────────────────────

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('authToken');
}

export function setAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('authToken', token);
    // Store user info parsed from JWT payload (base64 middle part)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]!));
      window.localStorage.setItem('authUser', JSON.stringify(payload));
    } catch {
      // ignore parse errors
    }
  }
}

export function clearAuthToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('authToken');
    window.localStorage.removeItem('authUser');
  }
}

export function getCurrentUser(): { userId: string; email: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('authUser');
    if (!raw) return null;
    return JSON.parse(raw) as { userId: string; email: string };
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const token = getAuthToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!));
    const exp = payload.exp as number;
    return Date.now() / 1000 < exp;
  } catch {
    return false;
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>)
  };

  if (!skipAuth) {
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = (json as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(err);
  }

  return json as T;
}

// ─── Auth API helpers ─────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; fullName: string };
}

export async function authLogin(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    skipAuth: true
  });
}

export async function authRegister(
  email: string,
  password: string,
  fullName: string
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, fullName }),
    skipAuth: true
  });
}

export async function authForgotPassword(
  email: string
): Promise<{ message: string; devToken?: string | null }> {
  return apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
    skipAuth: true
  });
}

export async function authResetPassword(
  token: string,
  password: string
): Promise<{ message: string }> {
  return apiFetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
    skipAuth: true
  });
}
