// backend/tests/runway.test.js
//
// Plain-English what this checks: Home's "your money lasts until <date>" card (runway.js).
// Run with: node backend/tests/runway.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(c, m){ if(!c){ console.error("FAIL: " + m); process.exitCode = 1; } else console.log("PASS: " + m); }

const ctx = { console, Date, Math, Number, String, Object, Array, isNaN, isFinite, logAI: function(){}, Utilities: {}, Session: {} };
vm.createContext(ctx);
["obligationReminders.js", "runway.js"].forEach(function(f){
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
});

const today = new Date(2026, 9, 17);          // 17 Oct 2026
const now = new Date(2026, 9, 17, 12, 0);
// Transactions rows: A date, B time, C bank, D type, E mode, F amount, ..., N category (index 13)
function row(date, time, type, mode, amount, cat){
  const r = new Array(21).fill("");
  r[0] = date; r[1] = time; r[3] = type; r[4] = mode; r[5] = amount; r[13] = cat || "";
  return r;
}
const header = new Array(21).fill("h");
const salary = [row(new Date(2026, 6, 1), "09:00", "credit", "neft", 45000, "Income"),
                row(new Date(2026, 7, 1), "09:00", "credit", "neft", 45000, "Income"),
                row(new Date(2026, 8, 2), "09:00", "credit", "neft", 45000, "Income"),
                row(new Date(2026, 9, 1), "09:00", "credit", "neft", 45000, "Income")];

// 1. salary day worked out from the person's own history
assert(ctx.runwayDetectSalaryDay_([header].concat(salary)) === 1, "salary day = 1 from past Income credits");
assert(ctx.runwayDetectSalaryDay_([header, salary[0]]) === null, "one salary only: no guess");

// 2. no checkpoint yet: asks for the balance, gives no date
let r = ctx.computeRunway_({ txnData: [header], today, now, checkpoint: null, monthSpend: 17000, monthlyExpensesSetting: 30000, obligations: [], ccBillAhead: 0, salaryDaySetting: 0 });
assert(r.askBalance && !r.hasCheckpoint && r.runOutDate === null, "no checkpoint: asks, no date");

// 3. checkpoint 3 days ago, rolled forward with bank movements only
const cp = { amount: 20000, atMs: new Date(2026, 9, 14, 10, 0).getTime() };
const txns = [header].concat(salary, [
  row(new Date(2026, 9, 13), "09:00", "debit", "upi", 5000),            // before checkpoint: ignored
  row(new Date(2026, 9, 15), "10:00", "debit", "upi", 1000),            // after: -1000
  row(new Date(2026, 9, 16), "10:00", "debit", "card 1111", 3000),      // card swipe: not a bank movement
  row(new Date(2026, 9, 16), "11:00", "credit", "upi", 500),            // after: +500
  row(new Date(2026, 9, 14), "09:00", "debit", "upi", 700),             // same day, EARLIER than checkpoint time: ignored
  row(new Date(2026, 9, 16), "12:00", "debit", "wallet", 400)           // wallet spend: the top-up already left the bank, so skipped
]);
r = ctx.computeRunway_({ txnData: txns, today, now, checkpoint: cp, monthSpend: 17000, monthlyExpensesSetting: 30000,
  obligations: [{ label: "Rent", enoughHistory: true, alreadyThisMonth: false, daysUntil: 3, avgAmount: 15000 }], ccBillAhead: 0, salaryDaySetting: 0 });
assert(r.estimatedBalance === 19500, "balance rolled forward: 20000 - 1000 + 500 = 19500 (got " + r.estimatedBalance + ")");
assert(!r.askBalance && r.checkpointAgeDays === 3, "fresh checkpoint: no re-ask");
assert(r.dailyPace === 1000, "pace = 17000 / 17 days = 1000");
assert(r.billsAhead === 15000, "Rent still ahead is subtracted");
assert(r.daysLeft === 4 && r.runOutDate === "2026-10-21", "(19500-15000)/1000 = 4 days -> 21 Oct (got " + r.runOutDate + ")");
assert(r.salaryDate === "2026-11-01" && r.daysToSalary === 15, "next salary 1 Nov, 15 days");
assert(r.shortByDays === 11, "11 days short of salary");
assert(r.maxPerDay === 300, "max per day to reach salary = 4500/15 = 300 (got " + r.maxPerDay + ")");

