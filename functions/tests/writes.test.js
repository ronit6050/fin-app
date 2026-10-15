// functions/tests/writes.test.js
//
// Plain-English what this checks: the new server's front door (functions/index.js) for SAVING actions.
//   - While the owner has NOT switched saving on, every save is refused with "fallback" (the app then asks Apps Script) and the backend
//     code is not even called.
//   - Once switched on, the everyday saves go through the backend code; reads are unchanged.
//   - Things that must stay on Apps Script (statement upload/Reconcile, Access/admin, SMS doors) are refused with "fallback" even when on.
//   - If something goes wrong DURING a save, the app is never told to repeat it elsewhere (that could save it twice); a failed READ still
//     falls back as before.
// No network, no Firebase. Run with: node functions/tests/writes.test.js

const Module = require("node:module");
const path = require("node:path");

let failures = 0;
function assert(cond, msg){
  if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

// ---- load index.js with the Firebase wrapper and the runtime replaced by fakes ----
const state = { writesOn: false, smsOn: false, calls: [], throwOn: null, timer: null, timerThrows: false, schedulerOpts: null };
const fakeRuntime = {
  writesEnabled: function(){ return state.writesOn; },
  smsEnabled: function(){ return state.smsOn; },
  runTimer: function(){ if(state.timerThrows) throw new Error("tick boom"); state.timer = (state.timer || 0) + 1; return { ran: true, why: "test" }; },
  call: function(data){ state.calls.push(data.action); if(state.throwOn === data.action) throw new Error("boom"); return { ok: true, echoed: data.action }; }
};
const realLoad = Module._load;
Module._load = function(request, parent, isMain){
  if(request === "firebase-functions/v2/https") return { onRequest: function(opts, handler){ return handler; } };
  if(request === "firebase-functions/v2/scheduler") return { onSchedule: function(opts, handler){ state.schedulerOpts = opts; return handler; } };
  if(request === "./runtime/shim") return { createRuntime: function(){ return fakeRuntime; } };
  return realLoad.apply(this, arguments);
};
const exportsOfIndex = require(path.join(__dirname, "..", "index.js"));
const api = exportsOfIndex.api;
const tick = exportsOfIndex.tick;
Module._load = realLoad;

function post(body, extra){
  const req = { method: "POST", rawBody: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)), get: function(){ return (extra && extra.origin) || ""; } };
  let out = { status: 0, json: null, headers: {} };
  const res = {
    set: function(k, v){ out.headers[k] = v; }, status: function(s){ out.status = s; return this; },
    json: function(j){ out.json = j; return this; }, send: function(){ return this; }
  };
  api(req, res);
  return out;
}

console.log("\n--- 1. Saving switched OFF (the default) ---");
{
  state.writesOn = false; state.calls = [];
  const r = post({ action: "saveNote", idToken: "x" });
  assert(r.json.ok === false && r.json.fallback === true, "a save is refused with fallback (nothing done)");
  assert(state.calls.length === 0, "the backend code was not called at all");
  const rd = post({ action: "getPending", idToken: "x" });
  assert(rd.json.ok === true && state.calls.join() === "getPending", "reads still work exactly as before");
}

console.log("\n--- 2. Saving switched ON ---");
{
  state.writesOn = true; state.calls = [];
  ["saveNote", "markNotATransaction", "addDebt", "settleDebt", "recordDebtPayment", "addCashEntry", "updateCashEntry", "addManualTransaction",
   "logInvestment", "saveSavingsAuto", "withdrawSavings", "updateSettings", "saveBudgets", "registerPushToken", "createSplit",
   "recordSplitPayment", "undoSplitEntry", "addFriend", "refreshViews"].forEach(function(a){
    const r = post({ action: a, idToken: "x" });
    assert(r.json.ok === true && r.json.echoed === a, a + " is saved through the backend code");
  });
  const p = post({ action: "previewSavingsSplit", idToken: "x" });
  assert(p.json.ok === true, "previewSavingsSplit (a read) is answered");
}

console.log("\n--- 3. Always stays on Apps Script ---");
{
  state.writesOn = true; state.calls = [];
  ["setFriendScreen", "getMyIngestKey", "ingestSms", "smsIn",
   "moveDebtToFriend", "teachBank", "removeFriendAccess", "somethingMadeUp"].forEach(function(a){
    const r = post({ action: a, idToken: "x" });
    assert(r.json.ok === false && r.json.fallback === true, a + " -> fallback even with saving on");
  });
  assert(state.calls.length === 0, "none of them reached the backend code");
}

