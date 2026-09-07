# Planner (Phase 1 + Overview) — per-category monthly spend targets

**Status: LIVE as of 2026-09-07** (backend `clasp deploy`ed to `@313`,
frontend `git push`ed to GitHub Pages). Backend lives in
`backend/planner.js`, wired into `handlePwaRequest` (`PWA.js`) as two
actions: `getPlannerData` and `saveBudgets`. Frontend lives under
More → Tools → Planner — see "Frontend" section below for what actually
shipped. Built 2026-08-18 (per-category targets), extended 2026-09-07
(the Overview below) — both pieces shipped together in one deploy, per
the user's own call to hold them until both were ready.

**Overview (income + bucket totals + 50/30/20 reference) — backend and
frontend both built 2026-09-07, reviewed by `change-reviewer`, and live
the same day.** See "Overview" section below for the backend shape, and
"Frontend — Overview card" further down for what actually shipped on
screen. This is new, on top of the per-category work above, inspired by
the user's own pre-automation manual budget sheet.

**Plain-English summary:** you set a spend TARGET per category for the
month (e.g. "Food: ₹8,000"), and the app tracks how much you've actually
spent against it as the month goes. For a category where your own past
answers show you sometimes spend on it out of real need and sometimes
just because you want to (e.g. Food covers both groceries and eating
out), it splits into two separate targets — Need and Want — instead of
one blended number. The starting target isn't picked by hand either —
it's suggested from your own real spending history.

## New sheet: `Budgets`

