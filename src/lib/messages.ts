import { config } from './config';
import { formatLong } from './dates';
import { checklistUrl, signUrl } from './tokens';

/**
 * Every email and text the system sends. Kept as data rather than scattered
 * through route handlers so the office can read them all in one place, and so
 * `template` is a stable key for the idempotency guard in MessageLog.
 */

export type TemplateKey =
  | 'booking_received'
  | 'contract_to_sign'
  | 'contract_nudge'
  | 'additional_driver'
  | 'rental_confirmed'
  | 'pickup_morning'
  | 'pickup_no_show_check'
  | 'return_day'
  | 'overdue'
  | 'thank_you';

export type Rendered = {
  subject: string;
  email: string;
  sms: string;
};

export type MessageContext = {
  firstName: string;
  lastName?: string;
  reference: string;
  truckCode?: string | null;
  pickupDate: string; // ISO
  returnDate: string; // ISO
  lockboxCode?: string | null;
  contractToken?: string | null;
  pickupChecklistToken?: string | null;
  dropoffChecklistToken?: string | null;
  additionalDriverName?: string | null;
  renterName?: string | null;
};

const SIGNOFF = 'Diana\nCory Home Team';

export function render(key: TemplateKey, c: MessageContext): Rendered {
  const pickup = formatLong(c.pickupDate);
  const back = formatLong(c.returnDate);
  const truck = c.truckCode ? `Truck ${c.truckCode}` : 'your truck';
  const addr = config.pickupAddress;
  const sign = c.contractToken ? signUrl(c.contractToken) : '';
  const pickList = c.pickupChecklistToken ? checklistUrl(c.pickupChecklistToken) : '';
  const dropList = c.dropoffChecklistToken ? checklistUrl(c.dropoffChecklistToken) : '';

  switch (key) {
    case 'booking_received':
      return {
        subject: `We've got your truck request for ${pickup}`,
        email: [
          `Hi ${c.firstName},`,
          ``,
          `Your 3-day truck rental request is in. Nothing is locked yet — your`,
          `rental agreement is on its way in a separate message. Sign it and the`,
          `truck is yours.`,
          ``,
          `Pickup: ${addr}`,
          `Reference: ${c.reference}`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms:
          `Hi ${c.firstName}, we got your truck request for ${pickup}. Your rental ` +
          `agreement is on its way — sign it and you're locked in. — Diana, CHT`,
      };

    case 'contract_to_sign':
      return {
        subject: 'Sign your truck rental agreement (2 minutes)',
        email: [
          `Hi ${c.firstName},`,
          ``,
          `Here's your rental agreement for ${truck} on ${pickup}:`,
          ``,
          sign,
          ``,
          `Have your driver's licence and insurance card handy — we ask for the`,
          `policy number. It takes about two minutes on a phone.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms: `Hi ${c.firstName}, here's your Cory Home Team rental agreement for ${pickup}: ${sign} — about 2 min. Diana`,
      };

    case 'contract_nudge':
      return {
        subject: `Still need your signature for ${pickup}`,
        email: [
          `Hi ${c.firstName},`,
          ``,
          `${truck} is being held for you on ${pickup}, but the rental agreement`,
          `is still unsigned:`,
          ``,
          sign,
          ``,
          `We can only hold the date for a little longer before it goes back on`,
          `the calendar. If your plans changed, just reply and let us know.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms: `Hi ${c.firstName}, we're still holding ${truck} for ${pickup} but need your signature: ${sign} — Diana`,
      };

    case 'additional_driver':
      return {
        subject: `Sign as an additional driver — ${pickup}`,
        email: [
          `Hi ${c.additionalDriverName ?? 'there'},`,
          ``,
          `${c.renterName ?? 'The renter'} listed you as an additional driver on a`,
          `Cory Home Team truck rental for ${pickup}.`,
          ``,
          `You'll need to sign before you can legally drive the truck:`,
          ``,
          sign,
          ``,
          `Have your driver's licence and insurance details handy.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms:
          `Hi ${c.additionalDriverName ?? 'there'}, ${c.renterName ?? 'someone'} listed you as an additional ` +
          `driver on a Cory Home Team truck rental for ${pickup}. Sign here: ${sign} — Diana`,
      };

    case 'rental_confirmed':
      return {
        subject: 'Your Truck Rental Confirmation',
        email: [
          `Your Truck Rental Confirmation`,
          ``,
          `Date: ${c.pickupDate}`,
          ``,
          `Pickup Location: ${addr}`,
          ``,
          ``,
          `You'll get a text at 6AM on your rental day`,
          ``,
          `Get the code to unlock the lockbox and get the keys (lockbox on driver's side window)`,
          ``,
          `Submit required photos before driving off`,
          ``,
          ``,
          `No need to go at 6AM — just head over when it's convenient for you that day!`,
          ``,
          ``,
          `Need to cancel? Reply RESCHEDULE to let us know.`,
        ].join('\n'),
        sms: [
          `Hi ${c.firstName}, Your 3 Day Truck Rental Booking is already approved.`,
          ``,
          `Truck pick up date: ${c.pickupDate}`,
          `We will send you an email and SMS on the pick up date for the instruction and guides.`,
          ``,
          `Diana`,
        ].join('\n'),
      };

    case 'pickup_morning':
      return {
        subject: 'Your truck is ready — checklist inside',
        email: [
          `Good morning ${c.firstName},`,
          ``,
          `${truck} is waiting at ${addr}.`,
          ``,
          `Lockbox code: ${c.lockboxCode ?? '—'}`,
          `The lockbox is on the driver's side window. Open the cover, type the`,
          `code (each number clicks), then turn the black dial counter-clockwise.`,
          ``,
          `Before you drive off, run the pickup checklist — it takes a minute and`,
          `protects you from being charged for damage that was already there:`,
          ``,
          pickList,
          ``,
          `Come by whenever suits you today. Truck is due back ${back}.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms:
          `Good morning ${c.firstName} — ${truck} is ready. Lockbox code ${c.lockboxCode ?? '—'}, ` +
          `driver's side window. Photos before you drive off: ${pickList} ` +
          `Come by whenever works today. — Diana`,
      };

    case 'pickup_no_show_check':
      return {
        subject: 'Did you get the truck OK?',
        email: [
          `Hi ${c.firstName},`,
          ``,
          `Just checking in — we haven't seen your pickup checklist come through.`,
          `Did the lockbox open alright?`,
          ``,
          `If you're at the truck now, the checklist is here: ${pickList}`,
          `If something went wrong, reply to this message and we'll sort it out.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms: `Hi ${c.firstName}, did you get ${truck} OK? We haven't seen your pickup photos yet: ${pickList} — Diana`,
      };

    case 'return_day':
      return {
        subject: `${truck} is due back today`,
        email: [
          `Hi ${c.firstName},`,
          ``,
          `${truck} is due back today at ${addr}.`,
          ``,
          `Two things before you go:`,
          `  1. Top the fuel back to where you found it`,
          `  2. Complete the return checklist — ${dropList}`,
          ``,
          `Keys go back in the lockbox, same code as pickup.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms:
          `Hi ${c.firstName}, ${truck} is due back today. Return the gas at the level you ` +
          `got it, then finish the checklist: ${dropList} — Diana`,
      };

    case 'overdue':
      return {
        subject: `${truck} is overdue`,
        email: [
          `Hi ${c.firstName},`,
          ``,
          `${truck} was due back on ${back} and we haven't had it returned yet.`,
          ``,
          `Please bring it to ${addr} today and complete the return checklist:`,
          ``,
          dropList,
          ``,
          `If something has come up, reply to this message and talk to us — we can`,
          `almost always work it out, but we do need to hear from you.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms: `Hi ${c.firstName}, ${truck} was due back ${back} and hasn't been returned. Please call or reply today. — Diana, CHT`,
      };

    case 'thank_you':
      return {
        subject: 'Thanks for renting with Cory Home Team',
        email: [
          `Hi ${c.firstName},`,
          ``,
          `We've got ${truck} back and your photos are in — you're all clear.`,
          ``,
          `Hope the move went smoothly. If you need the truck again, just book it.`,
          ``,
          SIGNOFF,
        ].join('\n'),
        sms:
          `Thanks ${c.firstName} — we've got ${truck} back and your photos are in. ` +
          `Hope the move went smoothly! — Diana, Cory Home Team`,
      };
  }
}

/** Plain-text email rendered as simple HTML so it looks intentional in a client. */
export function toHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string);

  const linked = esc(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#D6001C;font-weight:600">$1</a>',
  );

  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#17181A;max-width:560px;margin:0 auto;padding:24px">',
    `<div style="white-space:pre-wrap">${linked}</div>`,
    '<hr style="border:0;border-top:1px solid #E4E5E7;margin:26px 0 14px">',
    '<div style="font-size:12px;color:#6B6E73">Cory Home Team &middot; ',
    esc(config.pickupAddress),
    '</div></div>',
  ].join('');
}
