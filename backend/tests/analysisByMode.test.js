// backend/tests/analysisByMode.test.js
//
// Plain-English what this checks: the Analysis screen is getting a new
// All / Bank / Card / Wallet toggle. "Bank" means UPI/NEFT/ATM/anything
// that isn't a card swipe or a wallet debit; "Card" means the Mode
// column starts with "card" (same test already used by
// isCreditCardBillPayment/CCAdvisor.js); "Wallet" means Mode is exactly
// "wallet". Cash entries have no payment mode at all, so they only ever
// show up in "All", never in Bank/Card/Wallet.
//
// getMonthlyAnalysis(year, month, txnData, cashData) now returns a new
// `byMode: { bank, card, wallet }` key alongside its existing top-level
// numbers (totalDebit, categories, needWantSaving, etc — completely
// unchanged, this is purely additive). Each of the three buckets has the
// exact same shape as the top level.
//
// This test proves, without touching the real Google Sheet:
//   1. A mix of card/wallet/upi/neft debit rows lands in the right
//      bucket, with correct totals/categories/topTransactions per bucket.
//   2. A Cash debit entry counts in "All" but never in Bank/Card/Wallet.
//   3. A credit-card bill payment and a wallet top-up are still excluded
//      from spend in their OWN bucket, not just from "All" (same
//      isCreditCardBillPayment/isWalletTopUp exclusion rules, now also
//      applied per-bucket).
//   4. A Financial Event (Rent on a bank-mode row, a confirmed
//      Investment on a card-mode row) is excluded from that bucket's
//      category/spend total and instead shows up in that bucket's
//      fixedObligations/invested (and, for Investment, in that bucket's
//      needWantSaving.investment) — same as it already does for "All".
//   5. Every existing top-level ("All") field is exactly what the old,
//      pre-byMode version of this function would have returned for the
//      same fixture — proving this change is additive, not a behavior
//      change to "All".
//
// Run with: node backend/tests/analysisByMode.test.js

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
// Minimal fake Apps Script environment — getMonthlyAnalysis is called
// with pre-loaded txnData/cashData directly, so it never needs
// SpreadsheetApp.getSheetByName to actually return anything real, but
// Utilities/Session are used for date formatting inside the function.
// ---------------------------------------------------------------------
function loadSandbox(){
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function(){
        return { getSheetByName: function(){ return null; } };
      }
    },
    Utilities: {
      formatDate: function(date, tz, fmt){
        const d = new Date(date);
        const pad = function(n){ return String(n).padStart(2, "0"); };
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        if(fmt === "dd MMM") return pad(d.getDate()) + " " + months[d.getMonth()];
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      }
    },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} },
    console: console
  };
  vm.createContext(sandbox);

  // needWantSaving.js defines isLendingTransfer, which getMonthlyAnalysis
  // calls directly — must be loaded into the same global scope, same
  // pattern as the other tests in this folder that call into PWA.js.
  ["needWantSaving.js", "PWA.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return sandbox;
}

// ---------------------------------------------------------------------
// Fixture — one Transactions row builder matching the real column
// layout (see docs/features + PWA.js's getMonthlyAnalysis comments):
// A Date, B Time, C Bank, D Type, E Mode, F Amount, G Reference,
// H Counterparty, I-L (unused here), M Note, N Category, O (unused),
// P Processed, Q NeedWantSaving, R FinancialEvent, S FinancialEventName.
// ---------------------------------------------------------------------
function mkTxnRow(date, type, mode, amount, opts){
  opts = opts || {};
  return [
    date, "10:00", "HDFC", type, mode, amount, opts.reference || "", opts.counterparty || "",
    "", "", "", "", opts.note || "", opts.category || "Other", "", "YES",
    opts.nws || "", opts.financialEvent || "", opts.financialEventName || ""
  ];
}

// Cash row builder: [?, Date, ?, Type, Amount, Note, Category, ?, ?, ?, NeedWantSaving]
function mkCashRow(date, type, amount, note, category, nws){
  return ["", date, "", type, amount, note, category, "", "", "", nws || ""];
}

const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const CASH_HEADER = ["Row0","Date","Row2","Type","Amount","Note","Category","Row7","Row8","Row9","NeedWantSaving"];

