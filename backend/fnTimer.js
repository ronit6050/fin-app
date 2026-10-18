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
// DAILY JOBS (added 2026-10-15): the four once-a-day jobs (upcoming Rent/EMI reminder 8:30, debt due dates 9:00, app health 9:30, cash check-in
// 20:00, India time) run from the SAME tick, so there is no extra scheduler job. The tick already reads the timer document, so checking "is a daily
// job due" costs nothing extra: each job stores the date it last ran (daily_<name>) in that document and runs once a day at the first tick after its time.
// The Apps Script versions of these four jobs step aside while the new server is ticking (timerDailySkip_); if it is not, they run as before and mark
// the day done so the new server never repeats them.
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

// The four daily jobs: key, India-time hour/minute after which the first tick runs it.
var TIMER_DAILY_JOBS_ = [
  { key: "obligations", hour: 8,  minute: 30 },
  { key: "debts",       hour: 9,  minute: 0  },
  { key: "cardbill",    hour: 9,  minute: 15 },     // added 2026-10-18: "card bill due in 3 days" reminder (cardCoach.js), once per bill per person
  { key: "health",      hour: 9,  minute: 30 },
  { key: "cash",        hour: 21, minute: 0  }     // the evening job: since 2026-10-17 it sends the 9pm "how much you spent today" summary to everyone (dailySummary.js); the key stays "cash" so the old Apps Script 8pm check-in keeps stepping aside
];

function timerDailyRunner_(key){
  if(key === "obligations") return checkUpcomingObligations;
  if(key === "debts") return checkDebtDueDates;
  if(key === "cardbill") return (typeof cardBillReminderRun_ === "function") ? cardBillReminderRun_ : null;
  if(key === "health") return checkAppHealth;
  if(key === "cash") return dailySummaryRun_;
  return null;
}

// India date + minutes since midnight (a function so tests can set the clock).
function timerIstClock_(){
  var now = new Date();
  return {
    date: Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd"),
    minutes: Number(Utilities.formatDate(now, "Asia/Kolkata", "H")) * 60 + Number(Utilities.formatDate(now, "Asia/Kolkata", "m"))
  };
}

// Used by the APPS SCRIPT versions of the daily jobs. True = "do not run: the new server does it". While the new-server timer is on:
//   - already done today by either side -> skip;
//   - the new server is ticking (fresh heartbeat) -> skip (it runs the job at its time today);
//   - otherwise (not ticking) -> run it here, and mark the day done so the new server does not repeat it.
// Never skips when the switch is off, on the new server itself, or for a person who is not on the private copy. Any doubt = run it.
function timerDailySkip_(key){
  try{
    if(typeof fnTimerOn_ !== "function" || !fnTimerOn_()) return false;
    if((typeof V2_ON_NEW_SERVER_ !== "undefined") && V2_ON_NEW_SERVER_) return false;
    if(typeof v2OwnerOn_ !== "function" || !v2OwnerOn_()) return false;
    var f = (fsGetPathMeta_(TIMER_DOC_) || {}).fields || {};
    var today = timerIstClock_().date;
    if(f["daily_" + key] === today) return true;
    var beat = Number(f.tickAtMs || 0);
    if(beat > 0 && (Date.now() - beat) < TIMER_STALE_MS_) return true;
    var m = {}; m["daily_" + key] = today; timerWrite_(m);          // running it here: the new server must not repeat it today
    return false;
  }catch(e){
    return false;
  }
}

var TIMER_REMIND_EVERY_MS_ = 14 * 60 * 1000;      // look at the pending-payment reminders about every 15 minutes (the tick is every 5)

// Never throws: a reminder problem must not affect the timer's real work.
function timerRemind_(nowMs){
  try{ if(typeof pendingReminderRun_ === "function") pendingReminderRun_(nowMs); }
  catch(e){ try{ logAI("REMINDER_ERROR", "tick: " + String(e && e.message).slice(0, 150)); }catch(ignore){} }
}

