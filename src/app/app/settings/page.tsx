import { config } from '@/lib/config';
import { ping } from '@/lib/ghl';
import { blobAuthMode, blobConfigured } from '@/lib/storage';
import { earliestBookable, hourInOps, latestBookable, todayInOps } from '@/lib/dates';
import { TERMS_VERSION } from '@/lib/contract-terms';

export const dynamic = 'force-dynamic';

/** A single page that answers "is this thing actually wired up?" */
export default async function SettingsPage() {
  const ghl = config.ghl.enabled ? await ping() : null;

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
          <h2>Operating rules</h2>
          <div className="hint">
            Changed through environment variables in Vercel, then redeploy. Nothing here is edited in the app,
            so a mis-click can never change how the calendar behaves.
          </div>
          <div className="tablewrap">
            <table className="datatable">
              <tbody>
                <tr>
                  <td>Block length</td>
                  <td>
                    {config.rentalBlockDays} days from pickup <span className="tiny">RENTAL_BLOCK_DAYS</span>
                  </td>
                </tr>
                <tr>
                  <td>Booking window</td>
                  <td>
                    {earliestBookable()} to {latestBookable()}{' '}
                    <span className="tiny">MIN_LEAD_DAYS / MAX_MONTHS_AHEAD</span>
                  </td>
                </tr>
                <tr>
                  <td>Yard clock</td>
                  <td>
                    {config.timeZone} — right now it is {String(hourInOps()).padStart(2, '0')}:00 on{' '}
                    {todayInOps()}
                  </td>
                </tr>
                <tr>
                  <td>Pickup message</td>
                  <td>{String(config.pickupSmsHour).padStart(2, '0')}:00 local on the pickup day</td>
                </tr>
                <tr>
                  <td>Return message</td>
                  <td>{String(config.returnSmsHour).padStart(2, '0')}:00 local on the return day</td>
                </tr>
                <tr>
                  <td>Unsigned release</td>
                  <td>{config.unsignedReleaseHours} hours</td>
                </tr>
                <tr>
                  <td>Pickup fuel gauge</td>
                  <td>
                    <span className={config.checklist.pickupFuelGauge ? 'tag green' : 'tag'}>
                      {config.checklist.pickupFuelGauge ? 'On' : 'Off'}
                    </span>{' '}
                    <span className="tiny">CHECKLIST_PICKUP_FUEL_GAUGE</span>
                  </td>
                </tr>
                <tr>
                  <td>Exterior photos</td>
                  <td>
                    <span className={config.checklist.exteriorPhotos ? 'tag green' : 'tag'}>
                      {config.checklist.exteriorPhotos ? 'On' : 'Off'}
                    </span>{' '}
                    <span className="tiny">CHECKLIST_EXTERIOR_PHOTOS</span>
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
