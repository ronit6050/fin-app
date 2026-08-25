# Bank / credit card statement reconciliation

**Status: live**, shipped 2026-08-08 (bank), extended 2026-08-25 (credit card).

## What this feature is

Tasker reads bank SMS and writes rows into `Transactions` automatically —
but SMS can be missed (deleted before Tasker reads it, a silent parsing
failure, etc.), so transactions can go missing without anyone noticing.
Reconciliation closes that gap: you upload your real bank statement (an
`.xls` export), the app compares it against what's actually in
`Transactions`, and shows you two things to review and approve — nothing
is ever written automatically:

1. **Missing transactions** — Tasker never caught these at all. Rare in
   practice (Tasker generally works), pre-filled with note/category/
   Need-Want-Saving guesses, approving inserts a new row.
2. **Notes found for existing transactions** — Tasker *did* catch these,
   but they have no note yet, because bank SMS text never carries the
   UPI note — only the statement does. This turned out to be the bigger
   of the two in practice; approving updates the existing row (reuses the
   same `saveNote` action Pending already calls, no new backend action
   needed for this part).

**Nothing is ever written automatically.** This is a review-and-approve
flow, not a mass-update. Confirmed with the user 2026-08-08 after an
earlier design considered silently bulk-inserting — rejected in favor of
per-transaction approval, matching how Pending already works.

## Why the Need/Want/Saving tag has to be offered here too

A transaction only shows up in Pending if it has **no note yet**.
Reconciliation writes a note (the one recovered from the bank statement)
at the same time it inserts the transaction — so a reconciled transaction
will never appear in Pending afterward. If Need/Want/Saving weren't also
offered on the reconciliation screen itself, those transactions would
permanently never get tagged, no matter how long the app runs. So the
same optional, pre-filled, one-tap Need/Want/Saving control from Pending
is reused here — never required, but always available.

## Where the automatic note comes from — the real pattern

Confirmed against a real HDFC `.xls` statement (2026-08-08). UPI
narrations look like:

`UPI-NEELADRI VEGETABLE A-PAYTM.S26HQVN@PTY-YESB0MCHUPI-618368197341-MILK`

Dash-separated segments: `UPI` / merchant name / UPI handle / bank code /
reference number / **the note you typed while paying**. That last segment
is a genuine personal note (`MILK`, `TEA`, `LUNCH ME AND VAIDE`, `HAPPY
BIRTHDAY RON`, `JUNE RENT`) *only when you actually typed one*. When you
didn't, it's just the literal word `UPI`, or boilerplate the payment app
inserted itself (`SENT VIA JUPITER`, `PAID VIA ELEMENTS`, `PAYMENT FOR
179255`, `PAYMENT TO ...`). `extractNoteFromNarration()` filters those
out; anything left is shown as a pre-filled suggestion, never saved
without review — so a wrong or noisy guess just gets edited/cleared by
the user, not silently trusted.

Non-UPI narrations (NEFT, ACH, card fees) don't follow this pattern
cleanly and may produce a messier "note" guess — acceptable since it's
always reviewable, not a correctness requirement.

## How the file actually gets from the browser to the backend

