import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { del, get } from '@vercel/blob';
import sharp from 'sharp';
import { prisma } from '../src/lib/db';
import { measureUsage } from '../src/lib/storage';
import { planClear, type ClearCandidate } from '../src/lib/backup/plan-clear';
import type { BookingSource } from '../src/lib/backup/record';
import { assertSafeDestination, type GitRunner } from '../src/lib/backup/safety';
import {
  backupBooking, emptyManifest, intactPaths, loadManifest, mirror, saveManifest, verifyRoot, writeIndex, type Deps,
} from '../src/lib/backup/writer';

/**
 * Backs up the truck rental records and files to this computer.
 *
 *   npm run backup                          save everything new or changed
 *   npm run backup -- verify                re-check every saved file
 *   npm run backup -- clear                 remove saved files from cloud storage (asks first)
 *
 * Options:  --dest "<folder>"       default: <code folder>\back up
 *           --second "<folder>"     also copy everything here (for example a Google Drive folder)
 *           --min-age-days 30       clear only rentals finished at least this long ago
 *           --dry-run               say what would happen, change nothing
 *
 * Saving and verifying only READ from the live system. Only "clear" deletes from
 * the cloud, and only files it has just re-checked in the backup folder.
 */

const REPO = process.cwd();
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'run';
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const dest = resolve(flag('dest') ?? join(REPO, 'back up'));
const secondRaw = flag('second') ?? process.env.BACKUP_SECOND;
const second = secondRaw ? resolve(secondRaw) : null;
const minAgeDays = Number(flag('min-age-days') ?? 30);

