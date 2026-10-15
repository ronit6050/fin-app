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
function asNewServer(w){
  const sb = w.sb;
  // on the new server logs go to the log service, not a Sheet tab: keep them in the test's own log so the checks can see them
  sb.logAI = function(type, message){ w.sheets.AILogs.appendRow([new Date(), type, String(message)]); };
  sb.V2_ON_NEW_SERVER_ = true;
  sb.timerIstClock_ = function(){ return { date: "2026-10-15", minutes: 180 }; };       // 03:00 India time: no daily job is due unless a test says so
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
  w.sb.flagsSet_({ V2_FN_TIMER: "on" });
  w.store["_system/timer"] = { fields: { tickAtMs: Date.now() }, updateTime: "t0" };     // the new server ticked a moment ago
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
  const w2 = build(); seed(w2); w2.sb.flagsSet_({ V2_FN_TIMER: "on" }); w2.store["_system/timer"] = { fields: { tickAtMs: Date.now() }, updateTime: "t0" }; w2.sb.v2dbDisableOwner();
  w2.sheets.Transactions.appendRow(w2.row(77, 555555, "Shop E", ""));
  w2.sb.processNewTransactions();
  assert(w2.pushes.length === 1, "if the owner is NOT on the private copy, Apps Script still alerts (the new server cannot serve him)");
}

console.log("\n--- 3. The NEW server's tick (no Google Sheet) ---");
{
  const w = build(); seed(w); const sb = w.sb;
  // an owner row waiting for its alert, as the SMS door or the Apps Script inbox would leave it
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(90, 666666, "Shop F", "")); }, { prefetch: ["Transactions", "_Props"] });
  asNewServer(w);
  const r1 = sb.timerTick_();
  assert(r1.ran === true && r1.why === "full look", "the first tick (never looked yet) does a full look");
  assert(w.pushes.length === 1 && /New Transaction/.test(w.pushes[0].title), "it sent the notification");
  assert(privateRows(w)[3][15] === "YES", "and marked the row processed");
  assert(w.errors("V2_INBOX_HEAL_ERROR").length === 0 && w.errors("V2_INBOX_STAMP_ERROR").length === 0 && w.errors("PROCESS_TXN_ERROR").length === 0, "with no Google-Sheet errors (the inbox steps are skipped there)");
  assert(timerDoc(w).doneAtMs > 0 && timerDoc(w).fullAtMs > 0, "it recorded that it is done");
  const commits = w.commits, pushes = w.pushes.length;
  tick();
  const r2 = sb.timerTick_();
  assert(r2.ran === false && r2.reason === "nothing to do" && w.pushes.length === pushes, "a quiet tick does nothing");
  assert(w.commits === commits + 1 && Date.now() - Number(timerDoc(w).tickAtMs) < 5000, "its only write is the heartbeat ('the new server is alive')");
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
  tick(); sb.timerTick_(); tick(); sb.timerTick_();
  assert(w.pushes.length === pushes + 1, "further ticks never announce it again (a marked change inside the 5 s clock margin may cause one harmless extra look)");
  // the safety net
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(92, 888888, "Shop H", "")); }, { prefetch: ["Transactions", "_Props"] });
  w.store["_system/timer"].fields.fullAtMs = Date.now() - 31 * 60 * 1000;
  const r4 = sb.timerTick_();
  assert(r4.ran === true && w.pushes.length === pushes + 2, "after 30 minutes the full look finds a change nobody marked");
}

console.log("\n--- 4. A failed run is not marked done; the owner not being on the private copy is a no-op ---");
{
  const w = build(); seed(w); const sb = w.sb;
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(93, 999999, "Shop I", "")); }, { prefetch: ["Transactions", "_Props"] });
  asNewServer(w);
  const realRun = sb.processNewTransactions;
  sb.processNewTransactions = function(){ throw new Error("firestore down"); };        // the real work fails (the timer's own bookkeeping still works)
  let threw = false; try{ sb.timerTick_(); }catch(e){ threw = true; }
  sb.processNewTransactions = realRun;
  assert(threw && !(timerDoc(w) && timerDoc(w).doneAtMs), "a failing run throws and is NOT recorded as done");
  assert(Number(timerDoc(w).failCount) === 1, "the failure is counted");
  const again = sb.timerTick_();
  assert(again.ran === true && privateRows(w)[3][15] === "YES" && Number(timerDoc(w).failCount) === 0, "the next tick retries, finishes the job and clears the count");
  const w2 = build(); seed(w2); asNewServer(w2); w2.sb.v2dbDisableOwner();
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

