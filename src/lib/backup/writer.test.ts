import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupBooking, emptyManifest, intactPaths, loadManifest, mirror, saveManifest, verifyRoot, writeIndex, writeVersioned, type Deps } from './writer';
import { sampleBooking } from './record.fixture';

let root: string;
let second: string;
let now = new Date('2026-12-01T02:00:00Z');

const CLOUD: Record<string, Buffer> = {
  'docs/d1.webp': Buffer.from('LICENCE-IMAGE-BYTES'),
  'docs/d2.webp': Buffer.from('CARGO-IMAGE-BYTES'),
  'contracts/k1.pdf': Buffer.from('%PDF-SIGNED'),
  'checklists/c1.pdf': Buffer.from('%PDF-CHECKLIST'),
};

const deps = (over: Partial<Deps> = {}): Deps & { fetched: string[]; jpegged: string[] } => {
  const fetched: string[] = [];
  const jpegged: string[] = [];
  return {
    fetched,
    jpegged,
    fetchFile: async (p) => {
      fetched.push(p);
      return CLOUD[p] ?? null;
    },
    toJpeg: async (b) => {
      jpegged.push(b.toString());
      return null; // photos are covered in the PDF tests; here only the file handling matters
    },
    now: () => now,
    ...over,
  };
};

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'cht-backup-'));
  second = await fs.mkdtemp(join(tmpdir(), 'cht-backup2-'));
  now = new Date('2026-12-01T02:00:00Z');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(second, { recursive: true, force: true });
});

// the sample has d2 removed from the cloud already; make a variant where nothing is
const live = () => {
  const b = sampleBooking();
  b.documents.forEach((d) => (d.deletedAt = null));
  return b;
};

