# Cory Home Team — Truck Rental System

Two trucks, booked from a GoHighLevel page, signed and photographed online, tracked
on an internal board. One Next.js app, one Postgres database, GoHighLevel as the
phone and mailbox.

---

## What's in here

| Path | What it is |
|---|---|
| `ghl/cht-booking-widget.html` | The booking widget. Paste into a GHL **Custom Code** element. |
| `src/app/sign/[token]` | Rental and additional-driver agreements, signed in the browser. |
| `src/app/checklist/[token]` | Pickup and drop-off checklists. One page, two modes. |
| `src/app/app` | The ops CRM — stage board, card modal, fleet, storage, settings. |
| `src/app/api/cron/tick` | The hourly clock that fires the 6 AM text and everything else. |
| `src/lib` | Availability, messaging, storage, PDF, contract text. |
| `prisma/schema.prisma` | The data model. |
| `docs/plan.html` | The full build plan. |

---

## Getting it running

### 1. Vercel

Import this repo, then **Settings → Environment Variables → Import .env** and drop in
`.env.vercel` (local, gitignored). `.env.example` is the committed template showing
which variables exist without the values.

### 2. Database

```bash
npm install
npx prisma db push
npm run seed
```

`seed` upserts Truck A and Truck B from the environment and creates the first admin
row. It is idempotent — safe to re-run.

> ### ⚠️ The CRM has no login
>
> Commit `9ab08df` removed the staff sign-in: `/app` renders for anyone who reaches
> it, and `/login` no longer exists. The `admin_users` row the seed creates is
> currently unused.
>
> Anyone with the URL can read every renter's name, email, phone, home address,
> licence number, date of birth and insurance policy number, open their uploaded
> licence and insurance photos, and read **both trucks' lockbox codes** on
> `/app/trucks`. That last one is physical access to the vehicles, not just data.
>
> Private blobs and signed file links (below) limit the blast radius — links expire
> and can be revoked — but they cannot substitute for the door being locked, because
> the CRM itself mints fresh links to anyone who loads it.
>
> Restoring it means putting back `getSession`/`createSession`/`verifyLogin` in
> `src/lib/auth.ts`, the `/login` page, and the redirect in `src/app/app/layout.tsx`.
> All three are intact in commit `37ce803`.

### 3. Blob storage

In Vercel: **Storage → Create → Blob → Connect to project**. `BLOB_READ_WRITE_TOKEN`
is injected automatically; you never set it by hand. Until it is connected, uploads
are refused with a message telling people to call you — everything else works.

Set `BLOB_QUOTA_BYTES` to whatever your plan actually includes, or the 80% cleanup
rule is measuring against the wrong number.

### 4. The widget

Open `ghl/cht-booking-widget.html`, set `data-api` to your deployed URL, and paste the
whole block into a GHL **Custom Code** element. Add that page's origin to
`ALLOWED_ORIGINS` or CORS will block it.

Scripts do not run in the GHL editor preview — always test on the published URL.

### 5. Inbound replies (optional)

The confirmation message invites people to reply RESCHEDULE. To catch it, add a GHL
workflow on **Customer Replied → Webhook**:

```
POST https://your-app.vercel.app/api/webhooks/ghl?key=YOUR_GHL_WEBHOOK_KEY
```

It badges the booking for review. It never cancels or moves a date on its own.

---

## How a rental flows

```
GHL widget → POST /api/public/bookings → truck auto-assigned under a row lock
  → contact upserted in GHL → contract link by email + SMS
  → renter signs at /sign/<token> → PDF generated → confirmation sent
  → 6:00 AM Pacific: lockbox code + pickup checklist
  → pickup checklist submitted → In Use
  → return day 7:00 AM: drop-off checklist
  → drop-off submitted → thank-you → Returned
  → office closes it (or auto after 48h) → Completed, retention clock starts
```

### The eight stages

`New Booking → Contract Sent → Additional Driver → Confirmed → Pickup Day → In Use →
Returned → Completed`, plus `Cancelled`. Overdue, reschedule-requested and
needs-review are badges rather than columns, so a stuck booking stays visible where
it is stuck.

---

## Booking rules

A booking blocks **one truck for `RENTAL_BLOCK_DAYS` (3) calendar days** from the
pickup date. Pickup Monday → renter has Monday and Tuesday → back Wednesday →
free again Thursday.

A date is offered while at least one active truck has no booking and no blackout
overlapping *the whole window starting there*. Booking a Monday when Tuesday is
already taken would strand the renter mid-rental, so those dates close too.

Two people submitting for the last truck in the same second is handled inside a
transaction that locks the truck rows first. One wins; the other gets a clean
"that date just went" rather than a double booking.

---

## The clock

Vercel schedules cron in UTC and California moves twice a year, so a fixed UTC hour
would drift the 6 AM text by an hour for half the year. Instead a single job runs
hourly, asks what time it is in Murrieta, and dispatches what is due.

| Local hour | Job |
|---|---|
| 06:00 | Pickup message — lockbox code + pickup checklist |
| 07:00 | Return-day message |
| 14:00 | "Did you get the truck OK?" if no pickup checklist |
| 09:00 | Contract nudges, unsigned release, overdue sweep, storage purge |