console.log("\n--- 6. Dead-man protection: Apps Script takes the job back if the new server stops ticking ---");
{
  const mk = function(heartbeat){
    const w = build(); seed(w); w.sb.flagsSet_({ V2_FN_TIMER: "on" });
    if(heartbeat !== null) w.store["_system/timer"] = { fields: { tickAtMs: heartbeat }, updateTime: "t0" };
    w.sheets.Transactions.appendRow(w.row(55, 333333, "Shop C", ""));
    return w;
  };
  const none = mk(null); none.sb.processNewTransactions();
  assert(none.pushes.length === 1, "no heartbeat at all (the new server has never ticked): Apps Script alerts as before");
  const stale = mk(Date.now() - 13 * 60 * 1000); stale.sb.processNewTransactions();
  assert(stale.pushes.length === 1 && stale.errors("FN_TIMER_STALE").length === 1, "a heartbeat 13 minutes old: Apps Script takes over again and says so in the log");
  const fresh = mk(Date.now() - 2 * 60 * 1000); fresh.sb.processNewTransactions();
  assert(fresh.pushes.length === 0, "a heartbeat 2 minutes old: Apps Script steps aside");
  const real = mk(Date.now()); const orig = real.sb.fsGetPathMeta_;
  real.sb.fsGetPathMeta_ = function(p){ if(p === "_system/timer") throw new Error("firestore down"); return orig(p); };
  assert(real.sb.timerHeartbeatFresh_() === false, "a read error counts as 'not ticking' (Apps Script keeps alerting)");
  real.sb.processNewTransactions();
  assert(real.pushes.length === 1, "and in that case it really does alert");
}

console.log("\n--- 7. Switching on is refused unless it can work ---");
{
  const w = build(); seed(w); const sb = w.sb;
  let msg = ""; try{ sb.v2dbEnableFunctionTimer(); }catch(e){ msg = e.message; }
  assert(/saving first/.test(msg) && w.sb.flagGet_("V2_FN_TIMER") === null, "without new-server saving on it refuses and switches nothing on");
  w.sb.flagsSet_({ V2_FN_WRITES: "on" });
  const bad = new Error("firestore down"); bad.httpCode = 503; w.failCommits = [bad];
  msg = ""; try{ sb.v2dbEnableFunctionTimer(); }catch(e){ msg = e.message; }
  w.failCommits = [];
  assert(/NOTHING was changed/.test(msg) && w.sb.flagGet_("V2_FN_TIMER") === null, "if the new server could not be told, it refuses and leaves the switch off");
  const ok = sb.v2dbEnableFunctionTimer();
  assert(/first tick/.test(ok) && w.sb.flagGet_("V2_FN_TIMER") === "on" && w.store["_system/props"].fields.V2_FN_TIMER === "on", "otherwise it switches on and copies the switch to the new server");
}

console.log("\n--- 8. A failing run is retried at most 3 times, then waits for the next full look ---");
{
  const w = build(); seed(w); const sb = w.sb;
  sb.v2dbRun_(OWNER, function(db){ db.getSheetByName("Transactions").appendRow(w.row(94, 121212, "Shop J", "")); }, { prefetch: ["Transactions", "_Props"] });
  asNewServer(w);
  sb.processNewTransactions = function(){ throw new Error("always fails"); };
  sb.timerMarkDirty_();
  let thrown = 0;
  for(let i = 0; i < 3; i++){ tick(); try{ sb.timerTick_(); }catch(e){ thrown++; } }
  assert(thrown === 3 && Number(timerDoc(w).failCount) === 3 && w.errors("TIMER_RUN_FAILED").length === 3, "three failed runs are counted and logged");
  tick();
  const r = sb.timerTick_();
  assert(r.ran === false && /backing off/.test(r.reason), "then it stops retrying every tick (no database reads burned)");
  w.store["_system/timer"].fields.failAtMs = Date.now() - 31 * 60 * 1000;
  let again = false; try{ sb.timerTick_(); }catch(e){ again = true; }
  assert(again, "after the next full-look interval it tries again");
}

