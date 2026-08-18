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

**Second visual redesign — Login, Home charts, Analysis, More tab,
new palette, hand-drawn category icons (2026-08-11): done.** Built by
the `ui-ux-expert` subagent after two rounds of interactive mockups
(a soft pass, then a bolder one) were shown and approved — user's
words: "works for now but we will improve later but for now good
work," i.e. approved to ship, not required to be pixel-perfect.
Frontend-only (`index.html`), same "hand-written CSS, no frameworks,
reuse existing tokens/classes" rules as every past redesign here. What
changed:
- **Login screen** — was a bare Google button on empty space, now has
  an app-mark icon, "Welcome back" heading, a one-line reassurance,
  the Google button in a card, and a "Private — only your own Google
  account can sign in" trust line. A subtle CSS-only drifting-blob
  background sits behind the mark (transform-only animation, no
  images/blur filters, respects `prefers-reduced-motion`, disabled
  automatically for anyone with that OS setting on).
- **Home tab** — two new small charts under the stat grid: a stacked
  bar of this month's category spend (+ a chip row of the top 2-3
  categories and amounts, "+N more"), and a Need/Want/Saving/Investment
  snapshot bar reusing the app's existing 4-way tag colors. Both link
  to the Analysis tab rather than duplicating its detail — kept
  deliberately small, not a mini dashboard. Uses data the existing
  `getDashboard` call already returns, no new backend call.
- **Analysis tab** — every category's progress bar is now colored to
  match that category's own badge color (was one uniform color
  regardless of category). The old prev/next circular-arrow buttons
  were replaced with a single pill-shaped month switcher (arrows only
  show a background on press/hover, not by default) — user specifically
  disliked the old filled-circle-arrow look.
- **More tab** — regrouped into labeled sections (Daily / Advisors /
  Tools) with each item as a rounded icon tile instead of a plain list
  row, which is what actually fixes the "feels like a generic list, not
  a native app" complaint. Folded in four already-tracked rough edges
  from the 2026-08-11 look-and-suggest review below in the same pass:
  the 8 screens that showed a plain spinner + "Loading..." now use the
  same skeleton-card style Home/Pending already had; every failed load
  now shows a proper error state with a "Retry" button that re-runs the
  same load function instead of a dead end; the small plain-text
  "← Back" link became a properly-sized tap target using the same
  hand-drawn SVG chevron style as the rest of the app; and Settings'
  fields are now grouped under Appearance / Credit card / Budget and
  goals headings instead of one flat list.
- **New color palette** — accent moved from a plain generic blue to a
  richer indigo/violet; the signature high-contrast hero card (today's
  spend, etc.) moved from near-black to a deep forest green in light
  mode, so it now visually matches the vivid green already used for the
  same element in dark mode (previously the two modes used unrelated
  colors for what's meant to be the same signature surface). All
  category / Need-Want-Saving-Investment colors were deliberately left
  untouched — the user relies on those for meaning.
- **Real contrast bug found and fixed during this pass, not by the
  original mockup review**: the brighter dark-mode indigo needed for
  links/icons to stay legible on a near-black page (`#8B80FF`) was also
  being used as the SOLID FILL behind white button text on every plain
  `<button>` (Save, Confirm, +Add Debt, etc.) and the new Retry button —
  that specific pairing (light purple fill + white text) only reached
  about 3.2:1 contrast, under the 4.5:1 minimum for normal-size text,
  even though the same color read fine everywhere else (as text/an
  icon/a border against a card or page background, which is a
  different, much less strict pairing). Fixed with a new token,
  `--button-fill` — same as `--color-primary` in light mode (already a
  comfortable 5.6:1, unaffected), but the existing, already-defined
  darker `--color-primary-dark` shade in dark mode (4.6:1, passes) —
  confirmed by computing the WCAG contrast ratio for the actual hex
  pairs, not a visual skim. This is exactly the class of bug flagged as
  a risk for this redesign; catching it is the reason that check was
  called out as a requirement.
- **Category icons** — replaced the emoji category badges (🍕 Food, 🚗
  Transport, etc.) with hand-drawn line-icon SVGs (`stroke="currentColor"`,
  no fill), matching the exact style already used for the nav bar and
  More-menu icons. All 10 categories in the app's real list (Food,
  Transport, Bills, Shopping, Lifestyle, Financial, Income, Education,
  Health, Other) have a finished custom icon — none were skipped.
- **Tactile press effect** — a soft raised-edge shadow that collapses
  flat + shifts down 3px on tap, applied only to the elements the user
  asked for: the Home hero card, the More tab's icon tiles, the Retry
  button, and the card holding the Google sign-in button (the actual
  Google-rendered button lives in a cross-origin iframe, so its own
  hover/press state can't be restyled directly — giving the card around
  it the same raised depth is the closest equivalent without touching
  Google's widget). Deliberately not used anywhere else, per the user's
  explicit "not everywhere" instruction.
- Verification note: the browser preview pane in this session never
  composited a frame at all (every `screenshot`/`zoom` call timed out,
  on both a `file://` open and a local dev server, before and after
  code changes) — a broader version of this project's known preview
  limitation, not just the already-documented "live theme toggle"
  case. Checked instead via: full code/contrast review (including the
  bug above), CSS brace-balance + JS syntax validation, the
  accessibility-tree structure (`read_page`) in both a light and a
  dark `prefers-color-scheme`, and the browser console (no errors in
  either mode). Real on-device visual confirmation in both themes is
  still owed to the user before considering this fully verified — flag
  this the same way the past dark-mode repaint check was flagged,
  rather than claiming a visual check that didn't actually happen.

**Known UI polish items — status updated 2026-08-11 (originally flagged
same day by a look-and-suggest review):**
- ~~Inconsistent loading states~~ — **done**, see redesign entry above.
- ~~No "Retry" button on a failed load~~ — **done**, see above.
- ~~Undersized/inconsistent "← Back" link~~ — **done**, see above.
- ~~Settings fields not grouped by topic~~ — **done**, see above.
- Still open, NOT touched by this redesign pass: some small style
  duplication instead of reusing shared classes (the Savings
  manual-split row's one-off styling, `.fe-btn` duplicating `.type-btn`,
  repeated inline `style="font-size:...; margin:..."` subheadings
  instead of one shared class, some unused leftover CSS from earlier
  redesigns); the one stray "✨ Updated" emoji in the What's New popup
  heading; and CC Advisor's affordability breakdown still being a plain
  list of numbers with no color-coded visual hierarchy.

**Dark mode chart color fix (2026-08-12): done, deployed live.** User
felt every chart/graph (Analysis donut, Home/Analysis bars, category
badges) looked muddy/dark specifically in dark mode, formatting
untouched. Took 5 rounds of `ui-ux-expert` work, each based on the user
testing a mockup and reporting back what still felt wrong — a good
example of why "show before building" matters for subjective visual
calls:
1. Brightened the two most washed-out category colors (Financial,
   Income/Need) — user said no visible difference.
2. Brightened all 10 category + Need/Want/Saving/Investment colors
   meaningfully — still not enough.
3. Root cause found: badges and charts already shared the exact same
   color values — a badge is a bold filled dot, but the donut ring was
   only 16 units thick and category bars were 7px tall, so the same
   color read as weak once spread that thin. Fixed with dedicated
   `--chart-*` tokens: thicker donut ring, taller bars, a brighter
   `--chart-track-bg` for contrast, plus a glow effect.
4. User shared a reference "vivid palette" image and correctly called
   out that rounds 1-2's "brighter" was actually "lighter/pastel" (68-92%
   lightness) — real vividness is saturation at a punchier, more
   medium lightness. Re-picked every hex value the right way: same hue
   per category, saturation pushed to 85-92%, lightness set to the
   lowest value that still clears WCAG contrast against
   `--chart-track-bg` (green/yellow hues can go genuinely dark and
   punchy; blue/purple/red/pink hues need more lightness to hit the
   same contrast — a real limit of the contrast math, not a shortcut).
5. User A/B tested the glow directly and preferred plain color — glow
   tokens (`--chart-glow-shadow`/`--chart-glow-filter`) turned back to
   `none` in dark mode, keeping the thicker ring/bars/track from round 3.
Also confirmed via a direct side-by-side test (same colors, two
different page-background darknesses) that the near-black page
background itself was NOT the problem — user preferred the current
near-black over a lighter charcoal test, so the whole-app dark theme
was correctly left alone; the fix was chart-specific tokens only.
`change-reviewer` checked the full diff before push (both dark-mode
blocks — `@media (prefers-color-scheme: dark)` and
`:root[data-theme="dark"]` — confirmed in sync, light mode confirmed
untouched, no orphaned/dead code, contrast re-verified independently).
`APP_VERSION` bumped to `2026-08-12-02`. Deployed via `git push` — this
is a frontend-only (`index.html`) change, no Apps Script/`clasp deploy`
involved.

