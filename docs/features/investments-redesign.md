# Investments tab makeover (2026-10-17) — New look

Plain English: the Investments screen used to show one total (everything ever logged, including the opening balances typed in
on 11 Aug) and a flat list. Several numbers looked wrong because the total was ALL-TIME while Analysis showed THIS MONTH, the
opening balances and later payments were mixed, and old payments (Mar-Jul) had been logged on top of balances that already
included them. The redesign separates those things and adds a tracker for each monthly SIP.

## What the screen shows (New look only; the older screen stays for the switch-off case)
- Hero: **Put in so far**, this month against the goal (Settings > monthly investment goal), SIPs paid x of y, and three tiles
  (Added so far, Monthly SIPs, Worth now = "Soon": gains are deliberately deferred, no outside price services).
- Add money button; an alert card when a SIP is overdue ("Log it" opens Add money filled in).
- Monthly SIPs: a row per SIP (due day, amount, Paid d MMM / Due in n days / Due today / Overdue n days / Paused), "paid on time
  P of N months", and whether the running SIPs add up to the goal.
- Where your money is (donut by SIP funds / one-time funds / stocks / gold), Holdings (top 5, share of total, bar),
  New holding, Not filled in yet (holdings with no entries), Last 6 months bars (green = goal met), Start over from scratch.
- A holding's own page: put in, share, SIP card, Add money / Record a sale / Pause or Resume SIP / Edit holding, and its entries
  (tap one to change the amount or delete it; delete asks twice).
- First use / after "start over": a setup card and a list of every holding with "Enter amount".

## Backend (all in `backend/investmentInstruments.js`, bottom section; routed in `PWA.js`)
- `getInvestments` now also returns `overview` (old fields unchanged; a failure logs `INVESTMENTS_OVERVIEW_ERROR` and the old
  fields still come back). Pure maths: `computeInvestmentsOverview_(rows, instruments, goal, now)`; all months in India time.
- Investments tab column E `Kind` (see docs/SHEET_SCHEMA.md). "This month" and the bars count only `payment` + `manual`
  money; `opening` and `sale` never count there; "put in so far" is everything net.
- Actions: `logInvestment` (now with `date`, `note`, `force`; same holding + same amount within 5 days returns
  `{ok:false, duplicate:true}` unless `force`), `recordInvestmentSale` (never more than the holding has),
  `deleteInvestmentEntry` (row + name + amount; a changed row returns `{stale:true}`), `saveInvestmentHolding`
  (create/edit; `putInSoFar` is stored as an `opening` row of the DIFFERENCE; `sipOn/sipAmount/sipDay/sipActive`;
  `paidThisMonth` records this month's payment so a SIP paid before setup is not "overdue"), `startInvestmentsFresh`
  (`confirm:"FRESH"`: copies every row to `Investments_Archive`, empties Investments, relabels orphan SIP memories onto the one
  SIP with the same amount, re-remembers every SIP amount).
- Paused SIPs: marker row in FinancialEvents (Type `InvestmentPaused`); `matchRecurringNamedEvent` skips those names.
  Changing a SIP amount replaces its remembered amount and keeps its payee (the payee check stops a 4,000 payment to someone
  else being offered as the 4,000 SIP).
- SIP status rule: paid if a payment/manual entry for that holding exists this month; overdue once today is 2+ days past the due day.

## Screen (index.html)
`renderInvestmentsNew`, `ivOverviewHtml`, `ivDetailHtml`, the sheets `ivOpenAddSheet / ivOpenHoldingSheet / ivOpenSaleSheet /
ivOpenEntrySheet`, search "INVESTMENTS, NEW LOOK". Reuses the Savings `.sv-*` look. Demo Mode has a twin of the maths
(`demoComputeInvestmentsOverview`) and all new actions. `APP_VERSION` `2026-10-17-09`.

## Tests
`backend/tests/investmentsOverview.test.js` (76 checks: figures, India-time first of month, SIP states, pause/resume/amount change,
duplicate warning, sale, delete guard, setup, paid-this-month, start fresh, old-screen fields) and
`backend/tests/finInvestmentsNew.test.js` (wiring: every new action named in every list). The flows were also clicked through in
the browser in Demo Mode (add with duplicate warning, pause/resume, sale, delete, edit, start over, setup).

## Known limits / not built
- "Worth now" and gains (owner has an idea; no outside price services).
- The "is this an investment?" card for old untagged payments (Apr-Jul ICCL/Groww payments) is not built.
- After "start over" the owner types each holding's total once; there is no import.
- Not live until: `clasp push` + `clasp deploy` (backend), `firebase deploy --only functions`, then `git push` (app).

## Independent review (2026-10-17) and what it changed
`change-reviewer` found nothing that corrupts money in the normal flow, and four real gaps, all fixed with tests (section 12 of
`investmentsOverview.test.js`): (1) editing an entry now sends the name and amount it was looking at and is refused as stale if the
row changed (`updateInvestment` takes optional `expectName` / `expectAmount`); (2) a paused SIP is no longer settled silently by
auto-settle (`findSilentFinancialEventMatch_`); (3) a paused SIP gets no "due soon" reminder (`getDistinctObligations_`);
(4) a SIP due on the 29th-31st is due on the month's last day in a shorter month, and pausing a SIP with no due day asks for
the day instead of guessing 1. Not verified by anyone: behaviour on the real Google Sheet (only the fake and virtual sheets), and the
screen on a real phone.
