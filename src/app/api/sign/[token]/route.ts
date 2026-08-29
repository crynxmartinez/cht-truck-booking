import { ContractType, DocKind, DocPhase, Stage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { dateToIso } from '@/lib/dates';
import { cleanString, clientIp, isEmail, json, rateLimit, toE164 } from '@/lib/http';
import { fullTermsText, TERMS_VERSION } from '@/lib/contract-terms';
import { hashTerms, newToken } from '@/lib/tokens';
import { buildContractPdf } from '@/lib/pdf';
import { blobConfigured, recordDocument, storeFile } from '@/lib/storage';
import { logEvent, notify, setStage } from '@/lib/notify';

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
  const ip = clientIp(req);

  const limit = rateLimit(`sign:${ip}`, 20, 10 * 60_000);
  if (!limit.ok) return json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });

  const contract = await prisma.contract.findUnique({
    where: { token },
    include: { booking: { include: { truck: true } } },
  });
  if (!contract) return json({ error: 'This link is not valid.' }, { status: 404 });
  if (contract.status === 'SIGNED') {
    return json({ ok: true, pdfUrl: contract.pdfPathname ? `${config.appUrl}/api/files/contract/${token}` : null });
  }
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

  if (!signerName) return json({ error: 'Please enter your name.' }, { status: 400 });
  if (initials.length < 2) return json({ error: 'Please initial the damage waiver.' }, { status: 400 });
  if (!/^data:image\/(png|jpeg);base64,/.test(signatureDataUrl)) {
    return json({ error: 'Please sign before submitting.' }, { status: 400 });
  }
  // A signature image is small; anything huge is not a signature.
  if (signatureDataUrl.length > 900_000) return json({ error: 'That signature image is too large.' }, { status: 413 });

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

  // ---- what happens next -------------------------------------------------
  try {
    if (isRental && addDriver) {
      await prisma.booking.update({
        where: { id: b.id },
        data: { additionalDriverRequested: true },
      });
      await prisma.additionalDriver.upsert({
        where: { bookingId: b.id },
        create: { bookingId: b.id, name: addDriver.name, email: addDriver.email, phone: addDriver.phone },
        update: { name: addDriver.name, email: addDriver.email, phone: addDriver.phone },
      });

      const existing = await prisma.contract.findFirst({
        where: { bookingId: b.id, type: ContractType.ADDITIONAL_DRIVER, status: { not: 'VOID' } },
      });
      if (!existing) {
        await prisma.contract.create({
          data: {
            bookingId: b.id,
            type: ContractType.ADDITIONAL_DRIVER,
            token: newToken(),
            signerName: addDriver.name,
            signerEmail: addDriver.email,
          },
        });
      }

      await setStage(b.id, Stage.ADDITIONAL_DRIVER, 'system', 'Renter named an additional driver');
      await notify(b.id, 'additional_driver', {
        to: {
          firstName: addDriver.name.split(' ')[0] ?? addDriver.name,
          lastName: addDriver.name.split(' ').slice(1).join(' '),
          email: addDriver.email,
          phone: addDriver.phone,
        },
      });
    } else {
      // Either the renter is driving alone, or this WAS the additional driver.
      const outstanding = await prisma.contract.count({
        where: { bookingId: b.id, status: { in: ['SENT', 'VIEWED'] } },
      });
      if (outstanding === 0) {
        await setStage(b.id, Stage.CONFIRMED, 'system', 'All agreements signed');
        await notify(b.id, 'rental_confirmed');
      }
    }
  } catch (err) {
    console.error('post-sign flow failed', err);
    await logEvent(b.id, 'post_sign_failed', String(err), 'system');
  }

  return json({ ok: true, pdfUrl, pickupAddress: config.pickupAddress });
}
