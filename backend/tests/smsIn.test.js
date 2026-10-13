// backend/tests/smsIn.test.js
//
// Plain-English what this checks: bank SMS landing DIRECTLY in a person's private space (smsIn.js). The owner needs the "direct" switch;
// his message is saved un-alerted so the usual timer sends the usual notification; junk is ignored; duplicates (same reference, same
// text, a statement placeholder) are not saved twice; a wrong key or a switched-off path says so (so the phone falls back to the old
// way); a friend's message lands in HER space only; and if the same message also arrives through the Sheet it is not copied twice.
// All data here is invented. Run with: node backend/tests/smsIn.test.js

const crypto = require("crypto");
const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
sb.CacheService = { getScriptCache: function(){ const s = w.__cache || (w.__cache = {}); return { get: function(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, put: function(k, v){ s[k] = String(v); }, remove: function(k){ delete s[k]; } }; } };
sb.sendPushNotification = function(t, b){ w.pushes.push({ title: t, body: b }); };

const today = new w.D(); today.setHours(10, 0, 0, 0);
const sheetRow = function(ref, sms, proc){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 11, 30, 0), "HDFC", "debit", "upi", 10, ref, "Old Shop", "SMS", "Tasker", sms, "HDFCBK", "", "", "", proc === undefined ? "YES" : proc, "", "", "", "", ""]; };
w.addSheet("Transactions", [TXN_HEADER, sheetRow(111111, "an older message with some words in it")]);
["Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
w.props.PWA_PUSH_TOKEN = "tok-owner";

sb.v2dbImportOwner(); sb.v2dbEnableOwner();

const send = function(key, sms, sender, ts){ return JSON.parse(sb.handlePwaRequest({ action: "smsIn", key: key, sms: sms, sender: sender || "HDFCBK", timestamp: ts || Math.floor(today.getTime() / 1000) }).getContent()); };
const mine = function(){ return w.virtualTab(OWNER, "Transactions"); };
const CAFE = "Sent Rs.40.00 From HDFC Bank A/C x1234 To Aarogyumm Cafe On 13/10/26 Ref 665226905838 Not You? Call 18002586161";

console.log("\n--- 1. The owner's key exists only when the direct switch is on ---");
let ownerKey;
{
  assert(w.act("owner", { action: "getMyIngestKey" }).ok === false, "switch off: the owner gets no key");
  assert(send("own" + "a".repeat(61), CAFE).ok === false, "switch off: a message with an owner-style key says 'use the old path'");
  sb.v2dbEnableOwnerDirect();
  const r = w.act("owner", { action: "getMyIngestKey" });
  assert(r.ok === true && /^own[0-9a-f]{61}$/.test(r.key), "switch on: the owner gets a key that starts with 'own'");
  ownerKey = r.key;
  assert(w.act("owner", { action: "getMyIngestKey" }).key === ownerKey, "the same key every time");
}

console.log("\n--- 2. A transaction lands directly, un-alerted; the timer then alerts it ---");
{
  const before = mine().length;
  const r = send(ownerKey, CAFE);
  assert(r.ok === true && r.outcome === "SAVED", "saved: " + JSON.stringify(r));
  const row = mine()[before];
  assert(mine().length === before + 1 && row[5] === 40 && row[3] === "debit" && row[6] === 665226905838 && /aarogyumm/i.test(row[7]) && row[8] === "SMS", "amount, type, reference and merchant were read correctly (exactly as the old SMS reader reads them)");
  assert(row[15] === "" || row[15] === undefined, "it is left NOT alerted (Processed blank), so the usual timer sends the usual notification");
  assert(w.pushes.length === 0, "no plain notification was sent from here");
  assert(w.sheets.Transactions.rows.length === 2, "the Google Sheet was not touched");
  sb.processNewTransactions();
  const after = mine()[before];
  assert(after[15] === "YES" && w.pushes.length >= 1 && /40/.test(w.pushes[w.pushes.length - 1].body), "the timer alerted it and marked it handled");
  const pend = w.act("owner", { action: "getPending" });
  assert(pend.ok && pend.transactions.some(function(t){ return t.amount === 40; }), "it shows up in his Pending list");
}

console.log("\n--- 3. Duplicates are not saved twice, but two real purchases are ---");
{
  const n = mine().length;
  assert(send(ownerKey, CAFE).outcome === "DUPLICATE", "the exact same message again -> duplicate");
  assert(send(ownerKey, CAFE.replace("Not You?", "Not you ?")).outcome === "DUPLICATE", "the same bank reference in different words -> duplicate");
  assert(mine().length === n, "nothing was added");
  const a = send(ownerKey, "Sent Rs.250.00 From HDFC Bank A/C x1234 To Zomato On 13/10/26 Ref 700000000001 Not You? Call 18002586161");
  const b = send(ownerKey, "Sent Rs.250.00 From HDFC Bank A/C x1234 To Zomato On 13/10/26 Ref 700000000002 Not You? Call 18002586161");
  assert(a.outcome === "SAVED" && b.outcome === "SAVED" && mine().length === n + 2, "two different Zomato orders for the same amount on the same day are BOTH saved");
  // a statement-reconciled placeholder row is recognised once its real SMS arrives
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow([new w.D(today.getTime()), new w.D(1899, 11, 30, 11, 0, 0), "HDFC", "debit", "card 8132", 99, "NOREF_47", "google asia pacific", "Import", "Credit Card Statement", "-", "-", "", "", "", "YES", "", "", "", "", ""]); });
  const ph = send(ownerKey, "Rs.99.00 spent on HDFC Bank Card x8132 at GOOGLE ASIA PACIFIC on 13/10/26 Avl Limit Rs 40000");
  assert(ph.outcome === "DUPLICATE", "the real SMS for a statement-reconciled placeholder is recognised, not added again");
}

