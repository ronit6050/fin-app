// backend/tests/planner.test.js
//
// Plain-English what this checks: Planner (Phase 1) — you set a monthly
// spend TARGET per category, the app suggests a starting number for you,
// and tracks real spend against it. This test proves, without touching
// the real Google Sheet:
//
//   1. The Need/Want/Saving/Investment tagging system only became
//      trustworthy from August 2026 onward — so June/July data, even
//      when it carries a tag, must NEVER influence the suggested target
//      or the split-into-Need/Want decision (the "reliable-month
//      cutoff").
//   2. Right now (the reliable window's first month is still in
//      progress, zero COMPLETE reliable months exist) the suggestion
//      falls back to scaling however much real data exists so far this
//      month up to a full-month estimate — and that fallback produces a
//      sane, non-zero number.
//   3. A category only gets shown as "split" (separate Need + Want
//      targets) when real history for it shows BOTH — one-type-only or
//      no-history categories stay a single target.
//   4. The same exclusion rules getMonthlyAnalysis already uses (a
//      credit card bill payment, a wallet top-up, a lending transfer, a
//      confirmed Rent/EMI/Investment Financial Event) are correctly
//      reused here too — none of them get double-counted as ordinary
//      category spend.
//   5. "Actual spend so far" for a requested month is a plain, honest
//      total for THAT month — unlike the suggestion, it is NOT
//      restricted to reliable months (asking about June/July still
//      shows June/July's real spend; it's only the SUGGESTED target that
//      must ignore unreliable months).
//   6. Once real complete reliable months start accumulating (a second
//      fixture/scenario below, months Aug-Nov 2026), the suggestion
//      switches to averaging up to the last 3 COMPLETE months, and
//      correctly drops the oldest one once more than 3 exist — with no
//      hardcoded "if August" special-casing.
//   7. saveBudgets replaces a month's entire plan (no duplicate rows on
//      a second save) and validates every line before writing anything.
//
// Run with: node backend/tests/planner.test.js

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
// A fixed "today" — planner.js calls `new Date()` (no arguments) to know
// what "today" is. Overriding just the zero-argument case (every other
// `new Date(...)` call in the real code, e.g. parsing a sheet's row
// date, or computing days-in-month, still behaves completely normally)
// lets this test control "what day is it" deterministically, so the
// test keeps passing correctly no matter what the real calendar date is
// when it's actually run.
// ---------------------------------------------------------------------
function makeFixedDate(fixedToday){
  const RealDate = Date;
  function FixedDate(...args){
    if(args.length === 0) return new RealDate(fixedToday.getTime());
    return new RealDate(...args);
  }
  FixedDate.now = function(){ return fixedToday.getTime(); };
  return FixedDate;
}

// ---------------------------------------------------------------------
// Minimal fake Apps Script environment. SpreadsheetApp's fake spreadsheet
// keeps real in-memory sheets (so getBudgetsSheet_'s auto-create-and-seed
// pattern, and saveBudgets' delete-then-append replace, behave exactly
// like the real Sheet would) — same idea as the seeded fakes used
// elsewhere in this project's tests (e.g. investmentInstruments.test.js).
// ---------------------------------------------------------------------
function makeFakeSpreadsheet(){
  const sheets = {};
  function makeSheet(){
    let rows = [];
    return {
      appendRow: function(row){ rows.push(row.slice()); },
      getDataRange: function(){ return { getValues: function(){ return rows.map(function(r){ return r.slice(); }); } }; },
      deleteRow: function(rowNum){ rows.splice(rowNum - 1, 1); },
      getLastRow: function(){ return rows.length; }
    };
  }
  return {
    getSheetByName: function(name){ return sheets[name] || null; },
    insertSheet: function(name){
      const sheet = makeSheet();
      sheets[name] = sheet;
      return sheet;
    }
  };
}

