// Tests the Planner makeover's pure function plannerComputePlan, extracted straight from index.html.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const html = fs.readFileSync(__dirname + "/../../index.html", "utf8");
const start = html.indexOf("function plannerComputePlan(");
let i = html.indexOf("{", start), depth = 0, end = i;
for (; end < html.length; end++) { if (html[end] === "{") depth++; if (html[end] === "}") { depth--; if (!depth) break; } }
const ctx = {}; vm.createContext(ctx); vm.runInContext(html.slice(start, end + 1), ctx);
const plan = ctx.plannerComputePlan;
const cat = (name, target, actual, saved) => ({ category: name, split: false, suggested: { total: target }, saved: saved ? { total: target } : null, actual: { total: actual } });
const ov = { income: { actual: 50000, saved: null }, targets: { needs: 6000, wants: 5000, savingsInvestment: 10000, fixedObligations: 19000 } };
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

// Oct 15 of a 31-day month, spent 8,000 of 20,000 budget
let p = { month: "2026-10", categories: [cat("Food", 10000, 4000, true), cat("Transport", 10000, 4000, true)], overview: ov };
let r = plan(p, new Date(2026, 9, 15));
ok(r.budget === 20000 && r.spent === 8000 && r.left === 12000, "totals");
ok(r.daysLeft === 17 && r.perDay === Math.round(12000 / 17), "per day");
ok(r.paceSpent === Math.round(20000 * 15 / 31) && r.status === "ok", "under pace is ok");
ok(r.map.free === 50000 - 40000, "free money = income - planned");

// Over pace but not over budget
p.categories[0].actual.total = 9000;
r = plan(p, new Date(2026, 9, 10)); ok(r.status === "near", "above pace line");
// Over budget
p.categories[0].actual.total = 20000;
r = plan(p, new Date(2026, 9, 20)); ok(r.status === "over" && r.left < 0 && r.perDay === 0, "over budget");
ok(r.nudges.length && r.nudges[0].kind === "over" && r.nudges[0].category === "Food", "over nudge");

// Pace nudge: day 10, 4,000 spent of 10,000 -> projected 12,400 > 11,000
p = { month: "2026-10", categories: [cat("Food", 10000, 4000, true)], overview: ov };
r = plan(p, new Date(2026, 9, 10));
ok(r.nudges.length === 1 && r.nudges[0].kind === "pace", "pace nudge");
// No nudges before day 5
r = plan(p, new Date(2026, 9, 3)); ok(r.nudges.length === 0, "no early nudges");
// Past month: no pace, full budget as pace
r = plan({ month: "2026-09", categories: p.categories, overview: ov }, new Date(2026, 9, 10));
ok(r.isCurrent === false && r.nudges.length === 0, "past month");
// No saved plan flagged
ok(plan({ month: "2026-10", categories: [cat("Food", 100, 0, false)], overview: ov }, new Date(2026, 9, 10)).anySaved === false, "anySaved");
// Planned more than income -> negative free
const ov2 = JSON.parse(JSON.stringify(ov)); ov2.income.actual = 1000;
ok(plan({ month: "2026-10", categories: p.categories, overview: ov2 }, new Date(2026, 9, 10)).map.free < 0, "negative free");
console.log("plannerPlan: " + n + " checks passed");
