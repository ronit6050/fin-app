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

Design/UI done so far (user says "good enough for now", not investing more
UI time until the automation/features work below is solid):
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
- Design system pass: category color badges (icon + color per category),
  status pills (Debts/CC), standardized empty states, skeleton loaders on
  Home/Pending. Then a deliberate emoji-reduction pass — user felt the app
  looked "toy-like"; kept emoji ONLY for nav icons, More-menu icons, category
  badges, and small empty-state icons, stripped everywhere else (no more
  ✅/❌ prefixes, no emoji in headers/status text/push titles).

## Automation phase (started 2026-08-08, current focus)
User's core ask: "zero interference" over time — the app should almost
never need to ask for a category, and ALL routine interaction must happen
in the PWA itself, never in Google Sheets (one-time data cleanup is the
only acceptable exception).

**Documentation convention (started 2026-08-08):** each non-trivial feature
built from here on gets its own file under `docs/features/` describing what
it does, why it's built that way, its schema, and its functions — so a
session picking this up later doesn't have to re-derive design decisions
from a long chat history. CLAUDE.md keeps only a short pointer + status per
feature; the feature doc is the source of truth for how it actually works.

**Auto-categorization rebuild — root cause found and fixed:**
- Diagnosed the `SmartMemory` sheet (merchant -> category learning table):
  it was ~90% polluted by generic cash-note words ("tea","mart","lunch")
  from an old one-time migration (`migrateToSmartMemory()`), NOT real bank
  merchant names — because Cash entries only ever have a free-text note,
  no real counterparty, yet fed the same table used for bank-transaction
  matching. Confidence=75 + identical timestamp was the tell for migration
  junk; confidence=100 + multiple uses (e.g. "NEELADRI VEGETABLE AND FR...")
  was the tell for genuinely trustworthy data.
- Fix: user renamed the old sheet, created a fresh `SmartMemory` with just
  the trustworthy seed row(s) kept — done manually since it's one-time
  (user explicitly OK with manual for one-time tasks, NOT for anything
  ongoing).
- Confirmed this pollution source can't recur: Telegram is off, and the
  PWA's Cash tab never touches SmartMemory (category picked manually,
  no learning write). Only real bank-transaction confirmations write to
  it now, via `getPending`'s new `suggestedCategory` field (fast layers
  only — merchant memory + hand-written keyword patterns, Gemini
  deliberately skipped for bulk suggestions to avoid slow/costly calls on
  a big backlog) and `saveNote`'s `handleCategoryCorrection` call.
- Refined `matchByPattern` in category.js: split grocery-delivery apps
  (Zepto/Blinkit/BigBasket/Instamart -> Need) from restaurant/food-delivery
  apps (Swiggy/Zomato/Dunzo -> Want) — previously lumped together, which
  also would have broken the Need/Want split below.
- Self-learning loop (already fully in-app, confirmed working): unknown
  merchant -> guesses "Other" -> user corrects once in Pending -> saved
  permanently at confidence 100 -> every future transaction from that
  merchant is auto-correct forever. No Sheets access needed at any point.

**Need / Want / Saving tagging (started + shipped 2026-08-08): done**, per
the 50/30/20 budgeting rule. The original idea (a fixed category -> type
table) was rejected during design — same category can be either type
depending on context (a cab can be commute or a night out). Built instead
as a self-learning, per-merchant+amount-band vote-counting system, live in
the Pending screen now. **Full design doc:
[docs/features/need-want-saving.md](docs/features/need-want-saving.md)**
— always check that file for the current rules/schema before touching this
feature; this section is just a pointer, not the source of truth.

Not yet built: any screen that actually shows the Need/Want/Saving 50/30/20
breakdown itself — this phase only added the tagging + learning, not a
summary view. Worth revisiting once enough real votes have accumulated.

As part of this design pass, discovered the live `Transactions` sheet has
more columns than previously documented here (`Type` = debit/credit,
`Counterparty`, etc.) and a broader raw `Category` value set than the PWA's
10-option list — see the schema captured in memory
(`reference_transactions_sheet_schema`) since the backend isn't in this repo.

Also flagged by user, not yet started: revisit/rebuild other ported
features for reliability (AI Advisor, CC Advisor, etc.) — explicitly
sequenced AFTER the categorization system is solid, not concurrent.

**Session continuity note:** this project has run in one very long
conversation (context window got to ~92% full). User was advised to
start fresh conversations at clean checkpoints like this one, relying on
this file + memory to carry context forward rather than one endless
thread. If resuming: check the roadmap table above for what's done, and
the Automation phase section for exactly where categorization work left
off before continuing.

