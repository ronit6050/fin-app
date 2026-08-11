# Savings v2 — Emergency / Goals / Free Savings

**Status: live**, shipped 2026-08-11 (`8b058e4` "Rebuild Savings:
Emergency/Goals/Free Savings replaces the 4-pot system"), same-day UI
follow-ups `798c42e` (carousel becomes overview-only) and part of
`0a5dcf5` (tap-again-to-confirm on "Mark Purchased"). Replaces the old
4-pot system (Emergency / WishList / FreeSavings / CCBuffer, built
2026-08-08 and 2026-08-10) — see "What replaced what" and "Old system
— not deleted, dead code" below, both important for whoever picks this
up next.

## What this is

The Savings screen (More → Savings) tracks money set aside outside the
normal spend flow, in three kinds of buckets:
- **Emergency** — locked, target = 3× your monthly expenses (from
  Settings), only meant for real emergencies.
- **Goals** — a flexible list you manage yourself, each either:
  - **OneTime** — a normal savings goal with a fixed ₹ target (what
    Wish List items used to be, e.g. "New Phone, ₹40,000"). One goal at
    a time can be marked **priority** (gets the biggest slice of Auto
    Split — see below).
  - **Recurring** — a goal whose target isn't fixed, it's computed from
    real recent history. Today there's exactly one of these in
    practice: **CC Buffer**, whose target is the average of your last 3
    real credit-card billing cycles' spend (falls back to a flat ₹6,000
    guess until 3 cycles of real data exist). See
    [cc-advisor.md](cc-advisor.md#cc-buffer--a-sinking-fund-for-the-card-bill-2026-08-10)
    for why CC Buffer exists and how CC Advisor uses it.
- **Free Savings** — the default bucket for money with no specific goal
  picked yet (e.g. "just putting some aside").

## Why this replaced the old 4-pot system

The old system (Emergency / WishList / FreeSavings / CCBuffer) had a
real bug, not just a naming gripe: **WishList was one pooled total**,
not one total per item. If you had two wish-list items saved for at
once, the pooled total could make *both* look "ready to buy" off the
same money — there was no way to tell how much of the pool belonged to
which item. Goals fixes this by giving every goal (one-time or
recurring) its own real balance, computed by summing `Savings` rows
whose `Destination` column matches that exact goal's name — no shared
pool.

Along the way this rebuild also added several things the old system
never had at all:
- **Auto Split** — a priority-waterfall breakdown (see below), shown
  *before* saving so you see exactly where money will go, not just
  after.
- **Manual Split** — pick your own destinations and amounts, validated
  to add up exactly to the total entered.
- **Withdraw** — a generic "take money out of any bucket" action; the
  old system had no way to reduce a pot except a hardcoded "Purchased"
  wishlist flow.
- **Edit/delete past entries** — a typo in an old Savings row used to
  need a direct Sheet edit; both are now buttons on the Recent Activity
  list, same pattern History/Cash/Investments already use.

## The waterfall — `computeAutoSplitFromBreakdown_`

Auto Split always fills buckets in this priority order, so the split
changes automatically as your situation changes — you don't have to
remember to switch it yourself:

1. **Stage 1 — Emergency isn't full yet:** 70% Emergency, 20% CC
   Buffer, 10% Free.
2. **Stage 2 — Emergency full, CC Buffer isn't:** 70% CC Buffer, 20%
   your priority goal (0% if you don't have one), 10% Free.
3. **Stage 3 — Emergency and CC Buffer both full:** 90% your priority
   goal (0% if none — the 90% just becomes Free instead), 10% Free.

Free Savings always gets a slice, every stage — it's computed **last**,
as whatever's left over, specifically so rounding never leaves a ₹1-2
gap that doesn't add up to the amount you entered (every other bucket
is `Math.round()`ed first, Free absorbs the remainder).

## Schema

**`Savings` sheet** (existing, columns unchanged from the old system —
only how the `Destination`/pot column is used changed): `Date, Amount,
Type, Note, Destination`. `Destination` is now one of: `"Emergency"`,
`"Free"`, or the exact name of a Goals-sheet row (e.g. `"CC Buffer"`,
`"New Phone"`) — previously it was one of a fixed 4 values
(`Emergency`/`WishList`/`Free`/`CCBuffer`). A negative `Amount` is a
withdrawal (same convention as before). `Type` is `"auto"`, `"manual"`,
or `"withdraw"`.

**`Goals` sheet (new).** Auto-created on first use by
`getGoalsSheet_()` if missing, same pattern as `TypeVotes`/
`FinancialEvents`. Columns: `Name, Type, Target, Status, Priority,
DateAdded`.
| Column | Meaning |
|---|---|
| Name | Goal's display name, e.g. "New Phone" or "CC Buffer" — also the exact `Destination` value used on matching `Savings` rows |
| Type | `"OneTime"` or `"Recurring"` |
| Target | Fixed ₹ target — only meaningful for OneTime (Recurring computes its own target live, this column is blank) |
| Status | `"Active"` or `"Done"` (set by `markGoalDone`/`purchaseGoal`) |
| Priority | `TRUE`/`FALSE` — at most one Active OneTime goal should be `TRUE` at a time (enforced by `setPriorityGoal`, which clears every other OneTime goal's flag when setting a new one) |
| DateAdded | `yyyy-MM-dd` |

**`WishList` sheet** — no longer read or written by anything live (see
"Old system" below). Not deleted.

## Functions — `backend/savingsGoals.js` (new file)

Sheet access:
- `getSavingsSheet_()` / `getGoalsSheet_()` — the latter auto-creates
  `Goals` if missing.

Pure helpers (no sheet access, Node-testable in isolation):
- `sumSavingsByPot_(savingsRows, potName)` — sums `Amount` for rows
  matching a `Destination`.
- `computeCCBufferTargetFromCycles_(cycleTotals, fallback)` — averages
  non-zero cycle totals, or returns the fallback if none have data yet.
- `computeAutoSplitFromBreakdown_(amount, breakdown)` — the 3-stage
  waterfall described above; always returns parts that sum exactly to
  `amount`.
- `validateManualSplit_(amount, rows)` — every row needs a destination
  and a positive amount, and they must sum exactly to the total.

Reading:
- `computeCCBufferTarget_(cyclesToAverage = 3)` — reads `Transactions`,
  buckets real card-mode debit rows into the last N closed 19th→18th
  billing cycles, hands the totals to the pure averager above.
- `getGoalsList_(goalsSheet, savingsRows)` — builds each goal's
  `{row, name, type, target, saved, remaining, canAfford, status,
  priority, dateAdded}`, computing `target` live for Recurring goals.
- `getRecentSavingsEntries_(savSheet, limit=15)` — newest-first, one
  entry per `Savings` row, includes `row` so the frontend can edit/
  delete a specific entry.
- `getSavingsBreakdown()` — the main read, backs the `getSavingsGoals`
  action. Returns `{recentEntries, destinations, emergency,
  emergencyTarget, emergencyDone, free, goals, ccBufferGoal,
  priorityGoalName}`. `destinations` is the valid dropdown list for
  Manual Split/Withdraw/edit-entry: `["Emergency", ...every Active
  goal's name, "Free"]`.

Writing:
- `previewAutoSplit(amount)` / `saveAutoSplit(amount, note)` — preview
  returns the breakdown without writing; save appends one `Savings` row
  per non-zero bucket (`type: "auto"`).
- `saveManualSplit(amount, rows, note)` — validates then appends one row
  per destination (`type: "manual"`).
- `withdrawSaving(bucket, amount, note)` — checks the bucket has enough
  balance first, then appends a negative row (`type: "withdraw"`).
- `purchaseGoal(row, name, amount)` — convenience wrapper for buying a
  OneTime goal in full: withdraws its saved amount (noted "Purchased:
  {name}"), then marks the goal `Done`.
- `updateSavingsEntry(row, amount, note, destination)` /
  `deleteSavingsEntry(row)` — edit/delete a past `Savings` row in place,
  same row-bounds validation pattern used elsewhere (`row` must be a
  real integer between 2 and the sheet's last row).
- `addGoal(name, type, target)` — OneTime requires a positive target,
  Recurring doesn't (its target is always computed live). The very
  first Active OneTime goal you add automatically becomes the priority
  goal.
- `setPriorityGoal(row)` — sets one OneTime goal's Priority to TRUE,
  every other OneTime goal's to FALSE.
- `markGoalDone(row)` — sets Status to `"Done"`, clears Priority.

## PWA actions (`PWA.js`, routed in `handlePwaRequest`)

| Action | Calls | Notes |
|---|---|---|
| `getSavingsGoals` | `getSavingsBreakdown()` | main read, used by the Savings screen |
| `previewSavingsSplit` | `previewAutoSplit(amount)` | shown before Auto Split confirms |
| `saveSavingsAuto` | `saveAutoSplit(amount, note)` | |
| `saveSavingsManual` | `saveManualSplit(amount, rows, note)` | also used by the carousel's quick "Add" action (see below) |
| `withdrawSavings` | `withdrawSaving(bucket, amount, note)` | also used by the quick "Withdraw" action |
| `updateSavingsEntry` | `updateSavingsEntry(...)` | Recent Activity edit |
| `deleteSavingsEntry` | `deleteSavingsEntry(row)` | Recent Activity delete |
| `addSavingsGoal` | `addGoal(name, type, target)` | frontend only ever sends `type: "OneTime"` — there is currently no UI to create a new Recurring goal, see "Open items" |
| `setPrioritySavingsGoal` | `setPriorityGoal(row)` | |
| `markSavingsGoalDone` | `markGoalDone(row)` | |
| `purchaseSavingsGoal` | `purchaseGoal(row, name, amount)` | "Mark Purchased" button, requires a tap-again confirm (`0a5dcf5`) |

`getCCAdvisorData` (`PWA.js`) sources the CC Buffer amount from
`getSavingsBreakdown().ccBufferGoal.saved` (a Recurring Goal) — **not**
from the old `getSavingsData()`/`SavingsAdvisor.js` 4-pot read anymore.
`getDashboardData` computes `savingsGoalsData = getSavingsBreakdown()`
once and passes `ccBufferGoal.saved` straight into `getCCAdvisorData`,
same "read once, pass through" pattern used everywhere else in this
backend.

## Frontend (`index.html`)

- **Carousel** — 3 read-only overview cards (Emergency, CC Buffer, Wish
  List total across all Active OneTime goals), swipe or tap-a-dot only,
  no buttons/arrows inside it (`798c42e`, after the first version felt
  cluttered).
- **Detail list** below the carousel — one tap-to-expand row per
  Emergency / CC Buffer / each Wish List goal / Free Savings, reusing
  the same accordion pattern (`.category-row`/`.category-detail`)
  Analysis and CC Advisor already use. Each row's actions (Add / Add to
  Goal / Mark Purchased / Set Priority / Withdraw) live inside it.
- **Recent Activity** — editable/deletable cards, same pattern as
  History/Cash/Investments.
- **Log a Saving** (the entry form) — Auto Split (default) shows the
  waterfall preview before saving; Manual Split lets you pick your own
  destinations/amounts with exact-sum validation.
- Any save/withdraw/purchase/priority action clears the `cc` and
  `dashboard` caches (`clearSavingsRelatedCaches()`) since CC Advisor's
  affordability math depends on the CC Buffer balance.

## What replaced what (old → new)

| Old (4-pot system) | New (Goals-based) |
|---|---|
| `Emergency` pot | `Emergency` bucket — unchanged, still 3× monthly expenses |
| `WishList` pot (one pooled total) | Goals list, `Type: "OneTime"` — one real balance per item, fixes the pooling bug |
| `CCBuffer` pot | Goals list, `Type: "Recurring"`, `Name: "CC Buffer"` — same purpose, now computed from real billing-cycle history instead of a hand-maintained pot |
| `Free` pot | `Free` bucket — unchanged |
| Manual "Log a Saving" split only (`logSavingFromApp`) | Auto Split (waterfall, previewed first) + Manual Split (your own destinations) |
| No withdraw action | `withdrawSavings` |
| No edit/delete of past entries | `updateSavingsEntry` / `deleteSavingsEntry` |

## One-time migration — `migrateSavingsToV2()`

Run once, manually, from the Apps Script editor (not callable from the
PWA — no action routes to it). Converts a fresh-start data set into the
new shape:
1. Every Active `WishList` item → a OneTime goal (High-priority items
   first, so the cheapest High item becomes the default Auto Split
   priority goal).
2. Adds a Recurring `"CC Buffer"` goal, so the waterfall has Stage 2 to
   fund once Emergency is full.
3. The single un-potted `Savings` row (the user's own "Starting
   balance" row, left over after manually clearing the old pots) gets
   run through Auto Split and replaced with the resulting per-bucket
   rows, same date/type/note preserved.

**Not safe to run twice** — a second run would duplicate every goal and
try to re-split whatever the first run's split turned into. If it's
ever needed again, clear the `Goals` sheet first. As of this doc, the
live `index.html` is fully on the new actions (confirmed via code
search — no `getSavingsGoals`-era screen calls any old action), which
only makes sense if this migration has already been run for the real
data — **not independently re-verified against the live Sheet by this
documentation pass**, worth a quick manual check next time Savings is
touched.

## Old system — not deleted, dead code (flagged 2026-08-11)

The original 4-pot functions are still physically present and still
routed in `PWA.js` (`getSavings` → `getSavingsData()`, `logSaving` →
`logSavingFromApp()`, `logCCBuffer` → `logCCBufferSaving()`,
`addWishlistItem` → `addWishlistItemFromApp()`, `markWishlistPurchased`
→ `markWishlistPurchasedFromApp()`, all still calling
`getSavingsTotals()`/`getSplitRule()` from `SavingsAdvisor.js`) — but
**`index.html` no longer calls any of them**; it only calls the new
`getSavingsGoals`/`saveSavings*`/`withdrawSavings`/`*SavingsGoal`
actions. Nothing currently reachable from the app can trigger the old
code, but it's still callable directly (e.g. by hand-crafting a
request) and its pot math (`Emergency`/`WishList`/`Free`/`CCBuffer`,
the old 4-value `Destination` set) is now stale relative to the real
`Destination` values Goals writes. **Not fixed yet — tracked as a
cleanup item**, see CLAUDE.md's dated note for 2026-08-11. Low risk
(nothing calls it), but worth deleting `getSavingsData`,
`logSavingFromApp`, `logCCBufferSaving`, `addWishlistItemFromApp`,
`markWishlistPurchasedFromApp` and their `PWA.js` action routes once
confirmed truly unused, same as `TypeMemory`'s old sheet was left
renamed-but-not-deleted after that rebuild.

## Fixed 2026-08-11 — `autoLogSaving` now writes to the real Savings system

Found in a documentation pass, fixed the same day. `autoLogSaving()`
(`financialEvents.js` — a note containing "saving"/"savings" on a bank
transaction auto-logs to the `Savings` sheet, see
[financial-events.md](financial-events.md#fixed-2026-08-11--autologsaving-was-writing-the-old-pot-names))
was never updated when this rebuild happened. It used to write
`Destination` values `"Emergency"` / `"WishList"` / `"FreeSavings"` (the
old 3-pot names) instead of this system's real bucket names. Only the
`"Emergency"` portion matched by coincidence — `"WishList"` and
`"FreeSavings"` rows were written to the sheet (money wasn't lost) but
never counted by `getSavingsBreakdown()`, so they silently vanished
from the Savings screen's totals.

**Fix:** `autoLogSaving` now appends a single row straight to
`Destination: "Free"` (same `[Date, Amount, Type, Note, Destination]`
shape `saveAutoSplit`/`saveManualSplit` already use, `Type: "auto"`),
instead of running the old 3-pot split. **Product-intent judgment
call, flagged for the user to correct if they'd prefer differently:**
this deliberately does NOT run the full priority waterfall
(`computeAutoSplitFromBreakdown_`) either, even though that logic is
right there in this same file — a bare note like "saving" doesn't say
*which* goal, and letting it silently route money into locked
Emergency or a specific Goal the user never picked felt like too much
to assume from one word in a transaction note. Free Savings is this
system's own explicit "no specific goal picked yet" bucket, so it's
the closest match to "I don't know where this should go yet." Money
sitting in Free is always one Withdraw + Manual Split away from being
moved to a real goal by hand, same as any other Free Savings money.

No historical data needed fixing — the user confirmed no real
transaction had gone through this path since the Savings v2 rebuild
(only the one-time manual migration had run), so this was a
forward-looking code fix only, nothing to repair retroactively.
Verified with `backend/tests/autoLogSaving.test.js` (checks the new row
lands on `"Free"`, never the old pot names, and that
`getSavingsBreakdown()` — the real Savings screen's data source — then
actually counts it; also re-checks duplicate-avoidance still works).

## Open items / not yet built

- ~~`autoLogSaving` still writes old pot names.~~ **Fixed 2026-08-11 —
  see above.**
- No UI to create a new Recurring goal — `addSavingsGoal` always sends
  `type: "OneTime"` from the frontend. CC Buffer's Recurring goal only
  exists today because the migration script created it; if it were ever
  deleted there's currently no button to recreate one.
- Migration (`migrateSavingsToV2`) hasn't been independently
  re-verified against the live Sheet by this documentation pass — see
  note above.
- Old 4-pot functions/actions are dead code, not yet deleted — see
  "Old system" above.
