import { config } from './config';
import { formatLong, formatMedium } from './dates';
import { hourLabel } from './hours';
import type { MessageContext } from './messages';
import { checklistUrl, signUrl } from './tokens';
import type { PlaceholderName } from './wording-fill';

/**
 * What each placeholder becomes for one booking. A value the booking does not
 * have comes out empty, which makes a message that needs it fall back to the
 * built-in wording instead of going out with a blank.
 */
export function wordingValues(c: MessageContext): Record<PlaceholderName, string> {
  return {
    firstName: c.firstName,
    renterName: c.renterName ?? '',
    driverName: c.additionalDriverName ?? 'there',
    reference: c.reference,
    truck: c.truckCode ? `Truck ${c.truckCode}` : 'your truck',
    pickupDate: formatLong(c.pickupDate),
    returnDate: formatLong(c.returnDate),
    pickupDateShort: formatMedium(c.pickupDate),
    returnDateShort: formatMedium(c.returnDate),
    pickupDateIso: c.pickupDate,
    returnDateIso: c.returnDate,
    rentalDays: String(c.rentalDays ?? config.rentalBlockDays),
    pickupAddress: config.pickupAddress,
    pickupHour: hourLabel(config.pickupSmsHour),
    lockboxCode: c.lockboxCode ?? '',
    signLink: c.contractToken ? signUrl(c.contractToken) : '',
    pickupChecklistLink: c.pickupChecklistToken ? checklistUrl(c.pickupChecklistToken) : '',
    returnChecklistLink: c.dropoffChecklistToken ? checklistUrl(c.dropoffChecklistToken) : '',
  };
}
