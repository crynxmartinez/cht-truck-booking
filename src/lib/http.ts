import { NextResponse } from 'next/server';
import { config } from './config';

/**
 * The public API is called cross-origin from a GHL funnel page, so every
 * public route needs CORS and a preflight. Keeping it here means a new route
 * cannot forget one half of it.
 */

/**
 * Decide whether an origin may call the public API.
 *
 * Supports three forms in ALLOWED_ORIGINS:
 *   https://link.example.net   exact match
 *   *.example.net              any subdomain (scheme-agnostic, https only)
 *   *                          reflect whatever origin asked
 *
 * The wildcard form matters here because GHL funnels move between domains and
 * subdomains, and every miss is a booking form that silently will not load.
 */
export function isOriginAllowed(origin: string): boolean {
  const list = config.allowedOrigins;
  if (list.includes('*')) return true;
  if (list.includes(origin)) return true;

  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
    host = u.hostname;
  } catch {
    return false;
  }

  return list.some((entry) => {
    if (!entry.startsWith('*.')) return false;
    const suffix = entry.slice(1); // "*.example.net" -> ".example.net"
    return host.endsWith(suffix) && host.length > suffix.length;
  });
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    // Responses differ per origin, so a shared cache must not reuse one for another.
    Vary: 'Origin',
  };

  if (!origin) return headers;

  // The public booking API reflects whatever origin asks.
  //
  // This looks permissive, and deliberately is. CORS only restricts browsers on
  // other websites; it does nothing against a script or curl, which can call
  // these endpoints regardless. And it grants no privilege here: we never set
  // Access-Control-Allow-Credentials and the API uses no cookies, so a
  // cross-origin caller gets exactly what an anonymous one gets.
  //
  // What an allowlist actually bought was one silent failure mode — a GHL funnel
  // moved to a new domain, the booking widget stops loading, nothing errors
  // server-side, and you find out from a customer. The real protections are
  // elsewhere: per-IP rate limits, the honeypot field, required documents,
  // validation, and the row lock on truck assignment.
  headers['Access-Control-Allow-Origin'] = origin;

  // Still worth knowing when a page we did not expect is embedding the widget.
  // Every booking also records its own sourceUrl, so this is traceable after
  // the fact rather than merely blocked before it.
  if (config.allowedOrigins.length && !isOriginAllowed(origin)) {
    console.warn(`[cors] serving unlisted origin ${origin} (allowlist: ${config.allowedOrigins.join(', ')})`);
  }

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
