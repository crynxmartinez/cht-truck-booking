import { describe, expect, it } from 'vitest';
import { MAX_MAIN_ADMINS, canAddMainAdmin, canStopBeingMainAdmin, chooseApprover, type Approver } from './approvers';

const diana: Approver = { id: 'd', name: 'Diana', hasSignature: true };
const dana: Approver = { id: 'n', name: 'Dana', hasSignature: true };
const sam: Approver = { id: 's', name: 'Sam', hasSignature: false };

describe('chooseApprover — who is signing this one', () => {
  it('refuses when nobody can approve, and says how to fix it', () => {
    const r = chooseApprover([], undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No main admin/i);
  });

  it('uses the only main admin when there is just one and nobody was named', () => {
    expect(chooseApprover([diana], undefined)).toEqual({ ok: true, approver: diana });
    expect(chooseApprover([diana], null)).toEqual({ ok: true, approver: diana });
  });

  it('makes the person choose when there are several', () => {
    const r = chooseApprover([diana, dana], undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/choose who/i);
  });

  it('signs as whoever was chosen', () => {
    expect(chooseApprover([diana, dana], 'n')).toEqual({ ok: true, approver: dana });
  });

  it('refuses a person who is not a main admin, rather than quietly signing as someone else', () => {
    const r = chooseApprover([diana, dana], 'someone-else');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a main admin/i);
  });

  it('refuses a main admin with no signature on file, by name', () => {
    const r = chooseApprover([diana, sam], 's');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Sam has no signature/);
  });

  it('refuses a lone main admin with no signature', () => {
    const r = chooseApprover([sam], undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Sam has no signature/);
  });

  it('never picks a person for the caller when several are possible, even if only one has a signature', () => {
    expect(chooseApprover([diana, sam], undefined).ok).toBe(false);
  });
});

describe('canAddMainAdmin', () => {
  it('allows up to the limit and no more', () => {
    expect(MAX_MAIN_ADMINS).toBeGreaterThanOrEqual(3);
    expect(canAddMainAdmin(MAX_MAIN_ADMINS - 1)).toBeNull();
    expect(canAddMainAdmin(MAX_MAIN_ADMINS)).toMatch(String(MAX_MAIN_ADMINS));
  });
});

describe('canStopBeingMainAdmin — removing, demoting or switching off', () => {
  it('lets one of several go', () => {
    expect(canStopBeingMainAdmin([diana, dana], 'n')).toBeNull();
  });

  it('refuses to leave the business with nobody who can approve', () => {
    expect(canStopBeingMainAdmin([diana], 'd')).toMatch(/last main admin/i);
  });

  it('does not count a main admin with no signature as someone who can approve', () => {
    expect(canStopBeingMainAdmin([diana, sam], 'd')).toMatch(/last main admin/i);
  });

  it('lets someone who is not a main admin go', () => {
    expect(canStopBeingMainAdmin([diana], 'not-an-admin')).toBeNull();
  });
});
