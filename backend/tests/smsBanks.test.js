// backend/tests/smsBanks.test.js
//
// Plain-English what this checks (all messages are invented but follow real banks' wording):
//  1. The amount is NEVER the account balance, whichever bank, whichever order, Rs or INR (a real bug: a Bank of Baroda credit of Rs 1 was
//     saved as the Rs 2,974 balance, which showed up as income/savings for Vaidehi).
//  2. "Dr." / "Cr." wording is understood (a debit saved with no direction was invisible in "total spent").
//  3. Reference numbers in more wordings, a UPI address means UPI (an e-mail does not), "your A/c" is never a merchant.
//  4. A bank can be TAUGHT from the Access screen with no code change, and forgotten again.
//  5. When the app cannot tell spent from received, the person's answer on the card fills the blank direction (and never overwrites one).
// Run with: node backend/tests/smsBanks.test.js

const crypto = require("crypto");
const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
sb.CacheService = { getScriptCache: function(){ return { get: function(){ return null; }, put: function(){}, remove: function(){} }; } };
sb.sendPushNotification = function(){};
const P = sb.SmsPipeline;
const parse = function(sender, sms){ return P.ruleParser(sms, sender); };

console.log("\n--- 1. The amount is never the balance ---");
{
  const cases = [
    ["HDFCBK",     "Sent Rs.40.00 From HDFC Bank A/C x1234 To CAFE On 13/10/26 Ref 665226905838 Not You? Call 18002586161", "40.00"],
    ["ICICIB",     "ICICI Bank Acct XX123 debited for Rs 500.00 on 05-Sep-26; Avl Bal Rs 12,000.50", "500.00"],
    ["ICICIB",     "Avl Bal Rs.1200.40. Rs.500 debited from your ICICI Bank A/c on 05-Sep-26", "500"],
    ["JX-BOBSMS-S","Dear BOB UPI User: Your account is credited with INR 1.00 on 14-10-2026 12:30:12 PM by UPI Ref No 628653900099; AvlBal: Rs2974.93 - BOB", "1.00"],
    ["JX-BOBSMS-S","Dear BOB UPI User: Your account is debited with INR 20.00 on 14-10-2026 by UPI Ref No 628653900098; AvlBal: INR 2954.93 - BOB", "20.00"],
    ["AX-AXISBK",  "Rs 500 was spent on your Axis Bank Credit Card XX5555 at SWIGGY on 12-10-26. Avl limit Rs 40000", "500"],
    ["KOTAKB",     "Rs.250.00 credited to your Kotak A/c XX1111 on 14-Oct-26. Available balance is INR 5,000.00", "250.00"],
    ["SBIINB",     "Your A/C XXXXX1234 debited by Rs.300.00 on 12Oct26 trf to RAHUL Refno 123456789012. Avl Bal Rs 2000", "300.00"],
    ["FEDBNK",     "Rs.1,250.00 debited from A/c XX9876 on 13-10-26. Balance: Rs.8,430.55", "1250.00"],
    ["PNBSMS",     "A/c XX1234 credited with Rs.75.00 on 14-10-26. Bal Rs.900.00 -PNB", "75.00"],
    ["YESBNK",     "Rs 99 debited from Yes Bank A/c; Closing balance ₹ 4,000", "99"],
    ["HDFCBK",     "Credit Alert! Rs.2,000.00 credited to HDFC Bank A/c XX1234 on 12-10-26 from RAHUL (UPI 123456789012). Avl bal ₹ 9,500.00", "2000.00"]
  ];
  cases.forEach(function(c){
    const got = parse(c[0], c[1]).amount;
    assert(got === c[2], "amount " + c[2] + " (not the balance) for: " + c[1].replace(/\d{4,}/g, "#").slice(0, 70) + (got === c[2] ? "" : "   GOT " + got));
  });
  assert(P.findTransactionAmount("your a/c balance is rs 1200.50") === "", "a message that ONLY shows a balance gives no amount (never a guess)");
  assert(P.findTransactionAmount("you can spend rs.500 available in your wallet") === "", "'Rs 500 available' is a balance figure too");
  assert(P.findTransactionAmount("rs.5000 credited. bal rs.2000") === "5000", "the first real amount wins when a balance follows");
}

