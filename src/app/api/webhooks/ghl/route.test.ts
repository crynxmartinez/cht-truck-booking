import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  logEvent: vi.fn(),
  notifyStaff: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { booking: { findMany: h.findMany, update: h.update }, messageLog: { create: h.create } },
}));
vi.mock('@/lib/config', () => ({ config: { ghl: { webhookKey: 'secret-key' } } }));
vi.mock('@/lib/notify', () => ({ logEvent: h.logEvent, notifyStaff: h.notifyStaff }));

import { POST } from './route';

const call = (body: unknown, key: string | null = 'secret-key') =>
  POST(
    new Request(`https://app.example/api/webhooks/ghl${key === null ? '' : `?key=${key}`}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1', reference: 'CHT-SAMPLE', stage: 'CONFIRMED', createdAt: new Date('2026-11-01'), rescheduleAsked: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([booking()]);
  h.create.mockResolvedValue({});
  h.update.mockResolvedValue({});
});

describe('reply listener', () => {
  it('refuses anyone without the key', async () => {
    expect((await call({ message: 'hi' }, null)).status).toBe(401);
    expect((await call({ message: 'hi' }, 'wrong')).status).toBe(401);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('refuses a payload that is not JSON', async () => {
    expect((await call('not json')).status).toBe(400);
  });

  it('saves a reply on the renter\'s booking, with its time, channel and a key that stops duplicates', async () => {
    const res = await call({ contactId: 'c1', phone: '(951) 555-0147', message: 'Running late', messageId: 'm1' });
    expect(await res.json()).toMatchObject({ ok: true, stored: true, reference: 'CHT-SAMPLE' });
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'b1', template: 'inbound_reply', channel: 'SMS', status: 'SENT', recipientKey: 'in:m1', body: 'Running late', providerContactId: 'c1',
      }),
    });
  });

  it('looks the renter up by contact, email and phone', async () => {
    await call({ contactId: 'c1', email: 'Sam@Example.com', phone: '9515550147', message: 'hi' });
    expect(h.findMany.mock.calls[0][0].where.OR).toEqual([{ ghlContactId: 'c1' }, { email: 'sam@example.com' }, { phone: '+19515550147' }]);
  });

  it('stores the same reply once when GoHighLevel sends it twice', async () => {
    h.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const res = await call({ contactId: 'c1', message: 'hi', messageId: 'm1' });
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('a retry still flags a reschedule request when the first attempt stored the reply but failed before flagging', async () => {
    h.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const res = await call({ contactId: 'c1', message: 'Please reschedule', messageId: 'm9' });
    expect(await res.json()).toMatchObject({ duplicate: true, flagged: 'reschedule' });
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { rescheduleAsked: true, needsReview: true } });
  });

  it('a retry does not flag it again once it is flagged', async () => {
    h.findMany.mockResolvedValue([booking({ rescheduleAsked: true })]);
    h.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await call({ contactId: 'c1', message: 'Please reschedule', messageId: 'm9' });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it('puts the reply on the booking that belongs to the contact when two bookings share a number', async () => {
    h.findMany.mockResolvedValue([
      booking({ id: 'partners', stage: 'IN_USE', createdAt: new Date('2026-11-09'), ghlContactId: 'C-B' }),
      booking({ id: 'mine', stage: 'CONFIRMED', createdAt: new Date('2026-11-01'), ghlContactId: 'C-A' }),
    ]);
    await call({ contactId: 'C-A', phone: '9515550147', message: 'hi', messageId: 'm10' });
    expect(h.create.mock.calls.at(-1)?.[0].data.bookingId).toBe('mine');
  });

  it('lets any other database failure surface, so GoHighLevel retries', async () => {
    h.create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(call({ contactId: 'c1', message: 'hi', messageId: 'm1' })).rejects.toThrow('connection reset');
  });

  it('still saves a reply after the rental has ended, on the newest booking', async () => {
    h.findMany.mockResolvedValue([booking({ id: 'old', stage: 'COMPLETED', createdAt: new Date('2026-10-01') }), booking({ id: 'newer', stage: 'COMPLETED', createdAt: new Date('2026-10-20') })]);
    await call({ contactId: 'c1', message: 'Thanks for everything', messageId: 'm2' });
    expect(h.create.mock.calls[0][0].data.bookingId).toBe('newer');
  });

  it('prefers a booking still in play over a newer finished one', async () => {
    h.findMany.mockResolvedValue([booking({ id: 'done', stage: 'COMPLETED', createdAt: new Date('2026-11-05') }), booking({ id: 'live', stage: 'IN_USE', createdAt: new Date('2026-11-01') })]);
    await call({ contactId: 'c1', message: 'hi', messageId: 'm3' });
    expect(h.create.mock.calls[0][0].data.bookingId).toBe('live');
  });

  it('ignores a message with no text, one we sent, and one from nobody we know', async () => {
    expect(await (await call({ contactId: 'c1' })).json()).toMatchObject({ ignored: expect.any(String) });
    expect(await (await call({ contactId: 'c1', message: 'ours', direction: 'outbound' })).json()).toMatchObject({ ignored: expect.any(String) });
    expect(await (await call({ message: 'hi' })).json()).toMatchObject({ ignored: expect.any(String) });
    h.findMany.mockResolvedValue([]);
    expect(await (await call({ contactId: 'zz', message: 'hi' })).json()).toMatchObject({ ignored: 'no matching booking' });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('flags a request to reschedule for the office, and changes nothing else about the booking', async () => {
    const res = await call({ contactId: 'c1', message: 'Can we reschedule?', messageId: 'm4' });
    expect(await res.json()).toMatchObject({ flagged: 'reschedule' });
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { rescheduleAsked: true, needsReview: true } });
    expect(h.notifyStaff).toHaveBeenCalledWith('b1', 'reschedule_requested', expect.anything());
  });

  it('does not flag it twice, and does not flag a finished rental', async () => {
    h.findMany.mockResolvedValue([booking({ rescheduleAsked: true })]);
    await call({ contactId: 'c1', message: 'reschedule please', messageId: 'm5' });
    h.findMany.mockResolvedValue([booking({ stage: 'COMPLETED' })]);
    await call({ contactId: 'c1', message: 'cancel please', messageId: 'm6' });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it('stores a long reply capped, and an email reply as an email', async () => {
    await call({ contactId: 'c1', message: 'x'.repeat(9000), messageId: 'm7', type: 'Email', subject: 'Re: pickup' });
    const data = h.create.mock.calls[0][0].data;
    expect(data.body.length).toBe(5000);
    expect(data).toMatchObject({ channel: 'EMAIL', subject: 'Re: pickup' });
  });
});
