// backend/tests/dailySummary.test.js
//
// Plain-English what this checks: the 9pm "how much you spent today" notification (dailySummary.js, 2026-10-17).
//   - the total is exactly what the Today screen counts: your share of a split, cash included; a credit card bill payment, a wallet
//     top-up and a Rent/EMI payment are NOT spending;
//   - the text names the biggest category, compares with the usual day (from the 4th of the month), and counts payments still needing a note;
//   - a day with no spending still sends "No spending today";
//   - every person with the full app gets THEIR OWN summary on THEIR OWN phone, built only from THEIR data (nothing of the owner's
//     appears in a friend's text); someone with no phone or who switched it off gets nothing; one person's problem never stops the others;
//   - the Settings switch round-trips (on by default);
//   - the new server's 21:00 tick runs it (the old 20:00 cash check-in steps aside).
// All data here is invented. Run with: node backend/tests/dailySummary.test.js

const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
const sent = [];
sb.sendPushToToken_ = function(token, title, body, extra){ sent.push({ token: token, title: title, body: body, extra: extra }); };
sb.sendPushNotification = function(){};
const D = w.D;
const now = new D();
const day = function(d){ return new D(now.getFullYear(), now.getMonth(), d, 12, 0, 0); };
const today = new D(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
const dom = Number(now.getDate());
const row = function(date, amt, cp, cat, o){
  o = o || {};
  return [date, new D(1899, 11, 30, 18, 30, 0), "HDFC", o.type || "debit", o.mode || "upi", amt, o.ref || ("r" + Math.random()), cp, "SMS", "Phone", "raw", "HDFCBK",
    o.note === undefined ? "x" : o.note, cat, "", o.processed || "YES", "", o.event || "", "", "", o.share || ""];
};

// ---- the owner: on his private copy, with a phone ----
w.addSheet("Transactions", [TXN_HEADER,
  row(today, 520, "Cafe A", "Food"),
  row(today, 180, "Cab B", "Transport"),
  row(today, 500, "Friend dinner", "Food", { share: 200 }),                       // split: only 300 is his
  row(today, 9000, "HDFC CREDIT CARD BILL", "Bills", { mode: "upi", note: "credit card bill" }),   // not spending
  row(today, 15000, "Landlord", "Bills", { event: "Rent" }),                      // Rent: not day-to-day
  row(today, 77, "Unnoted shop", "Other", { note: "" }),                          // spent, no note yet
  row(today, 250, "Salary credit", "Income", { type: "credit" }),                 // money in: not spending
  row(day(1), 1000, "Early month", "Food"), row(day(2), 1000, "Early month 2", "Food")
]);
["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"],
  ["", today, "", "Debit", 40, "chai", "Food", "app"]]);
w.props.PWA_PUSH_TOKEN = "tok-owner";
sb.v2dbImportOwner(); sb.v2dbEnableOwner();
sb.v2dbRun_(OWNER, function(db){ db.props().setProperty("PWA_PUSH_TOKEN", "tok-owner-private"); });

// ---- the friend: full app, her own small data and phone ----
sb.v2dbEnableUser(FRIEND);
w.act("friend", { action: "registerPushToken", token: "tok-friend" });
sb.v2dbRun_(FRIEND, function(db){
  sb.v2dbEnsureTemplate_(db);
  const t = db.getSheetByName("Transactions");
  t.appendRow(row(today, 90, "Her shop", "Shopping", { note: "" }));
});

console.log("\n--- 1. The owner's summary: what counts and what is said ---");
{
  const m = sb.v2dbRun_(OWNER, function(){ return sb.dailySummaryBuild_(); });
  // 520 + 180 + (500 - 200 split share) + 77 + cash 40 = 1117; bill payment, Rent and the credit are not spending
  assert(m.total === 1117, "total = 520 + 180 + 300 (his share of the split) + 77 + 40 cash = 1,117 (bill payment, Rent and money in left out): " + m.total);
  assert(m.title === "You spent ₹1,117 today", "the title: " + m.title);
  assert(/Biggest: Food ₹/.test(m.body), "it names the biggest category: " + m.body);
  assert(/1 payment still needs a note\./.test(m.body) && m.pending === 1, "one payment has no note yet and is counted: " + m.body);
  assert(/Cash ₹40\./.test(m.body), "the cash part is mentioned when there is also bank spending");
  if(dom >= 4){
    assert(/(usual day|above your usual day|below your usual day)/.test(m.body), "from the 4th of the month it compares with the usual day: " + m.body);
  }
  assert(!/(he|she|his|her|him)\b/i.test(m.title + " " + m.body.replace(/Biggest|Cash/g, "")), "no pronouns in the wording");
}

