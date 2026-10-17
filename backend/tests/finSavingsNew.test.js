// Checks the pure logic behind the redesigned Savings screen (index.html, block between
// SV-LOGIC-START and SV-LOGIC-END): the pace / finish-date wording, "months of expenses
// covered", "goal met in N of M months", grouping Activity by month, the "payment" entry type,
// the 6-month chart, and what happens when an older server (or a stale saved copy) leaves a
// new field out: the piece is hidden or worked out locally, never a crash.
// Also checks the markup / wiring the New look relies on (switch-off safety, Demo Mode fields).
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const m = html.match(/SV-LOGIC-START\r?\n([\s\S]*?)\/\/ SV-LOGIC-END/);
if (!m) { console.log("FAIL: logic block not found"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
const names = ["svIsNum", "svRs", "svPct", "svParseDate", "svMonthLabel", "svAddMonths", "svISOOf", "svIndiaISO", "svIndiaNow", "svMonthsLeft", "svDatePassed", "svMonthlyNeeded", "svPaceParts", "svPaceText",
  "svCompact", "svCover", "svCoverText", "svGoalMetText", "svTotalSaved", "svThisMonth", "svHero", "svApplyTotals", "svChartModel", "svGroupEntries",
  "svSource", "svSourceLabel", "svDestLabel", "svShortDate", "svNeedsHome", "svGoalEntries", "svDestOptions", "svBucket", "svManualCheck", "svManualLeftText", "svPreviewRows"];
vm.runInContext(m[1] + "; " + names.map((n) => "this." + n + " = " + n).join("; "), ctx);
const f = ctx;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ")");

const NOW = new Date(2026, 9, 17);   // 17 Oct 2026

// ---- months and dates ----
eq(f.svAddMonths(NOW, 0), { year: 2026, month: 10 }, "this month");
eq(f.svAddMonths(NOW, 3), { year: 2027, month: 1 }, "rolls into next year");
eq(f.svAddMonths(NOW, -10), { year: 2025, month: 12 }, "goes back over a year end");
eq(f.svMonthLabel(2027, 3), "Mar 2027", "month label");
// Months left: the SAME rule as goalMonthsLeft_ in backend/savingsGoals.js (whole months, minimum 1).
ok(f.svMonthsLeft("2027-03-15", NOW) === 4, "17 Oct -> 15 Mar: the 15th is before the 17th, so 4 months (not 5)");
ok(f.svMonthsLeft("2027-03-17", NOW) === 5, "17 Oct -> 17 Mar = 5 months");
ok(f.svMonthsLeft("2027-03-31", NOW) === 5, "month-end day: 17 Oct -> 31 Mar = 5");
ok(f.svMonthsLeft("2027-02-28", NOW) === 4, "17 Oct -> 28 Feb = 4");
ok(f.svMonthsLeft("2026-10-30", NOW) === 1, "later this month = 1 (minimum)");
ok(f.svMonthsLeft("2026-10-17", NOW) === 1, "today = 1");
ok(f.svMonthsLeft("2026-11-05", NOW) === 1 && f.svMonthsLeft("2026-11-17", NOW) === 1 && f.svMonthsLeft("2026-11-30", NOW) === 1, "next month = 1");
ok(f.svMonthsLeft("2026-12-16", NOW) === 1 && f.svMonthsLeft("2026-12-17", NOW) === 2, "16 Dec = 1, 17 Dec = 2");
ok(f.svMonthsLeft("2026-10-02", NOW) === 1 && f.svMonthsLeft("2026-01-01", NOW) === 1, "a past date still comes out as 1 on the server (the screen checks 'passed' separately)");
ok(f.svMonthsLeft("2028-01-10", NOW) === 14 && f.svMonthsLeft("2028-01-20", NOW) === 15, "year rollover: 17 Oct 2026 -> 10 Jan 2028 = 14, -> 20 Jan 2028 = 15");
const JAN31 = new Date(2027, 0, 31), MAR1 = new Date(2027, 2, 1);
ok(f.svMonthsLeft("2027-02-28", JAN31) === 1 && f.svMonthsLeft("2027-04-30", JAN31) === 2 && f.svMonthsLeft("2027-04-30", MAR1) === 1, "month-end 'now' (31 Jan) and 1 Mar");
ok(f.svMonthsLeft("", NOW) === null && f.svMonthsLeft("nonsense", NOW) === null && f.svMonthsLeft("2027-02-31", NOW) === null, "no usable date (or 31 Feb) = null");
ok(f.svDatePassed("2026-10-02", NOW) === true && f.svDatePassed("2026-01-01", NOW) === true, "earlier dates have passed");
ok(f.svDatePassed("2026-10-17", NOW) === false && f.svDatePassed("2026-10-18", NOW) === false && f.svDatePassed("", NOW) === false, "today / later / empty have not");
ok(f.svISOOf(new Date(2026, 0, 5)) === "2026-01-05", "ISO of a Date");
ok(/^\d{4}-\d{2}-\d{2}$/.test(f.svIndiaISO()) && f.svISOOf(f.svIndiaNow()) === f.svIndiaISO(), "India 'today' is a real date and svIndiaNow matches it");
ok(f.svIndiaISO() === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), "India date does not depend on the phone's zone");

