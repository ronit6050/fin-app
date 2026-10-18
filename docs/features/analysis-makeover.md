# Analysis tab makeover (built 2026-10-18, NOT deployed yet)

Owner approved a mock-up on 2026-10-18 and asked for everything to be built in one go.

## What the screen has now (top to bottom)
Hero (spent so far + pace chips + "heading for" bar), Smart read (2-4 auto-written sentences), Money flow (income split into
spent / Rent+EMI / invested / saved / left, savings rate), Day by day (bar per day, average line, spike days), Against your
plan (Planner targets vs real spend), Categories (now with "vs last month" chips), Need/Want/Saving (unchanged), Top places,
Your week (average per weekday), Last 6 months (spent bars + income line), Biggest payments. The All/Bank/Card/Wallet toggle
drives every card except "Against your plan" and the income line (those are All only).

## Backend (backend/PWA.js, backend/analysisExtras.js)
- `getMonthlyAnalysis` now also returns `detail` (and every `byMode` slice has one): `daily[]` (one number per day of the month),
  `places[]` (top 8 by counterparty, case/space-insensitive, falls back to the note; Cash uses its note), `smallCount/smallTotal`
  (payments under Rs 100), `biggest[]` (top 5). It is collected inside the same debit branch as the spend total, so it follows
  EXACTLY the same exclusion rules (CC bill payments, wallet top-ups, loans, Rent/EMI/SIP never show up).
  Optional 5th argument `{skipSaved:true}` skips the Savings read (used for the 6-month trend).
- New read action `getAnalysisExtras {year, month}` -> `{trend[6], prev{all,bank,card,wallet}, budgets}`.
  Built by calling getMonthlyAnalysis for 6 months (so rules cannot drift). `budgets` = Planner targets the owner SAVED for that
  month next to real spend, or null (also null if Planner throws). It is a separate call so the Home screen's big call does not
  pay for 7 months of work. Added to: `PWA.js` router, `functions/index.js` READ_ACTIONS, `backend/v2route.js` friend list,
  `index.html` NEW_SERVER_ACTIONS.
- Tests: `backend/tests/analysisExtras.test.js`; `analysisByMode.test.js` allow-lists now include `detail`.

## Frontend (index.html)
See the Analysis section; pure helper `buildAnalysisInsights` (no DOM) is tested in `backend/tests/analysisInsightsFrontend.test.js`.
Older cached responses without `detail` simply hide the new cards. Demo Mode shows every card.

## Known limits
- Month/day bucketing uses the server's date functions: on the new server (UTC) a payment made near midnight on the 1st can land
  in the wrong month. This is the same pre-existing behaviour as the rest of Analysis (flagged in PROJECT_STATUS 2026-10-17); not changed here.
- Extras cost: ~6 passes over the in-memory transaction list, no extra database reads beyond one Planner call.
- Deploy order when approved: backend (`clasp push` + `clasp deploy`, `firebase deploy --only functions`) first, then `git push`.
