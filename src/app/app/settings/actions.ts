'use server';

import { revalidatePath } from 'next/cache';
import { loadSettings, saveSettings } from '@/lib/settings';

export type SettingsResult = { ok: true; message: string } | { ok: false; errors: string[] };

/**
 * Save an edit from the Settings page: `{ key: "3" }` to change one, or
 * `{ key: null }` to put it back to the default.
 *
 * A server action is a public endpoint, so the shape is checked here and the
 * values themselves are checked again inside saveSettings.
 */
export async function saveSettingsAction(input: unknown): Promise<SettingsResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Nothing to save.'] };
  }
  const clean: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value !== null && typeof value !== 'string') {
      return { ok: false, errors: [`“${key}” was not understood.`] };
    }
    clean[key] = value;
  }

  await loadSettings({ force: true });
  const result = await saveSettings(clean, 'ops');
  if (!result.ok) return result;

  revalidatePath('/app', 'layout');
  return {
    ok: true,
    message: result.changed === 0 ? 'Nothing was different, so nothing changed.' : `Saved ${result.changed} change${result.changed === 1 ? '' : 's'}.`,
  };
}