**Responsiveness pass (2026-08-08):** user asked specifically for minimal
delay on (a) new transactions appearing and (b) switching tabs. Three
changes:
1. `getDashboardData` used to re-read `Transactions` up to 4 times and
   `Cash` twice in one call (each sub-function read its own copy fresh).
   `getTodaySummary`/`getMonthlyAnalysis`/`getCashData`/
   `getCCAdvisorData`/`getPendingTransactions` now all accept optional
   pre-loaded sheet data (same pattern as the earlier SmartMemory/
   TypeMemory fix) so it reads each sheet once.
2. That same dashboard call already secretly computed Today/Analysis/CC/
   Debts/Savings/Investments/Cash data — `getDashboardData` now returns
   all of it (under a `full` key), and `index.html`'s
   `seedTabsFromDashboard()` seeds every tab's own cache (and renders it,
   if not already loaded) from that one response. Tapping into any of
   those 7 tabs after Home loads is then instant, zero extra network
   call. Confirmed safe: each render function only ever touches its own
   inner content div, never the outer tab container that controls actual
   visibility.
3. Frontend polling for new transactions dropped from 60s to 15s (cheap
   now that `getPending` itself is fast), pauses entirely while the tab
   is hidden, and checks immediately on becoming visible again — fixes
   "got the push notification, opened the app, transaction wasn't
   there yet." Also fixed: reopening Pending used to only quietly update
   its *saved* cache in the background, not what was on screen — now it
   reconciles the visible list immediately too.

