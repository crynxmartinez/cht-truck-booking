import { describe, expect, it } from 'vitest';
import { PLACEHOLDERS, fillWording, isPlaceholder, placeholdersIn } from './wording-fill';

const vars = Object.fromEntries(PLACEHOLDERS.map((p) => [p.name, `<${p.name}>`])) as Record<string, string>;
const w = { subject: 'Hi {firstName}', email: 'Dear {firstName}, sign: {signLink}', sms: '{firstName}: {signLink}' };

describe('placeholdersIn', () => {
  it('finds each placeholder once, in order', () => {
    expect(placeholdersIn('{firstName} and {signLink} and {firstName}')).toEqual(['firstName', 'signLink']);
  });

  it('ignores braces that are not placeholders', () => {
    expect(placeholdersIn('{ nope } {123} {} plain {text')).toEqual([]);
  });

  it('knows which names are real', () => {
    expect(isPlaceholder('firstName')).toBe(true);
    expect(isPlaceholder('launchCode')).toBe(false);
  });
});

describe('fillWording', () => {
  it('puts the values in, everywhere they appear', () => {
    const r = fillWording(w, vars);
    expect(r).toEqual({
      ok: true,
      wording: { subject: 'Hi <firstName>', email: 'Dear <firstName>, sign: <signLink>', sms: '<firstName>: <signLink>' },
    });
  });

  it('refuses rather than send a blank where a value should be', () => {
    const r = fillWording(w, { ...vars, signLink: '' });
    expect(r).toEqual({ ok: false, missing: ['signLink'] });
  });

  it('refuses a placeholder that does not exist, rather than printing the braces to a customer', () => {
    const r = fillWording({ ...w, sms: 'Hello {firstNmae}' }, vars);
    expect(r.ok).toBe(false);
  });

  it('does not treat a value that itself contains braces as something to fill again', () => {
    const r = fillWording({ subject: 'x', email: 'Hi {firstName}', sms: 'y' }, { ...vars, firstName: '{signLink}' });
    expect(r).toMatchObject({ ok: true, wording: { email: 'Hi {signLink}' } });
  });

  it('leaves text with no placeholders exactly as written', () => {
    const plain = { subject: 'a', email: 'b\n\nc', sms: 'd' };
    expect(fillWording(plain, vars)).toEqual({ ok: true, wording: plain });
  });
});
