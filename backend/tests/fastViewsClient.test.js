// backend/tests/fastViewsClient.test.js
//
// Plain-English what this checks: the app-side "Fast loading" code in index.html
// (the block between "FAST VIEWS" and the end of loadDashboard). It pulls that
// REAL code out of index.html and runs it against a fake Firebase and a fake
// clock, so we can prove:
//   - it signs in to Firebase with the Google proof the app already has,
//   - the ready-made Home copy fills the screen WITHOUT asking Apps Script,
//   - it falls back to asking Apps Script directly when anything goes wrong,
//   - an OLD copy can never undo something you just saved,
//   - Demo Mode and signed-out states never show real data.
// All data below is invented.
//
// Run with: node backend/tests/fastViewsClient.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { assert } = require("./_fakeSheetsKit");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const start = html.indexOf("    // FAST VIEWS (Phase 3, added 2026-10-11)");
const end = html.indexOf("    // The dashboard call already computes Today/Analysis/CC/Debts/Savings/");
assert(start > 0 && end > start, "found the Fast loading code in index.html");
const code = html.slice(html.lastIndexOf("    // =====", start), end);

// A fake clock: timers only run when the test says so.
function makeClock(){
  const c = { now: 1000000000000, timers: [], seq: 0 };
  c.setTimeout = function(fn, ms){ const id = ++c.seq; c.timers.push({ id, at: c.now + ms, fn }); return id; };
  c.clearTimeout = function(id){ c.timers = c.timers.filter(function(t){ return t.id !== id; }); };
  c.advance = function(ms){
    const target = c.now + ms;
    for(;;){
      c.timers.sort(function(a, b){ return a.at - b.at; });
      if(!c.timers.length || c.timers[0].at > target) break;
      const t = c.timers.shift(); c.now = t.at; t.fn();
    }
    c.now = target;
  };
  return c;
}

// A fake Firebase: lets the test sign in, push snapshots, and inject errors.
function makeFirebase(opts){
  opts = opts || {};
  const fb = { signInCalls: [], listenerCalls: 0, stateCbs: [], snapCb: null, errCb: null, user: opts.restoredUser || null, signedOut: 0 };
  const auth = {
    onAuthStateChanged: function(cb){
      fb.stateCbs.push(cb);
      Promise.resolve().then(function(){ cb(fb.user); });      // Firebase fires once with the current state
      return function(){ fb.stateCbs = fb.stateCbs.filter(function(x){ return x !== cb; }); };
    },
    signInWithCredential: function(cred){
      fb.signInCalls.push(cred);
      if(opts.signInFails) return Promise.reject(new Error("auth/invalid-credential"));
      fb.user = { email: "ronitnadar9@gmail.com" };
      return Promise.resolve().then(function(){ fb.stateCbs.forEach(function(cb){ cb(fb.user); }); });
    },
    signOut: function(){ fb.signedOut++; fb.user = null; return Promise.resolve(); }
  };
  const authFn = function(){ return auth; };
  authFn.GoogleAuthProvider = { credential: function(tok){ return { providerId: "google.com", idToken: tok }; } };
  const db = {
    settings: function(){},
    collection: function(name){ return { doc: function(id){ return { onSnapshot: function(ok, err){
      fb.listenerCalls++; fb.snapCb = ok; fb.errCb = err; fb.path = name + "/" + id;
      return function(){ fb.snapCb = null; };
    } }; } }; }
  };
  fb.firebase = { auth: authFn, firestore: function(){ return db; } };
  fb.push = function(d){ fb.snapCb({ exists: true, data: function(){ return d; } }); };
  return fb;
}

