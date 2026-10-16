// adminStats.js (added 2026-10-16)
//
// PLAIN-ENGLISH WHAT THIS IS: the quiet RECORDING half of the owner's admin panel. It counts things, it never stores what a person
// spent, noted or paid:
//   - how well the SMS reader understands each bank (per bank, per week)         -> adminStats/u_<week>
//   - how often the app's category / Need-Want guesses were kept                  -> adminStats/u_<week>   (field names start g__)
//   - which screens each person opens, when they were last seen, app version      -> adminStats/p_<person>, adminStats/w<week>_<person>
//   - errors, grouped by type with the cleaned-up message                         -> adminErrors/<signature>
//   - the day recording started                                                    -> adminStats/meta   (see adminRowIsRecorded_)
// Everything is a whole-number counter added to a document, so two servers can record at the same instant without losing a count.
//
// PRIVACY RULE (owner's rule): NO amount, note, payee, message text or account number is ever written here. Error text is cleaned
// first (numbers, e-mail addresses and links removed). The collections are closed to every phone by the security rules
// (only the backend robot reads or writes them).
//
// SAFETY RULE: every function here is best-effort. A problem in here (Firestore down, a bad value) must NEVER stop a transaction
// from being saved, a notification from being sent or a screen from loading: they all catch their own errors and return false.
// The switch ADMIN_STATS_ENABLED_ turns all recording off at once.

var ADMIN_STATS_ENABLED_ = true;

var ADMIN_DAY_MS_ = 86400000;
var ADMIN_SCREENS_SEEN_ = ["home", "pending", "analysis", "more", "today", "cash", "history", "investments", "cc", "debts", "savings",
  "planner", "reconcile", "settings", "access", "people", "demo"];
var ADMIN_ACTIONS_SEEN_ = ["saveNote", "addManual", "split", "undo", "reconcile", "teachBank", "markNotATransaction"];
var ADMIN_MAX_ERRORS_PER_CALL_ = 5;
var ADMIN_MAX_ERRORS_PER_DAY_ = 30;      // per person
var ADMIN_MAX_CALLS_PER_DAY_ = 80;       // per person

// ---- Small pure helpers (tested on their own) -------------------------------------------------------------------------

