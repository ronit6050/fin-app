# Push notifications: Upcoming Obligation Reminder + Debt Trajectory

**Status: both built and tested 2026-09-21, `clasp push`ed to the
editor draft only — NOT yet `clasp deploy`ed to the live app.** Needs
the user's go-ahead in the same conversation before `clasp deploy`
(per this project's standing rule), and a new manual trigger needs to
be added by hand for Feature 1 (see "Setup needed" below) — nothing
else in this project ever creates Apps Script triggers from code.

Two separate, unrelated push-notification ideas, both approved in a
design discussion before either was built. They share nothing in code
except both ultimately calling `sendMessage()` (`telegram.js`), which
(since Telegram is off, `TELEGRAM_ENABLED = false`) always also sends a
real push via `sendPushNotification()` (`push.js`).

---

## Feature 1 — Upcoming Fixed-Obligation Reminder

**File: `backend/obligationReminders.js`** (new file — this project's
convention is one file per non-trivial feature, see e.g.
`needWantSaving.js`, `settings.js`).

### The problem this solves

Rent/EMI/SIP payments (see `financial-events.md`) are only ever
recognized by this app AFTER the bank has already taken the money —
`suggestFinancialEvent` in `financialEvents.js` matches a transaction to
a known obligation by amount or note-text once it shows up in
`Transactions`. There was no "heads up, this is coming" — only "here's
what just happened."

### How it works

1. Every time a Rent/EMI/Investment payment is confirmed,
   `recordFinancialEvent()` (`financialEvents.js`) already appends one
   row to the `FinancialEvents` sheet (`[Type, Amount, Counterparty,
   Confirmed, Name]`) — this project already had a running history of
   "when did this obligation happen," it just wasn't being used that
   way before.
2. `getDistinctObligations_()` reads that sheet and groups it into one
   entry per real obligation: Rent has no `Name` (there's only ever
   one, see `financialEvents.js`'s own comments), so it's grouped by
   `Type` alone; EMI/Investment each get their own `{type, name}` pair
   since there can be more than one of those (e.g. "Home Loan EMI" vs
   "Nifty 50 SIP").
3. `findObligationHistory_(type, name, txnData)` finds every real
   `Transactions` row that belongs to that specific obligation — for a
   named one, by matching column S (`FinancialEventName`, 1-based
   column 19) exactly; for Rent (column S is never set for it — see
   `saveTransactionNote` in `PWA.js`), by matching column R
   (`FinancialEvent`, column 18) alone.
4. **Requires at least 2 real historical occurrences before attempting
   any prediction** — fewer than that, the obligation is skipped
   silently. One data point isn't a pattern.
5. `mostCommonDayOfMonth_()` finds the day-of-month the obligation lands
   on most often (a plain frequency count — a tie is broken by
   whichever day was seen first in the list, a simple, good-enough
   choice since a real tie is rare and either pick is only ever off by
   a day or two).
6. Each day the trigger runs (`checkUpcomingObligations()`): for every
   obligation with enough history, work out the next real calendar date
   that typical day falls on (handles month-end correctly — e.g. a
   typical day of 31 in a 30-day month gets clamped to the 30th; rolls
   into next month if this month's version of that day has already
   passed). If that date is exactly 3 days away, AND the obligation
   hasn't already happened this calendar month, send one push:

   ```
   🔔 Upcoming: Home Loan EMI

   Expected around the 5th (in 3 days) — usually ₹15,000, based on your last payments.
   Tap Home to check when it happens.
   ```

7. **Idempotent, so it can never double-send.** A Script Property keyed
   `OBLIGATION_REMINDED_<safe-label>_<YYYY-MM>` is set the moment a
   reminder is sent, and checked before sending again — so re-running
   the trigger by hand, or the daily trigger simply running every day
   for the rest of the month, only ever sends that obligation's
   reminder once per month. This follows the same "small state in
   Script Properties" pattern this project already uses for
   `PWA_PUSH_TOKEN` etc.

### Judgment calls made while building this (worth the user weighing in on)

- **Tie-break for the "most common day" calculation** picks whichever
  day was seen first in the history list, not (say) the most recent
  one. With real payment data this is very unlikely to matter (an exact
  tie across only a handful of months is rare), but it's a real,
  arbitrary choice.
- **"Already happened this calendar month" is checked against `today`'s
  month specifically** (not "the month the predicted date falls in") —
  matches the task's literal wording. This is almost always the same
  thing in practice, but there's a narrow edge case: if a reminder's
  candidate date rolls into NEXT month (because this month's version of
  the typical day already passed), the check still only looks at
  whether it happened in THIS month, not whether the specific upcoming
  occurrence already exists. This hasn't been exercised as a real bug —
  flagging it as an intentional simplification, not a proven gap.
- **The average of historical amounts** (not the most recent one, and
  not the exact target amount from `FinancialEvents`) is shown in the
  push as "usually ₹X" — chosen since a real EMI can vary slightly
  month to month (see `financial-events.md`'s own "Laptop EMI" example)
  and an average is a fairer "usually" figure than either extreme.
- **A stale "already reminded" Script Property is never cleaned up** —
  it just sits there harmlessly forever once a month has passed (same
  as several other Script Properties in this project). Not worth
  clearing, since a new key is only ever created once per obligation
  per month and the storage cost is trivial.

### Setup needed (you need to do this by hand)

Apps Script triggers are always added manually from the editor's
Triggers page in this project — never created by code. To turn this
on:

1. Open the Apps Script editor (script ID
   `126C_anjXSfWvl1ILAREWFi4CUd059Rer01fZlMgecPvSoPMXD3CEZ6w3`).
2. Triggers (clock icon) → **Add Trigger**.
3. Function to run: **`checkUpcomingObligations`**.
4. Event source: **Time-driven**.
5. Type of time-based trigger: **Day timer**.
6. Time of day: **suggested 8am–9am** (any time before your usual
   "check the app" habit works — earlier in the day gives the most
   notice ahead of a 3-days-away payment).

### Manual test helper

`testUpcomingObligations()` — run by hand from the Apps Script editor.
Logs (via `Logger.log` → View → Logs) exactly what the real trigger
would decide right now, for every obligation, **without** sending any
real push and **without** writing the "already reminded" Script
Property — so running it to check things out can never accidentally
block a real reminder from firing later.

---

## Feature 2 — Debt Payoff / Collection Trajectory

**Files: `backend/DebtAdvisor.js`** (the trajectory math + push, added
alongside the existing Debt functions it depends on) **and
`backend/PWA.js`** (wiring into the two existing actions that change a
debt's balance).

### The problem this solves

The Debts screen only ever showed a static "you owe ₹10,000" —
mirrored for both directions (`BORROWED` = what you owe, `LENT` = what's
owed to you). No sense of real progress, or whether you're actually on
track to clear it.

### A real gap found while building this: there was no payment history at all

Before this feature, the `Debts` sheet only ever stored the CURRENT
outstanding amount per debt — `applyDebtPayment` (`PWA.js`) reduces it
in place on a partial payment, `settleDebtRow` flips it to `Settled` on
a full one. Neither ever recorded a log of individual past payments —
so there was nothing to compute a real "pace" (₹ actually repaid per
month) from.

**Fixed by adding a new sheet, `DebtPayments`** (auto-created on first
use, same self-creating pattern as `FinancialEvents`/`Goals`/etc.):

| Date | Row | Person | Type | AmountPaid |
|---|---|---|---|---|

- `Date` — when the payment was recorded (not necessarily the same as
  the transaction date, if this was a manual "Record a payment" click).
- `Row` — the `Debts` sheet row this payment was against (traceability
  only — the pace math itself only cares about Date/Type/AmountPaid).
- `Person`, `Type` (`BORROWED`/`LENT`) — copied straight from the
  `Debts` row at the moment of payment.
- `AmountPaid` — the real ₹ amount that moved. For a partial payment,
  exactly what was paid. For a full settlement, whatever was still
  outstanding right before it flipped to `Settled` (a full settlement
  IS effectively "the remaining amount just got paid off in one go").

`logDebtPayment_(row, person, type, amountPaid)` (`DebtAdvisor.js`)
writes one row here — called from both `applyDebtPayment` and
`settleDebtRow` right after the real write succeeds. This also means
every existing repayment path that already goes through
`applyDebtPayment` — including the Financial Events auto-link's own
repayment matching (`handleDebtAutoLink` in `financialEvents.js`) — now
gets logged automatically too, with zero extra wiring.

### The trajectory math — `getDebtTrajectory(direction)`

One shared function, called with `"BORROWED"` or `"LENT"` — mirrors the
same math both ways rather than duplicating it:

- **`outstanding`** — sum of every still-`Pending` debt's `Amount` for
  that direction (a legacy `SPLIT` type row, if one exists, is grouped
  under `LENT` — matches how `getDebtsData`'s own `totalTheyOwe` already
  groups it, so this number always agrees with what the Debts screen
  itself shows).
- **`monthlyPace`** — real ₹ actually paid/collected in the **last 90
  days only** (read from `DebtPayments`), divided by 3 to get an
  average ₹/month. Deliberately a recent window, not an all-time
  average — a pace from a year ago says nothing about whether you're
  keeping it up now.
- **`projectedDate`** — `today + (outstanding ÷ monthlyPace)` months,
  converted to days using an average month length (30.44 days). This is
  a rough "by ~Month Year" estimate on purpose, not a precise
  day-level countdown — the push wording always says "~" for this
  reason.
- **Honest fallbacks, never a fake date:**
  - `outstanding <= 0` → `hasProjection: false`, message is
    `"You're debt-free!"` (BORROWED) or `"Fully collected — nothing
    left owed to you."` (LENT).
  - `monthlyPace <= 0` (no real payments in the last 90 days) →
    `hasProjection: false`, message is `"no repayments/collections in
    the last 3 months, can't project a date yet"`.

### When it pushes — only on a real change, never a schedule

Per the user's explicit choice, this is NOT a new trigger. It's a
recompute-and-push step added directly inside the two existing actions
that change a debt's balance:

- **`applyDebtPayment(row, amount)`** (`PWA.js`) — after reducing (or
  fully settling) the row as before, reads that row's own `Person`/
  `Type`, logs the payment, and calls `pushDebtPaymentUpdate(debtType,
  person, paid)`.
- **`settleDebtRow(row)`** (`PWA.js`) — same, using whatever was still
  in the `Amount` column right before the row flips to `Settled` as the
  "amount paid."

**Only the direction that actually just changed gets pushed** — a
`BORROWED` payment's `debtType` is read straight from the real Debts
row, so it can never accidentally trigger the `LENT` ("owed to you")
trajectory or vice versa; there's no guessing involved. Combined across
ALL debts of that direction (per the user's explicit choice — one
combined number, not a per-person breakdown):

```
✅ ₹2,000 repaid to Raj

₹10,000 left across 2 debts — on pace to be debt-free by ~March 2027.
```

```
✅ ₹1,000 collected from Priya

₹2,000 still owed to you across 1 debt — on pace to be fully collected by ~March 2027.
```

If there's no recent activity to project from, the second line becomes
the honest fallback message instead (e.g. "...— no repayments in the
last 3 months, can't project a date yet.").

### Judgment calls made while building this (worth the user weighing in on)

- **A debt row with a blank/unrecognized `Type`** (shouldn't happen in
  real use — `addDebtEntryFromApp` only ever writes `LENT`/`BORROWED`)
  is handled defensively: the payment/settlement itself still saves
  normally, it's just never logged to `DebtPayments` or pushed, since
  there's no clear direction to attribute it to.
- **`SPLIT`-type debts** (a legacy value — nothing in the current app
  creates one) are counted into `LENT`'s outstanding total for
  consistency with `getDebtsData`, but a payment against a `SPLIT` row
  specifically still won't push (since `applyDebtPayment`/
  `settleDebtRow` only log/push when the row's own `Type` is exactly
  `"BORROWED"` or `"LENT"`). This is an existing edge case, not
  something this feature needed to newly decide — flagged for
  completeness.
- **The 30.44-day "average month" conversion** is a deliberate
  simplification for a "by ~Month Year" estimate — not trying to be
  more precise than the underlying pace number actually supports.

### Manual verification

No dedicated manual test helper was added for this one (unlike
Feature 1) — `getDebtTrajectory("BORROWED")` / `getDebtTrajectory("LENT")`
can be run directly from the Apps Script editor's function picker at
any time to see the real current numbers, and every real code path
(`applyDebtPayment`, `settleDebtRow`) is already exercised end-to-end by
`backend/tests/debtTrajectory.test.js`.

---

## Tests

- `backend/tests/upcomingObligationReminder.test.js` (19 checks) — the
  day-of-month mode calculation on real-shaped/messy history, the
  "not enough history yet" skip, the "already happened this month, no
  need to remind" skip, Rent and a named EMI never cross-matching each
  other, the real end-to-end trigger function being genuinely
  idempotent (two runs same day → exactly one push), and the manual
  dry-run helper never sending a push or writing state.
- `backend/tests/debtTrajectory.test.js` (30 checks) — the pace/
  projection math for both directions, the honest "no recent activity"
  fallback, zero-outstanding reporting as done, a BORROWED payment
  pushing only the BORROWED trajectory (never LENT) and vice versa, a
  full settlement logging + pushing correctly, every real payment
  actually landing in the new `DebtPayments` log, and a
  blank/unrecognized debt Type never crashing either action.

Full existing suite (`backend/tests/*.test.js`, 21 files total
including these two new ones) passes with zero failures.
