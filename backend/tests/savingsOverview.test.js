// backend/tests/savingsOverview.test.js
//
// Plain English: the redesigned Savings tab needs a few new numbers (total saved, this month vs your
// goal, the last 6 months, "payments waiting for a home", goal deadlines and "how much per month").
// This checks each one with invented data, including the awkward cases: nothing saved yet, only this
// month, withdrawals, months with no entries, short history, legacy rows, and goal deadlines in the
// past. All data is invented.
//
// Run with: node backend/tests/savingsOverview.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "settings.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "splits.js", "DebtAdvisor.js"
];
const SAV_HEADER = ["Date", "Amount", "Type", "Note", "Destination"];
const GOALS_HEADER6 = ["Name", "Type", "Target", "Status", "Priority", "DateAdded"];
const GOALS_HEADER7 = GOALS_HEADER6.concat(["TargetDate"]);

const NOW = new Date();
// a date `back` calendar months before this month, on the given day (kept small so it always exists)
const mDate = (back, day) => new Date(NOW.getFullYear(), NOW.getMonth() - back, day || 5, 0, 0, 0, 0);
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const nativeDate = (w, d) => vm.runInContext("new Date(" + d.getTime() + ")", w.sb);

function world(savings, goals, goalsHeader, settings){
  const w = makeWorld(FILES);
  const rows = (savings || []).map((r) => [nativeDate(w, r[0]), r[1], r[2], r[3], r[4]]);
  w.addSheet("Savings", [SAV_HEADER].concat(rows));
  w.addSheet("Goals", [goalsHeader || GOALS_HEADER7].concat(goals || []));
  w.addSheet("Transactions", [["Date", "Time", "Bank", "Type", "Mode", "Amount"]]);
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Debts", [["Date","Person","Type","Amount","Note","DueDate","Status","SettledDate"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  if(settings){
    Object.keys(settings).forEach((k) => { w.props[k] = String(settings[k]); });
  }
  return w;
}
const breakdown = (w) => w.sb.getSavingsBreakdown();

console.log("\n--- 1. Empty Savings sheet ---");
{
  const w = world([], [], null, { SETTING_MONTHLY_SAVE_GOAL: 5000, SETTING_MONTHLY_EXPENSES: 20000 });
  const b = breakdown(w);
  assert(b.totalSaved === 0, "totalSaved is 0");
  assert(b.monthlyGoal === 5000 && b.monthlyExpenses === 20000, "monthlyGoal / monthlyExpenses come from Settings");
  assert(b.thisMonthSaved === 0, "thisMonthSaved is 0");
  assert(b.monthlySaved.length === 6 && b.monthlySaved.every((m) => m.saved === 0), "monthlySaved has 6 months, all 0");
  assert(b.monthlySaved[5].year === NOW.getFullYear() && b.monthlySaved[5].month === NOW.getMonth() + 1, "the LAST item is the current month");
  assert(b.goalMet.met === 0 && b.goalMet.of === 0, "goalMet is 0 of 0 with no history");
  assert(b.paceMonthly === 5000, "pace falls back to the monthly goal when there is no history");
  assert(b.needsHome.amount === 0 && b.needsHome.count === 0 && b.needsHome.entries.length === 0, "needsHome is empty");
}

console.log("\n--- 2. Entries only this month, with a withdrawal ---");
{
  const w = world([
    [mDate(0, 1), 3000, "manual", "a", "Emergency"],
    [mDate(0, 2), 2000, "auto", "b", "Free"],
    [mDate(0, 3), -500, "withdraw", "c", "Free"]
  ], [], null, { SETTING_MONTHLY_SAVE_GOAL: 4000 });
  const b = breakdown(w);
  assert(b.thisMonthSaved === 4500, "this month = 3000 + 2000 - 500 (got " + b.thisMonthSaved + ")");
  assert(b.totalSaved === 4500, "totalSaved = 4500 (got " + b.totalSaved + ")");
  assert(b.monthlySaved[5].saved === 4500 && b.monthlySaved[4].saved === 0, "current month shows 4500, the month before 0");
  assert(b.goalMet.of === 0 && b.goalMet.met === 0, "no completed month after the first entry -> 0 of 0");
  assert(b.paceMonthly === 4000, "pace falls back to the goal (got " + b.paceMonthly + ")");
}

