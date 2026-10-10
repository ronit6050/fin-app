# Auto-settle the knowns + daily health check

**Status: built 2026-10-10, tightened the same day after an independent
review. Backend `clasp push`ed to the editor draft only (NOT
`clasp deploy`ed). Needs the user's go-ahead to deploy, plus one new timer
added by hand (see "The trigger to add").**

Goal behind both pieces: *"the app should only ask me about things only I
know."*

**Guiding principle: a SILENT action needs a far higher bar than a one-tap
suggestion.** The Pending chip shows you a guess and you confirm it; the
silent path acts with nobody looking. So the silent path is much stricter
than the chip, and when in doubt the row stays in Pending. The chip
(`suggestFinancialEvent`) was deliberately NOT changed.

---

## Part A - Auto-settle (`backend/autoSettle.js`)

### What it does, in plain terms

When a new bank transaction arrives, `processNewTransactions` (the timer job
that used to alert you about every row) first asks: *is this one of three
things the app already knows for certain?* If yes, it fills in the Note and
Category itself, silently - no notification, nothing in Pending. If it is
anything else, nothing changes: you get the usual notification and it waits
in Pending.

| Class | Silent-path rule | Note written | Category | Column T |
|---|---|---|---|---|
| a. Credit card bill payment | The payment's own **wording** says so (`isCreditCardBillWording_`: "credit card", "cc bill", "cc billpay", ...). An amount that merely equals the outstanding bill does **not** count here. | `Credit card bill payment` | Financial | `ccbill` |
| b. Wallet top-up | `isWalletTopUp` (names a wallet **and** has a reference) **and** a bank-transfer mode | `Wallet top-up` | Financial | `wallet-topup` |
| c. Recurring Rent / named EMI / named SIP, debits only | Strict matcher below | `Rent`, or the event's name | Financial | `fe:Rent` / `fe:<name>` |

### Class (c) strict matcher (`findSilentFinancialEventMatch_`)

All of these must hold, otherwise the row goes to Pending:

1. **Mode** is a bank-transfer type (allow-list: upi, neft, imps, rtgs,
   nach, ach, ecs, enach, e-mandate, autopay). Card swipes, wallet debits
   and anything unknown ("other", blank) never settle silently.
