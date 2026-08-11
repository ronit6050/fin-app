// backend/tests/investmentInstruments.test.js
//
// Plain-English what this checks: the Investments tab used to group your
// money by whatever text you happened to type ("Nifty 50" one day,
// "Nifty 50 SIP" another) — so the same fund could show up as two
// separate lines. This change replaces that with a fixed list of your
// real 15 investments, so every entry always uses the exact same name.
// This test proves, without touching the real Google Sheet:
//   1. The fixed list is seeded correctly (all 15 names, right category,
//      right SIP amounts) the first time the sheet is created.
//   2. Typing a known instrument's name in a note (e.g. "bought some Tata
//      Steel today") is recognized, and recognized as a WHOLE WORD/PHRASE
//      — not a loose substring (same bug class as the "lent" inside
//      "excellent" bug documented in needWantSaving.js: here, "LIC"
//      inside "PUBLIC"/"POLICY" must NOT match, and "Tata Steel" must
//      never be confused with "Tata Motors Commercial" just because they
//      share the word "Tata").
//   3. A note that just says "stock"/"shares" with no specific name gets
//      flagged as "looks new, needs a name" rather than silently ignored.
//   4. Adding a brand-new instrument works, rejects a duplicate name, and
//      rejects an invalid category.
//   5. Checking a name against the list (validateInvestmentInstrumentName_)
//      is case-insensitive but always returns the sheet's own exact
//      spelling — this is what keeps every future write consistent.
//   6. The one-time migration function replaces the 5 old generic rows
//      with the 15 new named ones (right amounts, right note), and
//      registers the 3 real SIPs into FinancialEvents so they're
//      recognized by amount from day one.
//
// Run with: node backend/tests/investmentInstruments.test.js

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
// under test (appendRow / getDataRange().getValues() / getLastRow() /
// getRange().getValue()/setValue() / deleteRows / insertSheet).
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
  // rowPosition is 1-based, same as real Apps Script.
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
// financialEvents.js too, since migrateInvestmentsToNamedInstruments()
// calls recordFinancialEvent() from it.
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

  const investmentInstrumentsSrc = fs.readFileSync(
    path.join(__dirname, "..", "investmentInstruments.js"), "utf8"
  );
  const financialEventsSrc = fs.readFileSync(
    path.join(__dirname, "..", "financialEvents.js"), "utf8"
  );

  vm.runInContext(investmentInstrumentsSrc, sandbox, { filename: "investmentInstruments.js" });
  vm.runInContext(financialEventsSrc, sandbox, { filename: "financialEvents.js" });

  return { sandbox: sandbox, env: env };
}

const EXPECTED_NAMES = [
  "HDFC Nifty 50 Index Fund", "HDFC Mid Cap Fund", "Bandhan Small Cap (Money2Mgt SIP)",
  "Motilal Oswal Flexi Cap", "HDFC Gold ETF Fund", "Bandhan Small Cap",
  "ICICI Prudential", "HDFC Silver ETF", "Motilal Oswal Midcap",
  "Digital Gold",
  "Tata Motors Commercial", "Tata Steel", "LIC", "HDFC Bank", "Tata Motors Passenger"
];