Fire any of them by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/tick?job=pickup"
```

Jobs: `pickup`, `return`, `nopickup`, `sweep`.

> **Hourly cron needs Vercel Pro.** The Hobby plan allows two cron jobs at daily
> granularity only. The free alternative is pointing an external scheduler
> (cron-job.org, or a GHL recurring workflow) at the same endpoint with the secret.

### Nothing gets sent twice

`MessageLog` has a unique index on `(bookingId, template, channel)` and the sender
claims that row *before* calling GoHighLevel. A cron that runs twice, or a retry
after a timeout, collides on the insert and quietly does nothing.

---

## Storage and retention

Photos are downscaled to 1600px and re-encoded as WebP in the browser, then again
server-side with sharp — an iPhone HEIC that the browser could not decode still
arrives normalised. A 4 MB phone photo lands around 180 KB.

**Everything is stored `access: 'private'`.** No uploaded file is fetchable by URL.
There are exactly two ways bytes reach a browser:

| Route | Who | Credential |
|---|---|---|
| `/api/files/<documentId>?e=&s=` | Staff, from the CRM | HMAC signature over id + expiry, valid one hour |
| `/api/files/contract/<token>` | The renter | Their own contract token — the same string that let them sign |

A public blob URL is permanent and unrevocable the moment it leaks into a forwarded
email, a screenshot or a browser history. These are driver's licences. The signed
staff links expire within the hour; the contract link deliberately does not, because
people come back to their own agreement months later.

Uploads are capped at 4 MB — Vercel rejects a Serverless Function request body over
4.5 MB before our handler runs. The browser converts to WebP *before* that check, so
a 12 MB phone photo is fine; only PDFs and images the browser cannot re-encode can
trip it.

A nightly job totals Blob usage. Over `BLOB_PURGE_START_PCT` (80%) it deletes the
oldest **eligible** files until back under `BLOB_PURGE_TARGET_PCT` (70%).

| Asset | Kept until |
|---|---|
| Signed contract PDFs | Never purged |
| Driver's licence, insurance | Completed + `RETAIN_ID_DOCS_DAYS` (30) |
| Checklist photos | Completed + `RETAIN_CHECKLIST_PHOTOS_DAYS` (90) |
| Anything on an open, overdue or flagged booking | Untouchable |

The retention clock only starts when a booking reaches **Completed**, so photos are
never purged while a damage claim is open.

---

## Contracts

`src/lib/contract-terms.ts` holds the legal text transcribed from the source PDFs:
the 13-clause Rental Agreement and the 13-section Waiver & Release. Truck A and
Truck B share one template — only the truck block differs — and the Additional
Driver Agreement reuses the same terms with its own data page.

Signing is disabled until the reader scrolls to the end. Each signature stores the
signer's name, the drawn or typed image, their IP, user agent, timestamp,
`TERMS_VERSION` and a SHA-256 of the exact wording shown. Bump `TERMS_VERSION`
whenever a single word changes.

> **For review:** clause 13(a) of the Rental Agreement specifies **Texas** law while
> clause 12 of the Waiver bound behind it specifies **California** law, venue in
> Riverside County. Both are in the same signed packet. This is carried over from the
> source documents as-is and should be settled with counsel.

---

## Checklists

One page, two modes, decided by the token.

| Screen | Pickup | Drop-off |
|---|---|---|
| Intro | Truck Pickup Checklist | Truck Return Checklist |
| Basic info | Time Picked Up | Time Returned |
| Lockbox | Getting keys out | Putting keys back |
| Cargo photos | required | required |
| Exterior photos | `CHECKLIST_EXTERIOR_PHOTOS` | `CHECKLIST_EXTERIOR_PHOTOS` |
| Fuel gauge | `CHECKLIST_PICKUP_FUEL_GAUGE` | required |
| Submit | → In Use | → Returned, thank-you fires |

Both flags default off, matching the original forms. Two reasons to turn them on:

- **Pickup fuel gauge** — the contract says "return the gas level to the way it was
  received". Without a pickup baseline that clause is unenforceable.
- **Exterior photos** — the renter carries a $2,500 deductible. Cargo-space-only
  photos cannot prove a dent was already there.

Progress autosaves as people type, so losing signal mid-upload does not cost them
the form.

---

## Local development

```bash
cp .env.vercel .env          # then point NEXT_PUBLIC_APP_URL at localhost:3000
npm install
npx prisma db push
npm run seed
npm run dev
```

Helper scripts (dev only, never run against production data you care about):

```bash
npx tsx scripts/dev-seed-booking.ts            # full test booking + all links
npx tsx scripts/dev-seed-booking.ts 2026-09-14 # on a specific date
npx tsx scripts/dev-inspect.ts                 # dump the latest test booking's state
npx tsx scripts/dev-clean.ts                   # delete every CHT-TEST booking
```

`dev-seed-booking` stubs the uploaded documents, so you can click through signing,
both checklists and the CRM before Blob is connected.

---

## Checks

```bash
npm run typecheck
npm run build
```

The CRM's **Settings** page reports whether the database, GoHighLevel, Blob, the cron
secret, the widget origins and the inbound webhook are all actually wired up.
