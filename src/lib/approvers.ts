/**
 * Who may sign off a rental, now that there can be several main admins.
 *
 * The CRM has no login, so the system cannot tell which of them is at the
 * screen. The person approving says who they are, from a list, and the
 * approval is recorded and stamped as that person. It is a record of who
 * approved, not a lock; the thing it prevents is the wrong signature going on
 * a contract by accident.
 *
 * Pure rules only. approvals.ts does the database work around them.
 */

export type Approver = { id: string; name: string; hasSignature: boolean };

/** More than a handful is a mistake, not a team. */
export const MAX_MAIN_ADMINS = 5;

export type Chosen = { ok: true; approver: Approver } | { ok: false; error: string };

/**
 * `candidates` are the active main admins. With one, nobody needs to be named.
 * With several, the caller must name one: guessing could put the wrong
 * person's signature on a legal document.
 */
export function chooseApprover(candidates: Approver[], requestedId?: string | null): Chosen {
  if (candidates.length === 0) {
    return { ok: false, error: 'No main admin is set. Add one under Notifications before approving.' };
  }

  let who: Approver | undefined;
  if (requestedId) {
    who = candidates.find((c) => c.id === requestedId);
    if (!who) return { ok: false, error: 'That person is not a main admin, so they cannot approve.' };
  } else if (candidates.length === 1) {
    who = candidates[0];
  } else {
    return { ok: false, error: 'Choose who is approving first.' };
  }

  if (!who.hasSignature) {
    return {
      ok: false,
      error: `${who.name} has no signature on file. Add one under Notifications before approving.`,
    };
  }
  return { ok: true, approver: who };
}

export function canAddMainAdmin(currentCount: number): string | null {
  return currentCount >= MAX_MAIN_ADMINS
    ? `There can be at most ${MAX_MAIN_ADMINS} main admins. Make one of them a regular admin first.`
    : null;
}

/**
 * Removing, demoting or switching off a main admin is fine unless it leaves
 * nobody able to approve. A main admin without a signature cannot approve, so
 * they do not count as somebody who can.
 */
export function canStopBeingMainAdmin(candidates: Approver[], personId: string): string | null {
  const isOne = candidates.some((c) => c.id === personId);
  if (!isOne) return null;
  const othersWhoCanSign = candidates.filter((c) => c.id !== personId && c.hasSignature);
  return othersWhoCanSign.length === 0
    ? 'That is the last main admin who can sign, so nobody could approve rentals. Add and sign for another main admin first.'
    : null;
}
