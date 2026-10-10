# SMS junk filter + echo de-duplication (2026-10-10)

File: `sms-parser-backend/Code.js` (the separate SMS-parser Apps Script
project). Test: `sms-parser-backend/tests/junkAndEchoFilter2026-10-10.test.js`.

## Why

Goal: "the app should only ask me about things only I know." Junk and
mis-read messages were reaching the Pending list. Everything below was
found in the user's real message log (the `Logs` tab, ~2,265 distinct
messages) and real `Transactions` rows.

## What changed, in plain English

1. **Wrong merchant "block".** HDFC card alerts end with a footer ("Not You?
   To Block+Reissue Call ... SMS BLOCK CC ..."). The old code grabbed the
   first "to ..." it saw, which was in that footer, so the merchant was
   saved as "block". Now:
   - Three specific card-alert shapes read the merchant straight from the
     right place: `... At MERCHANT On <yyyy-mm-dd>` (card "Spent" and
     "without OTP/PIN" texts) and `... For MERCHANT Txn Amt` (AutoPay
     success).
   - Everything else uses the original extraction, unchanged. If it ever
     comes back as bank boilerplate (block / reissue / not you) it retries
     with the footer cut off, and if that is still boilerplate, saves no
     merchant rather than a wrong one.
   - Left alone on purpose: `Txn Rs.X On HDFC Bank Card N At <upi-handle> by
     UPI` still gives a blank merchant (as before). Making it "better"
     would turn it into garbage like "q" from `Q123@ybl`.
2. **Future-dated notices.** "E-Mandate! Rs.3000 will be deducted on
   10/09/26" is only an advance notice; the real debit arrives later as
   "UPI Mandate: Sent Rs.3000 ...". Notices are now ignored. Phrases:
   will be / will get debited, deducted, charged (also auto-debited),
   scheduled/due to be debited/deducted/charged. The original three
   phrases always block. The new "deducted"/"auto" family has a safety
   guard: with the future phrase cut out, if the REST of the message still
   has a past-tense money word (debited, deducted, charged, spent,
   withdrawn, paid, credited, deposited, sent) it already happened and is
   NOT treated as a notice (e.g. "Rs.5000 debited ... GST will be deducted
   at month end" still saves).
3. **Service / security / receipt messages (no money moved)** are ignored:
   login alert / "login to your NetBanking"; biometric ... enabled/disabled;
   "request to link ... UPI"; and a biller's "we have received a payment of
   ... payment receipt" receipt. The first three only fire when the message
   has NO rupee amount at all, so a real transaction cannot be caught just
   for mentioning "login". The receipt rule needs both the biller phrasing
   and "payment receipt", and is skipped if the message says the user's own
   account was credited/debited.
4. **Scam text.** A third-party link shortener (bit.ly, tinyurl.com,
   goo.gl, rb.gy, is.gd, cutt.ly, t.co, ow.ly, shorturl.at, tiny.cc,
   rebrand.ly, buff.ly followed by "/") means IGNORE, even with money words, but ONLY from a sender that is not a recognised
   bank/wallet. From a known bank sender it is never silently dropped: a
   money-wording message with a shortener becomes UNCERTAIN (saved, flagged
   NEEDS REVIEW). Reasoning: banks use their own domains (1.hdfc.bank.in, hdfcbk.io), so
   a shortener plus "Credited: Rs..." is the classic phishing shape. Own
   bank domains are unaffected. Side effect: promo texts with bit.ly links
   (e.g. fast-food ads) also stop reaching Pending.
5. **Duplicate echo of one card charge.** The bank sends two texts for one
   DemoStream charge (AutoPay success + "without OTP/PIN" card text), about a
   second apart, neither with a reference number. New tier 4 in
   `isDuplicate()` treats the second as a duplicate only when ALL hold:
   both are debits for the same amount; neither has any reference; both
   texts name the same card (last 4 digits); same date and within 2
   minutes; exactly one is an AutoPay-success text and the other is a "without
   OTP/PIN" text (two of the same kind, or "Spent" plus "without OTP", are
   separate purchases and both save); and,
   if both name a merchant, the names plausibly match (one contains the
   other, or same first word of 4+ letters). Any doubt (unreadable time,
   missing card digits, etc.) means "keep it". Reasoning: a wrongly dropped
   real purchase is invisible; a wrongly kept duplicate is one tap to
   remove.

Every ignore from rules 2-4 is logged to the `Logs` sheet as
`NOT TRANSACTION (<reason>)` (old plain ignores still say
`NOT TRANSACTION`). Echo skips log as `DUPLICATE IGNORED (echo of the same
card charge ...)`.

## Safety invariants (unchanged)

- Confident TRANSACTION behaviour for real transaction SMS is unchanged.
- "Known sender + unrecognized wording -> UNCERTAIN" is unchanged.
- A learned spam pattern still only downgrades UNCERTAIN, never TRANSACTION.

## Real-data replay (how this was verified)

The old code (`git show HEAD:...`) and the new code were run over every
distinct message in the Logs tab plus every RawSMS in Transactions (2,265
distinct). Only 26 outcomes changed, all intended: 7 future-dated mandate
notices (were saved as debits), 7 login / biometric / link-request notices,
3 biller receipts, 1 scam text, 8 promo texts with bit.ly links. Nothing
that was ignored became saved. 25 messages changed their merchant, all of
them the three card-alert shapes; amount, type, mode, bank and reference
never changed for any message. Replaying the whole real Transactions sheet
in order through the new duplicate check flagged exactly one row: the
real DemoStream echo pair.

## Not done / follow-ups

- The card-alert `Mode` is untouched: AutoPay texts ("Via: HDFC Bank CC
  5555") still get mode "other", and "Card x5555" (with an x) also does not
  match the mode regex. Card spend arriving this way is invisible to CC
  Advisor. A separate, small fix, not done here.
- Remaining junk seen but out of scope: IPIN/password-reset notices
  ("Your IPIN reset is complete ... Not you?") still arrive as UNCERTAIN.
