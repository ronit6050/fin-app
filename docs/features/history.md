# History (edit past transactions)

**Status: live**, shipped 2026-08-08.

**Fixed 2026-08-09 — real bug, not cosmetic:** History was showing a
freshly re-computed Need/Want/Saving/Investment *guess* for each
transaction, not what was actually chosen for that specific row —
because the chosen type was never durably saved anywhere, only fed into
`TypeVotes` as one more vote in a shared per-merchant pool. User noticed
old "Want" answers displaying as "Need" once later answers for the same
merchant tipped that pool's balance. Fixed by adding a `NeedWantSaving`
column (Q) to `Transactions`, written by `saveTransactionNote` alongside
the vote, and read back by `getTransactionHistory` instead of calling
`getSuggestedType` at all. Rows saved before this fix have nothing
stored — shown with no type pre-selected (deliberately not guessed)
until you next save/re-save that row. See
[docs/features/need-want-saving.md](docs/features/need-want-saving.md)
for the column and full reasoning.

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
should update `SmartMemory`/`TypeVotes` exactly like correcting it the
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

## Search, filters, month jump and short rows (built 2026-10-14, NOT deployed)
Why: History was one tall edit card per payment, 20 at a time, with no search; a Rent/EMI/Investment payment could only be found by scrolling, and nothing listed the ones still waiting to be confirmed.

**Backend** (`getTransactionHistory(offset, limit, opts)` in `backend/PWA.js`, router passes `filter`, `query`, `month`): the filtering runs BEFORE the page is cut, so the total, "Show more" and counts are right. Called with no options it behaves exactly as before.
- `filter`: `all` | `attn` (unconfirmed payment the app suspects is Rent/EMI/Investment, from the same `suggestFinancialEvent` the card uses; never a CC bill payment or wallet top-up) | `Rent` | `EMI` | `Investment` (CONFIRMED, from column R) | `credit` | `split` (FriendShare > 0).
- `query`: case-insensitive, matches note, payee, category, event name, mode, and the amount ("4000", "4,000", "₹4000"). Clipped to 80 characters.
- `month`: `yyyy-MM`.
- Extra answer fields: `counts` (per chip, always for the whole list), `months` (newest first, with counts, for the picker), `summaries` (for Rent/EMI/Investment only: one line per event name with payments, total and last paid date; a friend's share is not counted).
- Read-only. Test: `backend/tests/historyFilters.test.js` (46 checks; mutation-checked).

**Screen** (`index.html`, `view-history`): search box, filter chips (counts on them; "Needs attention" count in the warning colour), month picker, per-name summary card, month headings, and one short row per payment with a tag (green = confirmed Rent / "Laptop EMI"; yellow = "Looks like EMI, confirm?"). Tapping a row opens the same full edit card as before (built only on first open). Saving a card updates its row tag at once and refreshes the chip counts. A slow answer for a view you already left is ignored (`historyRequestId`). Demo Mode mirrors all of it (`demoComputeHistory`), including one unconfirmed EMI so "Needs attention" can be tried.

**The two limits found at first, both solved the same day (2026-10-14):**
1. *Payments with no note yet.* History itself still lists only noted payments, but **Needs attention** now ALSO lists payments still in Pending that look like Rent/EMI/Investment (debits only; never a CC bill payment or wallet top-up). They are flagged `unnoted: true`, show "Not noted yet · looks like Rent" and "finish it in Pending", and tapping one opens the Pending tab (the note, category and Rent/EMI/SIP choice all live there). They count in the chip, never appear in All or the other chips.
2. *"No, regular spend" is now remembered.* The button sets `eventDeclined` on the save (History and Pending both send it); the backend writes `YES` in Transactions **column V "EventDeclined"** (header added automatically; see SHEET_SCHEMA.md). A declined payment is no longer suggested as Rent/EMI/Investment, no longer counted under Needs attention, and its yellow tag disappears. Confirming an event later clears the marker. Only an explicit tap on "No, regular spend" counts: saving with nothing selected remembers nothing.
Tests: `historyFilters.test.js` sections 10-12.

**Still true:** a card you declined has no way to be re-opened as an event from History (there is no "Mark as..." link in History, only in Pending); and a declined row stays visible in the open list until the list next reloads (the chip numbers update at once).
