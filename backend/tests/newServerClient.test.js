// backend/tests/newServerClient.test.js
//
// Plain-English what this checks: the app-side routing in index.html (callAppsScript and the new-server helpers). It pulls that REAL
// code out of index.html and runs it against a fake network, to prove the rules that keep money safe. Since 2026-10-22 the new server is
// the ONLY server (Google deleted Apps Script's sign-in link), so:
//   - Every read and every save goes to the new server. Apps Script is never asked, whatever happens (no fallback).
//   - If the new server says "I did nothing" (fallback / busy / HTTP 429), the app shows a clear "nothing was saved" message.
//   - If there is NO ANSWER at all (network drop, timeout, unreadable reply), a save is NOT repeated: it might already be saved,
//     and repeating could save it twice. The screen's normal "couldn't save" handling takes over.
//   - A real "no" from the server (bad amount, stale card...) is passed on as it is, never retried.
//   - A read that fails is reported as an error (the screens show their Retry button), not silently sent elsewhere.
//   - Demo Mode never touches the network.
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
assert(html.indexOf("APPS_SCRIPT_URL") === -1 && html.indexOf("script.google.com/macros") === -1, "index.html no longer contains any Apps Script address");
const start = html.indexOf("    function callAppsScript(payload) {");
const end = html.indexOf("    // DEMO MODE (added 2026-08-12)");
assert(start > 0 && end > start, "found the routing code in index.html");
const code = html.slice(start, html.lastIndexOf("    // =====", end));