console.log("\n--- 3. Same rule as Analysis 'Saved' ---");
{
  const w = world([
    [mDate(0, 1), 3000, "manual", "a", "Emergency"],
    [mDate(0, 2), -700, "withdraw", "b", "Emergency"],
    [mDate(1, 20), 9999, "manual", "last month", "Free"]
  ]);
  const a = w.sb.getMonthlyAnalysis(NOW.getFullYear(), NOW.getMonth() + 1);
  assert(a.saved === breakdown(w).thisMonthSaved && a.saved === 2300, "Analysis.saved equals thisMonthSaved (" + a.saved + ")");
}

console.log("\n--- 4. Six months, a month with no entries, goalMet and pace ---");
{
  // goal 1000. Completed months: 3 ago = 1500 (met), 2 ago = nothing (missed), 1 ago = 1000 (met, equal counts).
  const w = world([
    [mDate(5, 5), 300, "manual", "old", "Free"],
    [mDate(3, 5), 1500, "manual", "x", "Free"],
    [mDate(1, 5), 1000, "manual", "y", "Free"],
    [mDate(0, 5), 200, "manual", "z", "Free"]
  ], [], null, { SETTING_MONTHLY_SAVE_GOAL: 1000 });
  const b = breakdown(w);
  assert(b.monthlySaved.map((m) => m.saved).join(",") === "300,0,1500,0,1000,200", "6 months oldest first, empty months present as 0 (got " + b.monthlySaved.map((m) => m.saved).join(",") + ")");
  assert(b.goalMet.met === 2 && b.goalMet.of === 3, "goalMet is 2 of 3 (got " + b.goalMet.met + " of " + b.goalMet.of + ")");
  assert(b.paceMonthly === Math.round((1500 + 0 + 1000) / 3), "pace = average of the 3 completed months (got " + b.paceMonthly + ")");
  // the first-ever entry was 5 months ago, so a month 7 ago does not exist in the list at all
  assert(b.monthlySaved.length === 6, "still exactly 6 items");
}

console.log("\n--- 5. History shorter than 3 months ---");
{
  const w = world([
    [mDate(2, 5), 1200, "manual", "x", "Free"],
    [mDate(0, 5), 50, "manual", "y", "Free"]
  ], [], null, { SETTING_MONTHLY_SAVE_GOAL: 1000 });
  const b = breakdown(w);
  // first entry 2 months ago: completed months counted = 2 ago and 1 ago (the one 3 ago is before the first entry)
  assert(b.goalMet.of === 2 && b.goalMet.met === 1, "of is 2 (month before the first entry not counted), met 1 (got " + b.goalMet.met + " of " + b.goalMet.of + ")");
  assert(b.paceMonthly === 600, "pace = (1200 + 0) / 2 = 600 (got " + b.paceMonthly + ")");
}

console.log("\n--- 6. Goal of 0 and net-negative history ---");
{
  const w0 = world([[mDate(2, 5), 800, "manual", "x", "Free"]], [], null, { SETTING_MONTHLY_SAVE_GOAL: 0 });
  // getSettings() treats an unset/0 goal as the default 1000, so exercise the pure helper for a true 0 goal
  const o0 = w0.sb.computeSavingsOverview_([[nativeDate(w0, mDate(2, 5)), 800, "manual", "x", "Free"]], 0, NOW);
  assert(o0.goalMet.met === 0 && o0.goalMet.of === 0, "monthlyGoal 0 -> goalMet 0 of 0");
  assert(o0.paceMonthly === Math.round(800 / 2), "pace with no goal is still the average (400)");
  const oNeg = w0.sb.computeSavingsOverview_([[nativeDate(w0, mDate(2, 5)), -200, "withdraw", "x", "Free"]], 700, NOW);
  assert(oNeg.paceMonthly === 700, "a zero-or-negative average falls back to the goal");
}

