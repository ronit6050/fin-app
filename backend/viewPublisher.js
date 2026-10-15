// viewPublisher.js (added 2026-10-11)
//
// PLAIN-ENGLISH WHAT THIS IS: the app's brain already works out every screen
// (Home, Pending, today's spend...). This file takes the finished Home screen
// and stores a copy in Firestore, so that the app can later open it
// instantly instead of waiting for the brain to wake up and read the sheet.
//
// For now nothing reads these copies yet (that is the next phase), so this is
// invisible to you. It exists so we can prove the copy is exact first.
//
// THE SAFETY RULES:
// - BEST-EFFORT: everything here is wrapped so that if Firestore is down,
//   slow, or misconfigured, the thing that triggered it (saving a note, a new
//   transaction arriving, a notification) carries on exactly as before.
// - It is throttled: at most one publish every 15 seconds, so clearing a
//   backlog of 10 notes quickly does not rebuild the screen 10 times.
//   If a publish is skipped, a "changed" flag is left and the next timer run
//   publishes it. A "heartbeat" also republishes at least every 30 minutes.
// - It only ever writes the "views" collection. It never touches the sheet.

var V2_PUBLISH_ENABLED = true;

// PHASE 1 setting: after a data-changing action, only FLAG that the screen
// changed and let the background timer publish it (within ~5 minutes). Nothing
// reads the copy yet, and publishing inline would add 3-6 seconds to saves that
// wait on the server (Reconcile, Settings, Planner). Switch to true in the phase
// where the app starts reading the copy, so a fresh save shows up at once.
var V2_PUBLISH_INLINE_AFTER_ACTIONS_ = false;

// After a failed publish, wait this long before the (non-forced) timer tries
// again, so a misconfigured connection can't rebuild the screen every 5 minutes.
var V2_BACKOFF_SECONDS_ = 900;
var V2_VIEW_MAX_BYTES_ = 900000;      // Firestore's limit is 1 MiB per document
var V2_THROTTLE_SECONDS_ = 15;
var V2_HEARTBEAT_SECONDS_ = 1800;

// The actions that CHANGE data (a screen may now be out of date). Anything
// not on this list (all the "get..." and "preview..." ones, ping) never
// triggers a publish.
var V2_WRITE_ACTIONS_ = [
  "saveNote", "markNotATransaction", "restoreIgnoredTransaction", "addDebt", "settleDebt", "recordDebtPayment",
  "saveSavingsAuto", "saveSavingsManual", "withdrawSavings", "updateSavingsEntry",
  "deleteSavingsEntry", "addSavingsGoal", "setPrioritySavingsGoal", "markSavingsGoalDone",
  "purchaseSavingsGoal", "addInvestmentInstrument", "logInvestment", "updateInvestment",
  "addCashEntry", "addManualTransaction", "updateCashEntry", "insertReconciledTransactions",
  "fixCreditCardTransactionMode", "updateSettings", "saveBudgets"
];

// Builds the Home screen exactly as the app's own "getDashboard" action would
// and stores it as ONE document: views/dashboard. The screen is stored as
// text (JSON) so it comes back identical to what the app already receives.
// The moment the most recent publish STARTED building (milliseconds). The app
// uses it to tell a copy built before one of its own saves from one built after.
var V2_LAST_BUILT_AT_ = 0;

function publishDashboardView_(reason){
  // Taken BEFORE reading the sheet: anything saved earlier than this moment is
  // guaranteed to be inside the copy.
  var builtAt = Date.now();
  var json = JSON.stringify(getDashboardData());
  // Firestore's limit counts BYTES; a rupee sign is 3 bytes, so count properly.
  var bytes = encodeURIComponent(json).replace(/%[0-9A-F]{2}/g, "x").length;
  if(bytes > V2_VIEW_MAX_BYTES_){
    throw new Error("Home screen is " + bytes + " bytes, too big for one Firestore document.");
  }
  fsSetDocument_("views", "dashboard", {
    json: json,
    bytes: bytes,
    updatedAt: new Date(),
    builtAt: builtAt,
    reason: String(reason || ""),
    version: 2
  });
  V2_LAST_BUILT_AT_ = builtAt;
}

// One error line per hour at most, so a broken connection can't flood the log.
function v2LogErrorOncePerHour_(err){
  try{
    if(err && err.safetyLimit) return;   // the daily Firestore safety limit working as designed, not a fault (firestore.js)
    var cache = CacheService.getScriptCache();
    if(cache.get("V2_ERR_LOGGED")) return;
    cache.put("V2_ERR_LOGGED", "1", 3600);
    logAI("V2_PUBLISH_ERROR", String(err && err.message ? err.message : err).slice(0, 300));
  }catch(ignore){}
}

