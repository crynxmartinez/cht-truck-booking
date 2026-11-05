import { describe, expect, it } from 'vitest';
import { EDITABLE, LOCKED, defaultWording, previewWording, validateWording, wordingValues } from './wording';
import { renderDefault, type MessageContext } from './messages';

const real = (over: Partial<MessageContext> = {}): MessageContext => ({
  firstName: 'Marisol',
  lastName: 'Vega',
  reference: 'CHT-8KQ2',
  truckCode: 'B',
  pickupDate: '2026-12-03',
  returnDate: '2026-12-05',
  lockboxCode: '48151',
  contractToken: 'tok-sign-1',
  pickupChecklistToken: 'tok-pick-1',
  dropoffChecklistToken: 'tok-drop-1',
  additionalDriverName: 'Tomas Vega',
  renterName: 'Marisol Vega',
  agreementSigned: true,
  pickupIsToday: false,
  ...over,
});

describe('which messages can be edited', () => {
  it('locks the one whose wording depends on the situation', () => {
    expect(LOCKED).toContain('truck_changed');
    expect(EDITABLE).not.toContain('truck_changed');
  });

  it('allows every other message', () => {
    expect(EDITABLE).toHaveLength(14);
    expect(new Set([...EDITABLE, ...LOCKED]).size).toBe(15);
  });
});

describe('defaultWording — the current text, with the changing parts as placeholders', () => {
  it.each([...EDITABLE])('%s: filling the placeholders back in reproduces today’s message exactly', (key) => {
    // The strongest check there is that nothing was lost in the conversion:
    // for a real renter, the editable version and the live message are identical.
    const contexts = [
      real(),
      real({ firstName: 'Ana', truckCode: 'A', lockboxCode: '91732', pickupDate: '2027-01-14', returnDate: '2027-01-16' }),
    ];
    for (const ctx of contexts) {
      const expected = renderDefault(key, ctx);
      const filled = previewWording(key, defaultWording(key), ctx);
      expect(filled, key).toEqual({
        ok: true,
        rendered: { subject: expected.subject, email: expected.email, sms: expected.sms },
      });
    }
  });

  it('shows placeholders, not the sample renter, to the person editing', () => {
    for (const key of EDITABLE) {
      const d = defaultWording(key);
      const all = `${d.subject}${d.email}${d.sms}`;
      expect(all, key).not.toMatch(/Qfirst|QCODE|CHT-QREF|2099|qsign|qpick|qdrop|Qrenter|Qdriver/);
    }
  });

  it('uses {lockboxCode} and the checklist link in the pickup-day messages', () => {
    const d = defaultWording('pickup_morning');
    expect(d.sms).toContain('{lockboxCode}');
    expect(d.sms).toContain('{pickupChecklistLink}');
    expect(d.email).toContain('{lockboxCode}');
  });

  it('uses {signLink} in the agreement messages', () => {
    for (const key of ['contract_to_sign', 'contract_nudge'] as const) {
      expect(defaultWording(key).sms, key).toContain('{signLink}');
      expect(defaultWording(key).email, key).toContain('{signLink}');
    }
  });
});