const txnData = [
  TXN_HEADER,
  mkTxnRow("2026-08-05", "debit", "card 1234", 500,  { note: "Pizza",       category: "Food",      nws: "Want" }),                                      // card
  mkTxnRow("2026-08-06", "debit", "card 5678", 200,  { note: "Burger",      category: "Food",      nws: "Want" }),                                      // card
  mkTxnRow("2026-08-06", "debit", "wallet",    100,  { note: "Tea",         category: "Food",      nws: "Need" }),                                      // wallet
  mkTxnRow("2026-08-07", "debit", "upi",       300,  { note: "Cab",         category: "Transport", nws: "Need" }),                                      // bank
  mkTxnRow("2026-08-08", "debit", "neft",      1000, { note: "Electricity", category: "Bills",     nws: "Need" }),                                      // bank
  mkTxnRow("2026-08-10", "debit", "upi",       5000, { note: "card bill payment", category: "Financial", counterparty: "HDFC CREDIT CARD" }),            // bank-mode CC bill payment — excluded
  mkTxnRow("2026-08-11", "debit", "wallet",    2000, { note: "top up",      category: "Financial", counterparty: "PayZapp Wallet", reference: "REF999" }), // wallet top-up — excluded
  mkTxnRow("2026-08-01", "debit", "neft",      15000,{ note: "Rent payment", category: "Bills",    financialEvent: "Rent" }),                            // bank-mode Rent (Financial Event)
  mkTxnRow("2026-08-02", "debit", "card 1234", 3000, { note: "SIP",         category: "Financial", financialEvent: "Investment", financialEventName: "HDFC Nifty 50 Index Fund" }), // card-mode Investment (Financial Event)
  mkTxnRow("2026-08-12", "credit","upi",       50000,{ note: "Salary",      category: "Income" }),                                                       // bank credit
  mkTxnRow("2026-08-13", "credit","card 1234", 200,  { note: "Refund",      category: "Shopping" })                                                      // card credit
];

const cashData = [
  CASH_HEADER,
  mkCashRow("2026-08-09", "debit", 250, "Snacks", "Food", "Want") // Cash — must show in "All" only, never in any byMode bucket
];

const sandbox = loadSandbox();
const result = sandbox.getMonthlyAnalysis(2026, 8, txnData, cashData);

// ---------------------------------------------------------------------
// 1. Mix of card/wallet/upi/neft debit rows lands in the right bucket.
// ---------------------------------------------------------------------
assertEqual(result.byMode.card.totalDebit, 700, "card bucket totalDebit = Pizza(500) + Burger(200), Investment row excluded");
assertEqual(result.byMode.wallet.totalDebit, 100, "wallet bucket totalDebit = Tea(100), top-up excluded");
assertEqual(result.byMode.bank.totalDebit, 1300, "bank bucket totalDebit = Cab(300) + Electricity(1000), bill payment + Rent excluded");

assertEqual(result.byMode.card.categories.length, 1, "card bucket has exactly one category (Food)");
assertEqual(result.byMode.card.categories[0].category, "Food", "card bucket's only category is Food");
assertEqual(result.byMode.card.categories[0].amount, 700, "card bucket Food category amount is 700");
assertEqual(result.byMode.card.categories[0].topTransactions.length, 2, "card bucket Food has 2 top transactions");
assertEqual(result.byMode.card.categories[0].topTransactions[0].note, "Pizza", "card bucket's top Food transaction is the 500 Pizza");

assertEqual(result.byMode.wallet.categories.length, 1, "wallet bucket has exactly one category (Food)");
assertEqual(result.byMode.wallet.categories[0].amount, 100, "wallet bucket Food category amount is 100");

assertEqual(result.byMode.bank.categories.length, 2, "bank bucket has two categories (Bills, Transport)");
assertEqual(result.byMode.bank.categories[0].category, "Bills", "bank bucket's biggest category is Bills (1000 > 300)");
assertEqual(result.byMode.bank.categories[0].amount, 1000, "bank bucket Bills category amount is 1000");
assertEqual(result.byMode.bank.categories[1].category, "Transport", "bank bucket's second category is Transport");
assertEqual(result.byMode.bank.categories[1].amount, 300, "bank bucket Transport category amount is 300");

