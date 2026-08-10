# Financial Events (Rent + Investment) — first slice of the Category/Type restructure

**Status: live, first slice only (Rent + Investment).** Built and deployed
2026-08-10 after a long design discussion (see chat history / CLAUDE.md's
"PROPOSED PLAN: Category/Type restructure" section for the reasoning that
led here). EMI (which needs its own per-loan naming) and Lending (already
handled separately, see `isLendingTransfer` in `needWantSaving.js`) are
deliberately NOT part of this slice — same "one feature at a time" rule
already used elsewhere in this project.

**Fixed same day, caught by the user testing live:** the Category field
was still showing (and still being saved) after confirming something as
Rent/Investment — the same "this question doesn't apply anymore" logic
already applied to Need/Want/Saving hadn't been applied to Category too.
Fixed in `buildPendingItem`/`buildHistoryItem` (`index.html`): a new
`.category-field` wrapper + `updateCategoryVisibility()` hides it and
sets the (now invisible) value to `"Financial"` whenever a Financial
Event is selected, and restores whatever category was originally
suggested if the user taps "No, regular spend" to undo it. Deliberately
NOT tied into the lending exclusion (unlike the Need/Want/Saving hide,
which covers both lending and Financial Events through one shared
function) — lending's own category handling was left unchanged, out of
scope for this fix. Backend-unaffected (frontend-only change) — nothing
to redeploy via clasp for this one.

**Fixed same day — rent detection only ever looked at Counterparty,
never the note.** User hit this live: a mutual fund transaction correctly
triggered the Investment suggestion (its Counterparty text happened to
contain "mutual funds"), but an otherwise identical rent transaction
didn't — because the word "rent" only appeared in the user's own note
("July rent"), and `getFinancialSubtype`/`suggestFinancialEvent` never
looked at note text at all, only Counterparty. Real bank Counterparty
text rarely spells out what a payment is *for*; the user's own note
almost always does — same reasoning `isLendingTransfer` already uses.

Fixed: `getFinancialSubtype(counterparty, note)` (`needWantSaving.js`)
now checks both, combined — also improves the existing Need/Want/Saving
cold-start guess for everyone, not just Financial Events, since that
function is shared. `suggestFinancialEvent(counterparty, amount,
financialEventsData, note)` (`financialEvents.js`) passes note through.
`getTransactionHistory` (`PWA.js`) now passes `t.note` — the fix that
actually matters, since History always has a note; `getPendingTransactions`
passes its own `note` too for consistency, though it's always empty
there (nothing typed yet). Verified with a 4-case Node test reproducing
the exact "July rent" scenario before shipping. Pushed and redeployed
live via clasp (pinned deployment @286).

## Why this exists

User noticed `Investment` sitting as a subcategory under `Financial` — the
same bucket as `Lending`, `EMI`, `Credit Card`. That's the wrong shape:
`Category` should answer "what kind of *spending* was this" (Food,
Transport, Shopping...), but an investment isn't spending at all — it's
money moving into an asset you still own. Lumping it in as if it were a
kind of expense meant it was silently inflating the monthly spend total,
and (separately) real bugs were found in the same area — EMI/loan/
insurance were also mislabeled "Investment", and bank names (HDFC/ICICI/
AXIS/SBI) in the keyword list meant almost any UPI payment whose VPA
mentioned the receiver's bank could get wrongly stamped "Investment" too
(both fixed in `category.js` as part of this same change, unrelated to
Financial Events themselves — see "Bugs fixed alongside this" below).

Full design discussion happened scenario-by-scenario (walked through
Rent, EMI, Investment, Need/Want/Saving, and Lending one at a time, each
confirmed separately) rather than as one big spec — see chat history
around 2026-08-10 if this needs revisiting for the *why*, not just the
*what*.

## What a "Financial Event" is

