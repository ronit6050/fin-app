// dailySummary.js (added 2026-10-17)
//
// PLAIN-ENGLISH WHAT THIS IS: the 9pm "how much you spent today" notification, for EVERY person who has the full app (the owner and
// each friend switched on), built from THEIR OWN private data and sent only to THEIR OWN phone. It replaces the owner-only 8pm cash
// check-in while the new server is ticking (the old Apps Script check-in is still the fallback when it is not).
//
//   "You spent ₹1,240 today"
//   "Biggest: Food ₹520. ₹180 above your usual day (₹1,060). 2 payments still need a note."
//
// What counts as spending is EXACTLY what the Today screen counts (getTodaySummary): your own share of split payments, cash included;
// credit card bill payments, wallet top-ups, loans and Rent/EMI/SIP are not day-to-day spend and are left out.
// "Usual day" = this month's spending so far (not counting today) divided by the days before today; shown only from the 4th of the month.
// A day with no spending still sends "No spending today" (silence could look like a broken app). A person can switch it off in
// Settings (property SETTING_DAILY_SUMMARY_OFF = "1"). Runs once a day from the new server's tick (fnTimer.js, job key "cash").
// Everything is best-effort: one person's problem never stops the others, and nothing here ever changes anyone's data.

function dailySummaryMoney_(n){
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

// Builds { title, body } from the current person's data (call inside v2dbRun_ for that person). Pure apart from reading.
// nowMs lets tests set the clock; the day/month are India time.
function dailySummaryBuild_(nowMs){
  var ss = dbSs_();
  var txnSheet = ss.getSheetByName("Transactions"), cashSheet = ss.getSheetByName("Cash");
  var txn = txnSheet ? txnSheet.getDataRange().getValues() : [[]];
  var cash = cashSheet ? cashSheet.getDataRange().getValues() : [[]];
  var now = new Date(nowMs || Date.now());
  var today = getTodaySummary(txn, cash);
  var total = Number(today.total) || 0;

  var parts = [];
  if(total > 0){
    var top = today.categories && today.categories[0];
    if(top && top.amount > 0) parts.push("Biggest: " + top.category + " " + dailySummaryMoney_(top.amount) + ".");
    if(Number(today.cashSpend) > 0 && Number(today.bankSpend) > 0) parts.push("Cash " + dailySummaryMoney_(today.cashSpend) + ".");
    // The usual day, from the 4th of the month (before that there is too little to compare with).
    try{
      var dom = Number(Utilities.formatDate(now, "Asia/Kolkata", "dd"));
      if(dom >= 4){
        var year = Number(Utilities.formatDate(now, "Asia/Kolkata", "yyyy")), month = Number(Utilities.formatDate(now, "Asia/Kolkata", "MM"));
        var monthTotal = Number(getMonthlyAnalysis(year, month, txn, cash).totalDebit) || 0;
        var usual = (monthTotal - total) / (dom - 1);
        if(usual > 0){
          var diff = total - usual;
          if(Math.abs(diff) < usual * 0.1) parts.push("About a usual day (" + dailySummaryMoney_(usual) + ").");
          else if(diff > 0) parts.push(dailySummaryMoney_(diff) + " above your usual day (" + dailySummaryMoney_(usual) + ").");
          else parts.push(dailySummaryMoney_(-diff) + " below your usual day (" + dailySummaryMoney_(usual) + ").");
        }
      }
    }catch(ignoreCompare){}
  }
  // Payments that were alerted but still have no note (same test the Pending screen starts from).
  var pending = 0;
  for(var i = 1; i < txn.length; i++){
    var r = txn[i];
    if(String(r[15] || "").trim() !== "YES" || String(r[12] || "").trim() !== "") continue;
    if(typeof isEmptyTransactionRow_ === "function" && isEmptyTransactionRow_(r)) continue;
    pending++;
  }
  if(pending > 0) parts.push(pending + (pending === 1 ? " payment still needs" : " payments still need") + " a note.");

  if(total > 0) return { title: "You spent " + dailySummaryMoney_(total) + " today", body: parts.join(" "), total: total, pending: pending };
  return { title: "No spending today", body: ("Nothing spent today. " + parts.join(" ")).trim(), total: 0, pending: pending };
}

// Everyone with the full app: the owner (if on the private copy) and every friend switched on.
function dailySummaryPeople_(){
  var people = [];
  try{ if(typeof v2OwnerOn_ === "function" && v2OwnerOn_()) people.push(v2OwnerEmail_()); }catch(ignoreOwner){}
  try{ v2dbUsersOn_().forEach(function(e){ var k = splitsKey_(e); if(k && people.indexOf(k) === -1) people.push(k); }); }catch(ignoreUsers){}
  return people;
}

// The daily job. Returns how many people were sent a summary (for logs and tests).
function dailySummaryRun_(){
  var sent = 0;
  dailySummaryPeople_().forEach(function(email){
    try{
      var token = splitNotifyToken_(email);
      if(!token) return;                                              // no phone registered: nothing to send to
      var msg = v2dbRun_(email, function(){
        if(String(dbProps_().getProperty("SETTING_DAILY_SUMMARY_OFF") || "") === "1") return null;     // this person switched it off
        return dailySummaryBuild_();
      }, { prefetch: ["Transactions", "Cash", "_Props"] });
      if(!msg) return;
      sendPushToToken_(token, msg.title, msg.body, { kind: "summary" });
      sent++;
    }catch(err){
      try{ logAI("DAILY_SUMMARY_ERROR", "one person: " + String(err && err.message).slice(0, 150)); }catch(ignoreLog){}
    }
  });
  try{ fsFlushUsage_(); }catch(ignoreFlush){}
  return sent;
}
