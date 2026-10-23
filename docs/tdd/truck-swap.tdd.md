# TDD evidence: swapping a booking onto the other truck

**Source:** no plan file; journeys derived in this run.

**Rule, revised once.** First built as the user asked: "available for accepted
but the date is not yet arrived." That blocked the three bookings that
actually needed moving (all waiting on the main admin's counter-signature,
Truck A being out of service). The user then said: nothing changes except the
truck, available before the booking period, and "move jose too" (pickup that
day). The rule is now: any booking not yet collected, with a pickup date that
has not passed, and on the pickup day itself only while the lockbox code has
not been queued or sent. The code is the real hazard — it differs per truck.

## Journeys

1. As the office, I can move an accepted booking to the other truck while its
   pickup date is still ahead, so a truck going out of service does not
   cancel a rental.
2. As the office, I cannot move a booking whose renter may already hold the
   other truck's lockbox code, or already has the truck.
3. As a renter, I am told my truck changed, so I am not surprised on the day.
4. As Diana, I am told, and the log records that the signed agreement still
   names the previous truck's plate.

## Test specification

| # | Guaranteed | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | An accepted booking with a future pickup can move to another active truck | `truck-swap.test.ts` "allows an accepted booking…" | unit | PASS |
| 2 | Pickup day, or any earlier date, is refused | "refuses once pickup day has arrived", "…in the past" | unit | PASS |
| 3 | Every stage except Confirmed is refused (9 stages) | "refuses a booking that is %s" | unit | PASS |
| 4 | Moving onto the truck it is already on is refused | "refuses moving onto the truck it is already on" | unit | PASS |
| 5 | A switched-off truck is refused and named | "refuses a truck that is switched off" | unit | PASS |
| 6 | The same guard runs inside the locked transaction, not only behind the button | `availability.test.ts` "reassignTruck" | unit (mocked db) | PASS |
| 7 | A clash, a blackout, or an unknown truck still refuses and writes nothing | same | unit (mocked db) | PASS |
| 8 | The update reports which truck the booking came from | "says where it came from" | unit (mocked db) | PASS |
| 9 | Renter message names the new truck, says dates are unchanged, and does not send a code early | `messages.test.ts` "truck_changed" | unit | PASS |
| 10 | Staff alert leads with name and truck and warns about the signed contract | `staff-messages.test.ts` | unit | PASS |

## RED / GREEN

- RED: stub that allowed everything — 30 tests failed on assertions.
- GREEN 1: 91 of 91 pass across the project.
- Code review (ECC `code-reviewer`): no critical or high findings. Three real
  mediums were fixed, each checked against the code first:
  - a swap could commit just after a concurrent cancel — the booking row is now
    locked before it is read;
  - Diana's alert had no force option, so a second legitimate swap (or
    reschedule) was silently never alerted — added, and used for both;
  - the "has been told" toast was unconditional and notify() reports failure in
    its result rather than throwing — the toast now says "are being told" and a
    failed send is logged.
  Also fixed: the hard-coded "6 AM" in the renter copy now follows the
  configured pickup hour, and the renter is told the signed agreement was
  issued for the earlier truck.
- GREEN 2: 109 of 109 pass.

## Coverage

`npm run test:coverage`, scoped to the three rule modules: 98.7% statements,
98.8% branches, 85.7% functions. `truck-swap.ts` is at 100%.

## Known gaps

- The booking-window button and `swapOptionsFor` (src/app/app/detail.ts) are
  verified by typecheck and build only. With Truck B switched off there is no
  second truck to exercise the screen against without changing live data.
- `switchTruck` is tested with its collaborators mocked (refusals, forced
  messages, failure logging); it is not run against a real database.
- Not reproduced: the cancel race itself. Its fix (the booking-row lock) is
  asserted by call order, not by two real concurrent transactions.
- The signed contract PDF is not regenerated. That is deliberate and recorded
  in the activity log; the attorney question about a "comparable vehicle"
  clause is unresolved.

## Revision tests (rule widened)

- `truck-swap.test.ts`: all five pre-pickup stages allowed; started/finished
  stages refused; a past date refused; pickup-today allowed until the code is
  out, then refused; the code is irrelevant for a future pickup.
- `availability.test.ts`: the same at the data layer, including that only a
  QUEUED or SENT code counts (a failed one does not block), and yard-midnight.