// ---- monthly need (the Edit goal / date-picker preview) ----
ok(f.svMonthlyNeeded(24000, "2027-03-15", NOW) === 6000, "24,000 over 4 months = 6,000 a month");
ok(f.svMonthlyNeeded(24001, "2027-03-15", NOW) === 6001, "rounds UP so the date is really reached");
ok(f.svMonthlyNeeded(0, "2027-03-15", NOW) === 0, "nothing left = 0 a month");
ok(f.svMonthlyNeeded(1000, "2026-10-01", NOW) === null, "a passed date gives no number");
ok(f.svMonthlyNeeded(1000, "", NOW) === null, "no date gives no number");

// ---- pace line ----
const goal = { target: 40000, saved: 15000, targetDate: "2027-03-15" };
let p = f.svPaceParts(goal, 4000, NOW);
ok(p.kind === "date" && p.amount === 6250 && f.svPaceText(p) === "₹6,250 a month to finish by Mar 2027", "with a date: 25,000 over 4 months, got " + f.svPaceText(p));
p = f.svPaceParts({ ...goal, monthlyNeeded: 4800 }, 4000, NOW);
ok(p.amount === 4800, "uses the server's monthlyNeeded when it sent one");
p = f.svPaceParts({ ...goal, monthsLeft: 10 }, 4000, NOW);
ok(p.amount === 2500, "uses the server's monthsLeft when it sent one (25,000 / 10)");
p = f.svPaceParts({ target: 40000, saved: 15000, targetDate: "2027-02-31" }, 5000, NOW);
ok(p.kind === "pace", "an impossible date falls back to the usual pace, no crash");
p = f.svPaceParts({ target: 40000, saved: 15000 }, 5000, NOW);
ok(p.kind === "pace" && f.svPaceText(p) === "At your usual ₹5,000 a month: Mar 2027", "no date, a pace: 25,000 left / 5,000 = 5 months -> Mar 2027, got " + f.svPaceText(p));
p = f.svPaceParts({ target: 40000, saved: 15000 }, 4000, NOW);
ok(f.svPaceText(p) === "At your usual ₹4,000 a month: May 2027", "25,000 / 4,000 = 6.25 -> 7 months -> May 2027, got " + f.svPaceText(p));
p = f.svPaceParts({ target: 40000, saved: 15000 }, 0, NOW);
ok(p.kind === "none" && f.svPaceText(p) === "Add a date to see the pace", "no date and no pace");
p = f.svPaceParts({ target: 40000, saved: 15000 }, undefined, NOW);
ok(p.kind === "none", "pace missing (older server) -> the same message, no crash");
p = f.svPaceParts({ target: 40000, saved: 40000, targetDate: "2027-03-15" }, 4000, NOW);
ok(p.kind === "done", "fully saved -> 'enough saved', not a pace");
p = f.svPaceParts({ target: 40000, saved: 1000, targetDate: "2026-09-01" }, 4000, NOW);
ok(p.kind === "past", "a passed date asks for a new one");
ok(f.svPaceParts(null, 100, NOW).kind === "none", "no goal object -> no crash");

