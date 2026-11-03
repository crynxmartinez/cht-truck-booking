'use server';

import { revalidatePath } from 'next/cache';
import type { TemplateKey } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';
import { PREVIEW_RENTER, previewWording, validateWording } from '@/lib/wording';
import type { Wording } from '@/lib/wording-fill';
import { resetWording, saveWording } from '@/lib/wording-db';

export type WordingResult = { ok: true; message: string } | { ok: false; errors: string[] };
export type WordingPreview =
  | { ok: true; rendered: Wording }
  | { ok: false; errors: string[] };

/** A server action is a public endpoint, so the shape is checked here and the rules again inside. */
function parse(key: unknown, input: unknown): { key: TemplateKey; wording: Wording } | null {
  if (typeof key !== 'string' || !/^[a-z_]+$/.test(key)) return null;
  if (!input || typeof input !== 'object') return null;
  const w = input as Record<string, unknown>;
  if (typeof w.subject !== 'string' || typeof w.email !== 'string' || typeof w.sms !== 'string') return null;
  return { key: key as TemplateKey, wording: { subject: w.subject, email: w.email, sms: w.sms } };
}

/** Shows what an edit would say for a made-up renter. Saves nothing and sends nothing. */
export async function previewWordingAction(key: unknown, input: unknown): Promise<WordingPreview> {
  const parsed = parse(key, input);
  if (!parsed) return { ok: false, errors: ['That was not understood.'] };

  const checked = validateWording(parsed.key, parsed.wording);
  if (!checked.ok) return checked;

  await loadSettings();
  const shown = previewWording(parsed.key, parsed.wording, PREVIEW_RENTER);
  if (!shown.ok) return { ok: false, errors: [`It needs ${shown.missing.map((m) => `{${m}}`).join(', ')}, which is not available.`] };
  return { ok: true, rendered: shown.rendered };
}

export async function saveWordingAction(key: unknown, input: unknown): Promise<WordingResult> {
  const parsed = parse(key, input);
  if (!parsed) return { ok: false, errors: ['That was not understood.'] };

  const res = await saveWording(parsed.key, parsed.wording, 'ops');
  if (!res.ok) return res;

  revalidatePath('/app/messages');
  return { ok: true, message: 'Saved. From now on this is what renters are sent.' };
}

export async function resetWordingAction(key: unknown): Promise<WordingResult> {
  if (typeof key !== 'string') return { ok: false, errors: ['That was not understood.'] };
  const res = await resetWording(key as TemplateKey, 'ops');
  if (!res.ok) return res;

  revalidatePath('/app/messages');
  return { ok: true, message: 'Put back to the original wording.' };
}
