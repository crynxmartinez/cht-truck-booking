import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { config } from './config';

/**
 * CRM login. Two or three staff accounts, so a signed cookie is plenty —
 * no session table to keep clean, and it survives serverless cold starts.
 */

const COOKIE = 'cht_session';
const MAX_AGE = 60 * 60 * 12; // a working day

const key = () => new TextEncoder().encode(config.sessionSecret);

export type Session = { sub: string; email: string; name?: string; role: string };

export async function createSession(user: { id: string; email: string; name?: string | null; role: string }) {
  const token = await new SignJWT({ email: user.email, name: user.name ?? undefined, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: payload.name ? String(payload.name) : undefined,
      role: String(payload.role ?? 'admin'),
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error('UNAUTHORISED');
  return s;
}

export async function verifyLogin(email: string, password: string) {
  const user = await prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    // Constant-ish work either way, so a wrong email is not faster than a wrong password.
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu');
    return null;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/** Guards the cron endpoint. Vercel sends the secret as a bearer token. */
export function isAuthorisedCron(req: Request): boolean {
  if (!config.cronSecret) return process.env.NODE_ENV !== 'production';
  const header = req.headers.get('authorization') ?? '';
  const url = new URL(req.url);
  return header === `Bearer ${config.cronSecret}` || url.searchParams.get('key') === config.cronSecret;
}