2. **Amount** within Rs.1 of a remembered payment (the chip allows 5% / Rs.50).
3. **Payee** present on the payment AND on the remembered payment, and it
   matches strictly (`strictPayeeMatch_`): the names are equal once spaces
   and punctuation are removed (>= 5 letters) or one contains the other
   (shorter >= 8 letters, e.g. `NSECLEARINGLIMITED` vs "NSE Clearing
   Limited"); OR at least two meaningful words are shared; OR the remembered
   payee has exactly one meaningful word and it is shared. One shared common
   word between longer names is not enough.
4. **Unambiguous**: exactly one distinct remembered event (type + name) fits.
   Two SIPs of the same amount to the same payee = a tie = Pending.
5. The human chip must agree (same type and name), as a belt-and-braces check.

Remembered rows with a blank payee (seeded SIPs) never count as a match.

### The rules (do not weaken these)

1. **An auto-settled row never teaches anything.** No `handleCategoryCorrection`
   (SmartMemory), no `recordTypeVote`, no `recordNoteUsage`, and **no write
   to the FinancialEvents memory sheet** - a wrongly-settled payee must never
   get remembered. Need/Want/Saving (col Q) stays blank. The advance-notice
   reminder (`obligationReminders.js`) keeps working because its payment
   history comes from Transactions columns R/S, which are written (covered by
   a test).
2. **Debits only.** Credits, lending/debts, salary: untouched.
3. **UNCERTAIN rows are never settled** (counterparty starting `NEEDS REVIEW`).
4. **Fail-safe, no orphans.** Every cell write (R, S, M, N, T) happens first;
   the one side effect outside the row - the Investments-tab entry for a SIP -
   happens **last**. If anything throws, the cells are put back,
   `AUTO_SETTLE_ERROR` is logged, and the row continues down the normal path
   (notification + Pending). A failure before the last step leaves nothing
   behind anywhere; if the last step itself fails, nothing was written there.
   It never throws, never blocks other rows, never affects `lastCheckedRow`.
5. **Idempotent.** A row with a reason code in T is never settled twice; a
   settle cut off before "Processed" was written is simply finished next run.

The shared code with the human confirm path (`PWA.js`) is split into
`writeFinancialEventCells_` (R/S cells) and `runFinancialEventSideEffects_`
(memory + Investments/Savings log, with a `recordMemory` flag - true for a
human, false for the silent path). `applyFinancialEventToRow_` = both, used
by `saveTransactionNote` exactly as before.

### Column T `AutoSettled` (the new 20th column)

Header is added automatically and safely (`ensureAutoSettledHeader_`; also in
`addMissingTransactionColumnHeaders()` in Logger.js). If T1 already holds a
different label, auto-settle switches itself off and logs it. Checked against
every writer of Transactions: the SMS reader and Recon write 16-17 values (T
just stays empty); Recon's whole-sheet sort and `markNotATransaction` use
`getLastColumn()` / the full row width, so T moves with its row; every reader
indexes by position and pads blanks. See [../SHEET_SCHEMA.md](../SHEET_SCHEMA.md).

### Small fix made along the way

`isCreditCardBillPayment` did not recognize the glued wording `cc billpay`.
It does now (via `isCreditCardBillWording_`), so those payments are also
excluded from spend totals like other bill payments. The amount-based half of
`isCreditCardBillPayment` is unchanged - such rows are still excluded from
spend, they just are not settled silently.

### One-time sweep for rows already in Pending

Run by hand in the Apps Script editor (pick the function, Run, View > Logs):

- `previewAutoSettle()` - read-only. Lists each Pending row that WOULD be
  settled, in plain English, and a count. Changes nothing.
- `autoSettlePendingNow()` - applies the same decision function to the same
  rows. Safe to run twice.

---

## Part B - Health check (`backend/appHealth.js`)

`checkAppHealth()` runs once a day and sends **one** push **only if something
is wrong**. Healthy = totally silent (no push, no log, nothing saved).

1. **Missing timers** - compared against `processNewTransactions`,
   `checkDebtDueDates`, `sendDailyCashCheckin`, `checkUpcomingObligations`,
   `checkAppHealth`.
2. **Stuck rows** - dated within the last 7 days
   (`HEALTH_STUCK_ROW_WINDOW_DAYS`) with Processed blank for over an hour
   (`HEALTH_STUCK_ROW_GRACE_MINUTES`). Older rows are ignored on purpose (five
   old rows are stuck forever and would fire daily). `IGNORED` is not stuck.
3. **Silence** - newest bank transaction older than `HEALTH_NO_NEW_TXN_DAYS`
   = 3 (statement `Import` rows do not count).
4. **Errors** - AILogs in the last 24 h containing `PUSH_ERROR`,
   `PUSH_TOKEN_ERROR`, `PROCESS_TXN_ERROR`, `AUTO_SETTLE_ERROR`,
   `UPCOMING_OBLIGATION_ERROR`, `DEBT_TRAJECTORY_LOG_ERROR`.

Idempotent via Script Properties keys `HEALTH_REPORTED_<problem>_<yyyy-MM-dd>`:
a second run the same day is silent; a *new* problem later that day is
announced (listing everything currently wrong); old keys are cleaned up. A
persistent problem is re-announced once per day.

`testCheckAppHealth()` - hand-run dry run; sends and saves nothing.

**Honest limit:** if Google revokes the script's permissions entirely, this
function stops running too.

### The trigger to add (by hand - this project never creates triggers from code)

Apps Script editor -> clock icon (Triggers) -> **Add Trigger**:

- Function: `checkAppHealth`
- Deployment: Head
- Event source: Time-driven
- Type: Day timer
- Time of day: 9am to 10am

---

## What the user sees

- Normal day: fewer "New Transaction" notifications; bill payments (by
  wording), wallet top-ups and a repeat of an exact Rent/EMI/SIP you have
  confirmed before simply never show up in Pending. In History they appear
  with their note; the AutoSettled code is in the sheet.
- Something broken: one push "App health: N problem(s)", a line per problem.

## Real-data check (2026-10-10, local only, nothing committed)

Replayed the user's real exported sheet (888 debit rows) as if each had just
arrived. After tightening: 11 rows would be settled live-style (3 wallet
top-ups, 2 bill payments by wording, 2 Rent, 4 SIP); every Financial Event and
bill settle matched what the user had actually chosen. Only disagreements: two
early-March wallet top-ups the user had noted as spending before the wallet
rule existed. The 5 confirmed Rent/EMI/SIP rows not settled were each the
first of their kind (or a non-bank-transfer mode). The 8 rows in Pending: the
sweep settles exactly the two bill payments (by wording).

## Tests

- `backend/tests/autoSettle.test.js` - each class; the look-alikes that must
  NOT settle (card/wallet/unknown mode, no payee, off-by-11 amount, different
  landlord, ambiguous tie, amount-only bill match, credits, NEEDS REVIEW);
  learning/memory not written; no orphans on failure at either step; sweep
  preview vs apply; the 20th column with `markNotATransaction` / Recon sort /
  History; reminder history still works.
- `backend/tests/appHealth.test.js` - each of the four problems, silent when
  healthy, old stuck rows do not fire, one combined push, double-run
  idempotency, never throws, dry run saves nothing.
- Shared helper: `backend/tests/_fakeSheetsKit.js` (invented data only).
