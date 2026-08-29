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

export const config = {
  appUrl: str('NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),

  /** Truck is unavailable for this many calendar days starting on the pickup date. */
  rentalBlockDays: num('RENTAL_BLOCK_DAYS', 3),
  minLeadDays: num('MIN_LEAD_DAYS', 1),
  maxMonthsAhead: num('MAX_MONTHS_AHEAD', 3),

  timeZone: str('OPS_TIMEZONE', 'America/Los_Angeles'),
  pickupAddress: str('PICKUP_ADDRESS', '25220 Hancock Ave, Murrieta, CA 92562'),

  pickupSmsHour: num('PICKUP_SMS_HOUR', 6),
  returnSmsHour: num('RETURN_SMS_HOUR', 7),
  noPickupCheckHour: num('NO_PICKUP_CHECK_HOUR', 14),
  dailySweepHour: num('DAILY_SWEEP_HOUR', 9),

  /** A truck held by an unsigned contract is released after this long. */
  unsignedReleaseHours: num('UNSIGNED_RELEASE_HOURS', 72),

  checklist: {
    pickupFuelGauge: bool('CHECKLIST_PICKUP_FUEL_GAUGE', false),
    exteriorPhotos: bool('CHECKLIST_EXTERIOR_PHOTOS', false),
  },

  retention: {
    idDocsDays: num('RETAIN_ID_DOCS_DAYS', 30),
    checklistPhotoDays: num('RETAIN_CHECKLIST_PHOTOS_DAYS', 90),
  },

  blob: {
    quotaBytes: num('BLOB_QUOTA_BYTES', 1_073_741_824),
    purgeStartPct: num('BLOB_PURGE_START_PCT', 80),
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
} as const;

export type AppConfig = typeof config;
