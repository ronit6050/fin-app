# Project: Personal Expense Tracker (PWA)

## Who I am
- I am a complete beginner learning to build my app.
- Explain things simply (like to a beginner). Comment code clearly.
- Work in small steps. Check my understanding before moving on.

## Goal
- Build a personal expense tracker web app (PWA) that installs on my phone.
- For now it is just for me. Later I might share it with friends.
- End vision: fully replace Telegram as the interface to finance-bot. The PWA
  should eventually do everything Telegram currently does (see roadmap below),
  not just add expenses. Bank/UPI transactions matter far more than cash —
  Tasker (a phone automation app) already reads bank SMS and writes them into
  the `Transactions` sheet directly, independent of Telegram, so this keeps
  working no matter what we build.

## Hard constraints (set 2026-08-07)
- **No cost** until the app goes public (i.e. shared beyond just me). Everything
  used until then must be on a free tier: GitHub Pages, Apps Script, Sheets,
  Google Sign-In are all free — fine to use.
- **No 3rd-party integrations** (no outside companies like OneSignal). Google's
  own tools (Google Sign-In) are OK since it's the same account/vendor already
  used for Sheets — confirmed acceptable. Firebase (also Google, used for real
  background push notifications) is explicitly deferred to a later phase, not
  used yet.
- **Data must stay private** — not just hidden. A "secret code" embedded in
  public client-side JS is NOT real privacy (anyone with the URL can view page
  source and read it out). The real fix: Google Sign-In, so the Apps Script
  backend verifies actual Google identity before touching the Sheet.
- **Notifications**: start with in-app-only notifications (shown when the app
  is open — free, zero extra infra). True background push (arrives even when
  the app is closed, like Telegram) requires Firebase or a from-scratch Web
  Push implementation — deferred to a later phase, not blocking core build.

## The plan (in order)
1. Build the look: add-expense form + expense list (using pretend data). <- done, may revisit once real data flows in
2. Connect to the Google Sheet via the existing "finance-bot" Apps Script, with real Google Sign-In for privacy. <- done
3. Make it installable on my phone as a PWA (needs real HTTPS hosting). <- done
4. Work through the roadmap below to reach full Telegram parity. <- in progress, see table
5. (Later, optional) Support friends using their own sheets.
6. Once full Telegram parity is reached: a dedicated pass to properly structure/
   polish the whole app (UI, UX, possibly new features) — explicitly deferred
   until everything below is working, not before. Confirmed 2026-08-07.

## Roadmap: replacing Telegram entirely
Staged — each phase replaces one piece of Telegram functionality. Bank/UPI
flow is prioritized over cash since that's the user's real daily habit.
Work through in order; don't skip ahead. Every item below must eventually
exist in the PWA — order/timing can flex, but nothing gets dropped.

| Step | What | Replaces (Telegram feature) | Status |
|---|---|---|---|
| 0 | Host the PWA on free HTTPS (GitHub Pages) | — prerequisite for installability + Google Sign-In | done |
| 0.5 | Add Google Sign-In to the PWA | — real privacy, no secret-in-code | done |
| 1 | View new bank transactions + add note/category | "Reply to alert" flow — main daily habit | done |
| 2 | In-app notifications for pending transactions | Telegram's instant alerts (in-app only for now) | done |
| 3 | Dashboard: today's summary, monthly analysis + charts | Dashboard, Today's Summary, Analysis buttons | done |
| 4 | CC Advisor view | CC usage/limit tracking | done |
| 5 | Debts view (lend/borrow/settle) | Debt Manager | done |
| 6 | Savings & Wish List view | Savings Advisor | done |
| 6.5 | Investments dashboard (log + view, separate from Savings pots) | Investment logs, Investment Dashboard | done |
| 7 | Cash entry (lower priority) | Cash spend/receive | done |
| 8 | Real background push via Firebase (separate later phase) | Alerts arriving even when app is closed | done |
| 9 | Daily check-ins, nudges, threshold alerts as push | Remaining proactive messages | done |
| 10 | Turn off the Telegram bot | Full cutover | done |
| 11 | Full UI/UX structuring pass (after everything above works) | — new phase, not a Telegram replacement | in progress |

## Step 11 notes (started 2026-08-08)
Open-ended design pass — user gave full creative liberty ("take a reference
of any app... think creatively... improve user's usage"), with one rule:
show or describe a change before making it (mockups via the visualize tool
work well for this). Not a fixed checklist — revisit and keep iterating.

Done so far:
- Navigation restructured: 8 scrolling tabs -> 4 (Home/Pending/Analysis/More)
  + a "More" menu grid for the rest
- Instant-load caching (stale-while-revalidate) on all screens
- Visual pass: system font, CSS variables for shared colors/shadow, loading
  spinner, tap feedback, app icon in header
- New Home dashboard (default landing screen): today/month spend, 2x2 stat
  grid (pending/cash/CC%/debts net), recent pending items — via one new
  getDashboard Apps Script action reusing existing screen logic
- Header redesign: dropped subtitle line and inline email; added a circular
  avatar with a profile popover (email + sign out)

## Tech choices
- Plain HTML, CSS, and JavaScript. No frameworks. Keep it simple.
- Existing backend/brain lives here: https://github.com/ronit6050/finance-bot (Google Apps Script + Google Sheets).

## How to work with me
- One step at a time.
- Clear comments in the code.
- Plain, simple explanations.

## finance-bot architecture (reviewed 2026-08-07)
Telegram is currently the front door. Every message/button hits one webhook
(`doPost` in `main.js`) → routed in `handlers.js` → feature module → reads/writes
Google Sheets → sometimes calls Gemini AI for advice.

**Sheets (the database):**
- `Transactions` — bank transactions, alerted via Telegram, notes added by reply
- `Cash` — manual cash spend/receive entries
- `Credit_Card` — parsed credit card statement uploads
- `Debts` — lent/borrowed money, due dates, settlement status
- `Savings` — savings entries split into 3 pots (Emergency/WishList/Free)
- `Investments` — investment logs
- `WishList` — savings goals
- `SmartMemory` / `CategoryMemory` — learned merchant → category mappings
- `AILogs` — error/event log

**Feature modules (one file each):**
- `transactions.js` — bank transaction alerts + note-taking
- `cash.js` — cash tracking, daily 8pm check-in
- `category.js` — 4-layer smart category engine (memory → fuzzy → pattern → Gemini), learns from corrections
- `Credit Card.js` — credit card statement import/parsing
- `CCAdvisor.js` — CC usage vs ₹50,000 combined limit, 18th→18th billing cycle, 25%/30% alerts
- `DebtAdvisor.js` — lent/borrowed tracking, due-date reminders, settlements, AI repayment plans
- `SavingsAdvisor.js` — 3-pot auto-split savings, wishlist affordability tracking
- `Analysis.js` / `Summary.js` — monthly/daily spend breakdowns, charts, Gemini insights
- `Recon.js` — reconciles uploaded bank statement against `Transactions`
- `AIAdvisor.js` — Gemini reaction after each transaction note
- `telegram.js` — Telegram dashboard/menu UI
- `Logger.js` — silent error logging to `AILogs`

**Key fact for PWA integration:** the Apps Script is already deployed as a public
Web App (`appsscript.json` → `"access": "ANYONE_ANONYMOUS"`). Today `doPost(e)`
only understands Telegram's payload shape and checks the message's `chat_id`
against mine, silently dropping anything else. Adding the PWA means teaching
`doPost` to recognize "this is from my PWA" (its own secret/token check, since
Telegram's `chat_id` check won't apply to it).
