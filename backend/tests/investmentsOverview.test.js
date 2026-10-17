// backend/tests/investmentsOverview.test.js
//
// Plain English: the redesigned Investments tab shows what you have put in, this month against your goal, a tracker
// for each monthly SIP (paid / coming / overdue / paused), where the money sits, and the last 6 months. This checks
// each figure with invented data, plus every way of changing data: adding money (with the "same amount again?"
// warning), a sale, a holding with a SIP plan, pausing and resuming it, changing its amount, deleting an entry, and
// the one-time "start fresh". All data is invented.
//
// Run with: node backend/tests/investmentsOverview.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = ["category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "investmentInstruments.js", "settings.js", "PWA.js", "Logger.js"];
const INV_HEADER = ["Date", "Name", "Amount", "Note", "Kind"];
const INS_HEADER = ["Name", "Category", "SipAmount", "SipDay", "SipActive"];
const FE_HEADER = ["Type", "Amount", "Counterparty", "Confirmed", "Name"];

function world(inv, ins, fe, settings){
  const w = makeWorld(FILES);
  w.addSheet("Investments", [INV_HEADER].concat(inv || []));
  w.addSheet("InvestmentInstruments", [INS_HEADER].concat(ins || []));
  w.addSheet("FinancialEvents", [FE_HEADER].concat(fe || []));
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  if(settings) Object.keys(settings).forEach((k) => { w.props[k] = String(settings[k]); });
  return w;
}
const nowIn = (w, iso) => vm.runInContext("new Date('" + iso + "')", w.sb);
const overview = (w, iso) => w.sb.computeInvestmentsOverview_(
  w.sheets.Investments.rows.slice(1), w.sb.getInvestmentInstrumentsList().instruments, 9000, nowIn(w, iso || "2026-10-17T10:00:00+05:30"));
const rowsOf = (w, name) => w.sheets[name].rows;

const INS = [
  ["HDFC Nifty 50 Index Fund", "SIP", 3000, 10, "yes"],
  ["HDFC Mid Cap Fund", "SIP", 4000, 10, "yes"],
  ["Bandhan Small Cap (Money2Mgt SIP)", "SIP", 2000, 15, "yes"],
  ["Digital Gold", "Gold", "", "", ""],
  ["Tata Steel", "Stock", "", "", ""]
];

console.log("\n--- 1. Totals, this month, bars ---");
{
  const w = world([
    ["2026-08-11", "HDFC Nifty 50 Index Fund", 20000, "Starting Balance", ""],
    ["2026-08-11", "Digital Gold", 5000, "Starting Balance", ""],
    ["2026-09-10", "HDFC Mid Cap Fund", 4000, "mutual funds", "payment"],
    ["2026-10-10", "HDFC Mid Cap Fund", 4000, "mutual funds", "payment"],
    ["2026-10-01", "Tata Steel", 500, "", "manual"],
    ["2026-10-12", "Digital Gold", -1000, "Sale", "sale"]
  ], INS);
  const o = overview(w);
  assert(o.totalPutIn === 32500, "total put in = everything net of the sale (got " + o.totalPutIn + ")");
  assert(o.addedSinceStart === 7500, "added since start = 4000+4000+500-1000 (got " + o.addedSinceStart + ")");
  assert(o.thisMonth === 4500, "this month counts payments + hand-added, not the opening or the sale (got " + o.thisMonth + ")");
  assert(o.monthly.length === 6 && o.monthly[5].month === 10 && o.monthly[5].amount === 4500, "last bar is October = 4500");
  assert(o.monthly[4].month === 9 && o.monthly[4].amount === 4000, "September bar = 4000");
  assert(o.monthly.every((m) => m.amount >= 0), "no bar is negative");
  const gold = o.holdings.find((h) => h.name === "Digital Gold");
  assert(gold.putIn === 4000, "a sale lowers the holding (got " + gold.putIn + ")");
  assert(Math.abs(o.holdings.reduce((a, h) => a + h.share, 0) - 100) < 0.5, "shares add up to about 100%");
  assert(o.allocation.find((a) => a.category === "SIP").pct > 80, "SIP funds are the biggest slice");
}

console.log("\n--- 2. The 1st of the month at India midnight is that month ---");
{
  const w = world([["2026-10-01", "Tata Steel", 700, "", "manual"]], INS);
  w.sheets.Investments.rows[1][0] = nowIn(w, "2026-09-30T18:30:00Z");
  const o = overview(w, "2026-10-17T05:00:00Z");
  assert(o.thisMonth === 700, "a date at India midnight on 1 Oct counts in October (got " + o.thisMonth + ")");
}