// ---------------------------------------------------------------------
// Test 1 — the sheet auto-creates AND seeds all 15 real instruments,
// correctly grouped by category.
// ---------------------------------------------------------------------
(function testSeedingIsCorrect(){
  const { sandbox } = loadBackendSandbox();
  const list = sandbox.getInvestmentInstrumentsList();

  assert(list.instruments.length === 15, "exactly 15 instruments seeded, got " + list.instruments.length);

  EXPECTED_NAMES.forEach(function(name){
    const found = list.instruments.some(function(inst){ return inst.name === name; });
    assert(found, 'seed list includes "' + name + '"');
  });

  const sips = list.instruments.filter(function(i){ return i.category === "SIP"; });
  assert(sips.length === 3, "exactly 3 SIP instruments, got " + sips.length);
  const nifty = sips.find(function(i){ return i.name === "HDFC Nifty 50 Index Fund"; });
  assert(nifty && nifty.sipAmount === 3000, "HDFC Nifty 50 Index Fund SIP amount is 3000, got " + (nifty && nifty.sipAmount));
  const midcap = sips.find(function(i){ return i.name === "HDFC Mid Cap Fund"; });
  assert(midcap && midcap.sipAmount === 4000, "HDFC Mid Cap Fund SIP amount is 4000, got " + (midcap && midcap.sipAmount));
  const bandhanSip = sips.find(function(i){ return i.name === "Bandhan Small Cap (Money2Mgt SIP)"; });
  assert(bandhanSip && bandhanSip.sipAmount === 2000, "Bandhan Small Cap (Money2Mgt SIP) amount is 2000, got " + (bandhanSip && bandhanSip.sipAmount));

  const oneTime = list.instruments.filter(function(i){ return i.category === "One-time Fund"; });
  assert(oneTime.length === 6, "exactly 6 One-time Fund instruments, got " + oneTime.length);

  const stocks = list.instruments.filter(function(i){ return i.category === "Stock"; });
  assert(stocks.length === 5, "exactly 5 Stock instruments, got " + stocks.length);

  const gold = list.instruments.filter(function(i){ return i.category === "Gold"; });
  assert(gold.length === 1 && gold[0].name === "Digital Gold", "exactly 1 Gold instrument, Digital Gold");

  // grouped shape has one entry per category, in the fixed order.
  assert(list.grouped.length === 4, "grouped list has 4 category buckets");
  assert(list.grouped[0].category === "SIP", "grouped list's first bucket is SIP");
})();

// ---------------------------------------------------------------------
// Test 2 — note-text matching recognizes a known instrument, whole-
// phrase only (not a loose substring).
// ---------------------------------------------------------------------
(function testNoteMatchingRecognizesKnownInstruments(){
  const { sandbox, env } = loadBackendSandbox();
  sandbox.getInvestmentInstrumentsSheet_(); // triggers auto-create + seed
  const instrumentsData = env.sheetsByName["InvestmentInstruments"].getDataRange().getValues();

  const r1 = sandbox.matchInvestmentInstrumentByNote("bought some Tata Steel today", instrumentsData);
  assert(r1 && r1.name === "Tata Steel" && r1.confident === true, 'recognizes "Tata Steel" in a note, got ' + JSON.stringify(r1));

  const r2 = sandbox.matchInvestmentInstrumentByNote("topped up HDFC Gold ETF Fund", instrumentsData);
  assert(r2 && r2.name === "HDFC Gold ETF Fund" && r2.confident === true, 'recognizes "HDFC Gold ETF Fund", got ' + JSON.stringify(r2));

  // "Tata Steel" and "Tata Motors Commercial" share a first word — must
  // never be confused with each other.
  const r3 = sandbox.matchInvestmentInstrumentByNote("bought Tata Motors Commercial shares", instrumentsData);
  assert(r3 && r3.name === "Tata Motors Commercial", 'recognizes the FULL phrase "Tata Motors Commercial", not just "Tata", got ' + JSON.stringify(r3));

  // A plain "Tata" mention alone (no full instrument name) should NOT
  // match either of the two Tata instruments.
  const r4 = sandbox.matchInvestmentInstrumentByNote("paid Tata Sky bill", instrumentsData);
  assert(!(r4 && r4.confident === true), 'a bare "Tata" mention (Tata Sky, unrelated) does not falsely match a Tata investment, got ' + JSON.stringify(r4));
})();

// ---------------------------------------------------------------------
// Test 3 — the exact substring-bug class already documented in this
// project ("lent" inside "excellent") must not recur here: "LIC" as a
// short name must not match inside "PUBLIC" or "POLICY".
// ---------------------------------------------------------------------
(function testNoFalsePositiveSubstringMatch(){
  const { sandbox, env } = loadBackendSandbox();
  sandbox.getInvestmentInstrumentsSheet_();
  const instrumentsData = env.sheetsByName["InvestmentInstruments"].getDataRange().getValues();

  const r1 = sandbox.matchInvestmentInstrumentByNote("paid public transport fare", instrumentsData);
  assert(!(r1 && r1.name === "LIC"), '"LIC" does not falsely match inside "pUBLIc", got ' + JSON.stringify(r1));

  const r2 = sandbox.matchInvestmentInstrumentByNote("renewed my car insurance policy", instrumentsData);
  assert(!(r2 && r2.name === "LIC"), '"LIC" does not falsely match inside "poLICy", got ' + JSON.stringify(r2));

  // A genuine LIC mention, as its own word, DOES match.
  const r3 = sandbox.matchInvestmentInstrumentByNote("LIC premium payment", instrumentsData);
  assert(r3 && r3.name === "LIC", 'a real, whole-word "LIC" mention DOES match, got ' + JSON.stringify(r3));
})();