function loadSandbox(fixedToday){
  const fakeSpreadsheet = makeFakeSpreadsheet();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: function(){ return fakeSpreadsheet; } },
    Utilities: { formatDate: function(){ return ""; } },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} },
    Date: makeFixedDate(fixedToday),
    console: console
  };
  vm.createContext(sandbox);

  // Load order matters: planner.js reads SMART_CATEGORIES (category.js)
  // at the TOP LEVEL (PLANNER_CATEGORIES is computed immediately on
  // load, not inside a function) — category.js must load first. PWA.js
  // supplies isCreditCardBillPayment/isWalletTopUp; needWantSaving.js
  // supplies isLendingTransfer — planner.js's exclusion checks call all
  // three directly, same pattern as getMonthlyAnalysis.
  ["needWantSaving.js", "category.js", "PWA.js", "planner.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return sandbox;
}

// ---------------------------------------------------------------------
// Row builders — same real column layout used by analysisByMode.test.js
// (Transactions: A Date .. Q NeedWantSaving .. R FinancialEvent; Cash: B
// Date, D Type, E Amount, F Note, G Category, K NeedWantSaving).
// ---------------------------------------------------------------------
function mkTxnRow(date, type, mode, amount, opts){
  opts = opts || {};
  return [
    date, "10:00", "HDFC", type, mode, amount, opts.reference || "", opts.counterparty || "",
    "", "", "", "", opts.note || "", opts.category || "Other", "", "YES",
    opts.nws || "", opts.financialEvent || "", opts.financialEventName || ""
  ];
}
function mkCashRow(date, type, amount, note, category, nws){
  return ["", date, "", type, amount, note, category, "", "", "", nws || ""];
}
const TXN_HEADER  = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const CASH_HEADER = ["Row0","Date","Row2","Type","Amount","Note","Category","Row7","Row8","Row9","NeedWantSaving"];

/* =======================================================================
   SCENARIO A — zero complete reliable months yet (today = 5 Aug 2026,
   the reliable window's very first month, still in progress).
======================================================================= */
console.log("\n--- Scenario A: zero complete reliable months, scaled partial-month fallback ---\n");

const today_A = new Date(2026, 7, 5, 15, 0, 0); // 5 Aug 2026, 3pm

const txnData_A = [
  TXN_HEADER,
  // Unreliable history (before the Aug 2026 cutoff) — must NEVER affect
  // the suggestion or the split decision, no matter how large.
  mkTxnRow("2026-06-15", "debit", "upi", 50000, { note: "Big June Food", category: "Food", nws: "Need" }),
  mkTxnRow("2026-07-20", "debit", "upi", 40000, { note: "Big July Food", category: "Food", nws: "Want" }),

  // Reliable Aug 1-5 data — this is what the suggestion/split SHOULD use.
  mkTxnRow("2026-08-01", "debit", "upi",       500, { note: "Groceries",   category: "Food",      nws: "Need" }),
  mkTxnRow("2026-08-03", "debit", "card 1234", 900, { note: "Dining out",  category: "Food",      nws: "Want" }),
  mkTxnRow("2026-08-04", "debit", "upi",       200, { note: "More groceries", category: "Food",   nws: "Need" }),
  mkTxnRow("2026-08-02", "debit", "upi",       300, { note: "Cab",         category: "Transport", nws: "Need" }),
  mkTxnRow("2026-08-02", "debit", "neft",      1000, { note: "Electricity", category: "Bills" }), // no tag -> Untagged

  // Excluded rows — same exclusion rules as getMonthlyAnalysis. None of
  // these should ever create a "Financial" category entry.
  mkTxnRow("2026-08-01", "debit", "neft", 15000, { note: "Rent payment", category: "Bills", financialEvent: "Rent" }),
  mkTxnRow("2026-08-01", "debit", "upi",  5000,  { note: "credit card bill payment", category: "Financial", counterparty: "HDFC CREDIT CARD" }),
  mkTxnRow("2026-08-01", "debit", "wallet", 2000, { note: "top up", category: "Financial", counterparty: "PayZapp Wallet", reference: "REF123" }),
  mkTxnRow("2026-08-01", "debit", "upi", 750, { note: "lent to friend", category: "Financial", counterparty: "FRIEND X" })
];

const cashData_A = [
  CASH_HEADER,
  mkCashRow("2026-08-03", "debit", 200, "Snacks", "Food", "Want") // Cash must count too
];

const sandbox_A = loadSandbox(today_A);