console.log("\n--- 3. SIP tracker ---");
{
  const w = world([
    ["2026-08-17", "Bandhan Small Cap (Money2Mgt SIP)", 2000, "", "payment"],
    ["2026-09-15", "Bandhan Small Cap (Money2Mgt SIP)", 2000, "", "payment"],
    ["2026-10-10", "HDFC Mid Cap Fund", 4000, "", "payment"],
    ["2026-09-10", "HDFC Mid Cap Fund", 4000, "", "payment"]
  ], INS.map((r) => r.slice()));
  const o = overview(w, "2026-10-17T10:00:00+05:30");
  const by = (n) => o.sips.find((s) => s.name === n);
  const B = "Bandhan Small Cap (Money2Mgt SIP)";
  assert(by("HDFC Mid Cap Fund").status === "paid" && by("HDFC Mid Cap Fund").paidOn === "2026-10-10", "Mid Cap paid on 10 Oct");
  assert(by(B).status === "overdue" && by(B).daysLate === 2, "Bandhan (due 15th) is 2 days overdue on the 17th");
  assert(by("HDFC Nifty 50 Index Fund").status === "overdue" && by("HDFC Nifty 50 Index Fund").daysLate === 7, "Nifty (due 10th, nothing seen) overdue 7 days");
  assert(o.sipsActive === 3 && o.sipsPaid === 1 && o.sipsOverdue === 2, "counts: 3 active, 1 paid, 2 overdue");
  assert(o.sipCommitment === 9000, "active SIPs add up to 9000");
  assert(by(B).trackedMonths === 2 && by(B).paidMonths === 2, "Bandhan: 2 of 2 completed months paid");
  const early = overview(w, "2026-10-12T10:00:00+05:30");
  assert(early.sips.find((s) => s.name === B).status === "upcoming" && early.sips.find((s) => s.name === B).daysUntil === 3, "on the 12th Bandhan is coming in 3 days");
  const grace = overview(w, "2026-10-11T10:00:00+05:30");
  assert(grace.sips.find((s) => s.name === "HDFC Nifty 50 Index Fund").status === "upcoming", "the day after the due day is still not overdue");
}

console.log("\n--- 4. Paused SIP ---");
{
  const ins = INS.map((r) => r.slice()); ins[0][4] = "no";
  const w = world([], ins);
  const o = overview(w);
  assert(o.sips.find((s) => s.name === "HDFC Nifty 50 Index Fund").status === "paused", "a paused SIP shows paused");
  assert(o.sipsActive === 2 && o.sipCommitment === 6000, "a paused SIP is not counted in the commitment");
  assert(o.hasData === false, "no rows = hasData false");
}

console.log("\n--- 5. Add money, repeat warning, dates ---");
{
  const w = world([["2026-10-15", "Tata Steel", 500, "", "manual"]], INS);
  const same = w.sb.logInvestmentFromApp(500, "Tata Steel", { date: "2026-10-16" });
  assert(same.ok === false && same.duplicate === true, "same holding + same amount within 5 days is flagged, not saved");
  assert(rowsOf(w, "Investments").length === 2, "nothing was added by the warning");
  const forced = w.sb.logInvestmentFromApp(500, "Tata Steel", { date: "2026-10-16", force: true });
  assert(forced.ok === true && rowsOf(w, "Investments").length === 3, "force adds it");
  const last = rowsOf(w, "Investments")[2];
  assert(last[1] === "Tata Steel" && last[2] === 500 && last[4] === "manual", "stored with the manual kind");
  assert(w.sb.logInvestmentFromApp(500, "Digital Gold", { date: "2026-10-16" }).ok === true, "same amount for a DIFFERENT holding is fine");
  assert(w.sb.logInvestmentFromApp(500, "Tata Steel", { date: "2099-01-01" }).ok === false, "a future date is refused");
  assert(w.sb.logInvestmentFromApp(500, "Tata Steel", { date: "2026-13-40" }).ok === false, "an impossible date is refused");
  assert(w.sb.logInvestmentFromApp(0, "Tata Steel", {}).ok === false, "zero is refused");
  assert(w.sb.logInvestmentFromApp(100, "Not a fund", {}).ok === false, "an unknown holding is refused");
  assert(w.sb.logInvestmentFromApp(100, "Tata Steel").ok === true, "the old two-argument call still works");
}

