// backend/tests/sharedLock.test.js
//
// Plain-English what this checks: the shared "only one server saves at a time" lock (backend/sharedLock.js).
//   - Switch OFF (the default): Apps Script behaves exactly as before: its own lock, and NOT ONE Firestore call.
//   - The lease: free -> taken; busy -> the second server waits, then gets it after the first lets go; a lease that ran out can be taken
//     over, and the old holder letting go late can never free the NEW holder's lease; two servers grabbing it in the same instant ->
//     exactly one wins.
//   - Switch ON: Apps Script takes both its own lock and the lease; a background path (bank SMS, timer) carries on without the lease
//     rather than dropping work, while a save the person tapped says "try again" and gives everything back.
//   - On the new server the lock is the lease itself.
// No network. Run with: node backend/tests/sharedLock.test.js

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let failures = 0;
function assert(cond, msg){
  if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

// ---- a tiny fake Firestore with the same "only if new / only if unchanged since" rules as the real one ----
function makeWorld(){
  const w = { docs: {}, clock: 0, now: 1000000, calls: 0, props: {}, logs: [], baseEvents: [], sleeps: 0, onSleep: null, beforeCommit: null, failReads: false };
  const sb = { console: console };
  vm.createContext(sb);
  sb.Utilities = { getUuid: (function(){ let n = 0; return function(){ return "token-" + (++n); }; })(), sleep: function(ms){ w.sleeps++; w.now += ms; if(w.onSleep) w.onSleep(); } };
  sb.flagOn_ = function(n){ return w.props[n] === "on"; };      // the switch store (flags.js) is not loaded in this tiny world: read the same values
  sb.flagGet_ = function(n){ return Object.prototype.hasOwnProperty.call(w.props, n) ? w.props[n] : null; };
  sb.PropertiesService = { getScriptProperties: function(){ return { getProperty: function(k){ return Object.prototype.hasOwnProperty.call(w.props, k) ? w.props[k] : null; } }; } };
  sb.logAI = function(t, m){ w.logs.push(t + ": " + m); };
  sb.LockService = { getScriptLock: function(){ return {
    waitLock: function(){ w.baseEvents.push("base-wait"); }, releaseLock: function(){ w.baseEvents.push("base-release"); },
    tryLock: function(){ return true; }, hasLock: function(){ return true; } }; } };
  sb.fsGetPathMeta_ = function(p){ w.calls++; if(w.failReads){ const e = new Error("Firestore daily safety limit reached"); e.safetyLimit = true; throw e; } const d = w.docs[p]; return d ? { fields: JSON.parse(JSON.stringify(d.fields)), updateTime: d.updateTime } : null; };
  sb.fsCommit_ = function(ops){
    w.calls++;
    if(w.beforeCommit){ const f = w.beforeCommit; w.beforeCommit = null; f(); }
    return ops.map(function(op){
      const cur = w.docs[op.set.path];
      if(op.set.onlyIfNew && cur){ const e = new Error("exists"); e.httpCode = 409; throw e; }
      if(op.set.onlyIfUpdateTime && (!cur || cur.updateTime !== op.set.onlyIfUpdateTime)){ const e = new Error("changed"); e.httpCode = 400; throw e; }
      w.docs[op.set.path] = { fields: JSON.parse(JSON.stringify(op.set.fields)), updateTime: "t" + String(++w.clock).padStart(6, "0") };
      return { updateTime: w.docs[op.set.path].updateTime };
    });
  };
  // the code reads the clock through Date.now(): give the sandbox a Date whose now() we control
  const RealDate = Date;
  sb.Date = function(a){ return a === undefined ? new RealDate(w.now) : new RealDate(a); };
  sb.Date.now = function(){ return w.now; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "sharedLock.js"), "utf8"), sb, { filename: "sharedLock.js" });
  w.sb = sb;
  return w;
}

console.log("\n--- 1. Switch OFF (default): plain Apps Script lock, no Firestore at all ---");
{
  const w = makeWorld();
  const lock = w.sb.sharedLock_();
  lock.waitLock(25000); lock.releaseLock();
  assert(w.calls === 0, "no Firestore call was made");
  assert(w.baseEvents.join(",") === "base-wait,base-release", "it took and gave back Apps Script's own lock");
  const lock2 = w.sb.sharedLock_({ failOpen: true });
  lock2.waitLock(1000); lock2.releaseLock();
  assert(w.calls === 0, "also none for a background path (failOpen)");
}

console.log("\n--- 2. The lease itself ---");
{
  const w = makeWorld();
  const a = w.sb.fsLeaseLock_();
  a.waitLock(5000);
  assert(a.hasLock() && w.docs["_system/lock_global"].fields.holder === "token-1", "a free lease is taken (and says who holds it)");
  assert(w.docs["_system/lock_global"].fields.expiresAtMs === w.now + 45000, "it runs out after 45 seconds, so a dead holder can never block saving for ever");
  const b = w.sb.fsLeaseLock_();
  assert(b.tryLock(0) === false, "a second server cannot take it while it is held");
  // while b waits, a lets go after one poll
  w.onSleep = function(){ if(a.hasLock()) a.releaseLock(); };
  b.waitLock(5000);
  const holderNow = w.docs["_system/lock_global"].fields.holder;
  assert(b.hasLock() && holderNow !== "" && holderNow !== "token-1", "the second server gets it as soon as the first lets go");
  b.releaseLock();
  assert(w.docs["_system/lock_global"].fields.expiresAtMs === 0 && w.docs["_system/lock_global"].fields.holder === "", "letting go clears it");
  w.onSleep = null;
  const c = w.sb.fsLeaseLock_();
  c.waitLock(0);
  assert(c.hasLock(), "and it can be taken again straight away");
  c.releaseLock();
}

