# Need / Want / Saving tagging (50/30/20 layer)

**Status: live.** Built, tested, wired into `getPending`/`saveNote` in `PWA.js`, and shown in the Pending screen — confirmed working on the real app 2026-08-08. Backend is now clasp-synced (`D:\fin-app\backend`, see CLAUDE.md), so `needWantSaving.js` is real, current code, not just this description.

**Redesigned 2026-08-09** from an all-time vote count to a recent-answers
sliding window — see "Why a sliding window, not an all-time count" below.
The old `TypeMemory` sheet (Merchant/AmountBand/NeedCount/WantCount/
SavingCount) is no longer read or written; a new `TypeVotes` sheet
(Merchant/AmountBand/Type/Timestamp, one row per answer) replaced it.
`TypeMemory` itself was left untouched on the Sheet — safe to rename or
delete manually whenever, nothing reads it anymore.

Not yet built: anywhere that actually *shows* the Need/Want/Saving breakdown (a 50/30/20 summary view). Right now this feature only collects the tag and the votes — nothing reads them back yet.

## What this feature is

Every genuine spending transaction gets tagged **Need**, **Want**, or **Saving**, so the app can eventually show a 50/30/20-style budget breakdown. This sits on top of the existing category system (Food, Bills, etc.) but is a separate concept — category answers "what kind of thing was this," this answers "was this necessary, discretionary, or money set aside."

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

Defaults to **Need** — a single neutral fallback, not category-based, so no category-to-type assumption sneaks back in through the back door. This only matters for the first transaction in that merchant+band bucket; after you confirm or correct it once, real votes take over.

## `TypeVotes` sheet schema

Auto-created by the code the first time it's needed (same pattern `AILogs`/`NoteMemory` already use) — no manual sheet setup required. One row per answer, not per merchant:

| Column | Meaning |
|---|---|
| Merchant | Counterparty name, same key `SmartMemory` uses |
| AmountBand | Small / Medium / Large / XLarge (see above) |
| Type | Need / Want / Saving — whichever was chosen |
| Timestamp | When this answer was saved (for reference only — the sliding window uses row order, not this column, see below) |

## Functions

Live in `needWantSaving.js` (source of truth — read the actual file, not just this doc):
- `getAmountBand(amount)` — unchanged.
- `getTypeVotesSheet()` — returns the `TypeVotes` sheet, creating it with headers if missing.
- `getSuggestedType(txnType, category, counterparty, amount, typeVotesData)` — rules 1-3 unchanged (credit/Lent/Other all return `null`); rule 4 now takes the merchant+band's most recent `TYPE_VOTE_WINDOW` (5) answers and returns whichever of Need/Want/Saving appears most among just those. `typeVotesData` is optional, same batching reasoning as before.
- `recordTypeVote(counterparty, amount, chosenType)` — now just appends one row; no more find-and-increment.

## Open items / not yet decided

- Whether `Category = Other` should ever get a type once the user manually assigns a real category in the same Pending action (order-of-operations question, revisit once UI is wired up).
- Whether more categories besides `Lent` should be treated as debt-settlement-excluded — revisit once real usage surfaces examples.
- Whether `TYPE_VOTE_WINDOW` (5) is the right size — revisit if suggestions feel too twitchy (lower it) or too slow to adapt (raise it) once there's more real usage to judge by.
