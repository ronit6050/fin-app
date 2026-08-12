# Agent Backlog

One place listing everything the specialist agents (`backend-agent`,
`sms-parser-agent`, `ui-ux-expert`) have found but not yet acted on —
so nothing gets lost in chat history, and "what should we prioritize"
has one file to check instead of re-reading old conversations.

## How this file gets used

- When an agent runs a "weekly check" and finds something, it gets
  added here (not left sitting only in a chat reply).
- When the user picks something to act on, whoever does the work moves
  it from here into a **Recently fixed** entry at the bottom, and (for
  anything real) also records it properly in `CLAUDE.md` / the relevant
  `docs/features/*.md` — this file is a working list, not the permanent
  record; `CLAUDE.md` is still the permanent record.
- Status tags used below: 🛠️ ready to fix now · 🔍 needs a real example
  before fixing (fixing blind risks guessing wrong) · 🧹 safe cleanup,
  low urgency · 💡 feature idea, not a bug · ❓ a product decision only
  the user can make.

## My picks, if prioritizing from scratch (2026-08-11)

1. 🛠️ **EMI-filter risk** (SMS Parser #2) — if this is real, it means
   real loan payments are silently never logged. Worth a quick check
   against your next EMI payment before it needs a code fix.
2. 🛠️ **Old CC Advisor due-date bug** (Backend #1) — same bug already
   fixed elsewhere; if a background trigger still calls the old code,
   you could still get a wrong-due-date push notification. A 2-minute
   check in the Apps Script Triggers page (not something an agent can
   see) settles this either way.

Everything else below is lower urgency — good for a "next time we're
doing cleanup" pass, not urgent.

## Backend (`backend/*.js`)

1. 🔍 **Old CC Advisor (`CCAdvisor.js`, Telegram-era) still has the
   pre-fix due-date bug** that was already fixed in `PWA.js` on
   2026-08-10. Since push notifications now go out regardless of
   whether Telegram is on, an old time-based trigger calling this code
   could still send a wrong-due-date alert. *Check the Apps Script
   Triggers page to see if such a trigger still exists — an agent
   can't see this from the files.*
2. 🧹 **Two "matches part of a word" bugs in `category.js`**, same bug
   class as the already-fixed "lent" inside "excellent" bug:
   `findMerchantMatch`'s exact-match check has no word-boundary
   protection, and the tea/coffee "Snacks" rule matches "tea" inside
   ordinary words like "team." Low real-world impact (small amounts
   only for the second one).
3. 🧹 **An untested `"SPLIT"` debt type** in `getDebtsData()` counts as
   money owed to you, but nothing currently creates that type — worth
   confirming it's not leftover from an older version before trusting
   it in a money calculation.
4. 🔍 **A second AI fallback path references an undefined function** —
   `sms-parser-backend/Code.js`'s `verifyWithAI()` falls back to
   `callChatGPT()` if an `OPENAI_API_KEY` were ever set instead of
   Gemini's key, but `callChatGPT` is never defined anywhere in the
   file. Harmless today since Gemini's key is the one actually used —
   would only matter if that ever changed.
5. 💡 Confirm the new Savings screen has a way to fix a typo in a past
   entry, the way History/Cash/Investments already do (Savings was
   deliberately left out of that pass, see CLAUDE.md's "Full-app gap
   review" note).
6. 🔍 **`sendSundaySavingsReminder` (`SavingsAdvisor.js`) still uses the
   OLD 4-pot Savings math** (`EMERGENCY_TARGET`/`getSplitRule`) —
   found during the 2026-08-12 backend cleanup pass. Harmless if the
   Telegram bot's weekly-reminder trigger isn't actually installed
   anymore, but if it is, that one weekly message would be showing
   stale numbers. Same "check the Triggers page" situation as item 2
   above — worth checking both at the same time.

## SMS Parser (`sms-parser-backend/Code.js`)

Full detail on all of these is in `CLAUDE.md`'s "SMS ingestion" →
"Known open items" block — this is the short version. None are
confirmed bugs; each needs a real example to prove one way or another.

1. 🔍 A real SMS using only the word "withdrawn" or "deposited" (not
   also "debited"/"credited"/etc.) would get logged with a blank
   debit/credit label.
2. 🔍 Any message containing "emi" is filtered out before it's even
   checked — could be blocking real EMI payment alerts, not just spam.
   **Deprioritized 2026-08-12**: user confirmed they have no EMI on
   their account right now, so there's no real message to test this
   against. Revisit only if/when an EMI ever gets set up.
3. 🔍 The reward/points/cashback spam filter could catch a real
   transaction confirmation that happens to mention reward points.
4. 🧹 The "block future-dated reminder" safety check is dead code — an
   earlier check already lets those messages through first.
5. 🧹 Reference numbers only match pure digits — weakens duplicate
   detection and the wallet top-up vs. purchase distinction if any
   bank uses letters in its reference numbers.
6. 🔍 The recognized bank sender-ID list (HDFC/FED/SBI/ICICI/AXIS/
   KOTAK/YES/PAYTM) may not cover every account — worth checking
   against all your real accounts.
7. 🧹 The saved timestamp uses the ambiguous zone label `"IST"` instead
   of the unambiguous `"Asia/Kolkata"`.

## UI/UX (`index.html`)

Full detail in `CLAUDE.md`'s Step 11 → "Known UI polish items" block.

1. 🧹 Inconsistent loading states — 8 screens use a plain spinner, Home
   and Pending use nicer skeleton placeholders.
2. 🛠️ No "Retry" button anywhere when a screen fails to load.
3. 🛠️ The "← Back" link on More sub-screens has an undersized tap
   target and doesn't match the app's hand-drawn icon style.
4. 🛠️ Settings screen fields aren't visually grouped by topic.
5. 🧹 Some style duplication instead of reusing shared classes (Savings
   manual-split row, `.fe-btn` vs `.type-btn`, repeated inline
   subheading styles) plus some unused leftover CSS.
6. 🧹 One stray emoji outside the agreed exceptions ("✨ Updated" in the
   What's New popup).
7. 💡 CC Advisor's affordability breakdown could use color-coded
   visual hierarchy (safe vs. risky), like the CC usage bar already has.

## Product decisions only the user can make

(Carried over from the Category/Type restructure plan in `CLAUDE.md` —
still unanswered as of 2026-08-11.)

1. ❓ Whether any category besides Rent/EMI feels wrongly lumped
   together with unrelated things.
2. ❓ The exact rule for telling "sent to a person" apart from "sent
   to a business," needed before Phase 2's Debts auto-linking can be
   made more rigorous.
3. ❓ Whether to revisit AI Advisor / Gemini tips now that category/type
   splits have landed (flagged in Phase 5, not started).
4. ❓ CC statement import (`Credit Card.js` → PWA) — user said to pick
   this up after the 18th of the month, when the next bill generates.

## Feature ideas (discussed directly with the user, not agent-found)

1. 💡 **"Safe to spend till next salary"** — Home screen card idea,
   fully designed in conversation on 2026-08-12, then deliberately
   deferred: user said the app keeps growing new features and wants it
   to "build up properly" first — pick this up later, don't start yet.
   Design agreed, ready to build when picked up:
   - **Salary auto-detect**: a bank credit landing between the 1st–7th,
     noticeably bigger than usual spending, gets a confirm chip — same
     pattern as the Investment Instruments note-match chip —
     *"Looks like your salary, ₹X — confirm?"* Deliberately always asks,
     never auto-trusts after a few confirms (unlike Investments), since
     the user can receive other large amounts in that same date window
     and a wrong guess here would throw off every number downstream.
   - **Other income also counts**, not just salary: debt repayments
     (already tracked by the existing Debts feature — no new detection
     needed, just include the number), plus a simple yes/no chip for
     anything else unexpected (dividend, bank interest, other) —
     *"₹500 credit — count this as extra income?"* No need to know which
     sub-type, just spendable-or-not.
   - **Formula**: `money left = confirmed salary + confirmed extra
     income + debt repayments already tracked − everything spent since
     salary day`.
   - Only a **confirmed salary** resets the "days left" countdown; other
     income just tops up the pot without changing the cycle.
   - Display: a small Home card, e.g. *"₹1,240/day safe to spend · 9
     days to go."*
   - Why salary *amount* alone isn't enough to store as a fixed Settings
     number: the app has no live bank-balance connection, so it has to
     reconstruct "money in hand" as salary minus tracked spending since
     that date — and since the real amount varies with deductions and
     the date drifts 1st–7th, a fixed manually-entered figure would go
     stale every month. Auto-detecting the real credit avoids that.

## Recently fixed (for reference — full detail stays in CLAUDE.md)

- **2026-08-11**: `autoLogSaving` was writing auto-detected savings
  into old, now-unrecognized Savings bucket names — fixed to write
  into Free Savings instead, deployed live. See
  [docs/features/savings-v2.md](features/savings-v2.md) and
  [docs/features/financial-events.md](features/financial-events.md).
- **2026-08-12**: Full backend cleanup pass — old dead Savings code
  (`getSavingsData`/`logSavingFromApp`/`logCCBufferSaving`/
  `addWishlistItemFromApp`/`markWishlistPurchasedFromApp` and their 5
  action routes) and 4 small unused leftovers in `category.js`
  (`askAI`/`normalize`/`extractKeyword`/`migrateToSmartMemory`)
  removed. Caught one real near-miss along the way: `getSavingsData()`
  was still secretly being called by the Home screen's main data
  function even though its result was never shown — fixed properly
  (function + call site + the response field all removed together),
  verified with a new test before pushing. Pushed to the Apps Script
  editor draft (`clasp push`) — **not yet deployed live**, needs the
  user's go-ahead. See CLAUDE.md's 2026-08-12 "Backend cleanup pass"
  entry and [docs/features/savings-v2.md](features/savings-v2.md).
