// backend/tests/ccStatementPdfParsing.test.js
//
// Plain-English what this checks: the user's real HDFC UPI RuPay credit
// card statement turned out to be a PDF, not the .xls the Reconcile
// screen's bank-statement flow (and the first version of the credit
// card version, built the same day) assumed. This test uses the ACTUAL
// TEXT extracted from the user's real statement (2026-08-25,
// 653029XXXXXX8132, billing period 20 Jul - 19 Aug 2026) as a fixture —
// not an invented example — to prove parseCreditCardStatementText()
// correctly reads a real statement, and that the whole reconciliation
// flow correctly finds the real gap that started this feature: CC
// Advisor's own tracked bill total (₹6,924.37) was short of the real
// bill (₹7,398.86 per the statement's own "PURCHASES/DEBIT (Current
// Billing Cycle)" figure) by exactly ₹474.49 — a UPI-Google Asia Pacific
// Pte. Ltd charge on 30/07/2026 that the SMS parser never logged.
//
// Known unverified piece, called out here and in reconciliation.md:
// extractTextFromStatementPdf() (Drive API v2 OCR) has never actually
// been run — this test starts from the text Claude's own PDF reader
// already extracted, not from Google's OCR output, which could format
// things differently (e.g. the ₹ symbol showed up as a stray "C" in
// Claude's extraction; Drive's OCR might render it differently again).
// parseCreditCardStatementText() was deliberately written to not depend
// on recognizing any specific currency glyph for exactly this reason —
// see its own comment in Recon.js — but the OCR step itself still needs
// one real live test before this is fully trusted.
//
// Run with: node backend/tests/ccStatementPdfParsing.test.js

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

function assertClose(actual, expected, message){
  assert(Math.abs(actual - expected) < 0.005, message + " (expected " + expected + ", got " + actual + ")");
}

// ---------------------------------------------------------------------
// The REAL extracted text from the user's actual statement (page 1 and
// page 2's transaction sections), reproduced verbatim from what was
// read out of the PDF — including the surrounding header/footer noise
// a real page will have, since the parser must skip that correctly too.
// ---------------------------------------------------------------------
const REAL_STATEMENT_TEXT = `
TOTAL AMOUNT DUE
C7,399.00
MINIMUM DUE
C370.00
DUE DATE
08 Sep, 2026
Reward Points
3,415
REDEEM REWARDS
Opening Balance Feature + Bonus Reward
Points Earned
Disbursed Adjusted/Lapsed
3,307 108 0 0
POINTS EXPIRING IN 30 DAYS 0 IN 60 DAYS 0
Domestic Transactions
DATE & TIME TRANSACTION DESCRIPTION REWARDS AMOUNT PI
NADAR RONIT MUKESH [CKYC ID : 20013692369752 ]
23/07/2026| 21:25 UPI-HI TECH AUTO SERVICE C 523.59 l
27/07/2026| 06:38 UPI-AIRTEL PAYMENTS BANK LIMI C 488.82 l
27/07/2026| 21:39 UPI-MR FOODS AND BEVERAG C 395.00 l
28/07/2026| 20:56 UPI-Swiggy Limited C 588.00 l
29/07/2026| 19:09 UPI-MOHAMED NOOR AHMED C 1,300.00 l
29/07/2026| 20:15 CTRLXTECHNOLOGIESP C 356.90 l
30/07/2026| 11:47 UPI-Airtel C 100.00 l
30/07/2026| 16:07 UPI-Google Asia Pacific Pte.L C 474.49 l
Page 1 of 3
Domestic Transactions
DATE & TIME TRANSACTION DESCRIPTION REWARDS AMOUNT PI
01/08/2026| 22:51 UPI-SWIGGY INSTAMART C 250.00 l
02/08/2026| 13:15 UPI-Amazon India C 830.33 l
04/08/2026| 20:50 UPI-SWIGGY INSTAMART PRIVATE C 866.00 l
06/08/2026| 08:55 BPPY CC PAYMENT DP2162186IKHT4C1J1U (Ref# ST262190083000010157232) + C 9,800.00 l
09/08/2026| 11:17 UPI-HI TECH AUTO SERVICE C 453.70 l
15/08/2026| 12:22 ZEPTO C 210.35 l
16/08/2026| 07:58 UPI-SAMAHITA FUELLINGSTATION C 484.68 l
18/08/2026| 05:43 UPI-airtel C 77.00 l
Page 2 of 3
`;

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
            return null;
          }
        };
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

  ["category.js", "needWantSaving.js", "Credit Card.js", "PWA.js", "Recon.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return sandbox;
}

