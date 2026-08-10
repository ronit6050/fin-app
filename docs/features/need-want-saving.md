# Need / Want / Saving / Investment tagging (50/30/20 layer)

**Status: live.** Built, tested, wired into `getPending`/`saveNote` in `PWA.js`, and shown in the Pending screen — confirmed working on the real app 2026-08-08. Backend is now clasp-synced (`D:\fin-app\backend`, see CLAUDE.md), so `needWantSaving.js` is real, current code, not just this description.

**Fixed 2026-08-09 — the type you picked wasn't actually being saved per
transaction.** `saveTransactionNote` only ever fed the choice into
`TypeVotes` (a shared per-merchant pool used for future suggestions) —
nothing recorded what was chosen *for that specific row*. History
displayed a live re-guess instead, which visibly drifted over time as
you answered more transactions for the same merchant (user caught this:
an old "Want" was showing as "Need" once later answers tipped that
merchant's vote balance). Fixed by adding a `NeedWantSaving` column
(column Q) directly on `Transactions`, written whenever a type is saved.
`getTransactionHistory` now reads that stored value instead of calling
`getSuggestedType` — Pending is unaffected (it's correctly still a fresh
guess there, since nothing has been decided yet for an unnoted
transaction). Rows saved before this fix have nothing in that column —
shown with no type pre-selected, not guessed, until next saved.
`insertReconciledTransactions` (`Recon.js`) writes this column too now,
for consistency.

**Extended 2026-08-09** with a 4th tag, **Investment**, and smarter
cold-start guessing — see "Investment as a 4th tag" below. Initially
shipped Pending-only, then corrected the same day: the user clarified
"one feature at a time" means the *tagging system* is the feature, not
one screen — since History and Reconciliation show this exact same
Need/Want/Saving/Investment toggle too (reading the same `suggestedType`
field from the same backend function), leaving them at 3 buttons was an
inconsistency, not a scope boundary. All three (`buildPendingItem`,
`buildHistoryItem`, `buildReviewCardShell` in `index.html`) now show all
4 buttons.

**Redesigned 2026-08-09** from an all-time vote count to a recent-answers
sliding window — see "Why a sliding window, not an all-time count" below.
The old `TypeMemory` sheet (Merchant/AmountBand/NeedCount/WantCount/
SavingCount) is no longer read or written; a new `TypeVotes` sheet
(Merchant/AmountBand/Type/Timestamp, one row per answer) replaced it.
`TypeMemory` itself was left untouched on the Sheet — safe to rename or
delete manually whenever, nothing reads it anymore.

Not yet built: anywhere that actually *shows* the Need/Want/Saving breakdown (a 50/30/20 summary view). Right now this feature only collects the tag and the votes — nothing reads them back yet.

## What this feature is

Every genuine spending transaction gets tagged **Need**, **Want**, **Saving**, or **Investment**, so the app can eventually show a 50/30/20-style budget breakdown. This sits on top of the existing category system (Food, Bills, etc.) but is a separate concept — category answers "what kind of thing was this," this answers "was this necessary, discretionary, money set aside safely, or money invested with market risk."

## Investment as a 4th tag

User caught this 2026-08-09: Saving and Investment are not the same thing, and the app's own other screens already agree — there's a whole separate Savings tab (Emergency/Wish List/Free pots, capital-safe) and a separate Investments tab (SIPs/stocks, market risk). Tagging a mutual fund SIP as "Saving" in Pending contradicted how the rest of the app already treats money. Fixed by adding **Investment** as a genuine 4th type, not a subtype of Saving.

This is Pending-only for now (see status note above) — not yet linked to the actual Investments tab/sheet (that's a *different*, bigger idea — auto-creating an Investments log entry from a recognized transaction — deliberately deferred, see the "PROPOSED PLAN" section in CLAUDE.md, Phase 2). This feature only fixes the *label*, not the cross-tab linking, on purpose — one feature at a time.

## Why it's NOT a fixed category -> type table

The first design attempt was a lookup table (e.g. "Transport = Need", "Food = Want"). Rejected — same category can genuinely be either depending on context:
- A cab ride can be a commute (Need) or a night out (Want).
- A grocery-delivery app order is usually Need, but an occasional ice-cream order from the same app is a Want.
- Financial category alone doesn't say if it's an EMI (Need) or a SIP (Saving).

No category is ever hardcoded to a type. Instead, the system learns per merchant from your own corrections, the same self-learning philosophy already used for category suggestions (see `SmartMemory`).

## Rules, in order

1. **`Transactions.Type = credit`** -> no tag at all. Money coming in (salary, a friend repaying you, a refund) is never "spending."
2. **`Category = Lent`** (or any other debt-settlement-linked category) -> no tag. It's a transfer you expect back, not consumption.
3. **`Category = Other`** (the category engine itself couldn't recognize the counterparty — likely an unrecognized personal UPI transfer) -> no confident default shown. Just ask, every time. Guessing here would train distrust of the suggestion everywhere else.
4. **Everything else** (a genuine, recognized spend) -> look up `Counterparty + AmountBand` in the new `TypeMemory` sheet and suggest whichever of Need/Want/Saving has the most recorded votes for that combination.

## Why "merchant + amount band," not just merchant

A merchant alone is too coarse — e.g. BigBasket is *usually* a Need (grocery run) but *occasionally* a Want (a treat). Splitting by amount range lets the same merchant hold two independently-learned patterns: its typical large-order range and its rare small-order range each vote separately, without any hardcoded split.

Amount bands (fixed, simple, no per-merchant statistics needed):
- Small: < ₹200
- Medium: ₹200–999
- Large: ₹1000–4999
- XLarge: ₹5000+

## Why vote-counting, not a single "confidence score"

The existing `SmartMemory` category memory stores one value + one confidence number per merchant. That design is what let a single bad or unusual entry silently overwrite or pollute the learned answer (see the 2026-08-08 SmartMemory cleanup in CLAUDE.md). `TypeVotes` avoids that: every confirm/correction is recorded as its own row, nothing is ever overwritten. One odd ice-cream order from BigBasket doesn't wipe out the pattern for every other order — it's just one more row sitting alongside the rest.

## Why a sliding window, not an all-time count

The original design (still described in the "vote-counting" heading above) kept an all-time running total per merchant+band forever — a vote from months ago counted exactly as much as one from today, with no way for it to fade. That broke down in a very real way on 2026-08-09: the user cleared a 249-item transaction backlog in one sitting and, since most of it was too old to actually remember, answered "Want" for the large majority of it as a guess rather than a real answer. Under the old all-time-count design, that block of guesses would have permanently outweighed every future, careful, real-time answer for those same merchants.

The fix: `getSuggestedType` now only looks at your **last `TYPE_VOTE_WINDOW` (5) answers** for a given merchant+band, not your entire history. Practically:
- A backlog-clearing session's guesses only matter until you've answered that same merchant 5 more times for real — then they fall completely out of the window and stop influencing anything.
- A merchant you answer consistently (a restaurant that's always "Want") still gets a fast, confident suggestion — it just takes 5 answers to fully "own" the window instead of accumulating forever.
- This is why `TypeVotes` had to become one-row-per-answer (with the sheet's natural append order used for recency, not the `Timestamp` column — see the code comment in `getSuggestedType` for why: two answers saved close together can land in the same millisecond, which would make a date-comparison sort unreliable. Row position is always unambiguous since `recordTypeVote` only ever appends).

## Cold start (a merchant+band combo seen for the first time, zero votes)

Two layers, in order:

1. **`getFinancialSubtype(counterparty)`** — recognizes a small, deliberately narrow set of financial instruments directly from the transaction text (not from Category — SmartMemory's `subcategory` field is never actually populated with anything meaningful in the PWA flow today, `handleCategoryCorrection` always hardcodes it to `"Other"`, so it couldn't be used as a signal here even if we wanted to). Recognized: `rent`, `homeLoanEmi` → suggest **Need**; `saving` (PPF/fixed deposit/recurring deposit) → suggest **Saving**; `investment` (mutual fund/SIP/stock/Zerodha/Groww/NPS) → suggest **Investment**; `insurance` → suggest **Need**.
2. If nothing recognized, falls back to the old flat **Need** default.

**Why plain EMI is deliberately NOT in that recognized list** (only the specific phrase "home loan"/"housing loan" is): unlike rent, what an EMI is *for* varies completely — a TV EMI and a home loan EMI are not the same kind of spend, and guessing would often be wrong (user caught this exact mistake in an earlier draft of this plan, where "Rent/EMI = Need" was proposed as one rule). Plain EMI falls through to the flat Need default, then behaves exactly like everything else from there — see point 2 below.

**Critical property: this guess is ONLY a starting point, never a permanent override.** Once there's real answer history for that specific merchant+band (`matches.length > 0` in `getSuggestedType`), the vote-count from actual answers is used instead, even if it disagrees with the subtype guess — e.g. an insurance policy you've personally tagged "Investment" twice will keep suggesting Investment, not snap back to Need. This was a deliberate design choice, not an oversight — a hard-coded rule immune to real behavior would repeat the exact mistake the sliding-window redesign (above) already fixed once for Need/Want/Saving generally. See `testNeedWantSaving()`'s Test 12 for this exact scenario, verified with a standalone Node run before shipping.

## Two separate places the type lives — don't confuse them

- **`Transactions` column Q (`NeedWantSaving`)** — the actual, committed answer for *one specific transaction*. What History/Pending/Reconciliation display and pre-select. Never used to compute a suggestion for anything else.
- **`TypeVotes` sheet (below)** — a shared per-merchant+band *learning pool*, used only to guess a default for the *next* unanswered transaction from that merchant. Never displayed as-is; always fed through `getSuggestedType`'s recent-5 window first.

Saving a type writes to both, for different reasons: column Q so that specific row remembers its own answer forever, `TypeVotes` so future transactions from that merchant get a better cold-start guess.

## `TypeVotes` sheet schema

Auto-created by the code the first time it's needed (same pattern `AILogs`/`NoteMemory` already use) — no manual sheet setup required. One row per answer, not per merchant:

| Column | Meaning |
|---|---|
| Merchant | Counterparty name, same key `SmartMemory` uses |
| AmountBand | Small / Medium / Large / XLarge (see above) |
| Type | Need / Want / Saving / Investment — whichever was chosen |
| Timestamp | When this answer was saved (for reference only — the sliding window uses row order, not this column, see below) |

## Functions

Live in `needWantSaving.js` (source of truth — read the actual file, not just this doc):
- `getAmountBand(amount)` — unchanged.
- `getFinancialSubtype(counterparty)` — new. Keyword-matches a handful of financial instruments directly from the transaction text; used only by `getSuggestedType`'s cold-start path, never anywhere else.
- `getTypeVotesSheet()` — returns the `TypeVotes` sheet, creating it with headers if missing.
- `getSuggestedType(txnType, category, counterparty, amount, typeVotesData)` — rules 1-3 unchanged (credit/Lent/Other all return `null`); cold start (no matching rows yet) now consults `getFinancialSubtype` before falling back to flat Need; once real answers exist, takes the merchant+band's most recent `TYPE_VOTE_WINDOW` (5) answers and returns whichever of Need/Want/Saving/Investment appears most among just those. `typeVotesData` is optional, same batching reasoning as before. Signature unchanged from the previous version — callers in `PWA.js`/`Recon.js` needed no changes.
- `recordTypeVote(counterparty, amount, chosenType)` — unchanged; just appends one row, now potentially with `"Investment"` as the type.

## Open items / not yet decided

- Whether `Category = Other` should ever get a type once the user manually assigns a real category in the same Pending action (order-of-operations question, revisit once UI is wired up).
- Whether more categories besides `Lent` should be treated as debt-settlement-excluded — revisit once real usage surfaces examples.
- Whether `TYPE_VOTE_WINDOW` (5) is the right size — revisit if suggestions feel too twitchy (lower it) or too slow to adapt (raise it) once there's more real usage to judge by.
- `getFinancialSubtype`'s keyword list is intentionally small/conservative (e.g. bare "fd"/"rd" deliberately excluded, unlike the general category engine's looser matching, to avoid false positives) — revisit if real transactions reveal it's missing obvious cases.
