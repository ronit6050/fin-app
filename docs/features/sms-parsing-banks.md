# Reading SMS from many banks (2026-10-14)

**What happened:** Vaidehi (Bank of Baroda) got two wrong rows: a Rs 1 CREDIT was saved as Rs 2,974.93 (her account BALANCE: shown as "income"
and inflating "savings"), and a Rs 1 DEBIT was saved with NO direction ("Dr. from A/c ... and Cr. to ..."), so it never counted in "total spent".

**Root causes (both general, not Bank of Baroda specific):**
1. `ruleParser` looked for "Rs" first and "INR" second WHEREVER they were; the BOB credit says `credited with INR 1.00 ... AvlBal: Rs2974.93`, so
   the balance won. Any bank that mixes spellings, or puts the balance first, could do the same.
2. Direction came only from words (debited/credited/received...). "Dr." / "Cr." were not understood, and a message with a known sender but no
   recognised wording was only "needs review", with no way for the person to say spent/received.

**What changed (all in `sms-parser-backend/Code.js`, copied word for word into `backend/smsPipelineCore.js`):**
- `findTransactionAmount`: every amount is looked at in order; one that follows/precedes balance words (avl, available, bal, balance, limit, outstanding,
  o/s, closing, due ...) is skipped. If only balances are present NO amount is guessed.
- Direction also from `Dr.` / `Cr.` (only when the old words decided nothing; if both appear the one that comes first wins); `Dr. from A/c` and
  `Cr. to A/c` count as money moving (narrow, so a doctor's "Dr." in a promotion does not).
- More reference wordings ("UPI Ref No", "Reference number", "Refno", "RRN", "UTR No"); tried only when the old four patterns found nothing.
- A `name@bank` address means UPI (an e-mail with ".com" does not); "your A/c" is never a merchant; "via" is dropped from a merchant.
- ONE central bank list `BANK_SENDER_TOKENS` ([text in the sender name, bank name]) used for both "known sender?" and "which bank?". Added Bank of
  Baroda, PNB, Canara, Union, IDBI, IndusInd, IDFC, Bandhan, RBL, UCO, Bank of India, KVB. The original ten are unchanged and first.
- **Teaching a bank without code:** More > Access > Bank SMS library lists senders whose bank is unknown; type the bank's name and tap Teach. Stored in
  Firestore `_system/bankSenders` (owner-only, closed to phones); the new SMS path (smsIn) reads it (cached 10 min) via `SmsPipeline.setExtraSenders`.
  The old SMS-reader project does not read it (it only has the built-in list).
- **When the app still cannot tell:** the Pending/History card shows a dashed box "The app could not fully read this message": choose Spent/Received
  (and type the amount if none was found). `saveNote` takes `direction` ("debit"/"credit"), applied ONLY to a blank Type and never flipping an existing one.

**Proof:** on all 2,185 real messages from the phone: 0 classification changes; field changes were 8 amounts (Airtel balance notices no longer invent an
amount), 25 junk merchants ("your UPI" ...) now blank, 7 messages gained a reference (ICICI salary, SBI, Jupiter), 3 payment modes became UPI (genuine
UPI mandates). `backend/tests/smsBanks.test.js` (41 checks: 12 bank wordings x balance traps, Dr./Cr., references, UPI vs e-mail, teaching, direction).
Replay of 2,685 real events old-vs-new path still identical.

**To repair rows already saved wrongly:** the person edits them in the app (History: amount box; the new box for a blank direction). Nothing was changed in anyone's data by hand.
**Deploy:** main backend (`clasp deploy`) + SMS reader (`clasp deploy` of sms-parser-backend, optional, same fixes for the old path) + `git push` (web app).

## After the independent review (same day)
- A number in a **mandate / UMN / auto-pay** message is never used as the transaction reference (it is the mandate's and repeats every month).
- Tier 1 of the duplicate check (same reference) now also requires the **same amount** when both amounts are known: a monthly charge under one number is never dropped as a "duplicate".
- Balance words must start a word ("overdue Rs 100" is a real amount); "Rs 100 Balance Enquiry fee" is a charge, not a balance; "Dr. Achar" is not "Dr. ... A/c".
- A stray invisible character (a backspace written instead of `\b`) was found in one rule while fixing this and corrected.
