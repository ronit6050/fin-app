// backend/tests/upcomingObligationReminder.test.js
//
// Plain-English what this checks: the app used to only recognize a
// Rent/EMI/SIP payment AFTER it happened. This new feature
// (obligationReminders.js) looks at your real payment history, works
// out which day of the month an obligation usually lands on, and sends
// ONE heads-up push 3 days before that day — so you get a warning
// before the money leaves, not just a note after it already has.
//
// This test loads the REAL backend source (obligationReminders.js)
// into a small fake Google Sheets/Properties/push environment and
// proves:
//   1. The "most common day of the month" calculation works on
//      real-shaped, slightly messy history (not every payment lands on
//      the exact same day).
//   2. An obligation with fewer than 2 real past occurrences is
//      skipped — never guesses off a single data point.
//   3. An obligation that's already happened THIS calendar month is
//      never re-reminded, even if the math would otherwise say "in 3
//      days."
//   4. The real end-to-end trigger function (checkUpcomingObligations)
//      is genuinely idempotent — running it twice on the same day
//      sends exactly ONE push, not two.
//   5. Rent (which has no Name — there's only ever one) and a named EMI
//      are both recognized correctly, and don't cross-match each other.
//
// Run with: node backend/tests/upcomingObligationReminder.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(condition, message){
  if(!condition){
    console.error("FAIL: " + message);
    process.exitCode = 1;
  } else {
    console.log("PASS: " + message);
  }
}

