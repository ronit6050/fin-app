// pendingReminder.js (added 2026-10-17)
//
// PLAIN-ENGLISH WHAT THIS IS: a gentle reminder push to each person with the full app when payments are waiting for a note:
//   "3 payments need a note"  /  "₹1,240 waiting. Oldest: 2 days ago. Tap to open Pending."
// Built from THEIR OWN data, sent only to THEIR OWN phone. Runs from the new server's 5-minute tick (fnTimer.js), looking at people at most
// every 15 minutes.
//
// COST AND ANNOYANCE RULES (the owner's cost ceiling and "do not get muted" rule decide all of these):
//   - Quiet hours: nothing from 10pm to 8am India time, and the check itself reads NOTHING in those hours.
//   - Each person picks how often in Settings > Notifications: Off, Every 30 minutes, Hourly (the default) or Twice a day. Never faster than 30 minutes.
//   - At most 8 reminders per person per day, whatever the choice.
//   - Only when something has been WAITING since the previous check (a payment that just arrived already got its own notification).
//   - Not while the person has the app open (seen in the last 10 minutes), because they can see Pending themselves.
//   - Nothing when nothing is pending, and nothing for someone with no phone registered.
// Data cost: per person per check about 1-3 small Firestore reads (settings, presence, and the Transactions tab only when a reminder is
// actually due), plus one small shared state document (_system/reminders). Everything is best-effort: one person's problem never stops the
// next, and a failure here can never affect saving, the other notifications or the timer.

var REMINDER_MAX_PER_DAY_ = 8;
var REMINDER_QUIET_FROM_HOUR_ = 22;                 // from 22:00 ...
var REMINDER_QUIET_TO_HOUR_ = 8;                    // ... until 08:00 India time: silence, and no reads
var REMINDER_ACTIVE_WINDOW_MS_ = 10 * 60 * 1000;    // seen in the app this recently = no reminder
var REMINDER_STATE_DOC_ = "_system/reminders";
var REMINDER_MINUTES_ = { "30": 30, "60": 60, "twice": 300 };   // minimum gap between two reminders ("twice" = at most about twice a day)

function reminderChoice_(raw){
  var v = String(raw === undefined || raw === null ? "" : raw).trim().toLowerCase();
  return (v === "off" || v === "30" || v === "60" || v === "twice") ? v : "60";      // default: hourly
}

function reminderMoney_(n){
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

// Inside one person's data: how many payments are waiting for a note, their total and how old the oldest is. Reads only.
function reminderSnapshot_(nowMs){
  var sheet = dbSs_().getSheetByName("Transactions");
  var rows = sheet ? sheet.getDataRange().getValues() : [[]];
  var todayStr = Utilities.formatDate(new Date(nowMs), "Asia/Kolkata", "yyyy-MM-dd");
  var todayUtc = Date.UTC(Number(todayStr.slice(0, 4)), Number(todayStr.slice(5, 7)) - 1, Number(todayStr.slice(8, 10)));
  var count = 0, total = 0, oldestDays = 0;
  for(var i = 1; i < rows.length; i++){
    var r = rows[i];
    if(String(r[15] || "").trim() !== "YES" || String(r[12] || "").trim() !== "") continue;       // alerted, but no note yet (same test as Pending)
    if(typeof isEmptyTransactionRow_ === "function" && isEmptyTransactionRow_(r)) continue;
    count++;
    total += Math.abs(Number(r[5]) || 0);
    try{
      var ds = Utilities.formatDate(new Date(r[0]), "Asia/Kolkata", "yyyy-MM-dd");
      var days = Math.round((todayUtc - Date.UTC(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10)))) / 86400000);
      if(isFinite(days) && days > oldestDays) oldestDays = days;
    }catch(ignoreDate){}
  }
  return { count: count, total: total, oldestDays: oldestDays };
}

function reminderMessage_(snap){
  var title = snap.count === 1 ? "1 payment needs a note" : snap.count + " payments need a note";
  var age = snap.oldestDays <= 0 ? "All from today." : "Oldest: " + snap.oldestDays + (snap.oldestDays === 1 ? " day" : " days") + " ago.";
  return { title: title, body: reminderMoney_(snap.total) + " waiting. " + age + " Tap to open Pending." };
}

// Called by the tick (at most every ~15 minutes). Returns how many reminders were sent. Never throws.
function pendingReminderRun_(nowMs){
  var sent = 0;
  try{
    nowMs = nowMs || Date.now();
    var hour = Number(Utilities.formatDate(new Date(nowMs), "Asia/Kolkata", "HH"));
    if(hour >= REMINDER_QUIET_FROM_HOUR_ || hour < REMINDER_QUIET_TO_HOUR_) return 0;           // quiet hours: no reads at all
    var people = dailySummaryPeople_();
    if(!people.length) return 0;
    var today = Utilities.formatDate(new Date(nowMs), "Asia/Kolkata", "yyyy-MM-dd");
    var stateDoc = fsGetPathMeta_(REMINDER_STATE_DOC_);
    var state = (stateDoc && stateDoc.fields) || {};
    var updates = {};
    people.forEach(function(email){
      try{
        var key = adminPersonKey_(email);
        var choice = v2dbRun_(email, function(){ return reminderChoice_(dbProps_().getProperty("SETTING_PENDING_REMINDER")); }, { prefetch: ["_Props"] });
        if(choice === "off") return;
        var last = Number(state[key + "_last"] || 0);
        var sentToday = String(state[key + "_day"] || "") === today ? Number(state[key + "_n"] || 0) : 0;
        if(sentToday >= REMINDER_MAX_PER_DAY_) return;
        if(last > 0 && (nowMs - last) < REMINDER_MINUTES_[choice] * 60000 - 60000) return;       // not due yet (one minute of slack for the tick's timing)
        var token = splitNotifyToken_(email);
        if(!token) return;
        try{                                                                                      // in the app right now: they can see Pending themselves
          var pres = fsGetPathMeta_("adminStats/p_" + key);
          var seen = pres && pres.fields ? Number(pres.fields.lastSeenMs || 0) : 0;
          if(seen > 0 && (nowMs - seen) < REMINDER_ACTIVE_WINDOW_MS_) return;
        }catch(ignorePresence){}
        var snap = v2dbRun_(email, function(){ return reminderSnapshot_(nowMs); }, { prefetch: ["Transactions"] });
        var prev = Number(state[key + "_prev"] || 0);
        updates[key + "_prev"] = snap.count;                                                      // remembered for the next check
        if(snap.count === 0 || prev === 0) return;                                                // nothing waiting, or it only just arrived
        var msg = reminderMessage_(snap);
        var res = sendPushToToken_(token, msg.title, msg.body, { kind: "reminder", tag: "pending-reminder" });
        if(res && res.sent === false && res.code !== 0) return;                                   // the push service refused: try again next time
        updates[key + "_last"] = nowMs; updates[key + "_day"] = today; updates[key + "_n"] = sentToday + 1;
        sent++;
      }catch(personErr){
        try{ logAI("REMINDER_ERROR", "one person: " + String(personErr && personErr.message).slice(0, 150)); }catch(ignoreLog){}
      }
    });
    if(Object.keys(updates).length) fsCommit_([{ merge: { path: REMINDER_STATE_DOC_, fields: updates, adds: [] } }]);
    try{ fsFlushUsage_(); }catch(ignoreFlush){}
  }catch(err){
    try{ logAI("REMINDER_ERROR", String(err && err.message).slice(0, 150)); }catch(ignoreLog2){}
  }
  return sent;
}
