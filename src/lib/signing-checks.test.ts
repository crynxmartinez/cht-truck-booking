import { describe, expect, it } from 'vitest';
import { missingAcknowledgement } from './signing-checks';

const all = { tollAccepted: true, gasAccepted: true, dollyAccepted: true };

describe('missingAcknowledgement — the ticks a renter must give before the signature counts', () => {
  it('is satisfied when all three are given', () => {
    expect(missingAcknowledgement(all)).toBeNull();
  });

  it('asks for tolls, then gas, then the dolly, naming the one that is missing', () => {
    expect(missingAcknowledgement({ ...all, tollAccepted: false })).toMatch(/toll/i);
    expect(missingAcknowledgement({ ...all, gasAccepted: false })).toMatch(/fuel|gas/i);
    expect(missingAcknowledgement({ ...all, dollyAccepted: false })).toMatch(/dolly/i);
  });

  it('only accepts a real true, not something that merely looks true', () => {
    for (const bad of ['true', 1, 'yes', {}, [], null, undefined]) {
      expect(missingAcknowledgement({ ...all, gasAccepted: bad as never }), String(bad)).not.toBeNull();
      expect(missingAcknowledgement({ ...all, dollyAccepted: bad as never }), String(bad)).not.toBeNull();
      expect(missingAcknowledgement({ ...all, tollAccepted: bad as never }), String(bad)).not.toBeNull();
    }
  });

  it('refuses an empty submission', () => {
    expect(missingAcknowledgement({})).not.toBeNull();
  });
});