// ---- months of expenses covered ----
eq(f.svCover(45000, 30000, 90000), { covered: 1.5, target: 3 }, "1.5 of 3 months");
ok(f.svCoverText(f.svCover(45000, 30000, 90000)) === "1.5 of 3 months of expenses covered", "cover wording");
ok(f.svCoverText(f.svCover(90000, 30000, 90000)) === "3 of 3 months of expenses covered", "whole numbers print without .0");
eq(f.svCover(1000, 0, 0), null, "no monthly expenses -> hidden");
eq(f.svCover(1000, undefined, 0), null, "monthly expenses missing -> hidden");
eq(f.svCover(30000, 30000, 0), { covered: 1, target: 3 }, "no target -> says 3 months");
eq(f.svCover(32000, 30000, 120000), { covered: 1.1, target: 4 }, "target months follow the Settings number");

// ---- goal met wording ----
ok(f.svGoalMetText({ met: 3, of: 6 }) === "Goal met in 3 of the last 6 months", "goal met in 3 of the last 6 months");
ok(f.svGoalMetText({ met: 0, of: 1 }) === "Goal met in 0 of the last 1 month", "singular month");
ok(f.svGoalMetText({ met: 0, of: 0 }) === "" && f.svGoalMetText(null) === "" && f.svGoalMetText(undefined) === "", "no months (or not sent) -> that part is hidden");

// ---- hero / fallbacks ----
const s0 = { emergency: 10000, free: 2000, goals: [{ saved: 3000 }, { saved: 500 }] };
ok(f.svTotalSaved(s0) === 15500, "total falls back to emergency + free + every goal's saved");
ok(f.svTotalSaved({ ...s0, totalSaved: 99 }) === 99, "uses the server's total when sent");
ok(f.svTotalSaved({ ...s0, totalSaved: 0 }) === 0, "a real 0 is kept, not replaced");
ok(f.svHero(s0) === null, "no monthly goal / this-month figure -> the 'This month' block is hidden");
ok(f.svHero({ monthlyGoal: 3000 }) === null, "goal but no this-month figure -> hidden");
eq(f.svHero({ monthlyGoal: 3000, thisMonthSaved: 1200 }), { thisMonth: 1200, goal: 3000, pct: 40, toGo: 1800, reached: false }, "40% of the goal, 1,800 to go");
ok(f.svHero({ monthlyGoal: 3000, thisMonthSaved: 3500 }).reached === true && f.svHero({ monthlyGoal: 3000, thisMonthSaved: 3500 }).pct === 100 && f.svHero({ monthlyGoal: 3000, thisMonthSaved: 3500 }).toGo === 0, "over the goal = reached, bar stops at 100");
ok(f.svHero({ monthlyGoal: 3000, monthlySaved: [{ year: 2026, month: 9, saved: 1 }, { year: 2026, month: 10, saved: 750 }] }).thisMonth === 750, "this month falls back to the last of monthlySaved");
ok(f.svHero({ monthlyGoal: 3000, thisMonthSaved: -200 }).pct === 0, "a net negative month does not break the bar");

// ---- keeping totals in step with an optimistic change ----
const tot = { totalSaved: 1000, thisMonthSaved: 200, monthlySaved: [{ year: 2026, month: 9, saved: 5 }, { year: 2026, month: 10, saved: 200 }] };
f.svApplyTotals(tot, 300);
ok(tot.totalSaved === 1300 && tot.thisMonthSaved === 500 && tot.monthlySaved[1].saved === 500 && tot.monthlySaved[0].saved === 5, "adding 300 moves the total, this month and the current bar");
f.svApplyTotals(tot, -100);
ok(tot.totalSaved === 1200, "a take-out lowers them");
const bare = { emergency: 1 };
f.svApplyTotals(bare, 50);
eq(bare, { emergency: 1 }, "fields the server never sent are NOT invented");
f.svApplyTotals(null, 5); f.svApplyTotals({}, "x");

