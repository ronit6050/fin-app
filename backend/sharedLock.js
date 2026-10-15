// sharedLock.js (added 2026-10-14)
//
// PLAIN-ENGLISH WHAT THIS IS: "only one server saves at a time". Saves used to be safe because Apps Script has ONE lock that every
// save waits for. When the NEW server (Firebase Cloud Functions, functions/) also saves, Apps Script's lock cannot stop it, so both
// servers use the same "lease" instead: one small Firestore document (_system/lock_global) that says who holds the lock and until
// when. Whoever creates/takes it first goes ahead, the other waits its turn. A lease always runs out (45 s) so a server that dies
// while holding it can never block saving for ever.
//
// SAFETY NET UNDERNEATH: even without this lease, every saved tab refuses to overwrite a change made at the same instant by someone
// else (v2db.js "unchanged since I read it" check, the request is then repeated once). The lease just makes that rare.
//
// SWITCH: Script Property V2_FN_WRITES = "on" (v2dbEnableFunctionWrites()). While it is OFF (the default) Apps Script behaves exactly
// like before: its own lock, nothing else. On the new server the lock is ALWAYS the lease (see functions/runtime/shim.js).

var LEASE_PATH_ = "_system/lock_global";
var LEASE_TTL_MS_ = 45000;
var LEASE_POLL_MS_ = 200;

// True only on the new server (the shim sets it). Apps Script never defines it.
var V2_ON_NEW_SERVER_ = (typeof V2_ON_NEW_SERVER_ !== "undefined") ? V2_ON_NEW_SERVER_ : false;

function leaseNow_(){ return Date.now(); }

// Takes the lease, waiting up to waitMs. Returns { token, updateTime }. Throws an Error with .leaseTimeout = true when it could not.
function leaseAcquire_(waitMs){
  var token = Utilities.getUuid();
  var deadline = leaseNow_() + Math.max(0, Number(waitMs) || 0);
  var lastErr = null;
  while(true){
    try{
      var meta = fsGetPathMeta_(LEASE_PATH_);
      var now = leaseNow_();
      var mine = { holder: token, expiresAtMs: now + LEASE_TTL_MS_, takenAtMs: now };
      if(!meta){
        var r1 = fsCommit_([{ set: { path: LEASE_PATH_, fields: mine, onlyIfNew: true } }]);
        return { token: token, updateTime: (r1 && r1[0] && r1[0].updateTime) || "" };
      }
      if(Number(meta.fields.expiresAtMs || 0) <= now){            // released, or the last holder's time ran out
        var r2 = fsCommit_([{ set: { path: LEASE_PATH_, fields: mine, onlyIfUpdateTime: meta.updateTime } }]);
        return { token: token, updateTime: (r2 && r2[0] && r2[0].updateTime) || "" };
      }
    }catch(e){
      // Someone else took it in the same instant (409/400/412): look again. A real outage / safety limit: remember and keep trying until the deadline.
      lastErr = e;
      if(e && e.safetyLimit) break;
    }
    if(leaseNow_() >= deadline) break;
    Utilities.sleep(LEASE_POLL_MS_);
  }
  var err = new Error("Could not get the save lock in time" + (lastErr ? " (" + String(lastErr.message).slice(0, 80) + ")" : "") + ".");
  err.leaseTimeout = true;
  throw err;
}

// Gives the lease back. Best-effort and never throws: if it already ran out and someone else took it, the "unchanged since" check
// simply fails and we leave it alone (it is theirs now).
function leaseRelease_(held){
  try{
    if(!held) return;
    var fields = { holder: "", expiresAtMs: 0, takenAtMs: 0 };
    var op = { set: { path: LEASE_PATH_, fields: fields } };
    if(held.updateTime) op.set.onlyIfUpdateTime = held.updateTime;
    else return;                                                  // no proof it is still ours: let it expire by itself
    fsCommit_([op]);
  }catch(ignore){}
}

// A lock object shaped like Apps Script's (waitLock / tryLock / releaseLock / hasLock) backed by the lease. Used on the new server.
function fsLeaseLock_(){
  var held = null;
  return {
    waitLock: function(ms){ if(held) return; held = leaseAcquire_(ms); },
    tryLock: function(ms){ try{ if(!held) held = leaseAcquire_(ms || 0); return true; }catch(e){ return false; } },
    hasLock: function(){ return !!held; },
    releaseLock: function(){ var h = held; held = null; leaseRelease_(h); }
  };
}

// Script Property V2_FN_TIMER = "on": the NEW server runs the alert timer (see transactions.js / functions/index.js tick).
function fnTimerOn_(){
  try{ return PropertiesService.getScriptProperties().getProperty("V2_FN_TIMER") === "on"; }catch(e){ return false; }
}

function fnWritesOn_(){
  try{ return PropertiesService.getScriptProperties().getProperty("V2_FN_WRITES") === "on"; }catch(e){ return false; }
}

// THE lock every saving path asks for (instead of LockService.getScriptLock() directly).
//   - new server: LockService is already the lease (shim) -> returned as is.
//   - Apps Script, switch OFF (default): the plain Apps Script lock, exactly as before.
//   - Apps Script, switch ON: the Apps Script lock AND the lease (so it also excludes the new server).
// opts.failOpen: for background paths that must NEVER drop work (bank SMS landing, the timer): if the lease cannot be had in time,
// carry on with just the Apps Script lock (the per-tab "unchanged since" check still protects the data) and log it. Saves the person
// taps (failOpen false) instead say "try again", because a quick retry is harmless.
function sharedLock_(opts){
  var base = LockService.getScriptLock();
  if(V2_ON_NEW_SERVER_ || !fnWritesOn_()) return base;
  var failOpen = !!(opts && opts.failOpen);
  var held = null, haveBase = false;
  return {
    waitLock: function(ms){
      var started = leaseNow_();
      base.waitLock(ms);
      haveBase = true;
      var left = Math.max(1000, Number(ms) - (leaseNow_() - started));
      try{
        held = leaseAcquire_(left);
      }catch(e){
        if(failOpen){ try{ logAI("SHARED_LOCK_SKIPPED", String(e && e.message).slice(0, 150)); }catch(ignore){} return; }
        try{ base.releaseLock(); }catch(ignore){}
        haveBase = false;
        throw e;
      }
    },
    tryLock: function(ms){ try{ this.waitLock(ms || 0); return true; }catch(e){ return false; } },
    hasLock: function(){ return haveBase; },
    releaseLock: function(){
      var h = held; held = null;
      leaseRelease_(h);
      if(haveBase){ haveBase = false; try{ base.releaseLock(); }catch(ignore){} }
    }
  };
}
