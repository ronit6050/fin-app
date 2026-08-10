# Project: Personal Expense Tracker (PWA)

## Who I am
- I am a complete beginner learning to build my app.
- Explain things simply (like to a beginner). Comment code clearly.
- Work in small steps. Check my understanding before moving on.
- **Always use plain, simple English — no technical jargon without
  explaining it.** Confirmed 2026-08-09 after a security review used terms
  like "stored XSS" without explaining what they meant. Every time
  something is checked or changed, say plainly: what the problem was, why
  it mattered, and what was done about it — in everyday words, not
  developer terms.

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

**Drastic visual redesign (2026-08-08, after Automation phase below was
solid)** — user asked for a genuine "app vibe," explicitly wanted it
drastic, offered the option of pulling in a CSS framework/theme. Declined
that (confirmed with user) to keep the "no frameworks" rule from Tech
choices intact — achieved entirely with hand-written CSS instead. Two
mockup rounds via the visualize tool first (a soft pass, then a much
bolder one) before touching real code, per the "show before building"
rule. What changed:
- Full design-token rewrite: page background is now a soft tint (not
  white) so cards visibly sit on something; the hero card (today's spend)
  and the active bottom-nav icon are deliberately inverted (near-black on
  the light theme) as the app's one high-contrast signature element,
  vivid green in dark mode; bigger/tighter number typography; softer
  filled inputs instead of border-only; pill-shaped buttons.
- **Full dark mode**, both automatic (`prefers-color-scheme`) and a
  manual Light/Dark/System choice in Settings (`themePreference` in
  localStorage, applied via a `data-theme` attribute set by a tiny
  synchronous script at the very top of `<head>` — has to run before
  first paint or you'd see a flash of the wrong theme). Every category
  color, status color, and Need/Want/Saving color got a dark counterpart.
- Same markup, all CSS-level — no JS render-function logic touched,
  since every screen already used shared classes (`.pending-item`,
  `.field`, `.type-toggle`, etc.) that the new stylesheet just redefines.
  Also hunted down and fixed ~8 leftover hardcoded hex colors sitting in
  inline styles/JS template strings outside the main stylesheet (CC
  Advisor, Savings, History) that would've stayed wrong in dark mode
  otherwise.
- Automated browser testing hit a real limitation here: the preview tool
  doesn't actively composite/repaint in this environment (confirmed via
  failed screenshots, `document.visibilityState` reporting hidden, and
  `requestAnimationFrame` never firing), so a live "toggle theme, does an
  already-rendered element repaint" check couldn't be fully verified
  automatically — fresh elements created directly in each theme did
  verify correctly, and the CSS itself was checked for conflicting rules
  (none found), but the live-toggle repaint was confirmed by the user on
  their real device instead, not by the tooling.

**Post-redesign fixes (2026-08-08, user tested live and reported 3
issues):**
- Emoji nav/More-menu icons replaced with hand-drawn inline SVG line
  icons (`currentColor` stroke, so they're theme-aware automatically) —
  user felt the emoji looked "regular"/low-quality against the new look.
  No icon library pulled in, same "no frameworks" reasoning as the
  redesign itself. Uncovered and fixed a real contrast bug this exposed:
  the active nav icon sits on the inverted hero-colored pill, but was
  inheriting the page's normal text color instead of the hero's contrast
  color — invisible-ish icon on the pill. Needed its own
  `--text-on-hero` override.
- Fixed the default Android/Chrome blue tap-highlight rectangle flashing
  on every button press (`-webkit-tap-highlight-color: transparent`) —
  clashed with the app's own tap-scale feedback animation.
- Fixed the phone's back button/gesture closing the app immediately —
  this is a single-page app with no real URL routing, so the browser had
  nothing of ours to step back through. Now pushes a `history` entry on
  every tab/sub-screen change (`saveActiveTab`), and a `popstate`
  listener replays that state on back/forward instead of letting the
  browser navigate away — back now steps through the app's own screens
  first (e.g. a More sub-screen → the More menu → the previous tab),
  only exiting once you're back at the start. Verified end-to-end via
  `history.back()` simulation in the browser tool this time (unlike the
  dark-mode repaint check, this didn't depend on the pane actually
  compositing frames, so it could be fully confirmed automatically).

**Security review + fixes (2026-08-09):** went through every backend file
and the frontend for safety issues before continuing feature work. Found
and fixed: transaction/note text was being put on screen without
cleaning it first (a real risk, since that text can come from outside —
bank SMS, uploaded statements — and the sign-in token lives in the
phone's storage); some actions weren't checking that a row number sent
from the app was valid before writing to it; and the retired Telegram
bot's inbound door was still technically reachable. All three fixed and
live. See chat history for full detail if this needs revisiting.

**Home screen refinement (2026-08-09):** tapping a Home stat card
(Pending/Cash/CC/Debts) now switches the "Recent" list below to that
card's own recent activity instead of always showing pending
transactions; CC usage widget now also shows the rupee amount, not just
the percent; added a small top-categories bar chart to Home (reuses the
existing bar style from Today/Analysis/CC, no new chart library); and
Pending transaction notes now start pre-filled with the merchant name,
so clearing an old backlog is a single tap instead of typing each one.
Also clarified for the user: Cash balance (wallet cash) and Savings
(Emergency/Wish List/Free pots) are intentionally separate trackers —
cash set aside as savings needs logging under Savings, not Cash.

**Home screen follow-up fixes (2026-08-09, after user tested live):** the
top-categories chart above was removed (not wanted); the "Spent today"
hero card wasn't actually wired up to be clickable, fixed — now shows
today's spend by category when tapped; CC usage's recent list was
showing the raw UPI payment ID instead of the note actually written on
the transaction, fixed to prefer the note.

**Optimistic save on Pending (2026-08-09):** tapping Save now removes
the card immediately instead of waiting for Apps Script to confirm —
much faster for working through a large backlog. If the background save
fails, the card reappears at the top of the list with a clear error
instead of silently vanishing. Frontend-only change (`index.html`).

**Note Memory (2026-08-09): done.** Pending's note field now suggests a
remembered note per merchant + amount band (e.g. a restaurant you always
call "dinner"), not just the merchant's raw name — falls back to the old
behavior when there's no confident suggestion yet. Deliberately built
without any AI call (same reasoning as fast category suggestions) and
handles person-to-person payments sensibly via a "used at least twice"
confidence bar rather than special-casing merchant-vs-person. **Full
design doc: [docs/features/note-memory.md](docs/features/note-memory.md)**.
Also fixed same day: already-visible Pending cards weren't picking up
newly-learned note suggestions until saved/reopened — background refresh
now updates any note box that's still exactly what was auto-filled
(never touches one you've started editing).

**Need/Want/Saving redesign — sliding window, not all-time count
(2026-08-09): done.** After clearing a 249-item backlog mostly with
guessed answers ("Want" selected ~90% of the time out of uncertainty,
not real judgment), the user flagged that an all-time running vote count
would let that guessed block permanently outweigh real, careful answers
going forward. Fixed: `getSuggestedType` now only looks at the most
recent 5 answers per merchant+band (new `TypeVotes` sheet, one row per
answer, old `TypeMemory` sheet abandoned in place — safe to delete
manually, nothing reads it anymore). A real bug was caught and fixed
during this work too: the first version sorted by a `Timestamp` column,
which broke when two answers landed in the same millisecond (hit this
in testing) — fixed by using the sheet's natural append-only row order
for recency instead of comparing dates. Verified with a standalone Node
test before shipping, not just the in-app manual test function. See
[docs/features/need-want-saving.md](docs/features/need-want-saving.md).

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

**Bank statement reconciliation (started + shipped 2026-08-08): done.**
Upload a bank statement (`.xls`) under More → Reconcile; finds transactions
Tasker missed entirely, AND (the more common case) transactions Tasker
caught but never got a note, since bank SMS text never carries the UPI
note — only the statement does. Recovers that note automatically from the
statement narration, review-and-approve only, nothing writes without
confirming. **Full design doc:
[docs/features/reconciliation.md](docs/features/reconciliation.md)** —
always check that file before touching this feature.

**Settings screen (started + shipped 2026-08-08): done.** CC limit,
CC warn/alert %, monthly expenses, monthly savings goal — previously
hardcoded constants — now editable from More → Settings, backed by
Script Properties (not a Sheet). **Full design doc:
[docs/features/settings.md](docs/features/settings.md)**.

**History screen / edit past transactions (started + shipped
2026-08-08): done.** Pending only ever shows un-noted transactions; once
noted there was no way to fix a mistake short of editing the Sheet
directly. More → History browses already-noted transactions and lets you
edit note/category/amount/Need-Want-Saving in place — reuses the same
`saveNote` action Pending does, so an edit teaches SmartMemory/TypeMemory
exactly like a first-time correction would. **Full design doc:
[docs/features/history.md](docs/features/history.md)**.

**Responsiveness + drastic visual redesign + dark mode: done**, see the
"Responsiveness pass" and "Drastic visual redesign" notes under Step 11
above — both happened after this Automation phase work, in the same long
session, at the user's explicit request ("think deeply... prepare a list
of amazing new features... improve responsiveness... give an app vibe").

**"What's New" popup: done.** Shows a one-time dismissible popup after an
app update, comparing `APP_VERSION` (top of `index.html`'s main script)
against a version saved on the phone — confirms an update actually
reached the device. **Whenever a real user-facing change ships, bump
`APP_VERSION` and update `APP_CHANGELOG` to a one-line description of
what changed** — this is a manual habit, not automatic, and it's easy to
forget after a big change.

**Session continuity note (updated 2026-08-08, end of a very long
session):** this project has run in one very long conversation. The user
is now deliberately starting a fresh chat and relying on this file +
memory (`reference_transactions_sheet_schema`, `feedback_beginner_collaboration`,
`project_expense_tracker`) to carry context forward, rather than one
endless thread — **read this whole file first if picking this up cold.**

As of this checkpoint: full Telegram parity (roadmap table above) is
done, and everything in the Automation phase section above is also
done — auto-categorization rebuild, Need/Want/Saving tagging,
responsiveness pass, bank statement reconciliation, Settings screen,
History screen, the "What's New" popup, and a full visual redesign with
dark mode (see Step 11 notes above for that last one, including the 3
post-redesign fixes the user found by testing live: icons, tap-highlight,
back button).

**Superseded 2026-08-09 — see "Category/Type restructure" plan below**,
which is now the authoritative "what's next." Still true and not folded
into that plan: CC statement import (`Credit Card.js` → PWA), user wants
this **after the 18th of the month** when the next bill generates; Smart
Reaction (Gemini one-liner after saving a note) and richer Analysis
(chart + Gemini insight), both still explicitly deferred until core
features are solid.

If the user asks "what's next" cold: point at the phased plan below,
don't assume, ask which phase/line item (or something new) before
building — nothing in that plan is approved to start yet.

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
- `Recon.js` — reconciliation. Original Telegram-only functions (`runReconciliation`, `insertConfirmed`, etc.) untouched and still dormant. **Added 2026-08-08**: `extractNoteFromNarration()`, `previewReconciliation()`, `reconcileStatementPreview()`, `insertReconciledTransactions()` — the PWA-facing preview-then-approve flow, see [docs/features/reconciliation.md](docs/features/reconciliation.md). Note: the old `insertConfirmed()` has a pre-existing off-by-one bug (17 values for a 16-column sheet) — harmless since it's dormant, not fixed since nothing calls it anymore.
- `AIAdvisor.js` — Gemini reaction after each transaction note (untouched, Telegram-only path, dormant since Telegram is off)
- `telegram.js` — Telegram dashboard/menu UI. **Modified**: added `const TELEGRAM_ENABLED = false;` (the on/off switch — flip to `true` to instantly restore Telegram sending). `sendMessage(text)` now only sends to Telegram if that flag is true, and — regardless of the flag — always also calls `sendPushNotification()`, using the message's first line as the push title and the rest as the body. This one change is what extended push to every existing proactive alert (CC warnings, debt nudges, savings reminders, daily check-in) without touching those files individually.
- `Logger.js` — silent error logging to `AILogs` (untouched, `logAI(type, message)` used throughout, including by the new PWA.js/push.js code)

**Files added for the PWA (real filenames, confirmed via `clasp clone` 2026-08-08):**
- `main.js` **modified**: `doPost(e)` now branches — if the incoming JSON has an `action` field, routes to `handlePwaRequest(data)`; otherwise falls through to the original `handleTelegramUpdate(e)` unchanged. This is the single shared entry point both Telegram and the PWA hit.
- **`PWA.js`** — everything the PWA talks to, one action per `data.action` value routed inside `handlePwaRequest(data)`. Every action first calls `verifyGoogleIdToken(data.idToken)` (checks the token against Google's tokeninfo endpoint, then checks `PWA_ALLOWED_EMAIL`) before doing anything. Actions implemented: `ping`, `getPending` (includes `suggestedCategory` + `suggestedType` per item, fast layers only, no Gemini), `saveNote` (writes note/category/optional amount, calls `handleCategoryCorrection` + `recordTypeVote` — same function backs both Pending's first note AND History's edits), `getTodaySummary`, `getMonthlyAnalysis`, `getCCAdvisor`, `getDebts`/`addDebt`/`settleDebt`, `getSavings`/`logSaving`/`addWishlistItem`/`markWishlistPurchased`, `getInvestments`/`logInvestment`, `getCash`/`addCashEntry`, `registerPushToken`, `getDashboard` (aggregates most of the above into one call for the Home screen, `getDashboardData` reads `Transactions`/`Cash` once and passes them through — see Responsiveness pass notes above), `getSettings`/`updateSettings`, `getTransactionHistory`, `reconcileStatement`/`insertReconciledTransactions`.
- **`push.js`** — real background push via Firebase Cloud Messaging. `sendPushNotification(title, body)` reads the saved device token from Script Properties (`PWA_PUSH_TOKEN`) and a service account key (`FIREBASE_SERVICE_ACCOUNT`, also Script Properties — sensitive, never in any file/repo) to sign a JWT (`getFirebaseAccessToken()`) and call FCM's HTTP v1 API directly. `testPushNotification()` is a manual-run test helper.
- **`needWantSaving.js`** — Need/Want/Saving suggestion engine, see [docs/features/need-want-saving.md](docs/features/need-want-saving.md). Wired into `PWA.js`'s `getPendingTransactions`/`saveTransactionNote`/`getTransactionHistory`, live since 2026-08-08.
- **`settings.js`** (new file, 2026-08-08) — user-editable CC limit/thresholds and savings targets, backed by Script Properties. See [docs/features/settings.md](docs/features/settings.md).

**Script Properties** (Project Settings in the Apps Script editor — not in any file):
- `BOT_TOKEN`, `CHAT_ID`, `GEMINI_KEY` — pre-existing, for Telegram/Gemini
- `PWA_PUSH_TOKEN` (new) — the current device's Firebase push registration token, single value, overwritten each time `registerPushToken` runs
- `FIREBASE_SERVICE_ACCOUNT` (new) — the full service-account JSON from Firebase Console, used only server-side to sign push-send requests. Sensitive, treat like a password.

**Web App deployment settings:** deployed with `"access": "ANYONE_ANONYMOUS"` in `appsscript.json` (unauthenticated at the HTTP layer — this is normal/required for both Telegram webhooks and the PWA to reach it). Real security is entirely inside `doPost`/`verifyGoogleIdToken`, not at the deployment-access level.

## SMS ingestion — a SECOND, separate Apps Script project (found + documented 2026-08-10)

**This was a real gap: this whole project existed and was completely
unknown/undocumented until 2026-08-10.** Everything above this section
("finance-bot backend") is one Apps Script project (script ID starting
`126C_...`, the one bound to the main Sheet). The very first step —
**turning a raw bank SMS into a new row on the `Transactions` sheet in
the first place** — turned out to live in a totally different, second
Apps Script project that nobody had written down anywhere. Found by
tracing backwards: no function anywhere in `D:\fin-app\backend` ever
creates a *new* Transactions row from raw text (every function there
only reads or edits rows that already exist) — so it had to be
somewhere else. The user confirmed: Tasker forwards every SMS it
receives to this second script, which decides on its own whether to log
it and what to log.

- **Local source**: `D:\fin-app\sms-parser-backend` (this repo), synced
  via `clasp` the same way as `backend/`.
- **Script ID**: `1q_WLqVdysdbSJGuWkqWYhRy5CONYFqiLVYfd57Dw4EvlZBirocfFMxgc`
  — unnamed/default name in the Apps Script editor, only one file:
  `Code.js`.
- **Deliberately kept separate from the main project**, not merged —
  decided 2026-08-10. Reasoning: this script is the single most
  "can't-afford-to-break" path in the whole app (a bug here means a
  transaction is silently never logged at all, with no error the user
  would ever see — unlike a PWA bug, which is at least visibly broken
  and fixable). Merging would also require re-pointing Tasker at a new
  URL, risking a gap in logging during the switch, for a purely
  organizational benefit that documenting both projects here already
  gets us.
- **What it does** (`Code.js`, `doPost(e)`): receives `{sms, sender,
  timestamp}` from Tasker → `isTransactionSMS()` filters out OTPs/offers/
  rewards/etc → `ruleParser()` extracts amount/type/mode/bank/reference/
  counterparty via regex → if the parse looks shaky (`shouldUseAI()` —
  no counterparty, counterparty looks like a raw UPI ID, or no
  reference found), `verifyWithAI()` asks Gemini to double-check just
  the counterparty/reference → `isDuplicate()` checks the reference
  against existing rows → `saveTransaction()` appends the new row to
  `Transactions`. Every step also logs to a separate `Logs` sheet
  (`logWebhook`) — not the same as the main project's `AILogs`.
- **Two deployments exist**, same gotcha as the main project: one
  `@HEAD` (always latest), and one **pinned** version 9, labeled "SMS
  Send to GS" — Tasker's HTTP task is pointed at whichever URL matches
  the pinned one, not `@HEAD`. **After any `clasp push` here that should
  reach Tasker, also run
  `clasp deploy -i <that deployment id> -d "<what changed>"`** — a plain
  push alone only updates the editor draft and `@HEAD`, exactly like the
  main project's `TypeMemory` incident.
- **Security fix (2026-08-10)**: `GEMINI_API_KEY` used to be hardcoded
  as plain text directly in `Code.js` — a real, working key sitting in a
  file about to be committed to a public GitHub repo. Moved to Script
  Properties (`GEMINI_API_KEY`, set manually in the editor, same pattern
  as the main project's `GEMINI_KEY`) before this folder was ever added
  to git, so the old key value never touched git history.
- **Not yet investigated**: whether the `SHEET_ID` hardcoded in `Code.js`
  (`1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw`) is the exact same
  spreadsheet the main project is bound to — almost certainly yes (both
  read/write the same `Transactions` sheet the PWA displays), but never
  explicitly confirmed since the main project never hardcodes its own
  Sheet ID anywhere (it's container-bound, so no ID needed there).

**Digital wallet double-counting — fixed 2026-08-10.** Topping up a
wallet (e.g. PayZapp) and then spending from it were both ending up as
separate debit rows, double-counting the same money.

First attempt used `Mode` ("wallet" vs "upi") to tell a top-up apart
from a real purchase — wrong, caught by checking real rows in the
user's actual sheet: an actual top-up (recovered later via a bank
statement import, Channel "Import"/Source "Bank Statement", **not** the
live SMS path) had `Mode: "upi"`, not `"wallet"`. Also, a genuine ₹1
test purchase had its `Counterparty` filled in as "PayZapp Wallet" too
(by the AI clean-up step, `verifyWithAI`/Gemini, in the SMS parser) —
so neither `Mode` nor `Counterparty` alone can reliably tell the two
apart.

What actually holds up across every real row checked (3 real top-ups +
6 real small purchases, amounts ₹1–₹8000): a top-up is a full bank-to-
wallet transfer, so it always carries a real UPI **Reference** number
(e.g. `963466680709`). Every genuine small in-wallet purchase had a
**blank** Reference — the wallet just deducts from its own balance
internally, no separate transfer reference gets generated. Final rule,
`isWalletTopUp(counterparty, reference)` in `PWA.js`: Counterparty
mentions "wallet"/"payzapp" AND Reference is non-blank = a top-up, skip
it from spend. Wired into both `getTodaySummary` and
`getMonthlyAnalysis`, same pattern as the credit-card-bill-payment fix.
Verified against all 10 real cases with a standalone Node test before
shipping (both attempts, first version caught as wrong before it did
any damage since the user checked real sheet data before it needed a
real-world wait-and-see). The top-up row still shows up in Pending for
a note/category like any other transaction — it's excluded from spend
totals only, not hidden.

**Still an open, separate question, not investigated:** *why* did this
particular top-up need to be recovered via a bank statement import in
the first place, instead of being caught live by Tasker/the SMS parser
like your everyday wallet purchases are? The SMS text itself
("Sent Rs.4625 From HDFC Bank A/C *8774 To PAYZAPP WALLET") should pass
`isTransactionSMS`'s checks fine on the *message body* — one real
possibility is the SMS *sender ID* for this specific alert doesn't
contain any of the hardcoded bank names (`isTransactionSMS` checks the
sender against a fixed list: HDFC/FED/SBI/ICICI/AXIS/KOTAK/YES/PAYTM),
which some UPI transfer confirmations use a generic sender for instead
of the bank's own ID. Not fixed — would need the actual sender ID from
a future top-up to confirm before touching that logic.

## PROPOSED PLAN: Category/Type restructure + cross-tab linking (2026-08-09)

**Status: Phase 1 done. Phase 2 fully done (Investment, Saving, AND
Debts auto-link all shipped 2026-08-10** — the earlier "keep Debts
manual" decision was revisited and reversed the same day, once
Investment/Saving auto-linking proved out well).** User pushed back
2026-08-09: not confident in a big phased plan, wants one
feature perfected at a time instead, starting with Pending. User's
explicit rule for this plan stands regardless: present it, get explicit
approval on which phase/line to work on, before touching any code. Do not
assume or build ahead. Stay in one-line-per-item format, no paragraphs.

**Financial Events — Rent, EMI, Investment all shipped 2026-08-10.**
Full scenario-by-scenario design discussion first (Rent, EMI, Investment,
Need/Want/Saving, Lending, each confirmed separately), including a real
course-correction: the original "remember by Counterparty" detection
idea was proven wrong using the user's own sheet data (the exact same
₹1 test wallet deduction produced inconsistent Counterparty values
twice), before any code was written. Rebuilt around amount-matching
instead (Rent/SIP payments recur at close to the same amount every time
— Counterparty doesn't reliably repeat, amount does). Rent + Investment
shipped first; **EMI needed a second, different mechanism** — a real
example (an EMI paid to the user's dad, ₹1,427 one month instead of the
usual ₹4,000 after deducting home expenses) proved amount-matching alone
would miss it, so EMI also matches by note-text keyword ("laptop emi" in
the note) when the amount doesn't match. EMI also supports multiple,
separately-named loans (e.g. "Laptop EMI" vs "Home Loan EMI"), with a
name-it text input the first time a new one is spotted. A confirmed
Rent/EMI/Investment transaction is excluded from spend totals and shown
as its own "Fixed obligations" (Rent+EMI) / "Invested" line on Analysis,
and skips the Need/Want/Saving question entirely. Also closed a gap
flagged during design but not fixed until this same pass: a lending
transfer was already correctly skipping Need/Want/Saving but was never
actually excluded from the spend total itself — now is. Plus two real
`category.js` bugs found along the way: bank names (HDFC/ICICI/AXIS/SBI)
wrongly triggering "Investment", and "sent to"/"transfer to" wrongly
triggering "Lending" as loose substrings (same bug class as an
already-fixed one in `needWantSaving.js`, just never applied here). Full
detail: [docs/features/financial-events.md](docs/features/financial-events.md)
— always check that file before touching this feature further.

**What actually shipped instead (2026-08-09, Pending-only, NOT the same as
Phase 1 below):** Need/Want/Saving gained a 4th tag, **Investment**
(Saving ≠ Investment, per the user — the app's own Savings vs Investments
tabs already agree), plus smarter cold-start guesses for rent/home-loan/
insurance/saving-instruments/investment-instruments. **Corrects Phase 1's
"Rent/EMI = Need" bullet below, which was wrong** — user caught it: an
EMI's nature depends entirely on what was financed (a TV EMI ≠ a home
loan EMI), so plain EMI deliberately has NO auto-default, only the
specific phrase "home loan"/"housing loan" does. Also critically: none of
these are hard-coded forever — real answer history for a specific
merchant always overrides the cold-start guess once it exists. No
category-list changes were made (Rent/EMI are NOT new top-level
categories, unlike what Phase 1 below describes). Initially shipped
Pending-only, then corrected same day per user: "one feature at a time"
means the tagging system is the feature, not one screen — History and
Reconciliation show this same toggle too, so all three now have all 4
buttons. A real bug was caught and fixed same day too: the type you
picked was never actually saved per-transaction — only fed into the
shared `TypeVotes` learning pool — so History displayed a live re-guess
that visibly drifted as you answered more transactions for the same
merchant (an old "Want" started showing as "Need"). Fixed with a new
`NeedWantSaving` column directly on `Transactions`; History now reads
that stored value instead of re-guessing. Verified with a standalone
Node test simulating the exact drift scenario before shipping.

**Lending exclusion actually fixed (2026-08-10).** User lent ₹100 to a
friend, noted it "lent," and the app still asked Need/Want/Saving/
Investment — the original exclusion rule checked `category === "Lent"`,
but the visible category is always "Financial" (Lending was only ever an
internal subcategory, never passed through). Fixed with real note-text
detection (`isLendingTransfer`), enforced in three places: the
suggestion itself, a server-side guard in `saveTransactionNote` (belt
and braces even if the frontend sends a stale value), and the frontend
toggle now hides live as you type a matching note, in all three screens.
Also fixed in the same pass: a broken variable reference in `Recon.js`
(`typeMemoryData`, a leftover from the earlier rename) that was silently
breaking suggestions for half of Reconciliation — found by reviewing
every call site while making this fix, not user-reported.

**That same-day fix shipped a worse bug — caught and fixed within the
hour (2026-08-10).** The word "lent" was matched as a plain substring,
which also matches inside "exceLLENT", "siLENT", "taLENT", "caLENDar",
"spLENDid" — so ordinary transactions were silently having their
Need/Want/Saving/Investment choice dropped while still showing "Saved."
User hit this directly: re-tagged several days of History, tapped Save
each time, refreshed, found the selections gone. First suspected (and
ruled out by asking) forgetting to tap Save. Fixed properly: whole-word
matching (`\blent\b` etc, not substrings) plus a permanent regression
test for this exact bug class; `saveTransactionNote` now also reports
`typeRequested`/`typeSaved` separately so a *future* silent-skip reason
can never look identical to success again — all three save flows show
"saved, but the type wasn't" instead of a generic "Saved." when that
happens. Verified end-to-end with a Node test reproducing the exact
scenario before shipping.

**A THIRD fix, same day, from that new transparency message actually
working as designed.** User sent a screenshot: a real ₹46 "wallet"-mode
transaction (no counterparty at all — normal for a wallet debit, unlike
UPI) said "type wasn't saved (looks like a loan/repayment)" — but that
message was wrong. `isLendingTransfer` correctly said `false` for this
text; the real bug was that `saveTransactionNote` required a truthy
`counterparty` before it would EVEN consider saving column Q — nothing
to do with lending at all. Any transaction with no merchant identity
could never save a type. Root cause: column Q (one transaction's own
answer) and `recordTypeVote` (the per-merchant learning pool) have
different requirements — a vote needs a merchant to attribute to, a
single row's own answer doesn't — but both were gated behind the same
`counterparty` check. Split them apart; verified against the exact
transaction from the screenshot before shipping. This is the value of
yesterday's transparency fix working exactly as intended — a silent
failure would have taken far longer to find.

**Need/Want/Saving/Investment extended to Cash + a chart on Analysis
(2026-08-10): done.** User asked for a chart on the Analysis screen, then
explicitly asked to extend tagging to Cash first so the chart would
cover the whole picture, not just bank transactions. Cash entries now
carry the same 4-way tag (its free-text note stands in for "counterparty"
since cash has no bank-parsed merchant — no cold-start guess attempted
there though, kept to a plain manual pick). `getMonthlyAnalysis` now also
returns a combined Need/Want/Saving/Investment breakdown across
Transactions + Cash, rendered as a hand-rolled SVG donut chart (no
library) using the exact colors the type buttons already use. Untagged
spend is its own visible segment, never hidden — the 50/30/20 guideline
comparison is computed against tagged spend only, so untagged doesn't
understate it. Verified the arc math and every percentage directly
before shipping. Full detail:
[docs/features/need-want-saving.md](docs/features/need-want-saving.md).

**Full-app gap review + fixes (2026-08-10): done.** User asked for a
full pass over every backend file and the frontend to find gaps, ranked
by importance — then asked to fix the most important ones, with "keep
user experience in mind" as the guiding rule. Found and fixed, most
important first:

1. **Every "read" action (loads a screen) had zero error protection** —
   only "write" actions (saveNote, addDebt, etc.) had their own
   try/catch. If a read action ever hit something unexpected, the error
   escaped all the way past `doPost`, returning Apps Script's raw error
   page instead of this app's clean `{ok:false, error}` shape. Fixed
   with ONE shared `try/catch` wrapping the entire action dispatch in
   `handlePwaRequest` (`PWA.js`), instead of patching ten separate
   functions — any action added later is protected automatically too.
   Verified by forcing a real error (a missing sheet) and confirming it
   comes back as a clean message instead of throwing.
2. **Credit card double-counting, confirmed and fixed.** Raised as a
   suspicion earlier, never actually checked until now: nothing excluded
   a credit card BILL PAYMENT from spend totals, so money was being
   counted twice for anyone paying by card — once at swipe time, once
   again when the bill got paid off. New `isCreditCardBillPayment()`
   (best-effort keyword match on bank narration — genuinely can't be
   certain without seeing real statement wording, **needs a real-world
   check**: watch your next card bill payment and confirm it's excluded
   from Total Spend). CC Advisor itself was never affected — it always
   only counted actual card swipes.
3. **Cash and Investments had no way to correct a past entry** — unlike
   Transactions (History), a typo in an amount/note/category/type meant
   editing the Sheet directly, against the app's own "everything from
   the app" rule. Both "Recent" lists are now editable cards (same
   pattern as History/Pending), with the same lending-aware toggle
   behavior. Savings was deliberately NOT included in this pass — one
   "Log a Saving" splits into up to 3 separate rows across pots, and
   editing that after the fact needs its own careful design, not a
   rushed bolt-on; flagged as the next thing to tackle if it comes up.

Verified everything with Node tests using known inputs before shipping,
same rigor as every other fix today — not just a read-through.

**CC Advisor rebuilt (2026-08-10): done.** User asked for a "drastic"
UX improvement, with one condition: check the underlying math is sound
first. That check found a real, previously-unknown bug — the old code
only ever tracked ONE billing cycle (whichever one "today" falls
inside), so for roughly 70% of any month (the 19th through the 9th of
the next month) the "Payment due" date shown described a brand-new
cycle two months away, not the bill that had actually just closed and
was awaiting payment. Fixed by tracking an "outstanding" (most recently
closed, real near-term bill) and a "current" (still running, not due
yet) cycle separately, always. Also added the actual "drastic" part:
an affordability check answering "can I pay this without hurting next
month" directly — cash + recent income vs. bill + monthly expenses +
this month's Rent/EMI + savings goal — using data the app already has,
nothing new to enter. Shown as an interactive mockup first, per the
"show before building" rule; the real build reused existing UI patterns
(hero card, tap-to-expand accordion already built for Analysis) rather
than new ones. Verified with an 8-case Node test (including the exact
bug scenario and a year-rollover case) before shipping. Full detail:
[docs/features/cc-advisor.md](docs/features/cc-advisor.md).

**Why this exists:** user flagged that "Rent"/"EMI" don't belong as
categories at all (a category should group *varied* things — breakfast,
lunch, dinner all fit under Food; rent has nothing else "under" it) and
that using multiple tabs to piece together one financial picture is
tedious. Full reasoning lives in chat history around 2026-08-09; this
section is the actionable plan that came out of it.

**Core distinction driving the whole plan:** *Category* = variety of
spending (Food, Transport, Shopping...). *Type* = a recognized financial
event (Rent, EMI, Lending, Borrowing, Investment, Income). Types are
detected and routed, not picked from a category list.

**Phase 1 — Fix classification**
- Rent, EMI, Lending, Borrowing, Investment stop being categories/subcategories → become detected Types.
- ~~Detected Types skip the Need/Want/Saving question entirely (Rent/EMI = Need...)~~ — **wrong, corrected 2026-08-09**: EMI is not safely auto-Need (depends what was financed). See status note above for what actually shipped.
- "Bills" category shrinks to small recurring stuff only (electricity, mobile, internet) once Rent/EMI leave it.

**Phase 2 — Auto-link across tabs (no manual re-entry)**
- ~~SIP/mutual fund/stock payment detected → auto-logged in Investments.~~ — **done 2026-08-10.** You name each investment once (e.g. "Mutual Fund"), confirmed ones auto-log into the real Investments tab, skips if a likely-duplicate manual entry already exists nearby in time. See [docs/features/financial-events.md](docs/features/financial-events.md).
- ~~A "saving" note auto-logged into Savings~~ — **done 2026-08-10, not originally planned this way.** Your own idea: if the note says "saving"/"savings," auto-log it, split across the same 3 pots manual entries use. Same duplicate-avoidance as Investment.
- ~~Money sent to a person (not a business) → auto-logged in Debts as Lent.~~ — **done 2026-08-10** (earlier "keep manual" decision reversed the same day). Confirm the person's name once, remembered after that — a wrong person would be a real mistake here (unlike a cosmetic label), so this always confirms rather than guessing, see Financial Events doc's "Debts auto-linking" section.
- ~~Money received from a person → auto-logged in Debts as Borrowed.~~ — **done 2026-08-10**, same mechanism, direction-aware.
- ~~A repayment ("Raj paid back") settles the matching debt automatically.~~ — **done 2026-08-10**, but ONLY when there's exactly one matching open debt for that person — falls back to manual if none or several, deliberately never guesses which one.
- Every auto-created entry stays editable/deletable — never locks the user in. — true for Investments/Savings/Debts auto-entries (edit via the same screens manual entries use).

**Phase 3 — Fix numbers that depend on Phase 1**
- "Average per day spend" excludes Rent/EMI, divides by real days elapsed in the month, not just days with any spending (current bug: divides by days-with-spending only, inflating the number — flagged by user 2026-08-09).
- New stat: "Fixed obligations this month" (Rent + EMI) shown separately from day-to-day spend.
- Category charts (Today/Analysis/CC) get cleaner automatically — less clutter, since Types are pulled out of them.

**Phase 4 — Less tab-hopping**
- A transaction that auto-linked elsewhere shows a small "→ also added to Debts" note right on it — no need to go check that tab.
- Goal: one transaction, one place to see its full story.

**Phase 5 — Reliability pass** (folds in an already-flagged, not-yet-started item)
- ~~Re-check CC Advisor's own math for accuracy.~~ **Done 2026-08-10**,
  see "CC Advisor rebuilt" note above — found and fixed a real due-date
  bug, plus added the affordability check. Not done as part of "Phase
  5" formally (done ahead, as its own standalone request), but closes
  this line item.
- Re-check AI Advisor / Gemini tips still make sense once category/type splits land.

**Open questions for the user, not yet answered:**
- Which phase to start with, or a different order entirely.
- Whether any other current category feels wrongly lumped together, beyond Rent/EMI (user was asked, hasn't answered yet as of this entry).
- Exact detection rule for "money sent to a person" vs "money sent to a business" for Phase 2's auto-Debts linking (currently the category engine already has this rough distinction via `matchByPattern`'s Lending keywords, but it's not rigorous — needs real design before Phase 2 starts).
