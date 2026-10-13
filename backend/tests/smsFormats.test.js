// backend/tests/smsFormats.test.js
//
// Plain-English what this checks: the shared bank-SMS-format library (smsFormats.js). Every message shape seen (from the owner's
// timer or a friend's phone) is stored as an ANONYMISED template with counts, so new banks can be taught from real examples. The
// template must hold no amount, account number, name, UPI id, phone number or link; nothing may link it to a person; a Firestore
// problem must never affect saving a message; only the owner can see the summary. All data here is invented.
// Run with: node backend/tests/smsFormats.test.js

const crypto = require("crypto");
const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
sb.sendPushNotification = function(t, b){ w.pushes.push({ title: t, body: b }); };
sb.CacheService = { getScriptCache: function(){ return { get: function(){ return null; }, put: function(){}, remove: function(){} }; } };
const formats = function(){ return Object.keys(w.store).filter(function(p){ return p.indexOf("smsFormats/") === 0; }).map(function(p){ return { path: p, f: w.store[p].fields }; }); };

console.log("\n--- 1. The template holds nothing personal ---");
{
  const sms = "Rs.1,250.00 debited from A/c XX9876 on 13-10-26 to RAHUL SHARMA (rahul.sharma@okhdfc) UPI Ref 628419375012. Bal Rs.8,430.55. Not you? Call 1800123456 or visit https://bob.example/dispute";
  const t = sb.smsFormatTemplate_(sms, "Rahul Sharma");
  assert(t.indexOf("rahul") === -1 && t.indexOf("sharma") === -1, "the payee name is gone");
  assert(!/\d/.test(t.replace(/<num>/gi, "")), "no digit survives (amount, account, reference, balance, phone, date)");
  assert(t.indexOf("okhdfc") === -1 && t.indexOf("<vpa>") !== -1, "the UPI id is replaced");
  assert(t.indexOf("https") === -1 && t.indexOf("<URL>") !== -1, "the link is replaced");
  assert(t.indexOf("debited from a/c") !== -1 && t.indexOf("upi ref") !== -1, "the bank's wording is kept (that is the point)");
  assert(sb.smsFormatTemplate_(sms.replace("1,250.00", "99").replace("RAHUL SHARMA", "ANITA RAO").replace("rahul.sharma@okhdfc", "anita@ybl"), "Anita Rao") === t, "the same bank wording gives the SAME template for a different person and amount");
}

console.log("\n--- 2. A friend's message is recorded; counts add up; nothing links it to her ---");
{
  sb.v2dbEnableUser(FRIEND);
  const key = w.act("friend", { action: "getMyIngestKey" }).key;
  const send = function(sms, tx, sender){ return JSON.parse(sb.handlePwaRequest({ action: "ingestSms", key: key, sms: sms, sender: sender || "VM-BOBSMS", timestamp: 1791863517, tx: tx }).getContent()); };
  const a = send("Rs.100.00 Dr. from A/c XX1111 to rahul@upi on 13-10-26. UPI Ref 111111111111", { bank: "", type: "debit", mode: "upi", amount: 100, reference: "111111111111", counterparty: "rahul@upi" });
  const b = send("Rs.250.00 Dr. from A/c XX2222 to meera@upi on 14-10-26. UPI Ref 222222222222", { bank: "", type: "debit", mode: "upi", amount: 250, reference: "222222222222", counterparty: "meera@upi" });
  assert(a.saved && b.saved, "both messages were saved for her");
  const fs = formats();
  assert(fs.length === 1 && Number(fs[0].f.seen) === 2, "two messages of the same bank wording = ONE format seen twice");
  assert(fs[0].f.sender === "VM-BOBSMS" && fs[0].f.template.indexOf("dr. from a/c xx<NUM>") !== -1, "it keeps the sender and the anonymised wording");
  assert(JSON.stringify(formats()).indexOf(FRIEND) === -1 && JSON.stringify(formats()).indexOf("rahul") === -1 && JSON.stringify(formats()).indexOf("meera") === -1, "no email, name or UPI id is anywhere in the library");
  assert(!Object.keys(fs[0].f).some(function(k){ return /email|user|row|date|amount|account/i.test(k); }), "its fields are only sender, template, bank, mode, type, counts and last-seen time");
  const u = send("Unknown wording Rs.5.00 something happened with your account today", { bank: "", type: "", mode: "other", amount: 5, reference: "", counterparty: "NEEDS REVIEW: unrecognized message" }, "VM-NEWBNK");
  const unc = formats().filter(function(x){ return x.f.sender === "VM-NEWBNK"; })[0];
  assert(unc && Number(unc.f.uncertain) === 1 && Number(unc.f.missingType) === 1, "an uncertain message is counted as not understood, with what was missing");
  const dup = send("Rs.100.00 Dr. from A/c XX1111 to rahul@upi on 13-10-26. UPI Ref 111111111111", { bank: "", type: "debit", mode: "upi", amount: 100, reference: "111111111111", counterparty: "rahul@upi" });
  assert(dup.duplicate === true && Number(formats().filter(function(x){ return x.f.sender === "VM-BOBSMS"; })[0].f.seen) === 2, "a duplicate delivery is not counted again");
}

