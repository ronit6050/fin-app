// backend/tests/ccWrongCardMode.test.js
//
// Plain-English what this checks: after fixing PDF parsing (all 16 real
// transactions now found), the reconcile result came back "16 matched,
// 0 missing" — which turned out to be RIGHT, but hiding a different,
// more important bug. A real transaction — a Google Play purchase made
// through the UPI RuPay Credit Card's UPI rails, not a swipe — was
// genuinely already in the Sheet, but logged with Mode "UPI" instead of
// "card 8132". Every place that adds up card spend (CC Advisor,
// isCreditCardBillPayment, Analysis's Card bucket) filters specifically
// on Mode starting with "card", so this real card purchase was
// invisible to every one of them — worse than missing, since nothing
// looked wrong.
//
// previewReconciliation() now takes an optional `options.checkCardMode`
// (only ever passed true by the credit card statement path — bank
// statement reconciliation never sets it, so its behavior is completely
// unchanged) that flags exactly this case as a new `wrongMode` list.
//
// This test proves:
//   1. A matched DEBIT transaction whose Sheet row has Mode "UPI" (not
//      starting with "card") is flagged in wrongMode — the real
//      Google Asia Pacific scenario, reproduced with real amounts.
//   2. A matched DEBIT transaction whose Sheet row already correctly
//      says Mode "card 8132" is NOT flagged (the common, correct case).
//   3. A matched CREDIT transaction (a bill payment, correctly logged
//      as Mode "upi" — money leaving the bank account, not "the card")
//      is NEVER flagged, even though its Mode doesn't start with
//      "card" either — flagging that would be wrong.
//   4. When checkCardMode is omitted (the bank statement path), the
//      result has no wrongMode surprises — proves this is fully opt-in
//      and doesn't change existing bank-reconciliation behavior.
//   5. extractCardLast4() correctly pulls "8132" out of the real
//      statement's own printed masked card number.
//   6. fixTransactionMode() writes the corrected Mode to the right row
//      (column E) and nothing else.
//
// Run with: node backend/tests/ccWrongCardMode.test.js

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

function assertEqual(actual, expected, message){
  assert(actual === expected, message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

function loadSandbox(transactionsHolder){
  transactionsHolder = transactionsHolder || { rows: [["Date"]] };
  const sheetWrites = [];

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function(){
        return {
          getSheetByName: function(name){
            if(name === "Transactions"){
              return {
                getDataRange: function(){ return { getValues: function(){ return transactionsHolder.rows; } }; },
                getRange: function(row, col){
                  return { setValue: function(val){ sheetWrites.push({ row: row, col: col, val: val }); } };
                }
              };
            }
            return null;
          }
        };
      }
    },
    Utilities: {
      formatDate: function(date, tz, fmt){
        const d = new Date(date);
        const pad = function(n){ return String(n).padStart(2, "0"); };
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        if(fmt === "dd MMM yyyy") return pad(d.getDate()) + " " + months[d.getMonth()] + " " + d.getFullYear();
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      }
    },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} },
    console: console
  };
  vm.createContext(sandbox);

  ["category.js", "needWantSaving.js", "Credit Card.js", "PWA.js", "Recon.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  sandbox.__sheetWrites = sheetWrites;
  return sandbox;
}

const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving"];