console.log("\n--- 4. Junk, uncertain messages, learned junk ---");
{
  const n = mine().length;
  assert(send(ownerKey, "Your OTP is 123456. Do not share it with anyone.").outcome === "IGNORED", "an OTP is ignored");
  assert(send(ownerKey, "Get a Loan on your HDFC Bank Credit Card @ ZERO Processing Fee https://1.hdfc.bank.in/HDFCBK/s/V6JLK9Rx").outcome === "IGNORED", "a promotion with a link is ignored");
  assert(send(ownerKey, "hello how are you", "XXXX").outcome === "IGNORED", "chat from an unknown sender with no amount is ignored");
  assert(mine().length === n, "none of them were saved");
  const odd = "Strange bank wording: an amount of Rs.77.00 changed on your account today in some unusual way, ref code 9";
  const u = send(ownerKey, odd, "VM-NEWBNK");
  assert(u.outcome === "UNCERTAIN_SAVED" && /^NEEDS REVIEW/.test(mine()[mine().length - 1][7]), "an unrecognised message with an amount is saved for review, never dropped");
  // teach it as junk (the owner's 'not a transaction' button), then it is ignored
  sb.processNewTransactions();                                  // the timer alerts it first, then it is listed in Pending
  const pend = w.act("owner", { action: "getPending" }).transactions.filter(function(t){ return /NEEDS REVIEW/.test(t.counterparty); })[0];
  const marked = w.act("owner", { action: "markNotATransaction", row: pend.row, fp: pend.fp });
  assert(marked.ok === true && marked.patternLearned === true, "the owner marks it 'not a transaction' and the app learns the pattern");
  assert(send(ownerKey, odd.replace("77.00", "88.00"), "VM-NEWBNK").outcome === "IGNORED", "the same kind of message is now ignored automatically (learned in his private copy)");
}