// ---- chart ----
const six = [1, 2, 3, 4, 5, 6].map((i) => ({ year: 2026, month: 4 + i, saved: i * 600 }));   // May..Oct: 600..3600
let cm = f.svChartModel({ monthlySaved: six, monthlyGoal: 3000 });
ok(cm.bars.length === 6 && cm.bars[5].label === "Oct" && cm.bars[5].current === true && cm.bars[0].current === false, "6 bars, oldest first, last = current month");
ok(cm.bars[5].met === true && cm.bars[4].met === true && cm.bars[3].met === false, "bars at or over the goal are 'met' (3,000 and 3,600; 2,400 is not)");
ok(cm.bars[5].pct === 100 && cm.goalPct === Math.round(3000 / 3600 * 1000) / 10, "tallest bar fills the chart; goal line sits proportionally, got " + cm.goalPct);
cm = f.svChartModel({ monthlySaved: [{ year: 2026, month: 10, saved: 500 }], monthlyGoal: 3000 });
ok(cm.goalPct === 100 && cm.bars[0].pct < 20, "when the goal is the tallest thing, the goal line is at the top");
cm = f.svChartModel({ monthlySaved: six });
ok(cm.goal === 0 && cm.goalPct === null && cm.bars.every((b) => b.met === false), "no monthly goal -> no line and nothing is 'met'");
cm = f.svChartModel({ monthlySaved: [{ year: 2026, month: 10, saved: -400 }, { year: 2026, month: 9, saved: 0 }], monthlyGoal: 100 });
ok(cm.bars[0].pct === 0 && cm.bars[1].pct === 0, "negative / zero months draw an empty bar, not a broken one");
ok(f.svChartModel({}) === null && f.svChartModel(null) === null && f.svChartModel({ monthlySaved: [] }) === null && f.svChartModel({ monthlySaved: [{ bad: 1 }] }) === null, "no monthlySaved (older server) -> the chart is hidden");
ok(f.svCompact(3000) === "₹3k" && f.svCompact(12500) === "₹12.5k" && f.svCompact(450) === "₹450" && f.svCompact(125000) === "₹1.3L" && f.svCompact(0) === "₹0", "compact labels fit a narrow bar");

// ---- Activity grouping and sources ----
const ents = [
  { row: 5, date: "2026-09-30", amount: 100, type: "manual", note: "a" },
  { row: 9, date: "2026-10-10", amount: 200, type: "payment", note: "b" },
  { row: 8, date: "2026-10-10", amount: 300, type: "manual", note: "c" },
  { row: 2, date: "2026-10-01", amount: -50, type: "withdraw", note: "d" },
  { row: 3, date: "2025-12-31", amount: 70, type: "manual", note: "e" },
  { row: 4, date: "", amount: 10, type: "manual", note: "f" }
];
const g = f.svGroupEntries(ents);
eq(g.map((x) => x.label), ["October 2026", "September 2026", "December 2025", "Earlier"], "newest month first, entries with no date last");
eq(g[0].entries.map((e) => e.row), [9, 8, 2], "newest first inside a month; same day: higher row first");
eq(f.svGroupEntries(undefined), [], "no entries -> no groups, no crash");
ok(f.svSource({ source: "payment" }) === "payment" && f.svSource({ source: "withdraw", amount: 5 }) === "withdraw" && f.svSource({ source: "you" }) === "you", "uses the server's source when sent");
ok(f.svSource({ type: "payment", amount: 5 }) === "payment", "no source: type 'payment' is a payment");
ok(f.svSource({ type: "withdraw", amount: -5 }) === "withdraw" && f.svSource({ type: "manual", amount: -5 }) === "withdraw", "no source: a negative amount is a take-out");
ok(f.svSource({ type: "auto", amount: 5 }) === "you" && f.svSource({ type: "manual", amount: 5 }) === "you", "no source: auto / manual are 'added by you'");
ok(f.svSource({ source: "weird", type: "payment" }) === "payment", "an unknown source value falls back to the type");
eq([f.svSourceLabel("payment"), f.svSourceLabel("withdraw"), f.svSourceLabel("you")], ["From a payment", "Taken out", "Added by you"], "source labels");
ok(f.svShortDate("2026-10-03", NOW) === "3 Oct" && f.svShortDate("2025-12-31", NOW) === "31 Dec 2025" && f.svShortDate("", NOW) === "", "short dates; the year only when it is not this year");
ok(f.svDestLabel("Free") === "Free savings" && f.svDestLabel("Emergency") === "Emergency fund" && f.svDestLabel("New Phone") === "New Phone", "destination labels");

