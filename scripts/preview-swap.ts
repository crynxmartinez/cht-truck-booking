import { prisma } from '../src/lib/db';
import { freeTrucksFor } from '../src/lib/availability';
import { expectedEventsFor } from '../src/lib/calendar-sync';
import { dateToIso, todayInOps } from '../src/lib/dates';
import { render } from '../src/lib/messages';
import { buildContext } from '../src/lib/notify';
import { renderStaff } from '../src/lib/staff-messages';
import { checkSwap } from '../src/lib/truck-swap';

/**
 * Rehearse a truck swap. Shows exactly what would happen — and sends and
 * changes NOTHING.
 *
 *   npx tsx --env-file=.env scripts/preview-swap.ts <renter last name> [truck code]
 *
 * With no truck code it assumes the other truck. Run it before you press the
 * button on a real renter: it shows the message they would get, what Diana
 * would be told, what the calendar will say, and whether the move is allowed.
 */

const line = (c = '-') => console.log(c.repeat(72));

async function main() {
  const lastName = process.argv[2];
  const wantCode = process.argv[3]?.toUpperCase();
  if (!lastName) {
    console.error('Usage: npx tsx --env-file=.env scripts/preview-swap.ts <renter last name> [truck code]');
    process.exit(1);
  }

  const matches = await prisma.booking.findMany({
    where: { lastName: { equals: lastName, mode: 'insensitive' }, stage: { notIn: ['CANCELLED', 'COMPLETED'] } },
    include: { truck: true, contracts: { select: { type: true, status: true, pdfPathname: true } } },
    orderBy: { pickupDate: 'asc' },
  });
  if (matches.length === 0) return console.log(`No open booking for "${lastName}".`);
  if (matches.length > 1) {
    console.log(`More than one open booking for "${lastName}" — be more specific:`);
    for (const m of matches) console.log(`  ${m.reference}  ${m.firstName} ${m.lastName}  ${dateToIso(m.pickupDate)}`);
    return;
  }
  const b = matches[0];

  const trucks = await prisma.truck.findMany({ orderBy: { code: 'asc' } });
  const target = wantCode ? trucks.find((t) => t.code === wantCode) : trucks.find((t) => t.id !== b.truckId);
  if (!target) return console.log(`There is no Truck ${wantCode ?? '(other)'}.`);

  const pickup = dateToIso(b.pickupDate);
  const days = Math.round((b.blockEnd.getTime() - b.blockStart.getTime()) / 86_400_000) + 1;
  const codeSent =
    (await prisma.messageLog.count({
      where: { bookingId: b.id, template: 'pickup_morning', recipientKey: 'renter', status: { in: ['QUEUED', 'SENT'] } },
    })) > 0;

  line('=');
  console.log(`SWAP PREVIEW — nothing will be sent or changed`);
  line('=');
  console.log(`${b.firstName} ${b.lastName}   ${b.reference}`);
  console.log(`Stage ${b.stage}   ${pickup} to ${dateToIso(b.returnDate)}   (${days} days)`);
  console.log(`Now on Truck ${b.truck?.code ?? '—'}   →   Truck ${target.code}`);

  // 1. Is it allowed?
  line();
  const verdict = checkSwap({
    stage: b.stage,
    pickupDate: pickup,
    today: todayInOps(),
    codeSent,
    currentTruckId: b.truckId,
    target: { id: target.id, code: target.code, active: target.active },
  });
  console.log(verdict.ok ? 'ALLOWED by the rule.' : `REFUSED by the rule: ${verdict.reason}`);

  // 2. Is the target free for those days?
  const free = await freeTrucksFor(pickup, days);
  const taken = free.taken.find((t) => t.code === target.code);
  console.log(taken ? `Truck ${target.code} is NOT free: ${taken.reason}` : `Truck ${target.code} is free for those days.`);
  if (!target.active) console.log(`Truck ${target.code} is switched off — turn it on in Trucks & lockboxes first.`);

  // 3. What the renter receives.
  const built = await buildContext(b.id);
  if (built) {
    const ctx = { ...built.ctx, truckCode: target.code };
    const msg = render('truck_changed', ctx);
    line();
    console.log('WHAT THE RENTER GETS — email');
    console.log(`Subject: ${msg.subject}\n`);
    console.log(msg.email);
    line();
    console.log('WHAT THE RENTER GETS — text message');
    console.log(msg.sms);

    // 4. What Diana receives.
    const staff = renderStaff('truck_changed', {
      reference: b.reference,
      renterName: `${b.firstName} ${b.lastName}`.trim(),
      renterEmail: b.email,
      renterPhone: b.phone,
      truckCode: target.code,
      pickupDate: pickup,
      returnDate: dateToIso(b.returnDate),
      detail: `Truck ${b.truck?.code ?? '—'} to Truck ${target.code}`,
    });
    line();
    console.log('WHAT DIANA GETS');
    console.log(`Subject: ${staff.subject}`);
    console.log(`Text:    ${staff.sms}`);
  }

  // 5. What the calendar will show.
  const asBooking = (code: string | undefined) => ({
    id: b.id, reference: b.reference, firstName: b.firstName, lastName: b.lastName, email: b.email,
    phone: b.phone, blockStart: b.blockStart, blockEnd: b.blockEnd, stage: b.stage, truck: code ? { code } : null,
  });
  const before = expectedEventsFor(asBooking(b.truck?.code));
  const after = expectedEventsFor(asBooking(target.code));
  line();
  console.log('THE GOOGLE CALENDAR');
  console.log(`  ${before.length} event(s) today read: "${before[0]?.summary}"`);
  console.log(`  they will read:               "${after[0]?.summary}"  (same events, relabelled and recoloured)`);

  // 6. The signed contract.
  const signed = b.contracts.some((c) => c.type === 'RENTAL_AGREEMENT' && c.status === 'SIGNED');
  const stored = b.contracts.some((c) => c.pdfPathname);
  line();
  console.log('THE CONTRACT');
  if (signed && stored) {
    // Do not claim which plate the PDF shows: it names whichever truck the booking
    // was on when it was SIGNED, which is not necessarily the one it is on now
    // (a booking already moved once still prints its original truck).
    console.log('  Signed. The stored PDF names the truck the booking was on when it was signed,');
    console.log('  and it cannot be regenerated.');
    console.log(`  Truck ${target.code}'s plate is ${target.plate}; the PDF may print a different one.`);
    console.log('  The renter message says so, and the activity log records it.');
  } else {
    console.log('  Not signed yet — it will be issued for the new truck. Nothing to caveat.');
  }

  line('=');
  console.log('Nothing has been sent or changed.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
