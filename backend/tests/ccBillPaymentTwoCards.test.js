// backend/tests/ccBillPaymentTwoCards.test.js
//
// Plain-English what this checks: the user has TWO separate physical
// credit cards. Mode already tells them apart per transaction — e.g.
// "card 1264" vs "card 8132" (see sms-parser-backend/Code.js, which
// writes "card " + the card's last 4 digits). Found 2026-09-05:
// isCreditCardBillPayment()/getOutstandingCCBillTotal() used to add BOTH
// cards' swipes into one COMBINED "outstanding bill" number. That's fine
// if you pay both cards off together in one payment, but the user often
// pays each card's bill SEPARATELY — a real example: they paid the
// bigger card's bill fine (recognized), then paid the smaller card's
// bill (₹149, a single YouTube subscription charge) separately — and
// since ₹149 doesn't match the COMBINED total of both cards, the app
// wrongly treated that ₹149 payment as a brand-new purchase, which would
// have double-counted it (once as the original YouTube charge, again as
// "paying" for it).
//
// Fixed: getOutstandingCCBillTotalsByCard() now computes a separate
// outstanding total PER distinct card (grouped by the exact "card XXXX"
// Mode string), and isCreditCardBillPayment() matches an incoming
// payment's amount against EITHER any one card's own total OR the
// combined total of all cards — so paying either card separately, or
// both together, is correctly recognized either way.
//
// This test proves:
//   1. A payment matching ONLY card A's own outstanding total (not the
//      combined total) IS recognized as a bill payment.
//   2. A payment matching ONLY card B's own outstanding total (the real
//      ₹149-style scenario) IS recognized as a bill payment.
//   3. A payment matching the COMBINED total of both cards together
//      (the original, already-working case) is STILL recognized —
//      this fix is additive, not a replacement.
//   4. A payment matching neither card's total nor the combined total
//      is NOT wrongly excluded — stays a real, counted expense.
//   5. A card with zero real spend in the window never produces a
//      spurious ₹0 bucket that could falsely match a near-zero payment.
//   6. getCCAdvisorData's own "has the outstanding bill been paid IN
//      FULL?" check does NOT flip to true just because ONE card's small
//      bill was paid while the other card's much bigger bill is still
//      genuinely unpaid (the real confirmed bug, found by
//      change-reviewer 2026-09-05, before this shipped) — isOverdue and
//      the affordability check must still reflect the real unpaid
//      amount.
//   7. getCCAdvisorData DOES correctly recognize the outstanding bill as
//      fully paid once BOTH cards' bills are paid off (as two separate
//      matching payments) — proves the fix isn't just "always false"
//      now, it's a real sum-vs-total comparison.
//   8. A stray leading/trailing space in a Mode value doesn't split one
//      physical card's outstanding total into two separate buckets
//      (locks in the .trim() fix in getOutstandingCCBillTotalsByCard).
//
// Run with: node backend/tests/ccBillPaymentTwoCards.test.js

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
  // loaded into the same global scope, same pattern as
  // ccBillPaymentByAmount.test.js.
  ["settings.js", "PWA.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return sandbox;
}

// Same column layout as ccBillPaymentByAmount.test.js's mkTxnRow.
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
// Build a fixture with TWO DISTINCT CARDS, each with its own real spend
// inside the "outstanding" (most recently closed) billing cycle window —
// the exact same window getOutstandingCCCycleWindow_() computes from
// today's real date.
// ---------------------------------------------------------------------
const today = new Date();
today.setHours(0, 0, 0, 0);
const dayOfMonth = today.getDate();
const mostRecentClose = new Date(today.getFullYear(), today.getMonth() - (dayOfMonth < 18 ? 1 : 0), 18);
const cycleStart = new Date(mostRecentClose.getFullYear(), mostRecentClose.getMonth() - 1, 19);

function iso(d){ return d.toISOString().slice(0, 10); }
const midCycleDate = new Date(cycleStart.getTime() + 3 * 86400000); // a few days into the cycle, safely inside it

// Card A (the "big" card) — several real swipes.
const cardASwipe1 = mkTxnRow(iso(midCycleDate), "debit", "card 1264", 8000, { note: "Rent top-up shopping", category: "Shopping" });
const cardASwipe2 = mkTxnRow(iso(midCycleDate), "debit", "card 1264", 4000, { note: "Groceries", category: "Food" });
const CARD_A_TOTAL = 8000 + 4000; // 12000

// Card B (the "small" card) — the real-world ₹149 scenario: a single
// subscription charge, nothing else on it this cycle.
const cardBSwipe1 = mkTxnRow(iso(midCycleDate), "debit", "card 8132", 149, { note: "YouTube Premium", category: "Lifestyle" });
const CARD_B_TOTAL = 149;

const COMBINED_TOTAL = CARD_A_TOTAL + CARD_B_TOTAL; // 12149

const txnData = [HEADER, cardASwipe1, cardASwipe2, cardBSwipe1];

const sandbox = loadSandbox();

// ---------------------------------------------------------------------
// 1. A payment matching ONLY card A's own total (not the combined total).
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "Some Payment App", "bill payment", CARD_A_TOTAL, txnData) === true,
  "a payment for exactly card A's own outstanding total is recognized as a bill payment, even though it doesn't match the combined total"
);

// ---------------------------------------------------------------------
// 2. A payment matching ONLY card B's own total — the real ₹149 scenario.
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "Some Payment App", "bill payment", CARD_B_TOTAL, txnData) === true,
  "a payment for exactly card B's own outstanding total (₹149, the real incident) is recognized as a bill payment, even though it doesn't match the combined total"
);