console.log("\n--- 9. App saves tell the new server's timer that the Home copy is stale ---");
{
  const fs = require("fs"), path = require("path");
  const w = build(); seed(w); const sb = w.sb;
  require("vm").runInContext(fs.readFileSync(path.join(__dirname, "..", "viewPublisher.js"), "utf8"), sb);        // the real publishAfterAction_ (the test world stubs it)
  const resp = { getContent: function(){ return '{"ok":true}'; } };
  sb.publishAfterAction_("saveNote", resp);
  assert(!timerDoc(w), "switch OFF: a save marks nothing (exactly as before)");
  w.sb.flagsSet_({ V2_FN_TIMER: "on" });
  sb.publishAfterAction_("saveNote", resp);
  assert(timerDoc(w) && Number(timerDoc(w).dirtyAtMs) > 0, "switch ON: a successful save marks 'something changed'");
  const d = timerDoc(w).dirtyAtMs; tick();
  sb.publishAfterAction_("getPending", resp);
  sb.publishAfterAction_("saveNote", { getContent: function(){ return '{"ok":false}'; } });
  assert(timerDoc(w).dirtyAtMs === d, "a read, or a save that failed, marks nothing");
}

console.log("\n--- 10. The four daily jobs run from the tick: once a day, at their time, with catch-up ---");
{
  const w = build(); seed(w); const sb = w.sb;
  asNewServer(w);
  const ran = [];
  ["checkUpcomingObligations", "checkDebtDueDates", "checkAppHealth", "sendDailyCashCheckin"].forEach(function(n){ sb[n] = function(){ ran.push(n); }; });
  let clock = { date: "2026-10-15", minutes: 8 * 60 };
  sb.timerIstClock_ = function(){ return clock; };
  tick(); sb.timerTick_();                                                        // first tick: a full look (never looked) but no daily job yet
  assert(ran.length === 0, "08:00: nothing is due yet");
  const commits0 = w.commits;
  clock = { date: "2026-10-15", minutes: 8 * 60 + 31 }; tick();
  const r1 = sb.timerTick_();
  assert(ran.join() === "checkUpcomingObligations" && r1.daily.join() === "obligations", "08:31: the Rent/EMI reminder runs");
  assert(timerDoc(w).daily_obligations === "2026-10-15", "and today's date is recorded for it");
  tick(); sb.timerTick_();
  assert(ran.length === 1, "the next tick does not run it again");
  clock = { date: "2026-10-15", minutes: 9 * 60 + 5 }; tick(); sb.timerTick_();
  assert(ran.join() === "checkUpcomingObligations,checkDebtDueDates", "09:05: debt due dates");
  clock = { date: "2026-10-15", minutes: 9 * 60 + 40 }; tick(); sb.timerTick_();
  assert(ran.slice(-1)[0] === "checkAppHealth", "09:40: the app health check");
  clock = { date: "2026-10-15", minutes: 20 * 60 + 2 }; tick(); sb.timerTick_();
  assert(ran.slice(-1)[0] === "sendDailyCashCheckin" && ran.length === 4, "20:02: the cash check-in; each of the four ran exactly once today");
  tick(); sb.timerTick_(); tick(); sb.timerTick_();
  assert(ran.length === 4, "more ticks the same day run nothing more");
  clock = { date: "2026-10-16", minutes: 9 * 60 + 10 }; tick(); sb.timerTick_();
  assert(ran.slice(4).join() === "checkUpcomingObligations,checkDebtDueDates", "the next day at 09:10 the two jobs whose time has passed run again (health and cash wait for their time)");
}

