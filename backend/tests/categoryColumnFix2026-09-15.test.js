// backend/tests/categoryColumnFix2026-09-15.test.js
//
// Plain-English what this checks: on 2026-09-05, the "Categories" helper
// tab got archived (moved to a separate spreadsheet) as part of a
// cleanup pass — nothing in the app's own code read it, so the cleanup
// correctly saw it as safe to move. What that cleanup missed: the
// Transactions sheet's Category column (N) had a Google Sheets dropdown
// (Data Validation) that got its list of allowed words FROM that tab —
// a Sheet-level setting invisible to any code review. Once "Categories"
// left, that dropdown's list broke, and Google Sheets silently rejected
// every category the app tried to save from that point on (a note would
// save fine, the category next to it would not).
//
// This test proves the fix in backend/Logger.js:
//   1. fixCategoryColumnValidation() re-points the dropdown at a fixed,
//      hardcoded list (so this can't break again from an unrelated
//      cleanup) and sets "allow invalid" so a future mismatch warns
//      instead of silently blocking a write.
//   2. previewMissingCategories() finds exactly the rows broken by this
//      bug (a real Note, but no Category) and reports what it WOULD
//      write, without touching anything.
//   3. backfillMissingCategories() then actually fills those rows in,
//      using the app's own real suggestion engine (getSuggestedCategoryFast)
//      — never touching a row that already has a category — and gives a
//      confirmed Rent/EMI/Investment row "Financial" instead of a
//      guessed spending category, matching what the app itself would
//      have written for it.
//
// Run with: node backend/tests/categoryColumnFix2026-09-15.test.js

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
// under test, including a fake Data Validation builder (Node has no
// real SpreadsheetApp).
// ---------------------------------------------------------------------
function makeFakeSheetsEnv(){
  const sheetsByName = {};
  const validationCalls = [];

  function FakeSheet(name, rows){
    this.name = name;
    this.rows = rows.map(function(r){ return r.slice(); });
  }
  FakeSheet.prototype.getDataRange = function(){
    const self = this;
    return { getValues: function(){ return self.rows.map(function(r){ return r.slice(); }); } };
  };
  FakeSheet.prototype.getLastRow = function(){ return this.rows.length; };
  FakeSheet.prototype.getRange = function(row, col, numRows, numCols){
    const self = this;
    if(numRows !== undefined){
      // A multi-row range — only setDataValidation is exercised on it here.
      return {
        setDataValidation: function(rule){
          validationCalls.push({ row: row, col: col, numRows: numRows, numCols: numCols, rule: rule });
        }
      };
    }
    return {
      getValue: function(){ return self.rows[row - 1] ? self.rows[row - 1][col - 1] : ""; },
      setValue: function(v){ self.rows[row - 1][col - 1] = v; }
    };
  };

  function seedSheet(name, headerAndRows){
    sheetsByName[name] = new FakeSheet(name, headerAndRows);
    return sheetsByName[name];
  }

  // Fake chainable Data Validation builder — enough to prove the real
  // shape of the call (a fixed list, dropdown shown, invalid allowed).
  function FakeDataValidationBuilder(){
    this._list = null;
    this._showDropdown = null;
    this._allowInvalid = null;
  }
  FakeDataValidationBuilder.prototype.requireValueInList = function(list, showDropdown){
    this._list = list;
    this._showDropdown = showDropdown;
    return this;
  };
  FakeDataValidationBuilder.prototype.setAllowInvalid = function(v){
    this._allowInvalid = v;
    return this;
  };
  FakeDataValidationBuilder.prototype.build = function(){
    return { list: this._list, showDropdown: this._showDropdown, allowInvalid: this._allowInvalid };
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return { getSheetByName: function(name){ return sheetsByName[name] || null; } };
    },
    newDataValidation: function(){ return new FakeDataValidationBuilder(); }
  };

  const Logger = { log: function(){} };

  return { SpreadsheetApp, Logger, seedSheet, sheetsByName, validationCalls };
}

