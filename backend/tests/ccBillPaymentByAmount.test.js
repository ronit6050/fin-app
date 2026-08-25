// backend/tests/ccBillPaymentByAmount.test.js
//
// Plain-English what this checks: isCreditCardBillPayment() decides
// whether a transaction is you paying off your credit card bill (which
// should NOT count as spend, and should NOT ask Need/Want/Saving) versus
// a real purchase.
//
// Found 2026-08-25: a real bill payment made through the CRED app showed
// up with counterparty "CRED Club Online" — none of the old keyword
// checks ("credit card"/"cc bill"/"card bill"/"card payment") matched
// that wording, so the app still asked Need/Want/Saving for it.
// Hardcoding "cred" was rejected — the user might pay from a different
// app next time, and CRED itself can also be used for real purchases
// (CRED Store etc), so "which app" isn't reliable either way.
//
// Fixed with a second, app-agnostic check: does the transaction's AMOUNT
// exactly match the real outstanding credit card bill (computed from
// actual card-mode swipes in the most recently closed billing cycle,
// same date math CC Advisor already uses)? A bill payment always pays
// the exact bill total no matter which app sends the money.
//
// This test proves:
//   1. A payment with unrecognized wording (like "CRED Club Online") but
//      an amount that exactly matches the real outstanding bill IS
//      recognized as a bill payment.
//   2. A payment with unrecognized wording and a DIFFERENT amount is NOT
//      wrongly excluded (stays a real, counted expense).
//   3. The existing keyword match (e.g. counterparty "HDFC CREDIT CARD")
//      still works regardless of amount — this fix is additive, not a
//      replacement.
//   4. An actual card swipe (mode starts with "card") is never treated
//      as a bill payment, even if its amount happens to equal the bill
//      total.
//   5. When there's no real outstanding bill (no card swipes in the
//      cycle), amount-matching never fires — a coincidental transfer of
//      ₹0 doesn't wrongly match.
//   6. getCCAdvisorData's own "has the outstanding bill been paid?"
//      check also recognizes the CRED-style payment now (it reuses the
//      same function) — proving the fix reaches every real call site,
//      not just a standalone function call.
//
// Run with: node backend/tests/ccBillPaymentByAmount.test.js

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

function loadSandbox(){
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function(){
        return { getSheetByName: function(){ return null; } };
      }
    },
    PropertiesService: {
      getScriptProperties: function(){
        return { getProperty: function(){ return null; }, setProperty: function(){} };
      }
    },
    Utilities: {
      formatDate: function(date, tz, fmt){
        const d = new Date(date);
        const pad = function(n){ return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      }
    },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} },
    console: console
  };
  vm.createContext(sandbox);

  // getCCAdvisorData calls getSettings() (settings.js) — needs to be
  // loaded into the same global scope, same pattern as the other tests
  // in this folder that pull in a second file for a shared dependency.
  ["settings.js", "PWA.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return sandbox;
}

// Same column layout as analysisByMode.test.js's mkTxnRow.
function mkTxnRow(date, type, mode, amount, opts){
  opts = opts || {};
  return [
    date, "10:00", "HDFC", type, mode, amount, opts.reference || "", opts.counterparty || "",
    "", "", "", "", opts.note || "", opts.category || "Other", "", "YES",
    opts.nws || "", opts.financialEvent || "", opts.financialEventName || ""
  ];
}

const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];

// ---------------------------------------------------------------------
// Build a fixture with two real card swipes inside the "outstanding"
// (most recently closed) billing cycle window — the exact same window
// getOutstandingCCCycleWindow_() computes from today's real date.
// ---------------------------------------------------------------------
const today = new Date();
today.setHours(0, 0, 0, 0);
const dayOfMonth = today.getDate();
const mostRecentClose = new Date(today.getFullYear(), today.getMonth() - (dayOfMonth < 18 ? 1 : 0), 18);
const cycleStart = new Date(mostRecentClose.getFullYear(), mostRecentClose.getMonth() - 1, 19);

function iso(d){ return d.toISOString().slice(0, 10); }
const midCycleDate = new Date(cycleStart.getTime() + 3 * 86400000); // a few days into the cycle, safely inside it

const swipe1 = mkTxnRow(iso(midCycleDate), "debit", "card 1234", 4000, { note: "Groceries", category: "Food" });
const swipe2 = mkTxnRow(iso(midCycleDate), "debit", "card 5678", 3399, { note: "Shoes", category: "Shopping" });
const OUTSTANDING_BILL_TOTAL = 4000 + 3399; // 7399, matches the real screenshot's ₹7,399

const txnData = [HEADER, swipe1, swipe2];

const sandbox = loadSandbox();

// ---------------------------------------------------------------------
// 1. Unrecognized wording ("CRED Club Online"), amount matches bill exactly.
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "CRED Club Online", "cred clubon", OUTSTANDING_BILL_TOTAL, txnData) === true,
  "a CRED-style payment with wording that matches no keyword IS recognized when the amount exactly matches the outstanding bill"
);

// ---------------------------------------------------------------------
// 2. Unrecognized wording, amount does NOT match — must stay real spend.
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "CRED Club Online", "some purchase", 500, txnData) === false,
  "a CRED-style payment with an amount that does NOT match the bill total is NOT wrongly excluded"
);

// ---------------------------------------------------------------------
// 3. Existing keyword match still works, regardless of amount.
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "HDFC CREDIT CARD", "", 123, txnData) === true,
  "the original keyword match (counterparty says 'credit card') still works even when the amount doesn't match the bill total"
);
assert(
  sandbox.isCreditCardBillPayment("upi", "", "card bill payment", 123, txnData) === true,
  "the original keyword match (note says 'card bill payment') still works regardless of amount"
);

// ---------------------------------------------------------------------
// 4. An actual card swipe is never a bill payment, even at the exact bill amount.
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("card 1234", "Some Shop", "", OUTSTANDING_BILL_TOTAL, txnData) === false,
  "a real card swipe (mode starts with 'card') is never treated as a bill payment, even if the amount happens to equal the bill total"
);

// ---------------------------------------------------------------------
// 5. No real outstanding bill (no card swipes at all) — amount-matching
//    must never fire, since billTotal would be 0.
// ---------------------------------------------------------------------
const emptyTxnData = [HEADER];
assert(
  sandbox.isCreditCardBillPayment("upi", "Someone", "", 0, emptyTxnData) === false,
  "with no real outstanding bill, a zero/blank amount never false-matches"
);
assert(
  sandbox.isCreditCardBillPayment("upi", "Someone", "", 500, emptyTxnData) === false,
  "with no real outstanding bill, an arbitrary amount never false-matches"
);

// ---------------------------------------------------------------------
// 6. getCCAdvisorData's own "has the bill been paid?" check picks up a
//    CRED-style payment made the day after the cycle closed.
// ---------------------------------------------------------------------
const dayAfterClose = new Date(mostRecentClose.getTime() + 86400000);
const credPayment = mkTxnRow(iso(dayAfterClose), "debit", "upi", OUTSTANDING_BILL_TOTAL, { counterparty: "CRED Club Online", note: "cred clubon" });
const txnDataWithPayment = [HEADER, swipe1, swipe2, credPayment];

const advisorResult = sandbox.getCCAdvisorData(txnDataWithPayment, [["Row0","Date","Type","Amount"]], null, 0);
assert(
  advisorResult.outstanding.isPaid === true,
  "getCCAdvisorData recognizes the CRED-style payment as having paid off the outstanding bill (isPaid: true)"
);

console.log("\nDone.");
