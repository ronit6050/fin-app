# Google Sheet schema (source of truth)

This is the definitive list of every real, active tab in the live Google
Sheet this app uses, written after a full cleanup pass (2026-09-05) that
removed old/superseded tabs and archived unrelated manual-tracking ones
into a separate spreadsheet. See CLAUDE.md's "Pre-multi-user cleanup"
notes for how this was arrived at.

**This doc supersedes the old `reference_transactions_sheet_schema`
memory** (which only covered `Transactions`, from a screenshot, before
the backend code was in this repo).

**Why this doc exists:** it's the literal basis for the multi-user
"template Sheet" — a friend's auto-created Sheet gets built from exactly
this structure. Keep it updated whenever a sheet's columns change.

**Not covered here:** the `Logs` tab sits in this same spreadsheet but
belongs to the *separate* `sms-parser-backend` project (its own Apps
Script project, own `.clasp.json`) — leave it alone, it's out of scope
for this app's own schema/template.

---

## Transactions
Bank/UPI transactions — written by Tasker (via the separate SMS-parser
project) independently of this backend; this backend only adds
note/category/tags to existing rows via Pending/History/Reconcile.

| Col | Name | Meaning |
|---|---|---|
| A | Date | Transaction date |
| B | Time | Transaction time |
| C | Bank | e.g. `HDFC` |
| D | Type | `debit` or `credit` — reliable signal for money leaving vs. entering, independent of category/note |
| E | Mode | `upi`, `card <last 4 digits>` (e.g. `card 1111`), `wallet`, `neft`, `atm`, etc. |
| F | Amount | Numeric |
| G | Reference | Bank reference/UTR number, or a `NOREF_...` placeholder for a statement-recovered row with no real reference printed |
| H | Counterparty | Raw payee/payer name from the bank SMS/statement |
| I | Channel | e.g. `SMS`, `Import` |
| J | Source | e.g. `Tasker`, `Bank Statement` |
| K | RawSMS | Full original SMS text |
| L | Sender | SMS sender ID |
| M | Note | User-entered note (Pending/History) |
| N | Category | One of the app's 10 categories: Food, Transport, Bills, Shopping, Lifestyle, Financial, Income, Education, Health, Other |
| O | TelegramMsgID | Legacy, Telegram-era field |
| P | Processed | `YES` once picked up by `processNewTransactions`, else blank |
| Q | NeedWantSaving | `Need` / `Want` / `Saving` / `Investment`, or blank if not yet tagged/not applicable (credits, lending transfers, confirmed Financial Events all skip this) |
| R | FinancialEvent | `Rent` / `EMI` / `Investment`, or blank |
| S | FinancialEventName | Only meaningful when column R is `EMI` or `Investment` — the specific named loan/investment (e.g. "Home Loan EMI") |
| T | AutoSettled | Added 2026-10-10. Blank for anything a human handled. A short reason code when the app settled the row by itself (see [auto-settle-and-health.md](features/auto-settle-and-health.md)): `ccbill`, `wallet-topup`, `fe:Rent`, or `fe:<event name>` (e.g. `fe:Laptop EMI`). Rows written by the SMS reader / Recon only have 16-17 values, so this cell is simply empty for them — nothing depends on the row being 20 wide |
| U | FriendShare | Added 2026-10-12. Blank normally. When you split a payment with a friend (see [splits.md](features/splits.md)), the rupees the FRIEND owes. Every spend total (Today, Analysis, Planner, Home) uses `Amount - FriendShare`; card limit/bill matching and the Pending/History amount keep the full `Amount`. Written/cleared by the app (on split / undo) and re-checked daily. Header is added automatically the first time. Never edit by hand; `splitsCheckShares()` / `splitsFixShares()` (run from the editor) report/repair drift |
| V | EventDeclined | Added 2026-10-14. Blank normally; `YES` once the person tapped "No, regular spend" on a Rent/EMI/Investment suggestion for THIS payment, so History stops listing it under "Needs attention" and stops suggesting it. Cleared if an event is confirmed later. Column R keeps meaning only Rent/EMI/Investment. Header is added automatically the first time. See [history.md](features/history.md) |
| W | DebtLinked | Added 2026-10-14. Blank normally; `YES` once this payment has created or settled a debt from its note ("lent to Vaidehi", "Raj paid back"). A later Save of the same payment (a second tap, or a note edit) then does NOT add another debt or apply the repayment again. Only set when the link really happened. Header is added automatically the first time. See [financial-events.md](features/financial-events.md) |

---

## Cash
Manual cash spend/receive entries — written by the PWA's Cash tab only.
Category is picked manually and does **not** feed `SmartMemory`.