console.log("\n--- 6. Sale ---");
{
  const w = world([["2026-10-15", "Tata Steel", 500, "", "manual"]], INS);
  assert(w.sb.recordInvestmentSale("Tata Steel", 600, "2026-10-16").ok === false, "cannot take out more than is in it");
  const ok = w.sb.recordInvestmentSale("Tata Steel", 200, "2026-10-16", "");
  const r = rowsOf(w, "Investments")[2];
  assert(ok.ok === true && r[2] === -200 && r[4] === "sale", "a sale is stored as a negative row of kind sale");
  assert(w.sb.invHoldingTotal_("Tata Steel") === 300, "the holding is now 300");
}

console.log("\n--- 7. Set up a holding ---");
{
  const w = world([], []);
  const a = w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", category: "SIP", putInSoFar: 23000, sipOn: true, sipAmount: 4000, sipDay: 10, sipActive: true });
  assert(a.ok === true, "creates a new SIP holding");
  const inst = w.sb.getInvestmentInstrumentsList().instruments.find((i) => i.name === "HDFC Mid Cap Fund");
  assert(inst.category === "SIP" && inst.sipAmount === 4000 && inst.sipDay === 10 && inst.sipActive === true, "plan saved on the holding");
  assert(w.sb.invHoldingTotal_("HDFC Mid Cap Fund") === 23000, "put in so far became an opening row");
  assert(rowsOf(w, "Investments")[1][4] === "opening", "that row is kind opening");
  assert(rowsOf(w, "FinancialEvents").some((r) => r[0] === "Investment" && r[1] === 4000 && r[4] === "HDFC Mid Cap Fund"), "the SIP amount is remembered for recognising payments");
  w.sb.saveInvestmentHolding({ name: "hdfc mid cap fund", putInSoFar: 20000 });
  assert(w.sb.invHoldingTotal_("HDFC Mid Cap Fund") === 20000, "changing put-in-so-far stores only the difference (name matched ignoring case)");
  assert(w.sb.getInvestmentInstrumentsList().instruments.length === 1, "no duplicate holding was created");
  assert(w.sb.saveInvestmentHolding({ name: "X", category: "SIP", sipOn: true, sipAmount: 0, sipDay: 5 }).ok === false, "SIP needs an amount");
  assert(w.sb.saveInvestmentHolding({ name: "X", category: "Stock", sipOn: true, sipAmount: 100, sipDay: 40 }).ok === false, "SIP day must be 1-31");
  assert(w.sb.saveInvestmentHolding({ name: "Y", putInSoFar: -5, category: "Stock" }).ok === false, "negative put-in refused");
  assert(w.sb.saveInvestmentHolding({ name: "Z" }).ok === false, "a new holding needs a kind");
  const o = w.sb.saveInvestmentHolding({ name: "Tata Steel", category: "Stock", putInSoFar: 157 });
  assert(o.ok === true && w.sb.getInvestmentInstrumentsList().instruments.length === 2, "a stock holding is added without a plan");
}

console.log("\n--- 7b. Already paid this month ---");
{
  const w = world([], []);
  const r = w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", category: "SIP", putInSoFar: 27000, sipOn: true, sipAmount: 4000, sipDay: 1, sipActive: true, paidThisMonth: true });
  assert(r.ok === true, "saved");
  const rows = rowsOf(w, "Investments").slice(1);
  assert(rows.filter((x) => x[4] === "payment" && x[2] === 4000).length === 1, "this month's SIP payment was recorded");
  assert(w.sb.invHoldingTotal_("HDFC Mid Cap Fund") === 27000, "the total is exactly what was typed (the payment is part of it, not on top)");
  const o = w.sb.getInvestmentsOverview_();
  assert(o.sips[0].status === "paid", "the SIP shows paid, not overdue");
  assert(o.thisMonth === 4000, "and this month shows the payment");
  w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", sipOn: true, sipAmount: 4000, sipDay: 1, sipActive: true, paidThisMonth: true });
  assert(rowsOf(w, "Investments").slice(1).filter((x) => x[4] === "payment").length === 1, "saving again does not record a second payment for the month");
  const w2 = world([], []);
  w2.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", category: "SIP", sipOn: true, sipAmount: 4000, sipDay: 1, sipActive: true });
  assert(rowsOf(w2, "Investments").length === 1, "without the option nothing is recorded");
  const w3 = world([], []);
  w3.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", category: "SIP", sipOn: true, sipAmount: 4000, sipDay: 1, sipActive: false, paidThisMonth: true });
  assert(rowsOf(w3, "Investments").length === 1, "a paused SIP never records a payment");
}

