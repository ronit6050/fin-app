# Financial Events (Rent, EMI, Investment) — Category/Type restructure

**Status: live — Rent, EMI, and Investment all shipped 2026-08-10.** Built
after a long design discussion (see chat history / CLAUDE.md's "PROPOSED
PLAN: Category/Type restructure" section for the reasoning that led
here). Rent + Investment shipped first; EMI followed the same day once a
real user example (see "EMI" section below) revealed it needed a
genuinely different detection mechanism, not just a copy of Rent's.
Lending stays handled separately (`isLendingTransfer` in
`needWantSaving.js`) — not a Financial Event in the same sense, but now
properly excluded from spend totals too (see "Lending" below).

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

A recognized, non-spending money movement. Three types: **Rent**, **EMI**
(you can have more than one — each gets its own name, e.g. "Laptop EMI"
vs "Home Loan EMI"), and **Investment**. A confirmed one is:
- Excluded entirely from `Total Spend` and the category breakdown.
- Shown as its own line on Analysis instead — `Fixed obligations: ₹X`
  (Rent + all EMIs combined) and `Invested: ₹X` (Investment).
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

## EMI — needed its own detection mechanism, not a copy of Rent's

Real example from the user that forced this: an EMI paid to their dad
(an informal family arrangement, not a bank auto-debit). Most months it's
₹4,000 — but one month the user deducted some home expenses first and
paid ₹1,427 instead, noting "Laptop emi after deduction of home exp."
Amount-matching (which works fine for Rent and a SIP mandate) would
**never** connect ₹1,427 to ₹4,000 — they're nowhere near the 5%/₹50
tolerance.

**What actually stayed consistent: the user's own wording.** So EMI gets
a second matching layer amount-matching doesn't have — `matchRecurringEmi`
(`financialEvents.js`) tries, in order:
1. **Amount match** against every previously-confirmed EMI (works fine
   for a normal fixed-amount EMI, e.g. a real bank auto-debit).
2. **Note-text match** — strips the word "emi" out of a previously-used
   name (`emiKeywordFromName`: "Laptop EMI" → "laptop") and checks if
   that word shows up in the new note. Catches the ₹1,427 case: "laptop"
   is still in "Laptop emi after deduction of home exp," even though the
   amount is completely different.

**Multiple EMIs stay distinct** because each one only ever matches its
*own* remembered amount/keyword — a ₹3,000 "Phone EMI" and a ₹4,000
"Laptop EMI" (or an irregular ₹1,427 month for it) never get confused
with each other, verified directly with both existing in memory at once.

