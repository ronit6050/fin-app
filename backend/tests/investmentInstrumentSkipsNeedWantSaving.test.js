// backend/tests/investmentInstrumentSkipsNeedWantSaving.test.js
//
// Plain-English what this checks: when you save a transaction and tell
// the app "this note matches a known investment" (e.g. you typed "Tata
// Steel shares" and confirmed it), the app should NOT also ask you
// Need/Want/Saving for it — buying a stock/fund isn't that kind of
// spending decision, same as it already doesn't ask for Rent, EMI, a
// SIP, or a loan to a friend. Decided by the user 2026-08-11, after
// the investment-instruments feature first shipped still asking the
// question for this case (flagged as an open judgment call, now
// resolved).
//
// This test loads the REAL backend source (PWA.js + the files it
// depends on: investmentInstruments.js, financialEvents.js,
// needWantSaving.js) into a small fake Google Sheets environment (no
// real Apps Script/Google account needed) and proves:
//   1. Saving a transaction WITH a valid investmentInstrument does NOT
//      write anything to column Q (Need/Want/Saving) — even though a
//      `type` ("Want") was sent, same as a real frontend would send if
//      the user hadn't yet realized the toggle should be hidden.
//   2. The response reports `typeSaved:false` — so the frontend/caller
//      can tell the difference between "asked and answered" and
//      "correctly skipped," same transparency pattern already used for
//      the lending/Financial-Event/non-spend-transfer skips.
//   3. The investment itself STILL gets logged into the Investments
//      sheet (this fix must not have broken that).
//   4. An ordinary transaction (no investmentInstrument) is UNAFFECTED
//      — Need/Want/Saving still saves normally, proving this new
//      exclusion didn't accidentally widen to everything.
//   5. An INVALID/unknown investmentInstrument name (never trust the
//      frontend) does NOT skip Need/Want/Saving — only a name that
//      actually validates against InvestmentInstruments does.
//
// Run with: node backend/tests/investmentInstrumentSkipsNeedWantSaving.test.js

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
// A tiny fake Google Sheets environment — same shape as the other tests
// in this folder (appendRow / getDataRange().getValues() / getLastRow()
// / getRange().getValue()/setValue() / deleteRows / insertSheet).
// ---------------------------------------------------------------------
function makeFakeSheetsEnv(){
  const sheetsByName = {};

  function FakeSheet(name, initialRows){
    this.name = name;
    this.rows = initialRows.map(function(r){ return r.slice(); });
  }
  FakeSheet.prototype.appendRow = function(row){ this.rows.push(row.slice()); };
  FakeSheet.prototype.getDataRange = function(){
    const self = this;
    return { getValues: function(){ return self.rows.map(function(r){ return r.slice(); }); } };
  };
  FakeSheet.prototype.getLastRow = function(){ return this.rows.length; };
  FakeSheet.prototype.getRange = function(row, col){
    const self = this;
    return {
      getValue: function(){ return self.rows[row - 1] ? self.rows[row - 1][col - 1] : ""; },
      setValue: function(v){ self.rows[row - 1][col - 1] = v; }
    };
  };
  FakeSheet.prototype.deleteRows = function(rowPosition, howMany){
    this.rows.splice(rowPosition - 1, howMany);
  };

  function seedSheet(name, headerAndRows){
    sheetsByName[name] = new FakeSheet(name, headerAndRows);
    return sheetsByName[name];
  }

  const SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return {
        getSheetByName: function(name){ return sheetsByName[name] || null; },
        insertSheet: function(name){
          const s = new FakeSheet(name, []);
          sheetsByName[name] = s;
          return s;
        }
      };
    }
  };

  const Utilities = {
    formatDate: function(date, tz, fmt){
      // Only "yyyy-MM-dd" is used by the code under test.
      const d = new Date(date);
      const pad = function(n){ return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  };

  const Session = { getScriptTimeZone: function(){ return "UTC"; } };
  const Logger = { log: function(){} };

  return { SpreadsheetApp, Utilities, Session, Logger, seedSheet, sheetsByName };
}

// ---------------------------------------------------------------------
// Load the real backend source into a sandbox sharing globals, the same
// way Apps Script's single global scope actually works. Loads
// saveTransactionNote's real dependencies — investmentInstruments.js,
// financialEvents.js, needWantSaving.js — plus PWA.js itself.
//
// Deliberately does NOT load category.js or noteMemory.js: the test
// rows below all use an EMPTY counterparty, which means
// saveTransactionNote's own code never calls into either of those
// (handleCategoryCorrection/recordNoteUsage are both gated behind
// `if(counterparty)`) — kept out on purpose to keep this test focused
// and its fake-sheet setup small, same "only load what's actually
// exercised" spirit as autoLogSaving.test.js.
// ---------------------------------------------------------------------
function loadBackendSandbox(){
  const env = makeFakeSheetsEnv();

  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    Utilities: env.Utilities,
    Session: env.Session,
    Logger: env.Logger,
    console: console
  };
  vm.createContext(sandbox);

  const files = ["investmentInstruments.js", "financialEvents.js", "needWantSaving.js", "PWA.js"];
  files.forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return { sandbox: sandbox, env: env };
}

