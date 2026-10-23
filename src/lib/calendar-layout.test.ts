import { describe, expect, it } from 'vitest';
import { dayStates } from './calendar-layout';

const ON = { a: false, b: false };

describe('dayStates — what the CRM calendar says about a day', () => {
  it('both trucks on and nothing booked: both free', () => {
    expect(dayStates({ a: false, b: false }, ON)).toEqual({ a: 'free', b: 'free', label: 'both free', bookable: true });
  });

  it('one truck booked, the other on and free', () => {
    expect(dayStates({ a: true, b: false }, ON)).toMatchObject({ a: 'busy', b: 'free', label: 'Truck B free', bookable: true });
    expect(dayStates({ a: false, b: true }, ON)).toMatchObject({ a: 'free', b: 'busy', label: 'Truck A free', bookable: true });
  });

  it('both booked: nothing to book', () => {
    expect(dayStates({ a: true, b: true }, ON)).toEqual({ a: 'busy', b: 'busy', label: null, bookable: false });
  });

  it('a truck that is switched off is shown as off, never as free', () => {
    const s = dayStates({ a: false, b: false }, { a: true, b: false });
    expect(s.a).toBe('off');
    expect(s.b).toBe('free');
  });

  it('does not say "both free" when one of them is off', () => {
    expect(dayStates({ a: false, b: false }, { a: true, b: false }).label).toBe('Truck B free');
  });

  it('with A off and B booked there is nothing to book, and it says nothing misleading', () => {
    expect(dayStates({ a: false, b: true }, { a: true, b: false })).toEqual({ a: 'off', b: 'busy', label: null, bookable: false });
  });

  it('a booking on a truck that is off still shows as booked — it must not be hidden', () => {
    expect(dayStates({ a: true, b: false }, { a: true, b: false }).a).toBe('busy');
  });

  it('with both trucks off and nothing booked, says so rather than offering a booking', () => {
    expect(dayStates({ a: false, b: false }, { a: true, b: true })).toEqual({ a: 'off', b: 'off', label: 'no truck on', bookable: false });
  });
});