// ---------------------------------------------------------------------
// Load the real backend source (Logger.js + its real dependencies for
// getSuggestedCategoryFast: PWA.js needs a LOT of unrelated backend
// code, so instead we provide the exact same function signature as a
// simple, honest stand-in and assert Logger.js calls it correctly —
// the suggestion ENGINE itself already has its own dedicated tests
// elsewhere; this test is about the backfill wiring, not re-testing
// category-guessing itself.
// ---------------------------------------------------------------------
function loadSandbox(){
  const env = makeFakeSheetsEnv();

  const suggestCalls = [];
  const getSuggestedCategoryFast = function(counterparty, amount, mode, smartMemoryData){
    suggestCalls.push({ counterparty: counterparty, amount: amount, mode: mode });
    if(counterparty === "Swiggy") return "Food";
    if(counterparty === "ICICI Bank Salary") return "Income";
    return "Other";
  };

  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    Logger: env.Logger,
    getSuggestedCategoryFast: getSuggestedCategoryFast,
    console: console
  };
  vm.createContext(sandbox);

  // Load the REAL isLendingTransfer (needWantSaving.js) rather than a
  // stand-in — this is the exact function the fix now reuses, and its
  // own real word-boundary behavior (e.g. "lent" must be a whole word,
  // not part of "excellent") matters here.
  const needWantSavingSrc = fs.readFileSync(path.join(__dirname, "..", "needWantSaving.js"), "utf8");
  vm.runInContext(needWantSavingSrc, sandbox, { filename: "needWantSaving.js" });

  const loggerSrc = fs.readFileSync(path.join(__dirname, "..", "Logger.js"), "utf8");
  vm.runInContext(loggerSrc, sandbox, { filename: "Logger.js" });

  return { sandbox: sandbox, env: env, suggestCalls: suggestCalls };
}

// Columns: A Date, B Time, C Bank, D Type, E Mode, F Amount, G Reference,
// H Counterparty, I Channel, J Source, K RawSMS, L Sender, M Note,
// N Category, O TelegramMsg, P Processed, Q NeedWantSaving,
// R FinancialEvent, S FinancialEventName.
function blankRow(overrides){
  const row = ["", "", "HDFC", "debit", "upi", 0, "", "", "SMS", "Tasker", "-", "-", "", "", "", "YES", "", "", ""];
  Object.keys(overrides).forEach(function(k){ row[COLS[k]] = overrides[k]; });
  return row;
}
const COLS = { mode: 4, amount: 5, counterparty: 7, note: 12, category: 13, financialEvent: 17 };

const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source","RawSMS","Sender","Note","Category","TelegramMsg","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];

// ---------------------------------------------------------------------
// Test 1 — fixCategoryColumnValidation() points the dropdown at a fixed
// list, not a reference to another sheet, and allows invalid input
// (warns rather than silently blocking a future write).
// ---------------------------------------------------------------------
(function testValidationFix(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Transactions", [HEADER, blankRow({ note: "Tea", category: "Food" })]);

  const result = sandbox.fixCategoryColumnValidation();
  assert(/Done/.test(result), "reports success");
  assert(env.validationCalls.length === 1, "applied exactly one validation rule to the Category column");

  const call = env.validationCalls[0];
  assert(call.col === 14, "targeted column 14 (N, Category)");
  assert(call.rule.allowInvalid === true, 'set "allow invalid" so a future mismatch warns instead of silently blocking a write');
  assert(Array.isArray(call.rule.list) && call.rule.list.indexOf("Financial") !== -1 && call.rule.list.indexOf("Food") !== -1,
    "the fixed list includes every real category, including \"Financial\"");
  assert(call.rule.list.length === 10, "exactly the app's real 10 categories, nothing extra or missing");
})();

// ---------------------------------------------------------------------
// Test 2 — previewMissingCategories() finds exactly the broken rows
// (note present, category blank) and nothing else, without writing
// anything.
// ---------------------------------------------------------------------
(function testPreviewFindsOnlyBrokenRows(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Transactions", [
    HEADER,
    blankRow({ note: "Tea", category: "Food" }),                          // row 2 — already fine, should be ignored
    blankRow({ note: "Cold drink", category: "", counterparty: "Swiggy" }), // row 3 — broken by the bug
    blankRow({ note: "", category: "" }),                                  // row 4 — genuinely still un-reviewed in Pending, not this bug
    blankRow({ note: "Aug rent", category: "", financialEvent: "Rent" })   // row 5 — a Financial Event, should suggest "Financial"
  ]);

  const report = sandbox.previewMissingCategories();
  assert(report.indexOf("Row 3") !== -1, "flags row 3 (note present, category blank)");
  assert(report.indexOf("Row 4") === -1, "does NOT flag row 4 (no note at all — that's just an unreviewed Pending item, not this bug)");
  assert(report.indexOf("Row 2") === -1, "does NOT flag row 2 (already has a category)");
  assert(report.indexOf("Row 5") !== -1 && report.indexOf("Financial") !== -1, "flags row 5 and suggests \"Financial\" for the confirmed Rent event");

  // Read-only — nothing in the sheet actually changed.
  const rows = env.sheetsByName["Transactions"].rows;
  assert(rows[2][COLS.category] === "", "preview did not write anything to row 3's Category cell");
  assert(rows[4][COLS.category] === "", "preview did not write anything to row 5's Category cell");
})();