// reason: a short label saved with the copy ("timer", "action:saveNote"...).
// force: skip the throttle and the backoff (used by manual runs and by the
// background check right after it processed new transactions).
// Never throws.
function publishViewsBestEffort_(reason, force){
  var cache = null;
  try{
    if(!V2_PUBLISH_ENABLED) return false;
    cache = CacheService.getScriptCache();
    if(!force && (cache.get("V2_THROTTLE") || cache.get("V2_BACKOFF"))){
      cache.put("V2_DIRTY", "1", 21600);   // remember it changed; the timer will catch up
      return false;
    }
    cache.put("V2_THROTTLE", "1", V2_THROTTLE_SECONDS_);
    // Clear the "changed" flag BEFORE building, so a change that arrives while
    // this publish is running leaves its own flag behind instead of having it
    // wiped out when we finish.
    cache.remove("V2_DIRTY");
    publishDashboardView_(reason);
    cache.put("V2_HEARTBEAT", "1", V2_HEARTBEAT_SECONDS_);
    return true;
  }catch(err){
    try{
      if(cache){
        cache.put("V2_DIRTY", "1", 21600);              // the copy is stale; retry later
        cache.put("V2_BACKOFF", "1", V2_BACKOFF_SECONDS_);
      }
    }catch(ignore){}
    v2LogErrorOncePerHour_(err);
    return false;
  }finally{
    try{ fsFlushUsage_(); }catch(ignore){}
  }
}

// True when a rebuild of the Home copy is actually due (something changed since the last one, or the last one is over 30 minutes old).
// A cheap check from the script's memory only: it lets the timer skip opening the person's data at all when nothing is due.
function publishViewsDue_(){
  try{
    if(!V2_PUBLISH_ENABLED) return false;
    var cache = CacheService.getScriptCache();
    return !!(cache.get("V2_DIRTY") || !cache.get("V2_HEARTBEAT"));
  }catch(err){
    return true;                      // when in doubt, let the normal path decide
  }
}

// Called at the START of every background check. Cheap when there is
// nothing to do: it only publishes if something changed since the last
// publish, or if the last one was over 30 minutes ago.
function publishViewsIfNeeded_(){
  try{
    if(!V2_PUBLISH_ENABLED) return false;
    var cache = CacheService.getScriptCache();
    if(cache.get("V2_DIRTY") || !cache.get("V2_HEARTBEAT")){
      return publishViewsBestEffort_("timer", false);
    }
    return false;
  }catch(err){
    v2LogErrorOncePerHour_(err);
    return false;
  }
}

// Called after every app action. Publishes only if the action changed data
// and succeeded. Never throws, and never alters the response.
function publishAfterAction_(action, response){
  try{
    if(V2_WRITE_ACTIONS_.indexOf(action) === -1) return;
    var text = "";
    try{ text = response && response.getContent ? response.getContent() : ""; }catch(ignore){}
    if(text.indexOf('"ok":true') === -1) return;
    if(V2_PUBLISH_INLINE_AFTER_ACTIONS_){
      publishViewsBestEffort_("action:" + action, false);
    }else{
      CacheService.getScriptCache().put("V2_DIRTY", "1", 21600);   // the timer publishes it
    }
    // The new-server timer (fnTimer.js) cannot see another server's memory: tell it through the database that the Home copy is stale.
    if(typeof fnTimerOn_ === "function" && fnTimerOn_() && typeof timerMarkDirty_ === "function") timerMarkDirty_();
  }catch(err){
    v2LogErrorOncePerHour_(err);
  }
}

// Run by hand from the Apps Script editor (or by me) to publish right now.
function publishViewsNow(){
  // Only reads, so it must NOT hold the shared lock (it is a heavy rebuild): run it on the owner's private copy without the lock.
  if(typeof v2OwnerReadOnly_ === "function" && !V2DB_REQ_ && typeof v2OwnerOn_ === "function" && v2OwnerOn_()){
    return v2OwnerReadOnly_(function(){ return publishViewsBestEffort_("manual", true); });
  }
  return publishViewsBestEffort_("manual", true);
}

// The app asks for this right after it saves something, so the copy it reads
// from Firestore is rebuilt now instead of waiting for the 5-minute timer.
// Returns the moment the rebuilt copy started building (builtAt): the app then
// ignores any copy older than that, so an old copy can never bring a
// just-saved card back. Never throws; if publishing failed, published is false
// and the app falls back to asking for the screen directly.
function refreshViewsFromApp_(){
  var published = publishViewsBestEffort_("refresh", true);
  return { ok: true, published: published, builtAt: published ? V2_LAST_BUILT_AT_ : 0 };
}