console.log("\n--- 10b. Catch-up after downtime, and one failing job does not stop the others ---");
{
  const w = build(); seed(w); const sb = w.sb;
  asNewServer(w);
  const ran = [];
  ["checkUpcomingObligations", "checkAppHealth", "sendDailyCashCheckin"].forEach(function(n){ sb[n] = function(){ ran.push(n); }; });
  sb.checkDebtDueDates = function(){ throw new Error("debts exploded"); };
  sb.timerIstClock_ = function(){ return { date: "2026-10-15", minutes: 21 * 60 }; };        // the server was down all day: first tick at 21:00
  const r = sb.timerTick_();
  assert(ran.join() === "checkUpcomingObligations,checkAppHealth,sendDailyCashCheckin", "all the jobs that were missed run, in order; the failing one does not stop the rest");
  assert(w.errors("DAILY_JOB_FAILED").length === 1 && /debts exploded/.test(w.errors("DAILY_JOB_FAILED")[0][2]), "the failure is logged");
  assert(timerDoc(w).daily_debts === "2026-10-15", "and a failed job still counts as today's run (it cannot repeat every 5 minutes)");
  tick();
  assert(sb.timerTick_().ran === false && ran.length === 3, "nothing runs again");
}

console.log("\n--- 11. The Apps Script versions step aside only while the new server is alive ---");
{
  const mk = function(heartbeatAgoMs, dailyDone){
    const w = build(); seed(w); w.sb.flagsSet_({ V2_FN_TIMER: "on" });
    const fields = {}; if(heartbeatAgoMs !== null) fields.tickAtMs = Date.now() - heartbeatAgoMs; if(dailyDone) fields.daily_cash = dailyDone;
    if(Object.keys(fields).length) w.store["_system/timer"] = { fields: fields, updateTime: "t0" };
    w.sb.timerIstClock_ = function(){ return { date: "2026-10-15", minutes: 20 * 60 + 30 }; };
    w.sent = []; w.sb.sendMessage = function(t){ w.sent.push(t); };
    return w;
  };
  const off = build(); seed(off);
  assert(off.sb.timerDailySkip_("cash") === false, "switch OFF: never skips (Apps Script does the job exactly as before)");
  const alive = mk(60 * 1000, null);
  assert(alive.sb.timerDailySkip_("cash") === true, "new server alive (heartbeat 1 minute old): Apps Script skips");
  alive.sb.sendDailyCashCheckin();
  assert(alive.sent.length === 0, "so the Apps Script cash check-in sends nothing");
  const dead = mk(20 * 60 * 1000, null);
  assert(dead.sb.timerDailySkip_("cash") === false && dead.store["_system/timer"].fields.daily_cash === "2026-10-15", "new server silent for 20 minutes: Apps Script runs it AND marks the day done");
  const done = mk(20 * 60 * 1000, "2026-10-15");
  assert(done.sb.timerDailySkip_("cash") === true, "already done today by someone: skip");
  const nobeat = mk(null, null);
  assert(nobeat.sb.timerDailySkip_("cash") === false, "no heartbeat ever: Apps Script runs it");
  const dead2 = mk(20 * 60 * 1000, null);
  dead2.sb.sendDailyCashCheckin();
  assert(dead2.sent.length === 1 && dead2.store["_system/timer"].fields.daily_cash === "2026-10-15", "and the Apps Script cash check-in really sends once (through the owner's private copy) and marks the day");
  dead2.sb.sendDailyCashCheckin();
  assert(dead2.sent.length === 1, "a second call the same day sends nothing more");
  const noOwner = mk(60 * 1000, null); noOwner.sb.v2dbDisableOwner();
  assert(noOwner.sb.timerDailySkip_("cash") === false, "owner not on the private copy: never skips");
}

console.log("\n--- 12. The health check does not inspect Apps Script timers on the new server ---");
{
  const w = build(); seed(w); const sb = w.sb;
  asNewServer(w);
  sb.ScriptApp = { getProjectTriggers: function(){ return []; } };               // the new server has none
  const input = sb.loadHealthInputs_();
  assert(input.triggerHandlers === null, "no timers are read there (so no false 'timer missing' alarm)");
  const w2 = build(); seed(w2);
  w2.sb.ScriptApp = { getProjectTriggers: function(){ return [{ getHandlerFunction: function(){ return "processNewTransactions"; } }]; } };
  assert(w2.sb.loadHealthInputs_().triggerHandlers.join() === "processNewTransactions", "on Apps Script it still reads them, as before");
}

console.log("\nDone.");