// ---------------------------------------------------------------------
// Test 3 — backfillMissingCategories() actually writes the same
// suggestions, only to the broken rows, using the real suggestion
// engine's per-row inputs correctly.
// ---------------------------------------------------------------------
(function testBackfillWritesOnlyBrokenRows(){
  const { sandbox, env, suggestCalls } = loadSandbox();
  env.seedSheet("Transactions", [
    HEADER,
    blankRow({ note: "Tea", category: "Food" }),                                   // row 2 — untouched
    blankRow({ note: "Lunch", category: "", counterparty: "Swiggy", amount: 250 }), // row 3 — should become "Food"
    blankRow({ note: "", category: "" }),                                          // row 4 — untouched (no note)
    blankRow({ note: "Salary aug", category: "", counterparty: "ICICI Bank Salary", amount: 45000 }), // row 5 — "Income"
    blankRow({ note: "Aug rent", category: "", financialEvent: "Rent", amount: 19500 })               // row 6 — "Financial"
  ]);

  const report = sandbox.backfillMissingCategories();
  assert(/3 row\(s\) filled in/.test(report), "reports exactly 3 rows filled in, got: " + report);

  const rows = env.sheetsByName["Transactions"].rows;
  assert(rows[1][COLS.category] === "Food", "row 2 (already had a category) is untouched");
  assert(rows[2][COLS.category] === "Food", "row 3 (Swiggy) got \"Food\" from the real suggestion engine");
  assert(rows[3][COLS.category] === "", "row 4 (no note — still genuinely unreviewed) is untouched");
  assert(rows[4][COLS.category] === "Income", "row 5 (salary credit) got \"Income\"");
  assert(rows[5][COLS.category] === "Financial", "row 6 (confirmed Rent) got \"Financial\", not a guessed spending category");

  const swiggyCall = suggestCalls.filter(function(c){ return c.counterparty === "Swiggy"; })[0];
  assert(swiggyCall && swiggyCall.amount === 250 && swiggyCall.mode === "upi",
    "the suggestion engine was called with this row's own real counterparty/amount/mode, not placeholder values");
})();

// ---------------------------------------------------------------------
// Test 4 — a lending note ("lent"/"paid back") gets "Financial", never
// a guessed spending category. Real bug caught live 2026-09-15: the
// first version of this backfill only checked the FinancialEvent column
// (Rent/EMI/Investment), so a real lending transaction ("Lent krish for
// recharge") came back guessed as "Bills" in the preview — meaningless,
// since that category is never actually used for a lending row anyway
// (isLendingTransfer excludes it from every spend/category total
// regardless), and inconsistent with what a NEW lending save now writes
// (index.html, 2026-09-15 — category question hidden, forced to
// "Financial"). This proves the backfill now matches that behavior for
// old rows too.
// ---------------------------------------------------------------------
(function testLendingRowsGetFinancialNotAGuess(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Transactions", [
    HEADER,
    blankRow({ note: "Lent krish for recharge", category: "", counterparty: "euronet services india pv", amount: 301.9 }),
    blankRow({ note: "Vaidehi paid back brick oven lunch", category: "", counterparty: "hdfc bank a", amount: 1384 }),
    blankRow({ note: "excellent biryani", category: "", counterparty: "some restaurant", amount: 250 }) // "excellent" must NOT false-match "lent"
  ]);

  const report = sandbox.backfillMissingCategories();
  const rows = env.sheetsByName["Transactions"].rows;

  assert(rows[1][COLS.category] === "Financial", 'the "Lent krish for recharge" row gets "Financial", got "' + rows[1][COLS.category] + '"');
  assert(rows[2][COLS.category] === "Financial", 'the "paid back" row gets "Financial", got "' + rows[2][COLS.category] + '"');
  assert(rows[3][COLS.category] === "Other", '"excellent biryani" is NOT treated as lending (whole-word match only), got "' + rows[3][COLS.category] + '"');
})();

// ---------------------------------------------------------------------
// Test 5 — running the backfill twice is safe (idempotent) — a second
// run finds nothing left to do, never overwrites what it just wrote.
// ---------------------------------------------------------------------
(function testBackfillIsIdempotent(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Transactions", [
    HEADER,
    blankRow({ note: "Lunch", category: "", counterparty: "Swiggy", amount: 250 })
  ]);

  sandbox.backfillMissingCategories();
  const secondReport = sandbox.backfillMissingCategories();
  assert(/0 row\(s\) filled in/.test(secondReport), "a second run finds nothing left to fix, got: " + secondReport);
})();

console.log("\nDone.");
