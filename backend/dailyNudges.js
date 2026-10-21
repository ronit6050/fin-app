// dailyNudges.js (added 2026-10-21)
//
// PLAIN-ENGLISH WHAT THIS IS: three short notifications a day that bring a person back to the app, built from THEIR OWN data and sent only
// to THEIR OWN phone. Everything is based on the "how much can I spend per day until the next salary" number the Home card already shows
// (runway.js: balance you confirmed, minus bills still ahead, divided by the days to salary).
//
//   8:00  morning   "Today's limit: ₹1,150"            / "18 days to salary"
//                   (running short:) "Keep today under ₹900" / "Money runs out 4 days before salary"
//                   (balance missing or older than 7 days:) "Confirm your balance" / "to get today's limit"
//   13:00 midday    "₹830 left today" / "You're ahead, keep going"   (close to the limit: "Go easy this evening")
//                   "Clean start so far" / "₹1,150 still free"       (nothing spent yet)
//   21:00 evening   "₹170 under today's limit" / "Tomorrow: ₹1,175"  (over: "₹200 over today" / "Tomorrow: ₹1,100")
//                   The evening one is the old 9pm summary (dailySummary.js) made short; it falls back to "You spent ₹X today" when no limit is known.
//
// Texts are deliberately tiny: people skip long notifications. The morning limit is remembered (property NUDGE_LIMIT) so midday and
// evening measure against the SAME number all day. The Settings switch "Evening summary" (SETTING_DAILY_SUMMARY_OFF) turns all three off.
// Morning and midday are skipped if the server only wakes up too late (a 8:00 limit at 9pm would be silly). Best-effort: one person's
// problem never stops the others and nothing here changes anyone's data.

var NUDGE_MORNING_ENDS_MIN_ = 12 * 60;       // the morning one is only sent before 12:00 India time
var NUDGE_MIDDAY_ENDS_MIN_ = 17 * 60;        // the midday one is only sent before 17:00 India time

function nudgeMoney_(n){ return dailySummaryMoney_(n); }

