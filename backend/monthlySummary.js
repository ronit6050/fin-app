// monthlySummary.js (added 2026-10-31)
//
// PLAIN-ENGLISH WHAT THIS IS: one short notification on the 1st of each month, to every person with the full app, from THEIR OWN data,
// on THEIR OWN phone: what happened last month.
//
//   "October: you spent ₹10,581"
//   "₹2,100 less than September. Biggest: Food ₹5,881 (56%). You saved ₹2,350 of your goal."
//
// The numbers are the Analysis screen's own (getMonthlyAnalysis): the same spend, the same exclusions (card bill payments, wallet top-ups,
// loans, Rent/EMI/SIP), the same Savings figure. A month with no spending at all sends nothing (a new person should not get "you spent ₹0").
// A person can switch it off with the same Settings switch as the daily nudges (SETTING_DAILY_SUMMARY_OFF). Runs from the new server's tick
// (fnTimer.js job key "monthly", 9:45 India time) and only does anything when today is the 1st; the tick's own once-a-day bookkeeping means
// a late tick still sends it that day. Best effort: one person's problem never stops the others, and nothing here changes anyone's data.

var MONTHS_LONG_ = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthlySummaryMoney_(n){
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

// Builds { title, body } for the month that just ended, or null when there is nothing worth saying. Call inside v2dbRun_ for that person.
function monthlySummaryBuild_(nowMs){
  var now = new Date(nowMs || Date.now());
  var y = Number(Utilities.formatDate(now, "Asia/Kolkata", "yyyy")), m = Number(Utilities.formatDate(now, "Asia/Kolkata", "M"));
  var pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;           // the month that just ended
  var qm = pm === 1 ? 12 : pm - 1, qy = pm === 1 ? py - 1 : py;      // the one before it

  var ss = dbSs_();
  var txnSheet = ss.getSheetByName("Transactions"), cashSheet = ss.getSheetByName("Cash");
  var txn = txnSheet ? txnSheet.getDataRange().getValues() : [[]];
  var cash = cashSheet ? cashSheet.getDataRange().getValues() : [[]];

  var last = getMonthlyAnalysis(py, pm, txn, cash);
  var spent = Number(last.totalDebit) || 0;
  if(spent <= 0) return null;
  var before = getMonthlyAnalysis(qy, qm, txn, cash);
  var beforeSpent = Number(before.totalDebit) || 0;

  var parts = [];
  if(beforeSpent > 0){
    var diff = spent - beforeSpent;
    var name = MONTHS_LONG_[qm - 1];
    if(Math.abs(diff) < beforeSpent * 0.03) parts.push("About the same as " + name + ".");
    else if(diff > 0) parts.push(monthlySummaryMoney_(diff) + " more than " + name + ".");
    else parts.push(monthlySummaryMoney_(-diff) + " less than " + name + ".");
  }
  var top = (last.categories || []).slice().sort(function(a, b){ return b.amount - a.amount; })[0];
  if(top && top.amount > 0) parts.push("Biggest: " + top.category + " " + monthlySummaryMoney_(top.amount) + " (" + Math.round(top.amount / spent * 100) + "%).");
  if(Number(last.savingGoal) > 0 && last.saved !== undefined && last.saved !== null){
    parts.push("You saved " + monthlySummaryMoney_(Math.max(0, last.saved)) + " of your " + monthlySummaryMoney_(last.savingGoal) + " goal.");
  }
  return { title: MONTHS_LONG_[pm - 1] + ": you spent " + monthlySummaryMoney_(spent), body: parts.join(" ") };
}

// The job. Returns how many people were sent one (for logs and tests). Does nothing on any day but the 1st (India time).
function monthlySummaryRun_(nowMs){
  var now = new Date(nowMs || Date.now());
  if(Number(Utilities.formatDate(now, "Asia/Kolkata", "d")) !== 1) return 0;
  var sent = 0;
  dailySummaryPeople_().forEach(function(email){
    try{
      var token = splitNotifyToken_(email);
      if(!token) return;
      var msg = v2dbRun_(email, function(){
        if(String(dbProps_().getProperty("SETTING_DAILY_SUMMARY_OFF") || "") === "1") return null;
        return monthlySummaryBuild_(nowMs);
      }, { prefetch: ["Transactions", "Cash", "FinancialEvents", "Savings", "Goals", "Investments", "_Props"] });
      if(!msg) return;
      sendPushToToken_(token, msg.title, msg.body, { kind: "summary" });
      sent++;
    }catch(err){
      try{ logAI("MONTHLY_SUMMARY_ERROR", "one person: " + String(err && err.message).slice(0, 150)); }catch(ignoreLog){}
    }
  });
  try{ fsFlushUsage_(); }catch(ignoreFlush){}
  return sent;
}
