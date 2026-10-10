// appHealth.js (added 2026-10-10)
//
// PLAIN-ENGLISH WHAT THIS IS: a once-a-day self-check that tells you ONLY
// when something is wrong - and stays completely silent when everything
// is fine. It exists because of what happened in August 2026: Google
// quietly stopped running the app's background timer, and nothing in the
// app noticed - new transactions just stopped appearing until someone
// went looking.
//
// IT CHECKS FOUR THINGS:
//   1. TIMERS  - are all the app's scheduled jobs still set up?
//   2. STUCK   - any transaction from the last 7 days that arrived more
//                than an hour ago but was never alerted/processed?
//                (Old rows that have been stuck for months are ignored
//                on purpose - they would fire every single day.)
//   3. SILENCE - no new bank transaction at all for 3+ days (the phone's
//                Tasker app may have stopped forwarding SMS)?
//   4. ERRORS  - did the app write any of its own error entries to the
//                AILogs sheet in the last 24 hours?
// If anything is wrong you get ONE push listing every current problem.
// The same problem is never announced twice on the same day (remembered
// in Script Properties), so running this twice does nothing extra.
//
// ADD A MANUAL TRIGGER FOR THIS - this project never creates triggers
// from code. Apps Script editor -> clock icon (Triggers) -> Add Trigger:
//   function: checkAppHealth | deployment: Head | event source:
//   Time-driven | type: Day timer | time: 9am to 10am.
//
// HONEST LIMIT: if Google revokes the script's permissions entirely, this
// function stops running too (it lives under the same permission). It
// catches a missing timer, stuck rows, silence and logged errors - not a
// total authorization loss. The "no new transactions for 3 days" check is
// the backstop for that case, but it can only be reported on a day this
// function still runs.

var HEALTH_EXPECTED_TRIGGERS = [
  "processNewTransactions", "checkDebtDueDates", "sendDailyCashCheckin",
  "checkUpcomingObligations", "checkAppHealth"
];
var HEALTH_STUCK_ROW_WINDOW_DAYS   = 7;   // only look at rows dated within this many days
var HEALTH_STUCK_ROW_GRACE_MINUTES = 60;  // a row younger than this is simply "not processed yet"
var HEALTH_NO_NEW_TXN_DAYS         = 3;   // silence longer than this = problem
var HEALTH_ERROR_WINDOW_HOURS      = 24;
var HEALTH_ERROR_LOG_TYPES = [
  "PUSH_ERROR", "PUSH_TOKEN_ERROR", "PROCESS_TXN_ERROR", "AUTO_SETTLE_ERROR",
  "UPCOMING_OBLIGATION_ERROR", "DEBT_TRAJECTORY_LOG_ERROR"
];
var HEALTH_PROP_PREFIX = "HEALTH_REPORTED_"; // + problemKey + "_" + yyyy-MM-dd

// How many rows from the bottom of each sheet to read (keeps the daily
// check fast; 7 days of transactions / 24 hours of logs are far smaller).
var HEALTH_TXN_ROWS_TO_READ = 500;
var HEALTH_LOG_ROWS_TO_READ = 3000;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function healthIsDate_(v){
  return Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime());
}