console.log("\n--- 8. Pause, resume, change the amount ---");
{
  const fe0 = [["Investment", 4000, "iccl mutual funds", "2026-10-10", "HDFC Mid Cap Fund"]];
  const w = world([], [["HDFC Mid Cap Fund", "SIP", 4000, 10, "yes"]], fe0);
  const feData = () => w.sheets.FinancialEvents.rows;
  const match = () => w.sb.matchRecurringNamedEvent("Investment", 4000, "", feData(), "iccl mutual funds");
  assert(match() && match().name === "HDFC Mid Cap Fund", "an active SIP is recognised by amount");
  w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", sipOn: true, sipAmount: 4000, sipDay: 10, sipActive: false });
  assert(match() === null, "a paused SIP is no longer recognised");
  assert(feData().filter((r) => r[0] === "InvestmentPaused").length === 1, "exactly one paused marker");
  w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", sipOn: true, sipAmount: 4000, sipDay: 10, sipActive: false });
  assert(feData().filter((r) => r[0] === "InvestmentPaused").length === 1, "pausing twice does not stack markers");
  w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", sipOn: true, sipAmount: 4000, sipDay: 10, sipActive: true });
  assert(match() && match().name === "HDFC Mid Cap Fund", "resuming makes it recognised again");
  assert(feData().filter((r) => r[0] === "InvestmentPaused").length === 0, "the marker is gone");
  w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", sipOn: true, sipAmount: 5000, sipDay: 10, sipActive: true });
  const inv = feData().filter((r) => r[0] === "Investment" && r[4] === "HDFC Mid Cap Fund");
  assert(inv.length === 1 && inv[0][1] === 5000 && inv[0][2] === "iccl mutual funds", "a new amount replaces the old one and keeps the payee");
  w.sb.saveInvestmentHolding({ name: "HDFC Mid Cap Fund", sipOn: false });
  const inst = w.sb.getInvestmentInstrumentsList().instruments[0];
  assert(inst.sipAmount === null && inst.category === "One-time Fund", "turning the plan off clears it; the holding becomes One-time Fund");
}

console.log("\n--- 9. Delete an entry safely ---");
{
  const w = world([["2026-10-15", "Tata Steel", 500, "", "manual"], ["2026-10-16", "Tata Steel", 300, "", "manual"]], INS);
  assert(w.sb.deleteInvestmentEntry(2, "Tata Steel", 999).stale === true, "a changed row is refused as stale");
  assert(w.sb.deleteInvestmentEntry(99, "Tata Steel", 500).ok === false, "a bad row number is refused");
  assert(w.sb.deleteInvestmentEntry(2, "Tata Steel", 500).ok === true && rowsOf(w, "Investments").length === 2, "the right row is deleted");
}

console.log("\n--- 10. Start fresh ---");
{
  const w = world([
    ["2026-08-11", "Tata Steel", 157, "Starting Balance", ""], ["2026-10-10", "HDFC Mid Cap Fund", 4000, "x", "payment"]
  ], [["HDFC Nifty 50 Index Fund", "SIP", 3000, 10, "yes"], ["HDFC Mid Cap Fund", "SIP", 4000, 10, "yes"], ["Tata Steel", "Stock", "", "", ""]],
  [["Investment", 3000, "iccl mutual funds", "2026-09-15", "Mutual Funds SIP"], ["Investment", 4000, "iccl", "2026-10-10", "HDFC Mid Cap Fund"]]);
  assert(w.sb.startInvestmentsFresh("nope").ok === false && rowsOf(w, "Investments").length === 3, "needs the exact confirmation, and does nothing without it");
  const r = w.sb.startInvestmentsFresh("FRESH");
  assert(r.ok === true && r.archived === 2, "archived the 2 entries");
  assert(rowsOf(w, "Investments").length === 1, "the tab is empty apart from the header");
  assert(rowsOf(w, "Investments")[0][4] === "Kind", "the header has a Kind column");
  assert(rowsOf(w, "Investments_Archive").length === 3, "the archive holds both entries plus its header");
  assert(rowsOf(w, "FinancialEvents").every((x) => x[4] !== "Mutual Funds SIP"), "an old free-typed SIP name was relabelled");
  assert(rowsOf(w, "FinancialEvents").some((x) => x[4] === "HDFC Nifty 50 Index Fund" && x[1] === 3000 && x[2] === "iccl mutual funds"), "...onto the one SIP holding with that amount, keeping the payee");
  const again = w.sb.startInvestmentsFresh("FRESH");
  assert(again.ok === true && again.archived === 0 && rowsOf(w, "Investments_Archive").length === 3, "running it twice archives nothing more");
}

