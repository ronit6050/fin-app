// backend/tests/smsInstantAlert.test.js
//
// Plain-English what this checks: the "instant alert" (smsIn.js, 2026-10-16). Before, the owner's bank SMS was saved un-alerted and the
// notification waited for the 5-minute timer. Now, on the NEW server, the SMS door runs the same alert step itself right after the save, and the
// timer is only a safety net. Checked:
//   - the rich notification (amount, merchant) goes out from the SMS door at once, the row is marked handled, and the timer afterwards sends NOTHING more
//     (a transaction is announced exactly once);
//   - the phone's answer is unchanged (no internal fields leak into it);
//   - with the new-server timer switch OFF, or on Apps Script, nothing changes: the row is left for the timer;
//   - if the instant step fails, is short of time, or cannot get the save lock, the SMS is still saved and answered "ok", the row stays un-alerted,
//     and the next timer tick alerts it exactly once (the safety net works);
//   - a duplicate message does not alert again; two messages in a row alert once each;
//   - the instant step never throws into the SMS door.
// All data here is invented. Run with: node backend/tests/smsInstantAlert.test.js

const crypto = require("crypto");
const { build, OWNER, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const CAFE = "Sent Rs.40.00 From HDFC Bank A/C x1234 To Aarogyumm Cafe On 13/10/26 Ref 665226905838 Not You? Call 18002586161";
const SHOP = "Sent Rs.75.00 From HDFC Bank A/C x1234 To Corner Store On 13/10/26 Ref 665226905999 Not You? Call 18002586161";

function make(opts){
  opts = opts || {};
  const w = build(); const sb = w.sb;
  sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
  sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
  sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
  sb.sendPushNotification = function(title, body, extra){ w.pushes.push({ title: title, body: body, extra: extra || null }); };
  sb.CacheService = { getScriptCache: function(){ const s = w.__cache || (w.__cache = {}); return { get: function(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, put: function(k, v){ s[k] = String(v); }, remove: function(k){ delete s[k]; } }; } };
  const today = new w.D(); today.setHours(10, 0, 0, 0); w.today = today;
  const row = function(amt, ref, cp){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, ref, cp, "SMS", "Tasker", "raw sms text number " + ref, "HDFCBK", "", "", "", "YES", "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, row(120, 111111, "Cafe A"), row(80, 222222, "Shop B")]);
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.props.lastCheckedRow = "3"; w.props.PWA_PUSH_TOKEN = "device-token-123";
  sb.v2dbImportOwner(); sb.v2dbEnableOwner(); sb.v2dbEnableOwnerDirect();
  w.pushes.length = 0;
  w.key = w.act("owner", { action: "getMyIngestKey" }).key;
  w.log = [];
  sb.logAI = function(type, message){ w.log.push({ type: type, message: String(message) }); };
  if(opts.newServer !== false){
    sb.V2_ON_NEW_SERVER_ = true;
    sb.timerIstClock_ = function(){ return { date: "2026-10-16", minutes: 180 }; };
    sb.SpreadsheetApp = { getActiveSpreadsheet: function(){ return { getSheetByName: function(){ return null; }, getSheets: function(){ return []; }, insertSheet: function(){ throw new Error("This server has no Google Sheet"); } }; } };
  }
  if(opts.timerOn !== false) sb.flagsSet_({ V2_FN_TIMER: "on" });
  w.send = function(sms){ return JSON.parse(sb.handlePwaRequest({ action: "smsIn", key: w.key, sms: sms, sender: "HDFCBK", timestamp: Math.floor(today.getTime() / 1000) }).getContent()); };
  w.rows = function(){ return w.virtualTab(OWNER, "Transactions"); };
  return w;
}
const logged = function(w, type){ return w.log.filter(function(l){ return l.type === type; }); };

console.log("\n--- 1. New server, timer switch on: the alert goes out from the SMS door, and only once ---");
{
  const w = make(); const sb = w.sb;
  const r = w.send(CAFE);
  assert(r.ok === true && r.outcome === "SAVED" && Object.keys(r).sort().join() === "ok,outcome,reason", "the phone's answer is the usual one (no internal fields): " + JSON.stringify(r));
  const row = w.rows()[w.rows().length - 1];
  assert(row[15] === "YES", "the row is marked handled straight away");
  assert(w.pushes.length === 1 && /40/.test(w.pushes[0].body) && /aarogyumm/i.test(w.pushes[0].body), "ONE rich notification with the amount and merchant went out already: " + JSON.stringify(w.pushes[0]));
  assert(w.pushes[0].extra && w.pushes[0].extra.row === w.rows().length && w.pushes[0].extra.fp, "it carries the same row number and safety fingerprint the timer's notifications carry");
  assert(logged(w, "SMSIN_ALERT").length === 1, "the time it took is logged");
  const td = w.store["_system/timer"].fields;
  assert(td.lastInstantResult === "ok" && Number(td.lastInstantAtMs) > 0 && Number(td.lastInstantTotalMs) >= Number(td.lastInstantAlertMs) && td.dirtyAtMs, "the result and times are also saved in the database (readable later), next to the tick's own fields");
  const tick = sb.timerTick_();
  assert(w.pushes.length === 1, "the timer's tick afterwards sends NOTHING more: announced exactly once (tick: " + JSON.stringify(tick) + ")");
}

console.log("\n--- 2. Two messages in a row: each alerted once ---");
{
  const w = make(); const sb = w.sb;
  w.send(CAFE); w.send(SHOP);
  assert(w.pushes.length === 2 && /40/.test(w.pushes[0].body) && /75/.test(w.pushes[1].body), "two notifications, one each");
  sb.timerTick_(); sb.timerTick_();
  assert(w.pushes.length === 2, "ticks add none");
  const dup = w.send(CAFE);
  assert(dup.outcome === "DUPLICATE" && w.pushes.length === 2, "the same message again is a duplicate and is not announced again");
}

console.log("\n--- 3. Switch off / Apps Script: unchanged, the row is left for the timer ---");
{
  const w = make({ timerOn: false });
  const r = w.send(CAFE);
  assert(r.ok === true && r.outcome === "SAVED" && w.pushes.length === 0, "new-server timer switch OFF: saved, no instant alert");
  assert(!(w.store["_system/timer"].fields || {}).lastInstantResult, "nothing about an instant alert is recorded when it never ran");
  assert(w.rows()[w.rows().length - 1][15] === "", "row left un-alerted for the timer");
  const w2 = make({ newServer: false });
  w2.send(CAFE);
  assert(w2.pushes.length === 0 && w2.rows()[w2.rows().length - 1][15] === "", "on Apps Script: no instant alert (it is the fallback path)");
}

console.log("\n--- 4. The instant step fails: SMS still saved and answered ok; the timer alerts it once ---");
{
  const w = make(); const sb = w.sb;
  const real = sb.processNewTransactionsCore_;
  sb.processNewTransactionsCore_ = function(){ throw new Error("alert step exploded"); };
  const r = w.send(CAFE);
  assert(r.ok === true && r.outcome === "SAVED", "the phone is still told ok/SAVED (it must not retry or fall back)");
  assert(w.pushes.length === 0 && w.rows()[w.rows().length - 1][15] === "", "no alert, row still un-alerted");
  assert(logged(w, "SMSIN_ALERT_ERROR").length === 1 && /timer will alert/.test(logged(w, "SMSIN_ALERT_ERROR")[0].message), "the failure is logged in plain words");
  assert(w.store["_system/timer"].fields.lastInstantResult === "error", "and recorded in the database as an error");
  sb.processNewTransactionsCore_ = real;
  sb.timerTick_();
  assert(w.pushes.length === 1 && w.rows()[w.rows().length - 1][15] === "YES", "the next tick (the safety net) alerts it exactly once");
  sb.timerTick_();
  assert(w.pushes.length === 1, "and not again");
}

console.log("\n--- 5. Short of time: the instant step is skipped, the timer covers it ---");
{
  const w = make(); const sb = w.sb;
  sb.SMSIN_ALERT_BUDGET_MS_ = -1;                              // pretend the save already used up the whole budget
  const r = w.send(CAFE);
  assert(r.ok === true && r.outcome === "SAVED" && w.pushes.length === 0, "saved, no instant alert");
  assert(logged(w, "SMSIN_ALERT_SKIPPED").length === 1, "the skip is logged");
  assert(w.store["_system/timer"].fields.lastInstantResult === "skipped", "and recorded in the database as skipped");
  sb.timerTick_();
  assert(w.pushes.length === 1, "the timer alerts it once");
}

console.log("\n--- 6. The save lock is busy: no instant alert, no error to the phone, timer covers it ---");
{
  const w = make(); const sb = w.sb;
  const realLock = sb.sharedLock_; let n = 0;
  sb.sharedLock_ = function(o){
    n++;
    const l = realLock(o);
    if(n === 1) return l;                                        // the SMS save itself gets the lock
    return { waitLock: function(){ throw new Error("Lock timeout"); }, releaseLock: function(){}, tryLock: function(){ return false; } };
  };
  const r = w.send(CAFE);
  assert(r.ok === true && r.outcome === "SAVED" && w.pushes.length === 0, "saved and answered ok; no alert yet");
  assert(logged(w, "SMSIN_ALERT_ERROR").length === 1, "logged");
  sb.sharedLock_ = realLock;
  sb.timerTick_();
  assert(w.pushes.length === 1, "the timer alerts it once");
}

console.log("\n--- 7. A non-transaction or a junk message never alerts ---");
{
  const w = make();
  const r = w.send("Your OTP is 123456. Do not share it with anyone.");
  assert(r.ok === true && r.outcome === "IGNORED" && w.pushes.length === 0 && logged(w, "SMSIN_ALERT").length === 0, "ignored message: no alert step at all");
}

console.log("\nDone.");