console.log("\n--- 2. A day with no spending still says so ---");
{
  const m = sb.v2dbRun_(FRIEND, function(){ sb.dbSs_().getSheetByName("Transactions").getRange(2, 1, 1, 3).setValues([[new D(2020, 0, 1), "", ""]]); return sb.dailySummaryBuild_(); });
  assert(m.total === 0 && m.title === "No spending today", "no spending: " + m.title);
  assert(/payment still needs a note/.test(m.body) || m.pending === 0, "(and any unnoted payment is still mentioned)");
}

console.log("\n--- 3. Everyone gets their OWN summary on their OWN phone ---");
{
  sb.v2dbRun_(FRIEND, function(){ sb.dbSs_().getSheetByName("Transactions").getRange(2, 1, 1, 3).setValues([[today, "", ""]]); });
  sent.length = 0;
  const n = sb.dailySummaryRun_();
  assert(n === 2 && sent.length === 2, "two people, two pushes: " + sent.length);
  const mine = sent.filter(function(s){ return s.token === "tok-owner-private"; })[0], hers = sent.filter(function(s){ return s.token === "tok-friend"; })[0];
  assert(mine && /1,117/.test(mine.title), "the owner's push goes to his private-copy phone with his total");
  assert(hers && /₹90 today/.test(hers.title), "her push goes to her phone with HER total: " + (hers && hers.title));
  assert(hers && !/1,117|Cafe|Cab|Food/.test(hers.title + hers.body), "nothing of the owner's data appears in her text");
  assert(mine.extra && mine.extra.kind === "summary", "tagged as a summary notification");
}

console.log("\n--- 4. No phone, switched off, and one person failing ---");
{
  sent.length = 0;
  const real = sb.splitNotifyToken_;
  sb.splitNotifyToken_ = function(e){ return e === FRIEND ? "" : real(e); };
  assert(sb.dailySummaryRun_() === 1 && sent.length === 1 && sent[0].token === "tok-owner-private", "a person with no phone registered is skipped, the other still gets theirs");
  sb.splitNotifyToken_ = real;
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_DAILY_SUMMARY_OFF", "1"); });
  sent.length = 0;
  assert(sb.dailySummaryRun_() === 1 && sent.length === 1 && sent[0].token === "tok-friend", "someone who switched it off gets nothing; the others are unaffected");
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_DAILY_SUMMARY_OFF", ""); });
  const realBuild = sb.dailySummaryBuild_;
  sb.dailySummaryBuild_ = function(){ if(sb.V2DB_REQ_ && String(sb.V2DB_REQ_.user).toLowerCase() === OWNER) throw new Error("boom"); return realBuild(); };
  sent.length = 0;
  const n = sb.dailySummaryRun_();
  assert(n === 1 && sent.length === 1 && sent[0].token === "tok-friend", "one person's failure does not stop the next person's summary");
  assert(w.errors("DAILY_SUMMARY_ERROR").length >= 1, "and the failure is logged");
  sb.dailySummaryBuild_ = realBuild;
}

console.log("\n--- 5. The Settings switch ---");
{
  const g = function(){ return w.act("owner", { action: "getSettings" }).settings.dailySummary; };
  assert(g() === true, "on by default");
  w.act("owner", { action: "updateSettings", settings: { dailySummary: false } });
  assert(g() === false, "switched off");
  assert(w.act("owner", { action: "updateSettings", settings: { ccLimit: 60000 } }).ok && g() === false, "saving other settings does not switch it back on");
  w.act("owner", { action: "updateSettings", settings: { dailySummary: true } });
  assert(g() === true, "switched on again");
}

console.log("\n--- 6. The new server's 21:00 tick runs it ---");
{
  assert(sb.TIMER_DAILY_JOBS_.filter(function(j){ return j.key === "cash"; })[0].hour === 21, "the evening job is at 21:00 India time");
  assert(sb.timerDailyRunner_("cash") === sb.dailySummaryRun_, "and it runs the new summary");
}

console.log("\nAll checks passed.");
