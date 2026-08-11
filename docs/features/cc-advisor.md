# CC Advisor — rebuilt 2026-08-10

**Status: live.** Two rounds the same day: the rebuild itself, then a
same-day follow-up adding an early warning for the still-open cycle
(see "Current-cycle early warning" near the bottom — added after the
user tried the rebuild live and pointed out the original version only
ever looked at bills that were already closed).

Rebuilt from a full read-through of the old code after
the user asked for "a drastic change to improve user experience" and
specifically asked to double-check the math was sound first — good
instinct, since that check turned up a real, previously-unknown bug
(see "The bug" below), not just a cosmetic gap.

## Why this exists

User asked for a drastic UX improvement. Before proposing anything,
went through `CCAdvisor.js` and `PWA.js`'s `getCCAdvisorData` in full.
Two scenario questions first, since a good redesign genuinely depended
on facts not in the code:
1. Does the hardcoded "2 cards, ₹25,000 each, one shared 18→9 cycle"
   assumption match the user's real cards? — **Yes**, confirmed. This
   ruled out per-card individual-limit tracking as the priority fix
   (a reasonable-looking direction that would have been the wrong one).
2. What does the user actually want to know when opening this screen?
   — Picked, in order: **can I afford to pay this without hurting next
   month's money** (a completely new idea, not in the old screen at
   all), how much and by when, and where the money's going. Explicitly
   *not* "am I close to maxing out a card" — deprioritized.

That reframed the whole feature: not a spend tracker, an affordability
check.

## The bug — found while double-checking the math, not by design