| Col | Name | Meaning |
|---|---|---|
| A | ID | Unique entry ID |
| B | Date | |
| C | Time | |
| D | Type | `debit` or `credit` |
| E | Amount | Numeric |
| F | Note | |
| G | Category | Same 10-option list as Transactions |
| H | Source | |
| I | TelegramMsgID | Legacy, Telegram-era field |
| J | CreatedAt | |

---

## Debts
Lent/borrowed money, one row per debt.

| Col | Name | Meaning |
|---|---|---|
| A | Date | |
| B | Person | |
| C | Type | `LENT` or `BORROWED` |
| D | Amount | Remaining amount owed (reduced in place by partial payments) |
| E | Note | |
| F | DueDate | |
| G | Status | `Pending` or `Settled` |
| H | SettledDate | |

---

## Goals
One row per savings goal (replaced the old `WishList` sheet, 2026-08-11).

| Col | Name | Meaning |
|---|---|---|
| A | Name | |
| B | Type | `OneTime` (fixed ₹ target, e.g. a wish-list item) or `Recurring` (target computed live, e.g. CC Buffer) |
| C | Target | Only set for `OneTime` goals — blank for `Recurring` (computed on the fly) |
| D | Status | `Active` or `Done` |
| E | Priority | Boolean-ish — the one active one-time goal that gets priority in Auto Split |
| F | DateAdded | |
| G | TargetDate | Optional deadline `yyyy-MM-dd`, one-time goals only (added 2026-10-17; the header is added automatically to an older sheet the first time a date is saved; old rows are simply blank) |

---

## Savings
One row per savings transaction — split across up to several rows per
action (Auto Split can write multiple rows for one action).

| Col | Name | Meaning |
|---|---|---|
| A | Date | |
| B | Amount | Negative for a withdrawal |
| C | Type | `auto`, `manual`, `withdraw`, or `payment` (money from a payment you tagged Saving or noted "saving"; written since 2026-10-17, older such rows say `auto`) |
| D | Note | |
| E | Destination | `Emergency`, `Free`, `CC Buffer`, or the exact name of a row in `Goals` — **column header was stale ("Pot," a leftover from the old pre-2026-08-11 system) until this cleanup pass relabeled it** |

---

## Investments
One row per investment log entry.

| Col | Name | Meaning |
|---|---|---|
| A | Date | |
| B | Name | The specific instrument's name (must match a row in `InvestmentInstruments`) — **column header was stale ("Type") until this cleanup pass relabeled it** |
| C | Amount | |
| D | Note | |
| E | Kind | Added 2026-10-17: `opening` (what you had put in when you started tracking, or typed in setup), `payment` (the app saw it leave the bank), `manual` (added by hand), `sale` (money taken out, negative amount). Older rows have no Kind: "Starting Balance" note = opening, negative = sale, else payment. |

Archive: `Investments_Archive` (Date, Name, Amount, Note, Kind, ArchivedOn) is created by "Start over from scratch" and only ever written to.

---

## InvestmentInstruments
Fixed, named list of real investments (replaced free-typed "Type" text,
2026-08-11) — SIPs matched by amount, everything else by note text.

| Col | Name | Meaning |
|---|---|---|
| A | Name | |
| B | Category | `SIP`, `One-time Fund`, `Stock`, or `Gold` |
| C | SipAmount | Only set for SIPs — used for amount-matching a recurring payment |
| D | SipDay | Added 2026-10-17: usual day of the month (1-31) the SIP is paid |
| E | SipActive | Added 2026-10-17: `yes` running, `no` paused (blank with an amount = running). A paused SIP also has a marker row in `FinancialEvents` (Type `InvestmentPaused`, Name = the SIP) so its payments stop being recognised. |

---

## Budgets
Planner's per-category monthly spend targets (2026-08-18).

