import { hourLabel } from './messages';

/**
 * Every setting the office may change from the Settings page.
 *
 * Pure data and pure functions: what a setting is called, what it means in
 * plain English, and which values are allowed. Nothing here touches the
 * database, so the rules can be tested without one.
 *
 * Deliberately not here: the block length (3 days). Changing it moves every
 * booking on the calendar, which is not a thing to do with one click.
 */

export type SettingKey =
  | 'minLeadDays'
  | 'maxMonthsAhead'
  | 'pickupSmsHour'
  | 'pickupReminderHour'
  | 'noPickupCheckHour'
  | 'pickupLastHour'
  | 'returnSmsHour'
  | 'dailySweepHour'
  | 'unsignedReleaseHours'
  | 'completedHideDays'
  | 'storageDeletionEnabled'
  | 'blobQuotaGb'
  | 'purgeStartPct'
  | 'idDocsDays'
  | 'checklistPhotoDays'
  | 'pickupFuelGauge'
  | 'exteriorPhotos';

export type SettingGroup = 'Booking' | 'Messages' | 'Contracts' | 'Board' | 'Storage' | 'Photos';

export type SettingUnit = 'hour' | 'hours' | 'days' | 'months' | 'percent' | 'gb';

export type SettingDef = {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  /** One or two plain sentences: what it does, and what changes if you change it. */
  help: string;
  kind: 'int' | 'bool';
  unit?: SettingUnit;
  min?: number;
  max?: number;
};

export const SETTINGS: readonly SettingDef[] = [
  {
    key: 'minLeadDays',
    group: 'Booking',
    label: 'Notice needed to book online',
    help: 'How many days ahead a renter must book on the website. 1 means the earliest pickup is tomorrow, 0 allows today. The office can always book for today from the Board.',
    kind: 'int',
    unit: 'days',
    min: 0,
    max: 14,
  },
  {
    key: 'maxMonthsAhead',
    group: 'Booking',
    label: 'How far ahead people can book',
    help: 'The website shows dates up to this many months from now.',
    kind: 'int',
    unit: 'months',
    min: 1,
    max: 12,
  },
  {
    key: 'pickupSmsHour',
    group: 'Messages',
    label: 'Pickup day: first text (lockbox code)',
    help: 'On the pickup day, the renter gets the lockbox code by text at this time, yard time. If they are approved later in the day, it goes out straight away.',
    kind: 'int',
    unit: 'hour',
    min: 4,
    max: 12,
  },
  {
    key: 'pickupReminderHour',
    group: 'Messages',
    label: 'Pickup day: reminder',
    help: 'A second text at this time, only if the renter has not yet sent their pickup photos. Must be after the first text.',
    kind: 'int',
    unit: 'hour',
    min: 6,
    max: 16,
  },
  {
    key: 'noPickupCheckHour',
    group: 'Messages',
    label: 'Pickup day: final text',
    help: 'The last text, again only if the pickup photos are still missing. Must be after the reminder.',
    kind: 'int',
    unit: 'hour',
    min: 8,
    max: 18,
  },
  {
    key: 'pickupLastHour',
    group: 'Messages',
    label: 'Pickup day: stop texting after',
    help: 'No pickup text is sent after this time, so nobody is texted at night. Must be after the final text.',
    kind: 'int',
    unit: 'hour',
    min: 12,
    max: 21,
  },
  {
    key: 'returnSmsHour',
    group: 'Messages',
    label: 'Return day text',
    help: 'On the day the truck is due back, the renter gets the return instructions at this time.',
    kind: 'int',
    unit: 'hour',
    min: 4,
    max: 12,
  },
  {
    key: 'dailySweepHour',
    group: 'Messages',
    label: 'Daily check',
    help: 'Once a day the system nudges unsigned contracts, releases old unsigned ones, and flags overdue trucks. This is the time it does that.',
    kind: 'int',
    unit: 'hour',
    min: 5,
    max: 12,
  },
  {
    key: 'unsignedReleaseHours',
    group: 'Contracts',
    label: 'Release the truck if the renter never signs',
    help: 'If a renter has not signed the agreement this many hours after booking, the booking is cancelled so the truck is free for someone else. They are sent one reminder first, at the daily check after 24 hours. At least 48 so there is time to act on it. The renter is sent a message saying the truck was released.',
    kind: 'int',
    unit: 'hours',
    min: 48,
    max: 240,
  },
  {
    key: 'completedHideDays',
    group: 'Board',
    label: 'Keep finished rentals on the Board for',
    help: 'A Completed rental stays in the Completed column for this many days, then moves off the Board. Nothing is deleted: it stays in Past rentals.',
    kind: 'int',
    unit: 'days',
    min: 1,
    max: 365,
  },
  {
    key: 'storageDeletionEnabled',
    group: 'Storage',
    label: 'Allow the system to delete old files',
    help: 'Off means nothing is ever deleted automatically: not old licence photos, not abandoned uploads. Turn it on only if storage is getting full.',
    kind: 'bool',
  },
  {
    key: 'blobQuotaGb',
    group: 'Storage',
    label: 'Storage size you have',
    help: 'The size of your storage plan, so the warnings measure against the right number. Check it in Vercel under Storage.',
    kind: 'int',
    unit: 'gb',
    min: 1,
    max: 1000,
  },
  {
    key: 'purgeStartPct',
    group: 'Storage',
    label: 'Start deleting at (only if deleting is allowed)',
    help: 'When storage is this full and deleting is allowed, the oldest finished-rental photos are deleted until it is comfortably under.',
    kind: 'int',
    unit: 'percent',
    min: 75,
    max: 95,
  },
  {
    key: 'idDocsDays',
    group: 'Storage',
    label: 'Keep licence and insurance photos for',
    help: 'After a rental is completed, its licence and insurance photos become eligible for deletion after this many days. Only used if deleting is allowed. Signed contracts are never deleted.',
    kind: 'int',
    unit: 'days',
    min: 7,
    max: 365,
  },
  {
    key: 'checklistPhotoDays',
    group: 'Storage',
    label: 'Keep pickup and return photos for',
    help: 'Same idea for the truck photos. Only used if deleting is allowed.',
    kind: 'int',
    unit: 'days',
    min: 7,
    max: 730,
  },
  {
    key: 'pickupFuelGauge',
    group: 'Photos',
    label: 'Ask for a fuel gauge photo at pickup',
    help: 'Gives you proof of how much gas was in the truck when it left, to compare with the return photo. The renter always sends one at return.',
    kind: 'bool',
  },
  {
    key: 'exteriorPhotos',
    group: 'Photos',
    label: 'Ask for exterior photos',
    help: 'Asks the renter for photos of the outside of the truck at pickup and return.',
    kind: 'bool',
  },
] as const;