The old code (`getCCAdvisorData`, `CCAdvisor.js`'s original) only ever
computed ONE cycle — whichever one "today" happens to fall inside — and
called that cycle's close-plus-three-weeks date "Payment due."

That's correct only before a cycle closes (day ≤ 18). Once past the
18th, the code describes the **brand new** cycle that just started,
whose own due date is **two months away** — while the bill that
actually closed and is due soon (in the next ~3 weeks) was never
computed or shown anywhere. Traced through concrete dates to confirm:
on 25 Feb, the old code would show "due 9 Apr" instead of the real
"due 9 Mar" for the bill that closed 18 Feb. This is wrong for roughly
70% of any given month (every day between the 19th and the 9th of the
next month).

Fixed by tracking two cycles explicitly, always:
- **Outstanding** — the most recently closed cycle (19th of two months
  ago → 18th of last month, roughly), whose bill is either awaiting
  payment or already paid. This is the one shown prominently — it's
  the real, near-term obligation.
- **Current** — the cycle running right now, not due yet, shown
  separately and much less urgently (a progress bar, not a hero card).

**Is the outstanding bill actually paid?** Checked by scanning for a
transaction matching `isCreditCardBillPayment` (the same detector
already used to keep Analysis from double-counting a card bill payment
as new spend — built earlier this session, reused here rather than a
second detector) dated any time after the bill's close date. Found →
`isPaid: true`, shown as a quiet confirmation instead of a due amount.
Not found and the due date has passed → `isOverdue: true`, shown more
urgently than a normal "due soon" state.

Verified with an 8-case Node test: the exact bug scenario (25 Feb should
show a Mar 9 due date, not Apr 9), the boundary day itself (18th), the
due date itself (9th), and a year-rollover case (28 Dec) — all before
touching the real deployment.

## The affordability check — the actual "drastic" part

Answers "can I pay this without it hurting next month" directly, using
data the app already has — nothing new to enter:

```
available = cash balance + recent income (last 35 days, Category = "Income")
needed    = outstanding bill + monthly expenses (Settings) + this month's
            Rent+EMI (fixedObligations, from Financial Events — see
            docs/features/financial-events.md) + savings goal (Settings)
net       = available − needed
canAfford = net >= 0
```

- Recent income is derived from existing category-tagged transactions
  (`Category = "Income"`, e.g. Salary) rather than a new Settings field
  — matches the project's "zero interference" habit of reusing data
  already flowing in rather than asking the user to maintain another
  number. Revisit if it proves inaccurate for irregular income.
- `fixedObligations` reuses `getMonthlyAnalysis`'s already-computed
  Rent+EMI total directly when called from `getDashboardData` (which
  computes it anyway for the Analysis tab) — recomputed only when
  `getCCAdvisorData` is called standalone (`getCCAdvisor` action).
- Only computed at all when there's a real, unpaid outstanding bill —
  `null` otherwise (nothing to afford-check against).
- Verified with the exact mockup scenario (cash ₹8,500 + income
  ₹42,000, bill ₹18,200 + expenses ₹30,000 + obligations ₹14,000 +
  savings ₹1,000 → short by ₹12,700) plus a comfortable case and an
  exact break-even edge case, before shipping.

## Frontend — reused existing patterns, not new ones

- Outstanding bill: `.today-total-box` (same hero card style Today/
  Analysis/Savings already use).
- Affordability: a `.category-row`-style card, tap to expand the full
  breakdown (`.category-txn-line` rows, same class already used for
  Analysis's per-category transaction lines) — no new CSS.
- "Where this bill went": **reuses the exact tap-to-expand accordion
  already built for Analysis's category list** (`.category-detail`,
  same show/hide-one-at-a-time logic) rather than the donut chart shown
  in the mockup — the mockup's donut was illustrative of "make it
  interactive," and the already-proven, already-styled accordion
  achieves the same interactivity with no new code to maintain.
- Design shown to the user as an interactive mockup (via the visualize
  tool) before any real code was written, per this project's "show
  before building" rule for UI work.

## Backend — `getCCAdvisorData(txnData, cashData, fixedObligations)`

All three params optional, same fallback pattern as `getCashData`. New
return shape:
- `outstanding: { amount, cycleStart, cycleEnd, dueDate, daysUntilDue,
  isOverdue, isPaid, cardBreakdown, topCategories }` — `topCategories`
  includes `topTransactions` per category (same shape
  `getMonthlyAnalysis`'s `categories` already uses), for the tap-to-
  expand view.
- `affordability: {...} | null` — see above.
- `current: { cycleStart, cycleEnd, spend, projected, projectedPct,
  daysLeft, usagePct, status }` — the not-yet-due, still-running cycle.
- Top-level `cycleSpend`/`limit`/`usagePct`/`status`/`cardBreakdown`/
  `recentCardTxns` **kept unchanged** alongside the new fields — the
  Home dashboard widget only ever read these (the current cycle's own
  numbers) and needed no changes.

`getDashboardData` now passes `cashData` and `month.fixedObligations`
into `getCCAdvisorData` (both already computed there for other tabs) to
avoid a redundant read/recompute — the standalone `getCCAdvisor` action
still works alone, computing both itself when not provided.

## Current-cycle early warning — same-day follow-up

**Why:** the user tried the rebuild live and pointed out a real gap —
the affordability check only ever looked at the bill that had already
closed. Their actual habit: when a new cycle starts, they spend on the
card assuming "I'll set that aside from next salary, like always" —
but with no running check on how big that unbilled amount is getting,
by the time the next salary lands the amount is sometimes bigger than
expected, leaving too little for food/wants. They wanted a warning
*while the cycle is still open*, not only after it closes and becomes
the "outstanding" bill.

An earlier idea (a separate typed-in "monthly investment amount" and a
"wants budget" concept) was proposed and then deliberately dropped —
the user said to keep it simple and stick with the original ask, so no
new Settings field was added.

**What it does:** reuses the exact same `computeAffordability()` check
already built for the outstanding bill, applied to the current cycle's
own numbers instead. Two amounts get checked against the same cash +
recent income vs. expenses + Rent/EMI + savings goal formula:
- **Spent so far this cycle** — the real, already-happened number.
- **Projected full-cycle total** — spend-so-far ÷ days elapsed × days
  in the cycle (same projection math the cycle progress bar already
  used), i.e. "if you keep spending at this pace."

The headline shown uses the **projected** verdict (the early warning —
catches a risky pace before the cycle even closes), while the tap-open
detail shows the real spent-so-far figure too, so the projection is
never presented as if it were already a fact.

**Implementation note:** `getCCAdvisorData` previously computed
cash balance / recent income / fixed obligations only inside the
`if(outstandingSummary.total > 0 && !outstandingPaid)` block, since
only the outstanding-bill check needed them. Moved that computation out
to run unconditionally, and extracted the affordability math itself
into a small `computeAffordability(billAmount)` function so it can be
called three times (outstanding bill, current spend-so-far, current
projected) without repeating the formula. Returns two new fields on
`current`: `affordabilityNow` and `affordabilityProjected`, same shape
as the existing `affordability` field.

Verified with a 4-case Node test reusing the mockup's own numbers (cash
8,500 / income 42,000 / expenses 30,000 / obligations 14,000 / savings
1,000): outstanding bill check unchanged from before, a spend-so-far
case matching the user's own screenshot (₹6,152 → ₹652 short), a
projected case (₹8,390 → ₹2,890 short), and a sanity check that the
projected verdict is never rosier than the spend-so-far one for the
same inputs. `APP_VERSION` bumped to `2026-08-10-15`.

## Savings goal vs Invested — split into two lines (2026-08-10)

User reviewed a real screenshot of the affordability breakdown and
flagged that "Savings goal" and investing are two different things to
them — same distinction the Savings and Investments tabs already keep
separate in the rest of the app, but the affordability check had been
lumping investment money in as if it didn't need to be accounted for
at all (it wasn't in the "needed" total anywhere before this).

Added an "Invested this month" line, kept separate from "Savings goal",
in both the outstanding-bill card and the current-cycle card. Uses this
month's REAL invested amount — the same `invested` figure
`getMonthlyAnalysis` already computes from confirmed Investment
Financial Events (see
[financial-events.md](financial-events.md#auto-linking-to-investmentssavings-tabs-phase-2-added-2026-08-10))
— not a typed-in target. Consistent with the user's own call earlier
the same day to not add a new Settings field for this.

`getCCAdvisorData`'s third parameter changed from a single
`fixedObligations` number to the whole `monthTotals` object (i.e. the
full return value of `getMonthlyAnalysis`, which already has both
`fixedObligations` and `invested` on it) — `getDashboardData` now
passes `month` directly instead of `month.fixedObligations`. When
called standalone (`getCCAdvisor` action, no month data available yet),
both values are recomputed together via one `getMonthlyAnalysis` call,
same fallback pattern as before.

Verified with a 2-case Node test: a real invested amount added on top
of the existing screenshot numbers, and a zero-invested case confirming
existing behavior is unchanged for anyone with nothing logged yet.
`APP_VERSION` bumped to `2026-08-10-16`.

## Monthly investment amount — Settings field added (2026-08-10)

User caught this with a real example: invested ₹3,000 so far this
month, but their actual fixed monthly commitment is ₹9,000 (spread
across the month, not one lump sum). The "Invested this month" line
added just above only ever showed the REAL amount-so-far — early in the
month, or between installments, that understates what's actually
committed, making the affordability check look falsely comfortable.

**Fix:** new Settings field, `monthlyInvestmentGoal` (Script Property
`SETTING_MONTHLY_INVESTMENT_GOAL`, default 0 — a no-op for anyone who
hasn't set it, same pattern as every other Settings field). In the
`needed` math, `computeAffordability` now uses
**`Math.max(investedActual, investedTarget)`** — whichever is bigger:
- Early in the month, before any matching transaction exists:
  `investedActual` is 0, so the fixed target is used — the commitment
  counts even before it's happened.
- If a genuine extra top-up ever exceeds the fixed target in a given
  month, the real (bigger) number is used instead — never undercounted.

Each affordability object now carries `investedActual` and
`investedTarget` alongside the existing `invested` (the resolved,
bigger one — used in the actual math). The frontend's
`formatInvestedLine()` shows both together when a target is set (e.g.
**"₹9,000 (₹3,000 of ₹9,000)"**), or just the plain amount when no
target has been entered yet.

Verified with a 3-case Node test: the user's own numbers (3,000
actual / 9,000 target → uses 9,000), an over-target top-up (12,000
actual / 9,000 target → uses 12,000), and a no-target case confirming
it behaves exactly as before for anyone who hasn't set one.
`APP_VERSION` bumped to `2026-08-10-17`.

## CC Buffer — a sinking fund for the card bill (2026-08-10)

**Why:** the user asked a bigger question after using the rebuilt
screen for a while: "I always pay in full, but at the cost of next
month's salary or my wants — how do I actually fix that?" Researched
general, well-established personal-finance practice (not personalized
advice — see chat for sources): paying in full every cycle is already
the single most important habit (it's what keeps the interest-free
grace period alive), and the standard answer to "irregular costs keep
raiding next month's money" is a **sinking fund** — a small, fixed
amount set aside regularly, specifically earmarked for a known
upcoming cost. That's exactly the habit the user already does manually
(moving the unbilled amount to a separate account) — the goal here is
to bring that habit *into* the app instead of leaving it invisible to
it, which is what caused the "the app doesn't know about my reserved
money" gap flagged a few turns earlier.

**Design, confirmed with the user before building (3 questions):**
1. **Where it lives** — a new 4th Savings pot (`CCBuffer`), alongside
   the existing Emergency / WishList / FreeSavings pots, rather than a
   separate standalone tracker. Reuses the whole Savings screen instead
   of teaching a new one.
2. **How it grows** — manual only, via its own "Add to CC Buffer" form
   (Savings screen) — deliberately NOT part of `logSavingFromApp`'s
   existing auto-split (which only ever divides across the original 3
   pots). Kept manual on purpose while it's a new habit, same reasoning
   as `monthlyInvestmentGoal` starting at a safe no-op default.
3. **Does it count in the afford-this-bill math** — yes. This is the
   whole point: it closes the blind spot where the app could only see
   recent salary and wallet cash, never money already reserved.

**Implementation:**
- `getSavingsTotals` (`SavingsAdvisor.js`) gained a 4th bucket,
  `ccBuffer`, for rows where column E (pot) is `"CCBuffer"` — previously
  anything that wasn't `"Emergency"`/`"WishList"` fell into `"free"` by
  default, so this needed its own explicit branch to avoid silently
  merging into Free Savings.
- New PWA action, `logCCBuffer` → `logCCBufferSaving(amount, note)`,
  appends directly to the `Savings` sheet with pot `"CCBuffer"` —
  deliberately separate from `logSavingFromApp`'s split logic.
- `getCCAdvisorData` gained a 4th parameter, `ccBufferAmount` (optional,
  same fallback pattern as the others — recomputed via `getSavingsData()`
  when not provided). `computeAffordability`'s `available` is now
  `cashBalance + recentIncome + ccBuffer`.
- `getDashboardData` now computes `savings` *before* `cc` (previously
  the other order) so `savings.ccBuffer` can be passed straight into
  `getCCAdvisorData` — no extra sheet read.
- Frontend: a new pot card + "Add to CC Buffer" mini-form on the
  Savings screen; a new "CC Buffer" line (shown as a positive
  contributor, right above "Available") in both the outstanding-bill
  and current-cycle affordability cards. Saving to the buffer clears
  the `cc`/`dashboard` caches, same pattern as a Settings save, since
  it changes CC Advisor's numbers.

Verified with a 3-case Node test: the new pot buckets correctly and
doesn't leak into Free Savings, adding a buffer balance raises
"available" by exactly that amount (re-using the exact numbers from the
user's own screenshot — a buffer of ₹2,500 flips their real "₹935
short" result to "₹1,565 spare"), and a zero-buffer case confirming no
regression for anyone who hasn't started one yet. `APP_VERSION` bumped
to `2026-08-10-18`.

## Open items / not yet done

- Recent-income estimation (35-day Income-category window) hasn't been
  checked against a real, irregular income pattern yet — flagged as a
  possible follow-up if it turns out inaccurate.
- Per-card *individual* limits were deliberately NOT built — the user
  confirmed the combined-pool assumption already matches their real
  cards, so this wasn't the priority. Revisit if that ever changes.
