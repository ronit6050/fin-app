// 2026-10-31: a credit tagged "Not income" (a friend's payback, a refund, a move from your own account) stays out of the Income figure,
// the income list and the Bank bucket's income, while an ordinary credit still counts.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
function ok(c, m){ if(c) console.log("PASS: " + m); else { failed++; console.log("FAIL: " + m); } }

const sandbox = {
  SpreadsheetApp: { getActiveSpreadsheet: function(){ return { getSheetByName: function(){ return null; } }; } },
  Utilities: { formatDate: function(date, tz, fmt){
    const d = new Date(date), pad = (n) => String(n).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if(fmt === "dd MMM") return pad(d.getDate()) + " " + months[d.getMonth()];
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  } },
  Session: { getScriptTimeZone: function(){ return "UTC"; } },
  Logger: { log: function(){} },
  console
};
sandbox.dbSs_ = function(){ return sandbox.SpreadsheetApp.getActiveSpreadsheet(); };
sandbox.dbProps_ = function(){ return sandbox.PropertiesService.getScriptProperties(); };
vm.createContext(sandbox);
["needWantSaving.js", "PWA.js"].forEach(function(f){ vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, { filename: f }); });

function row(date, type, mode, amount, opts){
  opts = opts || {};
  return [date, "10:00", "HDFC", type, mode, amount, "", opts.counterparty || "", "", "", "", "", opts.note || "", opts.category || "Other", "", "YES", "", "", ""];
}
const H = new Array(19).fill("h");
const data = [H,
  row("2026-08-05", "credit", "neft", 45000, { counterparty: "Employer", category: "Income" }),
  row("2026-08-06", "credit", "upi", 300, { counterparty: "Friend", note: "tea money back", category: "Not income" }),
  row("2026-08-07", "credit", "upi", 120, { counterparty: "Shop", note: "refund", category: "Other" }),
  row("2026-08-08", "debit", "upi", 500, { counterparty: "Cab", category: "Transport" })
];
const a = sandbox.getMonthlyAnalysis(2026, 8, data, [["h"]]);
ok(a.totalCredit === 45120, "Income = salary + the ordinary credit, without the 'Not income' payback (got " + a.totalCredit + ")");
ok(a.incomeItems.length === 2 && !a.incomeItems.some((i) => i.label === "Friend"), "the income list leaves the payback out");
ok(a.byMode.bank.totalCredit === 45120, "the Bank bucket agrees");
ok(a.totalDebit === 500, "spending is unchanged");

// A learned "Not income" memory must never be offered back as a category (it could land on a debit).
{
  const mem = [["Merchant", "Category", "Conf"], ["friend", "Not income", 100]];
  sandbox.findMerchantMatch = function(){ return { category: "Not income", confidence: 100 }; };
  sandbox.CONFIDENCE_THRESHOLD = 75;
  sandbox.normalizeText = function(x){ return String(x).toLowerCase(); };
  sandbox.matchByPattern = function(){ return null; };
  ok(sandbox.getSuggestedCategoryFast("Friend", 100, "upi", mem) === "Other", "a remembered 'Not income' is never suggested as a category");
}

console.log(failed ? "FAILED: " + failed : "notIncome: all passed");
process.exit(failed ? 1 : 0);
