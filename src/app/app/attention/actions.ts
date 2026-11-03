'use server';

import { revalidatePath } from 'next/cache';
import { markHandled } from '@/lib/failure-handling';

export type HandledActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Mark failed messages as dealt with. They stay on record; only the to-do list stops showing them. */
export async function markFailuresHandled(ids: unknown): Promise<HandledActionResult> {
  const res = await markHandled(ids, 'ops');
  if (!res.ok) return res;
  revalidatePath('/app/attention');
  return { ok: true, message: res.count === 0 ? 'Nothing needed changing.' : `Marked ${res.count} as handled.` };
}