// A sheet cell's date as a Date (accepts a real Date or "yyyy-mm-dd..." text).
function healthToDate_(v){
  if(healthIsDate_(v)) return v;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec((v || "").toString().trim());
  if(m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

// Hour/minute from a Time cell (Sheets gives a Date on 30 Dec 1899) or
// from "HH:mm[:ss]" text. null if unreadable.
function healthTimeParts_(v){
  var text = null;
  if(healthIsDate_(v)){
    text = Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");
  } else {
    text = (v || "").toString().trim();
  }
  var m = /^(\d{1,2}):(\d{2})/.exec(text);
  if(!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

// The moment a Transactions row happened (date + time). If the time is
// unreadable the END of that day is used, so a vague row looks as recent
// as possible and can't cause a false alarm.
function healthRowMoment_(dateVal, timeVal){
  var d = healthToDate_(dateVal);
  if(!d) return null;
  var t = healthTimeParts_(timeVal);
  var h = t ? t.h : 23, mi = t ? t.m : 59;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, 0);
}

// ---------------------------------------------------------------------
// The checks - a PURE function (no sheets, no pushes), so it can be
// tested directly with plain data. Returns a list of
//   { key, text }  - one per current problem, in plain English.
// input: { now: Date, triggerHandlers: [string] | null,
//          txnRows: [[A..P values]], ailogRows: [[timestamp, type, message]] }
// ---------------------------------------------------------------------
function computeHealthProblems_(input){
  var problems = [];
  var now = input.now;
  var DAY = 24 * 60 * 60 * 1000;

  // 1. Missing timers
  if(input.triggerHandlers){
    var missing = HEALTH_EXPECTED_TRIGGERS.filter(function(name){
      return input.triggerHandlers.indexOf(name) === -1;
    });
    if(missing.length){
      problems.push({
        key: "triggers",
        text: "Scheduled job(s) missing: " + missing.join(", ") +
          ". Re-add them under Triggers in the Apps Script editor."
      });
    }
  }

  // 2 + 3. Transactions: stuck rows, and silence
  var txnRows = input.txnRows || [];
  var stuck = 0;
  var newest = null;
  var stuckWindowStart = now.getTime() - HEALTH_STUCK_ROW_WINDOW_DAYS * DAY;
  var stuckCutoff      = now.getTime() - HEALTH_STUCK_ROW_GRACE_MINUTES * 60 * 1000;
  txnRows.forEach(function(r){
    var moment = healthRowMoment_(r[0], r[1]);
    if(!moment) return;
    var hasContent = (r[5] !== "" && r[5] != null) || (r[7] || "").toString().trim() !== "";
    if(!hasContent) return;

    var processed = (r[15] || "").toString().trim();
    var t = moment.getTime();
    if(processed === "" && t >= stuckWindowStart && t <= stuckCutoff) stuck++;

    // "Newest bank transaction" ignores statement imports (those are
    // back-dated by hand, not Tasker traffic) and absurd future dates.
    var channel = (r[8] || "").toString().trim().toLowerCase();
    if(channel !== "import" && t <= now.getTime() + DAY){
      if(newest === null || t > newest) newest = t;
    }
  });

  if(stuck > 0){
    problems.push({
      key: "stuck",
      text: stuck + " transaction(s) from the last " + HEALTH_STUCK_ROW_WINDOW_DAYS +
        " days were never processed (no alert sent). The background timer may not be running."
    });
  }

  if(newest === null){
    problems.push({ key: "silent", text: "No bank transactions found in the Transactions sheet at all." });
  } else {
    var silentDays = (now.getTime() - newest) / DAY;
    if(silentDays >= HEALTH_NO_NEW_TXN_DAYS){
      problems.push({
        key: "silent",
        text: "No new bank transaction for " + Math.floor(silentDays) +
          " days. Tasker on the phone may have stopped forwarding SMS."
      });
    }
  }

  // 4. Recent errors in AILogs
  var windowStart = now.getTime() - HEALTH_ERROR_WINDOW_HOURS * 60 * 60 * 1000;
  var counts = {};
  (input.ailogRows || []).forEach(function(r){
    var ts = healthIsDate_(r[0]) ? r[0] : null;
    if(!ts) return;
    if(ts.getTime() < windowStart || ts.getTime() > now.getTime() + 60 * 1000) return;
    var type = (r[1] || "").toString().trim();
    if(HEALTH_ERROR_LOG_TYPES.indexOf(type) === -1) return;
    counts[type] = (counts[type] || 0) + 1;
  });
  var errorTypes = Object.keys(counts);
  if(errorTypes.length){
    problems.push({
      key: "errors",
      text: "The app logged errors in the last 24 hours: " +
        errorTypes.map(function(t){ return t + " x" + counts[t]; }).join(", ") +
        ". Check the AILogs sheet."
    });
  }

  return problems;
}

// Reads the real sheets/timers into the shape computeHealthProblems_ wants.
function loadHealthInputs_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var triggerHandlers = null;
  try{
    triggerHandlers = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); });
  }catch(err){
    logAI("HEALTH_CHECK_NOTE", "Could not read triggers: " + err.toString());
  }

  var readTail = function(sheetName, cols, maxRows){
    var sh = ss.getSheetByName(sheetName);
    if(!sh) return [];
    var last = sh.getLastRow();
    if(last < 2) return [];
    var start = Math.max(2, last - maxRows + 1);
    return sh.getRange(start, 1, last - start + 1, cols).getValues();
  };

  return {
    now: new Date(),
    triggerHandlers: triggerHandlers,
    txnRows: readTail("Transactions", 16, HEALTH_TXN_ROWS_TO_READ),
    ailogRows: readTail("AILogs", 3, HEALTH_LOG_ROWS_TO_READ)
  };
}

function healthMessage_(problems){
  return "App health: " + problems.length + " problem" + (problems.length === 1 ? "" : "s") + "\n" +
    problems.map(function(p){ return "- " + p.text; }).join("\n");
}

// ---------------------------------------------------------------------
// The scheduled function. Silent when healthy. Never throws.
// ---------------------------------------------------------------------
function checkAppHealth(){
  try{
    var problems = computeHealthProblems_(loadHealthInputs_());
    if(problems.length === 0) return { problems: [], sent: false };

    var props = PropertiesService.getScriptProperties();
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var keyFor = function(p){ return HEALTH_PROP_PREFIX + p.key + "_" + today; };

    // Housekeeping: forget yesterday's (and older) "already reported" notes.
    try{
      var all = props.getProperties();
      Object.keys(all).forEach(function(k){
        if(k.indexOf(HEALTH_PROP_PREFIX) === 0 && k.slice(-10) !== today) props.deleteProperty(k);
      });
    }catch(e1){ /* housekeeping only */ }

    var anyNew = problems.some(function(p){ return !props.getProperty(keyFor(p)); });
    if(!anyNew) return { problems: problems, sent: false }; // all already reported today

    var message = healthMessage_(problems);
    sendMessage(message); // one combined push
    problems.forEach(function(p){ props.setProperty(keyFor(p), "1"); });
    logAI("HEALTH_ALERT", message.replace(/\n/g, " | "));
    return { problems: problems, sent: true };
  }catch(err){
    logAI("HEALTH_CHECK_ERROR", err.toString());
    return { problems: [], sent: false, error: err.toString() };
  }
}

// Hand-run dry run: prints what checkAppHealth() would decide right now.
// Sends NO push and writes NOTHING (no logs, no Script Properties).
function testCheckAppHealth(){
  var out = [];
  var log = function(s){ out.push(s); Logger.log(s); };
  try{
    var problems = computeHealthProblems_(loadHealthInputs_());
    log("===== APP HEALTH (dry run - nothing sent, nothing saved) =====");
    if(problems.length === 0){
      log("Everything looks healthy - the real check would stay completely silent.");
    } else {
      problems.forEach(function(p){ log("- [" + p.key + "] " + p.text); });
      log("");
      log("The real check would send ONE push like this:");
      log(healthMessage_(problems));
    }
  }catch(err){
    log("The check itself failed: " + err.toString());
  }
  return out.join("\n");
}
