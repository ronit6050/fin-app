# Planner (Phase 1) — per-category monthly spend targets

**Status: backend done (`clasp push`ed, editor draft only — not yet live,
needs a `clasp deploy` go-ahead) and frontend done (`index.html`, not yet
`git push`ed — needs a review + go-ahead too).** Built 2026-08-18.
Backend lives in `backend/planner.js`, wired into `handlePwaRequest`
(`PWA.js`) as two actions: `getPlannerData` and `saveBudgets`. Frontend
lives under More → Tools → Planner — see "Frontend" section below for
what actually shipped.

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

## Frontend — built 2026-08-18 (`index.html`), pending `git push`

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

## Not yet built (out of scope for this pass)

- Any alerting ("you're close to your Food target") — Phase 1 is set +
  track only.
- Whether Planner should show anywhere on Home/Analysis, beyond its own
  More-menu screen — not built this pass, no design decision made.