**Round 6, same day: chart colors split from badge colors, deployed
live.** After round 5 shipped, user tested on their phone (whose default
is dark mode) and compared against manually switching to light mode —
light mode looked brighter. Explained the part that's inherent (a white
page will always make colors pop more than a near-black one — not
fixable without abandoning dark mode, and the user already confirmed via
a direct background A/B test that the near-black page should stay).
But one real lever was still unused: every chart fill (donut ring,
category bars, stack bars, CC Advisor bar) was reading the exact same
color token as the small category badges — badges need to stay gentle
since they have text sitting on top, but chart fills have no text on
them and never needed that restraint. Added a parallel `--chart-*`
token tier: a plain alias of the badge colors in light mode (zero visual
change there), and its own more saturated standalone values in dark
mode, repointed `categoryBarColor()`/`NWS_CHART_COLORS`/CC Advisor's bar
to read the new tier while badge-rendering code keeps reading the
original tokens. `change-reviewer` confirmed badge tokens are
byte-identical to what was live (not just described as unchanged), both
dark-mode blocks stay in sync, and all 16 new values clear WCAG contrast
against `--chart-track-bg` (margin is thin — lowest is 4.68:1 against a
4.5:1 floor — worth remembering if `--chart-track-bg` itself changes in
a future round). Deployed via `git push`.

**Demo Mode (2026-08-12): done, deployed live.** Settings → "View Demo
Mode" fills every tab with a fixed, realistic pretend dataset (a
believable month of transactions, debts, savings, investments, etc.),
so the app can be shown to someone without exposing real numbers or
risking any write to the real Sheet. Built by `ui-ux-expert`,
frontend-only (`index.html`). Works by intercepting `callAppsScript()`
— the single function every screen's loading and every Save/Add button
already goes through — so when `demoMode` is on, it never calls
`fetch(APPS_SCRIPT_URL...)` at all; instead a local dispatcher
(`demoRouteAction`, search `DEMO MODE (added 2026-08-12)`) reads/writes
an in-memory copy of the pretend dataset (`demoFreshState()`) and hands
back responses shaped like the real backend. Save/Add really do update
the screen (feels real), but only that in-memory copy — exiting does a
plain `location.reload()` to throw it all away and bring real data back
clean. A persistent amber banner ("Demo Mode — pretend data, not
yours") with an Exit button stays on every screen so it's never
ambiguous which data is showing. Verified directly (not via subagent,
to conserve usage after this session hit its limit mid-review):
confirmed `callAppsScript`'s `fetch` is the only path to
`APPS_SCRIPT_URL` in the whole file (grepped), confirmed the
`loadCache`/`saveCache` guards actually skip themselves while
`demoMode` is on (no real-data flash, no pretend data leaking into the
real cache), and confirmed the new banner's colors have both a light
and dark definition. `APP_VERSION` bumped to `2026-08-12-04`. No
`docs/features/` file — kept to this one entry since the whole feature
is one self-contained dispatcher function, not spread across the
backend.

**Third visual pass — blue + off-white theme (2026-08-12): done,
deployed live.** User's own colour picks (non-designer, explicit
preference): white/off-white background + blue as the main colour;
charts and everything else left to be decided on looks. Two mockup
rounds shown via the visualize tool before touching code, per the
"show before building" rule — first a light-mode-only comparison
(hero card also blue vs. hero kept a separate dark colour — user
picked "hero also blue," the unified option), then a light+dark pair
to confirm the dark-mode direction too, since this is a PWA that must
respect the phone's own system light/dark switch on top of the
in-app Settings toggle. Built by `ui-ux-expert`:
- Accent moved from purple/indigo (`#5B4FE9` light / `#8B80FF` dark)
  to blue (`#2563EB` light / `#4C8DFF` dark).
- Light-mode page background moved from a cool grey to a warm
  off-white (`#F7F3EA`); dark mode's near-black page was left as is.
- The hero card ("today's spend") is now filled with the SAME blue as
  the accent, in both themes — replacing its previous separate
  dark-green identity, so there's one signature colour instead of two
  unrelated ones.
- Category badges, Need/Want/Saving/Investment tag colours, and chart
  colours were deliberately left alone in this pass — see the chart
  fix below for why that turned out to matter.
`change-reviewer` checked the diff before push: recomputed every
contrast ratio itself rather than trusting the diff's own comments,
confirmed both dark-mode CSS blocks stayed in sync, confirmed no
leftover old-theme hex values anywhere in the file, and specifically
re-checked the "solid button fill + white text" pairing since that
exact bug shape shipped once before in this project (2026-08-11,
the indigo theme) — correctly avoided this time via the existing
`--button-fill` token. `APP_VERSION` bumped to `2026-08-12-05`.

**Bug found right after shipping — some phones fight the app's own
colours (2026-08-12): fixed, deployed live.** User reported picking
Light in Settings but still seeing a half-dark, half-light mismatched
screen (dark background/cards, but the hero card still correctly
showing its light-mode white-on-blue look). First fix: added
`<meta name="color-scheme" content="light dark">` plus a matching CSS
`color-scheme` property (locked to `light`/`dark` when the user's
Settings choice sets `data-theme`) — this stops the *browser's* own
automatic dark-theme heuristic (e.g. Chrome's built-in "force dark for
web contents") from recolouring the page on top of the app's own
CSS. Shipped, but didn't fully resolve the user's report. **Real root
cause**, found by the user after being asked to check: a phone/OS-level
"force dark for all apps" setting — separate from, and not governed by,
what a webpage's CSS declares — was recolouring the app underneath the
browser entirely. Turning that off directly in the phone's own settings
fixed it; nothing further was needed in the app's code for that specific
report. The `color-scheme` fix is still a correct, worthwhile addition
on its own merits (it prevents a real, different failure mode — the
browser's own force-dark, not the OS's), just wasn't what this
particular report turned out to be. `APP_VERSION` bumped to
`2026-08-12-06` for the `color-scheme` fix.

**Light-mode chart colours were muddy — fixed same day, deployed
live.** Once the theme above was confirmed working, user flagged the
Home "Where it's going" stacked bar and the Need/Want/Saving snapshot
bar as dull/muddy in light mode. Root cause: this app already has a
dedicated `--chart-*` colour tier (added 2026-08-12, "round 6" of an
earlier dark-mode-only chart pass — see the dark-mode chart-color-fix
entries further up) specifically because a badge's text colour and a
large chart fill have different needs — a badge colour is tuned to be
readable as small text on a light tinted background, not to be a bold
standalone fill. Dark mode already got its own vivid, standalone
values in that round; light mode was left aliasing the badge/category
text colours, "good enough" at the time, but read weak once the page
background changed to the new warmer off-white above. Fix
(`ui-ux-expert`): gave light mode its own standalone vivid values for
all 14 `--chart-*` tokens — same hue family as before per category,
nothing reassigned — each one computed (not eyeballed) to clear at
least 4.78:1 contrast against the new `--chart-track-bg` (`#F1ECE1`).
The same real WCAG-math pattern already seen in the dark-mode round
showed up again, mirrored: green/gold hues (Financial, Income,
Education/Want) need to stay genuinely darker to hit contrast on a
light track; blue/purple hues (Transport/Saving, Lifestyle, Investment)
can stay brighter and still clear it. Badge colours and both dark-mode
blocks were left completely untouched — confirmed via diff before
push. `APP_VERSION` bumped to `2026-08-12-07`.

**"Feels instant" everywhere — Save/Add/Edit/Delete made optimistic on
every remaining screen (2026-08-12): done, not yet deployed (pushed to
GitHub still pending the user's go-ahead).** Pending's Save already
worked this way (the card disappears the instant you tap Save, the real
network call happens quietly after — see that handler's own comment,
searchable as "Pending's Save is optimistic"). User asked to extend the
same trade-off everywhere else that currently waits for Apps Script to
respond before the screen changes. Frontend-only (`index.html`), no
backend touched. What actually changed, screen by screen:
- **Cash** — adding an entry and editing a past one both update the
  balance/today's-spend and the Recent list immediately; a failed
  background save reverts the numbers and reopens the form with what
  you typed still in it.
- **Debts** — adding a debt, Settling one, and Recording a partial
  payment all update the You Owe/Owed to You lists and the "You're
  Ahead/Behind" totals immediately (a partial payment mirrors the
  backend's own `applyDebtPayment` rule locally — pays off exactly ->
  settles it, matches the same math). All revert on failure.
- **Investments** — logging and editing an entry update the total +
  category breakdown immediately.
- **History** — was the one screen that still wasn't optimistic even
  though it reused Pending's own `saveNote` action; now shows "Saved."
  the instant you tap it (it doesn't remove the card like Pending does,
  since History edits a transaction in place) and reverts the fields on
  failure. Kept the exact same honest partial-failure messages Pending
  already had (e.g. "note saved but the type wasn't, looks like a loan/
  repayment").
- **Savings** — the one screen this needed real judgment on, since its
  numbers (Emergency/CC Buffer targets, "can afford to buy this goal"
  thresholds) are computed by the backend, not just simple totals.
  Withdraw, Manual Split, editing/deleting a past entry, adding a goal,
  Set Priority, and Mark Purchased are all optimistic, using a new
  `applySavingsBucketDelta` helper that only ever does plain addition/
  subtraction on a bucket's saved amount (verified correct with a
  standalone Node test) — never re-derives the backend's real business
  logic. Auto Split is the one deliberate exception: it only applies
  optimistically when a matching real preview (from `previewSavingsSplit`,
  fetched moments earlier while you were typing the amount) is already
  in hand, reusing the backend's own just-computed split rather than
  guessing the Emergency -> CC Buffer -> priority goal -> Free waterfall
  itself; if the amount changed since that preview, it falls back to the
  old wait-for-the-server behavior rather than show a guess.
- **Judgment call, not applied everywhere blindly:** every destructive
  action here (Settle a debt, delete a Savings entry, Mark Purchased)
  was still made optimistic, same as Pending's own philosophy — nothing
  is actually lost, since a failed background save puts the card/entry
  right back with a clear error, it only *looks* gone for the moment
  between tapping and a real failure (rare). Settings and Reconcile were
  deliberately left as-is: Settings is a single form with no list to
  update instantly, and Reconcile is a batch review-many-then-submit
  flow, not a single Save button — neither fit this pattern.
- **A real gap found while verifying, not shipped as a bug**: double-
  checked that History's transparency messaging (note/category saved
  but the type wasn't, or an investment note-match didn't log because it
  looked like a duplicate) still works correctly once made optimistic —
  it does, since the optimistic step only ever shows "Saved." and the
  same honest follow-up message still overwrites it if the backend's
  response says only part of the save actually went through.