// ---- needs a home ----
eq(f.svNeedsHome({}), null, "not sent -> hidden");
eq(f.svNeedsHome({ needsHome: { amount: 0, count: 0, entries: [] } }), null, "nothing waiting -> hidden");
const nh = f.svNeedsHome({ needsHome: { amount: 4000, count: 2, entries: [{ row: 4, amount: 1500 }, { row: 7, amount: 2500 }] } });
ok(nh.amount === 4000 && nh.count === 2 && nh.entries.length === 2, "needs-home passes through");
ok(f.svNeedsHome({ needsHome: { entries: [{ amount: 100 }, { amount: 50 }] } }).amount === 150, "amount missing -> summed from the entries");
ok(f.svNeedsHome({ needsHome: { amount: 100 } }).entries.length === 0, "entries missing -> empty list, no crash");

// ---- buckets, destinations, a goal's own entries ----
const s1 = {
  emergency: 20000, emergencyTarget: 90000, free: 2000,
  goals: [
    { name: "CC Buffer", type: "Recurring", status: "Active", saved: 4000, target: 6000 },
    { name: "New Phone", type: "OneTime", status: "Active", saved: 14000, target: 40000 },
    { name: "Old thing", type: "OneTime", status: "Done", saved: 0, target: 100 },
    { name: "Trip", type: "OneTime", status: "Active", saved: 0, target: 9000 }
  ]
};
eq(f.svDestOptions(s1), ["Emergency", "New Phone", "Trip", "CC Buffer", "Free"], "destinations: Emergency, goals, CC Buffer, Free (finished goals left out)");
ok(f.svBucket(s1, "Emergency").kind === "emergency" && f.svBucket(s1, "Free").saved === 2000, "Emergency and Free open a page");
ok(f.svBucket(s1, "CC Buffer").kind === "recurring" && f.svBucket(s1, "New Phone").kind === "goal", "CC Buffer is recurring (no edit / bought), a goal is a goal");
ok(f.svBucket(s1, "Old thing") === null && f.svBucket(s1, "nope") === null && f.svBucket(null, "Free") === null, "a finished or unknown goal has no page");
eq(f.svGoalEntries([{ row: 1, date: "2026-10-01", destination: "Trip" }, { row: 2, date: "2026-10-05", destination: "New Phone" }, { row: 3, date: "2026-10-09", destination: "New Phone" }], "New Phone").map((e) => e.row), [3, 2], "a goal's own entries, newest first");
eq(f.svGoalEntries(undefined, "x"), [], "no entries -> empty");

