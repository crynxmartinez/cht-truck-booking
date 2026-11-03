import { describe, expect, it } from 'vitest';
import {
  DOLLY_AGREEMENT,
  DOLLY_CHECKBOX_LABEL,
  GAS_AGREEMENT,
  GAS_CHECKBOX_LABEL,
  TERMS_VERSION,
  TOLL_AGREEMENT,
  fullTermsText,
} from './contract-terms';

describe('the contract terms', () => {
  it('has a new version, since the wording changed, so older signatures keep the version they were signed under', () => {
    expect(TERMS_VERSION).not.toBe('2026-09-07.1');
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('puts the gas and dolly clauses into the text that is hashed against each signature', () => {
    const text = fullTermsText();
    expect(text).toContain(GAS_AGREEMENT);
    expect(text).toContain(DOLLY_AGREEMENT);
    expect(text).toContain(TOLL_AGREEMENT);
    expect(text.startsWith(TERMS_VERSION)).toBe(true);
  });

  it('says what the renter is agreeing to, plainly, in the first person', () => {
    for (const s of [GAS_AGREEMENT, DOLLY_AGREEMENT]) expect(s).toMatch(/\bI\b/);
    expect(GAS_AGREEMENT).toMatch(/fuel/i);
    expect(DOLLY_AGREEMENT).toMatch(/dolly/i);
    expect(GAS_CHECKBOX_LABEL).toMatch(/fuel/i);
    expect(DOLLY_CHECKBOX_LABEL).toMatch(/dolly/i);
  });

  it('does not invent a price: a fee amount is for the business to decide, not for a draft to guess', () => {
    for (const s of [GAS_AGREEMENT, DOLLY_AGREEMENT, GAS_CHECKBOX_LABEL, DOLLY_CHECKBOX_LABEL]) {
      expect(s).not.toMatch(/\$\s?\d/);
    }
  });
});
