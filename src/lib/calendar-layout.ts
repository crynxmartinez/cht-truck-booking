import { addDays, dateToIso, type IsoDate } from './dates';

/**
 * Turns date ranges into the bars a month grid draws.
 *
 * A rental is one thing that lasts several days, so it should look like one
 * bar, not three separate squares. That means splitting each range at week
 * boundaries and stacking overlapping pieces into lanes, which is the whole
 * awkward part of a month view.
 */

export type CalItem = {
  id: string;
  kind: 'booking' | 'blackout';
  truck: 'A' | 'B' | null;
  label: string;
  sublabel?: string;
  start: IsoDate;
  end: IsoDate; // inclusive
  /** Signed contract still waiting on the main admin. */
  unsigned?: boolean;
};

export type Segment = {
  item: CalItem;
  /** 1-based grid column of the first day in this week. */
  col: number;
  span: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
};

export type Week = {
  days: IsoDate[];
  segments: Segment[];
  /** Lanes actually used, so the row can be sized to fit. */
  lanes: number;
};

/** Sunday-start weeks covering the whole month, padded out to full weeks. */
export function monthWeeks(year: number, monthIndex0: number): Week[] {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0));

  let cursor = dateToIso(first);
  // Walk back to the Sunday on or before the 1st.
  while (new Date(cursor + 'T00:00:00Z').getUTCDay() !== 0) cursor = addDays(cursor, -1);

  const endIso = dateToIso(last);
  const weeks: Week[] = [];

  while (true) {
    const days: IsoDate[] = [];
    for (let i = 0; i < 7; i++) days.push(addDays(cursor, i));
    weeks.push({ days, segments: [], lanes: 0 });
    cursor = addDays(cursor, 7);
    if (days[6] >= endIso) break;
  }
  return weeks;
}

/**
 * Place items into the weeks.
 *
 * Lanes are assigned per week rather than globally: a bar only has to avoid
 * the bars it actually shares a row with, so a long-finished rental never
 * pushes a later one down the grid for no reason.
 */
export function layout(weeks: Week[], items: CalItem[]): Week[] {
  // Longest first, then by start, so multi-day rentals take the top lanes and
  // the eye follows them across the row.
  const sorted = [...items].sort((a, b) => {
    const la = spanDays(a), lb = spanDays(b);
    if (la !== lb) return lb - la;
    return a.start.localeCompare(b.start);
  });

  for (const w of weeks) {
    const weekStart = w.days[0];
    const weekEnd = w.days[6];
    // lane -> the [column, span] pairs already placed in it
    const occupied: Array<Array<[number, number]>> = [];

    for (const item of sorted) {
      if (item.end < weekStart || item.start > weekEnd) continue;

      const segStart = item.start < weekStart ? weekStart : item.start;
      const segEnd = item.end > weekEnd ? weekEnd : item.end;
      const col = w.days.indexOf(segStart) + 1;
      const span = w.days.indexOf(segEnd) - w.days.indexOf(segStart) + 1;
      if (col < 1 || span < 1) continue;

      // First lane with no overlap in these columns.
      let lane = 0;
      for (;; lane++) {
        const used = occupied[lane] ?? (occupied[lane] = []);
        const clash = used.some(([c, s]) => col < c + s && c < col + span);
        if (!clash) {
          used.push([col, span]);
          break;
        }
      }

      w.segments.push({
        item,
        col,
        span,
        lane: lane + 1,
        isStart: item.start >= weekStart,
        isEnd: item.end <= weekEnd,
      });
      w.lanes = Math.max(w.lanes, lane + 1);
    }
  }
  return weeks;
}

function spanDays(i: CalItem): number {
  return Math.round(
    (new Date(i.end + 'T00:00:00Z').getTime() - new Date(i.start + 'T00:00:00Z').getTime()) / 86_400_000,
  );
}

/** Which trucks are busy on a given day, for the free/busy dots. */
export function busyOn(items: CalItem[], day: IsoDate): { a: boolean; b: boolean } {
  let a = false, b = false;
  for (const i of items) {
    if (day < i.start || day > i.end) continue;
    if (i.truck === 'A') a = true;
    if (i.truck === 'B') b = true;
  }
  return { a, b };
}

export function segmentClass(s: Segment): string {
  if (s.isStart && s.isEnd) return 'whole';
  if (s.isStart) return 'start';
  if (s.isEnd) return 'end';
  return 'mid';
}