const planner_Aug = sandbox_A.getPlannerData("2026-08", txnData_A, cashData_A);

// Sanity: category list is the real spend-category list minus Income —
// checked via the actual response (top-level `const PLANNER_CATEGORIES`
// isn't itself exposed as a sandbox property under Node's `vm` module,
// unlike plain `function` declarations, which is why this reads the
// response instead of the constant directly).
function findCat(planner, name){ return planner.categories.find(function(c){ return c.category === name; }); }
assertEqual(planner_Aug.categories.length, 9, "response has all 9 real spend categories (10 SMART_CATEGORIES minus Income)");
assert(!findCat(planner_Aug, "Income"), "Income never appears as a Planner category");

assertEqual(planner_Aug.month, "2026-08", "getPlannerData echoes back the requested month");
assertEqual(planner_Aug.reliableSince, "2026-08", "reliableSince is the fixed Aug 2026 cutoff");
assertEqual(planner_Aug.suggestionSource, "scaledPartialMonth", "with zero complete reliable months, source is the scaled-partial-month fallback");
assertEqual(planner_Aug.monthsAveraged, null, "monthsAveraged is null when the fallback (not an average) was used");

// --- Food: real Need AND Want history -> split. ---
const food_Aug = findCat(planner_Aug, "Food");
assertEqual(food_Aug.split, true, "Food shows both Need and Want in reliable history -> split = true");
assertEqual(food_Aug.type, null, "a split category has no single 'type'");
// Reliable Aug1-5 raw: Need = 500+200 = 700, Want = 900(card)+200(cash) = 1100.
// Scale factor = daysInMonth(31) / daysElapsed(5) = 6.2 exactly (amounts
// are multiples of 5, so the scaled result is an exact integer, not just
// a rounded one) -> Need 700*6.2=4340, Want 1100*6.2=6820.
assertEqual(food_Aug.suggested.need, 4340, "Food suggested Need = 700 scaled by 31/5");
assertEqual(food_Aug.suggested.want, 6820, "Food suggested Want = 1100 scaled by 31/5");
assertEqual(food_Aug.suggested.total, 11160, "Food suggested total = need+want");
assert(food_Aug.suggested.total < 90000, "Food's suggestion is nowhere near what it would be if June/July's 90,000 unreliable Food spend had leaked in — proves the reliable-month cutoff actually holds");
assertEqual(food_Aug.actual.need, 700, "Food actual (whole requested month) Need = 500+200");
assertEqual(food_Aug.actual.want, 1100, "Food actual Want = 900(card)+200(cash)");
assertEqual(food_Aug.actual.untagged, 0, "Food actual has no Saving/Investment/untagged spend in this fixture");
assertEqual(food_Aug.actual.total, 1800, "Food actual total = 700+1100");
assertEqual(food_Aug.saved, null, "nothing saved for Food yet this month");

// --- Transport: Need only -> not split. ---
const transport_Aug = findCat(planner_Aug, "Transport");
assertEqual(transport_Aug.split, false, "Transport only ever shows Need -> not split");
assertEqual(transport_Aug.type, "Need", "Transport's single type is Need");
assertEqual(transport_Aug.suggested.total, 1860, "Transport suggested = 300 scaled by 31/5");
assertEqual(transport_Aug.actual.total, 300, "Transport actual = the one real 300 Cab entry");

// --- Bills: only an untagged debit + an excluded Rent row -> no type yet. ---
const bills_Aug = findCat(planner_Aug, "Bills");
assertEqual(bills_Aug.split, false, "Bills has no Need or Want history -> not split");
assertEqual(bills_Aug.type, null, "Bills has no reliable Need/Want answer yet (only an untagged debit)");
assertEqual(bills_Aug.suggested.total, 6200, "Bills suggested = the untagged 1000 scaled by 31/5 (Rent's 15000 correctly excluded)");
assertEqual(bills_Aug.actual.total, 1000, "Bills actual total is 1000, NOT 16000 — the Rent Financial Event never counted as ordinary category spend");