describe('validateWording — what may be saved', () => {
  const ok = () => ({ ...defaultWording('contract_to_sign') });

  it('accepts the current wording unchanged', () => {
    for (const key of EDITABLE) expect(validateWording(key, defaultWording(key)).ok, key).toBe(true);
  });

  it('accepts a real edit', () => {
    const w = ok();
    expect(validateWording('contract_to_sign', { ...w, sms: 'Hi {firstName}, sign here please: {signLink}' }).ok).toBe(true);
  });

  it('refuses an edit that drops the sign link, naming what is missing', () => {
    const r = validateWording('contract_to_sign', { ...ok(), sms: 'Hi {firstName}, please sign soon.' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/signLink|sign link/i);
  });

  it('refuses a pickup text that loses the lockbox code or the checklist link', () => {
    const d = defaultWording('pickup_morning');
    expect(validateWording('pickup_morning', { ...d, sms: 'Your truck is ready, come on by.' }).ok).toBe(false);
    expect(validateWording('pickup_morning', { ...d, sms: d.sms.replace('{lockboxCode}', 'the code') }).ok).toBe(false);
    expect(validateWording('pickup_morning', { ...d, email: d.email.replace('{pickupChecklistLink}', '') }).ok).toBe(false);
  });

  it('judges the text and the email separately: losing the link from one is not made good by the other', () => {
    const d = defaultWording('contract_nudge');
    expect(validateWording('contract_nudge', { ...d, email: 'Please sign.' }).ok).toBe(false);
    expect(validateWording('contract_nudge', { ...d, sms: 'Please sign.' }).ok).toBe(false);
  });

  it('refuses a placeholder that does not exist', () => {
    const r = validateWording('thank_you', { ...defaultWording('thank_you'), sms: 'Thanks {firstNmae}!' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/firstNmae/);
  });

  it('refuses empty or enormous fields', () => {
    const d = defaultWording('thank_you');
    expect(validateWording('thank_you', { ...d, subject: ' ' }).ok).toBe(false);
    expect(validateWording('thank_you', { ...d, sms: '' }).ok).toBe(false);
    expect(validateWording('thank_you', { ...d, sms: 'x'.repeat(481) }).ok).toBe(false);
    expect(validateWording('thank_you', { ...d, email: 'x'.repeat(5001) }).ok).toBe(false);
    expect(validateWording('thank_you', { ...d, subject: 'x'.repeat(151) }).ok).toBe(false);
  });

  it('refuses to edit a message that is locked', () => {
    const r = validateWording('truck_changed', { subject: 'x y', email: 'x y', sms: 'x y' });
    expect(r.ok).toBe(false);
  });

  it('refuses a message that does not exist', () => {
    expect(validateWording('nonsense' as never, { subject: 'x y', email: 'x y', sms: 'x y' }).ok).toBe(false);
  });

  it('reports every problem at once', () => {
    const r = validateWording('contract_to_sign', { subject: '', email: 'no link', sms: 'no link {nope}' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('wordingValues — what each placeholder becomes', () => {
  it('fills a real renter’s details', () => {
    const v = wordingValues(real());
    expect(v.firstName).toBe('Marisol');
    expect(v.truck).toBe('Truck B');
    expect(v.lockboxCode).toBe('48151');
    expect(v.signLink).toContain('tok-sign-1');
    expect(v.pickupChecklistLink).toContain('tok-pick-1');
    expect(v.returnChecklistLink).toContain('tok-drop-1');
    expect(v.reference).toBe('CHT-8KQ2');
  });

  it('leaves a value empty when the booking does not have it, so a message needing it falls back', () => {
    const v = wordingValues(real({ contractToken: null, lockboxCode: null, truckCode: null }));
    expect(v.signLink).toBe('');
    expect(v.lockboxCode).toBe('');
    expect(v.truck).toBe('your truck');
  });
});

describe('validateWording — stray brackets are not sent to a renter', () => {
  const d = () => defaultWording('thank_you');

  it.each(['Hi { firstName }', 'Hi {first_name}', 'Hi {first name}', 'Hi {firstname}', 'Hi {{firstName}}', 'Hi {firstName', 'Hi firstName}', 'Hi {}'])(
    'refuses %j, since it would reach the renter with the brackets showing',
    (sms) => {
      expect(validateWording('thank_you', { ...d(), sms }).ok).toBe(false);
    },
  );

  it('still accepts a proper placeholder', () => {
    expect(validateWording('thank_you', { ...d(), sms: 'Thanks {firstName}!' }).ok).toBe(true);
  });
});

describe('validateWording — the lockbox code and links only go where they already did', () => {
  it('refuses the lockbox code in a message that never carried it, such as the one sent before signing', () => {
    for (const key of ['booking_received', 'contract_to_sign', 'contract_nudge', 'rental_confirmed'] as const) {
      const d = defaultWording(key);
      const r = validateWording(key, { ...d, sms: `${d.sms} Code {lockboxCode}` });
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/lockboxCode/);
    }
  });

  it('refuses the lockbox code in the subject of the pickup message', () => {
    const d = defaultWording('pickup_morning');
    expect(validateWording('pickup_morning', { ...d, subject: 'Your code {lockboxCode}' }).ok).toBe(false);
  });

  it('refuses the sign link in a message that never carried it', () => {
    const d = defaultWording('thank_you');
    expect(validateWording('thank_you', { ...d, email: `${d.email} {signLink}` }).ok).toBe(false);
  });

  it('keeps allowing the code where the built-in message has it', () => {
    const d = defaultWording('pickup_morning');
    expect(validateWording('pickup_morning', { ...d, sms: `Hi {firstName}, code {lockboxCode}. Photos: {pickupChecklistLink}` }).ok).toBe(true);
  });
});
