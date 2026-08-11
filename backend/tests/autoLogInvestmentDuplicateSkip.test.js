// backend/tests/autoLogInvestmentDuplicateSkip.test.js
//
// Plain-English what this checks: when you confirm a note-matched
// investment (e.g. you typed "bought more Tata Steel" and tapped
// confirm), the app used to sometimes silently refuse to log it if a
// similar amount had already been logged in the last 3 days — a check
// that exists to stop a SIP/Rent/EMI Financial Event from double-
// counting money you'd ALREADY typed in by hand before this feature
// existed. But a note-matched confirm is a fresh, explicit, one-tap
// human decision — the same trust level as the manual "+ Log an
// Investment" form, which never had this check at all — so silently
// dropping a real confirmation (e.g. two genuine top-ups of the same
// stock a day apart) did more harm than good. Decided by the user
// 2026-08-11, after both a change-reviewer pass and the ui-ux-expert
// pass independently flagged this as worth reconsidering.
//
// Fix: `autoLogInvestment` (financialEvents.js) gained an optional 5th
// parameter, `skipDuplicateCheck`. The note-matched `investmentInstrument`
// flow (saveTransactionNote, PWA.js) now passes `true`. The OLDER
// Financial Event/SIP auto-log flow (same function, same file, a
// different call site) was deliberately left UNCHANGED — it still
// needs the duplicate check, since that's the one case where a pre-
// existing MANUAL entry really could get double-counted the first time
// a SIP gets auto-detected.
//
// This test proves, without touching the real Google Sheet:
//   1. autoLogInvestment's DEFAULT behavior (no 5th argument, or
//      explicitly false) is completely unchanged — a nearby similar
//      amount is still skipped as a likely duplicate.
//   2. With skipDuplicateCheck:true, the exact same "duplicate" amount
//      now logs successfully instead of being silently dropped.
//   3. The only OTHER way autoLogInvestment can still report
//      logged:false even with skipDuplicateCheck:true is if the
//      Investments sheet itself doesn't exist at all — there is no
//      other silent-failure path left.
//   4. End-to-end through the real call sites in saveTransactionNote:
//      the note-matched `investmentInstrument` path logs even with a
//      nearby duplicate present; the Financial Event `financialEvent:
//      "Investment"` path still correctly skips it — proving the two
//      call sites weren't accidentally both changed (or both left
//      unchanged).
//
// Run with: node backend/tests/autoLogInvestmentDuplicateSkip.test.js

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
// in this folder.
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
      const d = new Date(date);
      const pad = function(n){ return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  };

  const Session = { getScriptTimeZone: function(){ return "UTC"; } };
  const Logger = { log: function(){} };

  return { SpreadsheetApp, Utilities, Session, Logger, seedSheet, sheetsByName };
}

// Loads investmentInstruments.js + financialEvents.js only — enough for
// the direct autoLogInvestment tests (Test groups 1-3 below).
function loadFinancialEventsSandbox(){
  const env = makeFakeSheetsEnv();
  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    Utilities: env.Utilities,
    Session: env.Session,
    Logger: env.Logger,
    console: console
  };
  vm.createContext(sandbox);

  ["investmentInstruments.js", "financialEvents.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return { sandbox: sandbox, env: env };
}