console.log("\n--- 3. A library problem never affects saving a message ---");
{
  const key = w.act("friend", { action: "getMyIngestKey" }).key;
  const realCommit = sb.fsCommit_;
  sb.fsCommit_ = function(ops){ if(ops.some(function(o){ return o.merge && o.merge.path.indexOf("smsFormats/") === 0; })) throw new Error("library down"); return realCommit(ops); };
  const r = JSON.parse(sb.handlePwaRequest({ action: "ingestSms", key: key, sms: "Rs.7.00 Dr. from A/c XX3333 to shop@upi UPI Ref 333333333333 end", sender: "VM-BOBSMS", timestamp: 1791863999, tx: { type: "debit", mode: "upi", amount: 7, reference: "333333333333", counterparty: "shop@upi" } }).getContent());
  sb.fsCommit_ = realCommit;
  assert(r.ok === true && r.saved === true, "the message is saved even when the library write fails");
}

console.log("\n--- 4. The owner's own messages are recorded by the timer; other rows are not ---");
{
  const today = new w.D();
  const row = function(ref, sms, chan, proc){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", 40, ref, "Cafe Z", chan, "Tasker", sms, "VD-HDFCBN-S", "", "", "", proc, "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, row(1, "old", "SMS", "YES")]);
  ["Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.props.lastCheckedRow = "2";
  const before = formats().length;
  w.sheets.Transactions.appendRow(row(900001, "Sent Rs.40.00 From HDFC Bank A/C x1234 To Cafe Z On 13/10/26 Ref 900001", "SMS", ""));
  w.sheets.Transactions.appendRow(row(900002, "-", "Manual", ""));
  sb.processNewTransactions();
  const after = formats().filter(function(x){ return x.f.sender === "VD-HDFCBN-S"; });
  assert(after.length === 1 && after[0].f.template.indexOf("cafe z") === -1 && after[0].f.template.indexOf("<payee>") !== -1, "his SMS row was recorded, payee removed");
  assert(formats().length === before + 1, "the Manual row (no SMS text) was not recorded");
}

console.log("\n--- 5. Only the owner sees the summary ---");
{
  const s = w.act("owner", { action: "getSmsFormats" });
  assert(s.ok && s.formats >= 3 && s.senders >= 2 && s.top.length >= 2 && s.notUnderstood >= 1, "the owner sees formats, senders and how many are not understood yet: " + JSON.stringify({ f: s.formats, s: s.senders, n: s.notUnderstood }));
  assert(s.top[0].sender === "VM-NEWBNK", "the sender with the most not-understood messages is listed first");
  assert(w.act("friend", { action: "getSmsFormats" }).ok === false, "a friend cannot see it");
  assert(w.act("stranger", { action: "getSmsFormats" }).ok === false, "a stranger cannot see it");
}
