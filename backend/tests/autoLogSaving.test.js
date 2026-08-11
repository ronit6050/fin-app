// backend/tests/autoLogSaving.test.js
//
// Plain-English what this checks: when a bank transaction's note has the
// word "saving" in it, the app auto-logs that money into the Savings
// screen for you. There used to be a bug where that auto-logged money
// was written under old bucket names ("WishList" / "FreeSavings") that
// the CURRENT Savings screen (Emergency / Goals / Free Savings) no
// longer recognizes — so 2 out of 3 rupees of that money silently
// stopped showing up in your Savings totals, even though it was still
// physically sitting in the spreadsheet. Fixed 2026-08-11 — see
// docs/features/savings-v2.md and CLAUDE.md's 2026-08-11 note.
//
// This test loads the REAL backend source files (financialEvents.js +
// savingsGoals.js) into a small fake Google Sheets environment (no real
// Apps Script/Google account needed) and proves:
//   1. A new auto-detected "saving" writes to Destination "Free" (the
//      new system's real bucket name), never the old "WishList"/
//      "FreeSavings" names.
//   2. That money is then actually counted by getSavingsBreakdown() —
//      the same function that powers the real Savings screen — proving
//      it's no longer invisible.
//   3. The existing "don't log a duplicate" protection still works
//      after the fix.
//
// Run with: node backend/tests/autoLogSaving.test.js

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
// A tiny fake Google Sheets environment — just enough for the functions
// under test (appendRow / getDataRange().getValues() / getLastRow()).
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
      // Only the "yyyy-MM-dd" format is used by the code under test.
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
// way Apps Script's single global scope actually works.
// ---------------------------------------------------------------------
function loadBackendSandbox(){
  const env = makeFakeSheetsEnv();

  // getSettings() is used elsewhere in savingsGoals.js (e.g.
  // getSavingsBreakdown's emergency target) — provide a minimal stand-in
  // so those code paths don't crash if exercised.
  const getSettings = function(){ return { monthlyExpenses: 20000 }; };

  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    Utilities: env.Utilities,
    Session: env.Session,
    Logger: env.Logger,
    getSettings: getSettings,
    console: console
  };
  vm.createContext(sandbox);

  const financialEventsSrc = fs.readFileSync(
    path.join(__dirname, "..", "financialEvents.js"), "utf8"
  );
  const savingsGoalsSrc = fs.readFileSync(
    path.join(__dirname, "..", "savingsGoals.js"), "utf8"
  );

  // savingsGoals.js first, since financialEvents.js's autoLogSaving now
  // calls getSavingsSheet_ from it — matches real load order concerns
  // not mattering in Apps Script (one shared global scope), but we still
  // need both defined before either is called.
  vm.runInContext(savingsGoalsSrc, sandbox, { filename: "savingsGoals.js" });
  vm.runInContext(financialEventsSrc, sandbox, { filename: "financialEvents.js" });

  return { sandbox: sandbox, env: env };
}

// ---------------------------------------------------------------------
// Test 1 — a fresh auto-detected saving lands on "Free", not the old
// pot names.
// ---------------------------------------------------------------------
(function testWritesToFreeNotOldPotNames(){
  const { sandbox, env } = loadBackendSandbox();
  env.seedSheet("Savings", [["Date", "Amount", "Type", "Note", "Destination"]]);

  const result = sandbox.autoLogSaving("2026-08-11", 900, "put aside some saving this month");
  assert(result.logged === true, "autoLogSaving() reports logged:true for a fresh entry");

  const rows = env.sheetsByName["Savings"].rows;
  assert(rows.length === 2, "exactly one new row was appended (no more, no less)");

  const newRow = rows[1];
  const destination = newRow[4];
  assert(destination === "Free", 'new row\'s Destination is "Free" (the current system\'s bucket name), got "' + destination + '"');
  assert(destination !== "WishList" && destination !== "FreeSavings",
    "new row does NOT use either of the old, now-unrecognized pot names");
  assert(newRow[1] === 900, "the full amount (₹900) was written, not split across buckets");
  assert(newRow[2] === "auto", 'Type column is "auto", matching the pattern saveAutoSplit/saveManualSplit already use');
  assert(newRow[3] === "put aside some saving this month", "the original transaction note was preserved");
})();

// ---------------------------------------------------------------------
// Test 2 — that money is now actually counted by the real Savings
// screen's own read function, proving it's no longer invisible.
// ---------------------------------------------------------------------
(function testMoneyIsCountedByRealBreakdown(){
  const { sandbox, env } = loadBackendSandbox();
  env.seedSheet("Savings", [["Date", "Amount", "Type", "Note", "Destination"]]);

  sandbox.autoLogSaving("2026-08-11", 1500, "saving for later");

  const breakdown = sandbox.getSavingsBreakdown();
  assert(breakdown.free === 1500,
    "getSavingsBreakdown() (the real Savings screen's data source) now counts the auto-logged ₹1500 under Free, got ₹" + breakdown.free);
})();

// ---------------------------------------------------------------------
// Test 3 — no amount ever silently goes to the old "Emergency" split
// portion either; the whole thing goes to Free, per the documented
// product decision (auto-detection shouldn't guess into a locked or
// user-picked bucket).
// ---------------------------------------------------------------------
(function testNothingRoutedToEmergencyOrAGoal(){
  const { sandbox, env } = loadBackendSandbox();
  env.seedSheet("Savings", [["Date", "Amount", "Type", "Note", "Destination"]]);
  env.seedSheet("Goals", [["Name", "Type", "Target", "Status", "Priority", "DateAdded"]]);

  sandbox.autoLogSaving("2026-08-11", 2000, "saving");

  const breakdown = sandbox.getSavingsBreakdown();
  assert(breakdown.emergency === 0, "no portion was routed into Emergency (a locked bucket the user never chose)");
  assert(breakdown.free === 2000, "the entire ₹2000 landed in Free Savings, got ₹" + breakdown.free);
})();

// ---------------------------------------------------------------------
// Test 4 — duplicate protection still works after the fix (this logic
// was NOT changed, but a fix like this is exactly the kind of change
// that can accidentally break an unrelated neighboring check).
// ---------------------------------------------------------------------
(function testDuplicateStillSkipped(){
  const { sandbox, env } = loadBackendSandbox();
  env.seedSheet("Savings", [
    ["Date", "Amount", "Type", "Note", "Destination"],
    ["2026-08-10", 500, "manual", "already logged by hand", "Free"]
  ]);

  const result = sandbox.autoLogSaving("2026-08-11", 500, "saving");
  assert(result.logged === false && result.reason === "duplicate",
    "a same-amount entry logged a day earlier is still correctly skipped as a likely duplicate");
})();

// ---------------------------------------------------------------------
// Test 5 — an invalid/zero amount is rejected rather than writing a
// junk row (small hardening added as part of this fix).
// ---------------------------------------------------------------------
(function testInvalidAmountRejected(){
  const { sandbox, env } = loadBackendSandbox();
  env.seedSheet("Savings", [["Date", "Amount", "Type", "Note", "Destination"]]);

  const result = sandbox.autoLogSaving("2026-08-11", 0, "saving");
  assert(result.logged === false, "a zero/invalid amount is not written as a Savings row");
})();

console.log("\nDone.");