## Live deployment reference
- **PWA (what the user opens)**: https://ronit6050.github.io/fin-app/
- **PWA source**: https://github.com/ronit6050/fin-app (this repo, `D:\fin-app` — the one this file lives in). Plain HTML/CSS/JS in `index.html`, plus `sw.js` (service worker), `manifest.json`, `icons/`.
- **Apps Script Web App URL** (what the PWA calls): `https://script.google.com/macros/s/AKfycbz3Hzmi_XNM_TRyz16sZrUWqIOjrBOfHAcyJheYLVi6YrRK1jhaYC38-CwxeqCU_n_v/exec` — also hardcoded as `APPS_SCRIPT_URL` in `index.html`. If ever redeployed as a genuinely new deployment (not "manage deployments -> new version"), this URL changes and must be updated in `index.html`.
- **Apps Script project**: named "Telegram Note Fetcher" in the Apps Script editor (misleading name, historical), script ID `126C_anjXSfWvl1ILAREWFi4CUd059Rer01fZlMgecPvSoPMXD3CEZ6w3`. As of 2026-08-08, synced with `D:\fin-app\backend` via `clasp` (Google's official CLI) — see "finance-bot backend — current state" below for the new workflow. Never edit directly at script.google.com anymore; edit the local files and `clasp push`.
- **Firebase project**: `fin-app-76c40`, used only for push notifications (Stage 8). Console: console.firebase.google.com.
- **Only allowed user**: `ronitnadar9@gmail.com` — hardcoded in both `index.html` (`ALLOWED_EMAIL`) and Apps Script (`PWA_ALLOWED_EMAIL` in PWA.js). Client-side check is UI-only; the real enforcement is server-side in Apps Script.

## Tech choices
- Plain HTML, CSS, and JavaScript. No frameworks. Keep it simple.
- Backend/brain: Google Apps Script + Google Sheets. As of 2026-08-08, the backend source lives in `D:\fin-app\backend` (this repo) and is kept in sync with the live Apps Script project via `clasp` — see "finance-bot backend — current state" below. The original `ronit6050/finance-bot` GitHub repo is old/stale and no longer used.

## How to work with me
- One step at a time.
- Clear comments in the code.
- Plain, simple explanations.

## finance-bot backend — current state (updated 2026-08-08)

**The backend is now properly synced, not just described.** Until
2026-08-08, every backend change was pasted directly into the live Apps
Script editor by the user, copy-pasting code given in chat — none of it
was ever saved to any repo, so descriptions here were the only source of
truth and the linked GitHub repo was stale.

That's fixed now: the real backend source lives at **`D:\fin-app\backend`**
(this repo), kept in sync with the live Apps Script project (script ID
`126C_anjXSfWvl1ILAREWFi4CUd059Rer01fZlMgecPvSoPMXD3CEZ6w3`) via **clasp**
(Google's official CLI for Apps Script, installed 2026-08-08 — needs
Node.js, which was also installed then).

**Going forward, read the actual files in `D:\fin-app\backend` first** —
they're real, current code, not a description of it. The notes below are
still useful for the "why," but the files themselves are the source of
truth for "what."

**Workflow from now on:**
- To pull the latest from the live Apps Script project (e.g. if the user
  ever edits online again): `cd D:\fin-app\backend` then `clasp pull`.
- To push local edits into the Apps Script *editor*: `cd D:\fin-app\backend`
  then `clasp push`. **This is NOT enough on its own** — see next point.
- **IMPORTANT — `clasp push` alone does NOT update what the live PWA calls.**
  There are two deployments: one at `@HEAD` (always latest), and one
  **pinned to a fixed version** whose ID matches `APPS_SCRIPT_URL` in
  `index.html` — that's the one the real app hits, and pinned deployments
  don't move just because the editor's code changed. Discovered 2026-08-08
  when a `clasp push`-only update (Need/Want/Saving tagging) silently never
  reached the live app — `TypeMemory` stayed empty despite the code being
  "pushed." **After every `clasp push` that should affect the live app,
  also run:**
  `clasp deploy -i "AKfycbz3Hzmi_XNM_TRyz16sZrUWqIOjrBOfHAcyJheYLVi6YrRK1jhaYC38-CwxeqCU_n_v" -d "<what changed>"`
  — this cuts a new version and re-points that same deployment ID at it,
  so the URL (and `index.html`) never need to change.
- Local edits should also get `git add`/`git commit`/`git push` in the main
  `fin-app` repo like any other change, so history is preserved — clasp
  only handles the Apps Script <-> local sync, not git.
- `.clasp.json` (in `backend/`) holds the script ID — safe to commit, not
  sensitive. The actual Google OAuth credential clasp uses lives outside
  this repo (`~/.clasprc.json`, machine-specific, never committed).

Originally Telegram was the only front door: every message/button hit one
webhook (`doPost` in `main.js`) → routed in `handlers.js` → feature module →
read/wrote Google Sheets → sometimes called Gemini AI for advice. The PWA is
now a second front door into the same backend, added alongside it.

**Sheets (the database):**
- `Transactions` — bank transactions (written by Tasker independently), notes/category added via Pending in the PWA (or historically via Telegram reply)
- `Cash` — manual cash spend/receive entries (now written by the PWA's Cash tab, category picked manually — does NOT feed SmartMemory)
- `Credit_Card` — parsed credit card statement uploads
- `Debts` — lent/borrowed money, due dates, settlement status
- `Savings` — savings entries split into 3 pots (Emergency/WishList/Free)
- `Investments` — investment logs
- `WishList` — savings goals
- `SmartMemory` — learned merchant → category mappings. **Rebuilt clean on 2026-08-08** after the original was found ~90% polluted by generic cash-note words from an old migration; old sheet renamed `SmartMemory_old_...` (or similar, user did this manually), new `SmartMemory` seeded with only the few trustworthy rows (confidence 100 / used multiple times). See "Automation phase" section above for full diagnosis.
- `CategoryMemory` — old legacy pre-SmartMemory table, superseded, not actively used
- `AILogs` — error/event log — useful for debugging (e.g. `PUSH_SENT`/`PUSH_ERROR`/`PUSH_TOKEN_ERROR` entries when push notifications misbehave)

**Original feature modules (one file each, pre-PWA):**
- `transactions.js` — bank transaction alerts + note-taking. **Modified**: `processNewTransactions()` now checks a `TELEGRAM_ENABLED` flag before sending to Telegram (currently `false`), and always also calls `sendPushNotification(...)` for new transactions. **Also modified 2026-08-08**: each row's processing is now wrapped in its own try/catch — previously one bad row throwing could abort the whole function before its "how far checked" bookmark (`lastCheckedRow` Script Property) saved, silently blocking every transaction after it too. Happened for real on 2026-08-08, needed a manual Script Properties fix; won't recur now, but check `AILogs` for `PROCESS_TXN_ERROR` entries occasionally — a row that always errors will still end up permanently skipped (no alert), just without blocking anything else.
- `cash.js` — Telegram cash tracking, daily 8pm check-in (still callable, but Telegram is off so this path is dormant unless re-enabled)
- `category.js` — smart category engine (memory → fuzzy → pattern → Gemini), learns from corrections. **Modified**: `matchByPattern`'s food-delivery rule split into grocery-delivery (Zepto/Blinkit/BigBasket/Instamart → Need) vs restaurant-delivery (Swiggy/Zomato/Dunzo → Want). **Added**: `migrateSmartMemoryToClean()`, a one-time utility function (already run) that archived the old SmartMemory and rebuilt it clean.
- `Credit Card.js` — credit card statement import/parsing (untouched)
- `CCAdvisor.js` — CC usage vs ₹50,000 combined limit, 18th→18th billing cycle, 25%/30% alerts. Its constants (`CC_LIMIT`, `CC_WARN_AMT`, `CC_ALERT_AMT`) are reused directly by `PWA.js`'s CC function — do not redeclare these elsewhere, Apps Script shares one global scope across all files and it will collide.
- `DebtAdvisor.js` — lent/borrowed tracking, due-date reminders, settlements, AI repayment plans (untouched, its logic is reused by PWA.js's debt functions)
- `SavingsAdvisor.js` — 3-pot auto-split savings, wishlist affordability tracking. Its `getSavingsTotals()`, `getSplitRule()`, `getStageLabel()`, and constants (`EMERGENCY_TARGET`, `MONTHLY_SAVE_GOAL`) are reused directly by PWA.js — same global-scope reuse pattern.
- `Analysis.js` / `Summary.js` — original Telegram-triggered monthly/daily spend breakdowns with charts + Gemini insight text (untouched, still Telegram-only; the PWA's Today/Analysis screens use separate lighter functions in PWA.js, not these)
- `Recon.js` — reconciles uploaded bank statement against `Transactions` (untouched, Telegram-only, not yet ported to PWA)
- `AIAdvisor.js` — Gemini reaction after each transaction note (untouched, Telegram-only path, dormant since Telegram is off)
- `telegram.js` — Telegram dashboard/menu UI. **Modified**: added `const TELEGRAM_ENABLED = false;` (the on/off switch — flip to `true` to instantly restore Telegram sending). `sendMessage(text)` now only sends to Telegram if that flag is true, and — regardless of the flag — always also calls `sendPushNotification()`, using the message's first line as the push title and the rest as the body. This one change is what extended push to every existing proactive alert (CC warnings, debt nudges, savings reminders, daily check-in) without touching those files individually.
- `Logger.js` — silent error logging to `AILogs` (untouched, `logAI(type, message)` used throughout, including by the new PWA.js/push.js code)

**Files added for the PWA (real filenames, confirmed via `clasp clone` 2026-08-08):**
- `main.js` **modified**: `doPost(e)` now branches — if the incoming JSON has an `action` field, routes to `handlePwaRequest(data)`; otherwise falls through to the original `handleTelegramUpdate(e)` unchanged. This is the single shared entry point both Telegram and the PWA hit.
- **`PWA.js`** — everything the PWA talks to, one action per `data.action` value routed inside `handlePwaRequest(data)`. Every action first calls `verifyGoogleIdToken(data.idToken)` (checks the token against Google's tokeninfo endpoint, then checks `PWA_ALLOWED_EMAIL`) before doing anything. Actions implemented: `ping`, `getPending` (includes a `suggestedCategory` per item via `getSuggestedCategoryFast`, fast layers only, no Gemini), `saveNote` (writes note+category, also calls `handleCategoryCorrection` to teach SmartMemory using the real counterparty), `getTodaySummary`, `getMonthlyAnalysis`, `getCCAdvisor`, `getDebts`/`addDebt`/`settleDebt`, `getSavings`/`logSaving`/`addWishlistItem`/`markWishlistPurchased`, `getInvestments`/`logInvestment`, `getCash`/`addCashEntry`, `registerPushToken`, `getDashboard` (aggregates several of the above into one call for the Home screen).
- **`push.js`** — real background push via Firebase Cloud Messaging. `sendPushNotification(title, body)` reads the saved device token from Script Properties (`PWA_PUSH_TOKEN`) and a service account key (`FIREBASE_SERVICE_ACCOUNT`, also Script Properties — sensitive, never in any file/repo) to sign a JWT (`getFirebaseAccessToken()`) and call FCM's HTTP v1 API directly. `testPushNotification()` is a manual-run test helper.
- **`needWantSaving.js`** — Need/Want/Saving suggestion engine, see [docs/features/need-want-saving.md](docs/features/need-want-saving.md). Written and manually tested 2026-08-08; not yet wired into `PWA.js`.

**Script Properties** (Project Settings in the Apps Script editor — not in any file):
- `BOT_TOKEN`, `CHAT_ID`, `GEMINI_KEY` — pre-existing, for Telegram/Gemini
- `PWA_PUSH_TOKEN` (new) — the current device's Firebase push registration token, single value, overwritten each time `registerPushToken` runs
- `FIREBASE_SERVICE_ACCOUNT` (new) — the full service-account JSON from Firebase Console, used only server-side to sign push-send requests. Sensitive, treat like a password.

**Web App deployment settings:** deployed with `"access": "ANYONE_ANONYMOUS"` in `appsscript.json` (unauthenticated at the HTTP layer — this is normal/required for both Telegram webhooks and the PWA to reach it). Real security is entirely inside `doPost`/`verifyGoogleIdToken`, not at the deployment-access level.