// bank + card + wallet should sum to the same total as "All" minus the
// Cash entry (250), since Cash never contributes to any bucket.
const bucketSum = result.byMode.bank.totalDebit + result.byMode.card.totalDebit + result.byMode.wallet.totalDebit;
assertEqual(bucketSum, result.totalDebit - 250, "bank+card+wallet totalDebit sums to All's totalDebit minus the one Cash entry");

// ---------------------------------------------------------------------
// 2. Cash debit entry: in "All", never in Bank/Card/Wallet.
// ---------------------------------------------------------------------
const allFoodCategory = result.categories.find(function(c){ return c.category === "Food"; });
assert(!!allFoodCategory, "All has a Food category");
assertEqual(allFoodCategory.amount, 1050, "All's Food category includes the Cash Snacks entry (500+200+100+250)");
const cashNoteInAll = allFoodCategory.topTransactions.some(function(t){ return t.note === "Snacks"; });
assert(cashNoteInAll, "the Cash entry (note 'Snacks') appears in All's Food topTransactions");

["bank", "card", "wallet"].forEach(function(bucket){
  const foodCat = result.byMode[bucket].categories.find(function(c){ return c.category === "Food"; });
  const hasCashNote = foodCat ? foodCat.topTransactions.some(function(t){ return t.note === "Snacks"; }) : false;
  assert(!hasCashNote, "the Cash entry does NOT appear in byMode." + bucket + "'s Food topTransactions");
});
// None of the three buckets' totalDebit should include the 250 Cash amount
// beyond what real Transactions rows already account for (checked via the
// bucketSum assertion above too).

// ---------------------------------------------------------------------
// 3. CC bill payment and wallet top-up excluded from THEIR OWN bucket's
//    spend, not just from "All".
// ---------------------------------------------------------------------
// The bank bucket's Financial category should not exist at all — the
// only Financial-category row that reached spend accumulation would have
// been the bill payment, and it was excluded before that point.
const bankFinancialCat = result.byMode.bank.categories.find(function(c){ return c.category === "Financial"; });
assert(!bankFinancialCat, "bank bucket has no Financial category — the CC bill payment (upi, 5000) never got counted as spend");

const walletFinancialCat = result.byMode.wallet.categories.find(function(c){ return c.category === "Financial"; });
assert(!walletFinancialCat, "wallet bucket has no Financial category — the wallet top-up (2000) never got counted as spend");

// Confirm the exclusion also held at the "All" level (unchanged behavior).
const allFinancialCat = result.categories.find(function(c){ return c.category === "Financial"; });
assert(!allFinancialCat, "All also has no Financial category — both exclusions still apply at the top level too");

// ---------------------------------------------------------------------
// 4. Financial Events (Rent on a bank-mode row, Investment on a
//    card-mode row) excluded from that bucket's spend, present in that
//    bucket's fixedObligations/invested (+ needWantSaving.investment).
// ---------------------------------------------------------------------
assertEqual(result.byMode.bank.fixedObligations, 15000, "bank bucket's fixedObligations picks up the Rent row (neft, 15000)");
assertEqual(result.byMode.card.invested, 3000, "card bucket's invested picks up the Investment row (card, 3000)");
assertEqual(result.byMode.card.needWantSaving.investment, 3000, "card bucket's needWantSaving.investment also picks up the confirmed Investment row");

// Neither the Rent nor Investment row should have inflated its bucket's
// plain spend total or created a Bills/Financial category entry with
// their amount folded in.
assertEqual(result.byMode.bank.categories.find(function(c){ return c.category === "Bills"; }).amount, 1000,
  "bank bucket's Bills category is only the real Electricity spend (1000), NOT 1000+15000 — Rent stayed out of it");
assert(!result.byMode.card.categories.find(function(c){ return c.category === "Financial"; }),
  "card bucket has no Financial category — the Investment row never counted as ordinary spend");

// Matches "All"'s existing behavior for the same two rows.
assertEqual(result.fixedObligations, 15000, "All's fixedObligations also picks up the Rent row");
assertEqual(result.invested, 3000, "All's invested also picks up the Investment row");
assertEqual(result.needWantSaving.investment, 3000, "All's needWantSaving.investment also picks up the confirmed Investment row");