// Loads the full stack needed to call saveTransactionNote itself (PWA.js)
// — for the end-to-end call-site checks in Test group 4. Same loader as
// investmentInstrumentSkipsNeedWantSaving.test.js.
function loadFullBackendSandbox(){
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

// A minimal but realistic Transactions sheet row (same shape used by
// investmentInstrumentSkipsNeedWantSaving.test.js) — counterparty
// (column H) left blank on purpose, so category.js/noteMemory.js never
// need to be loaded for this test either.
function seedTransactionsRow(env, amount){
  const row = [
    "2026-08-11", "10:00", "HDFC", "debit", "upi", amount, "REF123", "", // A-H
    "", "", "", "", "", "", "", "YES", "", "", "" // I-S
  ];
  env.seedSheet("Transactions", [
    ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"],
    row
  ]);
}

// ---------------------------------------------------------------------
// Test group 1 — default behavior (no 5th argument) is UNCHANGED: a
// nearby similar amount is still skipped as a likely duplicate.
// ---------------------------------------------------------------------
(function testDefaultBehaviorUnchanged(){
  const { sandbox, env } = loadFinancialEventsSandbox();
  env.seedSheet("Investments", [
    ["Date", "Type", "Amount", "Note"],
    ["2026-08-10", "HDFC Mid Cap Fund", 4000, "Starting Balance"]
  ]);

  const resultNoArg = sandbox.autoLogInvestment("2026-08-11", "HDFC Mid Cap Fund", 4000, "SIP debit");
  assert(resultNoArg.logged === false && resultNoArg.reason === "duplicate",
    "with NO 5th argument, a nearby similar amount is still skipped as a likely duplicate (unchanged default), got " + JSON.stringify(resultNoArg));

  const resultExplicitFalse = sandbox.autoLogInvestment("2026-08-11", "HDFC Mid Cap Fund", 4000, "SIP debit", false);
  assert(resultExplicitFalse.logged === false && resultExplicitFalse.reason === "duplicate",
    "with skipDuplicateCheck explicitly false, a nearby similar amount is still skipped, got " + JSON.stringify(resultExplicitFalse));

  assert(env.sheetsByName["Investments"].rows.length === 2, "no new row was appended in either case above");
})();

// ---------------------------------------------------------------------
// Test group 2 — skipDuplicateCheck:true logs the SAME "duplicate"
// amount successfully instead of silently dropping it.
// ---------------------------------------------------------------------
(function testSkipDuplicateCheckLogsAnyway(){
  const { sandbox, env } = loadFinancialEventsSandbox();
  env.seedSheet("Investments", [
    ["Date", "Type", "Amount", "Note"],
    ["2026-08-10", "Tata Steel", 500, "an earlier purchase"]
  ]);

  const result = sandbox.autoLogInvestment("2026-08-11", "Tata Steel", 500, "bought more Tata Steel", true);
  assert(result.logged === true, "with skipDuplicateCheck:true, a similar nearby amount now logs successfully, got " + JSON.stringify(result));

  const rows = env.sheetsByName["Investments"].rows;
  assert(rows.length === 3, "a new row WAS appended this time, got " + rows.length + " total rows");
  assert(rows[2][1] === "Tata Steel" && rows[2][2] === 500, "the new row has the correct name/amount");
})();

// ---------------------------------------------------------------------
// Test group 3 — even with skipDuplicateCheck:true, the ONLY other way
// this can still report logged:false is a genuinely missing Investments
// sheet — there's no other silent-failure path left. (Real Apps Script
// note: the Investments sheet is a core, always-present sheet in this
// app — never auto-created — so this branch is not expected to fire in
// normal live use; this test exists purely to prove it's the only
// remaining possibility, for the "is this dead code now?" question.)
// ---------------------------------------------------------------------
(function testOnlyRemainingFalseCaseIsMissingSheet(){
  const { sandbox, env } = loadFinancialEventsSandbox();
  // Deliberately do NOT seed an "Investments" sheet at all.

  const result = sandbox.autoLogInvestment("2026-08-11", "Tata Steel", 500, "bought more Tata Steel", true);
  assert(result.logged === false && result.reason === "no sheet",
    'with skipDuplicateCheck:true and no Investments sheet, the only remaining failure reason is "no sheet", got ' + JSON.stringify(result));
})();

// ---------------------------------------------------------------------
// Test group 4 — end-to-end through the real call sites in
// saveTransactionNote (PWA.js): the note-matched investmentInstrument
// path now logs despite a nearby duplicate; the Financial Event
// "Investment" path still correctly skips it (regression check that
// this fix didn't leak into the wrong call site).
// ---------------------------------------------------------------------
(function testNoteMatchedPathLogsDespiteDuplicate(){
  const { sandbox, env } = loadFullBackendSandbox();
  seedTransactionsRow(env, 500);
  env.seedSheet("Investments", [
    ["Date", "Type", "Amount", "Note"],
    ["2026-08-10", "Tata Steel", 500, "an earlier purchase"]
  ]);

  const result = sandbox.saveTransactionNote(
    2, "bought more Tata Steel", "Financial", "", "Want", undefined,
    null, null, null, "Tata Steel" // investmentInstrument (note-matched path)
  );

  assert(result.investmentLogged === true,
    "the note-matched investmentInstrument path logs successfully even with a nearby duplicate present, got investmentLogged=" + result.investmentLogged);

  const rows = env.sheetsByName["Investments"].rows;
  assert(rows.length === 3, "a new Investments row WAS appended despite the nearby duplicate, got " + rows.length + " total rows");
})();

(function testFinancialEventInvestmentPathStillSkipsDuplicate(){
  const { sandbox, env } = loadFullBackendSandbox();
  seedTransactionsRow(env, 3000);
  env.seedSheet("Investments", [
    ["Date", "Type", "Amount", "Note"],
    ["2026-08-10", "HDFC Nifty 50 Index Fund", 3000, "an earlier manual entry"]
  ]);
  env.seedSheet("FinancialEvents", [["Type", "Amount", "Counterparty", "Confirmed", "Name"]]);

  const result = sandbox.saveTransactionNote(
    2, "SIP debit", "Financial", "", null, undefined,
    "Investment", "HDFC Nifty 50 Index Fund", null, undefined // financialEvent path, NOT investmentInstrument
  );

  assert(result.ok === true, "save reports ok:true");

  const rows = env.sheetsByName["Investments"].rows;
  assert(rows.length === 2,
    "the Financial Event/SIP path still correctly SKIPPED logging (no new row) because a nearby duplicate exists — regression check, got " + rows.length + " total rows");
})();

console.log("\nDone.");
