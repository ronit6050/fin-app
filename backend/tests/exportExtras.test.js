// 2026-10-31: getExportExtras returns what More > Export data was missing: Pending, EVERY cash entry, Savings and Investments.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
function ok(c, m){ if(c) console.log("PASS: " + m); else { failed++; console.log("FAIL: " + m); } }

const sheets = {
  Cash: [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "", "", "", "NWS"],
    ["1", new Date("2026-10-01T05:00:00Z"), "10:00", "debit", 40, "tea", "Food", "", "", "", "Want"],
    ["", "", "", "", "", "", "", "", "", "", ""],                                      // an emptied row: skipped
    ["2", new Date("2026-10-02T05:00:00Z"), "11:00", "credit", 500, "from dad", "Income", "", "", "", ""]],
  Savings: [["Date", "Amount", "Type", "Note", "Destination"], [new Date("2026-10-03T05:00:00Z"), 1000, "manual", "x", "Emergency"], [new Date("2026-10-04T05:00:00Z"), -200, "withdraw", "", "Free"]],
  Investments: [["Date", "Name", "Amount", "Note", "Kind"], [new Date("2026-10-05T05:00:00Z"), "Nifty 50", 3000, "SIP", "payment"]]
};
const many = [sheets.Cash[0]];
for(let i = 0; i < 100; i++) many.push([String(i), new Date("2026-09-10T05:00:00Z"), "09:00", "debit", 10, "n" + i, "Food", "", "", "", ""]);   // more than the Cash screen's 60

function load(cashRows, pendingFn){
  const sb = {
    console,
    Utilities: { formatDate: function(d){ const x = new Date(d.getTime() + 330 * 60000); return x.toISOString().slice(0, 10); } },
    dbSs_: function(){ return { getSheetByName: function(n){ const v = n === "Cash" ? cashRows : sheets[n]; return v ? { getDataRange: function(){ return { getValues: function(){ return v; } }; } } : null; } }; },
    getPendingTransactions: pendingFn
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "exportData.js"), "utf8"), sb, { filename: "exportData.js" });
  return sb;
}

let r = load(sheets.Cash, function(){ return [{ date: "31 Oct 2026", time: "16:26", type: "debit", amount: 349, counterparty: "NEEDS REVIEW: unrecognized message", mode: "other", bank: "HDFC", reference: "" }]; }).getExportExtras_();
ok(r.ok && r.pending.length === 1 && r.pending[0].amount === 349, "Pending items are included");
ok(r.cash.length === 2 && r.cash[0].iso === "2026-10-01" && r.cash[1].type === "credit", "Cash rows come back (the emptied row is skipped), dates in India time");
ok(r.savings.length === 2 && r.savings[1].amount === -200, "Savings entries, withdrawals negative");
ok(r.investments.length === 1 && r.investments[0].name === "Nifty 50" && r.investments[0].kind === "payment", "Investments entries");

r = load(many, function(){ return []; }).getExportExtras_();
ok(r.cash.length === 100, "ALL cash entries are returned, not just the latest 60 (got " + r.cash.length + ")");

r = load(sheets.Cash, function(){ throw new Error("boom"); }).getExportExtras_();
ok(r.ok && r.pending.length === 0 && r.pendingError === true && r.cash.length === 2, "a problem in one part never loses the others");

console.log(failed ? "FAILED: " + failed : "exportExtras: all passed");
process.exit(failed ? 1 : 0);
