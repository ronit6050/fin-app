# Card Coach (backend built 2026-10-18)

Plain-English idea: a card swipe for a "want" feels free, but it is next month's money spent early. Card Coach shows the real cost at the moment
of the decision, calmly, with ONE motivating number: **how much is safe to put on the card**. It never shames. It adds no new notification per swipe.

Code: `backend/cardCoach.js`. Tests: `backend/tests/cardCoach.test.js` (about 100 checks). The screen (index.html) is built separately by the UI agent against the shape below.

## The three pieces

1. **The `coach` block.** `getCCAdvisorData` now returns `coach` (and so does the Home copy, `full.cc.coach`). It is `null` if anything goes wrong; the rest of the CC Advisor result is exactly as before (a test proves it is byte-identical).
2. **One extra line on the existing new-transaction notification**, only for card swipes. No new notification.
3. **A bill reminder** 3 days before the card bill is due.

## The cycles (reused, not reinvented)

The statement closes on the 18th; the bill is due on the 9th of the NEXT month. A swipe on the 18th belongs to the bill that closes that day; a swipe on the
19th starts the next cycle. December to January works (a 19 Dec to 18 Jan cycle is due 9 Feb). On the 18th itself the "running" cycle has just begun and has
nothing in it yet (same rule CC Advisor already used).

## The shape (`coach`)

```
{ limit, limitUsedPct (0-100), cycleSpent,
  split: { fixed, need, want, unsorted },        // amounts of THIS cycle's card swipes; they add up to cycleSpent
  fixedMerchants: [names],                        // fixed merchants that have a swipe in this cycle (up to 6, biggest first)
  wantsLimit: number|null,                        // the person's own setting (0/unset -> null)
  suggestedWantsLimit: number,
  wantsOver: number|null,                         // max(0, want - wantsLimit); null when no limit is set
  safeToPut: number|null,                         // can be NEGATIVE = already past the safe amount; null = money picture unknown
  safeUntil: "yyyy-mm-dd",                        // due date of the bill that this cycle's swipes land in
  tone: "ok"|"watch"|"over"|"unknown",
  utilisationWatch: bool,                         // cycle spend >= 30% of the limit
  bill: null | { amount, dueDate, daysUntilDue, isPaid, isOverdue,
                 planLines: [{ label, amount, sign: 1|-1 }], leftUntilSalary: number|null },
  paidInFullStreak: number|null }
```

### Splitting swipes (fixed / need / want / unsorted)

* Only card swipes: a debit whose Mode starts with "card" and amount > 0 (the same rows CC Advisor counts).
* **Fixed** = the merchant (name lower-cased, digits removed) has swipes in at least 2 of the last 3 closed bills with the bill totals within 25% of each other (Netflix 649 / 650), OR the app has already marked a swipe from it as a Rent/EMI/SIP event (Financial Event column).
* **The person wins:** a swipe the person tagged **Want** is always `want`, even from a recurring merchant.
* Then: tag Need / Saving / Investment -> `need` (Saving and Investment are not "wants", so they sit with need); no tag -> `unsorted`.

### Wants limit

