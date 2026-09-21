// obligationReminders.js (added 2026-09-21)
//
// PLAIN-ENGLISH WHAT THIS IS: Rent, EMI and SIP/Investment payments are
// only ever recognized by this app AFTER they happen (see
// financialEvents.js — it matches a transaction to a known obligation
// once the bank has already taken the money). This file adds a
// BEFORE-it-happens heads-up instead: "your Home Loan EMI is usually
// around the 5th, and today is the 2nd — in 3 days."
//
// HOW IT WORKS, IN PLAIN STEPS:
// 1. FinancialEvents (financialEvents.js) already gets one new row
//    appended every single time a Rent/EMI/Investment payment is
//    confirmed (see recordFinancialEvent there) — so it's already a
//    running history of "when did this obligation happen," we just
//    weren't using it that way yet.
// 2. For each distinct obligation (Rent, or a named EMI/Investment like
//    "Home Loan EMI"), look at every real Transactions row that belongs
//    to it and find which day-of-month it MOST OFTEN lands on (e.g. if
//    it landed on the 5th three times and the 4th once, "the 5th" is
//    the answer).
// 3. Every day, check: is today exactly 3 days before that usual day,
//    AND has it not already happened this month? If both are true,
//    send one heads-up push.
// 4. Remember (in Script Properties — the same small-memory place this
//    app already stores things like the saved push token) that this
//    obligation was already reminded about this month, so re-running
//    the daily check (or it simply running every day for the rest of
//    the month) never sends the same reminder twice.
//
// This deliberately does NOT try to guess with less than 2 real past
// occurrences — no "your first-ever confirmed Rent payment implies a
// pattern," since one data point isn't a pattern, it's a coincidence.

// ---------------------------------------------------------------------
// Small date helpers
// ---------------------------------------------------------------------

// Clamps a day-of-month (e.g. 31) down to the real last day of a
// specific month (e.g. 28/29/30) — so this can never try to build an
// invalid date like "February 31st."
function clampDayToMonth_(year, month, day){
  var lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDayOfMonth);
}

// The most common value in a list of day-of-month numbers (e.g.
// [3, 3, 4, 3] -> 3). A tie is broken by whichever value was seen
// first in the list — with real payment history an exact tie is rare,
// and either choice would only ever be off by a day or two anyway.
function mostCommonDayOfMonth_(days){
  var counts = {};
  var best = null;
  var bestCount = 0;
  days.forEach(function(d){
    counts[d] = (counts[d] || 0) + 1;
    if(counts[d] > bestCount){
      bestCount = counts[d];
      best = d;
    }
  });
  return best;
}

// "5" -> "5th", "3" -> "3rd", "21" -> "21st" — just for the push text.
function ordinalDay_(day){
  var d = Number(day);
  if(d % 10 === 1 && d !== 11) return d + "st";
  if(d % 10 === 2 && d !== 12) return d + "nd";
  if(d % 10 === 3 && d !== 13) return d + "rd";
  return d + "th";
}

// ---------------------------------------------------------------------
// Reading the real history
// ---------------------------------------------------------------------

// Every distinct obligation ever confirmed, read from the FinancialEvents
// sheet (financialEvents.js's recordFinancialEvent appends one row here
// every time a Rent/EMI/Investment payment is confirmed). Rent has no
// Name (there's only ever one Rent, see financialEvents.js's own
// comments) — grouped under its Type alone. EMI/Investment each have
// their own Name (e.g. "Home Loan EMI", "Nifty 50 SIP") since there can
// be more than one of those.
function getDistinctObligations_(financialEventsData){
  var seen = {};
  var list = [];
  for(var i = 1; i < financialEventsData.length; i++){
    var type = (financialEventsData[i][0] || "").toString().trim();
    var name = (financialEventsData[i][4] || "").toString().trim();
    if(!type) continue;
    var key = type + "||" + name;
    if(seen[key]) continue;
    seen[key] = true;
    list.push({ type: type, name: name, label: name || type });
  }
  return list;
}