const git: GitRunner = (a) => {
  try {
    return { ok: true, stdout: execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch {
    return { ok: false, stdout: '' };
  }
};

function stop(message: string): never {
  console.error(`\nStopped: ${message}\n`);
  process.exit(1);
}

async function loadSources(): Promise<BookingSource[]> {
  const rows = await prisma.booking.findMany({
    include: { truck: true, additionalDriver: true, contracts: true, checklists: true, documents: true, messages: true, events: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows as unknown as BookingSource[];
}

const deps: Deps = {
  async fetchFile(pathname) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await get(pathname, { access: 'private' });
        if (!res || res.statusCode !== 200 || !res.stream) return null; // not there
        return Buffer.from(await new Response(res.stream).arrayBuffer());
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    return null;
  },
  async toJpeg(image) {
    try {
      return await sharp(image).rotate().resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    } catch {
      return null;
    }
  },
  now: () => new Date(),
};

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

async function guardFolders() {
  for (const folder of [dest, ...(second ? [second] : [])]) {
    const safe = assertSafeDestination(folder, REPO, git);
    if (!safe.ok) stop(safe.reason);
  }
  await fs.mkdir(dest, { recursive: true });
}

async function run() {
  await guardFolders();
  const manifest = await loadManifest(dest);
  const sources = await loadSources();
  console.log(`Saving ${sources.length} bookings to ${dest}${dryRun ? '  (dry run: nothing will be written)' : ''}`);

  if (dryRun) {
    const fresh = sources.filter((s) => !manifest.bookings[s.id]).length;
    console.log(`  ${fresh} new, ${sources.length - fresh} already saved (changed ones are re-saved).`);
    return;
  }

  const tally = { saved: 0, updated: 0, unchanged: 0, files: 0, missing: 0, lossy: 0 };
  let i = 0;
  for (const s of sources) {
    i += 1;
    const r = await backupBooking(dest, s, deps, manifest);
    tally[r.status] += 1;
    tally.files += r.filesWritten;
    tally.missing += r.missing.length;
    if (r.lossy) tally.lossy += 1;
    await saveManifest(dest, manifest); // after each booking, so an interrupted run loses nothing
    if (r.status !== 'unchanged') console.log(`  [${i}/${sources.length}] ${r.entry.reference} ${r.status}, ${r.filesWritten} file(s)`);
  }
  await writeIndex(dest, sources, manifest);
  await saveManifest(dest, manifest);

  const check = await verifyRoot(dest, manifest);
  let copied = 0;
  let secondProblems = 0;
  if (second) {
    const m = await mirror(dest, second, new Date());
    copied = m.copied;
    secondProblems = (await verifyRoot(second, manifest)).problems.length;
  }

  const line =
    `${new Date().toISOString()}  bookings ${sources.length}: ${tally.saved} new, ${tally.updated} updated, ${tally.unchanged} unchanged; ` +
    `${tally.files} files written; ${tally.missing} not found in the cloud; ${check.problems.length} problems in the folder` +
    (second ? `; second folder: ${copied} copied, ${secondProblems} problems` : '');
  await fs.appendFile(join(dest, 'backup-log.txt'), line + '\n');

  console.log(`\nDone. ${line}`);
  if (tally.lossy) console.log(`  ${tally.lossy} record(s) have characters the PDF could not show; record.json has the exact text.`);
  if (check.problems.length || secondProblems) {
    console.log('  Something does not match. Run: npm run backup -- verify');
    process.exitCode = 1;
  }
  if (second) console.log('  The second folder is a synced Google Drive folder? Wait for Drive to finish syncing before relying on it.');
  await printUsage();
}

async function verify() {
  await guardFolders();
  const manifest = await loadManifest(dest);
  for (const [label, root] of [['Backup folder', dest], ...(second ? [['Second folder', second]] : [])] as Array<[string, string]>) {
    const r = await verifyRoot(root, manifest);
    console.log(`${label}: ${r.checked} files checked, ${r.problems.length} problem(s).`);
    for (const p of r.problems.slice(0, 20)) console.log(`  ${p.reference}: ${p.file} is ${p.problem}`);
    if (r.problems.length) process.exitCode = 1;
  }
}

async function clear() {
  await guardFolders();
  if (!second) console.log('No second folder given. A second copy (for example a Google Drive folder) is strongly advised.\n');
  const manifest = await loadManifest(dest);

  const verifiedFirst = await intactPaths(dest, manifest);
  const verifiedSecond = second ? await intactPaths(second, manifest) : null;

  const docs = await prisma.document.findMany({
    where: { deletedAt: null, bookingId: { not: null } },
    include: { booking: { select: { id: true, reference: true, stage: true, overdue: true, needsReview: true, completedAt: true } } },
  });
  const candidates: ClearCandidate[] = docs.map((d) => ({
    documentId: d.id, pathname: d.pathname, bytes: d.bytes, kind: d.kind, bookingId: d.booking?.id ?? null,
    reference: d.booking?.reference ?? null, stage: d.booking?.stage ?? null, overdue: d.booking?.overdue ?? false,
    needsReview: d.booking?.needsReview ?? false, completedAt: d.booking?.completedAt ?? null, deletedAt: d.deletedAt,
  }));

  const plan = planClear(candidates, { now: new Date(), minAgeDays, verifiedFirst, verifiedSecond });
  console.log(`Would remove ${plan.clear.length} file(s) (${mb(plan.bytes)}) from ${plan.bookings} finished rental(s).`);
  for (const k of plan.keep) console.log(`  kept: ${k.count} ${k.reason}`);
  await printUsage();
  if (!plan.clear.length || dryRun) return;

  console.log(
    '\nThis permanently deletes those files from cloud storage. They stay only in the backup folder' +
      (second ? ' and the second folder.' : '.') +
      '\nIf the second folder is Google Drive, open Drive in a browser first and check the files are really there.',
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Type ${plan.clear.length} to remove them, anything else to cancel: `)).trim();
  rl.close();
  if (answer !== String(plan.clear.length)) stop('cancelled. Nothing was removed.');

  const perBooking = new Map<string, number>();
  let removed = 0;
  for (const c of plan.clear) {
    try {
      await del(c.pathname);
    } catch (err) {
      // already gone from the store is fine; anything else keeps the file marked as stored
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not.?found|404/i.test(msg)) {
        console.error(`  could not remove ${c.reference ?? ''} ${c.documentId}: ${msg}`);
        continue;
      }
    }
    await prisma.document.update({ where: { id: c.documentId }, data: { deletedAt: new Date() } });
    removed += 1;
    if (c.bookingId) perBooking.set(c.bookingId, (perBooking.get(c.bookingId) ?? 0) + 1);
  }
  for (const [bookingId, n] of perBooking) {
    await prisma.bookingEvent.create({
      data: { bookingId, type: 'files_saved_offsite', detail: `${n} file(s) removed from cloud storage after being saved on the office computer`, actor: 'backup' },
    });
  }
  console.log(`\nRemoved ${removed} of ${plan.clear.length} file(s).`);
  await printUsage();
}

async function printUsage() {
  try {
    const u = await measureUsage();
    console.log(`Cloud storage in use: ${u.pct.toFixed(1)}% (${mb(u.totalBytes)} of ${mb(u.quotaBytes)}).`);
  } catch {
    console.log('(Could not read cloud storage usage.)');
  }
}

(async () => {
  try {
    if (command === 'run') await run();
    else if (command === 'verify') await verify();
    else if (command === 'clear') await clear();
    else stop(`unknown command "${command}". Use run, verify or clear.`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

void emptyManifest;