| Col | Name | Meaning |
|---|---|---|
| A | Month | e.g. `2026-08` |
| B | Category | |
| C | Type | `""` (blank — single whole-category target) or `Need`/`Want` (category splits into separate sub-targets when real history shows it's genuinely used both ways) |
| D | Target | |

---

## Credit_Card
Parsed credit card statement uploads (currently empty — 0 rows as of this
cleanup pass).

| Col | Name | Meaning |
|---|---|---|
| A | Date | |
| B | Time | |
| C | Description | |
| D | Amount | |
| E | Type | |
| F | Source | |

---

## SmartMemory
Learned merchant → category mappings, feeds the fast category-suggestion
layer. Rebuilt clean 2026-08-08 after the original was found polluted by
Cash-entry free-text words.

| Col | Name | Meaning |
|---|---|---|
| A | Merchant | |
| B | Category | |
| C | Subcategory | |
| D | Confidence | 0–100; 100 = a real, confirmed correction |
| E | TimesUsed | |
| F | LastUsed | |

---

## TypeVotes
Per-answer Need/Want/Saving/Investment history — one row per answer, not
a running total, so `getSuggestedType` can look at "the last 5" for a
merchant+amount-band instead of an all-time count. Row order is the real
chronological order (never sorted by Timestamp — two answers in the same
session can land in the same millisecond).

| Col | Name | Meaning |
|---|---|---|
| A | Merchant | (Counterparty) |
| B | AmountBand | e.g. `Small`/`Medium`/`Large` |
| C | Type | `Need`/`Want`/`Saving`/`Investment` |
| D | Timestamp | |

*(Header row was missing on the live sheet until this cleanup pass —
see "Known past issue" below.)*

---

## NoteMemory
Remembered note per merchant+amount-band, suggests a note before you
type one in Pending.

| Col | Name | Meaning |
|---|---|---|
| A | Merchant | |
| B | AmountBand | |
| C | Note | |
| D | TimesUsed | Only suggested back once this clears a minimum-uses confidence bar |
| E | LastUsed | |

*(Header row was missing on the live sheet until this cleanup pass —
see "Known past issue" below.)*

---

## FinancialEvents
Confirmed Rent/EMI/Investment recurring-payment records — used to
recognize the next month's matching payment automatically.

| Col | Name | Meaning |
|---|---|---|
| A | Type | `Rent` / `EMI` / `Investment` |
| B | Amount | |
| C | Counterparty | |
| D | Confirmed | Date this was first confirmed |
| E | Name | Only meaningful for EMI/Investment (the specific named loan/fund) |

*(Header row was missing on the live sheet until this cleanup pass —
see "Known past issue" below.)*

---

## Transactions_Ignored
Archive of transactions the user marked "not a real transaction" from
Pending (added 2026-09-18, see
[docs/features/spam-learning.md](features/spam-learning.md)). Exact same
columns as `Transactions` above — a full copy of the original row,
never a delete-and-forget. Auto-created on first use.

---

## LearnedSpamPatterns
Reusable "fingerprints" of spam messages the user has flagged, so the
separate `sms-parser-backend` project can recognize near-identical
future messages automatically (added 2026-09-18, see
[docs/features/spam-learning.md](features/spam-learning.md)).
Auto-created on first use. Only ever affects a message already
classified `UNCERTAIN` by that other project — can never override a
confidently-detected real transaction.

| Col | Name | Meaning |
|---|---|---|
| A | DateLearned | |
| B | Sender | SMS sender ID |
| C | NormalizedTemplate | `normalizeForFingerprint(RawSMS)` — must stay byte-identical between this project's copy and `sms-parser-backend/Code.js`'s copy |
| D | ExampleRawSMS | Original, untouched raw SMS text |

---

## AILogs
Error/event log, useful for debugging (e.g. `PUSH_SENT`/`PUSH_ERROR`,
`PROCESS_TXN_ERROR` entries).

| Col | Name | Meaning |
|---|---|---|
| A | Timestamp | |
| B | Event | |
| C | Data | |

---

## Known past issue — fixed 2026-09-05

`TypeVotes`, `NoteMemory`, and `FinancialEvents` were each missing their
header row on the live sheet (real data sat in row 1 instead). Every
function that reads these sheets always skips row 1 assuming it's a
header — so on these 3 sheets, the real first data row had been silently
invisible to the app since it was created. Fixed by inserting the correct
header row at the top of each (shifts existing data down one row, nothing
deleted) via a one-time `addMissingHeaderRows()` function
(`backend/Logger.js`). Separately, `Transactions` columns Q/R/S
(`NeedWantSaving`/`FinancialEvent`/`FinancialEventName`) had a real header
row but those 3 cells were never labeled — cosmetic only (the code always
reads by column position, not label), fixed via
`addMissingTransactionColumnHeaders()` in the same file. Also relabeled
two more stale headers found while writing this doc: `Savings` column E
("Pot" → "Destination") and `Investments` column B ("Type" → "Name") —
both cosmetic only.

## Tabs removed/archived during this same cleanup pass

- **Deleted** (confirmed superseded, nothing reads them anymore):
  `WishList`, `CategoryMemory`, `TypeMemory`, `SmartMemory_old`,
  `Recon_Temp`.
- **Archived** to a separate spreadsheet (old manual tracking, predates
  this app, nothing in the code touches them): `Categories`, `Config`,
  `CategoryBudgets`, `Budget`, `Track exp`, `60k account`, `Aug CC bill`,
  `Sep CC bil`.

## Hidden bookkeeping tab: `_V2Sync` (added 2026-10-12)
Created and maintained by `backend/v2Sync.js` (the Sheet-to-Firestore mirror, see [v2-firestore-native.md](v2-firestore-native.md)).
Two columns: `collection/documentId` and a short fingerprint of that document, so each sync run writes only what changed.
Never edit it by hand. Deleting it is safe: the next run re-adopts what is already in Firestore (no duplicates) and rebuilds it.
Code that loops over every tab should skip names starting with `_`.

