// functions/index.js
//
// PLAIN-ENGLISH WHAT THIS IS: the front door of the NEW server (Firebase Cloud Functions). The app sends the same requests it sends to
// Apps Script; this runs the SAME backend code (backend/*.js, copied in at deploy time) next to the database. For now it only answers
// the READ-ONLY screens, plus (since 2026-10-14, only while the owner switches it on) the everyday SAVE actions. Anything else, or a
// problem with a read, gets a "fallback" answer and the app asks Apps Script instead, so nothing can break. See docs/features/cloud-functions.md.

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const path = require("node:path");
const fs = require("node:fs");
const { createRuntime } = require("./runtime/shim");

const ALLOWED_ORIGINS = ["https://ronit6050.github.io"];
// The only actions this server answers (all read-only). Everything else is refused with fallback:true.
const READ_ACTIONS = ["ping", "getMyAccess", "getPending", "getDashboard", "getTodaySummary", "getMonthlyAnalysis", "getCCAdvisor",
  "getDebts", "getCash", "getInvestments", "getInvestmentInstruments", "getSavingsGoals", "getTransactionHistory", "getPlannerData",
  "getSettings", "getPeople", "getPerson"];
// SAVING actions (added 2026-10-14). Accepted ONLY while the owner has switched saving on (Apps Script: v2dbEnableFunctionWrites()),
// and only for people on the Firestore copy. Deliberately NOT here: Reconcile/statement actions (they use the owner's Google Drive),
// Access/admin actions, the SMS doors and the timers - those stay on Apps Script.
const WRITE_ACTIONS = ["saveNote", "markNotATransaction", "addDebt", "settleDebt", "recordDebtPayment",
  "saveSavingsAuto", "saveSavingsManual", "withdrawSavings", "updateSavingsEntry", "deleteSavingsEntry", "addSavingsGoal",
  "setPrioritySavingsGoal", "markSavingsGoalDone", "purchaseSavingsGoal", "addInvestmentInstrument", "logInvestment", "updateInvestment",
  "addCashEntry", "addManualTransaction", "updateCashEntry", "updateSettings", "saveBudgets", "registerPushToken",
  "addFriend", "createSplit", "recordSplitPayment", "undoSplitEntry", "refreshViews"];
// Answers that never change anything but were not on the read list at first.
const EXTRA_READ_ACTIONS = ["previewSavingsSplit", "pushTest"];   // pushTest: owner-only, sends ONE test notification to his own phone
const MAX_BODY_BYTES = 200000;

let runtime = null;     // built once per server instance (the backend code is loaded then, not on every request)

function getRuntime(){
  if(!runtime){
    const copied = path.join(__dirname, "backend");                       // put here by scripts/copy-backend.js at deploy time
    runtime = createRuntime({ backendDir: fs.existsSync(copied) ? copied : path.join(__dirname, "..", "backend") });
  }
  return runtime;
}

function setCors(req, res){
  const origin = req.get("origin");
  if(origin && ALLOWED_ORIGINS.indexOf(origin) !== -1){
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

exports.api = onRequest({
  region: "asia-south1",          // next to the Firestore database (Mumbai)
  memory: "512MiB",
  timeoutSeconds: 60,
  concurrency: 1,                 // the backend code waits for each network call, so one request at a time per instance
  maxInstances: 10,               // the app sends several requests at once when it opens; 3 left some turned away (HTTP 429)
  minInstances: 0,                // 0 = free when idle; the first request after a quiet spell is a little slower
  cors: false                     // handled by hand above (only the app's own web address)
}, function(req, res){
  setCors(req, res);
  if(req.method === "OPTIONS"){ res.status(204).send(""); return; }
  if(req.method !== "POST"){ res.status(405).json({ ok: false, error: "POST only." }); return; }

  let data;
  try{
    const raw = req.rawBody ? req.rawBody.toString("utf8") : (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));
    if(raw.length > MAX_BODY_BYTES){ res.status(413).json({ ok: false, fallback: true, error: "Too large." }); return; }
    data = JSON.parse(raw);
  }catch(e){
    res.status(200).json({ ok: false, fallback: true, error: "Unreadable request." });
    return;
  }

  const action = data ? String(data.action) : "";
  // THE SMS DOOR (added 2026-10-14): a phone sends a raw bank SMS + its private key (no Google sign-in: the key is the credential, exactly as on
  // Apps Script). Only while the owner has switched it on. Any answer except {"ok":true} makes the phone carry on with its old chain, and the
  // same message arriving twice is caught by the duplicate rules, so a failure or a timeout here can never lose or double a message.
  if(action === "smsIn"){
    try{
      const rt = getRuntime();
      if(!rt.smsEnabled() || !rt.writesEnabled()){ res.status(200).json({ ok: false, fallback: true, error: "Use the old path." }); return; }
      res.status(200).json(rt.call(data));
    }catch(err){
      console.error(JSON.stringify({ severity: "ERROR", type: "FUNCTION_ERROR", action: action, message: String(err && err.message).slice(0, 300) }));
      res.status(200).json({ ok: false, error: "Try again." });
    }
    return;
  }
  const isWrite = WRITE_ACTIONS.indexOf(action) !== -1;
  if(!data || (!isWrite && READ_ACTIONS.indexOf(action) === -1 && EXTRA_READ_ACTIONS.indexOf(action) === -1)){
    res.status(200).json({ ok: false, fallback: true, error: "Not available on the new server yet." });
    return;
  }

  try{
    const rt = getRuntime();
    // fallback:true means "NOTHING was done here, ask Apps Script": safe to repeat there. Saving is off unless the owner turned it on.
    if(isWrite && !rt.writesEnabled()){
      res.status(200).json({ ok: false, fallback: true, error: "Saving is not switched on for the new server." });
      return;
    }
    res.status(200).json(rt.call(data));
  }catch(err){
    console.error(JSON.stringify({ severity: "ERROR", type: "FUNCTION_ERROR", action: action, message: String(err && err.message).slice(0, 300) }));
    // For a SAVE we cannot be sure nothing was written, so never tell the app to repeat it elsewhere (that could save it twice).
    if(isWrite) res.status(200).json({ ok: false, error: "Couldn't complete that. Check it before trying again." });
    else res.status(200).json({ ok: false, fallback: true, error: "The new server hit a problem." });
  }
});

// THE ALERT TIMER (added 2026-10-14). Cloud Scheduler calls this every 5 minutes. It does NOTHING unless the owner switched the new-server
// timer on (Apps Script: v2dbEnableFunctionTimer) - then a quiet tick costs one tiny Firestore read and the real work (alerts, auto-settle,
// Home copy) only runs when something changed or every 30 minutes. See backend/fnTimer.js. One instance at a time (two overlapping ticks could
// announce a transaction twice; the shared save lock would also serialise them, this just avoids the wait).
exports.tick = onSchedule({
  schedule: "every 5 minutes",
  timeZone: "Asia/Kolkata",
  region: "asia-south1",
  memory: "512MiB",
  timeoutSeconds: 300,                  // a run that is killed before it saves would announce the same transactions again next tick: give it room
  maxInstances: 1,
  retryCount: 0
}, function(){
  try{
    const result = getRuntime().runTimer();
    console.log(JSON.stringify({ type: "TICK", ran: !!result.ran, reason: result.reason || result.why || "" }));
  }catch(err){
    console.error(JSON.stringify({ severity: "ERROR", type: "TICK_ERROR", message: String(err && err.message).slice(0, 300) }));
  }
});