// Weeks start on Monday, India time. Returns a whole number that goes up by one each week (1970-01-05 was a Monday).
function adminWeekIndex_(ms){
  var istDays = Math.floor((Number(ms) + 19800000) / ADMIN_DAY_MS_);      // the India calendar day number
  return Math.floor((istDays - 4) / 7);
}
function adminWeekStartMs_(weekIdx){ return (weekIdx * 7 + 4) * ADMIN_DAY_MS_ - 19800000; }
function adminDayKey_(ms){
  var d = new Date(Number(ms) + 19800000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// A short, stable, harmless name for a person inside document names (the e-mail itself is stored only INSIDE the owner-only presence document).
function adminPersonKey_(email){
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, "admin|" + String(email || "").toLowerCase().trim());
  return bytes.map(function(b){ return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("").slice(0, 16);
}

// The bank a message belongs to: the bank the reader found, else the sender's name ("UNK_BOBSMS": a sender the app cannot name yet).
function adminBankKey_(bank, sender){
  var b = String(bank || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  if(b) return b;
  var t = typeof smsInSenderToken_ === "function" ? smsInSenderToken_(sender) : String(sender || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  // A sender made only of digits is a phone number, not a bank: never use it as a name (privacy). A name with no letter is not a bank name either.
  return (t && /[A-Z]/.test(t)) ? "UNK_" + t : "UNK";
}

// Error text made safe to keep: lower case, no links, no e-mail addresses, every run of digits replaced, short.
function adminCleanErrorText_(text){
  var t = String(text === undefined || text === null ? "" : text).toLowerCase();
  t = t.replace(/https?:\/\/\S+/g, "<link>").replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+/g, "<email>").replace(/\d+(?:[.,]\d+)*/g, "<n>");
  return t.replace(/\s+/g, " ").trim().slice(0, 160);
}

// ---- "Only what the recorder has seen" ---------------------------------------------------------------------------------------
// The score compares two things: messages the recorder counted, and checks people made on payments. Both must be about the SAME payments.
// So a payment counts for the checks only if (a) it was read by one of the recorded doors (Source "Phone": the new SMS door and the friends'
// door; the old Tasker reader writes Source "Tasker" and is counted on neither side) and (b) it arrived on or after the day recording started
// (stored once in adminStats/meta). Rows from before that, or from the old reader, are simply not part of the score.
var ADMIN_SINCE_MS_ = 0;
function adminSinceMs_(){
  if(ADMIN_SINCE_MS_) return ADMIN_SINCE_MS_;
  var cache = null;
  try{ cache = CacheService.getScriptCache(); var c = cache ? Number(cache.get("ADM_SINCE") || 0) : 0; if(c > 0){ ADMIN_SINCE_MS_ = c; return c; } }catch(ignoreCache){}
  try{
    var d = fsGetPathMeta_("adminStats/meta");
    var v = d && d.fields ? Number(d.fields.sinceMs) : 0;
    if(!(v > 0)){
      v = Date.now();
      try{ fsCommit_([{ set: { path: "adminStats/meta", fields: { sinceMs: v }, onlyIfNew: true } }]); }
      catch(e2){ var again = fsGetPathMeta_("adminStats/meta"); var v2 = again && again.fields ? Number(again.fields.sinceMs) : 0; if(v2 > 0) v = v2; }   // someone else created it first
    }
    ADMIN_SINCE_MS_ = v;
    try{ if(cache) cache.put("ADM_SINCE", String(v), 21600); }catch(ignorePut){}
    return v;
  }catch(err){ return 0; }          // unknown: callers then treat the row as NOT recorded (the safe, stricter way)
}
// source / dateValue come from the transaction's own row.
function adminRowIsRecorded_(source, dateValue){
  if(String(source || "") !== "Phone") return false;
  var since = adminSinceMs_();
  if(!(since > 0)) return false;
  var t = new Date(dateValue).getTime();
  if(!isFinite(t)) return false;
  return adminDayKey_(t) >= adminDayKey_(since);
}

// ---- Writing (best-effort) -----------------------------------------------------------------------------------------------

// ops = [{ path, fields: {plain fields}, adds: {fieldName: count} }]. One request. Returns true/false, never throws.
function adminStatsCommit_(ops){
  if(!ADMIN_STATS_ENABLED_) return false;
  try{
    var writes = [];
    ops.forEach(function(op){
      var adds = [];
      Object.keys(op.adds || {}).forEach(function(k){
        var n = Math.floor(Number(op.adds[k]));
        if(isFinite(n) && n > 0 && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(k)) adds.push({ field: k, amountInt: n });
      });
      if(!adds.length && !Object.keys(op.fields || {}).length) return;
      writes.push({ merge: { path: op.path, fields: op.fields || {}, adds: adds } });
    });
    if(!writes.length) return true;
    fsCommit_(writes);
    return true;
  }catch(err){
    try{ logAI("ADMIN_STATS_ERROR", String(err && err.message).slice(0, 160)); }catch(ignore){}
    return false;
  }
}

// One incoming bank SMS reached the server. outcome: "SAVED" | "UNCERTAIN_SAVED" | "IGNORED" | "DUPLICATE".
// tx = what the reader worked out ({bank, type, amount, counterparty}); email = whose phone it came from.
// Counts only: nothing from the message text is recorded.
function adminRecordSms_(email, outcome, tx, sender){
  try{
    if(!ADMIN_STATS_ENABLED_) return false;
    var now = Date.now(), wk = adminWeekIndex_(now);
    var adds = {}, mine = {};
    adminSinceMs_();                                                                  // makes sure "recording started on ..." is stored
    // Ignored and duplicate messages are not part of any score, so they share one key (no per-sender fields that could grow without limit).
    var bank = (outcome === "IGNORED" || outcome === "DUPLICATE") ? "ALL" : adminBankKey_(tx && tx.bank, sender);
    var f = "b_" + bank + "__";
    if(outcome === "SAVED"){
      var amountOk = Number(tx && tx.amount) > 0;
      var typeOk = tx && (tx.type === "debit" || tx.type === "credit");
      adds[f + (amountOk && typeOk ? "full" : "partial")] = 1;                    // "full" = amount AND spent-or-received found
      if(!(tx && tx.counterparty)) adds[f + "nopayee"] = 1;                       // information only; not part of the score
      mine.sms_saved = 1;
    }else if(outcome === "UNCERTAIN_SAVED"){ adds[f + "unc"] = 1; mine.sms_unc = 1; }
    else if(outcome === "IGNORED"){ adds[f + "ign"] = 1; mine.sms_ign = 1; }
    else if(outcome === "DUPLICATE"){ adds[f + "dup"] = 1; }
    else return false;
    var key = adminPersonKey_(email);
    var ops = [{ path: "adminStats/u_" + wk, fields: { weekStartMs: adminWeekStartMs_(wk) }, adds: adds }];
    if(Object.keys(mine).length){
      ops.push({ path: "adminStats/w" + wk + "_" + key, fields: { weekStartMs: adminWeekStartMs_(wk), person: key }, adds: mine });
    }
    if(outcome === "SAVED" || outcome === "UNCERTAIN_SAVED"){
      ops.push({ path: "adminStats/p_" + key, fields: { email: String(email || "").toLowerCase(), lastSmsMs: now }, adds: {} });
    }
    return adminStatsCommit_(ops);
  }catch(err){ return false; }
}

// A note was saved on a transaction (Pending first time, or History editing later). before = what the row held BEFORE this save.
// info: { channel, bank, sender, prevNote, prevCategory, prevType, prevAmount, note, category, type, amount, isRepeatSave,
//         autoType, guess: {c, t} }
// Counts three things: was the app's reading checked and right, were its guesses kept, and how many payments were typed by a person.
function adminRecordNoteSaved_(info){
  try{
    if(!ADMIN_STATS_ENABLED_ || !info || info.noCount) return false;                            // noCount: a bulk save nobody inspected (Reconcile's "save found notes")
    var wk = adminWeekIndex_(Date.now());
    var adds = {};
    var first = String(info.prevNote || "").trim() === "";
    var bank = adminBankKey_(info.bank, info.sender);
    var f = "b_" + bank + "__";
    var recorded = String(info.channel || "") === "SMS" && adminRowIsRecorded_(info.source, info.dateValue);   // the same payments the message counters saw
    var pa = Number(info.prevAmount), na = Number(info.amount);
    var amountChanged = recorded && info.amount !== undefined && info.amount !== null && info.amount !== "" && pa > 0 && isFinite(na) && Math.abs(na - pa) > 0.005;
    if(info.isRepeatSave){
      // The same note, category and tag saved again (a double tap): nothing new to count, EXCEPT an amount that was corrected this time.
      if(amountChanged) adds[f + "fix"] = 1;
    }else if(first){
      adds["g__saves"] = 1;
      if(recorded){
        adds[f + "rev"] = 1;                                                       // the person looked at this reading and saved it
        if(amountChanged) adds[f + "fix"] = 1;                                     // they had to correct the amount the app read
      }
      if(!info.autoType){
        var g = info.guess || null;
        if(g){
          var sc = String(g.c || ""), st = String(g.t || "");
          if(sc){ adds[String(info.category || "") === sc ? "g__cat_kept" : "g__cat_changed"] = 1; } else { adds["g__cat_none"] = 1; }
          if(st){ adds[String(info.type || "") === st ? "g__type_kept" : "g__type_changed"] = 1; } else { adds["g__type_none"] = 1; }
        }
      }
    }else{
      var catChanged = String(info.prevCategory || "") !== "" && String(info.category || "") !== String(info.prevCategory || "");
      var typeChanged = String(info.prevType || "") !== "" && String(info.type || "") !== String(info.prevType || "");
      if(catChanged || typeChanged) adds["g__revised"] = 1;                        // fixed later in History: a kept guess that was wrong
      if(amountChanged) adds[f + "fix"] = 1;                                       // the amount was corrected later in History
    }
    if(!Object.keys(adds).length) return true;
    return adminStatsCommit_([{ path: "adminStats/u_" + wk, fields: { weekStartMs: adminWeekStartMs_(wk) }, adds: adds }]);
  }catch(err){ return false; }
}

// Removed with "Not a transaction" (junk) or put back with Undo. needsReview = the reader had flagged it itself.
function adminRecordRemoval_(info){
  try{
    if(!ADMIN_STATS_ENABLED_ || !info || String(info.channel || "") !== "SMS" || !adminRowIsRecorded_(info.source, info.dateValue)) return false;
    var wk = adminWeekIndex_(Date.now());
    var f = "b_" + adminBankKey_(info.bank, info.sender) + "__";
    var name = info.restored ? (info.needsReview ? "unc_restored" : "restored") : (info.needsReview ? "unc_junk" : "conf_removed");
    var adds = {}; adds[f + name] = 1;
    return adminStatsCommit_([{ path: "adminStats/u_" + wk, fields: { weekStartMs: adminWeekStartMs_(wk) }, adds: adds }]);
  }catch(err){ return false; }
}

// A payment the app settled by itself (auto-settle: Rent / EMI / SIP recognised by amount and payee).
function adminRecordAutoSettled_(count){
  try{
    var n = Math.floor(Number(count));
    if(!ADMIN_STATS_ENABLED_ || !(n > 0)) return false;
    var wk = adminWeekIndex_(Date.now());
    return adminStatsCommit_([{ path: "adminStats/u_" + wk, fields: { weekStartMs: adminWeekStartMs_(wk) }, adds: { g__auto: n } }]);
  }catch(err){ return false; }
}

// Statement checking (Reconcile) added payments the SMS never delivered: real misses, found without any guesswork.
function adminRecordReconAdded_(count){
  try{
    var n = Math.floor(Number(count));
    if(!ADMIN_STATS_ENABLED_ || !(n > 0)) return false;
    var wk = adminWeekIndex_(Date.now());
    return adminStatsCommit_([{ path: "adminStats/u_" + wk, fields: { weekStartMs: adminWeekStartMs_(wk) }, adds: { g__recon_added: n } }]);
  }catch(err){ return false; }
}

// ---- The app's own report (action "adminLog") --------------------------------------------------------------------------------
// body: { screens: {name: count}, actions: {name: count}, errors: [{kind, screen, msg}], version, platform }
// Called by any signed-in allowed person's app, at most a few times a day. Returns {ok:true} (or {ok:false} on a bad request).
function adminLogHandle_(data, verified){
  if(!ADMIN_STATS_ENABLED_) return { ok: true, recorded: false };
  var email = String(verified && verified.email || "").toLowerCase();
  if(!email) return { ok: false, error: "Not signed in." };
  try{
    var cache = null;
    try{ cache = CacheService.getScriptCache(); }catch(ignoreCache){}
    var now = Date.now(), day = adminDayKey_(now), key = adminPersonKey_(email), wk = adminWeekIndex_(now);
    var callsKey = "ADM_C_" + key + "_" + day, errKey = "ADM_E_" + key + "_" + day;
    var calls = 0, errCount = 0;
    try{ calls = cache ? Number(cache.get(callsKey) || 0) : 0; errCount = cache ? Number(cache.get(errKey) || 0) : 0; }catch(ignoreRead){}
    if(calls >= ADMIN_MAX_CALLS_PER_DAY_) return { ok: true, recorded: false };
    try{ if(cache) cache.put(callsKey, String(calls + 1), 21600); }catch(ignorePut){}

    var adds = {};
    var screens = data && data.screens && typeof data.screens === "object" ? data.screens : {};
    ADMIN_SCREENS_SEEN_.forEach(function(s){ var n = Math.floor(Number(screens[s])); if(n > 0) adds["s_" + s] = Math.min(n, 500); });
    var actions = data && data.actions && typeof data.actions === "object" ? data.actions : {};
    ADMIN_ACTIONS_SEEN_.forEach(function(a){ var n = Math.floor(Number(actions[a])); if(n > 0) adds["a_" + a] = Math.min(n, 500); });

    var errs = Array.isArray(data && data.errors) ? data.errors.slice(0, ADMIN_MAX_ERRORS_PER_CALL_) : [];
    var ops = [];
    var usedErrs = 0;
    errs.forEach(function(e){
      if(errCount + usedErrs >= ADMIN_MAX_ERRORS_PER_DAY_) return;
      var kind = String(e && e.kind || "app").replace(/[^a-z]/gi, "").toLowerCase().slice(0, 12) || "app";
      var screen = String(e && e.screen || "").replace(/[^a-z]/gi, "").slice(0, 30);
      var msg = adminCleanErrorText_(e && e.msg);
      if(!msg) return;
      usedErrs++;
      var errAdds = { count: 1 }; errAdds["d_" + day] = 1;
      var errFields = { kind: kind, screen: screen, msg: msg, lastMs: now }; errFields["u_" + key] = 1;
      ops.push({ path: "adminErrors/" + adminPersonKey_(kind + "|" + screen + "|" + msg), fields: errFields, adds: errAdds });
    });
    if(usedErrs){ adds["errs"] = usedErrs; try{ if(cache) cache.put(errKey, String(errCount + usedErrs), 21600); }catch(ignoreErr){} }

    var version = String(data && data.version || "").replace(/[^0-9A-Za-z.\-]/g, "").slice(0, 20);
    var platform = String(data && data.platform || "") === "android" ? "android" : "web";
    ops.push({ path: "adminStats/p_" + key, fields: { email: email, lastSeenMs: now, version: version, platform: platform }, adds: {} });
    if(Object.keys(adds).length) ops.push({ path: "adminStats/w" + wk + "_" + key, fields: { weekStartMs: adminWeekStartMs_(wk), person: key }, adds: adds });
    adminStatsCommit_(ops);
    return { ok: true, recorded: true };
  }catch(err){
    return { ok: true, recorded: false };            // the app never needs to know about a recording problem
  }
}

// A thrown error inside a server action (the shared safety net in pwaDispatch_). Best-effort.
function adminRecordServerError_(action, email, err){
  try{
    if(!ADMIN_STATS_ENABLED_) return false;
    var now = Date.now(), key = adminPersonKey_(email || "unknown"), day = adminDayKey_(now);
    var msg = adminCleanErrorText_(String(err && err.message ? err.message : err));
    if(!msg) return false;
    var screen = String(action || "").replace(/[^A-Za-z]/g, "").slice(0, 30);
    var errAdds = { count: 1 }; errAdds["d_" + day] = 1;
    var errFields = { kind: "server", screen: screen, msg: msg, lastMs: now }; errFields["u_" + key] = 1;
    return adminStatsCommit_([{ path: "adminErrors/" + adminPersonKey_("server|" + screen + "|" + msg), fields: errFields, adds: errAdds }]);
  }catch(e2){ return false; }
}
