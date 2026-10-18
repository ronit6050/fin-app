// backend/tests/analysisExtras.test.js
//
// Plain English: the Analysis makeover needs (1) day-by-day spend, top places,
// small-payment count and biggest payments for the chosen month (the new
// `detail` block inside getMonthlyAnalysis, for All and for Bank/Card/Wallet),
// and (2) the new getAnalysisExtras call: 6-month trend, last month's numbers,
// and Planner targets next to real spend.
// Run with: node backend/tests/analysisExtras.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
function assert(c, m){ if(!c){ console.error("FAIL: " + m); process.exitCode = 1; } else console.log("PASS: " + m); }
function eq(a, b, m){ assert(JSON.stringify(a) === JSON.stringify(b), m + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }

function load(extra){
  const sb = {
    Utilities: { formatDate: function(date, tz, fmt){
      const d = new Date(date), p = function(n){ return String(n).padStart(2, "0"); };
      const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return fmt === "dd MMM" ? p(d.getDate()) + " " + mo[d.getMonth()] : d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
    } },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} }, console: console
  };
  sb.dbSs_ = function(){ return { getSheetByName: function(){ return null; } }; };
  sb.dbProps_ = function(){ return { getProperty: function(){ return null; } }; };
  vm.createContext(sb);
  ["needWantSaving.js", "PWA.js", "analysisExtras.js"].forEach(function(f){
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sb, { filename: f });
  });
  if(extra) extra(sb);
  return sb;
}
function row(date, type, mode, amount, o){
  o = o || {};
  return [date, "10:00", "HDFC", type, mode, amount, o.ref || "", o.cp || "", "", "", "", "", o.note || "", o.cat || "Other", "", "YES", o.nws || "", o.fe || "", ""];
}
const H = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NWS","FE","FEN"];
const CH = ["r","Date","r","Type","Amount","Note","Category","r","r","r","NWS"];
const cashRow = function(d, t, a, n, c){ return ["", d, "", t, a, n, c, "", "", "", ""]; };
const sum = function(arr){ return arr.reduce(function(x, y){ return x + y; }, 0); };

const txn = [H,
  row("2026-10-02", "debit", "upi", 400,  { cp: "Swiggy", note: "dinner", cat: "Food" }),
  row("2026-10-02", "debit", "upi", 150,  { cp: "swiggy ", note: "lunch", cat: "Food" }),
  row("2026-10-05", "debit", "card 1234", 3980, { cp: "Croma", note: "headphones", cat: "Shopping" }),
  row("2026-10-07", "debit", "upi", 40,   { cp: "Tea stall", cat: "Food" }),
  row("2026-10-07", "debit", "upi", 60,   { cp: "Tea stall", cat: "Food" }),
  row("2026-10-08", "debit", "upi", 15000,{ cp: "Landlord", cat: "Bills", fe: "Rent" }),
  row("2026-10-09", "debit", "upi", 5000, { note: "credit card bill payment", cat: "Financial", cp: "HDFC CREDIT CARD" }),
  row("2026-10-10", "credit", "upi", 50000, { cp: "Employer", cat: "Income" }),
  row("2026-09-03", "debit", "upi", 700, { cp: "Swiggy", cat: "Food" }),
  row("2026-09-20", "debit", "card 1234", 300, { cp: "Uber", cat: "Transport" }),
  row("2026-05-04", "debit", "upi", 111, { cp: "Old", cat: "Other" })
];
const cash = [CH, cashRow("2026-10-02", "debit", 80, "chai", "Food")];