console.log("\n--- 11. The old screen's fields are unchanged and the overview comes along ---");
{
  const w = world([["2026-10-10", "HDFC Mid Cap Fund", 4000, "x", "payment"], ["2026-08-11", "Tata Steel", 157, "Starting Balance", ""]], INS);
  const d = w.sb.getInvestmentsData();
  assert(d.total === 4157 && Array.isArray(d.breakdown) && Array.isArray(d.recent), "total / breakdown / recent still there");
  assert(d.overview && d.overview.totalPutIn === 4157 && d.overview.holdings.length >= 2, "overview present");
  const old = world([["2026-10-10", "HDFC Mid Cap Fund", 4000, "x"]], INS);
  assert(old.sb.getInvestmentsData().overview !== null, "a row with only 4 columns (the old layout) still gives an overview");
}


console.log("\n--- 12. Review fixes: paused SIP, stale edit, day 31 ---");
{
  const FILES2 = FILES.concat(["autoSettle.js", "obligationReminders.js"]);
  const w = makeWorld(FILES2);
  w.addSheet("Investments", [INV_HEADER]); w.addSheet("InvestmentInstruments", [INS_HEADER]); w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  const fe = [FE_HEADER, ["Investment", 4000, "iccl mutual funds", "2026-10-10", "HDFC Mid Cap Fund"]];
  const silent = () => w.sb.findSilentFinancialEventMatch_("iccl mutual funds", 4000, fe);
  assert(silent() && silent().name === "HDFC Mid Cap Fund", "an active SIP IS settled silently (control)");
  const paused = fe.concat([["InvestmentPaused", 0, "", "2026-10-12", "HDFC Mid Cap Fund"]]);
  assert(w.sb.findSilentFinancialEventMatch_("iccl mutual funds", 4000, paused) === null, "a paused SIP is NOT settled silently");
  assert(w.sb.getDistinctObligations_(fe).some((o) => o.name === "HDFC Mid Cap Fund"), "an active SIP is in the reminder list (control)");
  assert(!w.sb.getDistinctObligations_(paused).some((o) => o.type === "InvestmentPaused" || o.name === "HDFC Mid Cap Fund"), "a paused SIP gets no reminder");
}
{
  const w = world([["2026-10-15", "Tata Steel", 500, "", "manual"], ["2026-10-16", "Digital Gold", 300, "", "manual"]], INS);
  assert(w.sb.updateInvestmentEntry(2, "Tata Steel", 700, "Digital Gold", 300).stale === true, "an edit aimed at a row that is no longer that entry is refused");
  assert(rowsOf(w, "Investments")[1][2] === 500, "...and nothing changed");
  assert(w.sb.updateInvestmentEntry(2, "Tata Steel", 700, "Tata Steel", 500).ok === true && rowsOf(w, "Investments")[1][2] === 700, "an edit of the entry that was shown goes through");
  assert(w.sb.updateInvestmentEntry(2, "Tata Steel", 800).ok === true, "the older call without a check still works");
}
{
  const ins = INS.map((r) => r.slice()); ins[0][3] = 31;
  const w = world([], ins);
  const nov = overview(w, "2026-11-30T10:00:00+05:30").sips.find((s) => s.name === "HDFC Nifty 50 Index Fund");
  assert(nov.status === "upcoming" && nov.daysUntil === 0 && nov.day === 30, "a SIP due on the 31st is due today (the 30th) in November");
  const dec = overview(w, "2026-12-31T10:00:00+05:30").sips.find((s) => s.name === "HDFC Nifty 50 Index Fund");
  assert(dec.status === "upcoming" && dec.day === 31, "...and on the 31st in December");
}