- **Verification**: full JS syntax check (Node), a standalone Node test
  of `applySavingsBucketDelta` (the reusable Savings math), and a full
  render pass of Cash/Debts/Investments/Savings/History against Demo
  Mode's real pretend data (via a temporary, since-removed test-only URL
  hook that bypassed Google Sign-In — never shipped) confirmed every
  touched screen renders correctly with no console errors. **The actual
  click-and-watch-it-revert testing could NOT be done this session** —
  this environment's browser preview pane never composited a single
  frame (every `screenshot` call timed out, and every `computer` click
  reported the target element "outside the viewport (0,0)", even for
  elements confirmed present and correctly laid out via the DOM/
  accessibility tree) — a more severe version of this project's
  already-known preview limitation. Real-device testing of the actual
  tap-Save-and-see-it-update-instantly (and a forced-offline test of the
  revert path) is still owed before this is fully confirmed working, the
  same way the original dark-mode live-toggle repaint was flagged rather
  than claimed. `APP_VERSION` bumped to `2026-08-12-08`.

**`change-reviewer` caught a real, significant bug before this shipped
(2026-08-12), fixed same day, still not deployed live.** `renderDebts`/
`renderCash`/`renderInvestments` never set the new `debtsData`/
`cashData`/`investmentsData` tracking variables the optimistic-Add code
depends on — only `renderSavingsGoals` did (`savingsData = s;`, from the
2026-08-11 Savings rebuild), which is exactly why Savings didn't have
this problem and the other three did; it was an inconsistency from
copying the pattern without copying that one line. Since Home
pre-loads Debts/Cash/Investments in the background on every sign-in
(`seedTabsFromDashboard`) and that path never touches the real
`loadDebts()`/`loadCash()`/`loadInvestments()` functions (the only
place that used to set these variables), the very first "+ Add" you
tapped on any of those three tabs in a normal session would silently do
nothing on screen for 1-3 seconds — no error, no "Saving...", nothing —
until a background refresh quietly caught up. No money was ever wrong
or lost, but it directly broke the "feels instant" goal at the exact
moment it mattered most. **Fixed** by adding `debtsData = d;` /
`cashData = c;` / `investmentsData = inv;` at the top of each render
function (mirroring `renderSavingsGoals`), so the variable is always
correct regardless of which caller renders the screen.

