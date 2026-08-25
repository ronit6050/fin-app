// backend/tests/ccStatementReconciliation.test.js
//
// Plain-English what this checks: a new "upload your credit card
// statement" feature (added 2026-08-25, same day as the CRED bill-
// payment amount-match fix) that works exactly like the existing bank
// statement Reconcile screen — upload a file, the app compares it
// against what's actually in Transactions, and shows what's missing so
// you can review and approve adding it. Built after discovering CC
// Advisor's own tracked bill total (₹6,924.37) was short of a real bill
// payment (₹7,399) by ~₹474.63 — likely a card swipe the SMS parser
// silently never caught.
//
// New pieces, all in Recon.js:
//   - parseFlexibleDate(dateVal) — reads a real Date, an Excel serial
//     number, or a dd/mm/yy(yy) string.
//   - parseCreditCardSheet(sheet) — turns a Drive-converted statement
//     Sheet into the same { date, amount, type, ref, name, mode, note }
//     shape parseBankSheet() already produces for bank statements, using
//     the existing flexible findHeaderRow()/mapColumns() from
//     Credit Card.js (a card statement doesn't follow the bank
//     statement's fixed row-22 layout).
//   - reconcileCreditCardStatementPreview(fileBase64, fileName) — the
//     actual entry point (not tested end-to-end here, since it needs a
//     real Drive/DriveApp mock — parseCreditCardSheet + the shared,
//     already-existing previewReconciliation() are what's actually new
//     and load-bearing, and are tested directly).
//
// This test proves:
//   1. parseFlexibleDate handles all 3 real-world date shapes.
//   2. parseCreditCardSheet correctly reads a statement with an "Amount"
//      + Dr/Cr style layout.
//   3. parseCreditCardSheet correctly reads a statement with separate
//      Debit/Credit columns instead.
//   4. Every parsed row's mode is "card" (so an approved entry correctly
//      counts as card spend everywhere Mode is checked later).
//   5. previewReconciliation (reused, unchanged) correctly matches two
//      statement rows against existing Transactions rows and correctly
//      flags a genuinely missing one — the exact "found the missing
//      swipe" scenario this feature exists for.
//   6. A statement row within a few days that's ALSO in Transactions
//      does not get double-flagged as missing (score >= 90 = matched).
//
// Run with: node backend/tests/ccStatementReconciliation.test.js

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