function nudgeToday_(){
  try{ return timerIstClock_().date; }catch(e){ return Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd"); }
}

// Everything the three texts need, for the CURRENT person (call inside v2dbRun_ for that person). Returns null if it cannot be worked out.
function dailyNudgeFacts_(nowMs){
  try{
    var ss = dbSs_();
    var txnSheet = ss.getSheetByName("Transactions"), cashSheet = ss.getSheetByName("Cash");
    var txn = txnSheet ? txnSheet.getDataRange().getValues() : [[]];
    var cash = cashSheet ? cashSheet.getDataRange().getValues() : [[]];
    var now = new Date(nowMs || Date.now());
    var year = Number(Utilities.formatDate(now, "Asia/Kolkata", "yyyy")), month = Number(Utilities.formatDate(now, "Asia/Kolkata", "MM"));
    var today = getTodaySummary(txn, cash);
    var monthTotals = getMonthlyAnalysis(year, month, txn, cash);
    var cc = getCCAdvisorData(txn, cash, monthTotals, 0);
    var rw = (typeof buildRunwayForDashboard_ === "function") ? buildRunwayForDashboard_(txn, monthTotals, cc) : null;
    if(!rw) return null;
    var pending = 0;
    for(var i = 1; i < txn.length; i++){
      var r = txn[i];
      if(String(r[15] || "").trim() !== "YES" || String(r[12] || "").trim() !== "") continue;
      if(typeof isEmptyTransactionRow_ === "function" && isEmptyTransactionRow_(r)) continue;
      pending++;
    }
    return { rw: rw, spent: Number(today.total) || 0, pending: pending };
  }catch(err){
    try{ logAI("NUDGE_FACTS_ERROR", String(err && err.message).slice(0, 150)); }catch(ignore){}
    return null;
  }
}

// True when the runway is fresh enough to talk about a daily limit.
function nudgeHasLimit_(rw){
  return !!(rw && rw.hasCheckpoint && !rw.askBalance && rw.daysToSalary > 0 && rw.maxPerDay !== null && rw.maxPerDay !== undefined);
}

// Morning: { title, body } or null (nothing useful to say).
function nudgeMorningMsg_(rw){
  if(!rw) return null;
  if(!rw.hasCheckpoint || rw.askBalance) return { title: "Confirm your balance", body: "to get today's limit" };
  if(!nudgeHasLimit_(rw)) return null;
  var days = rw.daysToSalary + (rw.daysToSalary === 1 ? " day" : " days") + " to salary";
  if(rw.maxPerDay <= 0) return { title: "Spend nothing extra today", body: days };
  if(rw.shortByDays > 0) return { title: "Keep today under " + nudgeMoney_(rw.maxPerDay), body: "Money runs out " + rw.shortByDays + (rw.shortByDays === 1 ? " day" : " days") + " before salary" };
  return { title: "Today's limit: " + nudgeMoney_(rw.maxPerDay), body: days };
}

// The limit to measure today against: the one the morning nudge remembered, else worked out again from now (add back what was spent today).
function nudgeLimit_(rw, spent){
  try{
    var saved = String(dbProps_().getProperty("NUDGE_LIMIT") || "").split("|");
    if(saved.length === 2 && saved[0] === nudgeToday_() && isFinite(Number(saved[1]))) return Number(saved[1]);
  }catch(ignore){}
  var available = (Number(rw.estimatedBalance) || 0) - (Number(rw.billsAhead) || 0);
  return Math.max(0, Math.floor((Math.max(0, available) + spent) / rw.daysToSalary));
}

// Midday: { title, body } or null.
function nudgeMiddayMsg_(rw, spent, limit){
  if(!nudgeHasLimit_(rw) || !(limit > 0)) return null;
  if(!(spent > 0)) return { title: "Clean start so far", body: nudgeMoney_(limit) + " still free" };
  var left = limit - spent;
  if(left < 0) return { title: nudgeMoney_(-left) + " over today's limit", body: "Skip extras tonight" };
  if(left <= limit * 0.2) return { title: nudgeMoney_(left) + " left today", body: "Go easy this evening" };
  return { title: nudgeMoney_(left) + " left today", body: "You're ahead, keep going" };
}

// Evening: { title, body } or null (then the caller falls back to the plain "You spent ₹X today").
function nudgeEveningMsg_(rw, spent, limit){
  if(!nudgeHasLimit_(rw) || !(limit > 0)) return null;
  var available = Math.max(0, (Number(rw.estimatedBalance) || 0) - (Number(rw.billsAhead) || 0));
  var tomorrow = rw.daysToSalary > 1 ? "Tomorrow: " + nudgeMoney_(Math.floor(available / (rw.daysToSalary - 1))) : "Salary is almost here";
  if(!(spent > 0)) return { title: "No spending today", body: tomorrow };
  var diff = limit - spent;
  if(diff >= 0) return { title: nudgeMoney_(diff) + " under today's limit", body: tomorrow };
  return { title: nudgeMoney_(-diff) + " over today", body: tomorrow };
}

// Builds the evening text for the current person, or null. Used by dailySummaryRun_.
function dailyNudgeEveningBuild_(){
  var f = dailyNudgeFacts_();
  if(!f || !nudgeHasLimit_(f.rw)) return null;
  return nudgeEveningMsg_(f.rw, f.spent, nudgeLimit_(f.rw, f.spent));
}

// Runs one slot ("morning" | "midday") for everyone with the full app. Returns how many were sent. Never throws.
function dailyNudgeRun_(slot){
  var sent = 0;
  try{
    var minutes = timerIstClock_().minutes;
    var endsAt = slot === "morning" ? NUDGE_MORNING_ENDS_MIN_ : NUDGE_MIDDAY_ENDS_MIN_;
    if(minutes >= endsAt) return 0;                                    // the server woke up too late for this one: skip it
  }catch(ignoreClock){}
  dailySummaryPeople_().forEach(function(email){
    try{
      var token = splitNotifyToken_(email);
      if(!token) return;
      var msg = v2dbRun_(email, function(){
        if(String(dbProps_().getProperty("SETTING_DAILY_SUMMARY_OFF") || "") === "1") return null;
        var f = dailyNudgeFacts_();
        if(!f) return null;
        if(slot === "morning"){
          var m = nudgeMorningMsg_(f.rw);
          if(m && nudgeHasLimit_(f.rw)){ try{ dbProps_().setProperty("NUDGE_LIMIT", nudgeToday_() + "|" + f.rw.maxPerDay); }catch(ignoreSave){} }
          return m;
        }
        if(!nudgeHasLimit_(f.rw)) return null;
        return nudgeMiddayMsg_(f.rw, f.spent, nudgeLimit_(f.rw, f.spent));
      }, { prefetch: ["Transactions", "Cash", "FinancialEvents", "_Props"] });
      if(!msg) return;
      sendPushToToken_(token, msg.title, msg.body, { kind: "nudge" });
      sent++;
    }catch(err){
      try{ logAI("NUDGE_ERROR", slot + ": " + String(err && err.message).slice(0, 150)); }catch(ignoreLog){}
    }
  });
  try{ fsFlushUsage_(); }catch(ignoreFlush){}
  return sent;
}

function dailyNudgeMorningRun_(){ return dailyNudgeRun_("morning"); }
function dailyNudgeMiddayRun_(){ return dailyNudgeRun_("midday"); }