// Every real Transactions row that belongs to one specific obligation.
// For a named obligation (EMI/Investment), matches column S
// (FinancialEventName, 1-based col 19) exactly. For Rent (no name —
// column S is never set for it, see saveTransactionNote in PWA.js),
// matches by column R (FinancialEvent, 1-based col 18) alone, since
// there's only ever one Rent.
function findObligationHistory_(type, name, txnData){
  var rows = [];
  for(var i = 1; i < txnData.length; i++){
    var rowDate = txnData[i][0];
    if(!rowDate) continue;
    var rowType = (txnData[i][17] || "").toString().trim(); // column R
    if(rowType !== type) continue;
    if(name){
      var rowName = (txnData[i][18] || "").toString().trim(); // column S
      if(rowName !== name) continue;
    }
    rows.push({ date: new Date(rowDate), amount: Number(txnData[i][5]) || 0 });
  }
  return rows;
}

// Turns an obligation's type+name (e.g. "EMI" + "Home Loan EMI") into a
// safe, short Script Property key for the "already reminded this
// month" memory below. Built from type+name — NOT the display label —
// so two differently-formatted but same-looking names (e.g. "Car-EMI"
// vs "Car EMI", both display the same either way) can never collide
// into the same key and silently swallow each other's reminder (found
// by change-reviewer 2026-09-21).
function obligationPropertyKey_(type, name){
  var raw = type.toString().toLowerCase() + "_" + (name || "").toString().toLowerCase();
  return "OBLIGATION_REMINDED_" + raw.replace(/[^a-z0-9]+/g, "_");
}

// ---------------------------------------------------------------------
// The actual prediction — pure function, no Sheets/Properties/push
// calls in here, so this can be tested directly with plain data (see
// backend/tests/upcomingObligationReminder.test.js) and reused by both
// the real trigger function and the manual dry-run test helper below.
// ---------------------------------------------------------------------
//
// Returns one status object per distinct obligation:
//   { label, type, name, enoughHistory: false }  — fewer than 2 real
//     past occurrences, no prediction attempted at all.
//   { label, type, name, enoughHistory: true, typicalDay, avgAmount,
//     alreadyThisMonth, expectedDate, daysUntil, shouldRemindToday }
//     — shouldRemindToday is true only when daysUntil === 3 AND it
//     hasn't already happened this month.
function computeObligationStatuses_(financialEventsData, txnData, today){
  var obligations = getDistinctObligations_(financialEventsData);

  return obligations.map(function(ob){
    var history = findObligationHistory_(ob.type, ob.name, txnData);

    if(history.length < 2){
      return { label: ob.label, type: ob.type, name: ob.name, enoughHistory: false };
    }

    var daysOfMonth = history.map(function(h){ return h.date.getDate(); });
    var typicalDay = mostCommonDayOfMonth_(daysOfMonth);

    var alreadyThisMonth = history.some(function(h){
      return h.date.getFullYear() === today.getFullYear() && h.date.getMonth() === today.getMonth();
    });

    // The next real calendar date this typical day falls on — handles
    // month-end correctly (e.g. typical day 31 in a 30-day month), and
    // correctly rolls into next month if this month's version of that
    // day has already passed.
    var candidateDay = clampDayToMonth_(today.getFullYear(), today.getMonth(), typicalDay);
    var candidate = new Date(today.getFullYear(), today.getMonth(), candidateDay);
    if(candidate < today){
      var nextMonth = today.getMonth() + 1;
      var nextYear = today.getFullYear();
      if(nextMonth > 11){ nextMonth = 0; nextYear++; }
      var nextDay = clampDayToMonth_(nextYear, nextMonth, typicalDay);
      candidate = new Date(nextYear, nextMonth, nextDay);
    }

    var daysUntil = Math.round((candidate - today) / 86400000);
    var avgAmount = history.reduce(function(s, h){ return s + h.amount; }, 0) / history.length;

    return {
      label: ob.label,
      type: ob.type,
      name: ob.name,
      enoughHistory: true,
      typicalDay: typicalDay,
      avgAmount: avgAmount,
      alreadyThisMonth: alreadyThisMonth,
      expectedDate: candidate,
      daysUntil: daysUntil,
      shouldRemindToday: !alreadyThisMonth && daysUntil === 3
    };
  });
}

