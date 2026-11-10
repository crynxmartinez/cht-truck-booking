import { BASELINE, config } from '@/lib/config';
import { ping } from '@/lib/ghl';
import { ping as gcalPing } from '@/lib/gcal';
import { blobAuthMode, blobConfigured } from '@/lib/storage';
import { earliestBookable, hourInOps, latestBookable, todayInOps } from '@/lib/dates';
import { TERMS_VERSION } from '@/lib/contract-terms';
import { SETTINGS, formatSetting } from '@/lib/settings-catalog';
import { isOverridden, override } from '@/lib/settings-store';
import { loadSettings, recentChanges } from '@/lib/settings';
import { hourLabel } from '@/lib/messages';
import { formatStamp } from '@/lib/dates';
import { SettingsEditor, type SettingRow } from './SettingsEditor';

export const dynamic = 'force-dynamic';

/** A single page that answers "is this thing actually wired up?" */
export default async function SettingsPage() {
  await loadSettings({ force: true });
  const history = await recentChanges(30);
  const rows: SettingRow[] = SETTINGS.map((def) => {
    const fallback = BASELINE[def.key];
    const current = override(def.key, fallback);
    const hours =
      def.unit === 'hour'
        ? Array.from({ length: (def.max ?? 0) - (def.min ?? 0) + 1 }, (_, i) => {
            const h = (def.min ?? 0) + i;
            return { value: String(h), label: hourLabel(h) };
          })
        : null;
    return {
      key: def.key,
      group: def.group,
      label: def.label,
      help: def.help,
      kind: def.kind,
      unit: def.unit ?? null,
      min: def.min ?? null,
      max: def.max ?? null,
      value: String(current),
      defaultValue: String(fallback),
      defaultLabel: formatSetting(def.key, fallback),
      hours,
      changed: isOverridden(def.key, fallback),
    };
  });

  const ghl = config.ghl.enabled ? await ping() : null;
  const gcal = config.gcal.enabled ? await gcalPing() : null;

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: 'Database',
      ok: true,
      detail: 'Connected — you are reading this page from it.',
    },
    {
      label: 'GoHighLevel',
      ok: Boolean(ghl?.ok),
      detail: !config.ghl.enabled
        ? 'No token or location id set. Emails and texts are being skipped.'
        : ghl?.ok
          ? `Connected to ${ghl.data.name ?? config.ghl.locationId}.`
          : `Reachable but rejected: ${ghl && !ghl.ok ? ghl.error : 'unknown error'}`,
    },
    {
      label: 'Blob storage',
      ok: blobConfigured(),
      detail:
        blobAuthMode() === 'oidc'
          ? 'Connected via OIDC (BLOB_STORE_ID). Uploads are stored privately as WebP. Note that OIDC only works on Vercel — for local development, pull a read-write token.'
          : blobAuthMode() === 'token'
            ? 'Connected via BLOB_READ_WRITE_TOKEN. Uploads are stored privately as WebP.'
            : 'Not connected. Connect a Blob store in Vercel, then redeploy so the deployment picks up BLOB_STORE_ID — uploads are refused until it does.',
    },
    {
      label: 'Office calendar',
      // Reading is not enough: a calendar shared as "See all event details"
      // answers this check happily and then refuses every write.
      ok: Boolean(gcal?.ok && (gcal.data.accessRole === 'writer' || gcal.data.accessRole === 'owner')),
      detail: !config.gcal.enabled
        ? 'Not connected. Set GOOGLE_CALENDAR_ID, GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY — bookings will not appear on the shared Google calendar until you do.'
        : !gcal?.ok
          ? `Configured but refused: ${gcal && !gcal.ok ? gcal.error : 'unknown error'}. Check the calendar is shared with ${config.gcal.clientEmail}.`
          : gcal.data.accessRole === 'writer' || gcal.data.accessRole === 'owner'
            ? `Writing to “${gcal.data.summary ?? config.gcal.calendarId}”. One event per rental day, 6 AM to 6 PM, colour-coded by truck.`
            : `Can see “${gcal.data.summary ?? config.gcal.calendarId}” but cannot write to it (access: ${gcal.data.accessRole ?? 'unknown'}). Re-share it with ${config.gcal.clientEmail} as "Make changes to events".`,
    },
    {
      label: 'Staff alerts',
      ok: config.staff.configured,
      detail: !config.staff.notifyEnabled
        ? 'Switched off — nobody is told when a rental moves. Set STAFF_NOTIFY_ENABLED.'
        : `${config.staff.name} · ${config.staff.email} · ${config.staff.phone}` +
          (config.staff.smsEnabled
            ? ' — email and SMS on every stage change.'
            : ' — email only. Overdue and reschedule still text.'),
    },
    {
      label: 'Cron secret',
      ok: Boolean(config.cronSecret),
      detail: config.cronSecret
        ? 'Set. The hourly tick is protected.'
        : 'Not set — anyone could trigger your 6 AM messages. Set CRON_SECRET.',
    },
    {
      label: 'Widget origins',
      ok: config.allowedOrigins.length > 0,
      detail: config.allowedOrigins.length
        ? config.allowedOrigins.join(', ')
        : 'ALLOWED_ORIGINS is empty — the GHL widget will be blocked by CORS.',
    },
    {
      label: 'Inbound webhook',
      ok: Boolean(config.ghl.webhookKey),
      detail: config.ghl.webhookKey
        ? 'Ready. Point a GHL "Customer Replied" workflow at /api/webhooks/ghl?key=…'
        : 'GHL_WEBHOOK_KEY not set — RESCHEDULE replies will not be picked up.',
    },
  ];

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
      </div>
      <div className="content">
        <div className="panel">
          <h2>Connections</h2>
          <div className="hint">Everything the system needs in order to run itself.</div>
          <div className="tablewrap">
            <table className="datatable">
              <tbody>
                {checks.map((c) => (
                  <tr key={c.label}>
                    <td style={{ width: 160 }}>
                      <b>{c.label}</b>
                    </td>
                    <td style={{ width: 90 }}>
                      <span className={c.ok ? 'tag green' : 'tag red'}>{c.ok ? 'OK' : 'Check'}</span>
                    </td>
                    <td className="tiny">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>Change how the system behaves</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            Change a value and press Save. Each one only accepts a sensible range, and the times must make sense
            together (the reminder after the first text, and so on). Every change is written to the history at the
            bottom of this page, and you can always put one back to the usual setting. Times are yard time,{' '}
            {config.timeZone.replace('_', ' ')}.
          </div>
        </div>

        <SettingsEditor rows={rows} />

        <div className="panel">
          <h2>Fixed rules</h2>
          <div className="hint">These are not changed from here, because changing them affects bookings already made.</div>
          <div className="tablewrap">
            <table className="datatable">
              <tbody>
                <tr>
                  <td>How a rental holds the truck</td>
                  <td>
                    From the pickup day, counting that day, for the length booked. The truck is free again the next day.
                    A customer chooses 1 to {config.customerMaxDays} days (set above); the office can book up to 30.
                    When nothing is chosen, {config.rentalBlockDays} days is the usual length.
                  </td>
                </tr>
                <tr>
                  <td>Booking window</td>
                  <td>
                    Today you can book {earliestBookable()} to {latestBookable()}
                  </td>
                </tr>
                <tr>
                  <td>Yard clock</td>
                  <td>
                    {config.timeZone} — right now it is {hourLabel(hourInOps())} on {todayInOps()}
                  </td>
                </tr>
                <tr>
                  <td>Toll clause</td>
                  <td>
                    <span className="tag green">Required</span>{' '}
                    <span className="tiny">renter must tick it before the signature is accepted</span>
                  </td>
                </tr>
                <tr>
                  <td>Fuel and dolly clauses</td>
                  <td>
                    <span className="tag green">Required</span>{' '}
                    <span className="tiny">
                      two more ticks the renter must give, added in contract version {TERMS_VERSION}. Agreements signed earlier do not
                      have them and are never changed. The wording is a draft until Diana or the attorney approves it.
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Contract version</td>
                  <td className="mono">{TERMS_VERSION}</td>
                </tr>
                <tr>
                  <td>Pickup address</td>
                  <td>{config.pickupAddress}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>Recent changes</h2>
          {history.length === 0 ? (
            <div className="hint" style={{ marginBottom: 0 }}>
              Nothing has been changed from this page yet.
            </div>
          ) : (
            <div className="tablewrap">
              <table className="datatable">
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td>{formatStamp(h.at)}</td>
                      <td>
                        <b>{h.label}</b>: {h.from} &rarr; {h.to}
                      </td>
                      <td className="tiny">{h.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Testing the clock</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            You can fire any scheduled job by hand rather than waiting for 6 AM:
            <br />
            <code>
              curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; &quot;{config.appUrl}
              /api/cron/tick?job=pickup&quot;
            </code>
            <br />
            Valid jobs: <code>pickup</code>, <code>return</code>, <code>nopickup</code>, <code>sweep</code>.
            Every send is idempotent, so running one twice will not double-message anybody.
          </div>
        </div>
      </div>
    </>
  );
}
