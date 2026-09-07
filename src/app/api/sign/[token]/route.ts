import { after } from 'next/server';
import { ContractType, DocKind, DocPhase, Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { dateToIso } from '@/lib/dates';
import { cleanString, clientIp, isEmail, json, rateLimit, toE164 } from '@/lib/http';
import { fullTermsText, TERMS_VERSION } from '@/lib/contract-terms';
import { hashTerms, newToken } from '@/lib/tokens';
import { buildContractPdf } from '@/lib/pdf';
import { blobConfigured, recordDocument, storeFile } from '@/lib/storage';
import { logEvent, notify, notifyStaff, setStage } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/sign/[token]
 *
 * Records the signature with its audit trail, renders the PDF, then decides
 * what happens next: if the renter named an additional driver we create that
 * second contract and send it to them directly; otherwise the booking is
 * confirmed and the confirmation goes out.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return await handleSign(req, token);
  } catch (err) {
    // An uncaught throw here becomes an opaque 500 in the renter's console and
    // leaves no trace anywhere the office would look. Record it against the
    // booking so it shows in the card's activity, and tell the renter something
    // they can act on rather than "Internal Server Error".
    console.error('sign failed', { token, err });
    try {
      const c = await prisma.contract.findUnique({ where: { token }, select: { bookingId: true } });
      if (c) await logEvent(c.bookingId, 'sign_failed', String(err), 'system');
    } catch {
      /* logging must not mask the original failure */
    }
    return json(
      { error: 'We could not save your signature. Please try once more — if it happens again, reply to your text and we will sort it out.' },
      { status: 500 },
    );
  }
}

async function handleSign(req: Request, token: string) {
  const ip = clientIp(req);

  const limit = rateLimit(`sign:${ip}`, 20, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });

  const contract = await prisma.contract.findUnique({
    where: { token },
    include: { booking: { include: { truck: true } } },
  });
  if (!contract) return json({ error: 'This link is not valid.' }, { status: 404 });
  if (contract.status === 'VOID') return json({ error: 'This agreement was replaced.' }, { status: 410 });
  if (contract.booking.stage === 'CANCELLED') return json({ error: 'This booking was cancelled.' }, { status: 410 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Could not read that request.' }, { status: 400 });
  }

  const fieldsIn = (body.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldsIn)) {
    if (typeof v === 'string' && k.length < 40) fields[k] = v.trim().slice(0, 300);
  }

  const initials = cleanString(body.initials, 5).toUpperCase();
  const signerName = cleanString(body.signerName, 120) || fields.clientName || fields.name || '';
  const signatureDataUrl = typeof body.signatureDataUrl === 'string' ? body.signatureDataUrl : '';
  const tollAccepted = body.tollAccepted === true;

  const isRental = contract.type === ContractType.RENTAL_AGREEMENT;
  const b = contract.booking;

  // Additional driver, if the renter named one.
  let addDriver: { name: string; email: string; phone: string } | null = null;
  if (isRental && body.additionalDriver) {
    const name = cleanString(body.additionalDriver.name, 120);
    const email = cleanString(body.additionalDriver.email, 254).toLowerCase();
    const phone = toE164(cleanString(body.additionalDriver.phone, 32));
    if (name && isEmail(email) && phone) addDriver = { name, email, phone };
    else return json({ error: "Please complete the additional driver's name, email and mobile." }, { status: 400 });
  }

  // Already signed. Do not re-sign — but do not throw away a second driver
  // named on this submission either. Returning a bare ok here meant a resubmit
  // showed "we've sent the additional driver their agreement" while the server
  // had quietly discarded them.
  if (contract.status === 'SIGNED') {
    const invited = addDriver ? await inviteAdditionalDriver(b.id, addDriver) : false;
    return json({
      ok: true,
      alreadySigned: true,
      additionalDriverInvited: invited,
      pdfUrl: contract.pdfPathname ? `${config.appUrl}/api/files/contract/${token}` : null,
    });
  }

  if (!signerName) return json({ error: 'Please enter your name.' }, { status: 400 });
  if (initials.length < 2) return json({ error: 'Please initial the damage waiver.' }, { status: 400 });
  if (!tollAccepted) return json({ error: 'Please agree to cover any tolls before signing.' }, { status: 400 });
  if (!/^data:image\/(png|jpeg);base64,/.test(signatureDataUrl)) {
    return json({ error: 'Please sign before submitting.' }, { status: 400 });
  }
  // A signature image is small; anything huge is not a signature.
  if (signatureDataUrl.length > 900_000) return json({ error: 'That signature image is too large.' }, { status: 413 });

  const signedAt = new Date();
  const termsHash = hashTerms(fullTermsText());

  // ---- record the signature ---------------------------------------------
  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: 'SIGNED',
      signedAt,
      signerName,
      signerEmail: isRental ? b.email : fields.email || null,
      initials,
      tollAcknowledged: true,
      tollAcknowledgedAt: signedAt,
      signatureData: signatureDataUrl,
      payload: fields as never,
      termsVersion: TERMS_VERSION,
      termsHash,
      ipAddress: ip,
      userAgent: (req.headers.get('user-agent') ?? '').slice(0, 500),
    },
  });

  await logEvent(
    b.id,
    'contract_signed',
    `${isRental ? 'Rental agreement' : 'Additional driver agreement'} signed by ${signerName}`,
    'renter',
    { ip, termsVersion: TERMS_VERSION },
  );

  // ---- render the PDF (best effort) --------------------------------------
  let pdfUrl: string | null = null;
  try {
    if (blobConfigured()) {
      const bytes = await buildContractPdf({
        type: contract.type,
        reference: b.reference,
        truck: b.truck ? { code: b.truck.code, plate: b.truck.plate, year: b.truck.year } : null,
        pickupDate: dateToIso(b.pickupDate),
        returnDate: dateToIso(b.returnDate),
        fields,
        signerName,
        initials,
        tollAcknowledged: true,
        signatureDataUrl,
        signedAt,
        ipAddress: ip,
        userAgent: req.headers.get('user-agent'),
        termsHash,
      });

      const stored = await storeFile({
        data: Buffer.from(bytes),
        contentType: 'application/pdf',
        ext: 'pdf',
        folder: `bookings/${b.reference}/contracts`,
        name: isRental ? 'rental-agreement' : 'additional-driver-agreement',
      });

      await recordDocument({ bookingId: b.id, kind: DocKind.SIGNED_CONTRACT, phase: DocPhase.CONTRACT, file: stored });
      await prisma.contract.update({
        where: { id: contract.id },
        data: { pdfUrl: stored.url, pdfPathname: stored.pathname },
      });
      // The blob itself is private; the renter reads it back through their token.
      pdfUrl = `${config.appUrl}/api/files/contract/${token}`;
    }
  } catch (err) {
    console.error('contract pdf failed', err);
    await logEvent(b.id, 'pdf_failed', String(err), 'system');
  }

  // ---- what happens next, AFTER the response ------------------------------
  // A contact upsert plus an email and an SMS is three GoHighLevel round trips,
  // each allowed up to ten seconds. Awaiting them here put the whole request
  // within reach of the function timeout — and a timeout after the signature is
  // already stored looks to the renter like the signing failed, so they sign
  // again. The signature is committed above; none of this needs to block it.
  after(async () => {
  try {
    if (isRental && addDriver) {
      await inviteAdditionalDriver(b.id, addDriver);
    } else {
      // Either the renter is driving alone, or this WAS the additional driver.
      const outstanding = await prisma.contract.count({
        where: { bookingId: b.id, status: { in: ['SENT', 'VIEWED'] } },
      });
      if (outstanding === 0) {
        await setStage(b.id, Stage.CONFIRMED, 'system', 'All agreements signed');
        await notify(b.id, 'rental_confirmed');
        await notifyStaff(b.id, 'confirmed');
      }
    }
  } catch (err) {
    console.error('post-sign flow failed', err);
    await logEvent(b.id, 'post_sign_failed', String(err), 'system');
  }
  });

  return json({
    ok: true,
    pdfUrl,
    additionalDriverInvited: Boolean(isRental && addDriver),
    pickupAddress: config.pickupAddress,
  });
}


