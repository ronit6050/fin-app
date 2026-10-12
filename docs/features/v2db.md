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
written in ONE all-or-nothing batch. If `fn` throws, nothing is written. If someone else changed a tab in the meantime, the save is refused with a
plain "try again" message (an update-time check on page 0), never overwriting. Outside `v2dbRun_`, `dbSs_()` is the real Google Sheet, so
**nothing changes until something calls `v2dbRun_`** (nothing does yet).

## `dbSs_()`
Every backend file now asks `dbSs_()` instead of `SpreadsheetApp.getActiveSpreadsheet()` (101 places, mechanical). Left on the real Sheet on
purpose: `Logger.js` (maintenance tools and `logAI`) and `v2Sync.js` (the Sheet-to-Firestore mirror, which must read the real Sheet).
`appHealth.js` and the timer entry points also follow `dbSs_()`, so when a person is flipped, their timers must run inside `v2dbRun_` (not done yet).
The shared test kit and every test sandbox define `dbSs_` as the real spreadsheet.

## Not supported (on purpose)
`copyTo`, formatting calls, A1-notation ranges (`getRange("A1:B2")` throws loudly; the backend only uses row/column numbers), renaming a tab.
Writing "123" into a cell stores the text "123" (the real Sheet would turn it into a number); the app does not rely on that.

## Proof
- `backend/tests/v2db.test.js` (45 checks): 600 random operations compared cell-for-cell with a plain fake Sheet; sorting with blanks/dates/text both
  ways; everything (numbers, text, true/false, unicode, emoji, huge text, Dates to the millisecond) survives save and reopen; all-or-nothing; conflicts
  refused; pages; two people never see each other's data; malformed people refused. Mutation-checked.
- `backend/tests/v2dbParity.test.js` (73 checks, needs a Sheet backup in `local-data/backups`): the REAL backend actions run on a copy of the owner's
  real data twice (plain Sheet = answer key, and the virtual spreadsheet); every screen answer and the final contents of every tab are identical,
  including real saves (notes, Need/Want votes, not-a-transaction, cash, debts, part-payments, settle, investments, savings goals/splits).
  The clock is frozen so timestamps match.

## What is NOT done yet (next steps)
1. Routing: `handlePwaRequest` choosing the engine per person (flag), a lock around writes, a retry on conflict.
2. Per-person settings / small state now kept in Script Properties (settings, bookmarks, push token, reminder markers) -> a per-person `_Props` tab.
3. Importing the owner's tabs inside Apps Script (cell-exact, real Dates) via `v2dbImportTab_`, then flipping, with an instant switch back.
4. The background timer, SMS landing and health check per person; Sheet backup export; new-person onboarding (empty template tabs).
5. The frontend: a "full app" mode for a non-owner whose engine is on.