A recognized, non-spending money movement. This slice only recognizes two:
**Rent** and **Investment**. A confirmed one is:
- Excluded entirely from `Total Spend` and the category breakdown.
- Shown as its own line on Analysis instead — `Fixed obligations: ₹X`
  (Rent, and EMI once that's built) and `Invested: ₹X` (Investment).
- Never asked about in the Need/Want/Saving toggle — that question isn't
  meaningful for money that isn't being spent.

## The detection mechanism — and why it looks the way it does

**First attempt (not shipped) would have remembered by Counterparty
text.** Rejected before writing any code: the user found real proof in
their own sheet that Counterparty is unreliable — the exact same ₹1 test
wallet deduction produced a blank Counterparty one time and "PayZapp
Wallet" the next. If the same transaction can't stay consistent with
itself, it can't be trusted to recognize "this is the same landlord as
last month."

**What shipped instead — two layers:**

1. **A remembered AMOUNT match** (`matchRecurringFinancialEvent` in
   `financialEvents.js`). Once a Rent or Investment payment is confirmed
   once, a future payment within 5% (or ₹50, whichever is larger) of
   that amount gets suggested with **high confidence** — pre-selected in
   the UI, a single tap (Save) confirms it. This works because both Rent
   and a recurring SIP are, by nature, close to the same amount every
   time they recur — unlike Counterparty, this is actually consistent in
   the real data checked.
2. **A soft keyword hint** (`getFinancialSubtype` in `needWantSaving.js`,
   reused as-is — already existed for the Need/Want/Saving cold-start
   guess, not new code) — used only when there's no amount match yet
   (e.g. the very first time). **Low confidence** — offered as an option
   but never pre-selected, since it needs a real decision.

If neither layer fires, nothing is shown — an ordinary transaction's
Pending/History card looks exactly like it always has. This was a
deliberate choice, confirmed with the user: don't clutter the common case
just to handle a rare one.

## Where the confirm actually happens

**Not the raw bank SMS, ever.** The user explicitly ruled this out
(2026-08-10) after realizing a note typed inside a payment app like GPay/
PhonePe does NOT reliably appear in the bank's own SMS — and even where
something does appear, wording varies wildly bank to bank (already proven
independently, e.g. the PayZapp Wallet SMS format vs a normal HDFC UPI
debit SMS look nothing alike). The confirm is always a tap **inside this
app** — Pending (for a still-unnoted transaction) or History (for one
that already has a note, so an old transaction from before this feature
existed can still get tagged retroactively).

## Frontend UI

`buildPendingItem`/`buildHistoryItem` in `index.html`:
- A new `.fe-field` chip row ("Yes, Rent" / "No, regular spend"), only
  rendered when `suggestedFinancialEvent` (Pending) or `financialEvent ||
  suggestedFinancialEvent` (History) is present.
- Reuses the shared `wireLendingAwareToggle` helper, extended
  (2026-08-10) to take an optional `isFinancialEventSelected` getter —
  the Need/Want/Saving toggle now hides for EITHER a lending note OR a
  selected Financial Event, through one shared `update()` function
  instead of two independent show/hide mechanisms that could otherwise
  fight each other (e.g. typing in the note field re-showing a toggle
  that a Financial Event chip had just hidden).
- The 4th Need/Want/Saving/Investment button ("Investment") was dropped
  from `buildPendingItem`/`buildHistoryItem`'s type-toggle in this same
  change — a real investment is now caught earlier as its own Financial
  Event, so that option would never meaningfully get used from here
  again. **Not yet applied to Reconciliation or Cash's toggle** — out of
  scope for this slice, left as 4 buttons there for now.

## Backend functions

New file `financialEvents.js`:
- `getFinancialEventsSheet()` — auto-creates the `FinancialEvents` sheet
  if missing, same pattern as `TypeVotes`/`NoteMemory`.
- `amountsMatch(a, b)` — within 5% or ₹50, whichever is larger.
- `matchRecurringFinancialEvent(type, amount, financialEventsData)` —
  true if any row of that Type in the memory sheet is a close amount
  match.
- `suggestFinancialEvent(counterparty, amount, financialEventsData)` —
  returns `{type, confident}` or `null`. Amount-match layer first
  (confident), falls back to the keyword hint (not confident), else null.
- `recordFinancialEvent(type, amount, counterparty)` — appends a row
  to `FinancialEvents` after a confirm, so the next similar-amount
  payment gets recognized.

Changes in `PWA.js`:
- `getPendingTransactions` / `getTransactionHistory` — both now read
  `FinancialEvents` once (same "read outside the loop" performance
  pattern as `SmartMemory`/`TypeVotes`) and attach `financialEvent`
  (already-confirmed, History only), `suggestedFinancialEvent`, and
  `financialEventConfident` to each transaction.
- `saveTransactionNote(row, note, category, counterparty, type, amount,
  financialEvent)` — new last parameter. When present: writes it to
  `Transactions` column R, calls `recordFinancialEvent`, and skips
  writing column Q (Need/Want/Saving) entirely — same exclusion
  reasoning as `isLendingTransfer`, added to the same `if` condition.
- `getTodaySummary` / `getMonthlyAnalysis` — a debit row with column R
  set is excluded from spend totals (same `continue` pattern as
  `isCreditCardBillPayment`/`isWalletTopUp`), and its amount is added to
  a new `fixedObligations` (Rent) or `invested` (Investment) total,
  returned alongside the existing fields. Cash entries are NOT covered by
  this — Cash has no bank SMS to detect a Financial Event from, kept to
  plain manual category/type entry as it always has been.

## Transactions sheet — new column

**Column R: `FinancialEvent`.** Blank = not a Financial Event (the
default, unchanged behavior). `"Rent"` or `"Investment"` once confirmed.
Written once, on confirm — never re-guessed later (same reasoning as
column Q's `NeedWantSaving`, see that section of
[need-want-saving.md](need-want-saving.md) for why a stored answer beats
a live re-guess).

## `FinancialEvents` sheet schema

Auto-created on first use. One row per confirmation (not one per Type) —
appending only, nothing overwritten, same shape as `TypeVotes`:

| Column | Meaning |
|---|---|
| Type | "Rent" or "Investment" |
| Amount | The confirmed amount, used for future matching |
| Counterparty | Whatever was captured — reference only, not matched on |
| Confirmed | Timestamp |

## Bugs fixed alongside this (in `category.js`, not part of Financial Events itself)

Found during the same review that led to this feature, fixed in the same
change since both touch `matchByPattern`:
- **Bank names removed from the Investment keyword list.** `hdfc`,
  `icici`, `axis`, `sbi` used to sit alongside `sip`/`mutual fund`/
  `zerodha` — meaning any UPI payment whose VPA happened to mention the
  receiver's bank (e.g. `someone@okhdfcbank`, very common) could get
  wrongly categorized "Investment."
- **`emi`/`loan`/`insurance` removed from the same list** — these aren't
  investing, and were getting mislabeled as such. They now fall through
  to normal categorization (Gemini/Other) until EMI gets its own proper
  Financial Event treatment in a later slice.
- **Lending keywords tightened.** `"sent to"`/`"transfer to"` removed
  (too generic — would match huge numbers of ordinary notes). The
  remaining words (`lent`, `borrowed`, `returned`, `gave`, `paid back`)
  switched from plain substring matching to whole-word regex — closes
  the exact same bug class already found and fixed once in
  `isLendingTransfer` (`needWantSaving.js`; "lent" as a bare substring
  also matches inside "excellent", "silent", "talent"), which this
  separate copy in `category.js` never got the same fix for.

Verified with a standalone Node test (17 cases: the Financial Event
suggestion logic including the exact ₹1-test-row Counterparty
inconsistency scenario, plus all the `category.js` bug fixes above) before
shipping — same discipline as every other fix in this project.

## Open items / not yet built

- **EMI** — same underlying mechanism (amount-match memory) would work,
  but needs per-loan naming (you can have more than one EMI) which Rent
  and Investment don't. Next slice, once this one's proven on real data.
- **Lending auto-link to Debts** — user explicitly said keep this manual
  for now (2026-08-10); Lending detection itself is unchanged (still
  `isLendingTransfer`, note-based only).
- **Investment number sourcing** — `invested` currently sums confirmed
  Financial Event rows directly from `Transactions`. Not yet cross-checked
  against the actual Investments tab/sheet in case the same SIP also gets
  logged there manually (would double-count) — flagged as open during
  design, not resolved yet.
- **Reconciliation and Cash's Need/Want/Saving toggle** still show the
  old 4-button (including "Investment") version — not updated in this
  slice, since Financial Event detection isn't wired into either screen
  yet.
- **Category list itself** (Food/Transport/Bills/Shopping/Lifestyle/
  Health/Education/Other, dropping "Financial" and "Income" as spend
  categories) — agreed in principle during design discussion, not yet
  implemented; `category.js`'s `SMART_CATEGORIES` list is unchanged in
  this slice beyond the specific keyword fixes above.