console.log("\n--- 2. Dr. / Cr. wording, and what counts as money moving ---");
{
  const dr = parse("VM-BOBSMS-S", "Rs.100.00 Dr. from A/c XXXXXX1111 and Cr. to rahul@upi Ref:111111111111. AvlBal:Rs500(2026:10:13 12:00:00). Not you? Call 1800258/1800102-BOB");
  assert(dr.type === "debit" && dr.amount === "100.00" && dr.mode === "upi" && dr.bank === "BOB" && dr.reference === "111111111111", "'Rs.100 Dr. from A/c ... and Cr. to ...' is a DEBIT of 100 by UPI at Bank of Baroda: " + JSON.stringify(dr));
  assert(parse("BOBSMS", "Rs.60.00 Cr. to A/c XXXXXX1111 by someone@upi Ref 123456789012").type === "credit", "'Cr. to A/c' is a credit");
  assert(parse("HDFCBK", "Rs.40 debited from your account").type === "debit" && parse("HDFCBK", "Rs.40 credited to your account").type === "credit", "the wording that already worked still works");
  assert(P.classifyDetail("Rs.100.00 Dr. from A/c XXXXXX1111 and Cr. to rahul@upi Ref:111111111111", "VM-BOBSMS-S").result === "TRANSACTION", "that message is a confident TRANSACTION now (it used to be 'needs review')");
  assert(P.classifyDetail("Visit Dr. Reddy's clinic today, flat Rs 500 off on health check", "VM-PROMO-P").result !== "TRANSACTION", "a doctor's 'Dr.' in a promotion is NOT money moving");
}

console.log("\n--- 3. References, UPI vs e-mail, 'your A/c' ---");
{
  assert(parse("BOBSMS", "Account credited with INR 1.00 by UPI Ref No 628653900099").reference === "628653900099", "'UPI Ref No 628...' is read as the reference");
  assert(parse("SBIINB", "debited Rs 300 Refno 123456789012").reference === "123456789012", "'Refno 123...'");
  assert(parse("ICICIB", "Credit of Rs 45000 initiated with Payment Reference No. 4466120858").reference === "4466120858", "'Payment Reference No. 446...'");
  assert(parse("HDFCBK", "Rs 5 debited Ref 111222333444").reference === "111222333444", "the old simple wording still works");
  assert(parse("XXXX", "Order of Rs 100 confirmed. Help: support@zeptonow.com").mode === "other", "an e-mail address does not make it UPI");
  assert(parse("XXXX", "Rs 100 paid to chai@okhdfcbank").mode === "upi", "a UPI address (name@bank) does");
  assert(parse("XXXX", "Rs.1.00 Dr. from A/c XX1 and Cr. to 9876543210@pz. Ref:123456789012.").mode === "upi", "a UPI address at the END of a sentence (\"...@pz. Ref\") is still UPI");
  assert(!parse("HDFCBK", "Rs.250 credited to your A/c XX1111 by rahul@upi").counterparty, "'credited to your A/c' never makes 'your a' a merchant");
  assert(parse("HDFCBK", "Rs 75.00 debited from A/c XX1 to SWIGGY via UPI Ref 333333333333").counterparty === "swiggy", "the word 'via' is not part of the merchant");
}

