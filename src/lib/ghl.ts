import { config } from './config';

/**
 * GoHighLevel v2 client — just the four calls this system makes.
 *
 * Every send is preceded by an upsert so we never create a duplicate contact:
 * most of these people are already in the CRM from the real-estate side, and
 * the message should land in the thread that already exists.
 */

type GhlResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

async function ghlFetch<T>(path: string, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<GhlResult<T>> {
  if (!config.ghl.enabled) {
    return { ok: false, error: 'GoHighLevel is not configured (missing token or location id).' };
  }

  const { body, ...rest } = init;
  try {
    const res = await fetch(`${config.ghl.base}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${config.ghl.token}`,
        Version: config.ghl.version,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(rest.headers ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The office should never wait on a hung third party.
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    const json = text ? safeJson(text) : null;

    if (!res.ok) {
      const msg =
        (json && (json.message || json.error || (Array.isArray(json.errors) && json.errors.join('; ')))) ||
        text.slice(0, 400) ||
        `HTTP ${res.status}`;
      return { ok: false, error: String(msg), status: res.status };
    }
    return { ok: true, data: (json ?? {}) as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- contacts

export type UpsertContactInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  tags?: string[];
  customFields?: Array<{ key?: string; id?: string; field_value: string }>;
};

export async function upsertContact(input: UpsertContactInput): Promise<GhlResult<{ contactId: string }>> {
  const res = await ghlFetch<any>('/contacts/upsert', {
    method: 'POST',
    body: {
      locationId: config.ghl.locationId,
      firstName: input.firstName,
      lastName: input.lastName,
      name: `${input.firstName} ${input.lastName}`.trim(),
      email: input.email,
      phone: input.phone,
      source: 'Truck booking widget',
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.customFields?.length ? { customFields: input.customFields } : {}),
    },
  });

  if (!res.ok) return res;
  const id = res.data?.contact?.id ?? res.data?.id ?? res.data?.contactId;
  if (!id) return { ok: false, error: 'GHL upsert succeeded but returned no contact id.' };
  return { ok: true, data: { contactId: String(id) } };
}

// ---------------------------------------------------------------- messaging

export async function sendSms(contactId: string, message: string): Promise<GhlResult<{ messageId?: string }>> {
  const res = await ghlFetch<any>('/conversations/messages', {
    method: 'POST',
    body: { type: 'SMS', contactId, message },
  });
  if (!res.ok) return res;
  return { ok: true, data: { messageId: res.data?.messageId ?? res.data?.conversationId } };
}

export async function sendEmail(
  contactId: string,
  subject: string,
  opts: { text: string; html?: string },
): Promise<GhlResult<{ messageId?: string }>> {
  const res = await ghlFetch<any>('/conversations/messages', {
    method: 'POST',
    body: {
      type: 'Email',
      contactId,
      subject,
      message: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
    },
  });
  if (!res.ok) return res;
  return { ok: true, data: { messageId: res.data?.messageId ?? res.data?.emailMessageId } };
}

// ---------------------------------------------------------------- diagnostics

/** Used by the CRM settings page to tell you whether GHL is actually wired up. */
export async function ping(): Promise<GhlResult<{ name?: string }>> {
  const res = await ghlFetch<any>(`/locations/${config.ghl.locationId}`, { method: 'GET' });
  if (!res.ok) return res;
  return { ok: true, data: { name: res.data?.location?.name ?? res.data?.name } };
}
