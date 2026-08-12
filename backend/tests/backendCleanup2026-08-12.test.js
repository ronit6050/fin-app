// backend/tests/backendCleanup2026-08-12.test.js
//
// Plain-English what this checks: a full cleanup pass went through
// backend/*.js looking for code that nothing actually uses anymore (old
// leftover pieces from past rebuilds) and removed it. The one hard rule
// for that pass was "the real app must not break." This test proves
// that rule held, for the two riskiest removals:
//
//   1. The old 4-pot Savings functions (getSavingsData, logSavingFromApp,
//      logCCBufferSaving, addWishlistItemFromApp,
//      markWishlistPurchasedFromApp) and their PWA action routes
//      (getSavings/logSaving/logCCBuffer/addWishlistItem/
//      markWishlistPurchased) really are gone from the code — proving
//      the cleanup actually happened, not just claimed.
//   2. The Home screen's main data call, getDashboardData() — which
//      USED TO also quietly call getSavingsData() on every single
//      load, even though nothing on screen ever showed that result —
//      still runs correctly end-to-end after removing that call: no
//      crash, and the real data screens (today/month/cash/cc/debts/
//      investments/savingsGoals/pending) are all still present in its
//      response exactly as before.
//   3. category.js's askAI/normalize/extractKeyword (plain unused
//      wrapper functions, nothing anywhere called them) are gone, while
//      getCategory() — which IS still a real fallback used inside
//      getSmartCategory() — still works normally.
//
// This test loads the REAL backend source files into a small fake
// Google Sheets/Apps Script environment (no real Apps Script/Google
// account or network needed).
//
// Run with: node backend/tests/backendCleanup2026-08-12.test.js

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
// A tiny fake Google Sheets + Apps Script environment — same shape as
// the other tests in this folder, plus a fake PropertiesService (needed
// because getDashboardData() now reaches getSettings(), which several
// of the newer files call).
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
      // Only "yyyy-MM-dd" and "dd MMM" are used by the code under test;
      // "yyyy-MM-dd" is the only one anything in this test asserts on.
      const d = new Date(date);
      const pad = function(n){ return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  };

  const Session = { getScriptTimeZone: function(){ return "UTC"; } };
  const Logger = { log: function(){} };

  const propsStore = {};
  const PropertiesService = {
    getScriptProperties: function(){
      return {
        getProperty: function(key){
          return Object.prototype.hasOwnProperty.call(propsStore, key) ? propsStore[key] : null;
        },
        setProperty: function(key, value){ propsStore[key] = String(value); },
        deleteProperty: function(key){ delete propsStore[key]; }
      };
    }
  };

  return { SpreadsheetApp, Utilities, Session, Logger, PropertiesService, seedSheet, sheetsByName };
}

// ---------------------------------------------------------------------
// Load the real backend source into a sandbox sharing globals, the same
// way Apps Script's single global scope actually works.
// ---------------------------------------------------------------------
function loadBackendSandbox(){
  const env = makeFakeSheetsEnv();

  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    Utilities: env.Utilities,
    Session: env.Session,
    Logger: env.Logger,
    PropertiesService: env.PropertiesService,
    console: console
  };
  vm.createContext(sandbox);

  // Every file getDashboardData() actually touches, once you follow it
  // all the way down: Logger (logAI, used by error handlers), settings,
  // needWantSaving, financialEvents, investmentInstruments, savingsGoals,
  // category (for normalizeText/getCategory — loaded even though the
  // test rows below use a blank counterparty, just so the "askAI/
  // normalize/extractKeyword are gone" check has real category.js code
  // to check against), then PWA.js itself last (depends on everything
  // above).
  const files = [
    "Logger.js",
    "settings.js",
    "needWantSaving.js",
    "financialEvents.js",
    "investmentInstruments.js",
    "savingsGoals.js",
    "category.js",
    "PWA.js"
  ];
  files.forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return { sandbox: sandbox, env: env };
}

// A minimal but realistic set of sheets — just enough for
// getDashboardData() to run its full chain without hitting a missing
// sheet. Counterparty (Transactions column H) is left blank in the one
// seeded row, same reasoning as investmentInstrumentSkipsNeedWantSaving
// .test.js: keeps getSuggestedCategoryFast from needing a SmartMemory
// sheet, so this test can stay focused on "does it crash / does the
// shape stay right," not re-test category matching (already covered
// elsewhere).
function seedAllDashboardSheets(env){
  // getTodaySummary compares this row's date against the REAL current
  // date (new Date()), not a fixed one — so the seeded row has to use
  // today's actual date for the "todaySpend" assertion below to mean
  // anything.
  const todayStr = env.Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
  env.seedSheet("Transactions", [
    ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"],
    [todayStr,"10:00","HDFC","debit","upi",250,"REF001","","","","","","lunch","Food","","YES","Want","",""]
  ]);
  env.seedSheet("Cash", [
    ["Row","Date","Time","Type","Amount","Note","Category","Source","X","Date2","NeedWantSaving"]
  ]);
  env.seedSheet("Debts", [
    ["Date","Person","Type","Amount","Note","DueDate","Status","SettledDate"]
  ]);
  env.seedSheet("Investments", [
    ["Date","Type","Amount","Note"]
  ]);
  env.seedSheet("Savings", [
    ["Date","Amount","Type","Note","Destination"]
  ]);
  // Goals / InvestmentInstruments / FinancialEvents are all auto-created
  // by the real code the first time they're asked for — deliberately
  // NOT pre-seeding them here, to also prove that auto-create path still
  // works inside the full getDashboardData() chain.
}

