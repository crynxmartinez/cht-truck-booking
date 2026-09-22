import { renderStaff } from '../src/lib/staff-messages';
import { toHtml, toPlain } from '../src/lib/messages';

/** Renders a staff alert both ways so the copy can be read before it is sent. */
const body = renderStaff('booking_received', {
  reference: 'CHT-7NBK95',
  renterName: 'Victor Barroso',
  renterEmail: 'victor@example.com',
  renterPhone: '+19515550134',
  truckCode: 'A',
  pickupDate: '2026-10-17',
  returnDate: '2026-10-19',
});

console.log('=== SUBJECT ===\n' + body.subject);
console.log('\n=== TEXT (what a plain-text client shows) ===\n' + toPlain(body.email));
console.log('\n=== SMS ===\n' + body.sms);

const html = toHtml(body.email);
console.log('\n=== HTML checks ===');
console.log('buttons rendered :', (html.match(/display:inline-block/g) || []).length);
console.log('markers left over:', (html.match(/\[\[/g) || []).length);
console.log('nested anchors   :', /<a[^>]*><a/.test(html));
console.log('NUL bytes        :', (html.match(/\u0000/g) || []).length);

import { writeFileSync } from 'node:fs';
writeFileSync('.scratch/staff-email.html', html);
console.log('\nwrote .scratch/staff-email.html');