// Runs on the NEW server only (called by functions/index.js "tick"). Returns what it did.
function timerTick_(){
  var startedAt = Date.now();
  if(typeof v2OwnerOn_ !== "function" || !v2OwnerOn_()) return { ran: false, reason: "owner is not on the private copy" };
  var doc = fsGetPathMeta_(TIMER_DOC_);                          // the ONE cheap read of a quiet tick
  var f = (doc && doc.fields) || {};
  var dirtyAt = Number(f.dirtyAtMs || 0), doneAt = Number(f.doneAtMs || 0), fullAt = Number(f.fullAtMs || 0);
  var fails = Number(f.failCount || 0), failAt = Number(f.failAtMs || 0);
  var clock = timerIstClock_();
  var dueDaily = TIMER_DAILY_JOBS_.filter(function(j){ return clock.minutes >= j.hour * 60 + j.minute && f["daily_" + j.key] !== clock.date; });
  var dirty = dirtyAt > doneAt;
  var fullDue = (startedAt - fullAt) >= TIMER_FULL_EVERY_MS_;
  // The pending-payment reminder (pendingReminder.js) is looked at about every 15 minutes (a tick is 5 minutes), in the quiet-tick path too.
  var remindDue = (startedAt - Number(f.remindAtMs || 0)) >= TIMER_REMIND_EVERY_MS_;
  if(!dirty && !fullDue && !dueDaily.length){
    var quiet = { tickAtMs: startedAt };                         // heartbeat: "the new server is alive"
    if(remindDue) quiet.remindAtMs = startedAt;
    timerWrite_(quiet);                                          // written BEFORE the reminder runs: a slow reminder can never delay the heartbeat
    if(remindDue) timerRemind_(startedAt);
    return { ran: false, reason: "nothing to do" };
  }
  var wantWork = dirty || fullDue;
  var blocked = wantWork && fails >= TIMER_MAX_FAILS_ && (startedAt - failAt) < TIMER_FULL_EVERY_MS_;
  var fields = { tickAtMs: startedAt };
  var workError = null, workRan = false;
  if(wantWork && !blocked){
    // A save from the app only flags "the Home copy is stale" in the memory of the server that handled it: make THIS server rebuild it.
    if(dirty){ try{ CacheService.getScriptCache().put("V2_DIRTY", "1", 21600); }catch(ignoreCache){} }
    try{
      processNewTransactions();
      workRan = true;
      // "done" is (a little before) the moment this run STARTED: anything marked while it ran is newer, so it is picked up next tick
      fields.doneAtMs = startedAt - TIMER_CLOCK_MARGIN_MS_; fields.fullAtMs = startedAt; fields.failCount = 0;
    }catch(err){
      // NOT marked done, so a later tick retries; after TIMER_MAX_FAILS_ in a row it waits for the next full look (no reads burned every 5 minutes)
      workError = err;
      fields.failCount = fails + 1; fields.failAtMs = startedAt;
      try{ logAI("TIMER_RUN_FAILED", "run " + (fails + 1) + ": " + String(err && err.message).slice(0, 200)); }catch(ignore){}
    }
  }
  // The once-a-day jobs. A failing job is logged and still counted as today's run (so it cannot repeat every 5 minutes).
  var ranDaily = [];
  dueDaily.forEach(function(j){
    try{
      var run = timerDailyRunner_(j.key);
      if(run) run();
      ranDaily.push(j.key);
    }catch(e){
      try{ logAI("DAILY_JOB_FAILED", j.key + ": " + String(e && e.message).slice(0, 200)); }catch(ignore){}
    }
    fields["daily_" + j.key] = clock.date;
    // Written NOW, not only at the end: if this tick is killed before it finishes, a job that already ran (and sent its notification) is not repeated.
    var marker = {}; marker["daily_" + j.key] = clock.date; timerWrite_(marker);
  });
  if(remindDue) fields.remindAtMs = startedAt;
  timerWrite_(fields);
  if(remindDue) timerRemind_(startedAt);                          // after the real work and the heartbeat are saved
  if(workError) throw workError;
  return workRan ? { ran: true, why: dirty ? "marked changed" : "full look", daily: ranDaily }
                 : { ran: false, reason: blocked ? "backing off after " + fails + " failed runs" : "daily jobs", daily: ranDaily };
}