// ---------------------------------------------------------------------
// 1. Parsing the real text: all 16 real transaction lines found (8 per
//    page — 8 spend lines on page 1, 7 spend + 1 bill payment on page 2).
// ---------------------------------------------------------------------
const sandbox = loadSandbox();
const parsed = sandbox.parseCreditCardStatementText(REAL_STATEMENT_TEXT);

assertEqual(parsed.length, 16, "all 16 real transaction lines parsed (8 from page 1, 8 from page 2 including the bill payment)");

const google = parsed.find(function(t){ return t.name.indexOf("Google Asia Pacific") !== -1; });
assert(!!google, "the real 'UPI-Google Asia Pacific Pte.L' line was found");
assertClose(google.amount, 474.49, "Google Asia Pacific amount parsed correctly");
assertEqual(google.type, "debit", "Google Asia Pacific line is a debit");
assertEqual(google.mode, "card", "parsed row's mode is 'card'");

const bppy = parsed.find(function(t){ return t.name.indexOf("BPPY CC PAYMENT") !== -1; });
assert(!!bppy, "the real 'BPPY CC PAYMENT' (bill payment) line was found");
assertClose(bppy.amount, 9800, "BPPY payment amount parsed correctly");
assertEqual(bppy.type, "credit", "BPPY payment line correctly parsed as a CREDIT (the '+' marker), not a debit");

// Every OTHER real line is a plain debit.
const nonBppy = parsed.filter(function(t){ return t.name.indexOf("BPPY") === -1; });
assertEqual(nonBppy.length, 15, "15 real spend lines besides the bill payment itself");
assert(nonBppy.every(function(t){ return t.type === "debit"; }), "every real spend line is correctly a debit");

// ---------------------------------------------------------------------
// 2. The real total matches the statement's own printed total exactly —
//    proves the parser isn't silently dropping or double-counting a digit.
// ---------------------------------------------------------------------
const totalSpend = nonBppy.reduce(function(sum, t){ return sum + t.amount; }, 0);
assertClose(totalSpend, 7398.86, "sum of all 15 real spend lines matches the statement's own printed 'PURCHASES/DEBIT ₹7,398.86' exactly");

// ---------------------------------------------------------------------
// 3. The real reconciliation: feed a Transactions fixture containing
//    every real transaction EXCEPT the Google Asia Pacific one (i.e.
//    what the app actually has right now) and confirm previewReconciliation
//    correctly — and ONLY — flags that one row as missing.
// ---------------------------------------------------------------------
const fixtureHolder = { rows: [["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving"]] };
const matchSandbox = loadSandbox(fixtureHolder);

// Build one real Transactions row per real spend line except the missing
// one, using the sandbox's own Date constructor (see
// ccStatementReconciliation.test.js's comment for why this matters).
// The BPPY bill-payment line gets its own bank-side row too (mode "upi",
// debit — how a real bill payment actually shows up in Transactions,
// since it's money leaving the BANK account, not a "card" row) so the
// test isolates the one real question — is the missing Google Asia
// Pacific charge correctly (and ONLY it) flagged — from the unrelated
// bill-payment-detection logic covered by ccBillPaymentByAmount.test.js.
// 14 tracked (15 real spend lines minus the one missing Google charge).
const trackedTxns = nonBppy.filter(function(t){ return t.name.indexOf("Google Asia Pacific") === -1; });
function sandboxDate(t){
  return vm.runInContext("new Date(" + t.date.getFullYear() + "," + t.date.getMonth() + "," + t.date.getDate() + ")", matchSandbox);
}
fixtureHolder.rows = fixtureHolder.rows.concat(trackedTxns.map(function(t){
  return [sandboxDate(t), "12:00", "HDFC", "debit", "card 8132", t.amount, "", t.name, "", "", "", "", "", "Other", "", "YES", ""];
}));
fixtureHolder.rows.push([sandboxDate(bppy), "08:55", "HDFC", "debit", "upi", bppy.amount, "", "BPPY CC PAYMENT", "", "", "", "", "credit card bill payment", "Financial", "", "YES", ""]);

const matchParsed = matchSandbox.parseCreditCardStatementText(REAL_STATEMENT_TEXT);
const preview = matchSandbox.previewReconciliation(matchParsed);

assertEqual(preview.total, 16, "preview total = all 16 real parsed lines");
assertEqual(preview.matched, 15, "all 15 already-tracked real transactions (14 spend + the bill payment) correctly matched");
assertEqual(preview.missing.length, 1, "exactly ONE real transaction correctly flagged as missing");
assert(preview.missing[0].name.indexOf("Google Asia Pacific") !== -1, "the one missing transaction IS the real Google Asia Pacific Pte. Ltd charge — this is the actual ₹474.49 gap, found and confirmed");
assertClose(preview.missing[0].amount, 474.49, "the missing transaction's amount is exactly the real ₹474.49 gap");
