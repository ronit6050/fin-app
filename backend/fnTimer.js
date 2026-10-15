// fnTimer.js (added 2026-10-14)
//
// PLAIN-ENGLISH WHAT THIS IS: the brain of the ALERT TIMER when it runs on the NEW server (Cloud Functions + Cloud Scheduler), instead of
// the Apps Script timer. Every 5 minutes Google's scheduler calls the new server ("tick"). Reading the owner's whole database every 5
// minutes would burn through the free daily Firestore allowance, so a tick first reads ONE tiny document (_system/timer) and only does
// the real work when it is due:
//   - something was saved that needs an alert or a fresh Home copy since the last real run (dirtyAtMs is newer than doneAtMs), or
//   - 30 minutes have passed since the last full look (a safety net that also keeps the Home copy fresh).
// The real work is the very same processNewTransactions() the Apps Script timer runs: alert new transactions (push with the quick-confirm
// buttons), settle the known ones, rebuild the Home copy.
//
// WHO MARKS "SOMETHING CHANGED": the owner's bank-SMS door (smsIn.js) after it saves a row, the Apps Script "inbox" step after it copies rows
// the OLD door wrote into the Google Sheet (v2owner.js), and every successful save from the app (viewPublisher.js publishAfterAction_) so
// the Home copy is rebuilt within one tick. If a mark is ever missed, the 30-minute full look still catches it.
//
// DEAD-MAN PROTECTION: every tick (even a quiet one) writes a heartbeat (tickAtMs). While the switch is on, the Apps Script timer steps aside
// ONLY if that heartbeat is fresh (under 12 minutes old); if the new server stops ticking (scheduler job paused, function down, a flag that
// did not arrive) the Apps Script timer takes over again by itself, so alerts can never silently stop. Both sides use the same "Processed"
// marks and the same save lock, so running together for a moment cannot announce a transaction twice.
//
// SWITCH: Script Property V2_FN_TIMER (v2dbEnableFunctionTimer / v2dbDisableFunctionTimer). While it is off the new server's tick does nothing
// and the Apps Script timer does everything, exactly as before.

var TIMER_DOC_ = "_system/timer";
var TIMER_FULL_EVERY_MS_ = 30 * 60 * 1000;
var TIMER_STALE_MS_ = 12 * 60 * 1000;          // a heartbeat older than this means the new server is not ticking
var TIMER_MAX_FAILS_ = 3;                      // after this many failed runs in a row, wait for the next full look instead of retrying every tick
var TIMER_CLOCK_MARGIN_MS_ = 5000;             // Apps Script and Cloud Run clocks may differ by a second or two

// Best-effort: never blocks or breaks whatever just saved a row. One small write.
function timerMarkDirty_(){
  try{
    fsCommit_([{ merge: { path: TIMER_DOC_, fields: { dirtyAtMs: Date.now() } } }]);
  }catch(e){
    try{ logAI("TIMER_MARK_ERROR", String(e && e.message).slice(0, 150)); }catch(ignore){}
  }
}

// Writes some fields of the timer document. Returns false (never throws) if it could not.
function timerWrite_(fields){
  try{ fsCommit_([{ merge: { path: TIMER_DOC_, fields: fields } }]); return true; }
  catch(e){ try{ logAI("TIMER_WRITE_ERROR", String(e && e.message).slice(0, 150)); }catch(ignore){} return false; }
}

// Used by the APPS SCRIPT timer: is the new server really ticking? One Firestore read. Any doubt (no heartbeat, too old, a read error) = no,
// and the Apps Script timer then does the whole job itself.
function timerHeartbeatFresh_(){
  try{
    var doc = fsGetPathMeta_(TIMER_DOC_);
    var t = doc && doc.fields ? Number(doc.fields.tickAtMs || 0) : 0;
    return t > 0 && (Date.now() - t) < TIMER_STALE_MS_;
  }catch(e){
    return false;
  }
}

// Runs on the NEW server only (called by functions/index.js "tick"). Returns what it did.
function timerTick_(){
  var startedAt = Date.now();
  if(typeof v2OwnerOn_ !== "function" || !v2OwnerOn_()) return { ran: false, reason: "owner is not on the private copy" };
  var doc = fsGetPathMeta_(TIMER_DOC_);                          // the ONE cheap read of a quiet tick
  var f = (doc && doc.fields) || {};
  var dirtyAt = Number(f.dirtyAtMs || 0), doneAt = Number(f.doneAtMs || 0), fullAt = Number(f.fullAtMs || 0);
  var fails = Number(f.failCount || 0), failAt = Number(f.failAtMs || 0);
  var dirty = dirtyAt > doneAt;
  var fullDue = (startedAt - fullAt) >= TIMER_FULL_EVERY_MS_;
  if(!dirty && !fullDue){
    timerWrite_({ tickAtMs: startedAt });                        // heartbeat: "the new server is alive"
    return { ran: false, reason: "nothing to do" };
  }
  if(fails >= TIMER_MAX_FAILS_ && (startedAt - failAt) < TIMER_FULL_EVERY_MS_){
    timerWrite_({ tickAtMs: startedAt });
    return { ran: false, reason: "backing off after " + fails + " failed runs" };
  }
  // A save from the app only flags "the Home copy is stale" in the memory of the server that handled it: make THIS server rebuild it.
  if(dirty){ try{ CacheService.getScriptCache().put("V2_DIRTY", "1", 21600); }catch(ignoreCache){} }
  try{
    processNewTransactions();
  }catch(err){
    // NOT marked done, so a later tick retries; after TIMER_MAX_FAILS_ in a row it waits for the next full look (no reads burned every 5 minutes)
    timerWrite_({ tickAtMs: startedAt, failCount: fails + 1, failAtMs: startedAt });
    try{ logAI("TIMER_RUN_FAILED", "run " + (fails + 1) + ": " + String(err && err.message).slice(0, 200)); }catch(ignore){}
    throw err;
  }
  // "done" is (a little before) the moment this run STARTED: anything marked while it ran is newer, so it is picked up next tick
  timerWrite_({ tickAtMs: startedAt, doneAtMs: startedAt - TIMER_CLOCK_MARGIN_MS_, fullAtMs: startedAt, failCount: 0 });
  return { ran: true, why: dirty ? "marked changed" : "full look" };
}