function makeApp(behaviour, opts){
  opts = opts || {};
  const log = { fetches: [], finished: [], started: 0, demo: 0 };
  const sandbox = {
    console: console, JSON: JSON, Error: Error, Promise: Promise, Date: Date,
    demoMode: !!opts.demo,
    withFreshToken: function(){ return Promise.resolve(); }, googleTokenMsLeft: function(){ return 1e12; }, refreshGoogleTokenQuietly: function(){ return Promise.resolve(false); },   // sign-in renewal (tested separately)
    adminWatch: function(){},       // the admin report's passive watcher (tested separately in adminStats.test.js); it never changes a request
    demoHandleRequest: function(){ log.demo++; return Promise.resolve({ ok: true, demo: true }); },
    FAST_WRITE_ACTIONS: ["saveNote", "addCashEntry", "insertReconciledTransactions"],
    fastWriteStarted: function(){ log.started++; return true; },
    fastWriteFinished: function(ok, counted){ log.finished.push(!!ok); },
    fetch: function(url, init){
      const which = url.indexOf("cloudfunctions") !== -1 ? "new" : "other";
      const body = JSON.parse(init.body);
      log.fetches.push(which + ":" + body.action);
      const b = behaviour;
      if(b === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
      if(b === "busy") return Promise.resolve({ status: 429, json: function(){ return Promise.reject(new SyntaxError("Too Many Requests")); } });
      return Promise.resolve({ status: 200, json: function(){ return b === "unreadable" ? Promise.reject(new SyntaxError("bad json")) : Promise.resolve(typeof b === "function" ? b(body) : b); } });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + "\nthis.__api = { callAppsScript: callAppsScript };", sandbox);
  return { call: sandbox.__api.callAppsScript, log: log };
}
const OK = { ok: true, saved: true };

async function failsWith(app, payload){
  try{ await app.call(payload); return null; }catch(e){ return e; }
}

(async function(){

console.log("\n--- 1. Reads and saves both go to the new server only ---");
{
  const a = makeApp({ ok: true, saved: "new" });
  const r = await a.call({ action: "addCashEntry", idToken: "x" });
  assert(r.saved === "new" && a.log.fetches.join() === "new:addCashEntry", "a save goes to the new server");
  assert(a.log.started === 1 && a.log.finished.join() === "true", "the in-flight bookkeeping finishes exactly once (success)");
  const g = makeApp(OK);
  await g.call({ action: "getPending", idToken: "x" });
  assert(g.log.fetches.join() === "new:getPending", "a read goes to the new server");
  const s = makeApp(OK);
  await s.call({ action: "somethingNotOnAnyList", idToken: "x" });
  assert(s.log.fetches.join() === "new:somethingNotOnAnyList", "an action on no list still goes to the new server (never to Apps Script)");
  for(const act of ["setFriendFullApp", "getAdminOverview", "insertReconciledTransactions", "reconcileStatement", "refreshViews", "pushTest"]){
    const x = makeApp(OK);
    await x.call({ action: act, idToken: "x" });
    assert(x.log.fetches.join() === "new:" + act, act + " goes to the new server");
  }
}

console.log("\n--- 2. The new server says it did NOTHING: a clear message, no second server ---");
{
  const a = makeApp({ ok: false, fallback: true, error: "Saving is not switched on for the new server." });
  const err = await failsWith(a, { action: "saveNote", idToken: "x" });
  assert(err && /nothing was saved/i.test(err.message), "the save fails with a 'nothing was saved' message");
  assert(a.log.fetches.join() === "new:saveNote", "only the new server was asked, exactly once");
  assert(a.log.started === 1 && a.log.finished.join() === "false", "bookkeeping finishes once, as a failure");
}

console.log("\n--- 3. NO ANSWER: the save is never repeated ---");
{
  for(const kind of ["network-error", "unreadable"]){
    const a = makeApp(kind);
    const err = await failsWith(a, { action: "saveNote", idToken: "x" });
    assert(!!err, kind + ": the save fails visibly (the screen shows its normal 'couldn't save' message)");
    assert(a.log.fetches.join() === "new:saveNote", kind + ": it was NOT asked again anywhere");
    assert(a.log.finished.join() === "false" && a.log.started === 1, kind + ": bookkeeping finishes once as a failure");
  }
}

console.log("\n--- 3b. Google turned the request away (HTTP 429, never reached the server): a clear message ---");
{
  const a = makeApp("busy");
  const err = await failsWith(a, { action: "saveNote", idToken: "x" });
  assert(err && /nothing was saved/i.test(err.message) && a.log.fetches.join() === "new:saveNote", "a 429 means nothing ran: shown as 'nothing was saved', not repeated");
  assert(a.log.started === 1 && a.log.finished.join() === "false", "bookkeeping finishes once, as a failure");
}

console.log("\n--- 4. A real 'no' is passed on as it is ---");
{
  for(const msg of ["Enter a valid amount.", "Couldn't complete that. Check it before trying again.", "That was changed at the same moment elsewhere, so nothing was saved. Please try again."]){
    const a = makeApp({ ok: false, error: msg });
    const r = await a.call({ action: "saveNote", idToken: "x" });
    assert(r.ok === false && r.error === msg && a.log.fetches.join() === "new:saveNote", "'" + msg.slice(0, 30) + "...' is shown, not retried");
    assert(a.log.finished.join() === "false", "(counted as a failed save)");
  }
}

console.log("\n--- 5. A failing READ is an error, not a silent switch to another server ---");
{
  const r = makeApp("network-error");
  const err = await failsWith(r, { action: "getPending", idToken: "x" });
  assert(!!err && r.log.fetches.join() === "new:getPending", "a read that fails is reported once and Apps Script is not asked");
  const b = makeApp({ ok: false, fallback: true });
  const err2 = await failsWith(b, { action: "getDashboard", idToken: "x" });
  assert(err2 && /did not answer/i.test(err2.message) && b.log.fetches.join() === "new:getDashboard", "a read the server says it did not do shows 'did not answer'");
}

console.log("\n--- 6. Demo Mode ---");
{
  const d = makeApp(OK, { demo: true });
  await d.call({ action: "saveNote", idToken: "x" });
  assert(d.log.fetches.length === 0 && d.log.demo === 1, "Demo Mode never touches the network");
}

console.log(failures ? "\n" + failures + " check(s) FAILED" : "\nAll checks passed.");
})().catch(function(e){ console.error(e); process.exitCode = 1; });
