// backend/tests/debtTrajectory.test.js
//
// Plain-English what this checks: the Debts screen used to only ever
// show a static "you owe ₹10,000" number. This adds a sense of
// progress — "at the rate you've actually been paying it off, you'll
// be debt-free by around March 2027" — in both directions (what you
// owe, and what's owed to you), pushed automatically right after a
// real payment or settlement is saved (never on a schedule, since
// there's nothing new to say until something actually changes).
//
// This test loads the REAL backend source (DebtAdvisor.js + PWA.js,
// same load order as ccBillPaymentTwoCards.test.js) into a small fake
// Google Sheets/Properties/push environment and proves:
//   1. The pace/projection math itself: given real payment history over
//      the last ~90 days, the monthly pace and the projected "debt-free
//      by" date are computed correctly for BOTH directions.
//   2. The honest fallback: no repayment activity in the last 3 months
//      means NO fake date gets invented — a clear message instead.
//   3. Zero remaining outstanding is reported as "done," not a
//      division-by-zero or a nonsense projection.
//   4. A payment on a BORROWED debt (applyDebtPayment) pushes ONLY the
//      BORROWED trajectory — never LENT.
//   5. A payment on a LENT debt pushes ONLY the LENT trajectory — never
//      BORROWED.
//   6. Settling a debt in full (settleDebtRow) also logs the payment
//      and pushes the right trajectory, using whatever was still
//      outstanding as the "amount paid."
//   7. Every real payment is actually recorded in a new DebtPayments
//      log row (Date/Row/Person/Type/AmountPaid) — this is the data
//      source the pace math depends on, so a broken log would silently
//      break every projection above it.
//
// Run with: node backend/tests/debtTrajectory.test.js

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
// A tiny fake Google Sheets environment (appendRow / getDataRange /
// getRange.getValue/setValue / getLastRow) — same shape as
// autoLogSaving.test.js's makeFakeSheetsEnv, extended with getRange for
// applyDebtPayment/settleDebtRow's direct cell writes.
// ---------------------------------------------------------------------
function makeFakeSheetsEnv(){
  const sheetsByName = {};

  function FakeSheet(name, initialRows){
    this.name = name;
    this.rows = initialRows.map((r) => r.slice());
  }
  FakeSheet.prototype.appendRow = function(row){ this.rows.push(row.slice()); };
  FakeSheet.prototype.getDataRange = function(){
    const self = this;
    return { getValues: () => self.rows.map((r) => r.slice()) };
  };
  FakeSheet.prototype.getLastRow = function(){ return this.rows.length; };
  FakeSheet.prototype.getRange = function(row, col){
    const self = this;
    return {
      getValue: () => (self.rows[row - 1] ? self.rows[row - 1][col - 1] : ""),
      setValue: (v) => { self.rows[row - 1][col - 1] = v; }
    };
  };

  function seedSheet(name, headerAndRows){
    sheetsByName[name] = new FakeSheet(name, headerAndRows);
    return sheetsByName[name];
  }

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => sheetsByName[name] || null,
      insertSheet: (name) => {
        const s = new FakeSheet(name, []);
        sheetsByName[name] = s;
        return s;
      }
    })
  };

  const Utilities = {
    formatDate: function(date, tz, fmt){
      const d = new Date(date);
      const pad = (n) => String(n).padStart(2, "0");
      if(fmt === "MMMM yyyy"){
        const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        return MONTHS[d.getMonth()] + " " + d.getFullYear();
      }
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  };

  const Session = { getScriptTimeZone: () => "UTC" };
  const Logger = { log: () => {} };

  return { SpreadsheetApp, Utilities, Session, Logger, seedSheet, sheetsByName };
}

function loadSandbox(){
  const env = makeFakeSheetsEnv();
  const sentMessages = [];
  const loggedErrors = [];

  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    Utilities: env.Utilities,
    Session: env.Session,
    Logger: env.Logger,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
    },
    sendMessage: (text) => sentMessages.push(text),
    logAI: (type, msg) => loggedErrors.push({ type, msg }),
    // getSettings/getSuggestedCategoryFast/etc aren't needed for the
    // debt functions under test — a minimal stand-in is enough so
    // loading PWA.js doesn't throw on definitions that reference them
    // only inside OTHER functions we never call.
    getSettings: () => ({ ccLimit: 50000, ccWarnPct: 0.25, ccAlertPct: 0.30, monthlyExpenses: 30000, monthlySaveGoal: 1000, monthlyInvestmentGoal: 0 }),
    console: console
  };
  vm.createContext(sandbox);

  ["DebtAdvisor.js", "PWA.js"].forEach((filename) => {
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename });
  });

  return { sandbox, env, sentMessages, loggedErrors };
}