// ---------------------------------------------------------------------
// 5. Every existing top-level ("All") field matches hand-computed
//    values for this fixture — proving the change is additive only.
// ---------------------------------------------------------------------
assertEqual(result.totalDebit, 2350, "All totalDebit = 500+200+100+300+1000+250 (bill payment/top-up/Rent/Investment all excluded)");
assertEqual(result.totalCredit, 50200, "All totalCredit = 50000 (Salary) + 200 (Refund)");
assertEqual(result.savings, 50200 - 2350, "All savings = totalCredit - totalDebit");
assertEqual(result.topAmount, 1000, "All topAmount is the 1000 Electricity row (bigger than every other counted debit)");
assertEqual(result.topNote, "Electricity", "All topNote matches the 1000 row's note");
assertEqual(result.avgDaily, Math.round(2350 / 5), "All avgDaily divides by 5 distinct spend days (5,6,7,8,9)");
assertEqual(result.needWantSaving.need, 1400, "All needWantSaving.need = Tea(100)+Cab(300)+Electricity(1000)");
assertEqual(result.needWantSaving.want, 950, "All needWantSaving.want = Pizza(500)+Burger(200)+Cash Snacks(250)");
assertEqual(result.needWantSaving.saving, 0, "All needWantSaving.saving is 0 — no Saving-tagged rows in this fixture");
assertEqual(result.needWantSaving.investment, 3000, "All needWantSaving.investment = the confirmed Investment row");
assertEqual(result.needWantSaving.untagged, 0, "All needWantSaving.untagged is 0 — every counted debit row has a NeedWantSaving value");
assertEqual(result.needWantSaving.untaggedCount, 0, "All needWantSaving.untaggedCount is 0");
assertEqual(result.needWantSaving.taggedTotal, 1400 + 950 + 0 + 3000, "All needWantSaving.taggedTotal sums need+want+saving+investment");
assertEqual(result.categories.length, 3, "All has exactly 3 categories: Food, Bills, Transport");
assertEqual(result.categories[0].category, "Food", "All's biggest category is Food (1050)");
assertEqual(result.categories[0].amount, 1050, "All's Food category amount is 1050");

// Shape check — every field the function returned before this change
// must still be present, plus the new byMode key.
const expectedTopLevelKeys = ["totalDebit","totalCredit","savings","avgDaily","topAmount","topNote","categories","fixedObligations","invested","needWantSaving","byMode"];
const actualTopLevelKeys = Object.keys(result);
expectedTopLevelKeys.forEach(function(key){
  assert(actualTopLevelKeys.indexOf(key) !== -1, "result still has the '" + key + "' field");
});
assert(actualTopLevelKeys.length === expectedTopLevelKeys.length,
  "result has no unexpected extra top-level fields, got keys: " + actualTopLevelKeys.join(", "));

// ---------------------------------------------------------------------
// byMode shape check — each bucket has exactly the same field names as
// the top level (minus byMode itself, since buckets don't nest further).
// ---------------------------------------------------------------------
const expectedBucketKeys = ["totalDebit","totalCredit","savings","avgDaily","topAmount","topNote","categories","fixedObligations","invested","needWantSaving"];
["bank","card","wallet"].forEach(function(bucketName){
  const bucketKeys = Object.keys(result.byMode[bucketName]);
  expectedBucketKeys.forEach(function(key){
    assert(bucketKeys.indexOf(key) !== -1, "byMode." + bucketName + " has the '" + key + "' field");
  });
  assert(bucketKeys.length === expectedBucketKeys.length,
    "byMode." + bucketName + " has no unexpected extra fields, got keys: " + bucketKeys.join(", "));
  const nwsKeys = Object.keys(result.byMode[bucketName].needWantSaving);
  const expectedNwsKeys = ["need","want","saving","investment","untagged","untaggedCount","taggedTotal"];
  expectedNwsKeys.forEach(function(key){
    assert(nwsKeys.indexOf(key) !== -1, "byMode." + bucketName + ".needWantSaving has the '" + key + "' field");
  });
});

console.log("\nDone.");