function makeApp(o){
  o = o || {};
  const clock = makeClock();
  const fb = makeFirebase(o);
  const log = { rendered: [], seeded: [], network: [], pings: [], fetches: [], saved: [], handled: 0 };
  const sandbox = {
    console: { warn: function(){}, log: console.log, error: console.error },
    window: { firebase: fb.firebase },
    firebase: fb.firebase,
    localStorage: { _m: Object.assign({}, o.fastOff ? { fastViews: "off" } : {}, o.dirty ? { fastDirty: "1" } : {}),
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
      setItem: function(k, v){ this._m[k] = String(v); },
      removeItem: function(k){ delete this._m[k]; } },
    demoMode: !!o.demoMode,
    currentUser: { email: "ronitnadar9@gmail.com", idToken: "google-proof" },
    ALLOWED_EMAIL: "ronitnadar9@gmail.com",
    APPS_SCRIPT_URL: "https://script.example/exec",
    Date: { now: function(){ return clock.now; }, parse: Date.parse },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Number: Number, JSON: JSON, Math: Math, isFinite: isFinite,
    Promise: Promise,
    loadCache: function(){ return o.cached || null; },
    saveCache: function(k, v){ log.saved.push(k); },
    renderDashboard: function(d){ log.rendered.push(d); },
    seedTabsFromDashboard: function(full, opts){ log.seeded.push({ full: full, opts: opts }); },
    homeStatusEl: { innerHTML: "", textContent: "" }, homeContentEl: { style: {} },
    isAuthError: function(m){ return m === "Not signed in properly." || m === "This account is not allowed."; },
    handleSessionExpired: function(){ log.handled++; },
    callAppsScript: function(payload){
      if(payload.action === "ping"){ log.pings.push(1); return Promise.resolve(o.pingResponse || { ok: true }); }
      log.network.push(payload.action);
      return Promise.resolve({ ok: true, dashboard: { full: { pending: [] }, from: "network" } });
    },
    fetch: function(url, init){
      const body = JSON.parse(init.body); log.fetches.push(body.action);
      return Promise.resolve({ json: function(){ return Promise.resolve(o.refreshResponse ? o.refreshResponse(body) : { ok: true, published: true, builtAt: clock.now }); } });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + "\nthis.__api = { loadDashboard, onFastSnapshot, fastWriteStarted, fastWriteFinished, stopFastViews, fastIsDirty, handleSessionExpiredProbe: function(){ return 1; }, getState: function(){ return { applied: fastApplied, min: fastMinBuiltAt, inFlight: fastWritesInFlight, broken: fastBroken, held: !!fastHeldSnap, listening: !!fastListenerUnsub, running: fastRefreshesRunning, dirty: fastIsDirty() }; } };", sandbox);
  return { api: sandbox.__api, sb: sandbox, clock, fb, log };
}

const tick = function(){ return new Promise(function(r){ setImmediate(r); }); };
const copy = function(clock, extra){
  return Object.assign({ json: JSON.stringify({ full: { pending: [{ row: 5 }] }, todaySpend: 1 }), builtAt: clock.now - 1000, updatedAt: new Date(clock.now - 1000).toISOString(), version: 2 }, extra || {});
};

(async function(){

console.log("\n--- 1. Sign-in and the first copy: no Apps Script call needed ---");
{
  const a = makeApp();
  a.api.loadDashboard();
  await tick(); await tick();
  assert(a.fb.signInCalls.length === 1 && a.fb.signInCalls[0].idToken === "google-proof", "signs in to Firebase with the Google proof the app already holds");
  assert(a.fb.listenerCalls === 1 && a.fb.path === "views/dashboard", "then watches views/dashboard");
  a.fb.push(copy(a.clock));
  assert(a.log.rendered.length === 1 && a.log.seeded.length === 1, "the copy fills Home and seeds the other tabs");
  assert(a.log.seeded[0].opts.addOnly === true && a.log.seeded[0].opts.notify === false, "Pending is add-only, and the very first copy does not pop a 'new transaction' alert");
  a.clock.advance(5000);
  assert(a.log.network.length === 0, "Apps Script was never asked (the copy arrived in time)");
  a.fb.push(copy(a.clock, { builtAt: a.clock.now }));
  assert(a.log.seeded.length === 2 && a.log.seeded[1].opts.notify === true, "a later copy IS allowed to announce a new transaction");
}

console.log("\n--- 2. Already signed in to Firebase (normal day-to-day): no re-sign-in needed ---");
{
  const a = makeApp({ restoredUser: { email: "ronitnadar9@gmail.com" } });
  a.api.loadDashboard();
  await tick(); await tick();
  assert(a.fb.signInCalls.length === 0 && a.fb.listenerCalls === 1, "uses Firebase's own remembered sign-in (so an expired Google proof does not matter)");
}

console.log("\n--- 3. Fallbacks: anything wrong means the old way, never a blank screen ---");
{
  const a = makeApp();
  a.api.loadDashboard();
  await tick(); await tick();
  a.clock.advance(4100);
  await tick();
  assert(a.log.network.join() === "getDashboard", "no copy within 4 seconds: asks Apps Script directly");

  const b = makeApp({ signInFails: true });
  b.api.loadDashboard();
  await tick(); await tick(); await tick();
  assert(b.log.network.join() === "getDashboard" && b.api.getState().broken, "Firebase sign-in rejected: falls back at once and gives up for this visit");

  const c = makeApp();
  c.api.loadDashboard(); await tick(); await tick();
  c.fb.errCb(new Error("permission-denied"));
  await tick();
  assert(c.log.network.join() === "getDashboard" && c.api.getState().broken, "permission error from Firestore: falls back at once");

  const d = makeApp();
  d.api.loadDashboard(); await tick(); await tick();
  d.fb.push(copy(d.clock, { updatedAt: new Date(d.clock.now - 50 * 60000).toISOString() }));
  assert(d.log.rendered.length === 0, "a copy older than 40 minutes is not trusted");
  d.clock.advance(4100); await tick();
  assert(d.log.network.join() === "getDashboard", "...and Apps Script is asked instead");

  const e = makeApp({ fastOff: true });
  e.api.loadDashboard(); await tick();
  assert(e.log.network.join() === "getDashboard" && e.fb.listenerCalls === 0 && e.fb.signInCalls.length === 0, "Settings -> Fast loading Off: never touches Firebase");
}

console.log("\n--- 4. Demo Mode and signed-out never show real data ---");
{
  const a = makeApp();
  a.api.loadDashboard(); await tick(); await tick();
  a.sb.demoMode = true;
  a.fb.push(copy(a.clock));
  assert(a.log.rendered.length === 0, "in Demo Mode an incoming real copy is ignored");
  a.sb.demoMode = false; a.sb.currentUser = null;
  a.fb.push(copy(a.clock));
  assert(a.log.rendered.length === 0, "signed out: ignored");

  const d = makeApp({ demoMode: true });
  d.api.loadDashboard(); await tick();
  assert(d.log.network.join() === "getDashboard" && d.fb.listenerCalls === 0, "Demo Mode loads through the demo path and never starts Firebase");
}

console.log("\n--- 5. THE KEY SAFETY: an old copy can never undo your own save ---");
{
  const a = makeApp();
  a.api.loadDashboard(); await tick(); await tick();
  a.fb.push(copy(a.clock));
  const renderedBefore = a.log.rendered.length;

  a.api.fastWriteStarted();                              // you tap Save
  a.fb.push(copy(a.clock, { builtAt: a.clock.now - 500 }));   // an OLD copy (still lists the card) arrives mid-save
  assert(a.log.rendered.length === renderedBefore && a.api.getState().held, "a copy arriving while a save is running is held back, not shown");

  a.clock.advance(300);
  a.api.fastWriteFinished(true);                         // the save succeeds
  assert(a.log.fetches.length === 0, "no rebuild yet (waits 1.5 s so a burst of saves causes one)");
  a.clock.advance(1600); await tick(); await tick();
  assert(a.log.fetches.join() === "refreshViews", "after the pause, asks the server to rebuild the copy");
  const T = a.api.getState().min;
  assert(T === a.clock.now || T > 0, "remembers when the fresh copy was built (" + T + ")");
  assert(a.log.rendered.length === renderedBefore, "the OLD held copy was dropped, never shown (it was built before the save)");

  a.fb.push(copy(a.clock, { builtAt: T }));              // the rebuilt copy arrives
  assert(a.log.rendered.length === renderedBefore + 1, "the rebuilt copy IS shown");
  a.fb.push(copy(a.clock, { builtAt: T - 5000 }));       // a straggler older copy
  assert(a.log.rendered.length === renderedBefore + 1, "a straggler older than the save is ignored forever");
}

console.log("\n--- 6. A burst of saves causes ONE rebuild ---");
{
  const a = makeApp();
  a.api.loadDashboard(); await tick(); await tick();
  a.fb.push(copy(a.clock));
  for(let i = 0; i < 5; i++){ a.api.fastWriteStarted(); a.clock.advance(200); a.api.fastWriteFinished(true); a.clock.advance(300); }
  a.clock.advance(1700); await tick(); await tick();
  assert(a.log.fetches.length === 1, "five quick saves -> one refreshViews call (got " + a.log.fetches.length + ")");
}

console.log("\n--- 7. Failed saves cost nothing; failed rebuilds fall back safely ---");
{
  const a = makeApp();
  a.api.loadDashboard(); await tick(); await tick();
  a.fb.push(copy(a.clock));
  const before = a.log.rendered.length;
  a.api.fastWriteStarted();
  a.fb.push(copy(a.clock, { builtAt: a.clock.now }));
  a.api.fastWriteFinished(false);                        // the save FAILED
  assert(a.log.fetches.length === 0, "a failed save asks for no rebuild");
  assert(a.log.rendered.length === before + 1, "the held copy is released and shown (nothing changed on the server)");

  const b = makeApp({ refreshResponse: function(){ return { ok: true, published: false, builtAt: 0 }; } });
  b.api.loadDashboard(); await tick(); await tick();
  b.fb.push(copy(b.clock));
  b.fbHighest = b.clock.now - 1000; b.api.fastWriteStarted(); b.api.fastWriteFinished(true);
  b.clock.advance(1600); await tick(); await tick();
  assert(b.log.network.join() === "getDashboard", "server could not rebuild: the app asks Apps Script for the screen directly");
  assert(b.api.getState().min === b.fbHighest + 1, "...and distrusts every copy seen so far (server clock, not the phone's)");

  const c = makeApp();
  c.api.loadDashboard(); await tick(); await tick();
  c.fb.push(copy(c.clock));
  c.sb.fetch = function(){ return Promise.reject(new Error("offline")); };
  c.api.fastWriteStarted(); c.api.fastWriteFinished(true);
  c.clock.advance(1600); await tick(); await tick();
  assert(c.log.network.join() === "getDashboard", "rebuild request fails (offline): falls back, no crash");
}

console.log("\n--- 9. REVIEW FIX: an expired Google sign-in is still noticed on startup ---");
{
  const a = makeApp({ pingResponse: { ok: false, error: "Not signed in properly." } });
  a.api.loadDashboard(); await tick(); await tick(); await tick();
  assert(a.log.pings.length === 1, "the fast path makes one cheap sign-in check (Home itself no longer calls Apps Script)");
  assert(a.log.handled === 1, "an expired sign-in sends you back to the login screen, as before");
  const b = makeApp();
  b.api.loadDashboard(); await tick(); await tick(); await tick();
  assert(b.log.handled === 0, "a valid sign-in: nothing happens");
}

console.log("\n--- 10. REVIEW FIX: closing the app before the rebuilt copy is confirmed ---");
{
  const a = makeApp();
  a.api.loadDashboard(); await tick(); await tick();
  a.fb.push(copy(a.clock));
  a.api.fastWriteStarted(); a.api.fastWriteFinished(true);
  assert(a.api.getState().dirty === true, "a successful save marks 'copy not confirmed yet' on the phone");
  a.clock.advance(1600); await tick(); await tick();
  assert(a.api.getState().dirty === false, "...and clears it once the server confirms the rebuilt copy");

  const b = makeApp({ dirty: true });                    // next open after the app was closed mid-gap
  b.api.loadDashboard(); await tick(); await tick();
  assert(b.log.network.join() === "getDashboard", "dirty marker: the screen is loaded straight from Apps Script this once");
  assert(b.log.pings.length === 0, "(that call also checks the sign-in, so no extra ping)");
  const r0 = b.log.rendered.length;
  b.fb.push(copy(b.clock, { builtAt: b.clock.now - 60000 }));
  assert(b.log.rendered.length === r0, "an old copy arriving meanwhile is held back");
  b.clock.advance(50); await tick(); await tick();
  assert(b.log.fetches.join() === "refreshViews", "and the copy is rebuilt");
  assert(b.api.getState().dirty === false, "marker cleared after the rebuild");
}

console.log("\n--- 11. REVIEW FIX: two rebuilds overlapping do not release the hold early ---");
{
  let release1 = null, calls = 0;
  const a = makeApp({ refreshResponse: function(body){ return null; } });
  a.sb.fetch = function(url, init){
    calls++;
    const me = calls;
    return new Promise(function(resolve){
      const reply = { json: function(){ return Promise.resolve({ ok: true, published: true, builtAt: a.clock.now + me }); } };
      if(me === 1) release1 = function(){ resolve(reply); }; else release2 = function(){ resolve(reply); };
    });
  };
  var release2 = null;
  a.api.loadDashboard(); await tick(); await tick();
  a.fb.push(copy(a.clock));
  const before = a.log.rendered.length;
  a.api.fastWriteStarted(); a.api.fastWriteFinished(true);
  a.clock.advance(1600);                                   // rebuild #1 starts and is slow
  a.api.fastWriteStarted(); a.api.fastWriteFinished(true); // second save while #1 is running
  a.clock.advance(1600);                                   // rebuild #2 starts
  assert(a.api.getState().running === 2, "two rebuilds are running at once");
  a.fb.push(copy(a.clock, { builtAt: a.clock.now - 3000 }));   // an old copy arrives and is held
  release1(); await tick(); await tick();
  assert(a.api.getState().running === 1 && a.log.rendered.length === before, "when #1 finishes the hold is STILL on (it was released too early before this fix)");
  release2(); await tick(); await tick();
  assert(a.api.getState().running === 0, "when both are done the hold ends");
}

console.log("\n--- 12. REVIEW FIX: a save that began before the listener was watching is not miscounted ---");
{
  const a = makeApp();
  const early = a.api.fastWriteStarted();                  // listener not attached yet -> not counted
  assert(early === false, "an early save is reported as not counted");
  a.api.loadDashboard(); await tick(); await tick();       // listener attaches
  a.fb.push(copy(a.clock));
  const later = a.api.fastWriteStarted();
  assert(later === true && a.api.getState().inFlight === 1, "a later save is counted");
  a.api.fastWriteFinished(true, early);                    // the EARLY save finishes first
  assert(a.api.getState().inFlight === 1, "finishing the early save does not steal the later save's count");
  a.api.fastWriteFinished(true, later);
  assert(a.api.getState().inFlight === 0, "the later save's own finish brings it back to zero");
}

console.log("\n--- 8. Sign-out stops everything ---");
{
  const a = makeApp();
  a.api.loadDashboard(); await tick(); await tick();
  a.fb.push(copy(a.clock));
  a.api.stopFastViews(false);
  const s = a.api.getState();
  assert(!s.listening && !s.applied && s.min === 0 && a.fb.signedOut === 1, "stops watching, forgets state, signs out of Firebase");
}

console.log("\nDone.");
})().catch(function(e){ console.error(e); process.exitCode = 1; });
