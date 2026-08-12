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
- **Hard rule, added 2026-08-12 after this file went stale and cost the
  user real time:** before presenting ANY item from this file (or from
  CLAUDE.md) to the user as still-open — whether recommending "what's
  next" or just answering a question — grep/read the actual current
  code first to confirm it's still true. This file and CLAUDE.md are
  written by past sessions and go stale the moment work happens without
  a doc update; they are a starting point for where to look, never
  proof by themselves. This is not optional/best-effort — skipping it
  is exactly what caused the repeat mistake.

## My picks, if prioritizing from scratch (2026-08-12)

Everything that used to be here needed a manual Triggers-page check —
**done 2026-08-12**, user shared the real screenshot. Both flagged
risks turned out to be non-issues (see "Recently fixed" below). Picks
below are what's left, lower urgency, good for a "next cleanup pass."

## Backend (`backend/*.js`)

1. 🧹 **`checkCCAlerts` and `sendWeeklyDebtNudge`, confirmed unscheduled
   2026-08-12** — no trigger calls either one (verified against the
   real Triggers page), so both are safe to delete next cleanup pass.
   `sendWeeklyDebtNudge` being unscheduled might mean you're not
   getting a weekly debt reminder at all if that was ever intended —
   💡 worth confirming whether you want that revived as a real feature
   before just deleting it.
2. 🧹 **An untested `"SPLIT"` debt type** in `getDebtsData()` counts as
   money owed to you, but nothing currently creates that type — worth
   confirming it's not leftover from an older version before trusting
   it in a money calculation.
3. 🔍 **A second AI fallback path references an undefined function** —
   `sms-parser-backend/Code.js`'s `verifyWithAI()` falls back to
   `callChatGPT()` if an `OPENAI_API_KEY` were ever set instead of
   Gemini's key, but `callChatGPT` is never defined anywhere in the
   file. Harmless today since Gemini's key is the one actually used —
   would only matter if that ever changed.

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

**Re-verified against the live file 2026-08-12** (this whole section was
stale — 4 of its 7 items were already fixed back on 2026-08-11 by the
Login/Home/Analysis/More redesign, but nobody removed them here, so they
were still being recommended as if open a full day later. Wasted the
user's time/tokens twice in one conversation before this pass — see
[[feedback_beginner_collaboration]] for the standing rule this created.)

1. 🧹 One stray emoji outside the agreed exceptions — confirmed still
   present: `<h3>✨ Updated</h3>` in the What's New popup (index.html,
   grep `✨ Updated` to find it).
2. 🧹 Possible style duplication instead of reusing shared classes
   (Savings manual-split row, `.fe-btn` vs `.type-btn`, repeated inline
   subheading styles) — **not re-verified this pass**, both class names
   still exist in the file but whether they're genuinely duplicated
   logic or already fine wasn't checked closely. Check before trusting.
3. 💡 CC Advisor's affordability breakdown could use color-coded
   visual hierarchy (safe vs. risky), like the CC usage bar already has
   — not re-verified this pass either, small enough to just look at the
   screen directly rather than grep for it.

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

- **2026-08-12**: Fixed two "matches part of a word" bugs in
  `category.js` (`findMerchantMatch`'s exact-match check, and the
  tea/coffee/chai Snacks rule) — both now use whole-word matching, same
  fix pattern as the earlier "lent" inside "excellent" bug. Verified
  with a new test, `backend/tests/categoryWordBoundary.test.js`.
  Deployed live (`@303`).
- **2026-08-12**: Triggers page checked (user shared a real screenshot,
  3 triggers exist: `checkDebtDueDates`, `processNewTransactions`,
  `sendDailyCashCheckin` — all legitimate). Confirmed both flagged
  risks are non-issues: `checkCCAlerts` (old CC due-date bug) and
  `sendSundaySavingsReminder` (stale Savings math) are both absent from
  the list, so neither runs automatically, so neither risk is real.

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
  verified with a new test before pushing. Deployed live (`@302`) and
  pushed to GitHub. See CLAUDE.md's 2026-08-12 "Backend cleanup pass"
  entry and [docs/features/savings-v2.md](features/savings-v2.md).