// ---------------------------------------------------------------------
// Test 4 — an unnamed "stock"/"shares" mention is flagged as "looks
// new," and a completely unrelated note returns null (nothing to show).
// ---------------------------------------------------------------------
(function testUnnamedStockSignalAndNoSignal(){
  const { sandbox, env } = loadBackendSandbox();
  sandbox.getInvestmentInstrumentsSheet_();
  const instrumentsData = env.sheetsByName["InvestmentInstruments"].getDataRange().getValues();

  const r1 = sandbox.matchInvestmentInstrumentByNote("bought some new stocks today", instrumentsData);
  assert(r1 && r1.name === null && r1.confident === false, 'an unnamed "stocks" mention returns {name:null, confident:false}, got ' + JSON.stringify(r1));

  const r2 = sandbox.matchInvestmentInstrumentByNote("bought shares in a new company", instrumentsData);
  assert(r2 && r2.name === null && r2.confident === false, 'an unnamed "shares" mention returns {name:null, confident:false}, got ' + JSON.stringify(r2));

  const r3 = sandbox.matchInvestmentInstrumentByNote("dinner with friends", instrumentsData);
  assert(r3 === null, "a completely unrelated note returns null (nothing to show), got " + JSON.stringify(r3));

  const r4 = sandbox.matchInvestmentInstrumentByNote("", instrumentsData);
  assert(r4 === null, "an empty note returns null");
})();

// ---------------------------------------------------------------------
// Test 5 — validateInvestmentInstrumentName_: case-insensitive match,
// always returns the sheet's own canonical spelling, rejects unknowns.
// ---------------------------------------------------------------------
(function testValidateInstrumentName(){
  const { sandbox } = loadBackendSandbox();

  const v1 = sandbox.validateInvestmentInstrumentName_("tata steel");
  assert(v1.ok === true && v1.name === "Tata Steel", 'lowercase "tata steel" validates and returns the canonical "Tata Steel", got ' + JSON.stringify(v1));

  const v2 = sandbox.validateInvestmentInstrumentName_("Some Random Fund Nobody Added");
  assert(v2.ok === false, "an unknown instrument name is rejected");

  const v3 = sandbox.validateInvestmentInstrumentName_("");
  assert(v3.ok === false, "a blank name is rejected");
})();

// ---------------------------------------------------------------------
// Test 6 — addInvestmentInstrument: adds a valid new one, rejects a
// duplicate (case-insensitive) and an invalid category.
// ---------------------------------------------------------------------
(function testAddInvestmentInstrument(){
  const { sandbox } = loadBackendSandbox();

  const r1 = sandbox.addInvestmentInstrument("Nippon India Small Cap", "Stock");
  assert(r1.ok === true, "a brand-new instrument is added successfully");

  const list = sandbox.getInvestmentInstrumentsList();
  assert(list.instruments.some(function(i){ return i.name === "Nippon India Small Cap"; }),
    "the newly-added instrument now appears in the full list");

  const r2 = sandbox.addInvestmentInstrument("tata steel", "Stock"); // already exists, different case
  assert(r2.ok === false, "adding a name that already exists (case-insensitive) is rejected");

  const r3 = sandbox.addInvestmentInstrument("Some New Fund", "NotARealCategory");
  assert(r3.ok === false, "an invalid category is rejected");

  const r4 = sandbox.addInvestmentInstrument("", "Stock");
  assert(r4.ok === false, "a blank name is rejected");
})();