**Naming a brand-new EMI:** if the text just says "emi" somewhere (whole-
word matched — `chemistry`, `premium` etc. don't false-positive) but
doesn't match any specific EMI yet, there's no name to suggest. The UI
(`buildFinancialEventHtml` in `index.html`) shows a text input instead of
a Yes/No chip — "This looks like an EMI — which one?" — and only becomes
a confirmed Financial Event once the user types something and taps
"Mark as this EMI." Home loan EMI is the one exception: the specific
phrase "home loan"/"housing loan" auto-names itself ("Home Loan EMI")
even cold-start, same as it already did for the Need/Want/Saving guess.

Verified with a 9-case Node test, including the exact real "laptop
EMI, ₹1,427, note-matched not amount-matched" scenario, before shipping.

## Lending — closed a gap flagged during design, not a new mechanism

The original design discussion flagged this as a known gap, not yet
fixed at the time: `isLendingTransfer` already correctly skipped the
Need/Want/Saving question for a loan/repayment, but nothing ever
excluded it from the **spend total** itself. Fixed alongside EMI (same
change, since both came from finishing "all the pieces" of the original
design discussion): `getTodaySummary`/`getMonthlyAnalysis` now also
`continue` past a debit row where `isLendingTransfer(counterparty, note)`
is true — same pattern as the credit-card-bill/wallet-top-up/Financial-
Event exclusions already there. Lending itself is NOT a Financial Event
in the schema sense (no `FinancialEvent` column value, no
`FinancialEvents` memory row) — detection stays exactly as it was, note-
based only, per the user's explicit choice to keep it that way rather
than guess from raw SMS. Debts tab entry also stays manual, per that
same discussion — no auto-linking.

## Credit Card bill payment / Wallet top-up — audited and closed 2026-08-10

User asked for a full audit of everything excluded from spend, which
surfaced a real inconsistency: `isCreditCardBillPayment`/`isWalletTopUp`
(both pre-dating Financial Events) already silently excluded these from
the spend total, but neither was excluded from the Need/Want/Saving
question — unlike Rent/EMI/Investment/Lending, which all skip it. First
instinct was to keep asking as a "safety net" in case the detection is
wrong (the credit card one especially — it was flagged as "best-effort,
needs a real-world check" when built, and that check never actually
happened). On closer look at the actual code together with the user,
that reasoning didn't hold: both checks already `continue` past the
*entire* row before it reaches either the spend total OR the
Need/Want/Saving total — so if the detection is wrong, the row is
already hidden from both regardless of whether the question gets asked.
Asking added no real protection, just an extra tap that went nowhere.

Fixed: `getPendingTransactions`/`getTransactionHistory` (`PWA.js`) now
compute `isNonSpendTransfer` (true for either check, debit rows only)
and use it to suppress `suggestedType`; `index.html`'s `showTypeToggle`
in both `buildPendingItem`/`buildHistoryItem` also checks it. Server-side
guard in `saveTransactionNote` too (reads Mode/Reference straight from
the row rather than trusting anything the frontend sends — same defense-
in-depth pattern as the lending/Financial-Event guards). Category is
UNCHANGED — only the Need/Want/Saving question is skipped, since
Category still has some record-keeping value for these (unlike Rent/EMI/
Investment, which have their own dedicated Analysis lines and skip
Category too). Verified with a 6-case Node test using the user's actual
real CRED/PayZapp rows from earlier in the same session.

If the credit card detector's accuracy is ever worth double-checking
(it still hasn't been, formally), the honest way is watching your
Analysis total after a real bill payment — not through this question,
which never told you anything about it either way.

## Frontend UI

`buildFinancialEventHtml(feType, feName, confident, alreadyConfirmed)` and
`setupFinancialEventField(card, preselected, onChange)` — two shared
helpers (near `wireLendingAwareToggle` in `index.html`), used by both
`buildPendingItem` and `buildHistoryItem` so the two never drift apart:
- **Rent/Investment, or a recognized EMI (has a name)** — a plain Yes/No
  chip pair. The Yes button carries `data-fe` (type) and `data-fe-name`
  (EMI's name, blank otherwise).
- **A brand-new EMI (type "EMI", name null)** — a text input + "Mark as
  this EMI" button instead, since there's no name to offer yet.
- Nothing rendered at all when there's no signal — an ordinary
  transaction's card looks exactly like it always has.
- `alreadyConfirmed` (History only) shows a neutral "Financial Event"
  label instead of "Looks like X again," since it's not a fresh guess,
  it's what was actually saved.

`setupFinancialEventField` returns a plain object (`{type, name}`) that
always reflects the current selection — read it at save time rather than
caching, since taps change it. Reuses the shared `wireLendingAwareToggle`
helper (extended 2026-08-10 to take an optional `isFinancialEventSelected`
getter) so the Need/Want/Saving toggle hides for EITHER a lending note OR
a selected Financial Event through one shared `update()` function —
avoids two independent show/hide mechanisms fighting each other (e.g.
typing in the note field re-showing a toggle a Financial Event chip had
just hidden).

The 4th Need/Want/Saving/Investment button ("Investment") was dropped
from `buildPendingItem`/`buildHistoryItem`'s type-toggle — a real
investment is now caught earlier as its own Financial Event, so that
option would never meaningfully get used from here again. **Not yet
applied to Reconciliation or Cash's toggle** — out of scope for this
slice, left as 4 buttons there for now.

## Backend functions

`financialEvents.js`:
- `getFinancialEventsSheet()` — auto-creates the `FinancialEvents` sheet
  if missing, same pattern as `TypeVotes`/`NoteMemory`.
- `amountsMatch(a, b)` — within 5% or ₹50, whichever is larger.
- `matchRecurringFinancialEvent(type, amount, financialEventsData)` —
  true if any row of that Type in the memory sheet is a close amount
  match. Used for Rent/Investment.
- `emiKeywordFromName(name)` — strips the word "emi" out of a name
  ("Laptop EMI" → "laptop") to get the word to look for in a future note.
- `matchRecurringEmi(amount, note, financialEventsData)` — tries every
  confirmed EMI's amount first, then every confirmed EMI's note keyword.
  Returns `{name}` or `null` — see "EMI" section above for why it needs
  two layers where Rent/Investment only need one.
- `suggestFinancialEvent(counterparty, amount, financialEventsData, note)`
  — returns `{type, name, confident}` or `null`. Tries Rent amount match,
  Investment amount match, EMI amount/note match (all confident), then
  falls back to `getFinancialSubtype` (Rent/Investment/home-loan-EMI
  keyword hints, not confident) and a generic whole-word `\bemi\b` check
  (EMI, name `null`, not confident — "some EMI, but which one isn't known
  yet"). `note` is optional — Pending never has one yet, History always
  does; matters much more for EMI/Rent than it used to (see the two
  "Fixed same day" notes above and the EMI section).
- `recordFinancialEvent(type, amount, counterparty, name)` — appends a
  row to `FinancialEvents` after a confirm. `name` only meaningful for EMI.

Changes in `PWA.js`:
- `getPendingTransactions` / `getTransactionHistory` — both read
  `FinancialEvents` once (same "read outside the loop" performance
  pattern as `SmartMemory`/`TypeVotes`) and attach `financialEvent` /
  `financialEventName` (already-confirmed, History only),
  `suggestedFinancialEvent` / `suggestedFinancialEventName`, and
  `financialEventConfident` to each transaction.
- `saveTransactionNote(row, note, category, counterparty, type, amount,
  financialEvent, financialEventName)` — two new parameters. When
  `financialEvent` is present: writes it to `Transactions` column R
  (and, if `financialEvent === "EMI"`, `financialEventName` to column S),
  calls `recordFinancialEvent`, and skips writing column Q (Need/Want/
  Saving) entirely — same exclusion reasoning as `isLendingTransfer`,
  added to the same `if` condition.
- `getTodaySummary` / `getMonthlyAnalysis` — a debit row with column R
  set to `"Rent"` or `"EMI"` is excluded from spend totals and added to
  `fixedObligations`; `"Investment"` is excluded and added to `invested`
  (same `continue` pattern as `isCreditCardBillPayment`/`isWalletTopUp`).
  A lending transfer (`isLendingTransfer`) is now also excluded from
  spend totals this same way (see "Lending" section above). Cash entries
  are NOT covered by any of this — Cash has no bank SMS to detect a
  Financial Event from, kept to plain manual category/type entry as it
  always has been.

## Transactions sheet — new columns

**Column R: `FinancialEvent`.** Blank = not a Financial Event (the
default, unchanged behavior). `"Rent"`, `"EMI"`, or `"Investment"` once
confirmed. Written once, on confirm — never re-guessed later (same
reasoning as column Q's `NeedWantSaving`, see that section of
[need-want-saving.md](need-want-saving.md) for why a stored answer beats
a live re-guess).

**Column S: `FinancialEventName`.** Only meaningful when column R is
`"EMI"` — e.g. `"Laptop EMI"`. Blank for Rent/Investment (only one of
each can exist, so no name is needed to tell them apart).

## `FinancialEvents` sheet schema

Auto-created on first use. One row per confirmation (not one per Type) —
appending only, nothing overwritten, same shape as `TypeVotes`:

| Column | Meaning |
|---|---|
| Type | "Rent", "EMI", or "Investment" |
| Amount | The confirmed amount, used for future matching |
| Counterparty | Whatever was captured — reference only, not matched on |
| Confirmed | Timestamp |
| Name | Only meaningful for EMI (e.g. "Laptop EMI") — blank for Rent/Investment |

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

- **Lending auto-link to Debts** — user explicitly said keep this manual
  for now (2026-08-10); Lending detection itself is unchanged (still
  `isLendingTransfer`, note-based only). Spend-total exclusion is done
  (see "Lending" section above) — the auto-link is the only piece left.
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