console.log("\n--- 7. needsHome ---");
{
  const w = world([
    [mDate(1, 3), 1000, "payment", "old payment", "Free"],
    [mDate(0, 2), 2500, "payment", "new payment", "Free"],
    [mDate(0, 3), 700, "auto", "legacy auto row", "Free"],       // legacy: must NOT count
    [mDate(0, 4), 400, "manual", "by hand", "Free"],             // by hand: must NOT count
    [mDate(0, 5), 900, "payment", "already homed", "Emergency"], // payment but not in Free: must NOT count
    [mDate(0, 6), -300, "withdraw", "out", "Free"]
  ]);
  const nh = breakdown(w).needsHome;
  assert(nh.amount === 3500 && nh.count === 2, "only the 2 payment-type Free entries count (amount " + nh.amount + ", count " + nh.count + ")");
  assert(nh.entries.length === 2 && nh.entries[0].note === "new payment" && nh.entries[1].note === "old payment", "newest first");
  assert(nh.entries[0].row === 3 && nh.entries[0].amount === 2500 && nh.entries[0].date === iso(mDate(0, 2)), "entry carries row, amount and a yyyy-MM-dd date");

  // moving the new payment to Emergency makes it disappear from needsHome, and keeps its Type
  const r = w.sb.updateSavingsEntry(3, 2500, "new payment", "Emergency");
  assert(r.ok === true, "moving to Emergency is accepted");
  assert(w.sheets.Savings.rows[2][2] === "payment", "the entry keeps its Type (payment)");
  const nh2 = breakdown(w).needsHome;
  assert(nh2.count === 1 && nh2.amount === 1000, "after the move only the older one is left (count " + nh2.count + ")");

  // cap of 20 entries, totals still cover all
  const many = [];
  for(let i = 0; i < 25; i++) many.push([mDate(0, 1), 10, "payment", "p" + i, "Free"]);
  const wm = world(many);
  const nhm = breakdown(wm).needsHome;
  assert(nhm.entries.length === 20 && nhm.count === 25 && nhm.amount === 250, "entries capped at 20, count/amount cover all 25");
}

console.log("\n--- 8. recentEntries.source ---");
{
  const w = world([
    [mDate(0, 1), 100, "payment", "", "Free"],
    [mDate(0, 2), -50, "withdraw", "", "Free"],
    [mDate(0, 3), -20, "manual", "", "Free"],      // negative amount counts as a withdrawal
    [mDate(0, 4), 80, "manual", "", "Free"],
    [mDate(0, 5), 60, "auto", "", "Free"],
    [mDate(0, 6), 10, "", "", "Free"]
  ]);
  const bySource = {};
  breakdown(w).recentEntries.forEach((e) => { bySource[e.amount] = e.source; });
  assert(bySource[100] === "payment", "payment -> payment");
  assert(bySource[-50] === "withdraw" && bySource[-20] === "withdraw", "withdraw type or negative amount -> withdraw");
  assert(bySource[80] === "you" && bySource[60] === "you" && bySource[10] === "you", "everything else -> you");
  const first = breakdown(w).recentEntries[0];
  assert(["type", "note", "destination", "row", "date", "amount"].every((k) => k in first), "existing fields are still there");
}

console.log("\n--- 9. Payment-type rows are written and undone ---");
{
  const w = world([[mDate(1, 1), 50, "manual", "unrelated", "Free"]]);
  const today = iso(NOW);
  const logged = w.sb.autoLogSaving(today, 5000, "moved to piggy bank");
  assert(logged.logged === true, "autoLogSaving logs");
  const last = w.sheets.Savings.rows[w.sheets.Savings.rows.length - 1];
  assert(last[2] === "payment" && last[4] === "Free", 'it writes Type "payment" into Free (got ' + last[2] + ")");
  assert(breakdown(w).needsHome.count === 1, "so it shows up as needing a home");
  const undone = w.sb.undoAutoLogSaving(today, 5000, "moved to piggy bank");
  assert(undone.removed === true && breakdown(w).needsHome.count === 0, "undo removes a payment-type row");

  // legacy "auto" row still undoable
  const w2 = world([[NOW, 3000, "auto", "old saving", "Free"]]);
  const und2 = w2.sb.undoAutoLogSaving(iso(NOW), 3000, "old saving");
  assert(und2.removed === true, 'undo still removes a legacy "auto" row');
  assert(breakdown(w2).needsHome.count === 0, "legacy auto rows never appear in needsHome");
}

