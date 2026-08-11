# Settings

**Status: live**, shipped 2026-08-08. Monthly investment amount field
added 2026-08-10 — see [cc-advisor.md](cc-advisor.md#monthly-investment-amount--settings-field-added-2026-08-10).

## What this is

Lets you edit the limits/goals that used to be hardcoded constants only a
code change could touch: CC combined limit, CC warning/alert thresholds
(as %), monthly essential expenses (drives the emergency fund target),
the monthly savings goal, and (added 2026-08-10) a fixed monthly
investment amount used by CC Advisor's affordability check. Lives under
More → Settings.

## Why Script Properties, not a Sheet

The spreadsheet already has an orphaned `Config` sheet tab — checked, and
no code anywhere reads or writes it (same story as the `Budget`/
`CategoryBudgets` tabs found earlier). Rather than wire up a fourth
unused-sheet-turned-real-feature, settings are stored in Script
Properties instead — the same place `BOT_TOKEN`/`PWA_PUSH_TOKEN` already
live. Simpler, no sheet I/O, no extra tab to keep in sync.

## Why the old constants weren't touched everywhere

`CC_LIMIT` (`CCAdvisor.js`), `MONTHLY_EXPENSES`/`EMERGENCY_TARGET`/
`MONTHLY_SAVE_GOAL` (`SavingsAdvisor.js`) are referenced in ~40 places
across those two files — almost all of it inside dormant Telegram
message-building strings (Telegram's been off since the automation
phase). Rewriting all of that for a feature that would never exercise it
was unnecessary risk for a beginner-run project. Instead:

- `getSplitRule(emergencyTotal, monthlyExpenses, emergencyTarget)` and
  `getStageLabel(emergencyTotal, monthlyExpenses, emergencyTarget)` in
  `SavingsAdvisor.js` gained two **optional** parameters, falling back to
  the original hardcoded constants when omitted — every dormant Telegram
  caller still calls them with 1 argument and gets identical behavior to
  before.
- Only the three PWA-facing functions that actually matter —
  `getCCAdvisorData`, `getSavingsData`, `logSavingFromApp` (all in
  `PWA.js`) — were changed to read `getSettings()` and pass the live
  values through.
- Nothing in `CCAdvisor.js`'s own hardcoded constants changed at all —
  the PWA functions now compute their own `ccLimit`/`ccWarnAmt`/
  `ccAlertAmt` locally from settings instead of reading those globals.

## Functions

- **`settings.js`** (new file) — `getSettings()` returns
  `{ ccLimit, ccWarnPct, ccAlertPct, monthlyExpenses, monthlySaveGoal,
  monthlyInvestmentGoal }`, reading each from its own Script Property
  (`SETTING_CC_LIMIT` etc.), falling back to the original hardcoded
  defaults (50000 / 0.25 / 0.30 / 30000 / 1000 / **0**) if never
  customized — `monthlyInvestmentGoal` defaults to 0, meaning "not set,"
  which keeps CC Advisor's math unchanged for anyone who hasn't entered
  one. `updateSettings(newSettings)` only overwrites keys actually
  present in the object passed in — saving a partially-filled form can't
  wipe out the other settings. `monthlyInvestmentGoal` is the one field
  that explicitly allows saving `0` (checked for `undefined`/`null`/`""`
  rather than truthiness like the others), so it can be intentionally
  cleared back to "not set."
- New PWA actions: `getSettings`, `updateSettings`.

## UI

Six number fields (CC limit, CC warn %, CC alert %, monthly expenses,
monthly savings goal, monthly investment amount) and a Save button.
Percentages are stored as 0-1 in the backend but shown/edited as 0-100
in the UI — converted both ways in `renderSettings()`/the save handler.
Saving clears the `cc`/`savings`/`dashboard` caches and resets their
`tabLoaded` flags, since those screens' numbers depend on these values
and would otherwise show stale data until manually refreshed.