Two smaller issues from the same review, also fixed: Savings' "Mark
Purchased" was calling `applySavingsBucketDelta(savingsData, g.name,
-g.saved)` on top of already manually zeroing the same goal's `saved`
field — a double-application landing on a negative number. Currently
invisible (every screen that reads `savingsData.goals` filters to
`status === "Active"`, and this goal's status was just set to "Done"),
but a real data-model bug worth closing properly — removed the
redundant call. Also, editing a Cash **credit** entry's amount wasn't
updating the balance figure optimistically (only "debit" edits were) —
added the matching `credit` branch.

Re-ran the full Node syntax check after these fixes — clean. Pushed to
GitHub and live on 2026-08-12 (commit `3e00bd8`) — for this frontend-only
change, `git push` IS the live deploy step (unlike the backend's
separate push/deploy split), so this was also the first real chance to
test it on an actual phone, not just in code review.

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

**Responsiveness pass, part 2 (2026-08-12): done, deployed live.**
User reported switching Analysis months, and new
transactions showing up, both still felt slow (3-10 seconds). Root
cause found: `verifyGoogleIdToken` (`PWA.js`) — the "is this really
Ronit?" check that runs before EVERY single action — called out to
Google's servers over the internet on every single tap, with no
memory of an already-verified token. That round trip was the single
biggest, most-repeated source of delay in the whole app (every tab,
not just Analysis). Two fixes:
1. `verifyGoogleIdToken` now remembers a verified token's result for
   5 minutes using Apps Script's own fast built-in memory
   (`CacheService`), keyed by a hash of the token (never the raw
   token). A failed/rejected check is deliberately never cached — so a
   real problem can't get masked as "cached as broken" for 5 minutes.
   Verified with a new test,
   `backend/tests/verifyGoogleIdTokenCache.test.js` (same-token cache
   hit, different-token cache miss, failures never cached, 300s TTL).
2. `index.html` now listens for `messaging.onMessage()` — a push
   arriving while the app is already open used to just sit there
   until the next scheduled 15-second poll caught up (nothing was
   listening for it in the foreground); now it triggers an immediate
   re-check the moment the push lands.
Apps Script's own "wake up" latency (inherent to how Apps Script Web
Apps work, not something in our control) still applies — this won't
be instant like a native app, but should be noticeably faster across
every screen, not just Analysis. `APP_VERSION` bumped to
`2026-08-12-01`. Deployed live via `clasp deploy` (@301) and pushed to
GitHub — nothing left pending on this one.

**Backend cleanup pass — old unused code removed (2026-08-12): done,
deployed live.** A full read-through of every
`backend/*.js` file plus a caller/route check for every function in the
codebase (built by counting how many places each function name is
actually used, then hand-checking every low-count one), looking for
code nothing calls anymore from anywhere the real app can reach —
plain-English: leftover helper functions from old rebuilds that got
replaced but never cleaned up, still physically sitting in the files.
The one hard rule: the live app must not break — anything not 100%
certain was left in place rather than guessed at. What was removed:

1. **The old 4-pot Savings functions** (`getSavingsData`,
   `logSavingFromApp`, `logCCBufferSaving`, `addWishlistItemFromApp`,
   `markWishlistPurchasedFromApp` in `PWA.js`) and their 5 action routes
   (`getSavings`/`logSaving`/`logCCBuffer`/`addWishlistItem`/
   `markWishlistPurchased`) — this was the item already flagged as
   confirmed-safe-to-delete in `docs/features/savings-v2.md` and
   `docs/AGENT_BACKLOG.md`, now actually done. **One real catch made
   during this pass, worth remembering**: `getSavingsData()` was NOT
   fully unused the way the existing notes assumed — `getDashboardData()`
   (the function behind the Home screen's main data call) was still
   quietly calling it on every single load, even though `index.html`
   never actually reads that result (it only reads the newer
   `full.savingsGoals` field, confirmed by checking every place
   `index.html` touches `full.`). If this had been deleted as "just
   dead code" without checking every caller first, the very next Home
   screen load would have crashed with "getSavingsData is not defined."
   Fixed properly: removed the function AND its call site inside
   `getDashboardData()` AND the now-empty `savings:` field it fed into
   the response. The Telegram-era helper functions these old functions
   *reused* (`getSavingsTotals`/`getSplitRule`/`getStageLabel` in
   `SavingsAdvisor.js`) were deliberately left untouched — they're still
   genuinely used by the old Telegram bot's own Savings menu (currently
   switched off, but kept working on purpose in case it's ever turned
   back on with the `TELEGRAM_ENABLED` flag — see below).
2. **Three small unused leftover functions in `category.js`**: `askAI`,
   `normalize`, `extractKeyword` — old backward-compatibility wrapper
   functions around `getCategory()` that, on checking, nothing anywhere
   actually called (confirmed by searching every file for each name).
   `getCategory()` itself was kept — it's still a real, live fallback
   used inside `getSmartCategory()`.
3. **One completed one-time migration function**, `migrateToSmartMemory()`
   (`category.js`) — this already did its one job back on 2026-08-08
   (copying the old `CategoryMemory` sheet into a fresh `SmartMemory`,
   see the Automation-phase notes above), nothing calls it anymore, and
   its source sheet (`CategoryMemory`) is already documented as
   superseded. Removed.

**What was deliberately left alone, and why** (the "safety over
thoroughness" rule in action — none of this was touched):
- **All of the Telegram bot's own code** (`handlers.js`, `telegram.js`,
  and the Telegram-only parts of `CCAdvisor.js`/`DebtAdvisor.js`/
  `SavingsAdvisor.js`/`Analysis.js`/`Summary.js`/`cash.js`/
  `AIAdvisor.js`/`Recon.js`/`Credit Card.js`) — the bot is switched off
  today (`TELEGRAM_ENABLED = false`), but this code is deliberately kept
  working end-to-end so flipping that one flag back to `true` instantly
  restores it, exactly as already documented. None of it is truly dead —
  it's a working feature that's just turned off, not a leftover.
- **Several "runs on a schedule" functions** (`checkCCAlerts`,
  `checkDebtDueDates`, `sendWeeklyDebtNudge`, `sendDailyCashCheckin`,
  `sendSundaySavingsReminder`) — these aren't called by any code file,
  but that's expected: they're meant to be run automatically by an
  Apps Script "Trigger" (a scheduled timer set up separately in the
  Apps Script editor's Triggers page, not visible from the code files
  themselves). Deleting these without checking that page first could
  silently break a real, currently-working daily/weekly notification.
  **Checked 2026-08-12** — user shared a screenshot of the real
  Triggers page. Only 3 triggers actually exist: `checkDebtDueDates`,
  `processNewTransactions`, `sendDailyCashCheckin` — all legitimate,
  still needed. `checkCCAlerts` (the function with the old due-date
  bug) and `sendSundaySavingsReminder` (the one with stale math) are
  BOTH absent — neither runs automatically, so neither risk is real.
  `sendWeeklyDebtNudge` is also absent — noted as a possible gap (no
  automatic weekly debt nudge going out) but not confirmed as a real
  problem, just flagged since it turned up in the same check. These 4
  remaining unscheduled functions (`checkCCAlerts`, `sendWeeklyDebtNudge`,
  `sendSundaySavingsReminder`, plus test/debug helpers below) are now
  safe to clean up on a future pass since we know for certain nothing
  triggers them.
- **A handful of "test"/"debug"/"one-time setup" helper functions**
  (`testSmartCategory`, `testCash`, `testDashboard`, `testTransaction`,
  `testRepaymentPlan`, `debugRepaymentPlan`, `testPushNotification`,
  `testNeedWantSaving`, `testExtractNoteFromNarration`, `setupBotMenu`,
  `setupMenuButton`, `auditInvestmentsSheet`) — these are meant to be
  run by hand from the Apps Script editor (select the function, click
  Run) to manually check something works, the same idea as this
  project's own `backend/tests/*.test.js` files but written for
  Apps Script instead of Node. Harmless to leave, genuinely still
  useful for manual troubleshooting later.
- **`migrateSavingsToV2()`** (`savingsGoals.js`) — a one-time migration
  function, almost certainly already run (the live Savings screen only
  works if it was), but `docs/features/savings-v2.md` itself already
  flags that this was never independently double-checked against the
  real spreadsheet. Left in place rather than guessed at.
- Every function in the newer, actively-developed files
  (`financialEvents.js`, `investmentInstruments.js`, `needWantSaving.js`,
  `noteMemory.js`, `savingsGoals.js`, `settings.js`) was individually
  checked and confirmed to have a real, live caller — nothing unused
  found there.

Verified with a new saved test,
`backend/tests/backendCleanup2026-08-12.test.js` — proves the 5 removed
Savings functions and their action routes are genuinely gone from the
code, proves the 3 removed `category.js` wrappers are gone while
`getCategory()` still works, and (the most important check) proves
`getDashboardData()` still runs end-to-end without crashing and every
real screen's data is still present in its response after removing the
unused `getSavingsData()` call. Full test suite (all 6 files under
`backend/tests/`) passes. Deployed live via `clasp deploy` (@302) and
the commit (`7fb9b0e`) pushed to GitHub on 2026-08-12 — nothing left
pending on this pass.

**Two "matches part of a word" bugs fixed in `category.js` (2026-08-12).**
Same bug class as the already-fixed "lent" inside "excellent" problem,
just never applied to this file: `findMerchantMatch`'s exact-match check
used `searchText.includes(merchant)` (a bare substring test), so a
merchant memory entry named e.g. "tea" would also match inside an
unrelated word like "team." The built-in tea/coffee/chai "Snacks" rule
in `matchByPattern` had the same gap. Both now use whole-word regex
matching (`\b...\b`) instead — safe because `normalizeText()` strips
merchant names down to just letters/digits/spaces first, so no regex
special characters ever reach the pattern. Verified with a new test,
`backend/tests/categoryWordBoundary.test.js` (confirms "team meeting"
no longer false-matches, a real "tea" purchase still matches, a
multi-word merchant like "swiggy instamart" still matches correctly).
Deployed live via `clasp deploy` (@303) on 2026-08-12 — nothing left
pending on this fix.

**Analysis payment-mode filter — backend + frontend both done
2026-08-17, pushed, NOT yet deployed/pushed live (waiting on the
deploy go-ahead).** A new All / Bank / Card / Wallet toggle on the
Analysis screen — so you can see "what did I spend just on my credit
card this month" separately from UPI/bank transfers or wallet spend,
instead of only ever seeing everything blended together.
`getMonthlyAnalysis` (`backend/PWA.js`) now also returns a `byMode`
key with the exact same numbers (total spent, total in, savings,
biggest category, category breakdown, Rent/EMI, Invested, Need/Want/
Saving/Investment split) computed three more times — once each for
Bank, Card, and Wallet — using the `Mode` column each bank transaction
already carries (Card = the payment mode starts with "card", same
check already used for the credit-card-bill-payment fix; Wallet = mode
is exactly "wallet"; Bank = everything else — UPI, NEFT, ATM). Cash
entries (the separate Cash tab) have no payment mode at all, so they
deliberately only ever show up in the existing "All" totals, never in
any of the three new buckets — confirmed with the user before
building. All the same exclusion rules that already applied to "All"
(a credit card bill payment, a wallet top-up, a money-lent transfer,
and a confirmed Rent/EMI/Investment) apply per-bucket too now — e.g. a
credit card bill payment made via UPI is excluded from the Bank
bucket's spend, not just from "All." The existing "All" numbers
returned by this function are completely unchanged — this is purely
additive, verified by asserting the exact old field list and values
still come back unchanged for a mixed fixture. Verified with a new
test, `backend/tests/analysisByMode.test.js` (mixed card/wallet/UPI/
NEFT rows land in the right bucket with correct totals; a Cash entry
appears only in "All"; a bill-payment/top-up stay excluded per bucket
not just overall; a Rent/Investment row is excluded from that bucket's
spend and shows up in that bucket's own fixedObligations/invested
instead). Full existing test suite (8 files,
299 checks) still passes. `clasp push`ed (editor draft only, not the
live app yet — needs a `clasp deploy` go-ahead).

**Frontend (`index.html`): also done.** A small icon-only segmented
pill (All / Bank / Card / Wallet) sits in the top-right of the Total
Spent hero card — hand-drawn icons matching the app's existing style,
reusing only the hero card's 3 existing color tokens so both themes
work with no new colors. Tapping a segment re-renders the whole
Analysis screen (total, income/savings/avg-per-day line, Fixed
obligations/Invested pills, category list + Top expense, and the
Need/Want/Saving/Investment chart) from the `byMode` data already
fetched — no extra network call. "All" is byte-identical to how the
screen always looked; the toggle resets to "All" on a real month
change, not on a routine background refresh of the same month (a real
bug where a background refresh silently undid a toggle tap was caught
by `change-reviewer` and fixed before this note was written). Demo
Mode was also extended to compute matching Bank/Card/Wallet numbers
from its own pretend data, so the toggle can be tried out from
Settings → View Demo Mode before this is live. `git push` not yet
done — pending your review and go-ahead, same as the backend's
`clasp deploy`.

**Planner tab — Phase 1 (started 2026-08-18): backend AND frontend both
done and tested, not yet live.** Backend `clasp push`ed to the editor
draft (not `clasp deploy`d); frontend built in `index.html` (not `git
push`ed) — both need your go-ahead first, see below. A new tab for setting a spend TARGET per category for
the month, then tracking real spend against it. Designed through several
rounds of mockups (via the visualize tool) before any code — the mockups
caught a real design flaw: a plain per-category budget (e.g. "Food
₹6,000") blends essential and discretionary spend together (groceries
vs. restaurants, both "Food"), same problem this project already solved
once for Rent/EMI ("a category should group *varied* things, not
mix intent"). Fixed by reusing the existing Need/Want/Saving/Investment
tag already on every transaction: a category only splits into separate
Need + Want targets when the user's own history shows it's genuinely
used both ways (computed from real data, never hand-picked) — Bills/
Health-style categories that don't mix stay a single target. New
`Budgets` sheet (Month, Category, Type, Target), two new actions
(`getPlannerData`, `saveBudgets`), backend in `backend/planner.js`,
routed in `PWA.js`. Suggested starting targets are averaged from the
user's real spending — but only from **reliable** months: the
Need/Want/Saving/Investment tagging system didn't exist before August
2026 and had real bugs fixed as late as 2026-08-09/10, so June/July data
is never trusted. Since today (2026-08-18) is still inside the very
first reliable month with zero complete reliable months yet, the
suggestion falls back to scaling real partial-August spend up to a
full-month estimate — confirmed with the user as the preferred fallback
(vs. showing a blank target until 3 full months exist) before it was
built. Verified with a new test, `backend/tests/planner.test.js`
(reliable-month cutoff, the scaled-partial-month fallback, split-vs-
single-type detection, all the existing double-counting exclusions
reused correctly, multi-month averaging with the drop-the-oldest
behavior once more than 3 complete months exist). Full existing suite
(9 files) still passes. Full detail, schema, and the exact action
contracts the frontend build needs:
[docs/features/planner.md](docs/features/planner.md). Frontend built in
`index.html` by `ui-ux-expert` same day — a "Set targets"/"Track
progress" toggle inside More → Tools, category rows that split into
Need/Want sub-targets exactly as the backend decides, a live running
total, optimistic save, and a Demo Mode extension so it can be tried
safely before going live. `change-reviewer` caught one real bug before
ship (the Track view's main progress bar — and the same-shaped,
pre-existing bug already sitting unnoticed in the Savings hero card —
had no CSS height/radius outside `.category-row`, so it silently
rendered at 0px; fixed at the root with a base `.category-bar-track`/
`.category-bar-fill` rule, verified empirically via computed-style
checks in the browser, not just code reading) plus a transparency gap
(a split category's untagged Saving/Investment/no-tag spend wasn't
shown anywhere, so the parent total could look bigger than Need+Want
added together with no explanation — fixed with a small note). Next:
your go-ahead before `clasp deploy` (backend) / `git push` (frontend).

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
- **Explain with short examples, not long paragraphs** (confirmed
  2026-08-11). E.g. instead of a paragraph explaining SIP amount-change
  handling, say: "SIP goes from ₹2000 to ₹3000 → app asks once, you tap
  'Nifty 50 SIP' again, done." Keep explanations short and scannable.
- **Don't ask which approach to use — decide and go, and actively
  manage token/credit usage** (confirmed 2026-08-11, **updated
  2026-08-14** after the user hit their weekly usage limit within just
  a few days of subagent-heavy work — the old "never worry about the
  credits" default is retired). A small tweak (a doc fix, a one-line
  bug fix, a quick backend/frontend change I can verify myself) → just
  make the edit directly, no agent, no asking first — unchanged. For
  anything bigger, I now weigh the actual intensity of the work before
  reaching for a subagent, instead of defaulting to one for anything
  "big": if I can do it directly and verify it myself (a Node test, a
  careful read of the diff, the browser preview) without much more
  effort than briefing a subagent would take, I do it directly. A
  subagent is for when it's genuinely needed — real parallel work, a
  large multi-file feature, or a second independent set of eyes before
  something risky ships (`change-reviewer`, the security-review skill —
  that safety net stays, it's not being cut to save tokens). The
  judgment call is still mine to make without asking first; the bar for
  "this needs a subagent" is just higher now than it was.
- One step at a time for anything that needs my judgment or that I'm
  actually going to use/experience — this hasn't changed.
- **Refined 2026-08-11**: "one step at a time" was about me being the one
  experiencing the app, not a rule against automation in general.
  Repetitive or discovery work (finding UI rough edges, scanning for
  backend bugs, suggesting next features) can be handed to a specialist
  agent that reports back with findings/mockups for me to approve —
  see "AI agents (subagents)" below. Nothing ships without my OK either
  way; the difference is I no longer have to be the one who notices/asks
  first.
- Clear comments in the code.
- Plain, simple explanations.

## AI agents (subagents) set up for this project (added 2026-08-11)

**No separate "manager" agent** — considered, but rejected same day:
subagents can't call each other or call the user directly in this
setup, they can only be called by the main chat session and report
back to it. So the main chat session is already the manager — it
decides which specialist to use and pulls results together. What *was*
missing was a shared place for that "manager" (the main chat) to check
"what's outstanding" without re-deriving it from old conversations —
that's [docs/AGENT_BACKLOG.md](docs/AGENT_BACKLOG.md), added the
same day. Any agent that finds something during a "weekly check" adds
it there; ask "what should we prioritize" in any future session and
that file (plus this one) is where to look first.

Four specialist agents exist under `.claude/agents/`, each scoped to a
real boundary already in this codebase — not an invented org chart:

| Agent | Scope | File |
|---|---|---|
| `ui-ux-expert` | `index.html` — all visual/UI work | `.claude/agents/ui-ux-expert.md` |
| `backend-agent` | `backend/*.js` — the main Apps Script backend | `.claude/agents/backend-agent.md` |
| `sms-parser-agent` | `sms-parser-backend/Code.js` only — kept separate, extra cautious, since it's the one file that fails silently (see "SMS ingestion" section) | `.claude/agents/sms-parser-agent.md` |
| `change-reviewer` | Any change, whichever file it touches — reviews the diff right before it goes live | `.claude/agents/change-reviewer.md` |

**`change-reviewer`, added 2026-08-11, is genuine redundancy, not
another relay layer.** The user's concern: with the main chat session
as the only point of contact for all three specialists, one agent's
blind spot could go straight to the live app unchecked. Rather than
adding a "deputy" agent that just relays tasks (rejected — it wouldn't
reduce anything the main chat session is carrying, since a subagent's
own work already happens in its own separate context, not the main
session's), this adds a second, independent set of eyes that reviews
a *finished* change before the risky step, not one that manages other
agents. It didn't write the change, has no stake in defending it, and
can't ship anything itself (read-only + can re-run saved tests, no
Write/Edit, no `clasp`/`git push`). **Workflow going forward**: once
`backend-agent` or `sms-parser-agent` says a fix is push-ready, run
`change-reviewer` on the diff before asking the user for the actual
`clasp deploy` go-ahead, and show the user both reports together. Same
idea applies to a `ui-ux-expert` change before it's pushed to GitHub
(which is what actually updates the live GitHub Pages site).

**Security-review skill, added same day.** Claude Code has a
pre-built `security-review` skill (a dedicated security-scanning
procedure) — since this app handles real financial data, and a real
security issue was already found and fixed by hand once before
(2026-08-09), the main chat session now also runs that skill directly
on any live-bound change, alongside `change-reviewer`'s general review,
before asking for the deploy/push go-ahead. This is a second,
security-focused pass, not a replacement for `change-reviewer`'s
broader check.

Each can be given a specific task, or asked to run a **"weekly check"** —
scans its area for bugs/rough edges/next-feature ideas and reports a
short list back for approval. Nothing gets built or deployed in that
mode without explicit go-ahead.

**Deliberately NOT on an automatic schedule.** Considered making the
weekly checks run on their own (a scheduled cloud routine), but paused
it: that would use Claude usage in the background on a recurring basis,
and I couldn't confirm from inside the tool whether that's actually free
on the user's plan — which conflicts with this project's own "no cost"
rule. Decided (2026-08-11) to keep it fully manual instead: the user
just asks for the weekly check whenever they want it, which costs
exactly the same as any other question and never runs without them
asking. Revisit if the user confirms their plan covers it.

**Live-app safety, baked into both new agents' instructions**: neither
`backend-agent` nor `sms-parser-agent` will run `clasp deploy` (the step
that actually updates what the live app/Tasker calls) without the user
explicitly confirming in that same conversation — `clasp push` alone
(editor draft only) doesn't reach the live app, so it's safe without
asking, but deploy does and always needs a yes first. Both agents are
also instructed to save verification test scripts (under `backend/tests/`
or `sms-parser-backend/tests/`) instead of writing-and-discarding them
like past sessions did, and to keep this file and `docs/features/`
updated after any real change — same continuity habit as the rest of
this file.

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
- **`backend/tests/` (added 2026-08-11) holds Node.js verification
  scripts** — real, saved test files (not one-off scripts run once and
  discarded), one per feature fix, run with plain `node
  backend/tests/<name>.test.js`. **`backend/.claspignore` (added same
  day) excludes this folder from `clasp push`** — this matters, not just
  tidiness: these test files use Node-only things (`require`, `fs`,
  `vm`) that don't exist in Apps Script's runtime, and Apps Script runs
  every file's top-level code on each execution (all files share one
  global scope) — so pushing a test file in would have broken every
  single live backend action with a `require is not defined` error the
  next time anything ran. Always keep new test files under `tests/` (or
  otherwise `.claspignore`d) for this reason.
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
- `Savings` — savings entries. **Rebuilt 2026-08-11**: the `Destination`
  column now points at `Emergency`, `Free`, or the exact name of a row in
  the new `Goals` sheet below (was a fixed 4-value set —
  `Emergency`/`WishList`/`Free`/`CCBuffer` — before). See "Savings
  rebuilt" note further down and
  [docs/features/savings-v2.md](docs/features/savings-v2.md).
- `Goals` (new sheet, 2026-08-11) — one row per savings goal, one-time
  (a fixed ₹ target, e.g. a wish-list item) or recurring (target
  computed live, e.g. CC Buffer). Replaces `WishList` as the real
  source of truth for goals.
- `Investments` — investment logs
- `WishList` — the old savings-goals sheet. **As of 2026-08-11, nothing
  live reads or writes it anymore** (superseded by `Goals` above) —
  not deleted, only used once by the one-time migration script that
  moved existing items into `Goals`.
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
- `SavingsAdvisor.js` — original 3-pot auto-split savings, wishlist affordability tracking (Telegram-era). Its `getSavingsTotals()`, `getSplitRule()`, `getStageLabel()`, and constants (`EMERGENCY_TARGET`, `MONTHLY_SAVE_GOAL`) used to be reused directly by PWA.js's live Savings code — **as of the 2026-08-11 Savings rebuild, that's no longer true**: the live Savings screen now runs entirely on `backend/savingsGoals.js` instead. `getSavingsTotals()` etc. are still called, but only by the old `PWA.js` functions (`getSavingsData`, `logSavingFromApp`) that nothing in `index.html` calls anymore — see "Savings rebuilt" note below and [docs/features/savings-v2.md](docs/features/savings-v2.md#old-system--not-deleted-dead-code-flagged-2026-08-11).
- `Analysis.js` / `Summary.js` — original Telegram-triggered monthly/daily spend breakdowns with charts + Gemini insight text (untouched, still Telegram-only; the PWA's Today/Analysis screens use separate lighter functions in PWA.js, not these)
- `Recon.js` — reconciliation. Original Telegram-only functions (`runReconciliation`, `insertConfirmed`, etc.) untouched and still dormant. **Added 2026-08-08**: `extractNoteFromNarration()`, `previewReconciliation()`, `reconcileStatementPreview()`, `insertReconciledTransactions()` — the PWA-facing preview-then-approve flow, see [docs/features/reconciliation.md](docs/features/reconciliation.md). Note: the old `insertConfirmed()` has a pre-existing off-by-one bug (17 values for a 16-column sheet) — harmless since it's dormant, not fixed since nothing calls it anymore.
- `AIAdvisor.js` — Gemini reaction after each transaction note (untouched, Telegram-only path, dormant since Telegram is off)
- `telegram.js` — Telegram dashboard/menu UI. **Modified**: added `const TELEGRAM_ENABLED = false;` (the on/off switch — flip to `true` to instantly restore Telegram sending). `sendMessage(text)` now only sends to Telegram if that flag is true, and — regardless of the flag — always also calls `sendPushNotification()`, using the message's first line as the push title and the rest as the body. This one change is what extended push to every existing proactive alert (CC warnings, debt nudges, savings reminders, daily check-in) without touching those files individually.
- `Logger.js` — silent error logging to `AILogs` (untouched, `logAI(type, message)` used throughout, including by the new PWA.js/push.js code)

**Files added for the PWA (real filenames, confirmed via `clasp clone` 2026-08-08):**
- `main.js` **modified**: `doPost(e)` now branches — if the incoming JSON has an `action` field, routes to `handlePwaRequest(data)`; otherwise falls through to the original `handleTelegramUpdate(e)` unchanged. This is the single shared entry point both Telegram and the PWA hit.
- **`PWA.js`** — everything the PWA talks to, one action per `data.action` value routed inside `handlePwaRequest(data)`. Every action first calls `verifyGoogleIdToken(data.idToken)` (checks the token against Google's tokeninfo endpoint, then checks `PWA_ALLOWED_EMAIL`) before doing anything. Actions implemented: `ping`, `getPending` (includes `suggestedCategory` + `suggestedType` per item, fast layers only, no Gemini), `saveNote` (writes note/category/optional amount, calls `handleCategoryCorrection` + `recordTypeVote` — same function backs both Pending's first note AND History's edits), `getTodaySummary`, `getMonthlyAnalysis`, `getCCAdvisor`, `getDebts`/`addDebt`/`settleDebt`/`recordDebtPayment` (partial debt payments, added 2026-08-10 — see the "PROPOSED PLAN" section's Financial Events note), `getInvestments`/`logInvestment`, `getCash`/`addCashEntry`, `registerPushToken`, `getDashboard` (aggregates most of the above into one call for the Home screen, `getDashboardData` reads `Transactions`/`Cash` once and passes them through — see Responsiveness pass notes above), `getSettings`/`updateSettings`, `getTransactionHistory`, `reconcileStatement`/`insertReconciledTransactions`. **Savings actions, updated 2026-08-11**: the live app only ever calls the new Goals-based set — `getSavingsGoals`, `previewSavingsSplit`, `saveSavingsAuto`, `saveSavingsManual`, `withdrawSavings`, `updateSavingsEntry`, `deleteSavingsEntry`, `addSavingsGoal`, `setPrioritySavingsGoal`, `markSavingsGoalDone`, `purchaseSavingsGoal` (all in `savingsGoals.js`, see below). The older `getSavings`/`logSaving`/`logCCBuffer`/`addWishlistItem`/`markWishlistPurchased` actions still exist and still route to working code, but nothing in `index.html` calls them anymore — dead code, not yet deleted, see [docs/features/savings-v2.md](docs/features/savings-v2.md#old-system--not-deleted-dead-code-flagged-2026-08-11).
- **`push.js`** — real background push via Firebase Cloud Messaging. `sendPushNotification(title, body)` reads the saved device token from Script Properties (`PWA_PUSH_TOKEN`) and a service account key (`FIREBASE_SERVICE_ACCOUNT`, also Script Properties — sensitive, never in any file/repo) to sign a JWT (`getFirebaseAccessToken()`) and call FCM's HTTP v1 API directly. `testPushNotification()` is a manual-run test helper.
- **`needWantSaving.js`** — Need/Want/Saving suggestion engine, see [docs/features/need-want-saving.md](docs/features/need-want-saving.md). Wired into `PWA.js`'s `getPendingTransactions`/`saveTransactionNote`/`getTransactionHistory`, live since 2026-08-08.
- **`settings.js`** (new file, 2026-08-08) — user-editable CC limit/thresholds and savings targets, backed by Script Properties. See [docs/features/settings.md](docs/features/settings.md).
- **`financialEvents.js`** (new file, 2026-08-10 — missing from this list until this 2026-08-11 documentation pass caught it) — Rent/EMI/Investment detection + matching, plus the Phase 2 auto-linking into Investments/Savings/Debts. See [docs/features/financial-events.md](docs/features/financial-events.md).
- **`savingsGoals.js`** (new file, 2026-08-11) — the Goals-based Savings engine (Emergency/Goals/Free) that replaced the old 4-pot system. See "Savings rebuilt" note below and [docs/features/savings-v2.md](docs/features/savings-v2.md).

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

**Known open items, not yet fixed (found during a 2026-08-11 weekly
check of `Code.js`) — these are things worth watching/investigating,
NOT confirmed bugs, and none of them were changed this round:**
- `isTransactionSMS()` accepts "withdrawn" or "deposited" in the
  message as proof a text is a real transaction, but `ruleParser()`'s
  own debit/credit labeling (the code that sets column D, `Type`) never
  checks those same two words — only "debited"/"spent"/"deducted"/
  "sent"/"txn" for debit and "credited"/"received"/"refund" for credit.
  A real SMS that only used the word "withdrawn" or "deposited" would
  get logged, but with a blank `Type`. Would need a real example SMS
  using one of those two words to confirm this actually happens.
- Any bank message containing the word "emi" anywhere in it is
  filtered out completely, before it's even checked for being a real
  transaction — this was meant to block promotional "get an EMI on
  your purchase" spam, but as written it would also block a genuine
  "Your EMI of Rs.4000 has been debited" alert from ever being logged.
  Not confirmed either way — would need to see whether the user's bank
  actually sends EMI *debit* confirmations by SMS, and if so, whether
  any have gone missing.
- The reward/points/offer/cashback spam filter is a plain keyword
  match anywhere in the message — a genuine transaction confirmation
  that happens to mention "reward points" (some banks add a line like
  "earn X reward points on this purchase" to an otherwise real debit
  SMS) could get thrown out along with actual spam. Not confirmed to
  have happened, just a shape of bug this kind of filter can produce.
- The "block future-dated alerts" check (meant to catch messages like
  "will be debited on the 15th" so a reminder doesn't get logged as if
  money already moved) can never actually run: the debit-word check
  earlier in the same function already matches "debited" as a
  substring of "will be debited" and returns true before the code ever
  reaches the future-dated check below it. So this safety check is
  currently dead code — right now nothing is stopping a future-dated
  reminder SMS from being logged as if it already happened, if it also
  contains one of the debit/credit keywords (which "will be debited"
  does).
- Reference numbers are only recognized if they're pure digits
  (`\d{6,}`, six or more digits in a row). A bank that formats its
  reference/UTR number with letters mixed in would never get a
  reference captured at all, which weakens duplicate-detection
  (`isDuplicate()` matches on reference) and also connects to the
  wallet top-up detection logic above, which depends on a reference
  being present to tell a top-up apart from a purchase.
- The recognized bank sender-ID list (`HDFC`, `FED`, `SBI`, `ICICI`,
  `AXIS`, `KOTAK`, `YES`, `PAYTM`) may not cover every account/bank the
  user actually has — any SMS from a sender ID outside this list is
  silently ignored at the very first check, with no log entry
  explaining why (well, it does log "NOT TRANSACTION" to the `Logs`
  sheet, but nothing surfaces that to the user). Worth checking against
  the sender IDs of all the user's real accounts at some point.
- The saved date/time on each row is formatted using the timezone
  name `"IST"` (`Utilities.formatDate(date,"IST",...)`), which is a
  short, ambiguous label — a few other regions also use "IST" for
  their own time zones. Google Apps Script may resolve it correctly in
  practice, but the unambiguous form would be `"Asia/Kolkata"`
  instead, which says exactly which timezone is meant with no room for
  misreading.

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

**CC Advisor — same-day follow-up (2026-08-10): done.** User tried the
rebuild live and pointed out the affordability check only covered the
bill that had already closed — their real habit is spending on the
card right after a new cycle starts, assuming next salary will cover
it, with no running check on how big that's getting until it's too
late. Added an early warning for the still-open cycle: same
cash/income/expenses math as before, now also checked against
spend-so-far and a pace-based projection, so a risky month shows up
while there's still time to slow down. Considered and dropped a
bigger idea (a typed-in "monthly investment" setting + "wants budget")
per the user's own call to keep it simple. Verified with a 4-case Node
test before shipping. Same day, user also caught that "Savings goal"
and investing were being lumped together in the breakdown — added a
separate "Invested this month" line (real amount, from Financial
Events, no new setting) to both affordability cards. Then, once real
numbers were in front of the user, a further catch: the real
amount-so-far understates a fixed monthly investment commitment early
in the month (their example: ₹3,000 invested so far against a real
₹9,000/month commitment) — added a new Settings field, "Monthly
investment amount," and the affordability math now uses whichever is
bigger, the fixed target or the real amount, so a commitment counts
even before its transaction happens, and a genuine over-target top-up
is still never undercounted. Finally, the user asked a bigger-picture
question — how to actually stop CC bills from raiding next month's
salary at all — which led (after checking general, well-established
credit-card practice, not personalized advice) to a **CC Buffer**: a
4th Savings pot, added to manually, that CC Advisor now counts as real
available money in the afford-this-bill check — closing the blind spot
where money the user had already reserved was invisible to the app.
See [docs/features/cc-advisor.md](docs/features/cc-advisor.md) and
[docs/features/settings.md](docs/features/settings.md).

**Savings rebuilt — Emergency / Goals / Free Savings replaces the
4-pot system (2026-08-11): done.** The CC Buffer note just above (from
the day before) described CC Buffer as "a 4th Savings pot" — that's now
out of date. Wish List used to be **one pooled total** for every
wish-list item, which meant two items saved for at once could both show
"ready to buy" off the same shared money — a real bug, not just a
naming gripe. Rebuilt around a `Goals` list instead (see the `Goals`
sheet above): each goal — one-time (a fixed ₹ target, e.g. a wish-list
item) or recurring (target computed live, e.g. CC Buffer, from your
average recent card bill) — gets its own real balance. Also added,
none of which existed before: **Auto Split** (a priority waterfall —
Emergency → CC Buffer → your priority goal → Free — previewed before
you save), **Manual Split** (pick your own destinations, validated to
add up exactly), a generic **Withdraw** action, and **edit/delete** for
past Savings entries. `getCCAdvisorData` (CC Advisor's affordability
check) now reads the CC Buffer balance from this new system
(`getSavingsBreakdown().ccBufferGoal.saved`), not from the old 4-pot
read. Same-day UI follow-ups: the Savings screen's swipeable carousel
became overview-only (3 read-only cards — Emergency/CC Buffer/Wish
List — swipe or tap-a-dot, no buttons), with every action (add,
withdraw, mark purchased, set priority) moved into a tap-to-expand
detail list below it, reusing the same accordion pattern Analysis/CC
Advisor already use. **Full design doc, including exactly what's dead
code now and what's still open:**
[docs/features/savings-v2.md](docs/features/savings-v2.md) — always
check that file before touching Savings further.

**Known, tracked, not-yet-fixed cleanup item (flagged 2026-08-11):**
the old 4-pot Savings functions (`getSavingsData`, `logSavingFromApp`,
`logCCBufferSaving`, `addWishlistItemFromApp`,
`markWishlistPurchasedFromApp` in `PWA.js`, plus the `SavingsAdvisor.js`
functions they call) are **still present in the backend and still
routed** (`getSavings`/`logSaving`/`logCCBuffer`/`addWishlistItem`/
`markWishlistPurchased` actions) — nothing deletes them, they still
work if called directly, and their pot math uses the old, now-stale
`Emergency`/`WishList`/`Free`/`CCBuffer` 4-value `Destination` set.
Nothing in `index.html` calls them anymore (confirmed by checking every
`action:` string it sends), so this is low-risk dead code, not a live
bug — but it should be deleted once that's double-checked, same way
the old `SmartMemory`/`TypeMemory` sheet was left renamed-but-not-
deleted after a past rebuild instead of cleaned up immediately.

**Bug found and FIXED same day (2026-08-11):** `autoLogSaving`
(`financialEvents.js` — the Phase 2 auto-link that fires when a bank
transaction's note says "saving"/"savings") was never updated for the
Savings rebuild above — it was still splitting money using the OLD
3-pot logic and writing `Destination` values
`"Emergency"`/`"WishList"`/`"FreeSavings"`. Only `"Emergency"` still
matched the new system; `"WishList"` and `"FreeSavings"` rows were
written to the Sheet (nothing was ever lost) but the new Savings screen
never counted them — that money silently disappeared from the Savings
totals shown in the app, even though it was really sitting in the
Sheet. Manual "Log a Saving" was never affected (it already went
through the new system as part of the same-day rebuild) — only the
automatic, note-detected path had this gap, and the user confirmed no
real transaction had actually gone through it yet (only the one-time
manual migration had run), so there was no bad historical data to
clean up.

**Fix:** `autoLogSaving` now writes the whole amount straight into
`"Free"` (the new system's own "no specific goal picked yet" bucket,
same shape `saveAutoSplit`/`saveManualSplit` already write) instead of
splitting across the old pots. **Judgment call worth flagging:** since
a bare note word like "saving" can't say which Goal was meant, this
deliberately does NOT run the fuller Emergency/Goal priority split
either — it always lands the whole amount in Free Savings, moveable by
hand afterwards if you want it somewhere specific. Verified with a new
Node test, `backend/tests/autoLogSaving.test.js` (checks the row lands
on `"Free"` not the old names, and that the real Savings screen's own
totals function then actually counts it). Pushed to the Apps Script
editor (`clasp push`) on 2026-08-11 — **confirmed live** (this code was
version 298; the pinned deployment moved to version 301 on 2026-08-12,
a later snapshot that includes it — caught and corrected 2026-08-12
while fixing a similar stale note for Investment Instruments below).
Full detail:
[docs/features/savings-v2.md](docs/features/savings-v2.md#fixed-2026-08-11--autologsaving-now-writes-to-the-real-savings-system)
and
[docs/features/financial-events.md](docs/features/financial-events.md#fixed-2026-08-11--autologsaving-was-writing-the-old-pot-names).

**Investment Instruments — backend built 2026-08-11: pushed, not yet
deployed. Frontend (`index.html`) now wired up, same day, by the
`ui-ux-expert` subagent.** Same fragmentation problem as the
old Savings pots, but for Investments: the Investments tab used to let
you type any "Type" text freehand, so the same fund could split into
two breakdown lines ("Nifty 50" vs "Nifty 50 SIP"). Replaced with a
fixed, named list of the user's real 15 investments (3 SIPs, 6 one-time
funds, 5 stocks, 1 gold instrument), same idea as the `Goals` sheet did
for Savings — new `InvestmentInstruments` sheet
(`backend/investmentInstruments.js`), auto-created and seeded on first
use. SIPs are recognized by amount (reuses the existing Rent/EMI
mechanism, `FinancialEvents`); the other 12 are recognized by note text
only (`matchInvestmentInstrumentByNote`) — deliberately never by
amount, since a one-off stock purchase could otherwise get wrongly
matched to an unrelated SIP that happens to land on the same figure.
Every write path (manual log, edit, note-match auto-log) now validates
the instrument name against this fixed list before writing anything,
which is what actually fixes the fragmentation. Full detail, exact
action/field contracts for the frontend, and open items:
[docs/features/investment-instruments.md](docs/features/investment-instruments.md).

**Confirmed 2026-08-11: a note-matched investment (via `investmentInstrument`)
skips Need/Want/Saving, same as Rent/EMI/a confirmed SIP already do.**
The first version left this open as a judgment call (Category and the
spend total stayed normal, but Need/Want/Saving was still being asked) —
the user resolved it: skip Need/Want/Saving too, buying a stock/fund
isn't that kind of decision either. Fixed in `saveTransactionNote`
(`PWA.js`) — a new `investmentInstrumentValid` check added alongside
the existing lending/Financial-Event/non-spend-transfer exclusions on
column Q. Category and the spend total are still unaffected — only
Need/Want/Saving changed. New test:
`backend/tests/investmentInstrumentSkipsNeedWantSaving.test.js`.

**Frontend pass, done 2026-08-11 (`ui-ux-expert` subagent, `index.html`
only):** the Investments tab is now grouped into SIP/One-time Fund/
Stock/Gold cards instead of one flat list; "+ Log an Investment" is now
a dropdown sourced from the real 15-instrument list (with an inline
"+ Add new instrument" option) instead of a free-typed box; the SIP
naming prompt (Financial Event flow) is also now a dropdown pick
instead of free text (EMI naming was deliberately left as free text,
out of scope); and Pending/History gained a new note-based investment
chip (`suggestedInvestmentInstrument`) — a one-tap confirm when
confident, a picker when "looks new but which one." The
`isInvestmentInstrumentSelected` getter was added as
`wireLendingAwareToggle`'s 5th parameter exactly as the doc's "Frontend
hide-toggle" brief specified, so the toggle now hides live for this
case too. Full detail:
[docs/features/investment-instruments.md](docs/features/investment-instruments.md#frontend--what-actually-shipped-2026-08-11-indexhtml-only).

**`change-reviewer` caught one real gap in that frontend pass, fixed
same day:** `saveTransactionNote`'s response already honestly reports
`investmentLogged: true/false` (`false` when `autoLogInvestment`'s
duplicate-avoidance guard skips the actual write — see the next
paragraph), but the first version of the frontend never read that
field, so a confirmed investment chip could say "Saved." even when the
Investments-sheet row silently never landed. Fixed in both save paths
(History's persistent result line, and a new small dismissible banner
above the Pending list for its optimistic-save case, since Pending's
card is already gone from the screen by the time the response comes
back). Full detail, including why Pending needed a genuinely new small
UI piece (no toast/banner mechanism existed anywhere in this app before
this):
[docs/features/investment-instruments.md](docs/features/investment-instruments.md#a-second-gap-found-by-change-reviewer-not-the-original-frontend-pass-and-fixed-the-same-day).

**Resolved 2026-08-11 (was: "open recommendation, not yet acted on"):**
`hasLikelyDuplicateInvestment`'s 3-day/similar-amount guard no longer
applies to the note-based investment-instrument confirm chip — decided
by the user after `change-reviewer` and `ui-ux-expert` both
independently flagged it as the wrong trust level, same reasoning as
the manual "+ Log an Investment" form (which never had this check at
all): a note-matched confirm is already an explicit, one-tap human
decision, not an automatic guess. `autoLogInvestment` (`financialEvents.js`)
gained an optional `skipDuplicateCheck` parameter (default false — every
existing call, including the Financial Event/SIP auto-log path, is
unaffected); `saveTransactionNote`'s `investmentInstrument` block now
passes `true`. Checked carefully whether this makes the frontend's
`investmentLogged === false` messaging (History's message branch,
Pending's dismissible banner) unreachable dead code for this specific
path: practically yes — the only other way `autoLogInvestment` can
still report `logged:false` is a missing `Investments` sheet, which
never happens in real use (it's a core, always-present sheet, never
auto-created). Left that messaging in place as harmless defense-in-depth
rather than removing it — flagged as a call the user can make either
way, not decided unilaterally. New test:
`backend/tests/autoLogInvestmentDuplicateSkip.test.js`. Full detail:
[docs/features/investment-instruments.md](docs/features/investment-instruments.md#fixed-2026-08-11--duplicate-check-removed-for-note-matched-confirms).

**All done, confirmed 2026-08-12.** The one-time
`migrateInvestmentsToNamedInstruments()` function was run by the user
from the Apps Script editor on 2026-08-11 (converted the Investments
sheet's 5 old generic rows to the 15 real named ones, registered the 3
SIPs for amount-matching). Backend is deployed live — confirmed via
`clasp deployments`: the pinned deployment
(`AKfycbz3Hzmi_XNM_TRyz16sZrUWqIOjrBOfHAcyJheYLVi6YrRK1jhaYC38-CwxeqCU_n_v`)
is at version `@301`, which is a full snapshot taken after version 299
("Investment Instruments: named instrument list, migration, note-based
detection"), so that code is live. Frontend is pushed — confirmed via
`git log`, commit `a5a9d2e`. Nothing left pending on this feature.

**Minor UI polish, same day, not otherwise documented (2026-08-11,
`0a5dcf5` + `b7bd568`):** tap-again-to-confirm before settling a debt or
marking a savings goal purchased (safer destructive actions); darker/
lighter muted text for readability in both themes; bigger Need/Want/
Saving buttons; a wider tap area (with a small visible-dot animation)
around the now-overview-only Savings carousel's dots, plus a deliberate
sliver of the next card peeking in on the right as a "there's more to
swipe" hint; a styled Reconcile file picker (a real `<input
type="file">` can't be restyled directly in any browser, so it's
visually hidden and a styled `<label>` stands in as the clickable
control); SVG icons for Analysis's month-nav arrows (replacing plain
◀/▶ text glyphs); Pending's empty state ("all caught up") switched to
the same icon+message treatment every other empty state already uses,
instead of being the one plain-text outlier; "Show More" → "Show more"
wording made consistent with the rest of the app; and the More menu
reordered so daily-use screens (Cash, History, Investments) sit near
the top instead of after less-frequent ones, with Cash/Investments'
entry forms collapsed behind a "+ Log..." toggle (matching the pattern
Debts/Savings already used) so those screens don't show a form every
time you just want to check recent activity. All frontend-only
(`index.html`), no backend changes, no `docs/features/` file since
these are small polish items rather than a feature.

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
- ~~A "saving" note auto-logged into Savings~~ — **done 2026-08-10, not originally planned this way.** Your own idea: if the note says "saving"/"savings," auto-log it, split across the same 3 pots manual entries used **at the time**. Same duplicate-avoidance as Investment. **Now out of date as of the 2026-08-11 Savings rebuild** — manual entries moved to the new Goals system, this auto-log path didn't, which is a real bug (see the "Real, not-yet-fixed bug" note further down, under "Savings rebuilt").
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
