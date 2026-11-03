import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn((a: unknown) => ({ op: 'upsert', a })),
  deleteMany: vi.fn((a: unknown) => ({ op: 'deleteMany', a })),
  create: vi.fn((a: unknown) => ({ op: 'create', a })),
  transaction: vi.fn(async (ops: unknown[]) => ops),
}));

vi.mock('./db', () => ({
  prisma: {
    setting: { findMany: mocks.findMany, upsert: mocks.upsert, deleteMany: mocks.deleteMany, create: mocks.create },
    $transaction: mocks.transaction,
  },
}));

import { render, renderDefault, type MessageContext } from './messages';
import { applyWording } from './wording-store';
import { defaultWording } from './wording';
import { loadSettings } from './settings';
import { resetWording, saveWording, wordingFromRows, wordingHistory } from './wording-db';

const ctx = (over: Partial<MessageContext> = {}): MessageContext => ({
  firstName: 'Marisol',
  reference: 'CHT-8KQ2',
  truckCode: 'B',
  pickupDate: '2026-12-03',
  returnDate: '2026-12-05',
  lockboxCode: '48151',
  contractToken: 'tok-sign-1',
  pickupChecklistToken: 'tok-pick-1',
  dropoffChecklistToken: 'tok-drop-1',
  ...over,
});

const good = () => ({ ...defaultWording('contract_to_sign'), sms: 'Hi {firstName}, please sign: {signLink}' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T18:00:00Z'));
  mocks.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  applyWording({});
});

