# v2db: the Firestore-backed virtual spreadsheet (built 2026-10-12)

## What it is, in plain words
`backend/v2db.js` is a stand-in for the Google Sheet. It has the same handful of operations the backend already uses (open a tab, read cells,
write cells, append a row, sort, delete a row ...), but each person's tabs are stored in THEIR OWN private Firestore folder. The app's existing,
tested logic runs on it unchanged. This is how Firestore becomes the real database without rewriting 8,700 lines (see
[../v2-firestore-native.md](../v2-firestore-native.md), "REVISED PLAN").

## How the data is stored
```
users/<email>/sheets/<tab>                 a marker (so tabs can be listed)
users/<email>/sheets/<tab>/pages/0000...   the rows as JSON text; page 0 also holds the page count and column count
```
A page holds up to 1,000 rows and 600,000 characters (Firestore's limit is about 1 MiB). Opening a tab is ONE read (more only for a huge tab).
Rows are JSON text so Firestore's "no nested arrays" and index limits never apply; Dates are stored as milliseconds and come back as real Dates.
Security rules already cover it (`users/<email>/{document=**}`: a person reads only their own folder, nobody writes from a phone).

## How a request uses it
`v2dbRun_(user, fn)` runs `fn` with `dbSs_()` returning that person's virtual spreadsheet. Changes happen in memory; at the end ALL changed tabs are
written in ONE all-or-nothing batch. If `fn` throws, OR the action's answer says `{ok:false}` (the app's own safety net turns errors into such answers), nothing is written. If someone else changed a tab in the meantime, the save is refused with a
plain "try again" message (an update-time check on page 0), never overwriting. Outside `v2dbRun_`, `dbSs_()` is the real Google Sheet, so
**nothing changes until something calls `v2dbRun_`** (nothing does yet).

## `dbSs_()`
Every backend file now asks `dbSs_()` instead of `SpreadsheetApp.getActiveSpreadsheet()` (101 places, mechanical). Left on the real Sheet on
purpose: `Logger.js` (maintenance tools and `logAI`) and `v2Sync.js` (the Sheet-to-Firestore mirror, which must read the real Sheet).
`appHealth.js` and the timer entry points also follow `dbSs_()`, so when a person is flipped, their timers must run inside `v2dbRun_` (not done yet).
The shared test kit and every test sandbox define `dbSs_` as the real spreadsheet.

## Sheet-like conversion (important)
Real Google Sheets treats text a script writes as if it were typed: "123" becomes the number 123, "2026-10-12" a date, "18:36" a time of day,
"TRUE" true. The backend relies on this (amounts, dates, SMS reference numbers), so `setValue` / `setValues` / `appendRow` convert the same way
(`v2dbCoerce_`; numbers longer than 15 digits and scientific notation stay text, never silently rounded). Date conversion uses
`Utilities.parseDate` in real Apps Script so old (1899) time-of-day values use the same time-zone rules the Sheet does. `v2dbImportTab_` (an exact
copy of a real tab) converts nothing. Sorting follows the Sheet: numbers/dates, then text, then true/false, blanks last.

## Not supported (on purpose)
`copyTo`, formatting calls, A1-notation ranges (`getRange("A1:B2")` throws loudly; the backend only uses row/column numbers), renaming a tab.


## Proof
- `backend/tests/v2db.test.js` (65 checks): 600 random operations compared cell-for-cell with a plain fake Sheet; sorting with blanks/dates/text both
  ways; everything (numbers, text, true/false, unicode, emoji, huge text, Dates to the millisecond) survives save and reopen; all-or-nothing; conflicts
  refused; pages; two people never see each other's data; malformed people refused. Mutation-checked.
- `backend/tests/v2dbParity.test.js` (73 checks, needs a Sheet backup in `local-data/backups`): the REAL backend actions run on a copy of the owner's
  real data twice (plain Sheet = answer key, and the virtual spreadsheet); every screen answer and the final contents of every tab are identical,
  including real saves (notes, Need/Want votes, not-a-transaction, cash, debts, part-payments, settle, investments, savings goals/splits).
  The clock is frozen so timestamps match. The "answer key" Sheet gets its own independent copy of the text-to-number/date conversion so the comparison is fair.

