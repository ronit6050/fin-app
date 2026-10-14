// backend/tests/newServerClient.test.js
//
// Plain-English what this checks: the app-side routing in index.html (callAppsScript and the "new server" helpers). It pulls that REAL
// code out of index.html and runs it against a fake network, to prove the rules that keep money safe:
//   - Settings Off, or "Reads only": a SAVE goes to Apps Script exactly as before.
//   - "Reads and saves": a SAVE goes to the new server first.
//   - If the new server says "I did nothing" (fallback), Apps Script does the save (once).
//   - If there is NO ANSWER at all (network drop, timeout, unreadable reply), the save is NOT repeated anywhere: it might already be
//     saved, and repeating could save it twice. The screen's normal "couldn't save" handling takes over.
//   - A real "no" from the server (bad amount, stale card...) is passed on as it is, never retried.
//   - Reads still fall back to Apps Script on any problem. Demo Mode never touches the network.
// All data below is invented. Run with: node backend/tests/newServerClient.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
function assert(cond, msg){
  if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const start = html.indexOf("    function callAppsScript(payload) {");
const end = html.indexOf("    // DEMO MODE (added 2026-08-12)");
assert(start > 0 && end > start, "found the routing code in index.html");
const code = html.slice(start, html.lastIndexOf("    // =====", end));

function makeApp(setting, behaviour, opts){
  opts = opts || {};
  const log = { fetches: [], finished: [], started: 0, demo: 0 };
  const sandbox = {
    console: console, JSON: JSON, Error: Error, Promise: Promise, Date: Date,
    demoMode: !!opts.demo,
    demoHandleRequest: function(){ log.demo++; return Promise.resolve({ ok: true, demo: true }); },
    localStorage: { getItem: function(k){ return k === "newServer" ? setting : null; } },
    APPS_SCRIPT_URL: "https://script.example/exec",
    FAST_WRITE_ACTIONS: ["saveNote", "addCashEntry", "insertReconciledTransactions"],
    fastWriteStarted: function(){ log.started++; return true; },
    fastWriteFinished: function(ok, counted){ log.finished.push(!!ok); },
    fetch: function(url, init){
      const which = url.indexOf("cloudfunctions") !== -1 ? "new" : "apps";
      const body = JSON.parse(init.body);
      log.fetches.push(which + ":" + body.action);
      const b = behaviour[which];
      if(b === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ json: function(){ return b === "unreadable" ? Promise.reject(new SyntaxError("bad json")) : Promise.resolve(typeof b === "function" ? b(body) : b); } });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + "\nthis.__api = { callAppsScript: callAppsScript };", sandbox);
  return { call: sandbox.__api.callAppsScript, log: log };
}
const OK = { ok: true, saved: true };

(async function(){

console.log("\n--- 1. Off, or reads only: saves stay on Apps Script ---");
{
  for(const setting of [null, "on"]){
    const a = makeApp(setting, { apps: OK, new: OK });
    const r = await a.call({ action: "saveNote", idToken: "x" });
    assert(r.ok === true && a.log.fetches.join() === "apps:saveNote", "setting " + setting + ": the save goes to Apps Script only");
    assert(a.log.started === 1 && a.log.finished.join() === "true", "(and the app's own 'save in flight' bookkeeping runs once)");
  }
  const a = makeApp("on", { apps: OK, new: OK });
  await a.call({ action: "getPending", idToken: "x" });
  assert(a.log.fetches.join() === "new:getPending", "reads only: a read still goes to the new server");
}

console.log("\n--- 2. Reads and saves: a save goes to the new server ---");
{
  const a = makeApp("all", { apps: OK, new: { ok: true, saved: "new" } });
  const r = await a.call({ action: "addCashEntry", idToken: "x" });
  assert(r.saved === "new" && a.log.fetches.join() === "new:addCashEntry", "the new server answers; Apps Script is not asked");
  assert(a.log.started === 1 && a.log.finished.join() === "true", "the in-flight bookkeeping finishes exactly once (success)");
}

console.log("\n--- 3. The new server says it did NOTHING: Apps Script does the save, once ---");
{
  const a = makeApp("all", { apps: { ok: true, saved: "apps" }, new: { ok: false, fallback: true, error: "Saving is not switched on for the new server." } });
  const r = await a.call({ action: "saveNote", idToken: "x" });
  assert(r.saved === "apps" && a.log.fetches.join() === "new:saveNote,apps:saveNote", "asked the new server, then Apps Script exactly once");
  assert(a.log.started === 1 && a.log.finished.join() === "true", "bookkeeping finishes exactly once");
}

console.log("\n--- 4. NO ANSWER: the save is never repeated ---");
{
  for(const kind of ["network-error", "unreadable"]){
    const a = makeApp("all", { apps: OK, new: kind });
    let err = null;
    try{ await a.call({ action: "saveNote", idToken: "x" }); }catch(e){ err = e; }
    assert(!!err, kind + ": the save fails visibly (the screen shows its normal 'couldn't save' message)");
    assert(a.log.fetches.join() === "new:saveNote", kind + ": Apps Script was NOT asked to do it again");
    assert(a.log.finished.join() === "false" && a.log.started === 1, kind + ": bookkeeping finishes once as a failure");
  }
}

console.log("\n--- 5. A real 'no' is passed on as it is ---");
{
  for(const msg of ["Enter a valid amount.", "Couldn't complete that. Check it before trying again.", "That was changed at the same moment elsewhere, so nothing was saved. Please try again."]){
    const a = makeApp("all", { apps: OK, new: { ok: false, error: msg } });
    const r = await a.call({ action: "saveNote", idToken: "x" });
    assert(r.ok === false && r.error === msg && a.log.fetches.join() === "new:saveNote", "'" + msg.slice(0, 30) + "...' is shown, not retried");
    assert(a.log.finished.join() === "false", "(counted as a failed save)");
  }
}

console.log("\n--- 6. Things that stay on Apps Script, reads that fall back, Demo Mode ---");
{
  const a = makeApp("all", { apps: OK, new: OK });
  await a.call({ action: "insertReconciledTransactions", idToken: "x" });
  assert(a.log.fetches.join() === "apps:insertReconciledTransactions", "Reconcile is never sent to the new server");
  const r = makeApp("all", { apps: { ok: true, from: "apps" }, new: "network-error" });
  const got = await r.call({ action: "getPending", idToken: "x" });
  assert(got.from === "apps" && r.log.fetches.join() === "new:getPending,apps:getPending", "a READ that fails on the new server falls back to Apps Script (reads are safe to repeat)");
  const d = makeApp("all", { apps: OK, new: OK }, { demo: true });
  await d.call({ action: "saveNote", idToken: "x" });
  assert(d.log.fetches.length === 0 && d.log.demo === 1, "Demo Mode never touches the network");
}

console.log(failures ? "\n" + failures + " check(s) FAILED" : "\nAll checks passed.");
})().catch(function(e){ console.error(e); process.exitCode = 1; });
