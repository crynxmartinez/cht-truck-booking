import { prisma } from './db';
import type { TemplateKey } from './messages';
import { EDITABLE, validateWording } from './wording';
import type { Wording } from './wording-fill';
import { applyWording } from './wording-store';

/**
 * The office's edited message wording, in the database.
 *
 * Stored in the same key/value `Setting` table as everything else: one row per
 * edited message (`msg.<template>`), plus one history row per change
 * (`msglog.<ms>.<template>`). A message nobody has edited has no row and uses
 * the built-in text; putting one back is just deleting its row. Every stored
 * edit is re-checked when it is read, so a rule that is tightened later can
 * never leave a broken message in use.
 */

export const EDIT_PREFIX = 'msg.';
const HISTORY_PREFIX = 'msglog.';

const isWording = (v: unknown): v is Wording => {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return typeof w.subject === 'string' && typeof w.email === 'string' && typeof w.sms === 'string';
};

/** Turns stored rows into edits, trusting only what still passes the rules. */
export function wordingFromRows(rows: ReadonlyArray<{ key: string; value: string }>): Record<string, Wording> {
  const out: Record<string, Wording> = {};
  for (const row of rows) {
    if (!row.key.startsWith(EDIT_PREFIX)) continue;
    const key = row.key.slice(EDIT_PREFIX.length);
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (isWording(parsed) && validateWording(key as TemplateKey, parsed).ok) out[key] = parsed;
    } catch {
      // A row nobody can read is ignored: the built-in text is used instead.
    }
  }
  return out;
}

async function reload(): Promise<void> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: EDIT_PREFIX } } });
  applyWording(wordingFromRows(rows));
}

export type SaveWording = { ok: true } | { ok: false; errors: string[] };

const same = (a: Wording, b: Wording) => a.subject === b.subject && a.email === b.email && a.sms === b.sms;

export async function saveWording(key: TemplateKey, input: Wording, by: string): Promise<SaveWording> {
  const wording: Wording = { subject: input.subject.trim(), email: input.email.trim(), sms: input.sms.trim() };

  const checked = validateWording(key, wording);
  if (!checked.ok) return checked;

  // Nothing to store if it is just the built-in text again.
  const { defaultWording } = await import('./wording');
  const builtIn = defaultWording(key);
  if (same(wording, { subject: builtIn.subject.trim(), email: builtIn.email.trim(), sms: builtIn.sms.trim() })) {
    // Saving the original text over an edit means "put it back", or the edit would stay in force.
    const existing = await prisma.setting.findUnique({ where: { key: `${EDIT_PREFIX}${key}` } });
    return existing ? resetWording(key, by) : { ok: true };
  }

  const storageKey = `${EDIT_PREFIX}${key}`;
  const value = JSON.stringify(wording);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: storageKey }, create: { key: storageKey, value }, update: { value } }),
    prisma.setting.create({
      data: { key: `${HISTORY_PREFIX}${Date.now()}.${key}`, value: JSON.stringify({ by, action: 'edited', wording }) },
    }),
  ]);
  await reload();
  return { ok: true };
}

/** Put a message back to the built-in text. The edit is removed; the history keeps it. */
export async function resetWording(key: TemplateKey, by: string): Promise<SaveWording> {
  if (!EDITABLE.includes(key)) return { ok: false, errors: ['That is not a message that can be edited.'] };
  await prisma.$transaction([
    prisma.setting.deleteMany({ where: { key: `${EDIT_PREFIX}${key}` } }),
    prisma.setting.create({
      data: { key: `${HISTORY_PREFIX}${Date.now()}.${key}`, value: JSON.stringify({ by, action: 'put back', wording: null }) },
    }),
  ]);
  await reload();
  return { ok: true };
}

export type WordingVersion = { at: Date; by: string; action: 'edited' | 'put back'; wording: Wording | null };

/** The latest changes to one message, newest first, so an earlier version can be brought back. */
export async function wordingHistory(key: TemplateKey, limit = 10): Promise<WordingVersion[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: HISTORY_PREFIX, endsWith: `.${key}` } },
    orderBy: { key: 'desc' },
    take: limit * 3,
  });

  const out: WordingVersion[] = [];
  for (const row of rows) {
    const [, epoch, ...rest] = row.key.split('.');
    if (rest.join('.') !== key) continue;
    try {
      const body = JSON.parse(row.value) as { by?: unknown; action?: unknown; wording?: unknown };
      if (typeof body.by !== 'string' || (body.action !== 'edited' && body.action !== 'put back')) continue;
      if (body.wording !== null && !isWording(body.wording)) continue;
      out.push({ at: new Date(Number(epoch)), by: body.by, action: body.action, wording: body.wording });
    } catch {
      // Skipped, not allowed to break the page.
    }
    if (out.length >= limit) break;
  }
  return out;
}
