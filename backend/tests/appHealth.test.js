// backend/tests/appHealth.test.js
//
// Plain-English what this checks: the daily self-check (backend/appHealth.js,
// added 2026-10-10) that sends ONE push only when something is wrong and is
// completely silent when the app is healthy. Covers each of the four
// problems, the silent-when-healthy case, the "old rows stuck for months must
// NOT fire" case, one combined push, and running it twice never
// double-sending. ALL DATA INVENTED (this repo is public).
//
// Run with: node backend/tests/appHealth.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = ["Logger.js", "appHealth.js"];
const ALL_TRIGGERS = ["processNewTransactions", "checkDebtDueDates", "sendDailyCashCheckin", "checkUpcomingObligations", "checkAppHealth"];
const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source","RawSMS","Sender","Note","Category","TelegramMsgID","Processed"];

// "now" for every test: a fixed moment, 10 Oct 2026 09:00.
const NOW = new Date(2026, 9, 10, 9, 0, 0);
function ago(ms){ return new Date(NOW.getTime() - ms); }
const HOUR = 3600000, DAY = 24 * HOUR;

// A Transactions row happening `ageMs` before NOW.
function row(ageMs, processed, extra){
  const m = ago(ageMs);
  const dateOnly = new Date(m.getFullYear(), m.getMonth(), m.getDate());
  const timeText = String(m.getHours()).padStart(2, "0") + ":" + String(m.getMinutes()).padStart(2, "0") + ":00";
  const r = [dateOnly, timeText, "HDFC", "debit", "upi", 100, "ref", "somewhere", "SMS", "Tasker", "raw", "S", "", "", "", processed];
  if(extra && extra.channel) r[8] = extra.channel;
  return r;
}

function world(txnRows, ailogRows, triggers){
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [TXN_HEADER].concat(txnRows));
  w.addSheet("AILogs", [["Timestamp","Type","Message"]].concat(ailogRows || []));
  w.sb.ScriptApp._handlers = triggers || ALL_TRIGGERS.slice();
  // The real checkAppHealth uses "now" = new Date(); pin it to NOW for the test.
  const RealDate = Date;
  w.sb.Date = class extends RealDate {
    constructor(...a){ if(a.length === 0) super(NOW.getTime()); else super(...a); }
    static now(){ return NOW.getTime(); }
  };
  return w;
}

// Recent healthy traffic: processed rows from the last two days.
const healthyRows = function(){ return [row(2 * DAY, "YES"), row(5 * HOUR, "YES"), row(30 * 60000, "")]; }; // last one is only 30 min old: still within grace

console.log("\n--- 1. Healthy: nothing to report, nothing sent ---");
{
  const w = world(healthyRows(), []);
  const res = w.sb.checkAppHealth();
  assert(res.problems.length === 0 && !res.sent, "no problems");
  assert(w.messages.length === 0 && w.pushes.length === 0, "no push at all");
  assert(Object.keys(w.props).length === 0, "nothing written to Script Properties");
  assert(w.sheets.AILogs.rows.length === 1, "nothing written to AILogs either (silent)");
  const dry = w.sb.testCheckAppHealth();
  assert(/healthy/.test(dry), "dry run says healthy");
}

console.log("\n--- 2. Missing timers ---");
{
  const w = world(healthyRows(), [], ["processNewTransactions", "sendDailyCashCheckin"]);
  const res = w.sb.checkAppHealth();
  assert(res.sent && w.messages.length === 1, "one push sent");
  const m = w.messages[0];
  assert(/checkDebtDueDates/.test(m) && /checkUpcomingObligations/.test(m) && /checkAppHealth/.test(m), "names every missing timer");
  assert(!/processNewTransactions,/.test(m) && !/missing: processNewTransactions/.test(m), "does not name timers that exist");
}

console.log("\n--- 3. Stuck rows (recent + unprocessed > 1 hour) ---");
{
  const w = world(healthyRows().concat([row(3 * HOUR, ""), row(2 * DAY, "")]), []);
  const res = w.sb.checkAppHealth();
  assert(res.sent && /2 transaction\(s\)/.test(w.messages[0]), "counts the 2 stuck rows (a 3-hour-old and a 2-day-old)");
}

console.log("\n--- 4. OLD stuck rows (months old) must NOT fire ---");
{
  const old = [row(150 * DAY, ""), row(150 * DAY, ""), row(36 * DAY, ""), row(34 * DAY, ""), row(8 * DAY, "")];
  const w = world(old.concat(healthyRows()), []);
  const res = w.sb.checkAppHealth();
  assert(!res.sent && res.problems.length === 0, "five old unprocessed rows (8 to 150 days old) cause no alert");
  // ...and an IGNORED tombstone is not 'stuck' either
  const w2 = world(healthyRows().concat([row(3 * HOUR, "IGNORED")]), []);
  assert(!w2.sb.checkAppHealth().sent, "IGNORED rows are not stuck");
  // the exact boundary: 59 minutes is still within the grace period
  const w3 = world(healthyRows().concat([row(59 * 60000, "")]), []);
  assert(!w3.sb.checkAppHealth().sent, "a 59-minute-old unprocessed row is not stuck yet");
}

console.log("\n--- 5. Silence: no new bank transaction for 3+ days ---");
{
  const w = world([row(3.5 * DAY, "YES"), row(10 * DAY, "YES")], []);
  const res = w.sb.checkAppHealth();
  assert(res.sent && /No new bank transaction for 3 days/.test(w.messages[0]), "reports 3 days of silence");
  const w2 = world([row(2.5 * DAY, "YES")], []);
  assert(!w2.sb.checkAppHealth().sent, "2.5 days is below the threshold");
  // a back-dated statement import does not count as fresh Tasker traffic
  const w3 = world([row(5 * DAY, "YES"), row(10 * 60000, "YES", { channel: "Import" })], []);
  assert(w3.sb.checkAppHealth().sent, "a fresh 'Import' row does not hide the silence");
  assert(w.sb.HEALTH_NO_NEW_TXN_DAYS === 3, "threshold is the named constant HEALTH_NO_NEW_TXN_DAYS = 3");
}