// ---------------------------------------------------------------------
// Loads obligationReminders.js into a sandbox with a tiny fake
// PropertiesService (in-memory) and a sendMessage/logAI spy so pushes
// can be counted without touching anything real.
// ---------------------------------------------------------------------
function loadSandbox(){
  const store = {};
  const sentMessages = [];
  const loggedErrors = [];

  const sandbox = {
    PropertiesService: {
      getScriptProperties: function(){
        return {
          getProperty: function(key){ return store.hasOwnProperty(key) ? store[key] : null; },
          setProperty: function(key, val){ store[key] = val; }
        };
      }
    },
    Logger: { log: function(){} },
    sendMessage: function(text){ sentMessages.push(text); },
    logAI: function(type, msg){ loggedErrors.push({ type: type, msg: msg }); },
    console: console
  };
  vm.createContext(sandbox);

  const src = fs.readFileSync(path.join(__dirname, "..", "obligationReminders.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "obligationReminders.js" });

  return { sandbox: sandbox, store: store, sentMessages: sentMessages, loggedErrors: loggedErrors };
}

// Same 19-column shape used elsewhere in this project's tests (e.g.
// ccBillPaymentTwoCards.test.js's mkTxnRow) — only the columns this
// feature actually reads (Date=0, Amount=5, FinancialEvent=17,
// FinancialEventName=18) matter here.
function mkTxnRow(date, amount, financialEvent, financialEventName){
  const row = new Array(19).fill("");
  row[0] = date;
  row[5] = amount;
  row[17] = financialEvent || "";
  row[18] = financialEventName || "";
  return row;
}
const TXN_HEADER = new Array(19).fill("");

function financialEventsRow(type, amount, name){
  return [type, amount, "", new Date(), name || ""];
}
const FE_HEADER = ["Type", "Amount", "Counterparty", "Confirmed", "Name"];

// A fixed "today" for every test below, so results never depend on the
// real calendar date when this test happens to be run.
function makeToday(year, month, day){ // month is 1-based here for readability
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------
// Test 1 — day-of-month mode calculation on real-shaped (slightly
// messy) history: an EMI that mostly lands on the 5th, but once landed
// on the 4th and once on the 6th.
// ---------------------------------------------------------------------
(function testModeCalculation(){
  const { sandbox } = loadSandbox();

  const today = makeToday(2026, 3, 2); // 3 days before the 5th
  const financialEventsData = [
    FE_HEADER,
    financialEventsRow("EMI", 4000, "Home Loan EMI")
  ];
  const txnData = [
    TXN_HEADER,
    mkTxnRow("2025-12-04", 4000, "EMI", "Home Loan EMI"), // the 4th
    mkTxnRow("2026-01-05", 4000, "EMI", "Home Loan EMI"), // the 5th
    mkTxnRow("2026-02-06", 4000, "EMI", "Home Loan EMI")  // the 6th
    // No occurrence yet this month (March) — matches the "hasn't
    // happened yet" precondition for a reminder.
  ];

  // Add one more "5th" occurrence so 5 is genuinely the most common
  // (2 votes for 5, 1 each for 4 and 6).
  txnData.push(mkTxnRow("2025-11-05", 4000, "EMI", "Home Loan EMI"));

  const statuses = sandbox.computeObligationStatuses_(financialEventsData, txnData, today);
  const emi = statuses.find((s) => s.label === "Home Loan EMI");

  assert(!!emi, "the Home Loan EMI obligation was found");
  assert(emi.enoughHistory === true, "4 real past occurrences count as enough history");
  assert(emi.typicalDay === 5, "the most common day-of-month (5th, seen twice) wins over the 4th/6th, got " + emi.typicalDay);
  assert(emi.avgAmount === 4000, "the average historical amount is correct (all four were ₹4000), got " + emi.avgAmount);
  assert(emi.daysUntil === 3, "today (Mar 2) is exactly 3 days before the typical day (Mar 5), got " + emi.daysUntil);
  assert(emi.shouldRemindToday === true, "a reminder should fire today");
})();

// ---------------------------------------------------------------------
// Test 2 — fewer than 2 historical occurrences: skip silently, don't
// guess off one data point.
// ---------------------------------------------------------------------
(function testNotEnoughHistorySkipped(){
  const { sandbox } = loadSandbox();

  const today = makeToday(2026, 3, 2);
  const financialEventsData = [
    FE_HEADER,
    financialEventsRow("Investment", 5000, "Nifty 50 SIP")
  ];
  const txnData = [
    TXN_HEADER,
    mkTxnRow("2026-02-05", 5000, "Investment", "Nifty 50 SIP") // only ONE real occurrence
  ];

  const statuses = sandbox.computeObligationStatuses_(financialEventsData, txnData, today);
  const sip = statuses.find((s) => s.label === "Nifty 50 SIP");

  assert(!!sip, "the SIP obligation was found");
  assert(sip.enoughHistory === false, "a single past occurrence is correctly treated as NOT enough history");
  assert(sip.typicalDay === undefined, "no typical day is computed/guessed when history is insufficient");
})();

// ---------------------------------------------------------------------
// Test 3 — already happened this month: even if the math would
// otherwise say "3 days away," an obligation that's already landed
// this calendar month is never re-reminded.
// ---------------------------------------------------------------------
(function testAlreadyHappenedThisMonthSkipped(){
  const { sandbox } = loadSandbox();

  const today = makeToday(2026, 3, 2); // 3 days before the 5th, same as test 1
  const financialEventsData = [
    FE_HEADER,
    financialEventsRow("EMI", 4000, "Home Loan EMI")
  ];
  const txnData = [
    TXN_HEADER,
    mkTxnRow("2026-01-05", 4000, "EMI", "Home Loan EMI"),
    mkTxnRow("2026-02-05", 4000, "EMI", "Home Loan EMI"),
    // Already happened once THIS month (an early/irregular payment on
    // the 1st) — should block the reminder even though daysUntil still
    // works out to 3 for the usual 5th.
    mkTxnRow("2026-03-01", 4000, "EMI", "Home Loan EMI")
  ];

  const statuses = sandbox.computeObligationStatuses_(financialEventsData, txnData, today);
  const emi = statuses.find((s) => s.label === "Home Loan EMI");

  assert(emi.alreadyThisMonth === true, "correctly detects the obligation already happened this month");
  assert(emi.shouldRemindToday === false, "no reminder fires for an obligation that's already happened this month");
})();

// ---------------------------------------------------------------------
// Test 4 — Rent (no Name, only ever one) and a named EMI don't
// cross-match each other.
// ---------------------------------------------------------------------
(function testRentAndEmiDontCrossMatch(){
  const { sandbox } = loadSandbox();

  const today = makeToday(2026, 3, 27); // 3 days before the 30th
  const financialEventsData = [
    FE_HEADER,
    financialEventsRow("Rent", 15000, ""),
    financialEventsRow("EMI", 4000, "Home Loan EMI")
  ];
  const txnData = [
    TXN_HEADER,
    mkTxnRow("2026-01-30", 15000, "Rent", ""),
    mkTxnRow("2026-02-28", 15000, "Rent", ""), // Feb has no 30th — clamped in real life, stored as 28th here
    mkTxnRow("2026-01-05", 4000, "EMI", "Home Loan EMI"),
    mkTxnRow("2026-02-05", 4000, "EMI", "Home Loan EMI")
  ];

  const statuses = sandbox.computeObligationStatuses_(financialEventsData, txnData, today);
  const rent = statuses.find((s) => s.type === "Rent");
  const emi = statuses.find((s) => s.label === "Home Loan EMI");

  assert(!!rent && !!emi, "both Rent and the named EMI are found as separate, distinct obligations");
  assert(rent.enoughHistory === true, "Rent has enough history from its own 2 rows");
  assert(emi.typicalDay === 5, "the EMI's own typical day (5th) is unaffected by Rent's history");
  assert(rent.typicalDay === 30, "Rent's own typical day (30th) is unaffected by the EMI's history, got " + rent.typicalDay);
})();

// ---------------------------------------------------------------------
// Test 5 — the real end-to-end trigger function is genuinely
// idempotent: running it TWICE on the same day sends exactly ONE push.
// ---------------------------------------------------------------------
(function testIdempotentDoubleRunSameDay(){
  // checkUpcomingObligations() reads "today" from the real system
  // clock, so this test builds history relative to the REAL current
  // date rather than a fixed one (unlike tests 1-4, which test the
  // pure function directly and can use a fixed date).
  const realToday = new Date();
  realToday.setHours(0, 0, 0, 0);

  // Build a typical day that's exactly 3 days from today, using 3
  // clean past occurrences on that same day-of-month, each a month
  // apart, none of them in the current month.
  const typicalDate = new Date(realToday);
  typicalDate.setDate(typicalDate.getDate() + 3);
  const typicalDay = typicalDate.getDate();

  function monthsAgo(date, n){
    const d = new Date(date);
    d.setMonth(d.getMonth() - n);
    return d;
  }
  function iso(d){
    const pad = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  const { sandbox, store, sentMessages } = loadSandbox();

  const financialEventsData = [
    FE_HEADER,
    financialEventsRow("EMI", 2500, "Phone EMI")
  ];
  const txnData = [
    TXN_HEADER,
    mkTxnRow(iso(monthsAgo(typicalDate, 1)), 2500, "EMI", "Phone EMI"),
    mkTxnRow(iso(monthsAgo(typicalDate, 2)), 2500, "EMI", "Phone EMI"),
    mkTxnRow(iso(monthsAgo(typicalDate, 3)), 2500, "EMI", "Phone EMI")
  ];

  // Fake the two sheets checkUpcomingObligations() reads directly.
  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return {
        getSheetByName: function(name){
          if(name === "FinancialEvents") return { getDataRange: () => ({ getValues: () => financialEventsData }) };
          if(name === "Transactions")   return { getDataRange: () => ({ getValues: () => txnData }) };
          return null;
        }
      };
    }
  };

  sandbox.checkUpcomingObligations();
  sandbox.checkUpcomingObligations(); // run again, same day

  assert(sentMessages.length === 1, "running checkUpcomingObligations() twice on the same day sends exactly ONE push, got " + sentMessages.length);
  assert(sentMessages[0].indexOf("Phone EMI") !== -1, "the push is actually about the right obligation");

  const propKeys = Object.keys(store);
  assert(propKeys.some((k) => k.indexOf("phone_emi") !== -1), "the \"already reminded this month\" Script Property was actually saved");
})();

// ---------------------------------------------------------------------
// Test 6 — testUpcomingObligations() (the manual dry-run helper) never
// sends a real push and never writes the "already reminded" property,
// so running it can't accidentally suppress a real reminder later.
// ---------------------------------------------------------------------
(function testDryRunHelperNeverSendsOrWrites(){
  const realToday = new Date();
  realToday.setHours(0, 0, 0, 0);
  const typicalDate = new Date(realToday);
  typicalDate.setDate(typicalDate.getDate() + 3);

  function monthsAgo(date, n){ const d = new Date(date); d.setMonth(d.getMonth() - n); return d; }
  function iso(d){ const pad = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  const { sandbox, store, sentMessages } = loadSandbox();

  const financialEventsData = [FE_HEADER, financialEventsRow("EMI", 2500, "Phone EMI")];
  const txnData = [
    TXN_HEADER,
    mkTxnRow(iso(monthsAgo(typicalDate, 1)), 2500, "EMI", "Phone EMI"),
    mkTxnRow(iso(monthsAgo(typicalDate, 2)), 2500, "EMI", "Phone EMI")
  ];

  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return {
        getSheetByName: function(name){
          if(name === "FinancialEvents") return { getDataRange: () => ({ getValues: () => financialEventsData }) };
          if(name === "Transactions")   return { getDataRange: () => ({ getValues: () => txnData }) };
          return null;
        }
      };
    }
  };

  sandbox.testUpcomingObligations();

  assert(sentMessages.length === 0, "the manual dry-run helper never sends a real push");
  assert(Object.keys(store).length === 0, "the manual dry-run helper never writes the \"already reminded\" Script Property");
})();

console.log("\nDone.");