function daysAgo(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

const DEBTS_HEADER = ["Date", "Person", "Type", "Amount", "Note", "DueDate", "Status", "SettledDate"];
const PAYMENTS_HEADER = ["Date", "Row", "Person", "Type", "AmountPaid"];

// ---------------------------------------------------------------------
// Test 1 — pace/projection math for BORROWED, with real payment history
// in the last 90 days.
// ---------------------------------------------------------------------
(function testBorrowedProjection(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 9000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [
    PAYMENTS_HEADER,
    [daysAgo(80), 2, "Raj", "BORROWED", 1500],
    [daysAgo(50), 2, "Raj", "BORROWED", 1500]
  ]);
  // Total paid in the last 90 days: 3000 -> monthly pace 1000/month.
  // Outstanding 9000 / 1000 = 9 months from today.

  const t = sandbox.getDebtTrajectory("BORROWED");
  assert(t.outstanding === 9000, "outstanding total is read correctly, got " + t.outstanding);
  assert(t.recentPaid90d === 3000, "sums real payments within the last 90 days, got " + t.recentPaid90d);
  assert(Math.abs(t.monthlyPace - 1000) < 0.01, "monthly pace is recentPaid/3, got " + t.monthlyPace);
  assert(t.hasProjection === true, "a projection is produced when there's real recent activity");
  const expectedMonths = 9000 / 1000;
  const expectedDate = new Date();
  expectedDate.setDate(expectedDate.getDate() + Math.round(expectedMonths * 30.44));
  assert(t.projectedLabel && t.projectedLabel.indexOf(String(expectedDate.getFullYear())) !== -1,
    "the projected date's year matches the expected ~9-month-out projection, got \"" + t.projectedLabel + "\"");
})();

// ---------------------------------------------------------------------
// Test 2 — mirrored math for LENT (collection pace).
// ---------------------------------------------------------------------
(function testLentProjection(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Priya", "LENT", 6000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [
    PAYMENTS_HEADER,
    [daysAgo(10), 2, "Priya", "LENT", 2000]
  ]);

  const t = sandbox.getDebtTrajectory("LENT");
  assert(t.outstanding === 6000, "LENT outstanding total is read correctly, got " + t.outstanding);
  assert(Math.abs(t.monthlyPace - (2000 / 3)) < 0.01, "LENT monthly pace computed the same way as BORROWED, got " + t.monthlyPace);
  assert(t.hasProjection === true, "a LENT projection is produced when there's real recent collection activity");
})();

// ---------------------------------------------------------------------
// Test 3 — honest fallback: no repayments in the last 90 days means NO
// fake date is invented.
// ---------------------------------------------------------------------
(function testNoRecentActivityHonestFallback(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 5000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [
    PAYMENTS_HEADER,
    [daysAgo(150), 2, "Raj", "BORROWED", 1000] // outside the 90-day window
  ]);

  const t = sandbox.getDebtTrajectory("BORROWED");
  assert(t.recentPaid90d === 0, "a payment older than 90 days is correctly excluded from the pace window");
  assert(t.hasProjection === false, "no projection/date is invented when there's no recent repayment activity");
  assert(typeof t.message === "string" && t.message.toLowerCase().indexOf("can't project") !== -1,
    "an honest, plain-English fallback message is given instead, got \"" + t.message + "\"");
})();

// ---------------------------------------------------------------------
// Test 4 — zero outstanding is reported as "done," not a broken
// division or a nonsense projection.
// ---------------------------------------------------------------------
(function testZeroOutstandingReportsAsDone(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 5000, "", "", "Settled", "2026-02-01"]
  ]);
  env.seedSheet("DebtPayments", [PAYMENTS_HEADER]);

  const t = sandbox.getDebtTrajectory("BORROWED");
  assert(t.outstanding === 0, "a fully Settled debt correctly contributes nothing to outstanding");
  assert(t.hasProjection === false, "no projection is attempted once outstanding is zero");
  assert(t.message.toLowerCase().indexOf("debt-free") !== -1, "reports \"debt-free\" rather than any date math, got \"" + t.message + "\"");
})();

// ---------------------------------------------------------------------
// Test 5 — a payment on a BORROWED debt (applyDebtPayment) pushes ONLY
// the BORROWED trajectory, never LENT.
// ---------------------------------------------------------------------
(function testBorrowedPaymentPushesOnlyBorrowed(){
  const { sandbox, env, sentMessages } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 5000, "", "", "Pending", ""],
    ["2026-01-01", "Priya", "LENT", 3000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [PAYMENTS_HEADER]);

  const result = sandbox.applyDebtPayment(2, 1000); // row 2 = the Raj/BORROWED row
  assert(result.ok === true, "applyDebtPayment succeeds");
  assert(sentMessages.length === 1, "exactly one push is sent after a real payment, got " + sentMessages.length);
  assert(sentMessages[0].indexOf("repaid to Raj") !== -1, "the push headline is about repaying Raj (BORROWED wording), got: " + sentMessages[0]);
  assert(sentMessages[0].toLowerCase().indexOf("collected") === -1, "the BORROWED push never uses LENT/\"collected\" wording");
})();

