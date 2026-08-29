process.loadEnvFile?.('.env');
import { writeFileSync } from 'fs';

async function main() {
  const { buildContractPdf } = await import('../src/lib/pdf');
  const { hashTerms } = await import('../src/lib/tokens');
  const { fullTermsText } = await import('../src/lib/contract-terms');

  // A 1x1 png as a stand-in signature
  const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const bytes = await buildContractPdf({
    type: 'RENTAL_AGREEMENT',
    reference: 'CHT-ABC123',
    truck: { code: 'A', plate: '764302D', year: 2022 },
    pickupDate: '2026-09-14',
    returnDate: '2026-09-16',
    fields: {
      clientName: 'Crystal Reyes',
      phone: '+19515550147',
      employer: 'Acme Co',
      employerPhone: '9515550000',
      oldStreet: '123 Old Ranch Rd',
      oldCity: 'Murrieta', oldState: 'CA', oldZip: '92562',
      newStreet: '', newCity: '', newState: 'CA', newZip: '',
      licenseNo: 'D1234567',
      dob: '04/12/1990',
      insuranceCarrier: 'State Farm',
      insurancePhone: '8005551212',
      insurancePolicyNo: 'POL-889231',
    },
    signerName: 'Crystal Reyes',
    initials: 'CR',
    signatureDataUrl: sig,
    signedAt: new Date('2026-08-30T12:00:00Z'),
    ipAddress: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    termsHash: hashTerms(fullTermsText()),
  });

  writeFileSync('pdf-out.pdf', bytes);
  console.log('PDF OK —', bytes.length, 'bytes');
}
main().catch((e) => { console.error('PDF FAILED:', e); process.exit(1); });
