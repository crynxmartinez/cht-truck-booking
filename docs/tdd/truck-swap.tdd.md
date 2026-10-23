# TDD evidence: swapping a booking onto the other truck

**Source:** no plan file; journeys derived in this run. The scope was set by
the user: "swap is available for accepted but the date is not yet arrived."

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