The user only has `.xls` available (not CSV), and Apps Script can't parse
`.xls` binary directly. The old Telegram flow solved this by uploading
the file to Drive and converting it to a Google Sheet via the Drive API
(`Drive.Files.copy` with `MimeType.GOOGLE_SHEETS`) — already enabled in
this project (`appsscript.json`'s `enabledAdvancedServices`), confirmed
2026-08-08. The PWA reuses the exact same conversion, just swaps out
"download from Telegram" for "decode a base64 string sent in the
request": browser reads the file via `FileReader`, sends it as base64 in
the `reconcileStatement` action, backend decodes it into a Blob, converts
via Drive same as before, reads the resulting Sheet, then **deletes both
the uploaded file and the converted Sheet from Drive** once done — nothing
is left cluttering Drive after a reconciliation run.

The row-22 data-start offset already hardcoded in the pre-existing
`parseBankSheet()` (in `Recon.js`) was verified to exactly match the real
statement format (header row 21, data from row 22) — no change needed
there.

## Functions

- `extractNoteFromNarration(narration)` (new, `Recon.js`) — the note
  heuristic described above.
- `parseBankSheet(sheet)` (existing, modified) — now also calls
  `extractNoteFromNarration` per row and includes it as `note`.
- `previewReconciliation(bankTxns)` (new, `Recon.js`) — matches parsed
  bank transactions against `Transactions` (reuses the existing
  `calculateScore` logic unchanged, but now also tracks *which row*
  matched, not just the score), returns
  `{ total, matched, missing, notesFound }` without writing anything.
  Every missing transaction and every notesFound entry gets a
  `suggestedCategory` (via `getSuggestedCategoryFast`) and
  `suggestedType` (via `getSuggestedType`) attached — both called with
  the SmartMemory/TypeMemory data pre-read once, same batching fix
  applied to `getPendingTransactions` on 2026-08-08, so this doesn't
  re-introduce the same slowness bug for a statement with many rows to
  check. A matched row only becomes a `notesFound` entry if its existing
  Note is empty AND the statement recovered a real note for it.
- `reconcileStatementPreview(fileBase64, fileName)` (new, `Recon.js`) —
  the actual entry point: base64 → Blob → Drive conversion → Sheet →
  `parseBankSheet` → `previewReconciliation` → cleans up the temporary
  Drive file/Sheet in a `finally` block → returns the preview.
- `insertReconciledTransactions(txns)` (new, `Recon.js`) — takes the
  user-approved list (after editing) and actually writes them: appends
  each row to `Transactions` with `Processed = "YES"` already set (so they
  never surface in Pending — they've already been reviewed here), calls
  `handleCategoryCorrection` and `recordTypeVote` per row same as
  `saveTransactionNote` does, so reconciled transactions teach the memory
  systems too, not just get inserted blind.

**Note on the pre-existing `insertConfirmed()` in `Recon.js`** (the old
Telegram-only equivalent): found to have an off-by-one bug — its
`appendRow` array has 17 values for a 16-column sheet, which would shift
every subsequent column if it ever actually ran. It's dormant (Telegram
upload flow unreachable), so this has caused no real harm, but it's why
`insertReconciledTransactions` is a fresh function rather than a reuse of
`insertConfirmed`. Not fixed, since the old function isn't used going
forward — noted here in case anyone considers reviving the Telegram path.

## UI

Reconcile screen lives under More. File upload → `reconcileStatement` →
two labeled review sections (missing / notes found), each item built
from a shared `buildReviewCardShell()` (note input, category dropdown,
optional Need/Want/Saving toggle, include checkbox) — same interaction
pattern as Pending. "Add Selected Transactions" calls
`insertReconciledTransactions` once with the whole batch; "Save Selected
Notes" calls the existing `saveNote` action once per approved item.

## Credit card statement support (added 2026-08-25)

**Why:** CC Advisor's own tracked bill total for a cycle (₹6,924.37,
summed from real card-mode debit rows in `Transactions`) turned out to
be short of the user's actual bill payment (₹7,399) by ~₹474.63 — almost
certainly a card swipe the SMS parser silently never caught (a known,
separate risk — see the "SMS ingestion" section of CLAUDE.md). Rather
than guess at the gap, the user asked for the same upload-and-check
tool bank reconciliation already provides, extended to credit card
statements.

**Reuses almost everything already built for the bank flow** — same
"upload → review → approve, nothing written automatically" idea, same
`previewReconciliation()`/`calculateScore()` matching logic completely
unchanged (a parsed transaction is just `{ date, amount, type, ref, name,
mode, note }` regardless of which statement it came from), same Drive
base64→Blob→Sheet conversion pipeline, same review-card UI on the
Reconcile screen. What's actually new:

- **A statement-type toggle** (Bank / Credit card) at the top of the
  Reconcile screen, using the same `.view-toggle` pill component already
  shipped for Analysis's Category/Need-Want-Saving toggle — no new CSS.
  Switching type clears any file already picked (uploading under the
  wrong type would mis-parse it) and swaps the intro text + file-picker
  label wording.
- **`parseCreditCardSheet(sheet)`** (`backend/Recon.js`) — a card
  statement doesn't follow the bank statement's fixed row-22 layout, so
  this reuses the flexible `findHeaderRow()`/`mapColumns()` header
  detection from the old, previously-dormant `Credit Card.js` (unchanged
  there) instead of `parseBankSheet()`'s fixed offset. Handles both an
  "Amount" column (with a `-` sign or trailing "CR" marking a refund/
  credit) and separate Debit/Credit columns. Every parsed row gets
  `mode: "card"` unconditionally, `ref: "NOREF_" + i` (a card statement
  has no UPI-style reference number, so matching falls back to
  date+amount+type — see `calculateScore`), and `note: ""` (no
  personal-note concept the way UPI narration's last dash-segment has,
  so the "notes found" review bucket naturally stays empty for this
  path — no extra code needed, `previewReconciliation` already skips a
  row with no note to recover).