console.log("\n--- 4. A problem DURING a save is never retried elsewhere ---");
{
  state.writesOn = true; state.throwOn = "saveNote"; state.calls = [];
  const origError = console.error; console.error = function(){};
  const w = post({ action: "saveNote", idToken: "x" });
  assert(w.json.ok === false && !w.json.fallback && /Couldn't complete/.test(w.json.error), "a failed save is an error, NOT a fallback (the app must not save it again on Apps Script)");
  state.throwOn = "getPending";
  const r = post({ action: "getPending", idToken: "x" });
  assert(r.json.ok === false && r.json.fallback === true, "a failed READ still falls back to Apps Script");
  console.error = origError; state.throwOn = null;
}

console.log("\n--- 4b. The SMS door (action smsIn, no Google sign-in: the key is the credential) ---");
{
  state.writesOn = true; state.smsOn = false; state.calls = [];
  let r = post({ action: "smsIn", key: "k", sms: "x", sender: "y" });
  assert(r.json.ok === false && r.json.fallback === true && /old path/i.test(r.json.error) && state.calls.length === 0, "switch OFF: 'use the old path' and the backend code is not called");
  state.smsOn = true; state.writesOn = false;
  r = post({ action: "smsIn", key: "k", sms: "x", sender: "y" });
  assert(r.json.ok === false && r.json.fallback === true && state.calls.length === 0, "SMS on but saving off: still 'use the old path' (an SMS is a save)");
  state.smsOn = true; state.writesOn = true;
  r = post({ action: "smsIn", key: "k", sms: "x", sender: "y" });
  assert(r.json.ok === true && state.calls.join() === "smsIn", "both switches on: the message goes through the backend code");
  state.throwOn = "smsIn"; state.calls = [];
  const origError = console.error; console.error = function(){};
  r = post({ action: "smsIn", key: "k", sms: "x", sender: "y" });
  console.error = origError; state.throwOn = null;
  assert(r.json.ok === false && !r.json.fallback && /try again/i.test(r.json.error), "a crash gives a plain 'try again' (the phone then uses its old chain; duplicates are caught there)");
  const ing = post({ action: "ingestSms", key: "k" });
  assert(ing.json.ok === false && ing.json.fallback === true, "the old reader's hand-off action (ingestSms) is NOT served here");
  state.smsOn = false; state.writesOn = true;
}

console.log("\n--- 4d. Reconcile on the new server (statement rows read on the phone) ---");
{
  state.writesOn = true; state.calls = [];
  let r = post({ action: "reconcileStatement", idToken: "x", rows: [["a"]] });
  assert(r.json.ok === true && state.calls.join() === "reconcileStatement", "a bank statement preview WITH rows is answered here");
  r = post({ action: "reconcileCreditCardStatement", idToken: "x", statementText: "01/01/2026 10:00 SHOP 10.00" });
  assert(r.json.ok === true, "a card statement preview with the phone-read text is answered here");
  state.calls = [];
  r = post({ action: "reconcileStatement", idToken: "x", fileBase64: "AAAA", fileName: "s.xls" });
  assert(r.json.ok === false && r.json.fallback === true && state.calls.length === 0, "the raw file alone (no rows) is 'nothing done, ask Apps Script': this server has no Google Drive");
  r = post({ action: "reconcileCreditCardStatement", idToken: "x", fileBase64: "AAAA", fileName: "s.pdf" });
  assert(r.json.ok === false && r.json.fallback === true && state.calls.length === 0, "same for a scanned card PDF that needs the OCR fallback");
  r = post({ action: "insertReconciledTransactions", idToken: "x", transactions: [] });
  assert(r.json.ok === true && state.calls.join() === "insertReconciledTransactions", "saving the approved rows is accepted (while saving is on)");
  state.writesOn = false; state.calls = [];
  r = post({ action: "insertReconciledTransactions", idToken: "x", transactions: [] });
  assert(r.json.fallback === true && state.calls.length === 0, "and refused with fallback while saving is off");
  state.writesOn = true;
}

console.log("\n--- 4c. The scheduled alert timer (tick) and the test notification ---");
{
  assert(state.schedulerOpts && state.schedulerOpts.schedule === "every 5 minutes" && state.schedulerOpts.region === "asia-south1" && state.schedulerOpts.maxInstances === 1,
    "tick is scheduled every 5 minutes, in Mumbai, one instance at a time");
  assert(state.schedulerOpts.retryCount === 0 && state.schedulerOpts.timeZone === "Asia/Kolkata", "no automatic retries (the next tick is the retry), India time");
  tick();
  assert(state.timer === 1, "a tick asks the runtime to run the timer (the runtime itself checks the switch)");
  state.timerThrows = true;
  const origError = console.error; const errors = []; console.error = function(m){ errors.push(m); };
  let threw = false; try{ tick(); }catch(e){ threw = true; }
  console.error = origError; state.timerThrows = false;
  assert(!threw && errors.length === 1 && /TICK_ERROR/.test(errors[0]), "a crash inside a tick is logged as TICK_ERROR and never escapes (the next tick tries again)");
  state.writesOn = true; state.calls = [];
  const t = post({ action: "pushTest", idToken: "x" });
  assert(t.json.ok === true && state.calls.join() === "pushTest", "pushTest (owner-only inside the backend) is answered through the backend code even with saving off or on");
  state.writesOn = false; state.calls = [];
  const t2 = post({ action: "pushTest", idToken: "x" });
  assert(t2.json.ok === true && state.calls.join() === "pushTest", "pushTest also works while saving is off (it only sends one notification)");
  state.writesOn = true;
}

console.log("\n--- 5. Housekeeping ---");
{
  const bad = post("not json");
  assert(bad.json.ok === false && bad.json.fallback === true, "an unreadable request is refused safely");
  const options = (function(){ const req = { method: "OPTIONS", get: function(){ return "https://ronit6050.github.io"; } }; let o = {}; api(req, { set: function(k, v){ o[k] = v; }, status: function(s){ o.s = s; return this; }, send: function(){ return this; }, json: function(){ return this; } }); return o; })();
  assert(options.s === 204 && options["Access-Control-Allow-Origin"] === "https://ronit6050.github.io", "the browser's permission check is answered for the app's own address only");
}

if(failures) console.error("\n" + failures + " check(s) FAILED"); else console.log("\nAll checks passed.");