// 4. a bill already paid this month, or too far away, is not counted; unpaid card bill is
r = ctx.computeRunway_({ txnData: txns, today, now, checkpoint: cp, monthSpend: 17000, monthlyExpensesSetting: 30000,
  obligations: [{ label: "Rent", enoughHistory: true, alreadyThisMonth: true, daysUntil: 25, avgAmount: 15000 },
                { label: "SIP", enoughHistory: true, alreadyThisMonth: false, daysUntil: 40, avgAmount: 4000 },
                { label: "New", enoughHistory: false }], ccBillAhead: 2500, salaryDaySetting: 0 });
assert(r.billsAhead === 2500 && r.bills.length === 1, "only the unpaid card bill counts");

// 5. stale checkpoint asks again but still shows the rolled-forward estimate
r = ctx.computeRunway_({ txnData: txns, today, now: new Date(2026, 9, 25), checkpoint: cp, monthSpend: 17000, monthlyExpensesSetting: 30000, obligations: [], ccBillAhead: 0, salaryDaySetting: 0 });
assert(r.askBalance && r.estimatedBalance === 19500, "older than 7 days: asks to confirm, keeps the estimate");

// 6. early in the month uses the typed monthly-expenses setting, not 1-2 days of data
r = ctx.computeRunway_({ txnData: txns, today: new Date(2026, 9, 2), now: new Date(2026, 9, 2, 12), checkpoint: cp, monthSpend: 900, monthlyExpensesSetting: 30000, obligations: [], ccBillAhead: 0, salaryDaySetting: 0 });
assert(r.dailyPace === 1000, "day 2: pace from monthly expenses setting (30000/30)");

// 7. typed salary day beats the detected one; day 31 is clamped in short months
r = ctx.computeRunway_({ txnData: txns, today: new Date(2026, 10, 20), now: new Date(2026, 10, 20, 12), checkpoint: { amount: 1000, atMs: new Date(2026, 10, 19).getTime() }, monthSpend: 10000, monthlyExpensesSetting: 30000, obligations: [], ccBillAhead: 0, salaryDaySetting: 31 });
assert(r.salaryDate === "2026-11-30", "salary day 31 in November lands on the 30th");

// 8. money already gone: runs out today, never a negative day count
r = ctx.computeRunway_({ txnData: [header], today, now, checkpoint: { amount: 100, atMs: now.getTime() - 1000 }, monthSpend: 17000, monthlyExpensesSetting: 30000,
  obligations: [{ label: "Rent", enoughHistory: true, alreadyThisMonth: false, daysUntil: 3, avgAmount: 15000 }], ccBillAhead: 0, salaryDaySetting: 1 });
assert(r.daysLeft === 0 && r.runOutDate === "2026-10-17", "bills exceed balance: runs out today");

// 9. a big debit can never push the shown balance below zero (so "Yes, that's right" is always saveable)
r = ctx.computeRunway_({ txnData: [header, row(new Date(2026, 9, 16), "10:00", "debit", "upi", 5000)], today, now, checkpoint: { amount: 1000, atMs: new Date(2026, 9, 15).getTime() }, monthSpend: 17000, monthlyExpensesSetting: 30000, obligations: [], ccBillAhead: 0, salaryDaySetting: 1 });
assert(r.estimatedBalance === 0, "balance never below zero");

// 10. saving a balance: empty / null / negative are refused
ctx.dbProps_ = function(){ return { setProperty: function(k, v){ ctx._saved = ctx._saved || {}; ctx._saved[k] = v; } }; };
assert(!ctx.saveRunwayBalance(null).ok && !ctx.saveRunwayBalance("").ok && !ctx.saveRunwayBalance(-5).ok, "null, empty and negative amounts are refused");
assert(ctx.saveRunwayBalance("21400").ok && ctx._saved.RUNWAY_BALANCE === "21400", "a real amount is saved");
