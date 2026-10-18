# Home + Pending makeover (backend part, 2026-10-18)

Plain words: the Home and Pending screens get a few new facts from the server, so the app can show a
"one tap to confirm" button, warn about a possible double-text, and show a small "how is today going" panel.
Nothing here changes any money total. Not deployed yet (no clasp push/deploy done).

## Home: `getDashboardData().homeExtra`  (null if it could not be worked out)

```
homeExtra: {
  todayCount:    number,            // payments counted in today's spend (bank rows + cash rows, same rows as todaySpend)
  usualDay:      number | null,     // average spend per day over the 28 completed days before today (empty days count as 0);
                                    // null if the account has less than 7 days of history before today
  last7:         [ {label:"Mon", date:"YYYY-MM-DD", amount}, ... 7 items, oldest first, last = today ] | null,
  prevSamePoint: number | null,     // last month's spend from day 1 to today's day-of-month; null if last month had no spend
  watch:         [ {category, target, actual}, ... up to 3 ]   // saved Planner targets for this month with actual/target >= 0.85,
                                                              // highest ratio first; [] if none or no saved targets
}
```

- Where the numbers come from: today = `getTodaySummary` (so its exclusions apply: card-bill payments, wallet top-ups, loans,
  Rent/EMI/SIP), other days = the `detail.daily` list that `getMonthlyAnalysis` already computes. Nothing is re-implemented.
- Cost: no extra sheet reads except one small read of the `Budgets` sheet (it is NOT created if missing), plus one extra
  `getMonthlyAnalysis(prevYear, prevMonth, ..., {skipSaved:true})` call for last month (needed for usualDay, last7 near the
  start of a month, and prevSamePoint). Each piece is wrapped separately: a failure gives null / [] for that piece, and the
  whole field is null if everything fails. The dashboard never breaks because of it.
- Split categories use target = Need + Want. Pseudo rows starting with `_` (income, fixed obligations) are ignored.
- `getTodaySummary` also returns a new `cashCount` (number of cash payments today).
- Time zone: "today" is the India date from `Session.getScriptTimeZone()` (the Cloud Functions shim says Asia/Kolkata too).
  Caveat (old, same as the Analysis screen): the per-day split inside `getMonthlyAnalysis` uses the server's own clock for the
  day-of-month of each row, so if a server ran in UTC a late-night India payment could land on the neighbouring day in
  `last7`/`usualDay`. The Apps Script server runs in India time so this does not happen today.

## Pending: new fields on every item (also in `getDashboardData().full.pending`)

```
ready:       boolean   // true ONLY when a one-tap confirm is safe
readyWhy:    string    // "" when not ready; "Same as the last N times" (N = the real count in NoteMemory, 2 or more)
                       // otherwise "Same note and type as last time" (credit: "Same note as last time")
duplicateOf: null | { row: number, minutesApart: number }   // minutesApart is a whole number
```

`ready` is true when ALL of these hold (otherwise false; when unsure, false):
- no `duplicateOf`;
- `suggestedNote` is non-empty (from note memory) and `suggestedCategory` is a real category (not empty, not "Other");
- debit: `suggestedType` present OR `isNonSpendTransfer`; not `investmentInstrumentLooksNew`; and if there is a
  `suggestedFinancialEvent` it must be `financialEventConfident` (and for EMI / Investment it must also have a name);
- credit: just the note + category rule above.

`duplicateOf`: another real row with the same type, same amount and same payee (capitals/extra spaces ignored; if both have no
payee, same mode and same bank) within 10 minutes (date + time columns, minute precision). The closest one wins. Rows marked
IGNORED, empty placeholder rows and the row itself are skipped. Rows are grouped by type+amount first, so 1000 rows x 10 pending
takes a few milliseconds.

The stale-card fingerprint (`rowFingerprint_`) is built only from the sheet row, so these fields cannot change it
(a test proves it).

## Files changed
- `backend/PWA.js`: `getDashboardData` (+`buildHomeExtra_`), `getTodaySummary` (+`cashCount`), `getPendingTransactions`
  (+`buildPendingDupIndex_`, `findPendingDuplicate_`, `computePendingReady_`, `pendingRowMinutes_`).
- `backend/noteMemory.js`: new `getSuggestedNoteInfo` (same rule as `getSuggestedNote`, also returns the real use count;
  `getSuggestedNote` now calls it, behaviour unchanged).
- Test: `backend/tests/homePendingMakeover.test.js`.

Other places that list pending items (`runway.js`, `viewPublisher.js`, `dailySummary.js`, `functions/`) only read the older fields
and are unaffected; the full backend suite passes. `functions/backend` is a generated copy and picks the change up at the next
copy/deploy.