// ---------------------------------------------------------------------
// Test 7 — the one-time migration: removes the 5 old generic rows,
// writes the 15 new named rows with the exact given amounts/note, and
// registers the 3 real SIPs into FinancialEvents.
// ---------------------------------------------------------------------
(function testMigrationReplacesOldRowsAndRegistersSips(){
  const { sandbox, env } = loadBackendSandbox();

  env.seedSheet("Investments", [
    ["Date", "Type", "Amount", "Note"],
    ["2026-05-11", "Mutual Funds", 40498, "Starting Balance"],
    ["2026-05-11", "Gold", 5615, "Starting Balance"],
    ["2026-05-11", "Stocks", 11582, "Starting Balance"],
    ["2026-08-10", "Mutual Fund (Money2Mgt)", 54000, "mutual funds"],
    ["2026-08-10", "Mutual Funds SIP", 3000, "mutual funds"]
  ]);
  env.seedSheet("FinancialEvents", [["Type", "Amount", "Counterparty", "Confirmed", "Name"]]);

  sandbox.migrateInvestmentsToNamedInstruments();

  const investRows = env.sheetsByName["Investments"].rows;
  assert(investRows.length === 16, "Investments sheet now has 1 header + 15 new rows, got " + investRows.length);

  const oldTypesStillPresent = investRows.slice(1).some(function(r){
    return ["Mutual Funds", "Gold", "Stocks", "Mutual Fund (Money2Mgt)", "Mutual Funds SIP"].indexOf(r[1]) !== -1;
  });
  assert(!oldTypesStillPresent, "none of the 5 old generic Type rows remain");

  const byName = {};
  investRows.slice(1).forEach(function(r){ byName[r[1]] = r; });

  const expectedAmounts = {
    "HDFC Nifty 50 Index Fund": 20000,
    "HDFC Mid Cap Fund": 11000,
    "Bandhan Small Cap (Money2Mgt SIP)": 58000,
    "Motilal Oswal Flexi Cap": 5000,
    "HDFC Gold ETF Fund": 5500,
    "Bandhan Small Cap": 5000,
    "ICICI Prudential": 5000,
    "HDFC Silver ETF": 5000,
    "Motilal Oswal Midcap": 1000,
    "Digital Gold": 5615,
    "Tata Motors Commercial": 566.94,
    "Tata Steel": 157,
    "LIC": 1753.52,
    "HDFC Bank": 7851.82,
    "Tata Motors Passenger": 1253.06
  };

  Object.keys(expectedAmounts).forEach(function(name){
    const row = byName[name];
    assert(row, 'a row exists for "' + name + '"');
    if(row){
      assert(row[2] === expectedAmounts[name], '"' + name + '" amount is ' + expectedAmounts[name] + ', got ' + row[2]);
      assert(row[3] === "Starting Balance", '"' + name + '" note is "Starting Balance", got "' + row[3] + '"');
    }
  });

  const feRows = env.sheetsByName["FinancialEvents"].rows;
  assert(feRows.length === 4, "FinancialEvents has 1 header + 3 new SIP rows, got " + feRows.length);

  const feByName = {};
  feRows.slice(1).forEach(function(r){ feByName[r[4]] = r; });
  assert(feByName["HDFC Nifty 50 Index Fund"] && feByName["HDFC Nifty 50 Index Fund"][0] === "Investment" && feByName["HDFC Nifty 50 Index Fund"][1] === 3000,
    "HDFC Nifty 50 Index Fund registered as an Investment FinancialEvent, amount 3000");
  assert(feByName["HDFC Mid Cap Fund"] && feByName["HDFC Mid Cap Fund"][1] === 4000,
    "HDFC Mid Cap Fund registered, amount 4000");
  assert(feByName["Bandhan Small Cap (Money2Mgt SIP)"] && feByName["Bandhan Small Cap (Money2Mgt SIP)"][1] === 2000,
    "Bandhan Small Cap (Money2Mgt SIP) registered, amount 2000");

  // A future SIP payment of the same amount should now be recognized by
  // amount, via the existing matchRecurringNamedEvent mechanism — proves
  // the migration actually plugs into the real matching function, not
  // just that a row got written.
  const feData = env.sheetsByName["FinancialEvents"].getDataRange().getValues();
  const match = sandbox.matchRecurringNamedEvent("Investment", 3000, "", feData);
  assert(match && match.name === "HDFC Nifty 50 Index Fund",
    "a future Rs.3000 debit is now recognized by amount as the HDFC Nifty 50 Index Fund SIP");
})();

console.log("\nDone.");