## What is NOT done yet (next steps)
1. Routing: `handlePwaRequest` choosing the engine per person (flag), a lock around writes, a retry on conflict.
2. Per-person settings / small state now kept in Script Properties (settings, bookmarks, push token, reminder markers) -> a per-person `_Props` tab.
3. Importing the owner's tabs inside Apps Script (cell-exact, real Dates) via `v2dbImportTab_`, then flipping, with an instant switch back.
4. The background timer, SMS landing and health check per person; Sheet backup export; new-person onboarding (empty template tabs).
5. The frontend: a "full app" mode for a non-owner whose engine is on.

## Independent review (2026-10-12): safe to push; fixed before activation
Fixed: text-to-number/date conversion (above); mixed-type sorting; a real HTTP 400 is no longer disguised as a "try again" conflict; a failed
({ok:false}) answer now saves nothing; pages are sized by bytes not characters; a missing tab is remembered per request; two tab names that would
collapse to one stored name are refused. Still true: no lock or retry yet (a conflict is reported, never overwritten); tabs that were only READ are not
version-checked; the Telegram-era `Analysis.js` chart code calls `deleteSheet`, which is not supported (dormant).

## LIVE RESULT in real Apps Script (v2dbSmokeTest, 2026-10-13 00:05, owner ran it)
- **Correctness: perfect.** All 14 tabs copied and re-opened cell-exact (including Dates to the millisecond); the Home dashboard, History, Debts, Investments and
  Pending screens gave IDENTICAL answers computed from the Sheet and from the Firestore-backed copy.
- **Speed: slower than the Sheet, not faster, as built.** Reading the whole Transactions tab: Sheet 406 ms vs copy 860 ms. Home dashboard: Sheet 5.2 s vs copy
  9.1 s. History(50): 4.6 s vs 6.7 s. Pending: 2.2 s vs 4.9 s. One save (read + change + write): 3.4 s. Cause: each tab is its own Firestore request (about
  0.4 to 0.9 s each) and the dashboard opens about 10 tabs one after another.
- **Planned fix before flipping anyone (NEXT):** open all the tabs a request needs in ONE `documents:batchGet` call (prefetch), keep opened tabs for the whole
  request, and avoid re-reading; expected to turn about 4 to 8 requests into 1. Re-run `v2dbSmokeTest` after that and flip only if it is no slower than the Sheet.
- The test copy lives at `users/v2db-smoketest@example.com/` (run `v2dbSmokeTestCleanup()` in the editor to delete it).
- Nothing is flipped; the owner's app still runs entirely on the Google Sheet.

## Speed fix: prefetch (2026-10-13)
`fsBatchGetPaths_` (firestore.js) reads many documents in ONE request (`documents:batchGet`); `V2Db_.prefetch(names)` opens several tabs at once
(a second batch only for tabs with extra pages), and `v2dbRun_(user, fn, { prefetch: [...] })` does it before the action runs. Without it every tab is its
own half-second request. `v2dbSmokeTest()` now uses it, so re-running it measures the real design. Tab lists per action will come with the routing step.

## LIVE RESULT #2 after prefetch (v2dbSmokeTest, 2026-10-13 08:57): ON PAR with the Sheet
All cells exact; all 5 screens identical. Times (Sheet vs virtual copy): Home dashboard 3.40 s vs 3.27 s; Pending 1.36 s vs 1.32 s; History(50) 3.91 s vs
4.24 s; Investments 0.75 s vs 1.24 s; Debts 0.16 s vs 1.83 s; read whole Transactions tab 0.57 s vs 0.91 s; one save 0.80 s (was 3.4 s).
Debts/Investments look slow only because the smoke test prefetches ALL 14 tabs even for a tiny screen (a fixed ~1.6 s batch): the routing step must
prefetch only the tabs each action needs. Decision: go ahead with per-person routing.
