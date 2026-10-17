// backend/tests/analysisIncomeItems.test.js
//
// Plain English: the Analysis screen's Income figure used to be one lonely number. Now getMonthlyAnalysis
// also returns `incomeItems` — every credit that was added into it (bank credits and Cash credits), biggest
// first — so the app can show "what is in my income". This proves:
//   1. the items add up to exactly totalCredit (nothing missing, nothing counted twice);
//   2. bank credits are labelled by who paid (counterparty, else the note) and Cash credits by their note;
//   3. a credit from another month is not included;
//   4. byMode.bank/card/wallet each list only their own bank credits (Cash is never in them);
//   5. the numbers that existed before (totalCredit, totalDebit, savings) are unchanged.
// Run with: node backend/tests/analysisIncomeItems.test.js

const fs = require("fs"), path = require("path"), vm = require("vm");
let failed = 0;
function ok(c, m) { if (!c) { failed++; console.error("FAIL: " + m); } else console.log("PASS: " + m); }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }

const sandbox = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  Utilities: { formatDate: (date, tz, fmt) => {
    const d = new Date(date), pad = n => String(n).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return fmt === "dd MMM" ? pad(d.getDate()) + " " + months[d.getMonth()] : d.toISOString();
  } },
  Session: { getScriptTimeZone: () => "UTC" }, Logger: { log() {} }, console
};
sandbox.dbSs_ = () => sandbox.SpreadsheetApp.getActiveSpreadsheet();
sandbox.dbProps_ = () => sandbox.PropertiesService.getScriptProperties();
vm.createContext(sandbox);
["needWantSaving.js", "PWA.js"].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, { filename: f }));

function txn(date, type, mode, amount, o) {
  o = o || {};
  return [date, "10:00", "HDFC", type, mode, amount, o.reference || "", o.counterparty || "", "", "", "", "", o.note || "", o.category || "Other", "", "YES", o.nws || "", o.fe || "", ""];
}
function cash(date, type, amount, note) { return ["", date, "", type, amount, note, "Other", "", "", "", ""]; }
const TH = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NWS","FE","FEN"];
const CH = ["R0","Date","R2","Type","Amount","Note","Category","R7","R8","R9","NWS"];

const rows = [TH,
  txn(new Date(2026, 9, 1), "credit", "neft", 45000, { counterparty: "ACME PVT LTD" }),
  txn(new Date(2026, 9, 5), "credit", "upi", 414, { note: "refund" }),
  txn(new Date(2026, 9, 6), "credit", "card 8132", 250, { counterparty: "Amazon" }),
  txn(new Date(2026, 9, 7), "credit", "wallet", 20, { counterparty: "PayZapp cashback" }),
  txn(new Date(2026, 8, 30), "credit", "neft", 999, { counterparty: "LAST MONTH" }),     // other month
  txn(new Date(2026, 9, 8), "debit", "upi", 1000, { counterparty: "Swiggy", category: "Food" }),
  txn(new Date(2026, 9, 9), "debit", "upi", 7000, { fe: "Rent" })
];
const cashRows = [CH, cash(new Date(2026, 9, 10), "credit", 100, "sold old book"), cash(new Date(2026, 9, 11), "debit", 50, "tea")];

const a = sandbox.getMonthlyAnalysis(2026, 10, rows, cashRows);

eq(a.totalCredit, 45000 + 414 + 250 + 20 + 100, "totalCredit unchanged: 45,784");
eq(a.totalDebit, 1050, "totalDebit unchanged (Rent excluded, cash tea included)");
eq(a.savings, a.totalCredit - a.totalDebit, "the backend's own savings field is untouched");
ok(Array.isArray(a.incomeItems), "incomeItems is returned");
eq(a.incomeItems.reduce((s, i) => s + i.amount, 0), a.totalCredit, "items add up to exactly totalCredit");
eq(a.incomeItems.length, 5, "5 credits this month (last month's is not included)");
eq(a.incomeItems.map(i => i.amount), [45000, 414, 250, 100, 20], "biggest first");
eq(a.incomeItems[0].label, "ACME PVT LTD", "bank credit labelled by counterparty");
eq(a.incomeItems[1].label, "refund", "no counterparty -> the note");
eq(a.incomeItems[3].label, "sold old book", "cash credit labelled by its note");
eq(a.incomeItems[3].source, "cash", "cash credit marked as cash");
eq(a.incomeItems[0].date, "01 Oct", "date formatted dd MMM");

eq(a.byMode.bank.incomeItems.map(i => i.amount), [45000, 414], "bank bucket: neft + upi credits only");
eq(a.byMode.card.incomeItems.map(i => i.amount), [250], "card bucket: the card credit");
eq(a.byMode.wallet.incomeItems.map(i => i.amount), [20], "wallet bucket: the wallet credit");
ok(a.byMode.bank.incomeItems.every(i => i.source === "bank"), "cash never appears in a mode bucket");
eq(a.byMode.bank.totalCredit, 45414, "bucket totals unchanged");

const empty = sandbox.getMonthlyAnalysis(2026, 11, rows, cashRows);
eq(empty.incomeItems, [], "a month with no credits returns an empty list");

console.log(failed ? "\n" + failed + " FAILED" : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