console.log("\n--- 13. Archived payments feed the bars and SIP history, never the totals ---");
{
  const w = world([["2026-10-10", "HDFC Mid Cap Fund", 4000, "SIP paid this month", "payment"]], INS);
  w.addSheet("Investments_Archive", [["Date", "Name", "Amount", "Note", "Kind", "ArchivedOn"],
    ["2026-08-11", "HDFC Mid Cap Fund", 11000, "Starting Balance", "", "2026-10-17"],
    ["2026-08-17", "Bandhan Small Cap (Money2Mgt SIP)", 2000, "x", "payment", "2026-10-17"],
    ["2026-09-10", "HDFC Mid Cap Fund", 4000, "x", "payment", "2026-10-17"],
    ["2026-09-15", "Bandhan Small Cap (Money2Mgt SIP)", 2000, "x", "payment", "2026-10-17"],
    ["2026-10-10", "HDFC Mid Cap Fund", 4000, "x", "payment", "2026-10-17"],
    ["2026-10-15", "Bandhan Small Cap (Money2Mgt SIP)", 2000, "x", "payment", "2026-10-17"],
    ["2026-09-20", "Tata Steel", -500, "Sale", "sale", "2026-10-17"],
    ["2026-07-05", "Old Name Not A Holding", 1000, "x", "manual", "2026-10-17"]]);
  const o = w.sb.getInvestmentsOverview_();
  const bar = (m) => o.monthly.find((b) => b.month === m).amount;
  assert(bar(8) === 2000 && bar(9) === 6000, "August and September bars come from the archive (got " + bar(8) + ", " + bar(9) + ")");
  assert(bar(10) === 6000, "October = live 4000 (the same archived payment is not counted twice) + archived Bandhan 2000 (got " + bar(10) + ")");
  assert(bar(7) === 1000, "an archived payment to a name that is no longer a holding still shows in its month");
  assert(o.totalPutIn === 4000, "the total ignores the archive entirely (got " + o.totalPutIn + ")");
  assert(!o.holdings.some((h) => h.name === "Old Name Not A Holding" || h.name === "Bandhan Small Cap (Money2Mgt SIP)" && h.entries.length), "archived names do not become holdings");
  const b = o.sips.find((s) => s.name === "Bandhan Small Cap (Money2Mgt SIP)");
  assert(b.status === "paid" && b.paidOn === "2026-10-15", "a SIP paid before 'start over' shows paid, not overdue");
  assert(b.trackedMonths === 2 && b.paidMonths === 2, "its paid history comes from the archive too (Aug and Sep)");
  assert(o.thisMonth === 6000, "this month counts the archived October payment (got " + o.thisMonth + ")");
  assert(w.sb.computeInvestmentsOverview_([], [], 0, new Date()).monthly.length === 6, "no archive and no rows still works");
}


console.log("\n--- 13b. An old free-typed SIP name in the archive is not counted twice ---");
{
  const w = world([["2026-10-10", "HDFC Nifty 50 Index Fund", 3000, "SIP paid this month", "payment"]], INS);
  w.addSheet("Investments_Archive", [["Date", "Name", "Amount", "Note", "Kind", "ArchivedOn"],
    ["2026-10-10", "Mutual Funds SIP", 3000, "x", "", "2026-10-17"],
    ["2026-09-10", "Mutual Funds SIP", 3000, "x", "", "2026-10-17"],
    ["2026-09-12", "Mutual Funds SIP", 4321, "x", "", "2026-10-17"]]);
  const o = w.sb.getInvestmentsOverview_();
  assert(o.thisMonth === 3000, "October shows the 3000 once, not twice (got " + o.thisMonth + ")");
  assert(o.monthly.find((m) => m.month === 9).amount === 3000 + 4321, "September counts both archived payments (the odd amount stays under its old name)");
  const n = o.sips.find((s) => s.name === "HDFC Nifty 50 Index Fund");
  assert(n.trackedMonths === 1 && n.paidMonths === 1, "the old-name September payment counts as the Nifty SIP's history");
}


