# TDD evidence: pickup-day messages

**Source:** no plan file; journeys derived in this run.

## Journeys

1. As a renter approved after 6 AM on my pickup day, I want my lockbox code
   straight away, so I am not stranded at a locked truck. (Ryan Tripp, Oct 9:
   approved 10:06 AM, 6 AM job skipped him, no code ever sent.)
2. As a renter who has not collected the truck, I want the code repeated twice
   later in the day, so a missed message does not cost me the rental.
3. As a renter who already has the truck, I do not want to be nagged.
4. As the office, I do not want one failed send to double-text anyone, or to
   stop the other jobs.

## Test specification

| # | Guaranteed | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | Code is sent from 6 AM, and at any later hour for a late approval | `pickup-schedule.test.ts` "the code itself" | unit | PASS |
| 2 | Not before 6 AM, not for another day, not for unapproved or finished bookings | same | unit | PASS |
| 3 | Reminder 10 AM and final check 2 PM only while the checklist is outstanding | "the reminders" | unit | PASS |
| 4 | Three hours between messages (10 min send-latency tolerance), nothing after 7 PM | "a late approver is not buried", "edges found in review" | unit | PASS |
| 5 | Reminder and final copy repeat the code and checklist link and say to disregard if already collected | `messages.test.ts` | unit | PASS |
| 6 | A failed channel is retried on its own; a sent one is never resent | `pickup-release.test.ts` "retries only the channel that failed" | unit (mocked db) | PASS |
| 7 | A row still being sent by another caller is left alone | "leaves a message alone while another caller is still sending" | unit (mocked db) | PASS |
| 8 | Only the caller that wins the compare-and-set resends a failed row | "does not resend if another caller claimed the failed row first" | unit (mocked db) | PASS |
| 9 | Stage stays Confirmed on a real failure (retried next hour); advances when skipped with no error | "leaves the booking on Confirmed…", "still advances when every channel was skipped…" | unit (mocked db) | PASS |

## RED / GREEN

- RED 1: stub returning `null` — 13 of 25 failed on assertions (`npm test`).
- GREEN 1: 25 of 25 pass.
- Code review (ECC `code-reviewer`) found a double-send race in the retry path,
  a missing reschedule clear, an unprotected cron loop, and send-latency drift.
  Each was verified against the code before acting.
- RED 2: 12 of 53 failed against the first implementation.
- GREEN 2: 53 of 53 pass.

## Coverage

`npm run test:coverage`, scoped to the two pickup modules: 98.4% statements,
98.5% branches, 80% functions. Uncovered: `yardClock` (a one-line wrapper).
Whole-repo coverage is not claimed; the project had no tests before this.

## Known gaps

- `notify()` itself is mocked, so the real force path against Postgres is not
  exercised by a test. The compare-and-set in `sendDuePickupMessage` is what
  guards it.
- A send killed mid-flight leaves a `QUEUED` row. It is deliberately not
  auto-retried (resending a row that may have gone out is how people get double
  texts); the office sees it in the booking's message table and can Resend.
- The approval hook and the cron wiring are verified by typecheck and build,
  not by an integration test.