// ---------------------------------------------------------------------
// 3. A payment matching the COMBINED total of both cards together —
//    must still work (this is the pre-existing, already-shipped case).
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "Some Payment App", "bill payment", COMBINED_TOTAL, txnData) === true,
  "a payment for the combined total of both cards together is still recognized as a bill payment"
);

// ---------------------------------------------------------------------
// 4. A payment matching NEITHER card's total nor the combined total —
//    must stay real, counted spend.
// ---------------------------------------------------------------------
assert(
  sandbox.isCreditCardBillPayment("upi", "Some Payment App", "bill payment", 500, txnData) === false,
  "a payment that matches no card's total and not the combined total is NOT wrongly excluded — stays real spend"
);

// ---------------------------------------------------------------------
// 5. A card with ZERO real spend in the window must never produce a
//    spurious ₹0 bucket that could falsely match a near-zero payment.
// ---------------------------------------------------------------------
const onlyCardATxnData = [HEADER, cardASwipe1, cardASwipe2]; // no card B rows at all this cycle
assert(
  sandbox.isCreditCardBillPayment("upi", "Someone", "", 0, onlyCardATxnData) === false,
  "with only one card having real spend, a ₹0 payment never false-matches a nonexistent second card's bill"
);

// ---------------------------------------------------------------------
// 6. THE CONFIRMED BUG'S FIX: paying off ONLY card B's small bill (₹149)
//    while card A's much bigger bill (₹12,000) is still genuinely
//    unpaid must NOT report the whole outstanding bill as paid.
// ---------------------------------------------------------------------
const dayAfterClose = new Date(mostRecentClose.getTime() + 86400000);
const cardBPayment = mkTxnRow(iso(dayAfterClose), "debit", "upi", CARD_B_TOTAL, { counterparty: "Some Payment App", note: "bill payment" });
const txnDataPartialPayment = [HEADER, cardASwipe1, cardASwipe2, cardBSwipe1, cardBPayment];

const partialResult = sandbox.getCCAdvisorData(txnDataPartialPayment, [["Row0","Date","Type","Amount"]], null, 0);
assert(
  partialResult.outstanding.isPaid === false,
  "paying off only card B's ₹149 bill does NOT mark the whole outstanding bill (card A's ₹12,000 still unpaid) as paid"
);
assert(
  partialResult.outstanding.amount === COMBINED_TOTAL,
  "the outstanding total shown is still the real combined amount (₹12,149), unaffected by the partial payment"
);
assert(
  partialResult.affordability !== null,
  "the affordability check still runs (isn't skipped) since the bill isn't actually fully paid"
);

// ---------------------------------------------------------------------
// 7. Paying off BOTH cards' bills (as two separate matching payments)
//    correctly marks the whole outstanding bill as paid.
// ---------------------------------------------------------------------
const cardAPayment = mkTxnRow(iso(dayAfterClose), "debit", "upi", CARD_A_TOTAL, { counterparty: "Some Payment App", note: "bill payment" });
const txnDataBothPaid = [HEADER, cardASwipe1, cardASwipe2, cardBSwipe1, cardAPayment, cardBPayment];

const bothPaidResult = sandbox.getCCAdvisorData(txnDataBothPaid, [["Row0","Date","Type","Amount"]], null, 0);
assert(
  bothPaidResult.outstanding.isPaid === true,
  "paying BOTH cards' bills separately (two matching payments summing to the full outstanding total) correctly marks isPaid: true"
);
assert(
  bothPaidResult.affordability === null,
  "the affordability check is skipped once the bill is genuinely fully paid"
);

// A single COMBINED payment covering both cards at once also counts as
// fully paid — same total, different shape of payment.
const combinedPayment = mkTxnRow(iso(dayAfterClose), "debit", "upi", COMBINED_TOTAL, { counterparty: "Some Payment App", note: "bill payment" });
const txnDataCombinedPaid = [HEADER, cardASwipe1, cardASwipe2, cardBSwipe1, combinedPayment];
const combinedPaidResult = sandbox.getCCAdvisorData(txnDataCombinedPaid, [["Row0","Date","Type","Amount"]], null, 0);
assert(
  combinedPaidResult.outstanding.isPaid === true,
  "a single payment covering the combined total of both cards also correctly marks isPaid: true"
);

// ---------------------------------------------------------------------
// 8. A stray space in a Mode value must not split one physical card's
//    outstanding total into two separate (smaller, non-matching)
//    buckets. Locks in the .trim() fix in getOutstandingCCBillTotalsByCard.
// ---------------------------------------------------------------------
const cardASwipe1Spaced = mkTxnRow(iso(midCycleDate), "debit", "card 1264 ", 8000, { note: "Rent top-up shopping", category: "Shopping" }); // trailing space
const cardASwipe2Plain  = mkTxnRow(iso(midCycleDate), "debit", "card 1264", 4000, { note: "Groceries", category: "Food" }); // no space
const spacedTxnData = [HEADER, cardASwipe1Spaced, cardASwipe2Plain, cardBSwipe1];

assert(
  sandbox.isCreditCardBillPayment("upi", "Some Payment App", "bill payment", CARD_A_TOTAL, spacedTxnData) === true,
  "a stray space in one Mode value doesn't split card A's ₹12,000 total into two smaller buckets — the ₹12,000 payment still matches"
);

console.log("\nDone.");
