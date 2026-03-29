import type { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { prisma } from '@blink/database/src/client';
import { env } from '../../common/config/env';

const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const RESET_TTL_MS = 15 * 60 * 1000; // 15 minutes

// In-memory store for password reset tokens (sufficient for local dev)
// Map<email, { token: string; expiry: number }>
const resetTokenStore = new Map<string, { token: string; expiry: number }>();

function signToken(payload: { userId: string; email: string }) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

function signResetToken(payload: { email: string }) {
  return jwt.sign(payload, env.JWT_SECRET + '-reset', { expiresIn: '15m' });
}

async function ensureDefaultClientForUser(userId: string, fullName: string, email: string) {
  const existingMembership = await prisma.clientMember.findFirst({
    where: { userId }
  });
  if (existingMembership) {
    return prisma.client.findUnique({ where: { id: existingMembership.clientId } });
  }

  const baseSlug =
    email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ||
    fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let slug = baseSlug || 'client';
  let suffix = 1;

  // Ensure slug is unique
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.client.findUnique({ where: { slug } });
    if (!existing) break;
    slug = `${baseSlug || 'client'}-${suffix++}`;
  }

  const client = await prisma.client.create({
    data: {
      name: `${fullName}'s Workspace`,
      slug
    }
  });

  await prisma.clientMember.create({
    data: {
      clientId: client.id,
      userId,
      role: 'OWNER'
    }
  });

  return client;
}

export function registerAuthRoutes(router: Router) {
  router.post('/auth/register', async (req: Request, res: Response) => {
    const { email, password, fullName, adminId } = req.body ?? {};

    if (env.ADMIN_REGISTRATION_ID && adminId !== env.ADMIN_REGISTRATION_ID) {
      res.status(403).json({ error: 'Invalid or missing Admin Invite Code. Registration denied.' });
      return;
    }

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'email, password and fullName are required' });
      return;
    }

    const existing = await prisma.dashboardUser.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.dashboardUser.create({
      data: {
        email,
        fullName,
        passwordHash
      }
    });

    await ensureDefaultClientForUser(user.id, user.fullName, user.email);

    const token = signToken({ userId: user.id, email: user.email });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName
      }
    });
  });

  router.post('/auth/login', async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const user = await prisma.dashboardUser.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    await ensureDefaultClientForUser(user.id, user.fullName, user.email);

    const token = signToken({ userId: user.id, email: user.email });

    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName
      }
    });
  });

  // Forgot password — generates a reset token and returns it directly (for local dev).
  // In production, send this token via email instead.
  router.post('/auth/forgot-password', async (req: Request, res: Response) => {
    const { email } = req.body ?? {};

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    const user = await prisma.dashboardUser.findUnique({ where: { email } });

    // Always return 200 to avoid leaking whether the email exists
    if (!user) {
      res.status(200).json({
        message: 'If an account with that email exists, a reset token has been generated.',
        // dev-only hint (no token since user doesn't exist)
        devToken: null
      });
      return;
    }

    const resetToken = signResetToken({ email: user.email });
    resetTokenStore.set(user.email, {
      token: resetToken,
      expiry: Date.now() + RESET_TTL_MS
    });

    res.status(200).json({
      message: 'If an account with that email exists, a reset token has been generated.',
      // NOTE: In production, remove devToken and email this instead.
      devToken: resetToken
    });
  });

  // Reset password — verifies the reset token and updates the password.
  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    const { token, password } = req.body ?? {};

    if (!token || !password) {
      res.status(400).json({ error: 'token and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    let decoded: { email: string };
    try {
      decoded = jwt.verify(token, env.JWT_SECRET + '-reset') as { email: string };
    } catch {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const stored = resetTokenStore.get(decoded.email);
    if (!stored || stored.token !== token || Date.now() > stored.expiry) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const user = await prisma.dashboardUser.findUnique({ where: { email: decoded.email } });
    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.dashboardUser.update({
      where: { email: decoded.email },
      data: { passwordHash }
    });

    // Invalidate the token after use
    resetTokenStore.delete(decoded.email);

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  });
}