describe('backupBooking', () => {
  it('saves the record, a PDF, and every file that is still in the cloud', async () => {
    const m = emptyManifest();
    const d = deps();
    const r = await backupBooking(root, live(), d, m);

    expect(r.status).toBe('saved');
    const dir = join(root, r.entry.folder);
    expect(r.entry.folder).toBe('CHT-SAMPLE - Sample Renter - 2026-11-20');
    expect((await fs.readFile(join(dir, 'record.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
    expect(JSON.parse(await fs.readFile(join(dir, 'record.json'), 'utf8')).reference).toBe('CHT-SAMPLE');
    expect((await fs.readdir(join(dir, 'files'))).sort()).toHaveLength(4);
  });

  it('never saves a partial file under its final name', async () => {
    const m = emptyManifest();
    const r = await backupBooking(root, live(), deps(), m);
    const names = await fs.readdir(join(root, r.entry.folder, 'files'));
    expect(names.some((n) => n.endsWith('.part'))).toBe(false);
  });

  it('leaves everything alone, and fetches nothing, when nothing has changed', async () => {
    const m = emptyManifest();
    await backupBooking(root, live(), deps(), m);
    const d = deps();
    const again = await backupBooking(root, live(), d, m);
    expect(again.status).toBe('unchanged');
    expect(d.fetched).toEqual([]);
  });

  it('keeps the old record and PDF, dated, when the booking changes', async () => {
    const m = emptyManifest();
    const first = await backupBooking(root, live(), deps(), m);
    const dir = join(root, first.entry.folder);
    const oldJson = await fs.readFile(join(dir, 'record.json'), 'utf8');

    now = new Date('2026-12-05T09:00:00Z');
    const changed = live();
    changed.events.push({ type: 'note', detail: 'Called the renter', actor: 'ops', createdAt: new Date('2026-12-04T00:00:00Z') });
    const second = await backupBooking(root, changed, deps(), m);

    expect(second.status).toBe('updated');
    const names = await fs.readdir(dir);
    expect(names.filter((n) => n.startsWith('record.2026')).sort()).toEqual(['record.20261205T0900.json', 'record.20261205T0900.pdf']);
    expect(await fs.readFile(join(dir, 'record.20261205T0900.json'), 'utf8')).toBe(oldJson);
    expect(await fs.readFile(join(dir, 'record.json'), 'utf8')).toContain('Called the renter');
  });

  it('does not download a file it already has intact', async () => {
    const m = emptyManifest();
    await backupBooking(root, live(), deps(), m);
    const changed = live();
    changed.events.push({ type: 'note', detail: 'x', actor: 'ops', createdAt: new Date('2026-12-04T00:00:00Z') });
    const d = deps();
    await backupBooking(root, changed, d, m);
    expect(d.fetched).toEqual([]);
  });

  it('re-downloads a file that has gone missing from the folder', async () => {
    const m = emptyManifest();
    const first = await backupBooking(root, live(), deps(), m);
    const dir = join(root, first.entry.folder, 'files');
    const victim = (await fs.readdir(dir))[0];
    await fs.rm(join(dir, victim));
    const d = deps();
    const again = await backupBooking(root, live(), d, m);
    expect(again.status).not.toBe('unchanged');
    expect(d.fetched).toHaveLength(1);
    expect(await fs.readdir(dir)).toContain(victim);
  });

  it('records a file that is not in cloud storage as missing, and still saves the rest', async () => {
    const m = emptyManifest();
    const d = deps({ fetchFile: async (p) => (p === 'docs/d1.webp' ? null : CLOUD[p] ?? null) });
    const r = await backupBooking(root, live(), d, m);
    expect(r.missing).toEqual(['docs/d1.webp']);
    expect(Object.keys(r.entry.files)).not.toContain('docs/d1.webp');
    expect((await fs.stat(join(root, r.entry.folder, 'record.pdf'))).size).toBeGreaterThan(0);
  });

  it('keeps a file from an earlier backup after the cloud copy has been removed', async () => {
    const m = emptyManifest();
    const first = await backupBooking(root, live(), deps(), m);
    const later = live();
    later.documents.find((d) => d.id === 'd1')!.deletedAt = new Date('2027-01-01T00:00:00Z');
    const d = deps();
    const r = await backupBooking(root, later, d, m);
    expect(Object.keys(r.entry.files)).toContain('docs/d1.webp');
    expect(await fs.readdir(join(root, first.entry.folder, 'files'))).toHaveLength(4);
  });

  it('only asks for truck photos to be shrunk for the PDF, never the licence', async () => {
    const m = emptyManifest();
    const d = deps();
    await backupBooking(root, live(), d, m);
    expect(d.jpegged).toEqual(['CARGO-IMAGE-BYTES']);
  });

  it('keeps the folder name even if the renter name is later corrected', async () => {
    const m = emptyManifest();
    const first = await backupBooking(root, live(), deps(), m);
    const renamed = live();
    renamed.firstName = 'Corrected';
    const r = await backupBooking(root, renamed, deps(), m);
    expect(r.entry.folder).toBe(first.entry.folder);
  });

  it('survives a hostile renter name without leaving the backup folder', async () => {
    const m = emptyManifest();
    const b = live();
    b.firstName = '..\\..\\..';
    b.lastName = '../../Windows/System32';
    const r = await backupBooking(root, b, deps(), m);
    expect(r.entry.folder).not.toMatch(/[\\/]/);
    expect((await fs.readdir(root)).length).toBe(1);
  });
});

describe('verifyRoot', () => {
  it('passes a clean folder', async () => {
    const m = emptyManifest();
    await backupBooking(root, live(), deps(), m);
    expect(await verifyRoot(root, m)).toEqual({ checked: 4, problems: [] });
  });

  it('finds a deleted, a shortened and a damaged file', async () => {
    const m = emptyManifest();
    const r = await backupBooking(root, live(), deps(), m);
    const dir = join(root, r.entry.folder, 'files');
    const [a, b, c] = Object.values(r.entry.files).map((f) => f.name);
    await fs.rm(join(dir, a));
    await fs.writeFile(join(dir, b), 'x');
    const same = (await fs.readFile(join(dir, c))).toString().replace(/./, 'Z');
    await fs.writeFile(join(dir, c), same);
    const v = await verifyRoot(root, m);
    expect(v.problems.map((p) => p.problem).sort()).toEqual(['damaged', 'missing', 'wrong size']);
  });
});

describe('intactPaths', () => {
  it('lists the cloud paths whose saved copy still matches, and leaves out damaged or missing ones', async () => {
    const m = emptyManifest();
    const r = await backupBooking(root, live(), deps(), m);
    expect([...(await intactPaths(root, m))].sort()).toEqual(['checklists/c1.pdf', 'contracts/k1.pdf', 'docs/d1.webp', 'docs/d2.webp']);

    const dir = join(root, r.entry.folder, 'files');
    await fs.writeFile(join(dir, r.entry.files['docs/d1.webp'].name), 'tampered!!');
    await fs.rm(join(dir, r.entry.files['docs/d2.webp'].name));
    expect([...(await intactPaths(root, m))].sort()).toEqual(['checklists/c1.pdf', 'contracts/k1.pdf']);
  });

  it('is empty for a folder that holds nothing', async () => {
    expect((await intactPaths(second, (() => { const m = emptyManifest(); return m; })())).size).toBe(0);
  });
});

describe('manifest and index', () => {
  it('round-trips the manifest, and starts fresh when there is none or it is garbage', async () => {
    const m = emptyManifest();
    await backupBooking(root, live(), deps(), m);
    await saveManifest(root, m);
    expect(Object.keys((await loadManifest(root)).bookings)).toEqual(['b1']);
    expect(await loadManifest(join(root, 'nowhere'))).toEqual(emptyManifest());
    await fs.writeFile(join(root, 'manifest.json'), '{not json');
    expect(await loadManifest(root)).toEqual(emptyManifest());
  });

  it('writes a spreadsheet with a row per booking and neutralises formulas in names', async () => {
    const m = emptyManifest();
    const b = live();
    b.firstName = '=HYPERLINK("http://evil","x")';
    await backupBooking(root, b, deps(), m);
    await writeIndex(root, [b], m);
    const csv = await fs.readFile(join(root, 'bookings.csv'), 'utf8');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/);
  });
});

describe('writeVersioned', () => {
  it('never loses a file: different content moves the old one aside', async () => {
    const p = join(root, 'a.txt');
    expect(await writeVersioned(p, Buffer.from('one'), now)).toBe('written');
    expect(await writeVersioned(p, Buffer.from('one'), now)).toBe('same');
    expect(await writeVersioned(p, Buffer.from('two'), now)).toBe('replaced');
    expect(await writeVersioned(p, Buffer.from('three'), now)).toBe('replaced');
    const names = (await fs.readdir(root)).sort();
    expect(names).toEqual(['a.20261201T0200-2.txt', 'a.20261201T0200.txt', 'a.txt']);
    expect(await fs.readFile(join(root, 'a.20261201T0200.txt'), 'utf8')).toBe('one');
    expect(await fs.readFile(join(root, 'a.20261201T0200-2.txt'), 'utf8')).toBe('two');
  });
});

describe('mirror', () => {
  it('copies the whole tree, and a second run copies nothing', async () => {
    const m = emptyManifest();
    await backupBooking(root, live(), deps(), m);
    await writeIndex(root, [live()], m);
    await saveManifest(root, m);

    const first = await mirror(root, second, now);
    expect(first.copied).toBeGreaterThan(5);
    const again = await mirror(root, second, now);
    expect(again.copied).toBe(0);
    expect((await verifyRoot(second, m)).problems).toEqual([]);
  });

  it('never deletes what is already in the destination', async () => {
    await fs.writeFile(join(second, 'keep-me.txt'), 'mine');
    await fs.writeFile(join(root, 'new.txt'), 'new');
    await mirror(root, second, now);
    expect(await fs.readFile(join(second, 'keep-me.txt'), 'utf8')).toBe('mine');
  });

  it('moves a different file aside rather than overwriting it', async () => {
    await fs.writeFile(join(root, 'f.txt'), 'new');
    await fs.writeFile(join(second, 'f.txt'), 'old');
    await mirror(root, second, now);
    expect(await fs.readFile(join(second, 'f.txt'), 'utf8')).toBe('new');
    expect(await fs.readFile(join(second, 'f.20261201T0200.txt'), 'utf8')).toBe('old');
  });

  it('replaces the spreadsheet and manifest in place instead of piling up dated copies', async () => {
    await fs.writeFile(join(root, 'bookings.csv'), 'v1');
    await mirror(root, second, now);
    await fs.writeFile(join(root, 'bookings.csv'), 'v2');
    await mirror(root, second, now);
    expect((await fs.readdir(second)).filter((n) => n.startsWith('bookings'))).toEqual(['bookings.csv']);
    expect(await fs.readFile(join(second, 'bookings.csv'), 'utf8')).toBe('v2');
  });

  it('does not copy temporary files', async () => {
    await fs.writeFile(join(root, 'half.jpg.part'), 'x');
    await mirror(root, second, now);
    expect(await fs.readdir(second)).toEqual([]);
  });
});

vi.setConfig({ testTimeout: 20000 });
void createHash;
