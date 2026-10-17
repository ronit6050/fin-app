// backend/tests/savingsTimezone.test.js
//
// Plain English: the new server runs in UTC (London-style time), but the Firestore sheet stores "1 October"
// as midnight INDIA time. If the Savings maths looked at the month in the server's own zone, anything saved on
// the 1st would land in the previous month, and for the first 5.5 hours of every month "this month" would be
// wrong. This file runs the SAME checks under three computer time zones (UTC, India, New York), and also covers:
// goal edit with an already-past deadline, needsHome never exceeding what is in Free, and the exact
// "months left" rule the phone must copy. All data invented.
//
// Run with: node backend/tests/savingsTimezone.test.js

const { spawnSync } = require("child_process");

// Parent: re-run this same file under each time zone.
if(!process.env.SAV_TZ_CHILD){
  let bad = false;
  ["UTC", "Asia/Kolkata", "America/New_York"].forEach(function(tz){
    console.log("\n===== process time zone: " + tz + " =====");
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, SAV_TZ_CHILD: "1" }), stdio: "inherit" });
    if(r.status !== 0) bad = true;
  });
  if(bad){ console.log("\nSome time-zone runs FAILED"); process.exit(1); }
  console.log("\nAll time-zone runs passed.");
  process.exit(0);
}

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");
const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "settings.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "splits.js", "DebtAdvisor.js"
];
const w = makeWorld(FILES);
const S = w.sb;
const atIn = (sb, iso) => vm.runInContext("new Date(" + new Date(iso).getTime() + ")", sb); // an exact moment, inside the sandbox
const at = (iso) => atIn(S, iso);
const row = (iso, amt, type, dest) => [at(iso), amt, type || "manual", "", dest || "Free"];
const NOW = at("2026-10-17T12:00:00+05:30");

console.log("process TZ = " + process.env.TZ);

console.log("\n--- 1. Month edges (India time) ---");
{
  const rows = [
    row("2026-10-01T00:00:00+05:30", 100),   // first instant of October in India
    row("2026-10-31T23:30:00+05:30", 10),    // last half hour of October in India
    row("2026-09-30T23:59:00+05:30", 1000),  // September
    row("2026-11-01T00:00:00+05:30", 5000)   // November
  ];
  assert(S.savingsMonthNet_(rows, 2026, 10) === 110, "October holds the 1st-midnight and the 31st-23:30 entries only (got " + S.savingsMonthNet_(rows, 2026, 10) + ")");
  assert(S.savingsMonthNet_(rows, 2026, 9) === 1000, "September holds only its own");
  assert(S.savingsMonthNet_(rows, 2026, 11) === 5000, "November holds only its own");
  const o = S.computeSavingsOverview_(rows, 0, NOW);
  assert(o.thisMonthSaved === 110, "overview thisMonthSaved agrees (" + o.thisMonthSaved + ")");
  assert(o.monthlySaved[5].saved === 110 && o.monthlySaved[4].saved === 1000, "monthlySaved: this month 110, last month 1000");
  assert(o.monthlySaved[5].year === 2026 && o.monthlySaved[5].month === 10, "last item is Oct 2026");
}

console.log("\n--- 2. Year rollover ---");
{
  const rows = [row("2026-12-31T23:30:00+05:30", 700), row("2027-01-01T00:00:00+05:30", 300)];
  assert(S.savingsMonthNet_(rows, 2026, 12) === 700 && S.savingsMonthNet_(rows, 2027, 1) === 300, "Dec 31 23:30 is December, Jan 1 00:00 is January");
  const o = S.computeSavingsOverview_(rows, 0, at("2027-01-15T10:00:00+05:30"));
  const list = o.monthlySaved.map((m) => m.year + "-" + m.month).join(",");
  assert(list === "2026-8,2026-9,2026-10,2026-11,2026-12,2027-1", "six months roll over the year correctly (" + list + ")");
  assert(o.thisMonthSaved === 300 && o.monthlySaved[4].saved === 700, "Jan = 300, Dec = 700");
}

console.log("\n--- 3. 'Now' at 00:10 India time on the 1st ---");
{
  const rows = [row("2026-11-01T00:00:00+05:30", 400), row("2026-10-31T20:00:00+05:30", 50)];
  const o = S.computeSavingsOverview_(rows, 1000, at("2026-11-01T00:10:00+05:30")); // = 31 Oct 18:40 UTC
  assert(o.monthlySaved[5].year === 2026 && o.monthlySaved[5].month === 11, "current month is November, not October (got " + o.monthlySaved[5].month + ")");
  assert(o.thisMonthSaved === 400 && o.monthlySaved[4].saved === 50, "this month 400, last month 50");
  const o2 = S.computeSavingsOverview_(rows, 1000, at("2026-10-31T23:50:00+05:30"));
  assert(o2.monthlySaved[5].month === 10, "23:50 on the 31st is still October");
  assert(S.goalMonthsLeft_("2027-01-01", at("2026-11-01T00:10:00+05:30")) === 2, "1 Nov 00:10 IST -> 1 Jan = 2 months");
}

