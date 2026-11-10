import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { bookingFolderName, documentFileName } from './names';
import { buildRecord, csvRow, CSV_HEADERS, recordFingerprint, type BookingSource, type RecordFile } from './record';
import { renderRecordPdf, type RecordPhoto } from './record-pdf';
import { toCsv } from './csv';

/**
 * Writes the backup folder. The rules this file keeps:
 *  - nothing already on disk is ever overwritten or deleted: a changed file moves
 *    aside under a dated name and the new one is written next to it;
 *  - a file is written to a temporary name first and renamed, so a crash never
 *    leaves half a photo that looks finished;
 *  - every saved file's checksum goes in the manifest, so later checks compare
 *    against what was really written, not against what we meant to write.
 */

export type FileEntry = { name: string; sha256: string; bytes: number };
export type BookingEntry = {
  reference: string;
  folder: string;
  fingerprint: string;
  savedAt: string;
  files: Record<string, FileEntry>; // by cloud path
  missing: string[]; // cloud paths that could not be found in storage
};
export type Manifest = { version: 1; bookings: Record<string, BookingEntry> };
export const emptyManifest = (): Manifest => ({ version: 1, bookings: {} });

export type Deps = {
  /** The file from cloud storage, or null if it is not there. */
  fetchFile: (pathname: string) => Promise<Buffer | null>;
  /** A shrunk JPEG for the PDF, or null if the image cannot be read. */
  toJpeg: (image: Buffer) => Promise<Uint8Array | null>;
  now: () => Date;
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const TRUCK_PHOTO_KINDS = new Set(['CARGO', 'EXTERIOR', 'FUEL_GAUGE']);

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, data: Uint8Array) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.part`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}

const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 13); // 20261112T02

/**
 * Writes `data` to `path`. If something different is already there, it is
 * moved aside (never deleted) under a dated name first.
 */
export async function writeVersioned(path: string, data: Uint8Array, now: Date): Promise<'written' | 'same' | 'replaced'> {
  if (await exists(path)) {
    const old = await fs.readFile(path);
    if (Buffer.compare(old, Buffer.from(data)) === 0) return 'same';
    const dot = path.lastIndexOf('.');
    const base = dot > path.lastIndexOf('\\') && dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
    const ext = base === path ? '' : path.slice(dot);
    let aside = `${base}.${stampOf(now)}${ext}`;
    for (let i = 2; await exists(aside); i++) aside = `${base}.${stampOf(now)}-${i}${ext}`;
    await fs.rename(path, aside);
    await atomicWrite(path, data);
    return 'replaced';
  }
  await atomicWrite(path, data);
  return 'written';
}

export type BookingResult = {
  status: 'saved' | 'updated' | 'unchanged';
  entry: BookingEntry;
  filesWritten: number;
  missing: string[];
  lossy: boolean;
};

export async function backupBooking(root: string, source: BookingSource, deps: Deps, manifest: Manifest): Promise<BookingResult> {
  const record = buildRecord(source);
  const fingerprint = recordFingerprint(record);
  const prev = manifest.bookings[source.id];
  const folder = prev?.folder ?? bookingFolderName(record.reference, record.booking.renter, record.booking.pickupDate);
  const dir = join(root, folder);

  // Unchanged: the record is the same and every file we recorded is still there with the same size.
  if (prev && prev.fingerprint === fingerprint && (await exists(join(dir, 'record.pdf')))) {
    let intact = true;
    for (const f of Object.values(prev.files)) {
      try {
        if ((await fs.stat(join(dir, 'files', f.name))).size !== f.bytes) intact = false;
      } catch {
        intact = false;
      }
      if (!intact) break;
    }
    if (intact) return { status: 'unchanged', entry: prev, filesWritten: 0, missing: prev.missing, lossy: false };
  }

  const files: Record<string, FileEntry> = { ...(prev?.files ?? {}) };
  const missing: string[] = [];
  const buffers = new Map<string, Buffer>();
  let filesWritten = 0;

  for (const f of record.files) {
    if (f.removed) continue; // gone from the cloud; an earlier backup may already hold it
    const name = documentFileName(f);
    const target = join(dir, 'files', name);
    const known = files[f.pathname];

    if (known && (await exists(target))) {
      const onDisk = await fs.readFile(target);
      if (sha256(onDisk) === known.sha256) {
        buffers.set(f.pathname, onDisk);
        continue; // already saved and intact
      }
    }

    const data = await deps.fetchFile(f.pathname);
    if (!data) {
      missing.push(f.pathname);
      continue;
    }
    await writeVersioned(target, data, deps.now());
    files[f.pathname] = { name, sha256: sha256(data), bytes: data.byteLength };
    buffers.set(f.pathname, data);
    filesWritten += 1;
  }

  const photos: RecordPhoto[] = [];
  for (const f of record.files) {
    if (!TRUCK_PHOTO_KINDS.has(f.kind) || !buffers.has(f.pathname)) continue;
    const jpeg = await deps.toJpeg(buffers.get(f.pathname)!);
    if (jpeg) photos.push({ label: f.label, jpeg });
  }

  const fileNames: Record<string, string> = {};
  for (const [pathname, e] of Object.entries(files)) fileNames[pathname] = `files/${e.name}`;

  const { bytes: pdf, lossy } = await renderRecordPdf(record, { photos, fileNames, generatedAt: deps.now(), hide: source.truck?.lockboxCode ? [source.truck.lockboxCode] : [] });
  const json = Buffer.from(JSON.stringify(record, null, 2), 'utf8');
  const a = await writeVersioned(join(dir, 'record.json'), json, deps.now());
  await writeVersioned(join(dir, 'record.pdf'), pdf, deps.now());

  const entry: BookingEntry = { reference: record.reference, folder, fingerprint, savedAt: deps.now().toISOString(), files, missing };
  manifest.bookings[source.id] = entry;
  return { status: prev || a === 'replaced' ? 'updated' : 'saved', entry, filesWritten, missing, lossy };
}

/** The spreadsheet of every booking. It is derived, so it is simply rewritten each run. */
export async function writeIndex(root: string, sources: BookingSource[], manifest: Manifest) {
  const rows = sources
    .map((s) => ({ s, r: buildRecord(s) }))
    .sort((a, b) => a.r.booking.pickupDate.localeCompare(b.r.booking.pickupDate))
    .map(({ s, r }) => csvRow(r, manifest.bookings[s.id]?.folder ?? ''));
  await atomicWrite(join(root, 'bookings.csv'), Buffer.from(toCsv(CSV_HEADERS, rows), 'utf8'));
}

export async function saveManifest(root: string, manifest: Manifest) {
  await atomicWrite(join(root, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
}

export async function loadManifest(root: string): Promise<Manifest> {
  try {
    const m = JSON.parse(await fs.readFile(join(root, 'manifest.json'), 'utf8')) as Manifest;
    return m.version === 1 && m.bookings ? m : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

export type VerifyProblem = { reference: string; file: string; problem: 'missing' | 'wrong size' | 'damaged' };

/** Re-reads every file the manifest lists and compares size and checksum. */
export async function verifyRoot(root: string, manifest: Manifest): Promise<{ checked: number; problems: VerifyProblem[] }> {
  const problems: VerifyProblem[] = [];
  let checked = 0;
  for (const b of Object.values(manifest.bookings)) {
    for (const f of Object.values(b.files)) {
      checked += 1;
      const path = join(root, b.folder, 'files', f.name);
      let data: Buffer;
      try {
        data = await fs.readFile(path);
      } catch {
        problems.push({ reference: b.reference, file: f.name, problem: 'missing' });
        continue;
      }
      if (data.byteLength !== f.bytes) problems.push({ reference: b.reference, file: f.name, problem: 'wrong size' });
      else if (sha256(data) !== f.sha256) problems.push({ reference: b.reference, file: f.name, problem: 'damaged' });
    }
  }
  return { checked, problems };
}

/** Cloud paths whose saved copy in `root` was just re-read and matches its checksum. */
export async function intactPaths(root: string, manifest: Manifest): Promise<Set<string>> {
  const bad = new Set((await verifyRoot(root, manifest)).problems.map((p) => `${p.reference}/${p.file}`));
  const ok = new Set<string>();
  for (const b of Object.values(manifest.bookings)) {
    for (const [pathname, f] of Object.entries(b.files)) if (!bad.has(`${b.reference}/${f.name}`)) ok.add(pathname);
  }
  return ok;
}

/** Files rebuilt from the data on every run. Keeping a dated copy of each would only pile up. */
const DERIVED = new Set(['bookings.csv', 'manifest.json']);

async function replaceIfDifferent(path: string, data: Uint8Array): Promise<'written' | 'same' | 'replaced'> {
  if (await exists(path)) {
    if (Buffer.compare(await fs.readFile(path), Buffer.from(data)) === 0) return 'same';
    await atomicWrite(path, data);
    return 'replaced';
  }
  await atomicWrite(path, data);
  return 'written';
}

/**
 * Copies everything in `from` that is not already in `to` with the same
 * content. Nothing in `to` is deleted; a different file already there is moved
 * aside, not overwritten. Temporary `.part` files are never copied.
 */
export async function mirror(from: string, to: string, now: Date): Promise<{ copied: number; same: number }> {
  let copied = 0;
  let same = 0;
  async function walk(rel: string) {
    for (const entry of await fs.readdir(join(from, rel), { withFileTypes: true })) {
      const r = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(r);
      } else if (entry.isFile() && !entry.name.endsWith('.part')) {
        const data = await fs.readFile(join(from, r));
        // The index and the manifest are rewritten every run, so they are simply replaced.
        const result = rel === '' && DERIVED.has(entry.name) ? await replaceIfDifferent(join(to, r), data) : await writeVersioned(join(to, r), data, now);
        if (result === 'same') same += 1;
        else copied += 1;
      }
    }
  }
  await fs.mkdir(to, { recursive: true });
  await walk('');
  return { copied, same };
}

export type { RecordFile };