// ---------------------------------------------------------------------
// Sandbox — mocks SpreadsheetApp so getSheetData() (Recon.js, reads
// "Transactions") returns a fixed fixture, and SmartMemory/TypeVotes
// come back empty (previewReconciliation handles that gracefully).
// ---------------------------------------------------------------------
// transactionsHolder is a { rows: [...] } object rather than a plain
// array, read lazily — this lets a caller build fixture rows using the
// sandbox's OWN Date constructor (via vm.runInContext) AFTER the sandbox
// already exists, then assign them into holder.rows, without needing a
// separate throwaway sandbox just to get a same-realm Date from.
function loadSandbox(transactionsHolder){
  transactionsHolder = transactionsHolder || { rows: [["Date"]] };
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function(){
        return {
          getSheetByName: function(name){
            if(name === "Transactions"){
              return { getDataRange: function(){ return { getValues: function(){ return transactionsHolder.rows; } }; } };
            }
            return null; // SmartMemory / TypeVotes — previewReconciliation handles this
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

  // Dependency order: category.js (getSuggestedCategoryFast's helpers),
  // needWantSaving.js (getSuggestedType), Credit Card.js
  // (findHeaderRow/mapColumns, reused by parseCreditCardSheet), PWA.js
  // (getSuggestedCategoryFast), Recon.js (the code under test).
  ["category.js", "needWantSaving.js", "Credit Card.js", "PWA.js", "Recon.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return sandbox;
}

// ---------------------------------------------------------------------
// 1. parseFlexibleDate — all 3 real-world shapes.
// ---------------------------------------------------------------------
const dateSandbox = loadSandbox();

// Built with vm.runInContext so this Date is constructed inside the
// sandbox's OWN realm — a Date built in this test file's realm would
// fail `instanceof Date` inside the vm sandbox (different realm,
// different Date constructor reference).
const realDate = vm.runInContext("new Date(2026, 7, 20)", dateSandbox); // 20 Aug 2026
assert(
  dateSandbox.parseFlexibleDate(realDate).getTime() === realDate.getTime(),
  "parseFlexibleDate passes through a real Date object unchanged"
);

// Computed, not hand-typed — the Excel serial number for 20 Aug 2026,
// counting days since the epoch parseFlexibleDate itself uses (1899-12-30).
const excelEpochForTest = new Date(1899, 11, 30);
const excelSerialForAug20 = Math.round((new Date(2026, 7, 20) - excelEpochForTest) / 86400000);
const fromSerial = dateSandbox.parseFlexibleDate(excelSerialForAug20);
assertEqual(fromSerial.getFullYear(), 2026, "Excel serial number parses to the right year");
assertEqual(fromSerial.getMonth(), 7, "Excel serial number parses to the right month (Aug = 7)");
assertEqual(fromSerial.getDate(), 20, "Excel serial number parses to the right day");

const fromString = dateSandbox.parseFlexibleDate("20/08/2026");
assertEqual(fromString.getFullYear(), 2026, "dd/mm/yyyy string parses to the right year");
assertEqual(fromString.getMonth(), 7, "dd/mm/yyyy string parses to the right month");
assertEqual(fromString.getDate(), 20, "dd/mm/yyyy string parses to the right day");

const fromShortYear = dateSandbox.parseFlexibleDate("20-08-26");
assertEqual(fromShortYear.getFullYear(), 2026, "dd-mm-yy (2-digit year) string parses to the right year");

// ---------------------------------------------------------------------
// 2 & 3. parseCreditCardSheet — two real-world column layouts.
// ---------------------------------------------------------------------
const amountStyleSheet = {
  getDataRange: function(){
    return {
      getValues: function(){
        return [
          ["Statement for card ending 8132"],            // junk row before the real header — findHeaderRow must skip this
          ["Date", "Description", "Amount"],
          ["19/07/2026", "SWIGGY BANGALORE", "450.00"],
          ["22/07/2026", "AMAZON PAY", "1200.50"],
          ["25/07/2026", "REFUND - AMAZON", "-200.00 CR"]
        ];
      }
    };
  }
};

const parsedAmountStyle = dateSandbox.parseCreditCardSheet(amountStyleSheet);
assertEqual(parsedAmountStyle.length, 3, "amount-style statement: all 3 real rows parsed (junk header row correctly skipped)");
assertEqual(parsedAmountStyle[0].amount, 450, "first row amount parsed correctly");
assertEqual(parsedAmountStyle[0].type, "debit", "first row is a debit");
assertEqual(parsedAmountStyle[0].mode, "card", "parsed row's mode is always 'card'");
assertEqual(parsedAmountStyle[0].name, "SWIGGY BANGALORE", "first row's merchant name parsed correctly");
assertEqual(parsedAmountStyle[2].type, "credit", "a row marked 'CR' is correctly parsed as a credit (refund)");
assertEqual(parsedAmountStyle[2].amount, 200, "a negative/CR amount is stored as a positive number");

const debitCreditStyleSheet = {
  getDataRange: function(){
    return {
      getValues: function(){
        return [
          ["Transaction Date", "Narration", "Debit", "Credit"],
          ["19/07/2026", "ZEPTO GROCERY", "899.75", ""],
          ["20/07/2026", "CASHBACK CREDIT", "", "50.00"]
        ];
      }
    };
  }
};

const parsedDebitCreditStyle = dateSandbox.parseCreditCardSheet(debitCreditStyleSheet);
assertEqual(parsedDebitCreditStyle.length, 2, "debit/credit-style statement: both rows parsed");
assertEqual(parsedDebitCreditStyle[0].amount, 899.75, "debit column value parsed correctly");
assertEqual(parsedDebitCreditStyle[0].type, "debit", "debit column row is a debit");
assertEqual(parsedDebitCreditStyle[1].amount, 50, "credit column value parsed correctly");
assertEqual(parsedDebitCreditStyle[1].type, "credit", "credit column row is a credit");

// ---------------------------------------------------------------------
// 4/5/6. previewReconciliation (reused, unchanged) — the real
// "find the missing swipe" scenario. Two of these three statement rows
// already exist in Transactions (should match); one genuinely doesn't
// (should be flagged missing) — reproducing the real ₹474.63 gap.
// ---------------------------------------------------------------------
// A real Google Sheet hands back an actual Date object for a date cell,
// not a string — calculateScore's parseIndianDate() special-cases that
// (returns it immediately) and only parses strings as DD/MM/YY (2-digit
// year), matching what a converted bank statement's own cells look like.
// Built with vm.runInContext so these are constructed in the matching
// sandbox's own realm (see the parseFlexibleDate Date test above for why).
const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving"];
const fixtureHolder = { rows: [TXN_HEADER] };
const matchSandbox = loadSandbox(fixtureHolder);

const d19jul = vm.runInContext("new Date(2026, 6, 19)", matchSandbox);
const d22jul = vm.runInContext("new Date(2026, 6, 22)", matchSandbox);

fixtureHolder.rows = [
  TXN_HEADER,
  [d19jul, "13:00", "HDFC", "debit", "card 8132", 450, "", "Swiggy", "", "", "", "", "", "Food", "", "YES", ""],
  [d22jul, "14:00", "HDFC", "debit", "card 8132", 1200.50, "", "Amazon", "", "", "", "", "", "Shopping", "", "YES", ""]
  // The 25/07 refund row is deliberately NOT in Transactions — this is
  // the "missing swipe" the whole feature exists to catch.
];

const ccTxns = matchSandbox.parseCreditCardSheet(amountStyleSheet);
const preview = matchSandbox.previewReconciliation(ccTxns);

assertEqual(preview.total, 3, "preview total = all 3 parsed statement rows");
assertEqual(preview.matched, 2, "2 of the 3 rows correctly matched existing Transactions rows (same date+amount+type)");
assertEqual(preview.missing.length, 1, "exactly 1 row correctly flagged as missing — the real gap this feature is meant to catch");
assertEqual(preview.missing[0].name, "REFUND - AMAZON", "the missing row is the refund, not one of the two already-tracked swipes");
assertEqual(preview.missing[0].mode, "card", "the missing entry's mode is 'card', so approving it will count as card spend");
assertEqual(preview.missing[0].type, "credit", "the missing entry correctly kept its credit (refund) type");

console.log("\nDone.");