// --- Financial: every single row that landed here was excluded -> zero, not double-counted. ---
const financial_Aug = findCat(planner_Aug, "Financial");
assertEqual(financial_Aug.split, false, "Financial has zero real spend in this fixture");
assertEqual(financial_Aug.type, null, "Financial has no history at all — the CC bill payment / wallet top-up / lending transfer were all excluded");
assertEqual(financial_Aug.suggested.total, 0, "Financial's suggestion is 0 — nothing ever counted as its spend");
assertEqual(financial_Aug.actual.total, 0, "Financial's actual is 0 — the bill payment (5000), the top-up (2000), and the loan (750) are all excluded, not summed");

// --- A category with genuinely zero history anywhere (edge case). ---
const health_Aug = findCat(planner_Aug, "Health");
assertEqual(health_Aug.split, false, "a category with no history at all is never shown as split");
assertEqual(health_Aug.type, null, "a category with no history at all has no type guess");
assertEqual(health_Aug.suggested.total, 0, "a category with no history gets a sensible (zero, not blank/undefined) suggestion");
assertEqual(health_Aug.actual.total, 0, "a category with no history has zero actual spend");

// ---------------------------------------------------------------------
// "Actual" is NOT restricted to reliable months — only the suggestion
// and the split decision are. Requesting June/July should show their
// real spend honestly, while Food's split/suggested numbers (computed
// from "today", not from the requested month) stay exactly the same.
// ---------------------------------------------------------------------
console.log("\n--- Actual spend is real for any requested month, even before the reliable cutoff ---\n");

const planner_Jul = sandbox_A.getPlannerData("2026-07", txnData_A, cashData_A);
const food_Jul = findCat(planner_Jul, "Food");
assertEqual(food_Jul.actual.need, 0, "July actual Food Need is 0 (the July row was tagged Want)");
assertEqual(food_Jul.actual.want, 40000, "July actual Food Want is the real 40,000 July row");
assertEqual(food_Jul.actual.total, 40000, "July actual Food total reflects real July spend");
assertEqual(food_Jul.split, true, "Food's split flag is unchanged for a different requested month — it's computed from reliable history up to today, not per requested month");
assertEqual(food_Jul.suggested.total, 11160, "Food's suggested target is unchanged for a different requested month too — always anchored to 'today', not the requested month");

const planner_Jun = sandbox_A.getPlannerData("2026-06", txnData_A, cashData_A);
const food_Jun = findCat(planner_Jun, "Food");
assertEqual(food_Jun.actual.need, 50000, "June actual Food Need is the real 50,000 June row");
assertEqual(food_Jun.actual.want, 0, "June actual Food Want is 0");

/* =======================================================================
   SCENARIO B — complete reliable months exist: averaging up to the last
   3, correctly dropping the oldest once more than 3 have accumulated.
   No hardcoded "if August" logic — this just naturally falls out of
   PLANNER_RELIABLE_START + whatever "today" really is.
======================================================================= */
console.log("\n--- Scenario B: averaging up to the last 3 COMPLETE reliable months ---\n");

const txnData_B = [
  TXN_HEADER,
  mkTxnRow("2026-08-10", "debit", "upi", 300,  { note: "Aug Food",  category: "Food", nws: "Need" }),
  mkTxnRow("2026-09-10", "debit", "upi", 600,  { note: "Sep Food",  category: "Food", nws: "Need" }),
  mkTxnRow("2026-10-10", "debit", "upi", 900,  { note: "Oct Food",  category: "Food", nws: "Need" }),
  mkTxnRow("2026-11-10", "debit", "upi", 1200, { note: "Nov Food",  category: "Food", nws: "Need" })
];
const cashData_B = [CASH_HEADER];

// B1: today = 15 Nov 2026. Complete reliable months = Aug, Sep, Oct only
// (Nov itself is the current, in-progress month — its 1200 must be
// excluded from the average even though it exists in the sheet).
const sandbox_B1 = loadSandbox(new Date(2026, 10, 15));
const planner_B1 = sandbox_B1.getPlannerData("2026-11", txnData_B, cashData_B);
assertEqual(planner_B1.suggestionSource, "average", "with 3 complete reliable months available, source is 'average'");
assertEqual(planner_B1.monthsAveraged, 3, "averages across all 3 complete months (Aug, Sep, Oct)");
const food_B1 = findCat(planner_B1, "Food");
assertEqual(food_B1.suggested.total, 600, "average of Aug(300)+Sep(600)+Oct(900) = 600 — Nov's in-progress 1200 correctly excluded");