console.log("\n--- 3. Waiting too long, and a lease that ran out ---");
{
  const w = makeWorld();
  const a = w.sb.fsLeaseLock_(); a.waitLock(1000);
  const b = w.sb.fsLeaseLock_();
  let err = null;
  try{ b.waitLock(1000); }catch(e){ err = e; }
  assert(err && err.leaseTimeout === true && /save lock/i.test(err.message), "waiting too long ends with a plain timeout error (leaseTimeout)");
  assert(!b.hasLock(), "and the waiter holds nothing");
  w.now += 46000;                                          // the first holder's 45 s have run out
  const c = w.sb.fsLeaseLock_(); c.waitLock(0);
  assert(c.hasLock() && w.docs["_system/lock_global"].fields.holder === "token-3", "a lease that ran out can be taken over");
  const callsBefore = w.calls;
  a.releaseLock();                                          // the old holder wakes up late and lets go
  assert(w.docs["_system/lock_global"].fields.holder === "token-3" && w.docs["_system/lock_global"].fields.expiresAtMs > w.now, "the late 'let go' does NOT free the new holder's lease");
  assert(w.calls === callsBefore + 1, "(it tried exactly once, and failed quietly)");
  c.releaseLock();
}

console.log("\n--- 4. Two servers grab it in the same instant: exactly one wins ---");
{
  const w = makeWorld();
  const a = w.sb.fsLeaseLock_(), b = w.sb.fsLeaseLock_();
  // b gets in between a's look and a's write
  w.beforeCommit = function(){ b.waitLock(0); };
  w.onSleep = function(){ if(b.hasLock()) b.releaseLock(); };
  a.waitLock(5000);
  assert(a.hasLock() && !b.hasLock(), "a ends up holding it after b let go (never both)");
  const holders = [a, b].filter(function(x){ return x.hasLock(); }).length;
  assert(holders === 1, "exactly one holder at the end");
  a.releaseLock();
}

console.log("\n--- 5. Switch ON: Apps Script takes its own lock AND the lease ---");
{
  const w = makeWorld();
  w.props.V2_FN_WRITES = "on";
  const lock = w.sb.sharedLock_();
  lock.waitLock(25000);
  assert(w.docs["_system/lock_global"] && w.docs["_system/lock_global"].fields.holder !== "", "the lease is held");
  assert(lock.hasLock(), "hasLock is true");
  lock.releaseLock();
  assert(w.docs["_system/lock_global"].fields.holder === "" && w.baseEvents.join(",") === "base-wait,base-release", "both are given back");
}

console.log("\n--- 6. Switch ON but the lease cannot be had in time ---");
{
  const w = makeWorld();
  w.props.V2_FN_WRITES = "on";
  const other = w.sb.fsLeaseLock_(); other.waitLock(0);       // the new server is busy saving
  const tap = w.sb.sharedLock_();
  let err = null;
  try{ tap.waitLock(1500); }catch(e){ err = e; }
  assert(err && err.leaseTimeout === true, "a save the person tapped is refused (they try again; nothing was half-done)");
  assert(w.baseEvents.join(",") === "base-wait,base-release", "and Apps Script's own lock was given back, not left held");
  w.baseEvents.length = 0;
  const bg = w.sb.sharedLock_({ failOpen: true });
  let threw = false;
  try{ bg.waitLock(1500); }catch(e){ threw = true; }
  assert(!threw && bg.hasLock(), "a background path (bank SMS / timer) carries on without the lease instead of dropping work");
  assert(w.logs.some(function(l){ return /^SHARED_LOCK_SKIPPED/.test(l); }), "and it says so in the log");
  bg.releaseLock();
  assert(w.baseEvents.join(",") === "base-wait,base-release", "it still gives Apps Script's own lock back");
  assert(w.docs["_system/lock_global"].fields.holder === "token-1", "and it never touched the other server's lease");
}

console.log("\n--- 7. The daily Firestore safety limit never hangs a save ---");
{
  const w = makeWorld();
  w.props.V2_FN_WRITES = "on";
  w.failReads = true;
  const t0 = w.sleeps;
  const bg = w.sb.sharedLock_({ failOpen: true });
  bg.waitLock(25000);
  assert(w.sleeps === t0, "it does not keep waiting once the safety limit is hit");
  bg.releaseLock();
  const tap = w.sb.sharedLock_();
  let err = null; try{ tap.waitLock(25000); }catch(e){ err = e; }
  assert(err && err.leaseTimeout, "a tapped save says 'try again' straight away");
}

console.log("\n--- 8. On the new server the lock is the lease itself ---");
{
  const w = makeWorld();
  w.sb.V2_ON_NEW_SERVER_ = true;
  w.sb.LockService = { getScriptLock: function(){ return w.sb.fsLeaseLock_(); } };
  w.props.V2_FN_WRITES = "on";
  const lock = w.sb.sharedLock_();
  lock.waitLock(1000);
  assert(w.docs["_system/lock_global"].fields.holder === "token-1", "one lease taken (not two: no double locking)");
  lock.releaseLock();
  assert(w.calls === 3, "three Firestore calls in all (look, take, give back)");
}

if(failures) console.error("\n" + failures + " check(s) FAILED"); else console.log("\nAll checks passed.");