describe('render — an edit changes what is sent', () => {
  it('sends the built-in wording until the office changes it', () => {
    expect(render('contract_to_sign', ctx())).toEqual(renderDefault('contract_to_sign', ctx()));
  });

  it('sends the edited wording, with this renter’s details filled in', () => {
    applyWording({ contract_to_sign: good() });
    const r = render('contract_to_sign', ctx());
    expect(r.sms).toBe('Hi Marisol, please sign: ' + 'http://localhost:3000/sign/tok-sign-1');
    expect(r.sms).not.toContain('{');
  });

  it('leaves every other message alone', () => {
    applyWording({ contract_to_sign: good() });
    expect(render('thank_you', ctx())).toEqual(renderDefault('thank_you', ctx()));
  });

  it('falls back to the built-in text, not a blank, when the booking lacks something the edit needs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    applyWording({ contract_to_sign: good() });
    const r = render('contract_to_sign', ctx({ contractToken: null }));
    expect(r).toEqual(renderDefault('contract_to_sign', ctx({ contractToken: null })));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('goes back to the built-in text once the edit is removed', () => {
    applyWording({ contract_to_sign: good() });
    applyWording({});
    expect(render('contract_to_sign', ctx())).toEqual(renderDefault('contract_to_sign', ctx()));
  });
});

describe('wordingFromRows — what is stored, and what is trusted', () => {
  const row = (key: string, w: unknown) => ({ key: `msg.${key}`, value: JSON.stringify(w) });

  it('reads a valid edit', () => {
    expect(wordingFromRows([row('contract_to_sign', good())])).toEqual({ contract_to_sign: good() });
  });

  it('ignores one that would no longer pass the rules, rather than trust it', () => {
    const noLink = { ...good(), sms: 'Please sign soon.' };
    expect(wordingFromRows([row('contract_to_sign', noLink)])).toEqual({});
  });

  it('ignores an edit to a locked or unknown message, unreadable rows, and rows that are not edits', () => {
    expect(
      wordingFromRows([
        row('truck_changed', { subject: 'ab', email: 'ab', sms: 'ab' }),
        row('nonsense', { subject: 'ab', email: 'ab', sms: 'ab' }),
        { key: 'msg.thank_you', value: 'not json' },
        row('thank_you', { subject: 1, email: 2, sms: 3 }),
        { key: 'cfg.minLeadDays', value: '3' },
        { key: 'msglog.1.thank_you', value: '{}' },
      ]),
    ).toEqual({});
  });
});

describe('loadSettings — also brings the edited wording into effect', () => {
  it('applies a stored edit', async () => {
    mocks.findMany.mockResolvedValue([{ key: 'msg.contract_to_sign', value: JSON.stringify(good()) }]);
    await loadSettings({ force: true });
    expect(render('contract_to_sign', ctx()).sms).toMatch(/^Hi Marisol, please sign:/);
  });

  it('still takes only one query', async () => {
    await loadSettings({ force: true });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('saveWording', () => {
  it('stores a valid edit and a history entry saying who changed it', async () => {
    const r = await saveWording('contract_to_sign', good(), 'ops');
    expect(r).toEqual({ ok: true });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'msg.contract_to_sign' } }),
    );
    const log = mocks.create.mock.calls[0][0] as { data: { key: string; value: string } };
    expect(log.data.key).toBe(`msglog.${Date.now()}.contract_to_sign`);
    expect(JSON.parse(log.data.value)).toMatchObject({ by: 'ops', action: 'edited', wording: good() });
  });

  it('writes both in one transaction', async () => {
    await saveWording('contract_to_sign', good(), 'ops');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect((mocks.transaction.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it('writes nothing when the edit is refused', async () => {
    const r = await saveWording('contract_to_sign', { ...good(), sms: 'no link' }, 'ops');
    expect(r.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does nothing when the wording is the same as the built-in text', async () => {
    const r = await saveWording('contract_to_sign', defaultWording('contract_to_sign'), 'ops');
    expect(r).toEqual({ ok: true });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('refuses a locked message', async () => {
    const r = await saveWording('truck_changed', { subject: 'ab', email: 'ab', sms: 'ab' }, 'ops');
    expect(r.ok).toBe(false);
  });

  it('takes effect straight away', async () => {
    mocks.findMany.mockResolvedValue([{ key: 'msg.contract_to_sign', value: JSON.stringify(good()) }]);
    await saveWording('contract_to_sign', good(), 'ops');
    expect(render('contract_to_sign', ctx()).sms).toMatch(/^Hi Marisol, please sign:/);
  });
});

describe('resetWording', () => {
  it('removes the edit and records that it was put back', async () => {
    const r = await resetWording('contract_to_sign', 'ops');
    expect(r).toEqual({ ok: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { key: 'msg.contract_to_sign' } });
    const log = mocks.create.mock.calls[0][0] as { data: { value: string } };
    expect(JSON.parse(log.data.value)).toMatchObject({ action: 'put back', by: 'ops', wording: null });
  });
});

describe('wordingHistory', () => {
  it('lists the newest first', async () => {
    mocks.findMany.mockResolvedValue([
      { key: 'msglog.1730570000000.contract_to_sign', value: JSON.stringify({ by: 'ops', action: 'edited', wording: good() }) },
      { key: 'msglog.1730560000000.contract_to_sign', value: JSON.stringify({ by: 'ops', action: 'put back', wording: null }) },
    ]);
    const h = await wordingHistory('contract_to_sign', 10);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ action: 'edited', by: 'ops' });
    expect(h[1]).toMatchObject({ action: 'put back', wording: null });
    const arg = mocks.findMany.mock.calls[0][0] as { where: { key: { startsWith: string } }; orderBy: unknown };
    expect(arg.where.key.startsWith).toBe('msglog.');
    expect(arg.orderBy).toEqual({ key: 'desc' });
  });

  it('shows only this message’s history and skips rows it cannot read', async () => {
    mocks.findMany.mockResolvedValue([
      { key: 'msglog.2.thank_you', value: JSON.stringify({ by: 'ops', action: 'edited', wording: good() }) },
      { key: 'msglog.1.contract_to_sign', value: 'not json' },
    ]);
    expect(await wordingHistory('contract_to_sign', 10)).toEqual([]);
  });
});
