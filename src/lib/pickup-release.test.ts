import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel, MessageStatus } from '@prisma/client';

const findUnique = vi.fn();
const updateMany = vi.fn();
const notify = vi.fn();
const setStage = vi.fn();
const logEvent = vi.fn();

vi.mock('./db', () => ({
  prisma: {
    booking: { findUnique: (...a: unknown[]) => findUnique(...a) },
    messageLog: { updateMany: (...a: unknown[]) => updateMany(...a) },
  },
}));
vi.mock('./notify', () => ({
  notify: (...a: unknown[]) => notify(...a),
  setStage: (...a: unknown[]) => setStage(...a),
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

import { duePickupMessage, sendDuePickupMessage } from './pickup-release';

const TODAY = '2026-10-09';
const clockAt = (hour: number, minute = 0) => ({
  today: TODAY,
  hour,
  now: new Date(`${TODAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`),
});

type Row = { id: string; template: string; channel: MessageChannel; status: MessageStatus; sentAt: Date | null; createdAt: Date };
const row = (template: string, channel: MessageChannel, status: MessageStatus, hour = 6): Row => {
  const at = clockAt(hour).now;
  return {
    id: `${template}-${channel}`,
    template,
    channel,
    status,
    sentAt: status === MessageStatus.SENT ? at : null,
    createdAt: at,
  };
};

function bookingWith(rows: Row[], over: Record<string, unknown> = {}) {
  findUnique.mockResolvedValue({
    stage: 'CONFIRMED',
    pickupDate: new Date(`${TODAY}T00:00:00Z`),
    checklists: [{ submittedAt: null }],
    messages: rows,
    ...over,
  });
}

const { EMAIL, SMS } = MessageChannel;
const { SENT, FAILED, QUEUED, SKIPPED } = MessageStatus;

beforeEach(() => {
  vi.clearAllMocks();
  notify.mockResolvedValue({ sent: [EMAIL, SMS], skipped: [], errors: [] });
  updateMany.mockResolvedValue({ count: 1 });
});

describe('duePickupMessage', () => {
  it('offers the code to a confirmed booking that has never been sent one', async () => {
    bookingWith([]);
    expect(await duePickupMessage('b1', clockAt(10))).toEqual({ template: 'pickup_morning', retry: [] });
  });

  it('returns nothing for a booking that does not exist', async () => {
    findUnique.mockResolvedValue(null);
    expect(await duePickupMessage('missing', clockAt(10))).toEqual({ template: null, retry: [] });
  });

  it('does not count a failed send as received, so the code is offered again', async () => {
    bookingWith([row('pickup_morning', EMAIL, FAILED), row('pickup_morning', SMS, FAILED)]);
    const { template, retry } = await duePickupMessage('b1', clockAt(10));
    expect(template).toBe('pickup_morning');
    expect(retry.map((r) => r.channel).sort()).toEqual([EMAIL, SMS].sort());
  });

  it('retries only the channel that failed when the other one went out', async () => {
    bookingWith([row('pickup_morning', EMAIL, SENT), row('pickup_morning', SMS, FAILED)]);
    const { template, retry } = await duePickupMessage('b1', clockAt(10));
    expect(template).toBe('pickup_morning');
    expect(retry.map((r) => r.channel)).toEqual([SMS]);
  });

  it('retries a channel that was skipped, e.g. while GoHighLevel was unconfigured', async () => {
    bookingWith([row('pickup_morning', EMAIL, SKIPPED), row('pickup_morning', SMS, SKIPPED)]);
    expect((await duePickupMessage('b1', clockAt(10))).retry).toHaveLength(2);
  });

  it('leaves a message alone while another caller is still sending it', async () => {
    bookingWith([row('pickup_morning', EMAIL, QUEUED), row('pickup_morning', SMS, QUEUED)]);
    expect(await duePickupMessage('b1', clockAt(10))).toEqual({ template: null, retry: [] });
  });

  it('moves on to the reminder once every channel of the code has gone out', async () => {
    bookingWith(
      [row('pickup_morning', EMAIL, SENT, 6), row('pickup_morning', SMS, SENT, 6)],
      { stage: 'PICKUP_DAY' },
    );
    expect(await duePickupMessage('b1', clockAt(10))).toEqual({ template: 'pickup_reminder', retry: [] });
  });

  it('sends nothing once the pickup checklist has been submitted', async () => {
    bookingWith(
      [row('pickup_morning', EMAIL, SENT, 6), row('pickup_morning', SMS, SENT, 6)],
      { stage: 'PICKUP_DAY', checklists: [{ submittedAt: new Date() }] },
    );
    expect((await duePickupMessage('b1', clockAt(15))).template).toBeNull();
  });
});

describe('sendDuePickupMessage', () => {
  it('sends the code and moves the booking to Pickup Day', async () => {
    bookingWith([]);
    expect(await sendDuePickupMessage('b1', clockAt(10))).toBe('pickup_morning');
    expect(notify).toHaveBeenCalledWith('b1', 'pickup_morning', { force: false, channels: undefined });
    expect(setStage).toHaveBeenCalledWith('b1', 'PICKUP_DAY', 'system', expect.any(String));
  });

  it('does nothing when nothing is due', async () => {
    bookingWith([], { pickupDate: new Date('2026-10-12T00:00:00Z') });
    expect(await sendDuePickupMessage('b1', clockAt(10))).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('resends only the failed channel, forced, and does not touch the one that went out', async () => {
    bookingWith([row('pickup_morning', EMAIL, SENT), row('pickup_morning', SMS, FAILED)]);
    await sendDuePickupMessage('b1', clockAt(10));
    expect(notify).toHaveBeenCalledWith('b1', 'pickup_morning', { force: true, channels: [SMS] });
  });

  it('claims a failed row atomically before resending it', async () => {
    bookingWith([row('pickup_morning', SMS, FAILED), row('pickup_morning', EMAIL, SENT)]);
    await sendDuePickupMessage('b1', clockAt(10));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'pickup_morning-SMS', status: { in: [FAILED, SKIPPED] } },
      data: { status: QUEUED, error: null },
    });
  });

  it('does not resend if another caller claimed the failed row first', async () => {
    bookingWith([row('pickup_morning', EMAIL, FAILED), row('pickup_morning', SMS, FAILED)]);
    updateMany.mockResolvedValue({ count: 0 });
    expect(await sendDuePickupMessage('b1', clockAt(10))).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(setStage).not.toHaveBeenCalled();
  });

  it('leaves the booking on Confirmed and logs it when nothing could be sent, so the next hour retries', async () => {
    bookingWith([]);
    notify.mockResolvedValue({ sent: [], skipped: [], errors: ['EMAIL: timeout', 'SMS: timeout'] });
    await sendDuePickupMessage('b1', clockAt(10));
    expect(setStage).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('b1', 'pickup_code_failed', 'EMAIL: timeout; SMS: timeout', 'system');
  });

  it('still advances when every channel was skipped without an error — no hourly loop, no false alarm', async () => {
    bookingWith([]);
    notify.mockResolvedValue({ sent: [], skipped: [EMAIL, SMS], errors: [] });
    await sendDuePickupMessage('b1', clockAt(10));
    expect(setStage).toHaveBeenCalledWith('b1', 'PICKUP_DAY', 'system', expect.any(String));
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('does not move the stage when a reminder goes out', async () => {
    bookingWith(
      [row('pickup_morning', EMAIL, SENT, 6), row('pickup_morning', SMS, SENT, 6)],
      { stage: 'PICKUP_DAY' },
    );
    expect(await sendDuePickupMessage('b1', clockAt(10))).toBe('pickup_reminder');
    expect(setStage).not.toHaveBeenCalled();
  });
});
