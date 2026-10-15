// fnTimer.js (added 2026-10-14)
//
// PLAIN-ENGLISH WHAT THIS IS: the brain of the ALERT TIMER when it runs on the NEW server (Cloud Functions + Cloud Scheduler), instead of
// the Apps Script timer. Every 5 minutes Google's scheduler calls the new server ("tick"). Reading the owner's whole database every 5
// minutes would burn through the free daily Firestore allowance, so a tick first reads ONE tiny document (_system/timer) and only does
// the real work when it is due:
//   - something was saved that needs an alert since the last real run (dirtyAtMs is newer than doneAtMs), or
//   - 30 minutes have passed since the last full look (a safety net that also keeps the Home copy fresh).
// The real work is the very same processNewTransactions() the Apps Script timer runs: alert new transactions (push with the quick-confirm
// buttons), settle the known ones, rebuild the Home copy.
//
// WHO MARKS "SOMETHING CHANGED": the owner's bank-SMS door (smsIn.js) after it saves a row, and the Apps Script "inbox" step after it copies
// rows the OLD door wrote into the Google Sheet (v2owner.js). If a mark is ever missed, the 30-minute full look still catches it.
//
// SWITCH: Script Property V2_FN_TIMER (v2dbEnableFunctionTimer / v2dbDisableFunctionTimer). While it is off the new server's tick does nothing
// and the Apps Script timer does everything, exactly as before.

var TIMER_DOC_ = "_system/timer";
var TIMER_FULL_EVERY_MS_ = 30 * 60 * 1000;

// Best-effort: never blocks or breaks whatever just saved a row. One small write.
function timerMarkDirty_(){
  try{
    fsCommit_([{ merge: { path: TIMER_DOC_, fields: { dirtyAtMs: Date.now() } } }]);
  }catch(e){
    try{ logAI("TIMER_MARK_ERROR", String(e && e.message).slice(0, 150)); }catch(ignore){}
  }
}

// Runs on the NEW server only (called by functions/index.js "tick"). Returns what it did.
function timerTick_(){
  var startedAt = Date.now();
  if(typeof v2OwnerOn_ !== "function" || !v2OwnerOn_()) return { ran: false, reason: "owner is not on the private copy" };
  var doc = fsGetPathMeta_(TIMER_DOC_);                          // the ONE cheap read of a quiet tick
  var f = (doc && doc.fields) || {};
  var dirtyAt = Number(f.dirtyAtMs || 0), doneAt = Number(f.doneAtMs || 0), fullAt = Number(f.fullAtMs || 0);
  var dirty = dirtyAt > doneAt;
  var fullDue = (startedAt - fullAt) >= TIMER_FULL_EVERY_MS_;
  if(!dirty && !fullDue) return { ran: false, reason: "nothing to do" };
  processNewTransactions();                                       // throws on a real failure: then it is NOT marked done, so the next tick retries
  // "done" is the moment this run STARTED: anything marked while it ran is newer, so it is picked up next tick
  fsCommit_([{ merge: { path: TIMER_DOC_, fields: { doneAtMs: startedAt, fullAtMs: startedAt } } }]);
  return { ran: true, why: dirty ? "marked changed" : "full look" };
}
