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

## Open items / not yet done

- Recent-income estimation (35-day Income-category window) hasn't been
  checked against a real, irregular income pattern yet — flagged as a
  possible follow-up if it turns out inaccurate.
- Per-card *individual* limits were deliberately NOT built — the user
  confirmed the combined-pool assumption already matches their real
  cards, so this wasn't the priority. Revisit if that ever changes.