One row per target. Columns: `Month` (`YYYY-MM`), `Category`, `Type`
(`Need`, `Want`, or blank meaning "one whole-category target, not
split"), `Target`. Auto-created (with just the header row) the first
time anything asks for it — same pattern as `InvestmentInstruments`
(`investmentInstruments.js`) / `Goals` (`savingsGoals.js`).

`saveBudgets` always does a **full replace** for that month: every
existing row for the month is deleted first, then the new set is
appended. This means saving is never additive/duplicating — the second
time you save a month's plan, the first version is completely gone, not
still sitting there as stale extra rows.

## Which categories are considered at all

`PLANNER_CATEGORIES` = every key in `category.js`'s own `SMART_CATEGORIES`
list **minus `Income`** (Income isn't spend). This is computed from that
real list directly, not a separately hand-typed copy — if the app's
category list ever changes, Planner automatically stays in sync. As of
2026-08-18 that's 9 categories: Food, Transport, Bills, Shopping,
Lifestyle, Financial, Education, Health, Other.

## Which categories show as "split" (separate Need + Want targets)

**Computed from real data, never hand-picked.** A category shows as
split only if your own transaction history has actually shown BOTH a
Need-tagged AND a Want-tagged spend in it. If it's only ever shown one
of the two (or has no history at all yet), it stays a single target —
tagged with whichever type it actually has, or untagged (`type: null`)
if there's genuinely no history yet.

This is checked across the **entire reliable window** (see "Why August
2026 is the cutoff" below) — from 2026-08-01 through today — not just
the narrower window used for the suggested amount (see next section).
Deciding "does this category structurally split" is a one-time-ish
question that benefits from as much real history as exists; the
suggested *amount*, on the other hand, deliberately stays recent so it
reflects how you're spending lately, not months-old habits. **This is a
judgment call, not something explicitly specified — worth flagging**:
it means the split/type flags a category shows are the same no matter
which month you're looking at in Planner (always anchored to "today"),
while the actual-spend numbers (see below) are always for whatever month
you actually asked about.

## Why August 2026 is the reliability cutoff

The Need/Want/Saving/Investment tagging system (`needWantSaving.js`,
[docs/features/need-want-saving.md](need-want-saving.md)) didn't exist
before August 2026, and had real bugs fixed as late as 2026-08-09/10 (the
sliding-window redesign, the lending-substring false-positive bug, the
counterparty-gating bug — see that doc's history and `CLAUDE.md`'s
Automation-phase section). Any tag on a transaction from before then
can't be trusted. `PLANNER_RELIABLE_START = { year: 2026, month: 8 }` in
`planner.js` is the one place this is defined — written as a plain date,
not an "if it's August" special case, so nothing here needs touching
again as real months pass.

## The suggested target formula

1. **Prefer averaging up to the last 3 COMPLETE reliable months** — a
   month only counts once it's genuinely finished, never the current
   in-progress one, even on its last day.
2. **Right now (2026-08-18), there are zero complete reliable months
   yet** — August itself, the reliable window's very first month, is
   still in progress. Falls back to: sum real reliable spend so far this
   month per category (and Need/Want sub-split), divide by days elapsed
   so far, multiply by the number of days in the month — a scaled
   full-month estimate. **Never returns a blank suggestion**, even with
   almost no data yet.
3. As real complete months accumulate (September, then October, then
   November...), the suggestion naturally shifts to averaging those
   instead — no manual update needed. Once more than 3 complete months
   exist, only the most recent 3 are used (the oldest drops off).

This logic lives in `computeSuggestedTargets_` /
`getCompleteReliableMonths_` in `planner.js`. Verified in
`backend/tests/planner.test.js` with two separate scenarios: "today" is
still in August (zero complete months, scaled-fallback path) and "today"
is months later (averaging path, including the exact drop-the-oldest
behavior once a 4th complete month exists).

## Reusing the existing spend-exclusion rules

`computeCategoryTypeBreakdown_` (the one shared function behind both the
suggestion and the actual-spend numbers) applies the exact same
exclusions `getMonthlyAnalysis` (`PWA.js`) already does, calling the
same functions directly rather than reimplementing them:
- `isCreditCardBillPayment` — a card bill payment isn't new spend, the
  swipe was already counted.
- `isWalletTopUp` — moving money into your own wallet isn't spend yet.
- `isLendingTransfer` — a loan/repayment isn't spend, you expect it back.
- A confirmed Financial Event (Rent/EMI/Investment, column R) — tracked
  separately, never blended into ordinary category spend.

This matters specifically because this project has hit and fixed real
double-counting bugs in each of these categories before (see `CLAUDE.md`'s
history) — Planner reuses the same guarded functions instead of risking
reintroducing any of them.

## Actual spend so far this month (the Track view)

Straightforward and **not** restricted to the reliable window — asking
about a month before August 2026 still shows that month's real spend
honestly (any tags found are used if present, anything untagged falls
into `actual.untagged`). Only the *suggested* target and the *split*
decision are restricted to reliable months; the actual-spend total is
always just real data for whatever month was asked. Verified directly in
`planner.test.js` by requesting June/July 2026 and confirming their real
(pre-tagging-system) spend still shows up correctly.

## Overview — the "big picture" (added 2026-09-07)

Inspired by the user's own pre-automation manual budget sheet: every
month they started from total income, decided how much should go to
Needs / Wants / Savings as three big slices, checked their real split
(e.g. 60% / 15% / 25%) against the standard 50/30/20 rule of thumb, and
kept a running "Bal" (unallocated leftover) per slice that should hit
zero. The per-category Planner above is genuinely better at the
category level (auto-learned Need/Want split, suggested from real
history) but was missing that big-picture view entirely — no income
figure, no bucket-level rollup, no reference comparison, no "does this
add up" check.

`getPlannerData`'s response now also includes an `overview` object:

```json
"overview": {
  "income": { "actual": 55000, "saved": 50000 },
  "targets": { "needs": 6340, "wants": 6820, "savingsInvestment": 1000 },
  "referenceSplit": { "Need": 0.5, "Want": 0.3, "SavingsInvestment": 0.2 },
  "unallocated": 35840,
  "actual": { "needs": 1000, "wants": 1100, "savingsInvestment": 0, "untagged": 1000 }
}
```

- **`income.actual`** — real Income-tagged bank credits received in the
  requested month (same rule `getCCAdvisorData`'s own "recentIncome"
  already uses, just for a whole calendar month). **`income.saved`** —
  an optional manual override (`null` if never set) for planning ahead
  of a salary that hasn't landed yet. Both are always shown, never
  blended into one number — same "don't hide the real numbers" rule
  this app follows elsewhere.
- **`targets.needs`/`targets.wants`** — the sum of whatever's currently
  being PLANNED per category (saved if you've saved one, else the
  suggestion) for every category with a real Need or Want portion. A
  category with no reliable history yet (`type: null`, not split)
  contributes to neither bucket — never silently guessed.
- **`targets.savingsInvestment`** — pulled straight from Settings'
  `monthlySaveGoal` + `monthlyInvestmentGoal` (per the user's own call:
  one place manages this number, not a second parallel one in Planner).
- **`referenceSplit`** — the fixed 50/30/20 rule of thumb, shown only
  for comparison, never enforced. Not user-editable yet.
- **`unallocated`** — `(income.saved ?? income.actual) - (targets.needs + targets.wants + targets.savingsInvestment)`.
  The single-number version of the old sheet's per-bucket "Bal" row —
  since Needs/Wants totals are already auto-summed from category
  targets, one number for the whole plan is enough.
- **`actual`** — real spend so far this month by type (Need/Want/
  Saving+Investment/untagged), summed across every category, for the
  Track view. Uses the same raw per-category breakdown the category
  list already computes — no extra Sheet read.

### Saving the income override

`saveBudgets` gained an optional third field, `income`, alongside the
existing `month`/`budgets`:

```json
{ "action": "saveBudgets", "idToken": "...", "month": "2026-08",
  "budgets": [ { "category": "Transport", "split": false, "target": 2000 } ],
  "income": 50000 }
```

**Three-way, deliberately not just "present or not"**: leaving the
`income` field out of the request entirely means "this save isn't
touching income" — a previously-saved override, if any, is left
completely alone. Sending `null` explicitly clears it (falls back to
`income.actual` again). Sending a number saves/replaces it. This
matters because income and category targets are edited from the same
screen but are conceptually separate things — **the frontend must
always send the current income value on every save** (whatever's
showing in the income input) so tweaking one category's target can
never accidentally wipe out a saved income figure just because that
particular save happened not to mention it.

Verified in `backend/tests/planner.test.js`, Scenario D: actual vs.
saved income shown separately, targets/unallocated recompute correctly
once an override is saved, a category-only save leaves a previously-
saved income untouched, an explicit `null` clears it, and a negative
income is rejected before anything writes.

## Action contracts (for the frontend build)

### `getPlannerData`

Request:
```json
{ "action": "getPlannerData", "idToken": "...", "month": "2026-08" }
```
`month` is optional — defaults to the real current month if missing or
invalid.

Response:
```json
{
  "ok": true,
  "planner": {
    "month": "2026-08",
    "reliableSince": "2026-08",
    "suggestionSource": "scaledPartialMonth",
    "monthsAveraged": null,
    "categories": [
      {
        "category": "Food",
        "split": true,
        "type": null,
        "suggested": { "need": 4340, "want": 6820, "total": 11160 },
        "saved":     { "need": 5000, "want": 4000, "total": 9000 },
        "actual":    { "need": 700, "want": 1100, "untagged": 0, "total": 1800 }
      },
      {
        "category": "Transport",
        "split": false,
        "type": "Need",
        "suggested": { "total": 1860 },
        "saved": null,
        "actual": { "total": 300 }
      }
    ]
  }
}
```
- `suggestionSource` is `"average"` (with `monthsAveraged` set to how
  many, 1-3) or `"scaledPartialMonth"` (with `monthsAveraged: null`).
- `split: true` categories have `need`/`want` on `suggested`/`saved`/
  `actual`; `split: false` categories only have `total` on `suggested`/
  `saved` (plus `total` — and only `total` — on `actual` too).
- `saved` is `null` whenever nothing has been saved for that category
  this month yet — never a fabricated 0.
- `type` is `null` for a split category, `"Need"`/`"Want"` for a
  single-type category with real history, or `null` if there's no
  reliable history for it at all yet.

### `saveBudgets`

Request:
```json
{
  "action": "saveBudgets",
  "idToken": "...",
  "month": "2026-08",
  "budgets": [
    { "category": "Food", "split": true, "need": 5000, "want": 4000 },
    { "category": "Transport", "split": false, "target": 2000 }
  ]
}
```
Only send the categories you actually want to save — anything omitted
simply isn't in the new plan (it'll show `saved: null` next time, same
as never having saved it before this call). Every field is validated
server-side (unknown category, negative amount, invalid month all get
rejected with `ok:false` before anything is written — an all-or-nothing
save, so one bad line never half-overwrites a month's existing plan).

Response:
```json
{ "ok": true, "saved": 3 }
```
or
```json
{ "ok": false, "error": "Enter a valid Need and Want target for Food." }
```

## Verification

`backend/tests/planner.test.js` — reliable-month cutoff (unreliable
June/July data never leaks into the suggestion, even at 90,000+), the
zero-complete-months scaled fallback, split-vs-single-type detection,
every exclusion rule (CC bill payment / wallet top-up / lending / a
Rent Financial Event) proven NOT double-counted, actual spend for a
pre-reliability month, multi-month averaging with the "drop the oldest
past 3" behavior, and `saveBudgets`' full-replace-not-append behavior
plus its validation. Full existing suite (`backend/tests/*.test.js`, 9
files) re-run and still passes.

## Frontend — built 2026-08-18 (`index.html`), live since 2026-09-07

Lives under More → Tools → Planner (a new icon tile, not a 5th bottom-nav
tab — the nav stays at 4). Two views, switched with the same `.view-toggle`
pill pattern Analysis already uses for its Category/Need-Want-Saving
toggle:

- **Set targets** — one card per category (`categoryBadgeHtml` for the
  icon/name, same as everywhere else category names show). A `split:
  true` category renders two indented rows, "Need" and "Want" — plain
  labels, never a fabricated sub-description, per the task's own
  instruction. A `split: false` category with a real `type` shows a
  small colored tag (reusing `--need-bg`/`--need-text` or `--want-bg`/
  `--want-text`, the same tokens the type-toggle buttons already use) —
  no tag at all when `type` is `null`. Every input pre-fills from `saved`
  if it isn't `null`, otherwise from `suggested`; a small muted caption
  under each category explains the suggested number in plain English
  ("a rough early estimate... there isn't a full month of data yet" for
  `scaledPartialMonth`, "based on your last N full months" for
  `average`) — never the raw `suggestionSource` string. A running total
  card sums every visible input live on `input`. "Save plan" is
  optimistic (same trade-off as Cash/Debts/Investments/History's own
  Save/Add buttons) — updates `saved` on screen immediately, reverts
  with a clear error if `saveBudgets` actually fails in the background.
- **Track progress** — a hero card (`.today-total-box`, the same
  `--surface-hero`/`--text-on-hero` tokens every other hero card uses)
  showing total actual spend vs. total saved target with a thin progress
  bar, then one `.category-row` block per category: a parent rollup bar
  in that category's own `--chart-{category}` color, plus (for split
  categories only) two indented sub-bars using the existing `--chart-
  need`/`--chart-want` tokens — no new color tokens added anywhere. A
  bar at or over 90% of its target turns `--chart-warning` (a "Close to
  your ... target" `.status-pill warning`); over target turns `--chart-
  danger` (an "Over by ₹X" `.status-pill danger`) — mirrors CC Advisor's
  own usage-bar status logic (`plannerBarStatus`/`plannerBarColor`,
  named deliberately close to `ccUsageBarEl`'s own comment for anyone
  cross-referencing the two).
- **Default view**: if nothing is saved yet for the month being viewed
  (every category's `saved` is `null`), opens on Set targets; once a
  plan exists, opens on Track progress. Re-decided once per month
  (`plannerViewDecidedForMonth`), so re-rendering the same month (after
  Save, or a background cache refresh) never yanks you back to a view
  you weren't on — same "don't clobber what the user just did" rule
  Analysis's own payment-mode toggle already follows.
- **Month switching** reuses the exact `.month-switcher` pill markup/CSS
  Analysis already has (own copy of the two arrow buttons + label, own
  `plannerYear`/`plannerMonth` state) — calls `getPlannerData` again with
  the new month, cached per-month the same way (`planner_YYYY-MM`).
- **Demo Mode**: `demoComputePlannerData`/`demoSaveBudgets` (a small JS
  mirror of `backend/planner.js`'s own split-detection, scaled-partial-
  month suggestion, and full-replace save, reading `demoState.transactions`/
  `.cash`/`.budgets` instead of Sheets) let Planner be tried from Settings
  → View Demo Mode. The pretend dataset's seeded `budgets` deliberately
  shows: Food — saved, split, already over budget on both Need and Want;
  Bills — saved, split (a real card-tagged "Want" bill pushed it into
  split), Need near its limit and Want just over; Transport — saved,
  non-split, comfortably under; Lifestyle — split with no saved plan yet
  (shows the suggestion instead); Shopping/Health/Financial/Education/
  Other — unsaved, Shopping/Health also showing a real Need/Want tag
  from genuine (untouched) demo history.

### Verification

Live browser interaction could **not** be fully confirmed this session —
a more severe version of this project's already-documented preview-pane
limitation (see CLAUDE.md's redesign notes): `screenshot` timed out
("the Browser pane is not displayed") on both a `file://` open and a
local `http://localhost` dev server, and — new this session — even
ref-based clicks failed (every element reported an empty (0,0) bounding
box despite the page itself reporting a real, non-zero viewport size),
and a `file://` open additionally disabled `localStorage`/cookies
entirely (sandboxed as a `data:` URL), which crashes this app's own
Firebase-push-setup line before anything else on the page can run.
Given that, verification instead relied on: a Node syntax check of both
`<script>` blocks and a CSS brace-balance check; confirming the real
sign-in screen (including the live cross-origin Google button iframe)
renders with zero console errors on the local dev server; confirming
every new element ID referenced in JS has a matching HTML ID (no typos)
via the accessibility tree; and — the most substantive check — actually
executing the real, unmodified functions from `index.html`
(`demoComputePlannerData`, `demoSaveBudgets`, `buildPlannerTrackRow`,
`buildPlannerSubBar`, `plannerBarStatus`/`plannerBarColor`, and the Save
button's payload-building logic) directly in Node against the real
seeded demo dataset, with minimal stubs only for genuine DOM calls
(`document.createElement`, `categoryBadgeHtml`, `escapeHtml`) — not a
reimplementation. This caught one real bug before it shipped: the first
version of the demo seed saved Bills as a single non-split target, but
Bills' own demo history actually has both Need- and Want-tagged spend
(a card-paid broadband bill), so the backend's own documented rule
("a category saved as non-split, but now detected as split, surfaces
nothing rather than guessing") correctly made that saved target
disappear — fixed by re-seeding Bills as a proper split Need/Want
target instead of asserting around the real behavior. The resulting
Track-view HTML was confirmed correct for every category (correct
over/near/healthy status, correct `₹` math, correct color tokens), and a
full save → reload round-trip through the real `demoSaveBudgets` was
confirmed to persist exactly what was sent, split and non-split alike.
Real on-device / live-browser visual confirmation in both light and
dark mode is still owed, the same way this project's past dark-mode
repaint checks and the 2026-08-12 optimistic-save pass were both
flagged rather than claimed.

### Post-review fixes (2026-08-18, same day)

`change-reviewer` checked the diff before it could ship and found two
real issues, both fixed:

1. **The Track view's main progress bar rendered at 0px height.**
   `.category-bar-track`/`.category-bar-fill` only had their
   height/border-radius set by a `.category-row .category-bar-track`-
   scoped rule — the hero card's own bar (`#plannerTrackBar`, inside
   `.today-total-box`, not `.category-row`) fell outside that scope, so
   the empty divs had no intrinsic height. **The exact same shape of bug
   was already sitting unnoticed in the live Savings screen's own hero
   card** (`.today-total-box` > `.category-bar-track`, same pattern,
   already shipped, pre-dating this feature entirely) — confirmed via a
   `git show HEAD:index.html` check, not assumed. Fixed at the root: a
   new base `.category-bar-track`/`.category-bar-fill` rule (no
   `.category-row` scoping required) sets height/border-radius
   generically, so both Planner's bar and the pre-existing Savings one
   are now covered by the same one fix — the more specific
   `.category-row`-scoped rule still applies on top for its own
   background color, unchanged. **Verified empirically, not just by
   reading the CSS**: loaded the real page in the browser preview tool,
   measured `#plannerTrackBar`'s parent via `getComputedStyle`/
   `offsetHeight` before (height resolved to `auto`, 0px rendered) and
   after (height resolved to a real `12px`) the fix — also caught and
   cleared a stale service worker that was silently serving the OLD
   cached CSS on first reload, which briefly looked like the fix hadn't
   worked until the cache was cleared.
2. **A split category's untagged spend (tagged Saving/Investment, or not
   tagged at all yet) wasn't shown anywhere**, so the parent rollup bar's
   total could be visibly bigger than its Need + Want sub-bars added
   together with no explanation why. Fixed with a small note under the
   two sub-bars whenever `c.actual.untagged > 0` ("₹X of this isn't
   tagged Need or Want yet, so it's not counted in either bar below") —
   same "don't let the numbers silently not add up" rule this app
   already follows elsewhere (History's "note saved but type wasn't"
   messaging).

Both fixes are frontend-only (`index.html`), no backend change needed.

## Frontend — Overview card (built 2026-09-07, `index.html`)

A new `#plannerOverviewCard` sits above the per-category list, ABOVE the
Set targets/Track progress toggle, so it's visible no matter which
sub-view is open — its content is fully rebuilt (`renderPlannerOverview`)
every time the view is switched or the month reloads, since Set and Track
show genuinely different things, not two visibility-toggled copies of the
same markup.

- **Set targets** — an editable "Monthly income" input (reuses the
  standard `.field` + global filled-input look, just with a ₹ sign
  overlaid via a new `.planner-income-input-wrap`/`.planner-income-
  currency` pair) prefilled from `overview.income.saved` if not null,
  else `overview.income.actual`, with a caption underneath ("your own
  figure." vs. "using your real income so far this month.") that flips
  the instant you start typing. Below it, one row per bucket (Needs/
  Wants/Savings + Investment) showing ₹ + % of whatever's currently in
  the income box, a bar in that bucket's own color, and a thin vertical
  `.planner-ref-marker` tick showing where the fixed 50/30/20 reference
  sits on the same bar (`.planner-ref-track` just adds `position:
  relative` on top of the existing `.category-bar-track`/`.category-bar-
  fill` pair — no new bar style). An "Unallocated" `.status-pill` at the
  bottom — `success` (reuses the existing `--bg-success`/`--color-
  success` tokens) when income covers everything planned, `danger` when
  you've planned more than you're earning.
- **Track progress** — the same three buckets, but reusing
  `buildPlannerSubBar` UNCHANGED (the exact function the per-category
  Need/Want sub-bars already use) to show `overview.actual.*` against
  `overview.targets.*`, so the over/near-target status colors and pills
  are identical to the rest of Planner, not a parallel implementation. A
  note appears under the bars whenever `overview.actual.untagged > 0`
  ("₹X of this month's spend isn't tagged Need, Want, Saving, or
  Investment yet, so it isn't counted above") — same transparency rule
  as the per-category untagged note above.
- **Color reuse, not new tokens**: Needs → `--chart-need`/`--need-text`,
  Wants → `--chart-want`/`--want-text` — the same tokens Home's own
  Need/Want/Saving/Investment snapshot bar already uses. Savings +
  Investment is ONE combined bucket (that's how the backend groups
  `targets`/`actual`), so it gets ONE color rather than splitting
  Saving's and Investment's own two separate tokens —
  `--chart-saving`/`--saving-text` was picked as the closer of the two
  ideas to "money set aside." No new color was invented anywhere in this
  pass.
- **Live feedback while editing, without losing input focus**: editing
  the income box only ever patches the existing bucket rows' text/bar-
  width/pill in place (`updatePlannerOverviewSetLive`) — it never
  rebuilds the card's HTML while you're actively typing, since doing
  that would recreate the `<input>` itself and drop your cursor mid-
  keystroke. Editing any CATEGORY target input also live-updates the
  Needs/Wants numbers the same way, reading straight from the Set
  view's own inputs (`plannerOverviewTargetsFromCategoryInputs`) —
  deliberately a preview only, never written into `plannerLastData.
  overview` itself, so switching to Track progress without saving first
  never shows progress against a number that was never actually saved.
- **Saving**: "Save plan" now always sends a top-level `income` field
  alongside `month`/`budgets` — blank income box → `null` (clears a
  saved override), a number → saves/replaces it. Per the backend's own
  three-way contract (see "Saving the income override" above), leaving
  this field out entirely would mean "don't touch a saved override,"
  which would be wrong here since this is the one screen that edits it.
  Same optimistic trade-off as every other Save/Add button in this app:
  the overview's `targets.needs`/`targets.wants`/`income.saved`/
  `unallocated` are recomputed immediately from the just-saved category
  values (`plannerOverviewTargetsFromCategories`, mirroring
  `buildPlannerOverview_` exactly) and the card is rebuilt right away to
  show the definitive post-save state (e.g. clearing the income box and
  saving snaps it back to showing the real actual-income figure); if the
  background `saveBudgets` call actually fails, only `plannerLastData`
  and the Track view are reverted — the Set view's inputs (income
  included) are deliberately left exactly as typed, same "your numbers
  are still here, try again" behavior the category inputs already had.
- **Demo Mode**: `demoComputePlannerOverview` (mirrors
  `buildPlannerOverview_`) and `demoComputeMonthActualIncome` (mirrors
  `computeMonthActualIncome_`) were added, and `demoSaveBudgets` gained
  the same three-way `income` parameter, storing it as the same
  `PLANNER_INCOME_KEY = "_Income"` pseudo-category row the real
  `Budgets` sheet uses — so Settings → View Demo Mode exercises the
  exact same code paths as the real backend/frontend contract, not a
  simplified stand-in.

### Verification

1. **Node**: real `demoComputePlannerData`/`demoComputePlannerOverview`/
   `demoComputeMonthActualIncome`/`demoSaveBudgets` functions extracted
   verbatim from `index.html` and executed (via `vm`) against a small
   hand-built fixture — confirmed income.actual/saved shown separately,
   targets/unallocated math, the three-way income save contract (omit =
   untouched, `null` = cleared, a number = saved/replaced) exactly as
   the backend doc specifies, and that a negative income is rejected
   before anything writes. 23 checks, all passing. A full JS syntax
   check of both `<script>` blocks, a CSS brace-balance check, and a
   check that every `getElementById` call has a matching `id=` (static
   or generated) all passed too.
2. **Real browser** (this session's preview pane actually composited
   frames correctly, unlike several past sessions documented elsewhere
   in this file — verified via a temporary, since-removed test-only
   `?claudeTestBypass=1` URL hook that seeded Demo Mode directly,
   same technique already used in an earlier pass, fully removed before
   finishing): confirmed both views render correctly in light AND dark
   mode with the real Demo Mode dataset, confirmed editing the income
   box live-updates the %/bars/pill without losing input focus,
   confirmed editing a category input live-updates the overview's
   Needs bucket instantly, confirmed Save actually persists (Track
   view's targets and the Set view's own caption update to "your own
   figure." immediately), and confirmed zero console errors throughout.
   This is a stronger live check than several previous Planner
   verification passes in this file managed to get — not every future
   session should assume the same result, per this project's own
   documented preview-pane limitation.

## Not yet built (out of scope for this pass)

- Any alerting ("you're close to your Food target") — Phase 1 is set +
  track only.
- Whether Planner should show anywhere on Home/Analysis, beyond its own
  More-menu screen — not built this pass, no design decision made.
