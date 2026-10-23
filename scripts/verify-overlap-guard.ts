import { PrismaClient } from '@prisma/client';
import { OVERLAP_GUARD_SQL, isOverlapViolation } from '../src/lib/overlap-guard';

/**
 * Proves the overlap guard behaves, using two REAL database connections.
 *
 *   npx tsx --env-file=.env scripts/verify-overlap-guard.ts
 *
 * Mocks cannot show what Postgres does when two writers race, so this does it
 * for real — on a throwaway table of its own (zz_overlap_probe) with the same
 * constraint, created and dropped inside the script. It never touches the
 * bookings table, so it is safe to run against live data.
 */

const TABLE = 'zz_overlap_probe';
const CONSTRAINT = 'zz_overlap_probe_no_overlap';

const c1 = new PrismaClient();
const c2 = new PrismaClient();

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The production statement, retargeted at the probe table. */
const probeSql = OVERLAP_GUARD_SQL.replace('ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap', `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CONSTRAINT}`);

const insert = (
  db: { $executeRawUnsafe: (q: string) => Promise<number> },
  truck: string,
  start: string,
  end: string,
  stage = 'CONFIRMED',
) =>
  db.$executeRawUnsafe(
    `INSERT INTO ${TABLE} ("truckId", "blockStart", "blockEnd", stage) VALUES ('${truck}', '${start}', '${end}', '${stage}'::"Stage")`,
  );

async function refused(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (err) {
    return isOverlapViolation(err) || /violates exclusion constraint|23P01/.test(String((err as Error)?.message));
  }
}

async function main() {
  if (probeSql === OVERLAP_GUARD_SQL) throw new Error('Could not retarget the guard SQL at the probe table.');

  await c1.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`);
  await c1.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist');
  await c1.$executeRawUnsafe(
    `CREATE TABLE ${TABLE} (id serial PRIMARY KEY, "truckId" text, "blockStart" date NOT NULL, "blockEnd" date NOT NULL, stage "Stage" NOT NULL)`,
  );
  await c1.$executeRawUnsafe(probeSql);

  try {
    // --- single-writer behaviour -------------------------------------------
    await insert(c1, 'A', '2026-10-17', '2026-10-19');
    check('a first booking is accepted', true);

    await insert(c1, 'A', '2026-10-20', '2026-10-22');
    check('a booking the very next day is accepted (back to back is fine)', true);

    check('a booking sharing a single day is refused', await refused(() => insert(c1, 'A', '2026-10-22', '2026-10-24')));
    check('a booking inside another is refused', await refused(() => insert(c1, 'A', '2026-10-18', '2026-10-18')));

    await insert(c1, 'B', '2026-10-17', '2026-10-19');
    check('the same days on the other truck are accepted', true);

    await insert(c1, 'A', '2026-10-17', '2026-10-19', 'CANCELLED');
    check('a cancelled booking over the same days is accepted — it holds nothing', true);

    await insert(c1, 'A', '2026-10-17', '2026-10-19', 'COMPLETED');
    check('a completed booking over the same days is accepted — it holds nothing', true);

    await c1.$executeRawUnsafe(`INSERT INTO ${TABLE} ("truckId", "blockStart", "blockEnd", stage) VALUES (NULL, '2026-10-17', '2026-10-19', 'CONFIRMED'::"Stage")`);
    await c1.$executeRawUnsafe(`INSERT INTO ${TABLE} ("truckId", "blockStart", "blockEnd", stage) VALUES (NULL, '2026-10-17', '2026-10-19', 'CONFIRMED'::"Stage")`);
    check('two bookings with no truck yet do not clash with each other', true);

    // --- two connections racing --------------------------------------------
    // Writer 1 inserts and holds its transaction open. Writer 2 then tries to
    // take the same days. Postgres must make writer 2 WAIT, and once writer 1
    // commits, REFUSE it — not let it slip through in the gap.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const begun = new Promise<void>((r) => (started = r));

    const writer1 = c1.$transaction(
      async (tx) => {
        await insert(tx, 'A', '2026-11-02', '2026-11-04');
        started();
        await gate;
      },
      { timeout: 20_000 },
    );
    await begun;

    let writer2State: 'pending' | 'settled' = 'pending';
    const writer2 = c2
      .$transaction(async (tx) => insert(tx, 'A', '2026-11-04', '2026-11-06'), { timeout: 20_000 })
      .then(
        () => 'inserted' as const,
        (err) => (isOverlapViolation(err) || /exclusion|23P01/.test(String(err?.message)) ? ('refused' as const) : (`error: ${err?.message}` as const)),
      )
      .finally(() => (writer2State = 'settled'));

    await sleep(1500);
    check('a second connection WAITS while the first holds the days uncommitted', writer2State === 'pending');

    release();
    await writer1;
    const outcome = await writer2;
    check('once the first commits, the second connection is REFUSED', outcome === 'refused', String(outcome));

    // Writer 1 rolls back instead — writer 2 should then get the days.
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => (release2 = r));
    let started2!: () => void;
    const begun2 = new Promise<void>((r) => (started2 = r));

    const writer3 = c1
      .$transaction(
        async (tx) => {
          await insert(tx, 'A', '2026-12-01', '2026-12-03');
          started2();
          await gate2;
          throw new Error('rollback on purpose');
        },
        { timeout: 20_000 },
      )
      .catch(() => 'rolled back');
    await begun2;

    const writer4 = c2.$transaction(async (tx) => insert(tx, 'A', '2026-12-03', '2026-12-05'), { timeout: 20_000 }).then(
      () => 'inserted',
      (err) => `error: ${err?.message}`,
    );
    await sleep(800);
    release2();
    await writer3;
    check('if the first connection rolls back, the second gets the days', (await writer4) === 'inserted');
  } finally {
    await c1.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Probe table dropped.`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error(err);
    await c1.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(async () => {
    await c1.$disconnect();
    await c2.$disconnect();
  });