console.log("\n--- 6. Errors in AILogs in the last 24 hours ---");
{
  const logs = [
    [ago(2 * HOUR), "PUSH_ERROR", "boom"],
    [ago(3 * HOUR), "PUSH_ERROR", "boom again"],
    [ago(5 * HOUR), "AUTO_SETTLE_ERROR", "x"],
    [ago(30 * HOUR), "PROCESS_TXN_ERROR", "too old - must be ignored"],
    [ago(1 * HOUR), "PUSH_SENT", "fine"],
    [ago(1 * HOUR), "CATEGORY_CORRECTED", "fine"]
  ];
  const w = world(healthyRows(), logs);
  const res = w.sb.checkAppHealth();
  const m = w.messages[0] || "";
  assert(res.sent && /PUSH_ERROR x2/.test(m) && /AUTO_SETTLE_ERROR x1/.test(m), "names error types with counts");
  assert(!/PROCESS_TXN_ERROR/.test(m) && !/PUSH_SENT/.test(m) && !/CATEGORY_CORRECTED/.test(m), "ignores old errors and normal log entries");
  ["PUSH_TOKEN_ERROR", "PROCESS_TXN_ERROR", "UPCOMING_OBLIGATION_ERROR", "DEBT_TRAJECTORY_LOG_ERROR"].forEach(function(t){
    const w2 = world(healthyRows(), [[ago(HOUR), t, "x"]]);
    assert(w2.sb.checkAppHealth().sent, t + " is detected");
  });
}

console.log("\n--- 7. Several problems -> ONE combined push ---");
{
  const w = world([row(4 * DAY, "")], [[ago(HOUR), "PUSH_ERROR", "x"]], ["processNewTransactions"]);
  w.sb.checkAppHealth();
  assert(w.messages.length === 1, "exactly one push for four problems");
  assert(/4 problems/.test(w.messages[0]), "title counts the problems");
  assert(/Scheduled job/.test(w.messages[0]) && /never processed/.test(w.messages[0]) && /No new bank transaction/.test(w.messages[0]) && /logged errors/.test(w.messages[0]), "all four are listed");
}

console.log("\n--- 8. Idempotent: running twice on the same day never double-sends ---");
{
  const w = world(healthyRows(), [[ago(HOUR), "PUSH_ERROR", "x"]]);
  w.sb.checkAppHealth();
  const second = w.sb.checkAppHealth();
  assert(w.messages.length === 1 && !second.sent, "second run is silent");
  // a NEW problem later the same day is announced (listing all current ones)
  w.sb.ScriptApp._handlers = ["processNewTransactions"];
  w.sb.checkAppHealth();
  assert(w.messages.length === 2, "a newly appearing problem is announced");
  w.sb.checkAppHealth();
  assert(w.messages.length === 2, "...once");
  // next day: reported again, and yesterday's remembered keys are tidied
  const keysBefore = Object.keys(w.props).filter(function(k){ return k.indexOf("HEALTH_REPORTED_") === 0; });
  assert(keysBefore.length === 2 && keysBefore.every(function(k){ return /2026-10-10$/.test(k); }), "keys are per problem + date");
  const NEXT = new Date(2026, 9, 11, 9, 0, 0);
  const RealDate = Date;
  w.sb.Date = class extends RealDate { constructor(...a){ if(a.length === 0) super(NEXT.getTime()); else super(...a); } static now(){ return NEXT.getTime(); } };
  w.sheets.Transactions.rows.push(row(0, "YES").map(function(v, i){ return i === 0 ? new Date(2026, 9, 11) : v; })); // keep traffic fresh
  w.sheets.AILogs.rows.push([new Date(2026, 9, 11, 8, 0, 0), "PUSH_ERROR", "still"]);
  w.sb.checkAppHealth();
  assert(w.messages.length === 3, "the next day's run reports again");
  const keysAfter = Object.keys(w.props).filter(function(k){ return k.indexOf("HEALTH_REPORTED_") === 0; });
  assert(keysAfter.every(function(k){ return /2026-10-11$/.test(k); }), "yesterday's remembered keys were cleaned up");
}

console.log("\n--- 9. Never throws ---");
{
  const w = world([], []);
  delete w.sheets.Transactions; delete w.sheets.AILogs;
  let threw = false; let res;
  try { res = w.sb.checkAppHealth(); } catch(e){ threw = true; }
  assert(!threw, "missing sheets do not throw");
  const w2 = world(healthyRows(), []);
  w2.sb.ScriptApp.getProjectTriggers = function(){ throw new Error("no permission"); };
  threw = false;
  try { w2.sb.checkAppHealth(); w2.sb.testCheckAppHealth(); } catch(e){ threw = true; }
  assert(!threw, "unreadable triggers do not throw");
}

console.log("\n--- 10. Dry run sends and saves nothing, even with problems ---");
{
  const w = world([row(4 * DAY, "YES")], [[ago(HOUR), "PUSH_ERROR", "x"]], []);
  const out = w.sb.testCheckAppHealth();
  assert(/would send ONE push/.test(out), "describes the push it would send");
  assert(w.messages.length === 0 && Object.keys(w.props).length === 0 && w.sheets.AILogs.rows.length === 2, "nothing sent, nothing stored");
}

console.log("\nDone.");
