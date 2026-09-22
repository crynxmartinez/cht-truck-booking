import { createSign } from 'node:crypto';
import { config } from './config';

/**
 * Google Calendar, just the three calls this system makes.
 *
 * We write to the shared truck calendar directly rather than letting
 * GoHighLevel sync it. GHL routes a booking to Google via the assigned team
 * member's *one* linked calendar, so it has no way to tell Truck A from
 * Truck B — which is the whole thing the office wanted back.
 *
 * Auth is a service account: a self-signed JWT exchanged for an access token.
 * That is little enough work to do with node:crypto, and it keeps a very large
 * Google SDK out of a bundle that only needs three endpoints.
 */

type GcalResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached: { token: string; expiresAt: number } | null = null;

/** Access token for the service account, reused until it is nearly stale. */
async function accessToken(): Promise<GcalResult<string>> {
  if (!config.gcal.enabled) {
    return { ok: false, error: 'Google Calendar is not configured.' };
  }
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { ok: true, data: cached.token };
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: config.gcal.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;

  let assertion: string;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    assertion = `${unsigned}.${b64url(signer.sign(config.gcal.privateKey))}`;
  } catch (err) {
    // Almost always a mangled PEM: the newlines did not survive the env var.
    return { ok: false, error: `Could not sign the Google token: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
    if (!res.ok || !json?.access_token) {
      return { ok: false, error: json?.error_description || `Token request failed (HTTP ${res.status}).`, status: res.status };
    }
    cached = { token: json.access_token, expiresAt: Date.now() + 3_600_000 };
    return { ok: true, data: json.access_token };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function call<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<GcalResult<T>> {
  const auth = await accessToken();
  if (!auth.ok) return auth;

  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${auth.data}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    // DELETE answers 204 with an empty body.
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      const msg =
        (json as { error?: { message?: string } } | null)?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      return { ok: false, error: String(msg), status: res.status };
    }
    return { ok: true, data: (json ?? {}) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type GcalEvent = {
  id: string;
  summary: string;
  description?: string;
  /** Local wall-clock times, e.g. 2026-10-17T06:00:00. */
  start: string;
  end: string;
  timeZone: string;
  /** Google's palette index — see COLOR in calendar-sync. */
  colorId?: string;
  status?: 'confirmed' | 'tentative';
};

function toBody(e: GcalEvent) {
  return {
    id: e.id,
    summary: e.summary,
    description: e.description ?? '',
    start: { dateTime: e.start, timeZone: e.timeZone },
    end: { dateTime: e.end, timeZone: e.timeZone },
    colorId: e.colorId,
    status: e.status ?? 'confirmed',
    // The renter is not a Google guest; nobody should get an invitation.
    attendees: [],
    reminders: { useDefault: false },
  };
}

const enc = encodeURIComponent;

/**
 * Create or overwrite one event.
 *
 * Uses the caller's own id rather than letting Google mint one, which is what
 * makes the whole sync idempotent: re-running it patches the same row instead
 * of leaving a duplicate on the office calendar.
 */
export async function putEvent(calendarId: string, event: GcalEvent): Promise<GcalResult<{ id: string }>> {
  const created = await call<{ id: string }>('POST', `/calendars/${enc(calendarId)}/events`, toBody(event));
  if (created.ok) return created;

  // 409 means that id already exists — including one deleted earlier, whose id
  // Google keeps reserved. Updating it is the correct repair either way.
  if (created.status === 409) {
    return call<{ id: string }>('PUT', `/calendars/${enc(calendarId)}/events/${enc(event.id)}`, toBody(event));
  }
  return created;
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<GcalResult<null>> {
  const res = await call<null>('DELETE', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
  // Already gone is the state we wanted.
  if (!res.ok && (res.status === 404 || res.status === 410)) return { ok: true, data: null };
  return res;
}

/** Confirms the credentials work and the service account can see the calendar. */
export async function ping(): Promise<GcalResult<{ summary?: string }>> {
  return call<{ summary?: string }>('GET', `/calendars/${enc(config.gcal.calendarId)}`);
}
