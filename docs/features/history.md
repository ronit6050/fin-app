# History (edit past transactions)

**Status: live**, shipped 2026-08-08.

## What this is

Pending only ever shows transactions with no note yet — once noted, a
transaction disappears from view entirely, with no way to fix a typo or
a wrong category afterward short of editing the Sheet directly (which
breaks the "never touch Sheets" rule). History is the browse-and-edit
screen for everything Pending has already handled: a paginated,
newest-first list of already-noted transactions, each editable in place.

## Editing teaches the memory, same as a first correction

Confirmed with the user 2026-08-08: if you change a transaction's
category or Need/Want/Saving tag later in History, that correction
should update `SmartMemory`/`TypeMemory` exactly like correcting it the
first time in Pending would — not just fix that one row silently.

This is why History reuses `saveTransactionNote()` (the same function
`saveNote` already calls from Pending) instead of a separate "just edit
this row" function — `handleCategoryCorrection`/`recordTypeVote` firing
on every save is what makes edits and first-time corrections behave
identically, for free, without two code paths to keep in sync.

## What's editable

Note, category, and Need/Want/Saving tag — same fields Pending already
lets you set. Amount is also editable here (Pending doesn't offer this,
since the parsed amount is trusted there) — `saveTransactionNote` gained
an optional 6th `amount` parameter for this, writing it to column F only
when provided. Counterparty (merchant name) is **not** editable —
SmartMemory/TypeMemory are keyed by it, so changing it here would orphan
whatever memory was built under the old name; shown read-only for
context instead.

## Functions

- `getTransactionHistory(offset, limit)` (new, `PWA.js`) — opposite
  filter from `getPendingTransactions`: `Processed = "YES"` AND `Note`
  non-empty. Newest first, paginated (`offset`/`limit`, defaults to the
  first 20), returns `{ total, transactions }` so the UI knows whether
  there's more to load.
- `saveTransactionNote(row, note, category, counterparty, type, amount)`
  (modified) — `amount` is the new optional parameter; unrelated to this
  feature, `type` was already optional from the Need/Want/Saving work.
- New PWA action: `getTransactionHistory`. `saveNote` (existing action)
  now also passes `data.amount` through — no new save action needed,
  History reuses the exact same one Pending uses.

## UI

More → History. Paginated list (20 at a time, "Show More" to load
further), each item its own card with editable amount/note/category/
Need-Want-Saving fields and its own Save button — saves independently,
unlike Reconcile's bulk-approve pattern, since you're fixing one specific
past transaction at a time here.