console.log("\n--- 4. Same rule for Analysis 'saved' ---");
{
  const wa = makeWorld(FILES);
  wa.addSheet("Savings", [["Date", "Amount", "Type", "Note", "Destination"], [atIn(wa.sb, "2026-10-01T00:00:00+05:30"), 250, "manual", "", "Free"]]);
  wa.addSheet("Transactions", [["Date", "Time", "Bank", "Type", "Mode", "Amount"]]);
  wa.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category"]]);
  wa.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  const a = wa.sb.getMonthlyAnalysis(2026, 10);
  assert(a.saved === 250, "getMonthlyAnalysis(2026,10).saved sees the entry made at midnight on 1 Oct IST (got " + a.saved + ")");
  assert(wa.sb.getMonthlyAnalysis(2026, 9).saved === 0, "and September does not");
}

console.log("\n--- 5. goalMonthsLeft_: the exact rule + 6 worked examples (today = 2026-10-17) ---");
{
  const cases = [
    ["2027-03-15", 4],  // 5 months apart, day 15 < 17  -> 4
    ["2027-03-17", 5],  // same day-of-month             -> 5
    ["2027-03-20", 5],  // day later than today's        -> 5
    ["2026-10-30", 1],  // 0 months -> minimum 1
    ["2026-11-10", 1],  // 1 - 1 = 0 -> minimum 1
    ["2027-10-17", 12]  // exactly a year
  ];
  cases.forEach(function(c){ assert(S.goalMonthsLeft_(c[0], NOW) === c[1], c[0] + " -> " + c[1] + " (got " + S.goalMonthsLeft_(c[0], NOW) + ")"); });
  assert(S.goalMonthsLeft_("nonsense", NOW) === null, "an unreadable date gives null");
}

console.log("\n--- 6. needsHome is capped at what is still in Free ---");
{
  let o = S.computeSavingsOverview_([row("2026-10-02T10:00:00+05:30", 1000, "payment"), row("2026-10-03T10:00:00+05:30", 2500, "payment"), row("2026-10-04T10:00:00+05:30", -3000, "withdraw")], 0, NOW);
  assert(o.needsHome.amount === 500 && o.needsHome.count === 1, "amount capped to Free (500), one entry (got " + o.needsHome.amount + "/" + o.needsHome.count + ")");
  assert(o.needsHome.entries[0].amount === 500 && o.needsHome.entries[0].fullAmount === 2500 && o.needsHome.entries[0].row === 3, "newest listed with covered 500, fullAmount 2500, row kept");
  o = S.computeSavingsOverview_([row("2026-10-02T10:00:00+05:30", 1000, "payment"), row("2026-10-03T10:00:00+05:30", -1000, "withdraw")], 0, NOW);
  assert(o.needsHome.amount === 0 && o.needsHome.count === 0 && o.needsHome.entries.length === 0, "Free balance 0 -> nothing waiting");
  o = S.computeSavingsOverview_([row("2026-10-02T10:00:00+05:30", 1000, "payment"), row("2026-10-03T10:00:00+05:30", -1500, "withdraw")], 0, NOW);
  assert(o.needsHome.amount === 0 && o.needsHome.count === 0, "negative Free -> nothing waiting");
  o = S.computeSavingsOverview_([row("2026-10-02T10:00:00+05:30", 1000, "payment"), row("2026-10-03T10:00:00+05:30", 2500, "payment"), row("2026-10-04T10:00:00+05:30", 9000, "manual", "Emergency")], 0, NOW);
  assert(o.needsHome.amount === 3500 && o.needsHome.count === 2 && o.needsHome.entries[0].amount === 2500 && o.needsHome.entries[1].amount === 1000, "enough in Free -> unchanged, newest first");
  o = S.computeSavingsOverview_([row("2026-10-02T10:00:00+05:30", 1000, "payment"), row("2026-10-03T10:00:00+05:30", 2500, "payment"), row("2026-10-04T10:00:00+05:30", -2000, "withdraw")], 0, NOW);
  assert(o.needsHome.amount === 1500 && o.needsHome.entries.length === 1 && o.needsHome.entries[0].amount === 1500, "Free holds 1500 -> only the newest, trimmed to 1500");
}

console.log("\n--- 7. Editing a goal whose saved date has already passed ---");
{
  const wg = makeWorld(FILES);
  wg.addSheet("Savings", [["Date", "Amount", "Type", "Note", "Destination"]]);
  wg.addSheet("Goals", [["Name", "Type", "Target", "Status", "Priority", "DateAdded", "TargetDate"], ["Trip", "OneTime", 9000, "Active", true, "2020-01-01", "2020-06-01"]]);
  const G = wg.sheets.Goals;
  const r1 = wg.sb.updateGoal(2, 12000, "2020-06-01");
  assert(r1.ok === true && G.rows[1][2] === 12000 && G.rows[1][6] === "2020-06-01", "amount edit that re-sends the same (past) date is accepted and keeps the date");
  const r2 = wg.sb.updateGoal(2, 13000, "2020-07-01");
  assert(r2.ok === false && /past/i.test(r2.error) && G.rows[1][2] === 12000 && G.rows[1][6] === "2020-06-01", "a NEW date in the past is still refused, nothing written");
  const r3 = wg.sb.updateGoal(2, 14000, "2099-01-01");
  assert(r3.ok === true && G.rows[1][6] === "2099-01-01", "a new future date works");
  const r4 = wg.sb.updateGoal(2, undefined, "");
  assert(r4.ok === true && G.rows[1][6] === "", "clearing still works");
  const r5 = wg.sb.updateGoal(2, 15000, "2020-06-01");
  assert(r5.ok === false, "after clearing, the old past date is no longer 'current', so it is refused");
}

console.log(process.exitCode ? "\nSome checks FAILED" : "\nAll checks passed.");