/**
 * Record a second driver and send them their own agreement.
 *
 * Their email and mobile are captured on the main contract precisely so this
 * can go to them directly — the renter never has to forward anything.
 *
 * Returns false when an invite already exists, so a resubmit does not create a
 * second contract or text them twice.
 */
async function inviteAdditionalDriver(
  bookingId: string,
  driver: { name: string; email: string; phone: string },
): Promise<boolean> {
  const existing = await prisma.contract.findFirst({
    where: { bookingId, type: ContractType.ADDITIONAL_DRIVER, status: { not: 'VOID' } },
    select: { id: true },
  });

  await prisma.booking.update({ where: { id: bookingId }, data: { additionalDriverRequested: true } });
  await prisma.additionalDriver.upsert({
    where: { bookingId },
    create: { bookingId, name: driver.name, email: driver.email, phone: driver.phone },
    update: { name: driver.name, email: driver.email, phone: driver.phone },
  });

  if (existing) return false;

  await prisma.contract.create({
    data: {
      bookingId,
      type: ContractType.ADDITIONAL_DRIVER,
      token: newToken(),
      signerName: driver.name,
      signerEmail: driver.email,
    },
  });

  await setStage(bookingId, Stage.ADDITIONAL_DRIVER, 'system', 'Renter named an additional driver');
  await notifyStaff(bookingId, 'additional_driver_invited', { additionalDriverName: driver.name });
  await notify(bookingId, 'additional_driver', {
    to: {
      firstName: driver.name.split(' ')[0] ?? driver.name,
      lastName: driver.name.split(' ').slice(1).join(' '),
      email: driver.email,
      phone: driver.phone,
    },
  });
  return true;
}