console.log("\n--- 10. Goals with / without a target date ---");
{
  const future = new Date(NOW.getFullYear(), NOW.getMonth() + 5, NOW.getDate() > 28 ? 28 : NOW.getDate());
  const w = world([
    [mDate(1, 5), 4000, "manual", "x", "Phone"],
    [mDate(1, 6), 10000, "manual", "y", "Bike"],
    [mDate(1, 7), 500, "manual", "z", "CC Buffer"]
  ], [
    ["Phone", "OneTime", 20000, "Active", true, iso(NOW), iso(future)],
    ["Laptop", "OneTime", 50000, "Active", false, iso(NOW)],               // old-style row: no column G at all
    ["Bike", "OneTime", 10000, "Active", false, iso(NOW), iso(future)],    // fully funded
    ["Done one", "OneTime", 8000, "Done", false, iso(NOW), iso(future)],
    ["CC Buffer", "Recurring", "", "Active", false, iso(NOW), iso(future)]
  ]);
  const goals = {};
  breakdown(w).goals.forEach((g) => { goals[g.name] = g; });
  assert(goals.Phone.targetDate === iso(future), "Phone shows its target date");
  assert(goals.Phone.monthsLeft === 5, "Phone has 5 whole months left (got " + goals.Phone.monthsLeft + ")");
  assert(goals.Phone.monthlyNeeded === Math.ceil(16000 / 5), "monthlyNeeded = ceil(remaining / months) = 3200 (got " + goals.Phone.monthlyNeeded + ")");
  assert(goals.Laptop.targetDate === "" && goals.Laptop.monthsLeft === null && goals.Laptop.monthlyNeeded === null, "no date -> blank date, null months / needed");
  assert(goals.Bike.monthsLeft === 5 && goals.Bike.monthlyNeeded === null, "nothing left to save -> monthlyNeeded null");
  assert(goals["Done one"].monthsLeft === null && goals["Done one"].monthlyNeeded === null, "a Done goal has no plan numbers");
  assert(goals["CC Buffer"].monthsLeft === null && goals["CC Buffer"].monthlyNeeded === null, "a Recurring goal has no plan numbers");
  assert(breakdown(w).totalSaved === 4000 + 10000 + 500, "totalSaved includes active goals and CC Buffer (got " + breakdown(w).totalSaved + ")");

  // minimum of 1 month
  const soon = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  const ws = world([], [["Soon", "OneTime", 900, "Active", true, iso(NOW), iso(soon)]]);
  const g = breakdown(ws).goals[0];
  assert(g.monthsLeft === 1 && g.monthlyNeeded === 900, "a deadline today still counts as 1 month (got " + g.monthsLeft + ")");

  // a date stored by Sheets as a real date still reads fine
  const wd = world([], [["Phone", "OneTime", 3000, "Active", true, iso(NOW)]]);
  wd.sheets.Goals.rows[1][6] = nativeDate(wd, future);
  assert(breakdown(wd).goals[0].targetDate === iso(future), "a real date cell is turned back into yyyy-MM-dd");

  // completed totals of a Done goal aren't in totalSaved
  assert(!("Done one" in {}) && breakdown(w).totalSaved === 14500, "Done goals are left out of totalSaved");
}

console.log("\n--- 11. addSavingsGoal with a target date ---");
{
  const future = new Date(NOW.getFullYear(), NOW.getMonth() + 3, 1);
  const w = world([], [], GOALS_HEADER6);                      // an existing OLD Goals sheet (6 columns)
  w.sheets.Goals.rows = [GOALS_HEADER6.slice()];
  const bad = w.sb.addGoal("Trip", "OneTime", 9000, "2020-01-01");
  assert(bad.ok === false && /past/i.test(bad.error), "a past date is rejected");
  const bad2 = w.sb.addGoal("Trip", "OneTime", 9000, "2026-02-31");
  assert(bad2.ok === false, "an impossible date is rejected");
  const bad3 = w.sb.addGoal("Trip", "OneTime", 9000, "next year");
  assert(bad3.ok === false, "a non-date is rejected");
  assert(w.sheets.Goals.rows.length === 1, "nothing was written by the rejected calls");

  const ok = w.sb.addGoal("Trip", "OneTime", 9000, iso(future));
  assert(ok.ok === true && w.sheets.Goals.rows.length === 2, "a future date is accepted");
  assert(w.sheets.Goals.rows[0][6] === "TargetDate", "the old sheet got its TargetDate header automatically");
  assert(w.sheets.Goals.rows[1][6] === iso(future), "the date is stored in column G");
  const none = w.sb.addGoal("Gift", "OneTime", 1000, "");
  assert(none.ok === true && w.sheets.Goals.rows[2][6] === "", "a blank date means none");
  const noArg = w.sb.addGoal("Book", "OneTime", 300);
  assert(noArg.ok === true, "the old 3-argument call still works");

  // brand-new Goals sheet gets the header from the start
  const wn = makeWorld(FILES);
  wn.addSheet("Savings", [SAV_HEADER]);
  wn.sb.addGoal("First", "OneTime", 100);
  assert(wn.sheets.Goals.rows[0].join(",") === GOALS_HEADER7.join(","), "a newly created Goals sheet has the TargetDate header");
}

