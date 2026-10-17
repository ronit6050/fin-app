# Home makeover and run-out date (2026-10-17)

**Status: built and tested locally, NOT deployed.** Needs `clasp push` + `clasp deploy` (backend) and `git push` (app), backend first.

## What the person sees
- Top card: "Money lasts until <date>" at the current pace, with how it compares to their next salary, plus a "spend at most X a day" hint when short.
- "Needs you": notes waiting, the unpaid card bill, Rent/EMI/SIP still to come this month.
- Two tiles (card this cycle, friends and debts), the category bar, and "Latest" (newest 5 transactions).

## How the date is worked out (`backend/runway.js`)
- The app cannot see the bank balance, so the person confirms it once. That is a **checkpoint** (amount + time) in per-person settings (`RUNWAY_BALANCE`, `RUNWAY_BALANCE_AT`). Action `saveRunwayBalance`.
- Balance now = checkpoint + bank credits - bank debits after the checkpoint. Card swipes and card credits are skipped (they only leave the bank when the bill is paid, and that payment is a normal debit).
- Run-out date = (balance - bills ahead) / daily pace. Bills ahead = unpaid closed card bill + Rent/EMI/SIP not yet paid this month and due before salary.
- Daily pace = this month's spend (the same total the Analysis screen shows, so fixed bills are already left out) / days so far. In the first 4 days of a month it uses Settings > monthly expenses / 30 instead.
- A checkpoint older than 7 days asks "I think you have about X, right?" (Yes / enter real amount).
- Salary day is per person: Settings > Salary day, or worked out from that person's own Income credits (needs 2 months). With neither, the card shows a "Set your salary day" link.
- `getDashboard` now also returns `runway` (null if it could not be worked out; the app then shows the old "Spent today" card) and `latest`.

## Files
backend: `runway.js` (new), `PWA.js`, `settings.js` (salaryDay), `v2route.js`, `viewPublisher.js`, `functions/index.js` (the new action is registered everywhere saves are listed). App: `index.html` (renderRunway, renderHomeNeeds, renderHomeLatest, Settings field, Demo Mode). Test: `backend/tests/runway.test.js` (16 checks).

## Known limits
- Card spend this cycle counts as spending today even though the bank is only hit when the bill is paid; the date can look a little early for heavy card users.
- Home no longer has the Pending/Cash tiles, the Need/Want snapshot or the tap-a-tile "Recent" list. Plan targets per category (from Planner) are not on Home yet.