// ---------------------------------------------------------------------
// Test 6 — a payment on a LENT debt pushes ONLY the LENT trajectory,
// never BORROWED.
// ---------------------------------------------------------------------
(function testLentPaymentPushesOnlyLent(){
  const { sandbox, env, sentMessages } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 5000, "", "", "Pending", ""],
    ["2026-01-01", "Priya", "LENT", 3000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [PAYMENTS_HEADER]);

  const result = sandbox.applyDebtPayment(3, 1000); // row 3 = the Priya/LENT row
  assert(result.ok === true, "applyDebtPayment succeeds");
  assert(sentMessages.length === 1, "exactly one push is sent, got " + sentMessages.length);
  assert(sentMessages[0].indexOf("collected from Priya") !== -1, "the push headline is about collecting from Priya (LENT wording), got: " + sentMessages[0]);
  assert(sentMessages[0].toLowerCase().indexOf("repaid") === -1, "the LENT push never uses BORROWED/\"repaid\" wording");
})();

// ---------------------------------------------------------------------
// Test 7 — settling a debt in full also logs the payment and pushes
// the right trajectory, using whatever was still outstanding as the
// "amount paid."
// ---------------------------------------------------------------------
(function testSettleDebtLogsAndPushes(){
  const { sandbox, env, sentMessages } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 2000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [PAYMENTS_HEADER]);

  const result = sandbox.settleDebtRow(2);
  assert(result.ok === true, "settleDebtRow succeeds");
  assert(sentMessages.length === 1, "settling a debt sends exactly one trajectory push");
  assert(sentMessages[0].indexOf("₹2,000 repaid to Raj") !== -1, "the full remaining amount (₹2000) is reported as what was just paid, got: " + sentMessages[0]);

  const paymentsRows = env.sheetsByName["DebtPayments"].rows;
  assert(paymentsRows.length === 2, "settling logged exactly one new DebtPayments row");
  assert(paymentsRows[1][4] === 2000, "the logged AmountPaid is the full amount that was outstanding, got " + paymentsRows[1][4]);
})();

// ---------------------------------------------------------------------
// Test 8 — every real payment (partial, via applyDebtPayment) is
// actually recorded in DebtPayments with the right shape.
// ---------------------------------------------------------------------
(function testPartialPaymentIsLogged(){
  const { sandbox, env } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "BORROWED", 5000, "", "", "Pending", ""]
  ]);
  env.seedSheet("DebtPayments", [PAYMENTS_HEADER]);

  sandbox.applyDebtPayment(2, 1200);

  const rows = env.sheetsByName["DebtPayments"].rows;
  assert(rows.length === 2, "exactly one DebtPayments row was appended");
  const newRow = rows[1];
  assert(newRow[1] === 2, "the logged Row points back at the real Debts row (2)");
  assert(newRow[2] === "Raj", "the logged Person is correct");
  assert(newRow[3] === "BORROWED", "the logged Type is correct");
  assert(newRow[4] === 1200, "the logged AmountPaid matches the real partial payment");

  // And the Debts row itself still behaves exactly as before this
  // feature existed — reduced in place, still Pending.
  const debtsRows = env.sheetsByName["Debts"].rows;
  assert(debtsRows[1][3] === 3800, "the Debts row's own Amount is still reduced in place as before, got " + debtsRows[1][3]);
  assert(debtsRows[1][6] === "Pending", "a partial payment leaves the debt Pending, unchanged from before this feature");
})();

// ---------------------------------------------------------------------
// Test 9 — a debt with no push-eligible Type (e.g. a stray blank) never
// crashes applyDebtPayment/settleDebtRow, and simply isn't logged/pushed.
// ---------------------------------------------------------------------
(function testUnknownTypeNeverCrashesOrPushes(){
  const { sandbox, env, sentMessages } = loadSandbox();
  env.seedSheet("Debts", [
    DEBTS_HEADER,
    ["2026-01-01", "Raj", "", 5000, "", "", "Pending", ""] // blank Type — shouldn't happen in real use, but must not crash
  ]);
  env.seedSheet("DebtPayments", [PAYMENTS_HEADER]);

  const result = sandbox.applyDebtPayment(2, 1000);
  assert(result.ok === true, "a row with a blank Type still saves the payment reduction without crashing");
  assert(sentMessages.length === 0, "no trajectory push is sent for a debt with no recognized direction");
})();

console.log("\nDone.");
