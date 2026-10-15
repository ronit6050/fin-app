// backend/tests/fnTimer.test.js
//
// Plain-English what this checks: the ALERT TIMER moving to the new server (backend/fnTimer.js, transactions.js, v2owner.js, smsIn.js):
//   - switch OFF (default): the Apps Script timer alerts exactly as before;
//   - switch ON, Apps Script side: it STEPS ASIDE for alerts (no notification, so nothing is announced twice) and only copies rows the old SMS
//     doors wrote into the Google Sheet across into the owner's private copy, marking "something changed"; with an unchanged Sheet it does not
//     touch Firestore at all;
//   - on the NEW server (no Google Sheet): a quiet tick is one cheap check and does nothing; a marked change, or the 30-minute full look, runs the
//     real work once (notification, Processed = YES) without any Sheet errors; a failed run is not marked done, so the next tick retries;
//   - the owner's bank-SMS door marks "something changed" after saving his row.
// All data here is invented. Run with: node backend/tests/fnTimer.test.js

const crypto = require("crypto");
const { build, OWNER, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

function seed(w){
  const sb = w.sb;
  sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
  sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
  sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
  sb.sendPushNotification = function(title, body, extra){ w.pushes.push({ title: title, body: body, extra: extra || null }); };
  const today = new w.D(); today.setHours(10, 0, 0, 0);
  w.today = today;
  w.row = function(amt, ref, cp, proc){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, ref, cp, "SMS", "Tasker", "raw sms text number " + ref, "HDFCBK", "", "", "", proc === undefined ? "YES" : proc, "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, w.row(120, 111111, "Cafe A"), w.row(80, 222222, "Shop B")]);
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.props.lastCheckedRow = "3"; w.props.PWA_PUSH_TOKEN = "device-token-123";
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  w.pushes.length = 0;
}
// pretend there is NO Google Sheet (the new server)
function asNewServer(sb){
  sb.V2_ON_NEW_SERVER_ = true;
  sb.SpreadsheetApp = { getActiveSpreadsheet: function(){ return { getSheetByName: function(){ return null; }, getSheets: function(){ return []; }, insertSheet: function(){ throw new Error("This server has no Google Sheet"); } }; } };
}
const tick = function(ms){ const t = Date.now(); while(Date.now() - t < (ms || 3)){} };      // let the clock move on a few ms
const timerDoc = function(w){ const d = w.store["_system/timer"]; return d ? d.fields : null; };
const privateRows = function(w){ return w.virtualTab(OWNER, "Transactions"); };

console.log("\n--- 1. Switch OFF (default): the Apps Script timer alerts as before ---");
{
  const w = build(); seed(w); const sb = w.sb;
  assert(sb.fnTimerOn_() === false, "the timer switch is off by default");
  w.sheets.Transactions.appendRow(w.row(55, 333333, "Shop C", ""));
  sb.processNewTransactions();
  assert(w.pushes.length === 1, "one notification went out from Apps Script");
  assert(privateRows(w).length === 4 && privateRows(w)[3][15] === "YES", "the row was copied in and processed");
}

console.log("\n--- 2. Switch ON, Apps Script side: steps aside, only copies old-door rows ---");
{
  const w = build(); seed(w); const sb = w.sb;
  w.props.V2_FN_TIMER = "on";
  w.sheets.Transactions.appendRow(w.row(55, 333333, "Shop C", ""));       // the OLD door wrote this into the Sheet
  sb.processNewTransactions();
  assert(w.pushes.length === 0, "NO notification from Apps Script (the new server announces it, so it is never announced twice)");
  const mine = privateRows(w);
  assert(mine.length === 4 && mine[3][5] === 55 && mine[3][15] === "", "the row was copied into his private copy, still waiting for its alert (Processed blank)");
  assert(w.sheets.Transactions.rows[3][15] === "YES", "and the Sheet's own copy was stamped so it is never copied twice");
  assert(timerDoc(w) && Number(timerDoc(w).dirtyAtMs) > 0, "it marked 'something changed' for the new server's timer");
  assert(w.props.V2_INBOX_CHECKED_ROWS === "4", "it remembers the Sheet's row count it last looked at");
  const commits = w.commits;
  sb.processNewTransactions();
  assert(w.commits === commits && w.pushes.length === 0, "with the Sheet unchanged a second run writes NOTHING to Firestore");
  w.sheets.Transactions.appendRow(w.row(66, 444444, "Shop D", ""));
  sb.processNewTransactions();
  assert(privateRows(w).length === 5 && w.pushes.length === 0, "a newer old-door row is copied too (still no notification from Apps Script)");
  // owner not switched on: Apps Script must keep doing everything even if the new-server switch is on
  const w2 = build(); seed(w2); w2.props.V2_FN_TIMER = "on"; w2.sb.v2dbDisableOwner();
  w2.sheets.Transactions.appendRow(w2.row(77, 555555, "Shop E", ""));
  w2.sb.processNewTransactions();
  assert(w2.pushes.length === 1, "if the owner is NOT on the private copy, Apps Script still alerts (the new server cannot serve him)");
}

console.log("\n--- 3. The NEW server's tick (no Google Sheet) ---");
{
  const w = build(); seed(w); const sb = w.sb;
  // an owner row waiting for its alert, as the SMS door or the Apps Script inbox would leave it
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(90, 666666, "Shop F", "")); }, { prefetch: ["Transactions", "_Props"] });
  asNewServer(sb);
  const r1 = sb.timerTick_();
  assert(r1.ran === true && r1.why === "full look", "the first tick (never looked yet) does a full look");
  assert(w.pushes.length === 1 && /New Transaction/.test(w.pushes[0].title), "it sent the notification");
  assert(privateRows(w)[3][15] === "YES", "and marked the row processed");
  assert(w.errors("V2_INBOX_HEAL_ERROR").length === 0 && w.errors("V2_INBOX_STAMP_ERROR").length === 0 && w.errors("PROCESS_TXN_ERROR").length === 0, "with no Google-Sheet errors (the inbox steps are skipped there)");
  assert(timerDoc(w).doneAtMs > 0 && timerDoc(w).fullAtMs > 0, "it recorded that it is done");
  const commits = w.commits, pushes = w.pushes.length;
  tick();
  const r2 = sb.timerTick_();
  assert(r2.ran === false && r2.reason === "nothing to do" && w.commits === commits && w.pushes.length === pushes, "a quiet tick does nothing and writes nothing");
  // a new unprocessed row but nobody marked it: the quiet tick does not look (cheap by design) ...
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(91, 777777, "Shop G", "")); }, { prefetch: ["Transactions", "_Props"] });
  tick();
  assert(sb.timerTick_().ran === false, "an unmarked change is not looked at by a quiet tick (the 30-minute full look is its safety net)");
  // ... until it is marked
  tick();
  sb.timerMarkDirty_();
  tick();
  const r3 = sb.timerTick_();
  assert(r3.ran === true && r3.why === "marked changed" && w.pushes.length === pushes + 1, "once marked, the next tick alerts it exactly once");
  tick();
  assert(sb.timerTick_().ran === false && w.pushes.length === pushes + 1, "and does not alert it again");
  // the safety net
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(92, 888888, "Shop H", "")); }, { prefetch: ["Transactions", "_Props"] });
  w.store["_system/timer"].fields.fullAtMs = Date.now() - 31 * 60 * 1000;
  const r4 = sb.timerTick_();
  assert(r4.ran === true && r4.why === "full look" && w.pushes.length === pushes + 2, "after 30 minutes the full look finds a change nobody marked");
}

