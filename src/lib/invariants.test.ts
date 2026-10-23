import { describe, expect, it } from 'vitest';
import {
  diffCalendar,
  findOverlaps,
  wrongTruckCode,
  type ActualEvent,
  type ExpectedEvent,
  type HoldRow,
} from './invariants';

const row = (id: string, truckId: string | null, start: string, end: string, stage = 'CONFIRMED'): HoldRow => ({
  id,
  reference: `CHT-${id}`,
  truckId,
  blockStart: start,
  blockEnd: end,
  stage,
});

describe('findOverlaps', () => {
  it('finds nothing when bookings sit back to back on one truck', () => {
    expect(findOverlaps([row('a', 'A', '2026-10-17', '2026-10-19'), row('b', 'A', '2026-10-20', '2026-10-22')])).toEqual([]);
  });

  it('finds two bookings that share even a single day', () => {
    const found = findOverlaps([row('a', 'A', '2026-10-21', '2026-10-23'), row('b', 'A', '2026-10-23', '2026-10-25')]);
    expect(found).toHaveLength(1);
    expect(found[0].map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('does not mix trucks', () => {
    expect(findOverlaps([row('a', 'A', '2026-10-21', '2026-10-23'), row('b', 'B', '2026-10-21', '2026-10-23')])).toEqual([]);
  });

  it.each(['CANCELLED', 'COMPLETED'])('ignores a %s booking, which no longer holds a truck', (stage) => {
    expect(findOverlaps([row('a', 'A', '2026-10-21', '2026-10-23'), row('b', 'A', '2026-10-22', '2026-10-24', stage)])).toEqual([]);
  });

  it('ignores a booking with no truck assigned', () => {
    expect(findOverlaps([row('a', null, '2026-10-21', '2026-10-23'), row('b', null, '2026-10-21', '2026-10-23')])).toEqual([]);
  });

  it('reports each clashing pair once, not twice', () => {
    expect(findOverlaps([row('a', 'A', '2026-10-21', '2026-10-25'), row('b', 'A', '2026-10-22', '2026-10-24')])).toHaveLength(1);
  });
});

describe('wrongTruckCode — a message must not carry the other truck’s lockbox code', () => {
  it('flags a body that contains another truck’s code and not its own', () => {
    expect(wrongTruckCode('Lockbox code 11111, driver’s side', '22222', ['11111'])).toBe(true);
  });

  it('passes a body with the booking’s own code', () => {
    expect(wrongTruckCode('Lockbox code 22222', '22222', ['11111'])).toBe(false);
  });

  it('passes a body with no code at all', () => {
    expect(wrongTruckCode('Your truck has changed', '22222', ['11111'])).toBe(false);
  });

  it('cannot judge when two trucks share a code, so it does not cry wolf', () => {
    expect(wrongTruckCode('code 22222', '22222', ['22222'])).toBe(false);
  });

  it('flags another truck’s code when the booking has no truck of its own', () => {
    expect(wrongTruckCode('code 11111', null, ['11111'])).toBe(true);
  });

  it('passes when there are no other codes to confuse it with', () => {
    expect(wrongTruckCode('code 11111', '22222', [])).toBe(false);
  });
});

describe('diffCalendar — the calendar must match the bookings one for one', () => {
  const ev = (id: string, summary: string, colorId = '6'): ExpectedEvent => ({ id, summary, colorId, status: 'confirmed' });
  const got = (id: string, summary: string, colorId = '6'): ActualEvent => ({ id, summary, colorId, status: 'confirmed' });

  it('reports nothing when they match', () => {
    const d = diffCalendar([ev('cht1', 'Truck B · Ana')], [got('cht1', 'Truck B · Ana')]);
    expect(d).toEqual({ missing: [], wrong: [], orphans: [] });
  });

  it('reports an event that should exist and does not', () => {
    expect(diffCalendar([ev('cht1', 'Truck B · Ana')], []).missing).toEqual(['cht1']);
  });

  it('reports an event showing the wrong truck', () => {
    const d = diffCalendar([ev('cht1', 'Truck B · Ana')], [got('cht1', 'Truck A · Ana')]);
    expect(d.wrong.map((w) => w.id)).toEqual(['cht1']);
  });

  it('reports the wrong colour', () => {
    const d = diffCalendar([ev('cht1', 'Truck B · Ana', '6')], [got('cht1', 'Truck B · Ana', '9')]);
    expect(d.wrong.map((w) => w.id)).toEqual(['cht1']);
  });

  it('reports one of our events that no booking owns any more', () => {
    expect(diffCalendar([], [got('chtOLD', 'Truck A · Gone')]).orphans).toEqual(['chtOLD']);
  });

  it('leaves alone events the office added by hand', () => {
    expect(diffCalendar([], [got('abc123', 'Dentist')]).orphans).toEqual([]);
  });

  it('reports a confirmed booking that Google still shows as tentative', () => {
    const d = diffCalendar(
      [{ id: 'cht1', summary: 'Truck B · Ana', colorId: '6', status: 'confirmed' }],
      [{ id: 'cht1', summary: 'Truck B · Ana', colorId: '6', status: 'tentative' }],
    );
    expect(d.wrong.map((w) => w.id)).toEqual(['cht1']);
  });

  it('reads a missing status as confirmed, which is Google’s own default', () => {
    const d = diffCalendar(
      [{ id: 'cht1', summary: 'Truck B · Ana', colorId: '6', status: 'confirmed' }],
      [{ id: 'cht1', summary: 'Truck B · Ana', colorId: '6' }],
    );
    expect(d.wrong).toEqual([]);
  });

  it('does not call a finished booking’s old events strays, because they are kept as history', () => {
    expect(diffCalendar([], [got('chtDONE', 'Truck A · Past')], ['chtDONE']).orphans).toEqual([]);
  });

  it('still calls an event stray if nothing known owns it', () => {
    expect(diffCalendar([], [got('chtLOST', 'Truck A · ?')], ['chtDONE']).orphans).toEqual(['chtLOST']);
  });
});