console.log("\n--- 4. Teaching a bank (no code change) ---");
{
  w.addSheet("Transactions", [TXN_HEADER]);
  ["Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  sb.v2dbImportOwner(); sb.v2dbEnableOwner(); sb.v2dbEnableOwnerDirect();
  const key = w.act("owner", { action: "getMyIngestKey" }).key;
  const send = function(sender, sms, ts){ return JSON.parse(sb.handlePwaRequest({ action: "smsIn", key: key, sms: sms, sender: sender, timestamp: ts || Math.floor(Date.now() / 1000) }).getContent()); };
  const SMS = "Rs.10.00 withdrawn from account XX1234 on 14-10-26. Quick ref 123456789012";
  const before = send("VM-NEWBNK-S", SMS);
  const rowBefore = w.virtualTab(OWNER, "Transactions").pop();
  assert(before.outcome === "UNCERTAIN_SAVED" || before.outcome === "SAVED", "an unknown bank's message is still saved (" + before.outcome + ")");
  const friendTry = w.act("friend", { action: "teachBank", sender: "VM-NEWBNK-S", bank: "New Bank" });
  assert(friendTry.ok === false, "a friend cannot teach banks");
  assert(w.act("owner", { action: "teachBank", sender: "VM-NEWBNK-S", bank: "New Bank" }).ok === true, "the owner teaches 'VM-NEWBNK-S' = New Bank");
  const sum = w.act("owner", { action: "getSmsFormats" });
  assert(sum.taught.some(function(t){ return t.token === "NEWBNK" && t.bank === "NEW BANK"; }), "the taught bank is listed (token NEWBNK)");
  const after = send("VM-NEWBNK-S", SMS.replace("123456789012", "999888777666"));
  const rowAfter = w.virtualTab(OWNER, "Transactions").pop();
  assert(after.outcome === "SAVED" && rowAfter[2] === "NEW BANK", "the next message from that sender is a confident TRANSACTION with the bank filled in (" + after.outcome + ", bank '" + rowAfter[2] + "')");
  assert(w.act("owner", { action: "teachBank", sender: "VM-X-S", bank: "<script>" }).ok === false && w.act("owner", { action: "teachBank", sender: "??", bank: "Fine Bank" }).ok === false, "silly bank names and sender names are refused");
  assert(w.act("owner", { action: "forgetBank", sender: "NEWBNK" }).ok === true && w.act("owner", { action: "getSmsFormats" }).taught.length === 0, "and it can be forgotten again");
  assert(sb.smsInSenderToken_("VM-BOBSMS-S") === "BOBSMS" && sb.smsInSenderToken_("JD-JioPay-S") === "JIOPAY" && sb.smsInSenderToken_("HDFCBK") === "HDFCBK", "the token is the bank part of the sender name");
}

console.log("\n--- 5. The person's answer fills a blank direction (never overwrites one) ---");
{
  const w2 = build(); const sb2 = w2.sb;
  const today = new w2.D();
  const blank = [today, new w2.D(1899, 11, 30, 12, 0, 0), "", "", "other", 1, "111111111111", "NEEDS REVIEW: x", "SMS", "Phone", "some text", "VM-BOBSMS-S", "", "", "", "YES", "", "", "", "", ""];
  const known = [today, new w2.D(1899, 11, 30, 12, 0, 0), "HDFC", "credit", "upi", 5, "222222222222", "someone", "SMS", "Phone", "other text", "HDFCBK", "", "", "", "YES", "", "", "", "", ""];
  w2.addSheet("Transactions", [TXN_HEADER, blank, known]);
  ["Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w2.addSheet(t, [["h"]]); });
  const pend = w2.act("owner", { action: "getPending" }).transactions;
  const pBlank = pend.filter(function(t){ return t.row === 2; })[0];
  assert(pBlank && pBlank.type === "", "a row with no direction comes back from Pending with an empty type (so the card can ask)");
  const bad = w2.act("owner", { action: "saveNote", row: 2, fp: pBlank.fp, note: "x", category: "Other", counterparty: "x", direction: "sideways" });
  assert(w2.sheets.Transactions.rows[1][3] === "", "a made-up direction is ignored");
  const r = w2.act("owner", { action: "saveNote", row: 2, fp: pBlank.fp, note: "chai", category: "Food", counterparty: "x", direction: "debit" });
  assert(r.ok === true && w2.sheets.Transactions.rows[1][3] === "debit", "'spent' from the card fills the blank direction");
  const pKnown = pend.filter(function(t){ return t.row === 3; })[0];
  const r2 = w2.act("owner", { action: "saveNote", row: 3, fp: pKnown.fp, note: "gift", category: "Other", counterparty: "someone", direction: "debit" });
  assert(r2.ok === true && w2.sheets.Transactions.rows[2][3] === "credit", "a row that already says 'credit' is never flipped by this");
  const r3 = w2.act("owner", { action: "saveNote", row: 2, fp: sb2.rowFingerprint_(w2.sheets.Transactions.rows[1]), note: "chai", category: "Food", counterparty: "x", amount: 25 });
  assert(w2.sheets.Transactions.rows[1][5] === 25, "an amount typed on the card is saved (for messages where no amount could be read)");
}
