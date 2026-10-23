import { prisma } from '../src/lib/db';
import { findOverlaps, type HoldRow } from '../src/lib/invariants';
import { GUARDED_STAGES, OVERLAP_CONSTRAINT, OVERLAP_GUARD_SQL } from '../src/lib/overlap-guard';

/**
 * Installs the database-level guarantee that a truck cannot be held by two
 * bookings on the same day.
 *
 *   npx tsx --env-file=.env scripts/apply-overlap-guard.ts          # rehearse only
 *   npx tsx --env-file=.env scripts/apply-overlap-guard.ts --apply  # install it
 *
 * The rehearsal runs the real statements inside a transaction that is rolled
 * back, so it proves the database will accept them without changing anything.
 * Safe to run any number of times: it does nothing if the guard is already in.
 *
 * To remove it again:   ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;
 */

class Rehearsal extends Error {}

async function installed(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
    `SELECT conname FROM pg_constraint WHERE conname = '${OVERLAP_CONSTRAINT}'`,
  );
  return rows.length > 0;
}

async function main() {
  const apply = process.argv.includes('--apply');

  if (await installed()) {
    console.log(`The guard (${OVERLAP_CONSTRAINT}) is already installed. Nothing to do.`);
    return;
  }

  // The constraint refuses to install over existing clashes, so look first and
  // name them, rather than letting Postgres fail with a bare error.
  const bookings = await prisma.booking.findMany({
    where: { truckId: { not: null }, stage: { in: [...GUARDED_STAGES] } },
    select: { id: true, reference: true, truckId: true, blockStart: true, blockEnd: true, stage: true },
  });
  const rows: HoldRow[] = bookings.map((b) => ({
    id: b.id,
    reference: b.reference,
    truckId: b.truckId,
    blockStart: b.blockStart.toISOString().slice(0, 10),
    blockEnd: b.blockEnd.toISOString().slice(0, 10),
    stage: b.stage,
  }));

  const clashes = findOverlaps(rows);
  if (clashes.length > 0) {
    console.error('Cannot install: these bookings already overlap on one truck. Fix them first.\n');
    for (const [a, b] of clashes) {
      console.error(`  ${a.reference} (${a.blockStart} to ${a.blockEnd})  vs  ${b.reference} (${b.blockStart} to ${b.blockEnd})`);
    }
    process.exit(1);
  }
  console.log(`Checked ${rows.length} truck-holding booking(s): no overlaps.`);

  // Rehearsal — always, even with --apply, so a failure never leaves a half-install.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist');
      await tx.$executeRawUnsafe(OVERLAP_GUARD_SQL);
      throw new Rehearsal();
    });
  } catch (err) {
    if (!(err instanceof Rehearsal)) {
      console.error('The database rejected the guard:\n', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  console.log('Rehearsal passed: the database accepts the guard (rolled back, nothing changed).');

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to install it.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist');
    await tx.$executeRawUnsafe(OVERLAP_GUARD_SQL);
  });

  console.log((await installed()) ? `\nInstalled: ${OVERLAP_CONSTRAINT}.` : '\nERROR: the guard is not present after install.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
