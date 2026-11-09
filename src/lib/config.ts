/**
 * Every tunable in one place, read from the environment with sane fallbacks
 * so a missing variable degrades rather than crashes the booking page.
 */

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw == null) return fallback;
  return raw === 'true' || raw === '1';
}

function str(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

import { override } from './settings-store';
import type { SettingKey } from './settings-catalog';

const GIB = 1024 ** 3;
const envQuotaBytes = num('BLOB_QUOTA_BYTES', 1_073_741_824);

/**
 * What each office-editable setting is when nobody has changed it: the
 * environment variable if one is set, otherwise the built-in value. The
 * Settings page shows these as the default a reset goes back to.
 */
export const BASELINE = {
  minLeadDays: num('MIN_LEAD_DAYS', 1),
  maxMonthsAhead: num('MAX_MONTHS_AHEAD', 3),
  customerMaxDays: num('CUSTOMER_MAX_DAYS', 3),
  bufferDays: num('BUFFER_DAYS', 0),
  pickupSmsHour: num('PICKUP_SMS_HOUR', 6),
  pickupReminderHour: num('PICKUP_REMINDER_HOUR', 10),
  noPickupCheckHour: num('NO_PICKUP_CHECK_HOUR', 14),
  pickupLastHour: num('PICKUP_LAST_REMINDER_HOUR', 19),
  returnSmsHour: num('RETURN_SMS_HOUR', 7),
  dailySweepHour: num('DAILY_SWEEP_HOUR', 9),
  unsignedReleaseHours: num('UNSIGNED_RELEASE_HOURS', 72),
  completedHideDays: 14 as number,
  // Off unless somebody turns it on: nothing is deleted automatically.
  storageDeletionEnabled: false as boolean,
  blobQuotaGb: Math.max(1, Math.round(envQuotaBytes / GIB)),
  purgeStartPct: num('BLOB_PURGE_START_PCT', 80),
  idDocsDays: num('RETAIN_ID_DOCS_DAYS', 30),
  checklistPhotoDays: num('RETAIN_CHECKLIST_PHOTOS_DAYS', 90),
  pickupFuelGauge: bool('CHECKLIST_PICKUP_FUEL_GAUGE', false),
  exteriorPhotos: bool('CHECKLIST_EXTERIOR_PHOTOS', false),
} as const satisfies Record<SettingKey, number | boolean>;

export const config = {
  appUrl: str('NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),

  /** Truck is unavailable for this many calendar days starting on the pickup date. */
  rentalBlockDays: num('RENTAL_BLOCK_DAYS', 3),
  get minLeadDays() {
    return override('minLeadDays', BASELINE.minLeadDays);
  },
  get maxMonthsAhead() {
    return override('maxMonthsAhead', BASELINE.maxMonthsAhead);
  },
  /** The most days a customer can pick on the booking page. The office has its own, wider limit. */
  get customerMaxDays() {
    return override('customerMaxDays', BASELINE.customerMaxDays);
  },
  /** Empty days customers must leave around other rentals. 0 means back to back. */
  get bufferDays() {
    return override('bufferDays', BASELINE.bufferDays);
  },

  timeZone: str('OPS_TIMEZONE', 'America/Los_Angeles'),
  pickupAddress: str('PICKUP_ADDRESS', '25220 Hancock Ave, Murrieta, CA 92562'),

  get pickupSmsHour() {
    return override('pickupSmsHour', BASELINE.pickupSmsHour);
  },
  get returnSmsHour() {
    return override('returnSmsHour', BASELINE.returnSmsHour);
  },
  get noPickupCheckHour() {
    return override('noPickupCheckHour', BASELINE.noPickupCheckHour);
  },
  /** Second pickup message, sent only while the pickup checklist is outstanding. */
  get pickupReminderHour() {
    return override('pickupReminderHour', BASELINE.pickupReminderHour);
  },
  /** Pickup reminders stop after this hour. */
  get pickupLastHour() {
    return override('pickupLastHour', BASELINE.pickupLastHour);
  },
  get dailySweepHour() {
    return override('dailySweepHour', BASELINE.dailySweepHour);
  },

  /** Finished rentals leave the Board after this many days. They are never deleted. */
  get completedHideDays() {
    return override('completedHideDays', BASELINE.completedHideDays);
  },

  /** A truck held by an unsigned contract is released after this long. */
  get unsignedReleaseHours() {
    return override('unsignedReleaseHours', BASELINE.unsignedReleaseHours);
  },

  checklist: {
    get pickupFuelGauge() {
      return override('pickupFuelGauge', BASELINE.pickupFuelGauge);
    },
    get exteriorPhotos() {
      return override('exteriorPhotos', BASELINE.exteriorPhotos);
    },
  },

  retention: {
    get idDocsDays() {
      return override('idDocsDays', BASELINE.idDocsDays);
    },
    get checklistPhotoDays() {
      return override('checklistPhotoDays', BASELINE.checklistPhotoDays);
    },
  },

  blob: {
    /** The plan size, in bytes. An office-set size in GB wins over the environment. */
    get quotaBytes() {
      // -1 can never be a stored size, so it means "the office has not set one".
      const gb = override('blobQuotaGb', -1);
      return gb === -1 ? envQuotaBytes : gb * GIB;
    },
    /** Nothing is deleted automatically unless this is switched on. */
    get deletionEnabled() {
      return override('storageDeletionEnabled', BASELINE.storageDeletionEnabled);
    },
    get purgeStartPct() {
      return override('purgeStartPct', BASELINE.purgeStartPct);
    },
    purgeTargetPct: num('BLOB_PURGE_TARGET_PCT', 70),
  },

  ghl: {
    token: process.env.GHL_API_TOKEN || '',
    locationId: process.env.GHL_LOCATION_ID || '',
    base: str('GHL_API_BASE', 'https://services.leadconnectorhq.com'),
    version: str('GHL_API_VERSION', '2021-07-28'),
    webhookKey: process.env.GHL_WEBHOOK_KEY || '',
    get enabled() {
      return Boolean(process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID);
    },
  },

  /**
   * Diana's shared truck calendar, written to directly rather than through
   * GoHighLevel's sync — GHL routes to one Google calendar per *user*, not per
   * booking calendar, so it cannot tell Truck A from Truck B.
   */
  gcal: {
    calendarId: process.env.GOOGLE_CALENDAR_ID || '',
    clientEmail: process.env.GOOGLE_SA_EMAIL || '',
    // Vercel stores this on one line; the PEM needs its newlines back.
    privateKey: (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    get enabled() {
      return Boolean(
        process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY,
      );
    },
  },

  allowedOrigins: str('ALLOWED_ORIGINS', '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),

  cronSecret: process.env.CRON_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-session-secret',
  signingSalt: process.env.SIGNING_TOKEN_SALT || 'dev-only-salt',

  // Vercel caps a Serverless Function request body at 4.5 MB. Anything larger
  // is rejected by the platform before our handler runs, so the ceiling has to
  // sit under it. The browser downscales to WebP first, so a real photo lands
  // around 200 KB — this only bites the passthrough path (PDFs, HEIC that the
  // browser could not decode).
  maxUploadBytes: num('MAX_UPLOAD_BYTES', 4 * 1024 * 1024),

  company: {
    name: 'Cory Home Team',
    signerName: str('RENTAL_AUTHORITY_NAME', 'Diana Alsup Munoz'),
    signatureUrl: process.env.RENTAL_AUTHORITY_SIGNATURE_URL || '',
  },

  /**
   * Who gets told when a rental moves. Every customer-facing event fires a
   * short internal copy to this person as well.
   *
   * SMS can be switched off on its own: a busy month is roughly five texts per
   * rental, and the email carries the same information with more of it.
   */
  staff: {
    name: str('STAFF_NAME', 'Diana Alsup'),
    email: str('STAFF_EMAIL', 'diana@coryhometeam.com'),
    phone: str('STAFF_PHONE', '+15625568184'),
    /**
     * Where the office opens the board.
     *
     * This used to point at the GoHighLevel custom menu link, on the reasoning
     * that Diana works inside GHL. That link is dead on a phone — GHL's mobile
     * app does not render custom menu links at all — and alerts are mostly read
     * on a phone, so it was the one link in the email guaranteed to fail where
     * it mattered. The direct URL works in both places.
     */
    get boardUrl() {
      return str('STAFF_BOARD_URL', `${config.appUrl}/app`);
    },
    notifyEnabled: bool('STAFF_NOTIFY_ENABLED', true),
    smsEnabled: bool('STAFF_SMS_ENABLED', true),
    get configured() {
      return Boolean(this.notifyEnabled && this.email && this.phone);
    },
  },
} as const;

export type AppConfig = typeof config;
