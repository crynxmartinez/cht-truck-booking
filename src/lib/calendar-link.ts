/**
 * A link that opens the shared "Truck Rentals" calendar in Google Calendar.
 *
 * Google's `cid` parameter is the calendar id in base64 with the padding
 * removed. Opening it shows the calendar, and offers to add it to the
 * viewer's list if they have not already. It only works for people the
 * calendar has been shared with; everyone else sees Google's own refusal, so
 * the link is safe to show.
 */
export function googleCalendarLink(calendarId: string): string | null {
  const id = calendarId.trim();
  if (!id) return null;
  const cid = Buffer.from(id, 'utf8').toString('base64').replace(/=+$/, '');
  return `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(cid)}`;
}