let sb = load();
const a = sb.getMonthlyAnalysis(2026, 10, txn, cash);
const d = a.detail;
eq(d.daysInMonth, 31, "October has 31 days");
eq(d.daily.length, 31, "daily has one slot per day");
eq(d.daily[1], 630, "day 2 = 400 + 150 + 80 cash");
eq(d.daily[4], 3980, "day 5 = the card purchase");
eq(d.daily[7], 0, "day 8 (Rent only) shows no day-to-day spend");
eq(d.daily[8], 0, "day 9 (CC bill payment) shows no spend");
eq(sum(d.daily), a.totalDebit, "daily adds up to the spend total exactly");
const swiggy = d.places.filter(function(p){ return p.name.toLowerCase().trim() === "swiggy"; })[0];
assert(swiggy && swiggy.count === 2 && swiggy.amount === 550, "Swiggy rows merge ignoring case and spaces: 2 orders, 550");
eq(d.places[0].name, "Croma", "biggest place first");
eq(d.smallCount, 3, "payments under 100: 40 + 60 + cash 80");
eq(d.smallTotal, 180, "small payments total 180");
eq(d.biggest[0].amount, 3980, "biggest payment first");
eq(d.biggest.length, 5, "at most 5 biggest");
assert(d.biggest.every(function(b){ return b.amount !== 15000 && b.amount !== 5000; }), "Rent and CC bill payment never appear as biggest payments");
eq(a.byMode.card.detail.daily[4], 3980, "card bucket has its own day-by-day");
eq(a.byMode.card.detail.places[0].name, "Croma", "card bucket places");
eq(sum(a.byMode.bank.detail.daily), a.byMode.bank.totalDebit, "bank detail adds up to bank spend");
eq(sum(a.byMode.wallet.detail.daily), 0, "empty wallet bucket is all zeros");
eq(a.totalDebit, 400 + 150 + 3980 + 40 + 60 + 80, "total spend unchanged by the makeover");
eq(sb.getMonthlyAnalysis(2026, 10, txn, cash, { skipSaved: true }).saved, 0, "skipSaved leaves saved at 0");
eq(sb.getMonthlyAnalysis(2028, 2, [H], [CH]).detail.daysInMonth, 29, "Feb 2028 has 29 days");

const ex = sb.getAnalysisExtras(2026, 10, txn, cash);
eq(ex.trend.length, 6, "6 months of trend");
eq(ex.trend.map(function(t){ return t.month; }), [5, 6, 7, 8, 9, 10], "trend runs May..Oct, oldest first");
eq(ex.trend[5].spent, a.totalDebit, "last trend month equals the month's own spend");
eq(ex.trend[5].income, 50000, "trend carries income");
eq(ex.trend[5].fixed, 15000, "trend carries Rent+EMI");
eq(ex.trend[4].spent, 1000, "September spent 700 + 300");
eq(ex.trend[0].spent, 111, "May spent 111");
eq(ex.trend[4].byMode.card, 300, "trend splits by payment mode");
eq(ex.prev.month, 9, "prev is September");
eq(ex.prev.all.categories.Food, 700, "prev category totals");
eq(ex.prev.card.spent, 300, "prev per mode");
eq(ex.prev.all.daily.length, 30, "prev daily has September's 30 days");
eq(ex.budgets, null, "no Planner available -> budgets null, nothing thrown");
const jan = sb.getAnalysisExtras(2027, 1, [H], [CH]);
eq(jan.trend.map(function(t){ return t.year + "-" + t.month; }), ["2026-8","2026-9","2026-10","2026-11","2026-12","2027-1"], "trend crosses the year boundary");
eq(jan.prev.month, 12, "prev of January is December");
eq(sb.getAnalysisExtras(2026, 13, txn, cash).ok, false, "month 13 refused");
eq(sb.getAnalysisExtras("x", 3, txn, cash).ok, false, "garbage year refused");

sb = load(function(s){
  s.getPlannerData = function(key){
    s.__key = key;
    return { categories: [
      { category: "Food", saved: { total: 1000 }, actual: { total: 800 } },
      { category: "Shopping", saved: { total: 4000 }, actual: { total: 3980 } },
      { category: "Bills", saved: null, actual: { total: 5 } },
      { category: "Health", saved: { total: 0 }, actual: { total: 9 } }
    ] };
  };
});
const ex2 = sb.getAnalysisExtras(2026, 10, txn, cash);
eq(sb.__key, "2026-10", "Planner asked for the right month key");
eq(ex2.budgets.categories.map(function(c){ return c.category; }), ["Shopping", "Food"], "only categories with a saved target, most used first");
eq(ex2.budgets.categories[0], { category: "Shopping", target: 4000, actual: 3980 }, "target and actual carried");
sb = load(function(s){ s.getPlannerData = function(){ throw new Error("boom"); }; });
eq(sb.getAnalysisExtras(2026, 10, txn, cash).budgets, null, "Planner crash -> budgets null, trend still returned");
