// backend/tests/runwaySips.test.js
//
// Plain-English what this checks: Home's "Needs you" bills use the real SIP list (name, amount, day), not a guess from the last
// unnamed payment. Found 2026-11-07: Home showed a Rs 2,000 "Investment" and no Nifty 50 SIP, so bills added up to Rs 8,000
// instead of Rs 9,000.
// Run with: node backend/tests/runwaySips.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(c, m){ if(!c){ console.error("FAIL: " + m); process.exitCode = 1; } else console.log("PASS: " + m); }

const ctx = { console, Date, Math, Number, String, Object, Array, isNaN, isFinite, logAI: function(){}, Utilities: {}, Session: {} };
vm.createContext(ctx);
["obligationReminders.js", "runway.js"].forEach(function(f){
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
});

const old = [
  { label: "Rent", type: "Rent", name: "", enoughHistory: true, alreadyThisMonth: false, avgAmount: 15000, daysUntil: 3 },
  { label: "Investment", type: "Investment", name: "", enoughHistory: true, alreadyThisMonth: false, avgAmount: 2000, daysUntil: 3 },
  { label: "HDFC Mid Cap Fund", type: "Investment", name: "HDFC Mid Cap Fund", enoughHistory: true, alreadyThisMonth: false, avgAmount: 4000, daysUntil: 3 }
];
const sips = [
  { name: "HDFC Nifty 50 Index Fund", amount: 3000, day: 10, active: true, status: "upcoming", daysUntil: 3 },
  { name: "HDFC Mid Cap Fund", amount: 4000, day: 10, active: true, status: "upcoming", daysUntil: 3 },
  { name: "Bandhan Small Cap (Money2Mgt SIP)", amount: 2000, day: 15, active: true, status: "upcoming", daysUntil: 8 }
];
let out = ctx.runwaySwapInSips_(old, sips);
const inv = out.filter(o => o.type === "Investment");
assert(inv.length === 3 && inv.reduce((s, o) => s + o.avgAmount, 0) === 9000, "the three real SIPs add up to 9,000 (not 8,000)");
assert(!out.some(o => o.label === "Investment"), "the nameless 'Investment' guess is gone");
assert(out.some(o => o.label === "Rent" && o.avgAmount === 15000), "Rent is kept as it was");
assert(out.find(o => o.name === "HDFC Nifty 50 Index Fund").daysUntil === 3, "Nifty 50 shows in 3 days");

out = ctx.runwaySwapInSips_(old, [
  { name: "A", amount: 1000, day: 5, active: true, status: "paid", daysUntil: null },
  { name: "B", amount: 1000, day: 5, active: false, status: "paused", daysUntil: null },
  { name: "C", amount: 500, day: 1, active: true, status: "overdue", daysLate: 6, daysUntil: null },
  { name: "D", amount: 700, day: null, active: true, status: "upcoming", daysUntil: null }
]);
const names = out.filter(o => o.type === "Investment").map(o => o.name + ":" + o.daysUntil);
assert(names.join("|") === "C:0", "paid, paused and day-less SIPs are not bills; a late one counts as due today: " + names.join("|"));

assert(ctx.runwaySwapInSips_(old, []).filter(o => o.type === "Investment").length === 0, "no SIPs set up = no investment bills");

// Feeding the runway: bills ahead now include all three SIPs
const r = ctx.computeRunway_({ txnData: [new Array(21).fill("h")], today: new Date(2026, 10, 7), now: new Date(2026, 10, 7, 12),
  checkpoint: { amount: 50000, atMs: new Date(2026, 10, 7, 11).getTime() }, monthSpend: 5000, monthlyExpensesSetting: 30000,
  obligations: ctx.runwaySwapInSips_([], sips), ccBillAhead: 0, salaryDaySetting: 0 });
assert(r.billsAhead === 9000 && r.bills.length === 3, "runway bills ahead = 9,000 across 3 SIPs: " + r.billsAhead);