- **`parseFlexibleDate(dateVal)`** (`backend/Recon.js`) — handles a real
  `Date`, an Excel serial number, or a `dd/mm/yy(yy)` string; a card
  statement's date format isn't guaranteed to match the bank statement's
  own `parseIndianDate()` (which only handles a 2-digit-year string).
- **`reconcileCreditCardStatementPreview(fileBase64, fileName)`**
  (`backend/Recon.js`) — the entry point, mirrors
  `reconcileStatementPreview` exactly except for the parse step. Routed
  as a new `reconcileCreditCardStatement` PWA action (kept separate from
  `reconcileStatement` rather than an internal branch, so the
  already-working bank path is never touched).
- **`insertReconciledTransactions(txns, source)`** — gained an optional
  `source` parameter (default `"Bank Statement"`, unchanged for every
  existing caller) so an approved credit-card-recovered row's Source
  column reads `"Credit Card Statement"` instead.

**Verified with `backend/tests/ccStatementReconciliation.test.js`**
(25 assertions): `parseFlexibleDate`'s three date shapes; both column
layouts (Amount+CR vs Debit/Credit); every parsed row's mode is always
`"card"`; and the core "found the missing swipe" scenario — two
statement rows that already exist in `Transactions` correctly match,
one genuine gap correctly gets flagged missing. Full existing suite (11
files) still passes.

**Resolved 2026-08-25**, and a real format problem caught in the
process. The user shared their actual real statement to test this
feature before deploying — good thing, because **it's a PDF, not an
`.xls`** (an HDFC UPI RuPay card statement). The `.xls`-only version
built above would have failed on the very first real use.

**Fix**: `reconcileCreditCardStatementPreview` now branches on the
uploaded file's extension. A PDF goes through a new path —
`extractTextFromStatementPdf()` (Drive API v2's OCR-on-copy feature,
converting the PDF to a Google Doc and reading its text) into
`parseCreditCardStatementText()`, a line-based parser built directly
against the user's real statement's text layout:
```
23/07/2026| 21:25 UPI-HI TECH AUTO SERVICE  <rewards>  ₹523.59  <PI dot>
06/08/2026| 08:55 BPPY CC PAYMENT ... (Ref# ...)  +  ₹9,800.00  <PI dot>
```
Deliberately does NOT try to recognize the ₹ symbol itself — the PDF
tool used to inspect the real statement rendered it as a stray "C";
Google's own OCR could render it differently again. Instead it finds
the date+time at the start of a line, then takes the LAST amount-shaped
number on that line (the statement's own column order always puts the
₹ amount last), with a "+" immediately before it marking a credit
(payment/refund). `.xls`/`.xlsx` still works too (`parseCreditCardSheet`,
unchanged) in case a different card issuer's export is a spreadsheet —
both paths land on the same `previewReconciliation()`.

**The actual mystery, solved**: `backend/tests/ccStatementPdfParsing.test.js`
uses the REAL text extracted from the user's real statement (not an
invented example) as its fixture. The statement's own printed
"PURCHASES/DEBIT (Current Billing Cycle)" is ₹7,398.86 — matches what
was actually paid. Summing every real transaction except one and
running it through the parser + matcher correctly and ONLY flags one
missing transaction: **a ₹474.49 UPI charge to "Google Asia Pacific
Pte. Ltd" on 30/07/2026**, almost certainly a Google Play Store
purchase — a real card swipe the SMS parser silently never logged, the
exact ₹474.63-ish gap (₹0.14 off from the earlier rough estimate,
which was based on a slightly-off manual cycle-window read) between CC
Advisor's tracked total (₹6,924.37) and the real bill. This is the
single card swipe whose SMS the parser missed — see the "SMS ingestion"
section of CLAUDE.md for the known, still-not-fully-diagnosed gaps in
that separate project that could explain why (a sender ID Tasker
doesn't forward, a filter false-positive, etc.) — worth a closer look
if it happens again, but not chased further here since this is a
Reconcile-feature fix, not an SMS-parser one.

**Known unverified piece, flagged honestly**: `extractTextFromStatementPdf()`
(the real Drive API v2 OCR call) has never actually been run — Apps
Script execution can't be tested outside the live editor from here. The
text-parsing logic itself (`parseCreditCardStatementText`) is
thoroughly tested against real statement text, and was deliberately
written to not depend on any specific currency-symbol rendering for
exactly this reason, but the OCR step itself still needs one real
live test — uploading the real PDF through the app — before this is
fully confirmed working end-to-end.