// ---------------------------------------------------------------------
// Test 1 — the 5 old 4-pot Savings functions are really gone from the
// loaded code (not just "unused," actually removed).
// ---------------------------------------------------------------------
(function testOldSavingsFunctionsAreGone(){
  const { sandbox } = loadBackendSandbox();

  ["getSavingsData", "logSavingFromApp", "logCCBufferSaving", "addWishlistItemFromApp", "markWishlistPurchasedFromApp"]
    .forEach(function(name){
      assert(
        typeof sandbox[name] === "undefined",
        name + "() no longer exists on the loaded backend, got typeof " + typeof sandbox[name]
      );
    });
})();

// ---------------------------------------------------------------------
// Test 2 — the old category.js wrapper functions are really gone, but
// the one still-needed function (getCategory) still works.
// ---------------------------------------------------------------------
(function testOldCategoryWrappersAreGoneButGetCategoryWorks(){
  const { sandbox } = loadBackendSandbox();

  ["askAI", "normalize", "extractKeyword", "migrateToSmartMemory"].forEach(function(name){
    assert(
      typeof sandbox[name] === "undefined",
      name + "() no longer exists on the loaded backend, got typeof " + typeof sandbox[name]
    );
  });

  assert(typeof sandbox.getCategory === "function", "getCategory() is still present (it's a real fallback used inside getSmartCategory)");
  const result = sandbox.getCategory("random unmatched note text", null);
  assert(typeof result === "string" && result.length > 0, "getCategory() still runs and returns a category string, got " + JSON.stringify(result));
})();

// ---------------------------------------------------------------------
// Test 3 — handlePwaRequest's dispatcher no longer recognizes the 5 old
// action strings (proves the routing, not just the functions, is gone).
// Bypasses the real Google sign-in check by calling the dispatcher logic
// directly isn't possible without a valid token, so instead this checks
// the same thing a different, simpler way: the source code itself no
// longer contains those action string checks. (handlePwaRequest's auth
// gate is already covered by verifyGoogleIdTokenCache.test.js — no need
// to duplicate faking a Google token check here.)
// ---------------------------------------------------------------------
(function testOldActionRoutesGoneFromSource(){
  const src = fs.readFileSync(path.join(__dirname, "..", "PWA.js"), "utf8");
  ["\"getSavings\"", "\"logSaving\"", "\"logCCBuffer\"", "\"addWishlistItem\"", "\"markWishlistPurchased\""].forEach(function(actionLiteral){
    assert(
      !src.includes("data.action === " + actionLiteral),
      "PWA.js no longer routes action " + actionLiteral
    );
  });
  // Sanity check the search itself isn't vacuously true — a real,
  // still-live action string should still be found the same way.
  assert(src.includes('data.action === "getSavingsGoals"'), "sanity check: a real, still-live action (getSavingsGoals) is still found the same way");
})();

// ---------------------------------------------------------------------
// Test 4 — getDashboardData() (the Home screen's main data source)
// still runs successfully end-to-end after removing its old, unused
// getSavingsData() call — no crash, and every screen's data is still in
// the response.
// ---------------------------------------------------------------------
(function testDashboardStillWorksAfterCleanup(){
  const { sandbox, env } = loadBackendSandbox();
  seedAllDashboardSheets(env);

  let result;
  let threw = null;
  try{
    result = sandbox.getDashboardData();
  }catch(err){
    threw = err;
  }

  assert(threw === null, "getDashboardData() ran without throwing, got: " + (threw ? threw.toString() : ""));
  if(threw) return;

  assert(typeof result === "object" && result !== null, "getDashboardData() returned an object");
  assert(typeof result.full === "object", "result.full is present");

  ["today", "month", "cash", "cc", "debts", "investments", "savingsGoals", "pending"].forEach(function(key){
    assert(
      Object.prototype.hasOwnProperty.call(result.full, key),
      "result.full still has \"" + key + "\" (unaffected by the cleanup)"
    );
  });

  assert(
    !Object.prototype.hasOwnProperty.call(result.full, "savings"),
    "result.full no longer has the old \"savings\" key — index.html never read it (only reads full.savingsGoals), so this is the actual fix, not just the function removal"
  );

  // Basic sanity on the still-present numbers, so this isn't just
  // checking key names.
  assert(result.todaySpend === 250, "today's spend still computed correctly from the seeded ₹250 transaction, got " + result.todaySpend);
  assert(typeof result.full.savingsGoals === "object", "full.savingsGoals (the real, live Savings data) is still a real object");
})();

console.log("\nDone.");