// B2: today = 10 Dec 2026. Now 4 complete months exist (Aug-Nov) — only
// the most recent 3 (Sep, Oct, Nov) should be used, Aug dropped.
const sandbox_B2 = loadSandbox(new Date(2026, 11, 10));
const planner_B2 = sandbox_B2.getPlannerData("2026-12", txnData_B, cashData_B);
assertEqual(planner_B2.monthsAveraged, 3, "still only averages the most recent 3 months, even with 4 complete months available");
const food_B2 = findCat(planner_B2, "Food");
assertEqual(food_B2.suggested.total, 900, "average of Sep(600)+Oct(900)+Nov(1200) = 900 — August correctly dropped once a 4th complete month exists");

/* =======================================================================
   SCENARIO C — saveBudgets: validation, and a real full-replace (no
   duplicate rows) on a second save.
======================================================================= */
console.log("\n--- Scenario C: saveBudgets validation + full-replace on re-save ---\n");

const saveResult1 = sandbox_A.saveBudgets("2026-08", [
  { category: "Food", split: true, need: 5000, want: 4000 },
  { category: "Transport", split: false, target: 2000 }
]);
assertEqual(saveResult1.ok, true, "a valid save succeeds");
assertEqual(saveResult1.saved, 3, "3 rows written: Food/Need, Food/Want, Transport/(blank)");

const planner_afterSave1 = sandbox_A.getPlannerData("2026-08", txnData_A, cashData_A);
const food_afterSave1 = findCat(planner_afterSave1, "Food");
assertEqual(food_afterSave1.saved.need, 5000, "Food's saved Need target reads back correctly");
assertEqual(food_afterSave1.saved.want, 4000, "Food's saved Want target reads back correctly");
assertEqual(food_afterSave1.saved.total, 9000, "Food's saved total = need+want");
const transport_afterSave1 = findCat(planner_afterSave1, "Transport");
assertEqual(transport_afterSave1.saved.total, 2000, "Transport's saved target reads back correctly");
const bills_afterSave1 = findCat(planner_afterSave1, "Bills");
assertEqual(bills_afterSave1.saved, null, "Bills was never saved — still null, not accidentally populated");

// Re-save with DIFFERENT numbers — must fully replace, not append.
const saveResult2 = sandbox_A.saveBudgets("2026-08", [
  { category: "Food", split: true, need: 6000, want: 3000 },
  { category: "Transport", split: false, target: 2500 }
]);
assertEqual(saveResult2.ok, true, "the second save also succeeds");
const planner_afterSave2 = sandbox_A.getPlannerData("2026-08", txnData_A, cashData_A);
const food_afterSave2 = findCat(planner_afterSave2, "Food");
assertEqual(food_afterSave2.saved.need, 6000, "second save's Food Need overwrote the first, not added to it");
assertEqual(food_afterSave2.saved.want, 3000, "second save's Food Want overwrote the first");
const transport_afterSave2 = findCat(planner_afterSave2, "Transport");
assertEqual(transport_afterSave2.saved.total, 2500, "second save's Transport target overwrote the first");

// Validation — nothing should ever get written on a bad line.
const badMonth = sandbox_A.saveBudgets("not-a-month", [{ category: "Food", split: false, target: 100 }]);
assertEqual(badMonth.ok, false, "an invalid month string is rejected");

const badCategory = sandbox_A.saveBudgets("2026-08", [{ category: "NotARealCategory", split: false, target: 100 }]);
assertEqual(badCategory.ok, false, "an unknown category is rejected");

const badNegative = sandbox_A.saveBudgets("2026-08", [{ category: "Food", split: false, target: -50 }]);
assertEqual(badNegative.ok, false, "a negative target is rejected");

const badIncome = sandbox_A.saveBudgets("2026-08", [{ category: "Income", split: false, target: 100 }]);
assertEqual(badIncome.ok, false, "Income is rejected — it's not a Planner spend category");

console.log("\nDone.");
