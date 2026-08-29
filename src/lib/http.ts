import { NextResponse } from 'next/server';
import { config } from './config';

/**
 * The public API is called cross-origin from a GHL funnel page, so every
 * public route needs CORS and a preflight. Keeping it here means a new route
 * cannot forget one half of it.
 */

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (config.allowedOrigins.includes(origin) || config.allowedOrigins.includes('*'))
      ? origin
      : config.allowedOrigins[0] ?? '';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

export function json(data: unknown, init: { status?: number; origin?: string | null } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: init.origin !== undefined ? corsHeaders(init.origin) : undefined,
  });
}

export function preflight(origin: string | null) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * In-memory rate limit. Serverless means each instance keeps its own counter,
 * so this is a speed bump against casual abuse rather than a hard guarantee —
 * enough to stop somebody scripting a thousand bookings, which is all it needs
 * to do for two trucks.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }

  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

// ---------------------------------------------------------------- validation

export function cleanString(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
}

/** US mobile numbers to E.164, which is what GHL wants. */
export function toE164(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (v.trim().startsWith('+') && d.length >= 8) return `+${d}`;
  return '';
}
