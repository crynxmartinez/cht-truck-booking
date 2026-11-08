import { describe, expect, it } from 'vitest';
import { render, toHtml, toPlain, type MessageContext, type TemplateKey } from './messages';

const ctx: MessageContext = {
  firstName: 'Marisol',
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
};

/** Renter emails that carry a private link, and which link it is. */
const WITH_LINK: Array<[TemplateKey, string]> = [
  ['contract_to_sign', '/sign/tok-sign-1'],
  ['contract_nudge', '/sign/tok-sign-1'],
  ['additional_driver', '/sign/tok-sign-1'],
  ['pickup_morning', '/checklist/tok-pick-1'],
  ['pickup_reminder', '/checklist/tok-pick-1'],
  ['pickup_no_show_check', '/checklist/tok-pick-1'],
  ['return_day', '/checklist/tok-drop-1'],
  ['overdue', '/checklist/tok-drop-1'],
];

const BUTTON = /\[\[([^|\]]+)\|(https?:\/\/[^\]\s]+)\]\]/g;

describe('renter emails — a link is a button, not a long web address', () => {
  it.each(WITH_LINK)('%s: the email has a button that goes to the right private page', (key, path) => {
    const email = render(key, ctx).email;
    const buttons = [...email.matchAll(BUTTON)];
    expect(buttons.length, key).toBeGreaterThanOrEqual(1);
    for (const b of buttons) expect(b[2], key).toContain(path);
  });

  it.each(WITH_LINK)('%s: no bare web address is left showing in the email', (key) => {
    const withoutButtons = render(key, ctx).email.replace(BUTTON, '');
    expect(withoutButtons, key).not.toMatch(/https?:\/\//);
  });

  it.each(WITH_LINK)('%s: in the finished email the address is behind the button, not on the page', (key) => {
    const html = toHtml(render(key, ctx).email);
    const visible = html.replace(/<a [^>]*>/g, '<a>').replace(/<[^>]+>/g, ' ');
    expect(visible, key).not.toMatch(/https?:\/\//);
    expect(visible, key).not.toMatch(/vercel\.app/);
    expect(html, key).toContain('href="http');
  });

  it.each(WITH_LINK)('%s: the plain-text copy of the email still carries the link, for mail apps that show no buttons', (key, path) => {
    const plain = toPlain(render(key, ctx).email);
    expect(plain, key).toMatch(/: https?:\/\//);
    expect(plain, key).toContain(path);
  });

  it('gives each button words that say what it does', () => {
    const labels = (key: TemplateKey) => [...render(key, ctx).email.matchAll(BUTTON)].map((m) => m[1].toLowerCase());
    expect(labels('contract_to_sign').join(' ')).toMatch(/sign/);
    expect(labels('contract_nudge').join(' ')).toMatch(/sign/);
    expect(labels('additional_driver').join(' ')).toMatch(/sign/);
    expect(labels('pickup_morning').join(' ')).toMatch(/pickup/);
    expect(labels('return_day').join(' ')).toMatch(/return/);
    expect(labels('overdue').join(' ')).toMatch(/return/);
  });
});

describe('renter text messages — still show the link, because a text has to', () => {
  it.each(WITH_LINK.filter(([key]) => key !== 'overdue'))('%s: the text has the plain link and no button markers', (key, path) => {
    const sms = render(key, ctx).sms;
    expect(sms, key).toContain(path);
    expect(sms, key).not.toMatch(/\[\[|\]\]/);
  });
});