* `wantsLimit` = Settings value `cardWantsLimit` (0 = not set -> null).
* `suggestedWantsLimit` = the average of the "want" card spend of the last up-to-3 CLOSED bills (only bills that had card spend), capped at 20% of the limit, rounded to the nearest 500, at least 1,000. No history: 10% of the limit (same rounding and minimum). (Past bills use today's list of fixed merchants; good enough for a suggestion.)

### Safe to put (the formula)

Needs a balance checkpoint (the "what is in your bank" number Home already asks for) and uses the Home run-out maths (`computeRunway_`). If there is no checkpoint, `safeToPut` is `null`.

```
free   = estimated bank balance
         - bills before the next salary (runway.billsAhead: Rent/EMI/SIP not yet paid, plus the closed card bill if it is due before salary)
         - the closed card bill, if unpaid AND the runway did not already count it   (it reduces the number exactly once)
         - usual daily spend x days to next salary (30 days if the salary day is unknown)
         - card swipes already made this cycle                                     (they reduce it exactly once)
cap    = 30% of the limit - card swipes already made this cycle                    (never suggest going past 30% utilisation)
safeToPut = round( min(free, cap) )         // negative = already over
```

Worked example: balance 60,000; Rent 15,000 due before salary; closed card bill 8,000 due after salary; 700 a day for 10 days = 7,000; swipes so far 6,000.
free = 60,000 - 15,000 - 8,000 - 7,000 - 6,000 = 24,000. cap = 15,000 - 6,000 = 9,000 (limit 50,000). Safe to put = **9,000**. With only 40,000 in the bank,
free = 4,000, so it is 4,000. With 30,000, free = -6,000: already past the safe amount.

Why it does not count a rupee twice: card swipes never leave the bank until the bill is paid, so the balance does not contain them; they are subtracted once (as "swipes already made"). The closed bill is either in the runway's bills or subtracted separately, never both. Daily spend is a forecast for the days ahead, not the swipes already made.

### Tone

* `over`: `safeToPut < 0` or `wantsOver > 0`.
* `unknown`: no `safeToPut` (no balance checkpoint) and not yet 30% used.
* `watch`: `safeToPut` under 20% of the limit, or `utilisationWatch` (30% of the limit already used, which also makes it `watch` when the balance is unknown).
* `ok`: otherwise.

### The closed bill (`bill`)

The most recently closed bill (the one due next); `null` if it had no card spend. `planLines` (empty once paid): the usual salary as `+` if it is expected on or before the due date (biggest Income credit of the last 70 days), each Rent/EMI/SIP still to come before the due date as `-`, then the card bill as `-`. `leftUntilSalary` = estimated balance minus the bills before the next salary (null if the balance or salary day is unknown). The bill is "paid" using exactly the detection CC Advisor already used (`getOutstandingCCPaidTotal_`, moved out of `getCCAdvisorData` so both share one copy).

### Paid-in-full streak

Counts the most recent closed bills paid in full, going back at most 12. The newest bill counts if paid; if it is still open (not yet due) it neither counts nor breaks the streak; if overdue the streak is 0. Older bills count as paid when payments between that bill's close and the next close (non-card debits worded as a credit card bill, or equal to one card's total or the combined total) add up to the bill. Bills with no card spend are skipped. `null` if there is no closed bill to look at. The app does NOT know interest amounts, so nothing about interest is claimed.

## The notification line

Added in `processNewTransactionsCore_` (`transactions.js`). Only for a **card debit of Rs 200 or more** that is not a fixed bill (a recurring merchant, or a row already marked Rent/EMI/SIP) and not a wallet top-up, and only if the safe amount is known:

* room left (`safeToPut >= 0`): `Safe left on card: ₹8,200.`
* past it: `That is ₹400 past your safe amount; it comes out of next salary.` (only the part of THIS swipe that is past the safe amount)

The coach is built lazily, once per timer run, only when such a swipe arrives, reusing the Transactions read the timer already does. If anything fails the notification goes out exactly as before. Note: the new swipe is already in the sheet when the coach is built, so the number already includes it; if several card swipes arrive in the same 5-minute run they all show the same figure.

## The bill reminder

`cardBillReminderRun_` runs as a new daily job on the new server's tick (`fnTimer.js`, key `cardbill`, about 09:15 India time), so no trigger needs adding by hand. For each person with the full app and a phone: if the closed card bill is unpaid and due within 3 days (including today), one push: title "Card bill due in 2 days" (or "tomorrow" / "is due today"), body `Card bill ₹8,500 is due on 9 Nov. Pay it in full.` Once per bill: the due date already reminded about is remembered per person in the shared `_system/reminders` document (field `cb_<person>_due`). Nothing in quiet hours (10pm to 8am). The person can switch it off with the new Settings value `cardReminder`. The owner can also run `checkCardBillReminder()` by hand in Apps Script; running it again never double-sends.

## Settings

* `cardWantsLimit` (number, 0 = not set, whole rupees, 0 to 10,000,000). Stored in `SETTING_CARD_WANTS_LIMIT`.
* `cardReminder` (true/false, default true). Stored in `SETTING_CARD_REMINDER_OFF` ("1" = off).
Both come back from `getSettings` and are saved by `updateSettings` (a partial save never touches them).

## Known limits

* Needs the balance checkpoint for the safe amount; with none, the coach still shows the split and the 30% watch.
* Older bills' "paid" detection (for the streak) is by amount/wording, a little looser than the latest bill's.
* Two cards share one combined limit and one coach (as CC Advisor does).
* `functions/backend/` is a generated copy; it is refreshed by the deploy step, nothing was edited by hand there.
