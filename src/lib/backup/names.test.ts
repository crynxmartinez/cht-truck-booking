import { describe, expect, it } from 'vitest';
import { bookingFolderName, documentFileName, safeSegment } from './names';

describe('safeSegment', () => {
  it('removes characters Windows does not allow', () => {
    expect(safeSegment('A/B\\C:D*E?F"G<H>I|J')).toBe('A B C D E F G H I J');
  });

  it('drops trailing dots and spaces, which Windows would silently remove', () => {
    expect(safeSegment('Smith. . ')).toBe('Smith');
  });

  it('avoids device names', () => {
    expect(safeSegment('CON')).toBe('_CON');
    expect(safeSegment('nul.txt')).toBe('_nul.txt');
    expect(safeSegment('COM1')).toBe('_COM1');
  });

  it('strips invisible direction and zero-width characters', () => {
    expect(safeSegment('Jo‮hn​')).toBe('John');
  });

  it('cuts a very long name', () => {
    expect(safeSegment('x'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('cannot produce a path escape', () => {
    expect(safeSegment('..\\..\\Windows\\System32')).toBe('Windows System32');
    expect(safeSegment('..')).toBe('');
    expect(safeSegment('.')).toBe('');
  });

  it('keeps accents and other languages', () => {
    expect(safeSegment('José Núñez')).toBe('José Núñez');
    expect(safeSegment('李小龍')).toBe('李小龍');
  });
});

describe('bookingFolderName', () => {
  it('joins reference, name and pickup date', () => {
    expect(bookingFolderName('CHT-AB12CD', 'Sample Renter', '2026-11-20')).toBe('CHT-AB12CD - Sample Renter - 2026-11-20');
  });

  it('falls back to the reference when the name is unusable', () => {
    expect(bookingFolderName('CHT-AB12CD', '...', '2026-11-20')).toBe('CHT-AB12CD - 2026-11-20');
    expect(bookingFolderName('CHT-AB12CD', '  \\/  ', '2026-11-20')).toBe('CHT-AB12CD - 2026-11-20');
  });

  it('ignores a malformed date rather than putting it in a path', () => {
    expect(bookingFolderName('CHT-AB12CD', 'Sample', '../../x')).toBe('CHT-AB12CD - Sample');
  });

  it('never ends in a dot or space', () => {
    expect(bookingFolderName('CHT-AB12CD', 'Sample.', '')).toBe('CHT-AB12CD - Sample');
  });
});

describe('documentFileName', () => {
  it('is built from our own fields, not an uploaded filename', () => {
    expect(documentFileName({ id: 'cmabc12345678', kind: 'DRIVER_LICENSE', phase: 'BOOKING', contentType: 'image/webp' })).toBe(
      'driver_license-booking-12345678.webp',
    );
  });

  it('uses .bin for a type it does not know, never a made-up extension', () => {
    expect(documentFileName({ id: 'x1', kind: 'OTHER', phase: 'PICKUP', contentType: 'application/x-evil.exe' })).toMatch(/\.bin$/);
  });

  it('gives two documents different names', () => {
    const a = documentFileName({ id: 'cm00000001', kind: 'CARGO', phase: 'PICKUP', contentType: 'image/jpeg' });
    const b = documentFileName({ id: 'cm00000002', kind: 'CARGO', phase: 'PICKUP', contentType: 'image/jpeg' });
    expect(a).not.toBe(b);
  });
});
