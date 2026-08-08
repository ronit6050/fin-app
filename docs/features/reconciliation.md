# Bank statement reconciliation

**Status: in progress**, started 2026-08-08. Backend being built first, no
Pending/UI changes yet.

## What this feature is

Tasker reads bank SMS and writes rows into `Transactions` automatically —
but SMS can be missed (deleted before Tasker reads it, a silent parsing
failure, etc.), so transactions can go missing without anyone noticing.
Reconciliation closes that gap: you upload your real bank statement (an
`.xls` export), the app compares it against what's actually in
`Transactions`, and shows you anything missing — pre-filled with a note,
category, and Need/Want/Saving guess — for you to review and approve
before anything gets written.

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
  `calculateScore` logic unchanged), returns `{ total, matched, missing }`
  without writing anything. For each missing transaction, also attaches
  `suggestedCategory` (via `getSuggestedCategoryFast`) and
  `suggestedType` (via `getSuggestedType`) — both called with the
  SmartMemory/TypeMemory data pre-read once, same batching fix applied to
  `getPendingTransactions` on 2026-08-08, so this doesn't re-introduce the
  same slowness bug for a statement with many missing rows.
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

## Not yet built

The PWA action wiring and the actual Reconcile screen UI — backend logic
is being built and tested first, per usual.