- `messages.test.ts`: the "your signed agreement was issued for the earlier
  truck" line appears only when the renter has actually signed.
- 118 of 118 pass.

## Hardening pass (24 Oct 2026)

Done after the three live bookings were moved, working from raw records rather
than from the code's own statements.

### What the raw records showed

- **Message text, read from `MessageLog.body`** (not just `status = SENT`):
  a swap on the pickup day itself told the renter "you will still get a text at
  6 AM on the day" at 8 AM. The code did arrive 11 minutes later, but the
  promise was false. The text message also printed a raw date (`2026-10-23`).
  Both fixed and tested.
- **Delivery, read back from GoHighLevel:** all four texts `delivered`; the
  emails `delivered`, two `opened` by the renters.
- **Signed PDFs, text extracted:** all three print Truck A's plate (764302D)
  while the bookings sit on Truck B (705921E). Expected, and now confirmed on
  the documents themselves. My first draft of the preview tool claimed the PDF
  prints the *current* truck's plate; reading the real PDFs showed that was
  wrong, and the tool's wording was corrected.
- **Google Calendar, read back:** 12 events, each correct, no orphans.

### A hole the swap work exposed

`moveStage` and `reopen` never checked for overlap, so reopening a cancelled
booking onto a truck since booked by someone else silently double-booked it.

### What was added

| Piece | Evidence |
|---|---|
| Postgres exclusion constraint `bookings_no_overlap` on the live table | Rehearsed in a rolled-back transaction, then installed; re-run is a no-op |
| Same constraint exercised with **two real connections** on a throwaway table | `npm run guard:verify` — 11 of 11: a second writer waits, is refused once the first commits, succeeds if the first rolls back |
| Constraint exercised on the **real** `bookings` table, rolled back | An overlapping move is refused; adjacent days, the other truck, and an ordinary stage change are all allowed; real rows unchanged |
| A refused write becomes a plain message, not a crash | `availability.test.ts`, `bookings.test.ts`, `actions.test.ts` |
| Property tests (fast-check, up to 2000 random cases each) | The swap rule equals an independent statement of it; a simulated day of hourly ticks for **every** approval hour never sends more than 3 messages, never twice, never after collection, code first and exactly once; overlap detection equals brute force |
| `npm run check:invariants`, read-only, against live data | 6 of 6 pass: every booking has a truck, no overlaps, nothing upcoming on an off truck, no message carries the wrong lockbox code, calendar matches bookings (12 events read back), guard installed |
| `npm run swap:preview` | Shows what a swap would send, say and change; verified to change nothing (message and event counts identical before and after) |

### Totals

172 tests. Coverage on the five rule modules: 99.1% statements, 99.2%
branches, 90.9% functions; `truck-swap`, `invariants` and `overlap-guard` at 100%.

### Not done, and why

- A **browser end-to-end test** of the booking-window button against a preview
  deployment. The live app was driven by hand for the real moves, not by a
  repeatable test.
- The signed PDF is still not regenerated, and no addendum is generated. The
  contract wording ("or a comparable vehicle") is an attorney decision.
- Prisma does not know about the constraint. `prisma db push` is not part of
  the build, but if someone runs it, check `npm run check:invariants` afterwards;
  `npm run guard:apply -- --apply` reinstalls it safely.

### Review of the hardening (ECC `code-reviewer`) and what it fixed

No critical or high findings. Verified against the code, then fixed:

- `approveContract` never checked the booking's stage, so counter-signing a
  signed agreement on a **cancelled** booking would quietly bring it back as
  Confirmed (an old bug, not one the guard introduced). Now refused, tested.
- `completeChecklist` refused cancelled but not **completed** bookings, so a
  late submission could drag a closed booking back to Returned/In use, and
  would fail after the checklist was already marked submitted. Now refused
  up front, in the library and the route, tested.
- The invariant checker's Google time window was only correct for timezones
  west of Greenwich; it is now wide on both sides. Finished bookings' calendar
  events are kept as history, so they are no longer reported as strays; and a
  confirmed booking left "tentative" on Google is now caught.
- The audit's list of holding stages is now the guard's own list, and the
  overlap property test draws all ten stages.

Final totals: 185 tests; 99.1% statements and 99.2% branches on the rule modules.
