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
  safeToPut: number|null,                         // can be NEGATIVE only because of swipes already made this cycle; null = not enough history/income
  safeReason: "ok"|"budget_full"|"over_by_swipes"|"unknown",
  cardRoom: number|null,                          // money left each month for ALL card use (rounded; can be <= 0); null when unknown
  monthlyIncome: number|null,                     // the usual income used (rounded); null when none found
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

### Safe to put (the formula) - rewritten 2026-10-18

The first version compared swipes to today's bank balance. That was wrong: swipes made now are billed on the 18th and paid on the 9th of next month, from the
NEXT salary, so this month-end balance says nothing about them (and a normal month-end gave an alarming negative number with zero swipes, and a person with no
history could get a number from a typed balance alone). It is now a **monthly budget** built only from that person's own history. No bank balance, no staleness.

```
monthlyIncome = the SECOND-largest Income-tagged credit of the last 70 days when there are two or more (a one-off bonus/refund can never become
                "salary"), else the only one. A salary paid in two parts is understated (the safe direction). Same figure the bill plan uses as "salary".
committed     = each Rent/EMI/SIP that has enough history (average amount, each name once)
                + Settings monthly savings goal + Settings monthly investment goal
nonCardLiving = average monthly day-to-day spend NOT on the card, over the last up-to-3 CLOSED calendar months that have any rows
                (this month is not included). The person's FIRST data month is skipped unless their first row is on or before day 7
                of it (a part-month would look cheap and make the safe amount too high). Cash-sheet debits count as day-to-day spend (the Cash
                tab; lending words excluded). Left out, like CC Advisor / Analysis: card swipes, credit card bill payments (by wording or by
                equalling a card bill), wallet top-ups, loans, rows already marked Rent/EMI/SIP, and a split's friend share.
                No usable closed month of real data -> unknown. (The Settings "monthly expenses" default of 30,000 is a made-up number and is NOT used.)
cardRoom      = monthlyIncome - committed - nonCardLiving          (what is left each month for ALL card use: electricity AND wants)
safeToPut     = round( min( max(cardRoom, 0), 30% of the limit ) - cardSwipesThisCycle )
```

Needs: a usual income AND at least 14 days of that person's own transactions AND at least one usable closed month; otherwise `safeToPut = null`, `safeReason = "unknown"`, tone `unknown`
(a brand-new friend sees the quiet hint, never a number).

`safeReason`: `ok` (room, not over) / `budget_full` (cardRoom <= 0: the person's usual month leaves nothing for the card, whatever they swipe; with zero swipes
`safeToPut` is 0, not a negative number) / `over_by_swipes` (swipes this cycle pushed it below zero) / `unknown`.

Worked example: income 60,000. Rent 15,000 + savings goal 5,000 + investment goal 3,000 = 23,000 committed. Ordinary UPI/cash living averaged 20,000 over
Jul-Sep. cardRoom = 60,000 - 23,000 - 20,000 = **17,000**. Limit 50,000, so the 30% cap is 15,000; the smaller of the two is 15,000. Swiped so far this cycle 6,000
-> safe to put = **9,000**. If living were 40,000, cardRoom = -3,000 -> `budget_full`, safe amount 0 with no swipes. If living were 32,000, cardRoom = 5,000 and
the same 6,000 of swipes gives -1,000 -> `over_by_swipes`.

Why it does not count a rupee twice: card swipes are subtracted once (as `cardSwipesThisCycle`), and the non-card living leaves card rows out, so a swipe is never
in both. Card bill payments are left out of living (the swipes behind them were already counted as swipes). Rent/EMI/SIP are in `committed` only.

### Tone

* `over`: `safeToPut < 0` (always from swipes) or `wantsOver > 0`.
* `unknown`: no `safeToPut` (no usual income or under 14 days of history) and not yet 30% used.
* `watch`: `safeReason` is `budget_full` with nothing past zero, `safeToPut` under 20% of the limit, or `utilisationWatch` (30% of the limit already used, which also makes it `watch` when the balance is unknown).
* `ok`: otherwise.

### The closed bill (`bill`)

The most recently closed bill (the one due next); `null` if it had no card spend. `planLines` (empty once paid): the usual salary as `+` if it is expected on or before the due date (biggest Income credit of the last 70 days), each Rent/EMI/SIP still to come before the due date as `-`, then the card bill as `-`. `leftUntilSalary` = estimated balance minus the bills before the next salary (null if the balance or salary day is unknown). The bill is "paid" using exactly the detection CC Advisor already used (`getOutstandingCCPaidTotal_`, moved out of `getCCAdvisorData` so both share one copy).

### Paid-in-full streak

Counts the most recent closed bills paid in full, going back at most 12. The newest bill counts if paid; if it is still open (not yet due) it neither counts nor breaks the streak; if overdue the streak is 0. Older bills count as paid when payments between that bill's close and the next close (non-card debits worded as a credit card bill, or equal to one card's total or the combined total) add up to the bill. Bills with no card spend are skipped. `null` if there is no closed bill to look at. The app does NOT know interest amounts, so nothing about interest is claimed.

## The notification line

Added in `processNewTransactionsCore_` (`transactions.js`). Only for a **card debit of Rs 200 or more** that is not a fixed bill (a recurring merchant, or a row already marked Rent/EMI/SIP) and not a wallet top-up, and only if the safe amount is known:

* room left (`safeReason = "ok"`): `Safe left on card: ₹8,200.`
* past it (**only** when `safeReason = "over_by_swipes"`): `That is ₹400 past your safe amount; it comes out of next salary.` (only the part of THIS swipe that is past the safe amount)
* `budget_full` or unknown: no line at all.

The coach is built lazily, once per timer run, only when such a swipe arrives, reusing the Transactions read the timer already does. If anything fails the notification goes out exactly as before. Note: the new swipe is already in the sheet when the coach is built, so the number already includes it; if several card swipes arrive in the same 5-minute run they all show the same figure.

## The bill reminder

`cardBillReminderRun_` runs as a new daily job on the new server's tick (`fnTimer.js`, key `cardbill`, about 09:15 India time), so no trigger needs adding by hand. For each person with the full app and a phone: if the closed card bill is unpaid and due within 3 days (including today), one push: title "Card bill due in 2 days" (or "tomorrow" / "is due today"), body `Card bill ₹8,500 is due on 9 Nov. Pay it in full.` Once per bill: the due date already reminded about is remembered per person in the shared `_system/reminders` document (field `cb_<person>_due`). Nothing in quiet hours (10pm to 8am). The person can switch it off with the new Settings value `cardReminder`. The owner can also run `checkCardBillReminder()` by hand in Apps Script; running it again never double-sends.

## Settings

* `cardWantsLimit` (number, 0 = not set, whole rupees, 0 to 10,000,000). Stored in `SETTING_CARD_WANTS_LIMIT`.
* `cardReminder` (true/false, default true). Stored in `SETTING_CARD_REMINDER_OFF` ("1" = off).
Both come back from `getSettings` and are saved by `updateSettings` (a partial save never touches them).

## Known limits

* Needs a usual income and 14 days of history for the safe amount; otherwise the coach still shows the split and the 30% watch. The bank balance checkpoint is no longer used for the number (it still feeds the bill plan's "left until salary").
* An Income credit is the only way income is known; a person paid in a way not tagged Income gets "unknown".
* Older bills' "paid" detection (for the streak) is by amount/wording, a little looser than the latest bill's.
* Two cards share one combined limit and one coach (as CC Advisor does).
* `functions/backend/` is a generated copy; it is refreshed by the deploy step, nothing was edited by hand there.