// A minimal but realistic Transactions sheet row, matching the real
// column layout (see reference_transactions_sheet_schema): the columns
// saveTransactionNote actually touches are A(date), D(type),
// E(mode), F(amount), G(reference), M(note), N(category), Q(type
// answer). Header row + one data row (row 2). counterparty (column H)
// is deliberately left blank in every test below — see the comment on
// loadBackendSandbox for why that keeps category.js/noteMemory.js out
// of scope for this test.
function seedTransactionsRow(env){
  const row = [
    "2026-08-11", "10:00", "HDFC", "debit", "upi", 3000, "REF123", "", // A-H
    "", "", "", "", "", "", "", "YES", "", "", "" // I-S (M,N,Q,R,S start blank)
  ];
  env.seedSheet("Transactions", [
    ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"],
    row
  ]);
}

// ---------------------------------------------------------------------
// Test 1 — a valid investmentInstrument skips Need/Want/Saving (column
// Q), even though a `type` was sent.
// ---------------------------------------------------------------------
(function testValidInstrumentSkipsTypeQuestion(){
  const { sandbox, env } = loadBackendSandbox();
  seedTransactionsRow(env);
  env.seedSheet("Investments", [["Date", "Type", "Amount", "Note"]]);

  const result = sandbox.saveTransactionNote(
    2, "bought Tata Steel shares", "Financial", "", "Want", undefined,
    null, null, null, "Tata Steel"
  );

  assert(result.ok === true, "save reports ok:true");
  assert(result.typeSaved === false, "typeSaved is false — Need/Want/Saving was correctly SKIPPED, got " + result.typeSaved);
  assert(result.typeRequested === true, "typeRequested is still true — a type WAS sent, just not saved (matches the existing lending/Financial-Event transparency pattern)");

  const savedRow = env.sheetsByName["Transactions"].rows[1];
  const columnQ = savedRow[16]; // column Q, 0-indexed 16
  assert(columnQ === "" || columnQ === undefined, 'column Q (NeedWantSaving) was NOT written, got "' + columnQ + '"');
})();

// ---------------------------------------------------------------------
// Test 2 — the investment itself is still logged into the Investments
// sheet (this fix must not have broken the actual logging).
// ---------------------------------------------------------------------
(function testInvestmentStillLogged(){
  const { sandbox, env } = loadBackendSandbox();
  seedTransactionsRow(env);
  env.seedSheet("Investments", [["Date", "Type", "Amount", "Note"]]);

  const result = sandbox.saveTransactionNote(
    2, "bought Tata Steel shares", "Financial", "", "Want", undefined,
    null, null, null, "Tata Steel"
  );

  assert(result.investmentLogged === true, "investmentLogged is true — the row was still written to Investments, got " + result.investmentLogged);

  const investRows = env.sheetsByName["Investments"].rows;
  assert(investRows.length === 2, "exactly one row was appended to Investments");
  assert(investRows[1][1] === "Tata Steel", 'the logged row uses the canonical name "Tata Steel", got "' + investRows[1][1] + '"');
  assert(investRows[1][2] === 3000, "the logged amount matches the transaction's amount (3000), got " + investRows[1][2]);
})();

// ---------------------------------------------------------------------
// Test 3 — an ORDINARY transaction (no investmentInstrument) is
// unaffected: Need/Want/Saving still saves normally.
// ---------------------------------------------------------------------
(function testOrdinaryTransactionUnaffected(){
  const { sandbox, env } = loadBackendSandbox();
  seedTransactionsRow(env);
  env.seedSheet("Investments", [["Date", "Type", "Amount", "Note"]]);

  const result = sandbox.saveTransactionNote(
    2, "lunch with friends", "Food", "", "Want", undefined,
    null, null, null, undefined // no investmentInstrument at all
  );

  assert(result.ok === true, "save reports ok:true");
  assert(result.typeSaved === true, "typeSaved is TRUE for an ordinary transaction — this fix did not widen the exclusion to everything, got " + result.typeSaved);

  const savedRow = env.sheetsByName["Transactions"].rows[1];
  assert(savedRow[16] === "Want", 'column Q correctly saved "Want" for an ordinary transaction, got "' + savedRow[16] + '"');
})();

// ---------------------------------------------------------------------
// Test 4 — an INVALID/unknown investmentInstrument name does NOT skip
// Need/Want/Saving (never trust a name from the frontend without
// server-side validation — same defense-in-depth pattern as everything
// else in saveTransactionNote).
// ---------------------------------------------------------------------
(function testInvalidInstrumentNameDoesNotSkip(){
  const { sandbox, env } = loadBackendSandbox();
  seedTransactionsRow(env);
  env.seedSheet("Investments", [["Date", "Type", "Amount", "Note"]]);

  const result = sandbox.saveTransactionNote(
    2, "some note", "Financial", "", "Want", undefined,
    null, null, null, "Not A Real Investment Name"
  );

  assert(result.investmentLogged === false, "an unknown instrument name is not logged to Investments, got " + result.investmentLogged);
  assert(result.typeSaved === true, "an INVALID instrument name does NOT skip Need/Want/Saving — only a real, validated name does, got typeSaved=" + result.typeSaved);
})();

console.log("\nDone.");