// ---------------------------------------------------------------------
// The real, scheduled function.
//
// ADD A MANUAL TRIGGER FOR THIS — Apps Script triggers are always added
// by hand from the editor's Triggers page in this project (never
// created by code). Suggested: function checkUpcomingObligations,
// time-driven, day timer, run once a day, 8am-9am window (any time
// before your usual "check the app" habit works — mornings give the
// most notice before a 3-days-away payment).
// ---------------------------------------------------------------------
function checkUpcomingObligations(){
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var financialEventsSheet = ss.getSheetByName("FinancialEvents");
    var txnSheet = ss.getSheetByName("Transactions");
    if(!financialEventsSheet || !txnSheet) return;

    var financialEventsData = financialEventsSheet.getDataRange().getValues();
    var txnData = txnSheet.getDataRange().getValues();

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var thisMonthKey = today.getFullYear() + "-" + (today.getMonth() + 1);

    var props = PropertiesService.getScriptProperties();
    var fmt = function(n){ return Math.round(n).toLocaleString('en-IN'); };

    var statuses = computeObligationStatuses_(financialEventsData, txnData, today);

    statuses.forEach(function(status){
      if(!status.enoughHistory || !status.shouldRemindToday) return;

      // Idempotent — never sends the same obligation's reminder twice
      // in the same month, even if this function is run more than once
      // today, or every day for the rest of the month (once sent, the
      // property below stays set until the month key itself changes).
      var propKey = obligationPropertyKey_(status.type, status.name) + "_" + thisMonthKey;
      if(props.getProperty(propKey)) return;

      sendMessage(
        "🔔 Upcoming: " + status.label + "\n\n" +
        "Expected around the " + ordinalDay_(status.typicalDay) + " (in 3 days) — usually ₹" +
        fmt(status.avgAmount) + ", based on your last payments.\n" +
        "Tap Home to check when it happens."
      );

      props.setProperty(propKey, "sent");
    });

  }catch(err){
    logAI("UPCOMING_OBLIGATION_ERROR", err.toString());
  }
}

// Manual dry-run helper — run by hand from the Apps Script editor to see
// exactly what checkUpcomingObligations() would decide right now,
// WITHOUT sending any real push and WITHOUT writing the "already
// reminded" Script Property (so it can never accidentally block a real
// reminder from firing later). Prints via Logger.log — View > Logs (or
// View > Executions) after running.
function testUpcomingObligations(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var financialEventsSheet = ss.getSheetByName("FinancialEvents");
  var txnSheet = ss.getSheetByName("Transactions");
  if(!financialEventsSheet || !txnSheet){
    Logger.log("FinancialEvents or Transactions sheet not found.");
    return;
  }

  var financialEventsData = financialEventsSheet.getDataRange().getValues();
  var txnData = txnSheet.getDataRange().getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var fmt = function(n){ return Math.round(n).toLocaleString('en-IN'); };

  var statuses = computeObligationStatuses_(financialEventsData, txnData, today);

  if(statuses.length === 0){
    Logger.log("No obligations found in FinancialEvents yet.");
    return;
  }

  statuses.forEach(function(status){
    if(!status.enoughHistory){
      Logger.log(status.label + ": not enough history yet (needs 2+ confirmed payments).");
      return;
    }
    Logger.log(
      status.label + ": usually around the " + ordinalDay_(status.typicalDay) +
      " (~₹" + fmt(status.avgAmount) + "), already happened this month: " + status.alreadyThisMonth +
      ", days until expected: " + status.daysUntil +
      ", would remind today: " + status.shouldRemindToday
    );
  });
}
