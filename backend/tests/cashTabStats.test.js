// backend/tests/cashTabStats.test.js
//
// Plain English: the redesigned Cash tab shows this month's spent/received, the last 7 days, the biggest category,
// a 30-day daily average, and now lists up to 60 entries each with a yyyy-mm-dd date. This checks those figures
// with invented cash entries (all invented). Run with: node backend/tests/cashTabStats.test.js

const { makeWorld, assert, failures } = require("./_fakeSheetsKit");
const w = makeWorld(["PWA.js"]);
const day = (n) => new Date(Date.now() - n * 86400000);
const row = (i, d, type, amt, note, cat) => [i, d, "", type, amt, note, cat];
const rows = [["ID","Date","Time","Type","Amount","Note","Category"]];
rows.push(row(1, day(0), "credit", 1000, "ATM withdrawal", "Other"));
rows.push(row(2, day(0), "debit", 100, "lunch", "Food"));
rows.push(row(3, day(1), "debit", 60, "auto", "Transport"));
rows.push(row(4, day(2), "debit", 40, "tea", "Food"));
for (let i = 0; i < 70; i++) rows.push(row(10 + i, day(40), "debit", 1, "old", "Other"));   // far back, only inflates the count
w.addSheet("Cash", rows);
const c = w.sb.getCashData();

console.log("\n--- Cash tab stats ---");
assert(c.recent.length === 60, "list is capped at 60 entries");
assert(/^\d{4}-\d{2}-\d{2}$/.test(c.recent[0].iso), "each entry carries a yyyy-mm-dd date");
assert(c.stats.last7.length === 7, "last7 has 7 days");
assert(c.stats.last7[6] === 100, "today's bar = 100");
assert(c.stats.last7[5] === 60 && c.stats.last7[4] === 40, "yesterday and the day before");
assert(c.stats.avgDaily === Math.round(200 / 30), "30-day average ignores the 40-day-old rows");
const now = new Date();
const d2 = new Date(Date.now() - 2 * 86400000);
const sameMonth = d2.getMonth() === now.getMonth();
assert(c.stats.monthIn === 1000, "month received = 1000");
if (sameMonth) { assert(c.stats.monthSpent === 200, "month spent = 200"); assert(c.stats.topCategory === "Food" && c.stats.topCategoryAmt === 140, "top category Food 140"); }
assert(c.balance === 1000 - 200 - 70, "balance still counts every row");
console.log("--- Delete ---");
const del0 = w.sb.deleteCashEntry(2, "credit", 1000);   // row 2 = the ATM credit
assert(del0.ok === true, "delete works");
const c2 = w.sb.getCashData();
assert(c2.balance === c.balance - 1000, "balance drops by the removed credit");
assert(!c2.recent.some((e) => e.row === 2), "removed row is gone from the list");
assert(w.sb.deleteCashEntry(2, "credit", 1000).ok === false, "deleting it twice is refused");
assert(w.sb.deleteCashEntry(3, "debit", 999).stale === true, "wrong amount is refused (stale card)");
assert(w.sb.deleteCashEntry(3, "debit", 100).ok === true, "right amount works");
assert(w.sb.deleteCashEntry(0, "debit", 1).ok === false, "bad row refused");
console.log(failures() ? "\nFAILED" : "\nAll good");
process.exit(failures() ? 1 : 0);