console.log("\n--- 12. updateSavingsGoal validation ---");
{
  const future = new Date(NOW.getFullYear(), NOW.getMonth() + 4, 1);
  const w = world([], [
    ["Phone", "OneTime", 20000, "Active", true, iso(NOW), ""],
    ["CC Buffer", "Recurring", "", "Active", false, iso(NOW), ""]
  ]);
  const G = w.sheets.Goals;
  assert(w.sb.updateGoal(1, 5000).ok === false, "header row is not a goal row");
  assert(w.sb.updateGoal(9, 5000).ok === false, "a row past the end is refused");
  assert(w.sb.updateGoal("2", 5000).ok === false, "a non-integer row is refused");
  assert(w.sb.updateGoal(3, 5000).ok === false, "a Recurring goal can't be changed");
  assert(w.sb.updateGoal(2).ok === false, "nothing to change is refused");
  assert(w.sb.updateGoal(2, 0).ok === false && w.sb.updateGoal(2, -5).ok === false && w.sb.updateGoal(2, "abc").ok === false, "target must be > 0");
  assert(w.sb.updateGoal(2, undefined, "2020-01-01").ok === false, "a past date is refused");
  assert(G.rows[1][2] === 20000 && G.rows[1][6] === "", "nothing was written by refused calls");

  const r1 = w.sb.updateGoal(2, 25000);
  assert(r1.ok === true && G.rows[1][2] === 25000 && G.rows[1][6] === "", "target-only change works and leaves the date alone");
  const r2 = w.sb.updateGoal(2, undefined, iso(future));
  assert(r2.ok === true && G.rows[1][6] === iso(future) && G.rows[1][2] === 25000, "date-only change works and leaves the target alone");
  const r3 = w.sb.updateGoal(2, 30000, "");
  assert(r3.ok === true && G.rows[1][2] === 30000 && G.rows[1][6] === "", 'targetDate "" clears the date');
  const r4 = w.sb.updateGoal(2, 31000, iso(future));
  assert(r4.ok === true && G.rows[1][2] === 31000 && G.rows[1][6] === iso(future), "both together work");
}

console.log("\n--- 13. updateSavingsEntry checks the destination ---");
{
  const w = world([[mDate(0, 1), 1000, "payment", "n", "Free"], [mDate(0, 2), 500, "manual", "legacy", "WishList"]],
    [["Phone", "OneTime", 20000, "Active", true, iso(NOW), ""]]);
  assert(w.sb.updateSavingsEntry(2, 1000, "n", "Phoen").ok === false, "an unknown destination (typo) is refused");
  assert(w.sheets.Savings.rows[1][4] === "Free", "and nothing changed");
  assert(w.sb.updateSavingsEntry(2, 1000, "n", "Phone").ok === true && w.sheets.Savings.rows[1][2] === "payment", "a real goal name is accepted and the Type is kept");
  assert(w.sb.updateSavingsEntry(3, 500, "edited note", "WishList").ok === true, "a legacy entry can still have its note edited without moving it");
}

console.log("\n--- 14. The action is routed and allowed ---");
{
  const fs = require("fs");
  const path = require("path");
  const pwa = fs.readFileSync(path.join(__dirname, "..", "PWA.js"), "utf8");
  assert(/data\.action === "updateSavingsGoal"/.test(pwa), "PWA.js routes updateSavingsGoal");
  assert(/addGoal\(data\.name, data\.type, data\.target, data\.targetDate\)/.test(pwa), "addSavingsGoal passes targetDate");
  const idx = fs.readFileSync(path.join(__dirname, "..", "..", "functions", "index.js"), "utf8");
  assert(/WRITE_ACTIONS[\s\S]*"updateSavingsGoal"/.test(idx), "functions/index.js allow-list has updateSavingsGoal");
  const r2 = fs.readFileSync(path.join(__dirname, "..", "v2route.js"), "utf8");
  assert(/"updateSavingsGoal"/.test(r2), "friends' action list has updateSavingsGoal");
  const vp = fs.readFileSync(path.join(__dirname, "..", "viewPublisher.js"), "utf8");
  assert(/"updateSavingsGoal"/.test(vp), "the screen publisher knows it changes data");
}

console.log(process.exitCode ? "\nSome checks FAILED" : "\nAll checks passed.");