console.log("\n--- 13c. Bank payments fill gaps in the bars without double counting ---");
{
  const TX_HEADER = ["Date", "Time", "Bank", "Type", "Mode", "Amount", "Reference", "Counterparty", "Channel", "Source", "RawSMS", "Sender", "Note", "Category", "TelegramMsgID", "Processed", "NeedWantSaving", "FinancialEvent", "FinancialEventName"];
  const tx = (date, amount, name, raw, fe, type) => [date, "", "HDFC", type || "debit", "upi", amount, "", "iccl", "", "", raw || "Sent Rs." + amount, "", "", "", "", "YES", "", fe === undefined ? "Investment" : fe, name];
  const w = world([["2026-10-10", "HDFC Nifty 50 Index Fund", 3000, "SIP paid this month", "payment"]], INS);
  w.addSheet("Investments_Archive", [["Date", "Name", "Amount", "Note", "Kind", "ArchivedOn"],
    ["2026-09-10", "HDFC Mid Cap Fund", 4000, "x", "", "2026-10-17"]]);
  w.addSheet("Transactions", [TX_HEADER,
    tx("2026-10-10", 3000, "Mutual Funds SIP"),                       // the same payment as the live one (old name)
    tx("2026-09-10", 4000, "HDFC Mid Cap Fund"),                      // the same payment as the archived one
    tx("2026-09-10", 3000, "Mutual Funds SIP"),                       // never logged on the Investments tab: fills the gap
    tx("2026-08-10", 3000, "Mutual Funds SIP"),
    tx("2026-07-08", 3000, "Mutual Funds SIP", "E-Mandate! Rs.3000.00 will be deducted on 10/07/26"),   // an advance notice, not a payment
    tx("2026-07-10", 3000, "Mutual Funds SIP"),
    tx("2026-07-12", 500, "", "x", "Rent"),                           // not an investment
    tx("2026-07-13", 800, "", "x", "Investment", "credit")]);         // not a debit
  const o = w.sb.getInvestmentsOverview_();
  const bar = (m) => o.monthly.find((b) => b.month === m).amount;
  assert(bar(10) === 3000, "October: live + bank copy of the same payment = 3000, not 6000 (got " + bar(10) + ")");
  assert(bar(9) === 7000, "September: archived 4000 + the 3000 only the bank knew (got " + bar(9) + ")");
  assert(bar(8) === 3000, "August: a payment only the bank knew still shows (got " + bar(8) + ")");
  assert(bar(7) === 3000, "July: the advance 'will be deducted' notice is not counted (got " + bar(7) + ")");
  assert(o.totalPutIn === 3000, "the total is still only the Investments tab (got " + o.totalPutIn + ")");
  const n = o.sips.find((s) => s.name === "HDFC Nifty 50 Index Fund");
  assert(n.trackedMonths === 3 && n.paidMonths === 3, "the Nifty SIP's history now includes Jul, Aug and Sep from the bank (got " + n.paidMonths + "/" + n.trackedMonths + ")");
  const manual = world([["2026-10-12", "Tata Steel", 3000, "top-up", "manual"], ["2026-10-10", "HDFC Nifty 50 Index Fund", 3000, "SIP", "payment"]], INS);
  manual.addSheet("Transactions", [TX_HEADER, tx("2026-10-10", 3000, "HDFC Nifty 50 Index Fund")]);
  assert(manual.sb.getInvestmentsOverview_().thisMonth === 6000, "money you added by hand is never merged with a bank payment of the same amount");
}

console.log("\n--- 14. Remove a holding you do not have ---");
{
  const w = world([["2026-10-10", "Tata Steel", 500, "", "manual"]], INS,
    [["Investment", 3000, "", "2026-08-11", "HDFC Nifty 50 Index Fund"], ["InvestmentPaused", 0, "", "2026-10-12", "HDFC Nifty 50 Index Fund"]]);
  assert(w.sb.removeInvestmentHolding("Tata Steel").ok === false, "a holding with entries cannot be removed");
  assert(w.sb.getInvestmentInstrumentsList().instruments.some((i) => i.name === "Tata Steel"), "...and stays in the list");
  assert(w.sb.removeInvestmentHolding("Nope").ok === false, "an unknown name is refused");
  const r = w.sb.removeInvestmentHolding("hdfc nifty 50 index fund");
  assert(r.ok === true && !w.sb.getInvestmentInstrumentsList().instruments.some((i) => i.name === "HDFC Nifty 50 Index Fund"), "an empty holding is removed (name matched ignoring case)");
  assert(rowsOf(w, "FinancialEvents").length === 1, "its remembered SIP amount and paused marker are forgotten");
  assert(rowsOf(w, "InvestmentInstruments").length === 5, "the other holdings are untouched");
}

console.log("\nAll Investments overview checks passed.");