console.log("\n--- 4. A failed run is not marked done; the owner not being on the private copy is a no-op ---");
{
  const w = build(); seed(w); const sb = w.sb;
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(93, 999999, "Shop I", "")); }, { prefetch: ["Transactions", "_Props"] });
  asNewServer(sb);
  const bad = new Error("firestore down"); bad.httpCode = 503;
  w.failCommits = [null, bad, bad, bad];          // the tick's own reads work; saving the processed row keeps failing
  let threw = false; try{ sb.timerTick_(); }catch(e){ threw = true; }
  w.failCommits = [];
  assert(threw && !(timerDoc(w) && timerDoc(w).doneAtMs), "a failing run throws and is NOT recorded as done");
  const again = sb.timerTick_();
  assert(again.ran === true && privateRows(w)[3][15] === "YES", "the next tick retries and finishes the job");
  const w2 = build(); seed(w2); asNewServer(w2.sb); w2.sb.v2dbDisableOwner();
  const off = w2.sb.timerTick_();
  assert(off.ran === false && /not on the private copy/.test(off.reason) && !timerDoc(w2), "owner not on the private copy: nothing runs, nothing is read or written");
}

console.log("\n--- 5. The owner's SMS door marks 'something changed' ---");
{
  const w = build(); seed(w); const sb = w.sb;
  sb.CacheService = { getScriptCache: function(){ const s = w.__cache || (w.__cache = {}); return { get: function(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, put: function(k, v){ s[k] = String(v); }, remove: function(k){ delete s[k]; } }; } };
  sb.v2dbEnableOwnerDirect();
  const key = w.act("owner", { action: "getMyIngestKey" }).key;
  const send = function(sms){ return JSON.parse(sb.handlePwaRequest({ action: "smsIn", key: key, sms: sms, sender: "HDFCBK", timestamp: Math.floor(w.today.getTime() / 1000) }).getContent()); };
  assert(!timerDoc(w), "no marker before any message");
  const r = send("Sent Rs.40.00 From HDFC Bank A/C x1234 To Aarogyumm Cafe On 13/10/26 Ref 665226905838 Not You? Call 18002586161");
  assert(r.ok === true && r.outcome === "SAVED" && timerDoc(w) && Number(timerDoc(w).dirtyAtMs) > 0, "a saved owner message marks it");
  const d1 = timerDoc(w).dirtyAtMs;
  tick();
  send("Sent Rs.40.00 From HDFC Bank A/C x1234 To Aarogyumm Cafe On 13/10/26 Ref 665226905838 Not You? Call 18002586161");
  assert(timerDoc(w).dirtyAtMs === d1, "a duplicate (not saved) does not mark again");
  assert(w.pushes.length === 0, "the SMS door itself sends no owner alert (the timer does)");
}

console.log("\nDone.");
