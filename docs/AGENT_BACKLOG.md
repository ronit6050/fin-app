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
3. 🧹 **Delete the old dead Savings code** (Backend #4) — confirmed
   safe to remove, just hasn't been done yet.

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
4. 🧹 **Old 4-pot Savings code is still present but unused** — full
   detail in `CLAUDE.md`'s Savings section and
   [docs/features/savings-v2.md](features/savings-v2.md). Confirmed
   low-risk dead code, safe to delete once double-checked.
5. 🔍 **A second AI fallback path references an undefined function** —
   `sms-parser-backend/Code.js`'s `verifyWithAI()` falls back to
   `callChatGPT()` if an `OPENAI_API_KEY` were ever set instead of
   Gemini's key, but `callChatGPT` is never defined anywhere in the
   file. Harmless today since Gemini's key is the one actually used —
   would only matter if that ever changed.
6. 💡 Confirm the new Savings screen has a way to fix a typo in a past
   entry, the way History/Cash/Investments already do (Savings was
   deliberately left out of that pass, see CLAUDE.md's "Full-app gap
   review" note).

## SMS Parser (`sms-parser-backend/Code.js`)

Full detail on all of these is in `CLAUDE.md`'s "SMS ingestion" →
"Known open items" block — this is the short version. None are
confirmed bugs; each needs a real example to prove one way or another.

1. 🔍 A real SMS using only the word "withdrawn" or "deposited" (not
   also "debited"/"credited"/etc.) would get logged with a blank
   debit/credit label.
2. 🔍 Any message containing "emi" is filtered out before it's even
   checked — could be blocking real EMI payment alerts, not just spam.
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

## Recently fixed (for reference — full detail stays in CLAUDE.md)

- **2026-08-11**: `autoLogSaving` was writing auto-detected savings
  into old, now-unrecognized Savings bucket names — fixed to write
  into Free Savings instead, deployed live. See
  [docs/features/savings-v2.md](features/savings-v2.md) and
  [docs/features/financial-events.md](features/financial-events.md).