console.log("\n--- 5. Unknown keys, the old-path fallbacks, and failures ---");
{
  assert(send("c".repeat(64), CAFE).error === "Unknown key.", "a wrong key is refused");
  sb.v2dbDisableOwnerDirect();
  const off = send(ownerKey, "Sent Rs.5.00 From HDFC Bank A/C x1234 To Tea On 13/10/26 Ref 800000000001 Not You? Call 1");
  assert(off.ok === false && /old path/i.test(off.error), "with the direct switch off, the owner's message is told to use the old path (the phone then falls back)");
  assert(w.act("owner", { action: "getMyIngestKey" }).ok === false, "and the owner's key is no longer handed out");
  sb.v2dbEnableOwnerDirect();
  const real = sb.fsCommit_;
  sb.fsCommit_ = function(){ throw new Error("firestore down"); };
  const bad = send(ownerKey, "Sent Rs.5.00 From HDFC Bank A/C x1234 To Tea On 13/10/26 Ref 800000000002 Not You? Call 1");
  sb.fsCommit_ = real;
  assert(bad.ok === false && /Try again/.test(bad.error), "if saving fails the phone is told to try again (nothing half-saved)");
  assert(mine().filter(function(r){ return r[6] === 800000000002; }).length === 0, "and nothing was saved");
  const again = send(ownerKey, "Sent Rs.5.00 From HDFC Bank A/C x1234 To Tea On 13/10/26 Ref 800000000002 Not You? Call 1");
  assert(again.outcome === "SAVED" && mine().filter(function(r){ return r[6] === 800000000002; }).length === 1, "the retry then saves it exactly once");
}

console.log("\n--- 6. The same message arriving through the old way too is not copied twice ---");
{
  const n = mine().length;
  w.sheets.Transactions.appendRow(sheetRow(665226905838, CAFE, ""));          // the old SMS reader wrote the Sheet as well (the reply got lost)
  w.sheets.Transactions.appendRow(sheetRow(900000000009, "A different brand new message that only the Sheet has", ""));
  sb.processNewTransactions();
  assert(mine().filter(function(r){ return r[6] === 665226905838; }).length === 1, "the message already in his private copy is NOT copied a second time");
  assert(mine().filter(function(r){ return r[6] === 900000000009; }).length === 1 && mine().length === n + 1, "but a message only the Sheet has is still copied");
  assert(w.sheets.Transactions.rows[w.sheets.Transactions.rows.length - 2][15] === "YES" && w.sheets.Transactions.rows[w.sheets.Transactions.rows.length - 1][15] === "YES", "both Sheet rows are stamped handled");
}

console.log("\n--- 7. A friend's message lands in HER space only ---");
{
  sb.v2dbEnableUser(FRIEND);
  const key = w.act("friend", { action: "getMyIngestKey" }).key;
  const ownerBefore = mine().length; w.pushes.length = 0;
  const r = send(key, "Rs.60.00 debited from A/c XX2222 to chai@upi on 13-10-26. UPI Ref 910000000001", "VM-BOBSMS");
  assert(r.ok && (r.outcome === "SAVED" || r.outcome === "UNCERTAIN_SAVED"), "her message was saved: " + JSON.stringify(r));
  const hers = w.virtualTab(FRIEND, "Transactions");
  assert(hers && hers.length === 2 && hers[1][15] === "YES", "it is in HER Transactions, already alerted");
  assert(mine().length === ownerBefore, "nothing was added to the owner's space");
  assert(w.pushes.length === 1, "she got a plain notification");
  assert(send(key, "Rs.60.00 debited from A/c XX2222 to chai@upi on 13-10-26. UPI Ref 910000000001", "VM-BOBSMS").outcome === "DUPLICATE", "her duplicates are caught too (now by the full rules)");
}

console.log("\n--- 8. Safe text and limits ---");
{
  const r = send(ownerKey, "=IMPORTXML(\"http://evil\") Sent Rs.9.00 From HDFC Bank A/C x1234 To Tea On 13/10/26 Ref 920000000001 Not You? Call 1");
  const last = mine()[mine().length - 1];
  assert(!r.ok || r.outcome === "IGNORED" || String(last[10]).charAt(0) !== "=", "text starting with = is never stored as a formula");
  w.__cache = {};
  const day = "SMSIN_N_" + OWNER + "_" + sb.Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd");
  w.__cache[day] = "400";
  assert(send(ownerKey, CAFE.replace("665226905838", "930000000001")).error === "Too many messages for now.", "a flood is cut off (400 saved messages a day per person)");
}