// ---------------------------------------------------------------------
// 1, 2, 3. The real scenario, reproduced.
// ---------------------------------------------------------------------
(function(){
  const fixtureHolder = { rows: [TXN_HEADER] };
  const sandbox = loadSandbox(fixtureHolder);
  const d = function(y,m,day){ return vm.runInContext("new Date(" + y + "," + m + "," + day + ")", sandbox); };

  fixtureHolder.rows = [
    TXN_HEADER,
    // A real card swipe, correctly logged as "card 8132" — should NOT be flagged.
    [d(2026,6,23), "21:25", "HDFC", "debit", "card 8132", 523.59, "", "HI TECH AUTO SERVICE", "", "", "", "", "", "Transport", "", "YES", ""],
    // The real bug: a UPI RuPay purchase logged as "UPI", not "card ...".
    [d(2026,6,29), "16:07", "HDFC", "debit", "UPI", 474.49, "", "playstoregames1.bd@axisba", "", "", "", "", "", "Other", "", "YES", ""],
    // A real bill payment, correctly logged as "upi" (money leaving the
    // bank account) — should NEVER be flagged even though it also
    // doesn't start with "card".
    [d(2026,7,6), "08:55", "HDFC", "debit", "upi", 9800, "", "CRED CLUB", "", "", "", "", "", "Financial", "", "YES", ""]
  ];

  const ccTxns = [
    { date: d(2026,6,23), amount: 523.59, type: "debit", ref: "NOREF_1", name: "UPI-HI TECH AUTO SERVICE", mode: "card", note: "" },
    { date: d(2026,6,29), amount: 474.49, type: "debit", ref: "NOREF_2", name: "UPI-Google Asia Pacific Pte.L", mode: "card", note: "" },
    { date: d(2026,7,6),  amount: 9800,   type: "credit", ref: "NOREF_3", name: "BPPY CC PAYMENT", mode: "card", note: "" }
  ];

  const result = sandbox.previewReconciliation(ccTxns, { checkCardMode: true, correctCardMode: "card 8132" });

  assertEqual(result.matched, 3, "all 3 correctly matched their existing Sheet rows");
  assertEqual(result.wrongMode.length, 1, "exactly ONE transaction flagged as wrongMode");
  assertEqual(result.wrongMode[0].amount, 474.49, "the flagged transaction is the real ₹474.49 Google Asia Pacific charge");
  assertEqual(result.wrongMode[0].currentMode, "UPI", "reports the actual wrong Mode currently on the row");
  assertEqual(result.wrongMode[0].correctMode, "card 8132", "suggests the real card's own Mode value, not a bare 'card'");
  assertEqual(result.wrongMode[0].row, 3, "points at the correct Sheet row number");
})();

// ---------------------------------------------------------------------
// 4. checkCardMode omitted (the bank statement path) — no wrongMode surprises.
// ---------------------------------------------------------------------
(function(){
  const fixtureHolder = { rows: [TXN_HEADER] };
  const sandbox = loadSandbox(fixtureHolder);
  const d = function(y,m,day){ return vm.runInContext("new Date(" + y + "," + m + "," + day + ")", sandbox); };
  fixtureHolder.rows = [
    TXN_HEADER,
    [d(2026,6,29), "16:07", "HDFC", "debit", "UPI", 474.49, "", "playstoregames1.bd@axisba", "", "", "", "", "", "Other", "", "YES", ""]
  ];
  const bankTxns = [{ date: d(2026,6,29), amount: 474.49, type: "debit", ref: "NOREF_1", name: "Google Asia Pacific", mode: "upi", note: "" }];

  const result = sandbox.previewReconciliation(bankTxns); // no options — same as every existing bank-statement call site
  assertEqual(result.wrongMode.length, 0, "wrongMode is empty when checkCardMode isn't requested, even for the exact same UPI-mode row");
  assertEqual(result.matched, 1, "still matches normally otherwise");
})();

// ---------------------------------------------------------------------
// 5. extractCardLast4 against the real statement's own text.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  assertEqual(sandbox.extractCardLast4("Credit Card No. 653029XXXXXX8132"), "8132", "extracts the real card's last 4 digits");
  assertEqual(sandbox.extractCardLast4("no masked number here"), null, "returns null when there's nothing to extract, rather than guessing");
})();

// ---------------------------------------------------------------------
// 6. fixTransactionMode writes the right cell, nothing else.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  const result = sandbox.fixTransactionMode(658, "card 8132");
  assertEqual(result.ok, true, "fixTransactionMode reports ok:true");
  assertEqual(sandbox.__sheetWrites.length, 1, "exactly one cell was written");
  assertEqual(sandbox.__sheetWrites[0].row, 658, "wrote to the correct row");
  assertEqual(sandbox.__sheetWrites[0].col, 5, "wrote to column E (Mode)");
  assertEqual(sandbox.__sheetWrites[0].val, "card 8132", "wrote the corrected Mode value");
})();

console.log("\nDone.");