const BY_KEY = new Map<SettingKey, SettingDef>(SETTINGS.map((s) => [s.key, s]));

export function settingDef(key: SettingKey): SettingDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  return def;
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key as SettingKey);
}

export type Validated = { ok: true; value: number | boolean } | { ok: false; error: string };

const UNIT_NOUN: Record<SettingUnit, string> = {
  hour: 'an hour of the day',
  hours: 'hours',
  days: 'days',
  months: 'months',
  percent: '%',
  gb: 'GB',
};

/** A hand-typed or stored value, turned into the right type — or refused with a reason. */
export function validateSetting(key: SettingKey, raw: unknown): Validated {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, error: `Unknown setting: ${String(key)}` };

  if (def.kind === 'bool') {
    if (raw === true || raw === 'true' || raw === 'on' || raw === '1') return { ok: true, value: true };
    if (raw === false || raw === 'false' || raw === 'off' || raw === '0') return { ok: true, value: false };
    return { ok: false, error: `${def.label}: choose On or Off.` };
  }

  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^-?\d+$/.test(text)) {
    return { ok: false, error: `${def.label}: enter a whole number.` };
  }
  const n = Number(text);
  const min = def.min ?? Number.MIN_SAFE_INTEGER;
  const max = def.max ?? Number.MAX_SAFE_INTEGER;
  if (n < min || n > max) {
    return {
      ok: false,
      error: `${def.label}: must be between ${min} and ${max}${def.unit && def.unit !== 'hour' ? ` ${UNIT_NOUN[def.unit]}` : ''}.`,
    };
  }
  return { ok: true, value: n };
}

type Values = Partial<Record<SettingKey, number | boolean>>;

/**
 * Rules between settings. Each one alone can be in range and the pair still
 * make no sense — a reminder before the first text, a release before the
 * second nudge. Returns the first problem in plain English, or null.
 */
export function checkCombination(v: Values & { purgeTargetPct?: number }): string | null {
  const n = (k: SettingKey | 'purgeTargetPct') => (typeof v[k] === 'number' ? (v[k] as number) : undefined);

  const chain: Array<[SettingKey, string]> = [
    ['pickupSmsHour', 'the first pickup text'],
    ['pickupReminderHour', 'the pickup reminder'],
    ['noPickupCheckHour', 'the final pickup text'],
    ['pickupLastHour', 'the pickup cut-off'],
  ];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const [aKey, aName] = chain[i];
    const [bKey, bName] = chain[i + 1];
    const a = n(aKey);
    const b = n(bKey);
    if (a !== undefined && b !== undefined && b <= a) {
      return `${bName[0].toUpperCase()}${bName.slice(1)} must be after ${aName}.`;
    }
  }

  const start = n('purgeStartPct');
  const target = n('purgeTargetPct');
  if (start !== undefined && target !== undefined && target >= start) {
    return 'The level deleting stops at must be below the level it starts at.';
  }
  return null;
}

/** How a value reads on the page: "7 AM", "3 days", "72 hours (3 days)", "On". */
export function formatSetting(key: SettingKey, value: number | boolean): string {
  const def = settingDef(key);
  if (def.kind === 'bool') return value ? 'On' : 'Off';
  const n = Number(value);
  switch (def.unit) {
    case 'hour':
      return hourLabel(n);
    case 'hours':
      return n % 24 === 0 && n >= 24
        ? `${n} hours (${n / 24} day${n / 24 === 1 ? '' : 's'})`
        : `${n} hours (${(n / 24).toFixed(n % 12 === 0 ? 1 : 2).replace(/\.?0+$/, '')} days)`;
    case 'days':
      return `${n} day${n === 1 ? '' : 's'}`;
    case 'months':
      return `${n} month${n === 1 ? '' : 's'}`;
    case 'percent':
      return `${n}%`;
    case 'gb':
      return `${n} GB`;
    default:
      return String(n);
  }
}