// ---- Add savings: 'I will choose' rows ----
eq(f.svManualCheck([{ destination: "Emergency", amount: "600" }, { destination: "Free", amount: "400" }], 1000), { ok: true, rows: [{ destination: "Emergency", amount: 600 }, { destination: "Free", amount: 400 }] }, "rows that add up are accepted");
eq(f.svManualCheck([{ destination: "Emergency", amount: "600" }, { destination: "Free", amount: "" }], 1000), { ok: true, rows: [{ destination: "Emergency", amount: 600 }, { destination: "Free", amount: 400 }] }, "an empty row takes the rest");
ok(f.svManualCheck([{ destination: "Emergency", amount: "1000" }, { destination: "Free", amount: "" }], 1000).ok === false, "nothing left for the empty row is refused");
ok(f.svManualCheck([{ destination: "Emergency", amount: "600" }, { destination: "Free", amount: "300" }], 1000).ok === false, "rows that do not add up are refused");
ok(/not .?.?1,000/.test(f.svManualCheck([{ destination: "Emergency", amount: "600" }, { destination: "Free", amount: "300" }], 1000).error), "...with the totals in the message");
ok(f.svManualCheck([{ destination: "Emergency", amount: "0" }, { destination: "Free", amount: "1000" }], 1000).ok === false, "a zero row is refused");
ok(f.svManualCheck([], 1000).ok === false && f.svManualCheck([{ destination: "Free", amount: "5" }], 0).ok === false, "no rows / no amount are refused");
ok(f.svManualLeftText([{ amount: "600" }, { amount: "" }], 1000) === "₹400 will go in the empty row.", "left-over text");
ok(f.svManualLeftText([{ amount: "600" }, { amount: "400" }], 1000) === "Adds up to ₹1,000." && /not/.test(f.svManualLeftText([{ amount: "600" }, { amount: "300" }], 1000)), "adds-up text");
eq(f.svPreviewRows({ emergency: 700, ccBuffer: 200, goal: 0, goalName: "New Phone", free: 100 }, "CC Buffer").map((r) => r.label + "=" + r.amount), ["Emergency fund=700", "CC Buffer=200", "Free savings=100"], "split preview rows skip empty parts");
eq(f.svPreviewRows(null), [], "no preview -> no rows");

// ---- the markup / wiring the New look relies on ----
ok(/APP_VERSION = "2026-10-17-09"/.test(html) && /Savings screen is redesigned/.test(html), "version bumped and the changelog mentions the Savings screen");
ok(/id="savingsNew" style="display:none"/.test(html), "the new screen is hidden by default (switch off = never shown)");
ok(/:root\[data-look="new"\] #savingsContent > \.sv-old \{ display: none !important; \}/.test(html), "old markup is hidden only in the New look");
ok(["savingsCarouselDots", "savingsDetailList", "addGoalToggleButton", "logSavingToggleButton", "recentActivityHeader", "recentActivityDetail"].every((id) => new RegExp('id="' + id + '"[^>]*class="[^"]*sv-old|class="[^"]*sv-old[^"]*"[^>]*id="' + id + '"').test(html)), "every old Savings control is marked sv-old");
ok(/if \(finLookOn\(\)\) \{ renderSavingsNew\(s\); return; \}/.test(html), "renderSavingsGoals only goes to the new screen with the switch on");
ok(/function renderCarousel\(s\) \{\s*if \(finLookOn\(\)\) return;/.test(html) && /function renderSavingsDetailList\(s\) \{\s*if \(finLookOn\(\)\) \{ renderSavingsNew\(s\); return; \}/.test(html), "the older renderers step aside only with the switch on");
ok(/updateSavingsGoal/.test(html) && /case "updateSavingsGoal": return demoUpdateGoal/.test(html), "Demo Mode knows updateSavingsGoal");
ok(/"deleteSavingsEntry", "addSavingsGoal", "updateSavingsGoal"/.test(html), "updateSavingsGoal counts as a saving action for the fast-views guard");
ok(/targetDate: targetDate \? String\(targetDate\) : ""/.test(html) && /thisMonthSaved: monthlySaved\[5\]\.saved/.test(html) && /needsHome: needsHome/.test(html) && /source: entrySource\(e\)/.test(html), "Demo Mode produces the new fields");

// ---- review fixes (2026-10-17) ----
ok(/const req = \{ action: "updateSavingsGoal"[^\n]*\n\s*if \(dateChanged\) req\.targetDate/.test(html), "Edit goal sends targetDate only when it changed");
ok(/"\(closed goal\)"|\(closed goal\)/.test(html) && /d === currentDest \? " selected"/.test(html), "an entry's current destination is always listed and selected");
ok(/if \(finLookOn\(\)\) bindConfirmAction\(deleteBtn, deleteEntry\)/.test(html), "New look: deleting an entry needs a second tap");
ok(/:root\[data-look="new"\] \.sv-sec \{/.test(html), ".sv-sec headings are styled");
ok(/goal met" : ", goal not met"/.test(html), "chart aria-label says met / not met");
ok(/svQueueReopen\(pre, text, 0\)/.test(html), "a failed save with another sheet open is queued, not lost");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
