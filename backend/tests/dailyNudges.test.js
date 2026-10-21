// backend/tests/dailyNudges.test.js
//
// Plain-English what this checks: the three short daily notifications (dailyNudges.js, 2026-10-21).
//   - morning: "Today's limit", the "keep under" version when money will run out early, "Confirm your balance" when the balance is old;
//   - midday: "left today" / "go easy" / "over" / "clean start", measured against the limit the MORNING one remembered;
//   - evening (inside the 9pm summary): "under / over today's limit" + tomorrow's limit; falls back to the short "You spent ₹X today";
//   - every text is short (title <= 30 characters, body <= 40);
//   - each person gets their own, to their own phone; switched off or no phone = nothing; one failure never stops the rest;
//   - a morning/midday job that wakes up too late is skipped; the timer has the 08:00 and 13:00 jobs.
// All data here is invented. Run with: node backend/tests/dailyNudges.test.js

const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
const sent = [];
sb.sendPushToToken_ = function(token, title, body, extra){ sent.push({ token: token, title: title, body: body, extra: extra }); };
const D = w.D; const now = new D();
const today = new D(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
const row = function(date, amt, cp, cat, o){
  o = o || {};
  return [date, new D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, "r" + Math.random(), cp, "SMS", "Phone", "raw", "HDFCBK", o.note === undefined ? "x" : o.note, cat, "", "YES", "", "", "", "", ""];
};
const rw = function(o){ return Object.assign({ hasCheckpoint: true, askBalance: false, estimatedBalance: 20700, billsAhead: 0, daysToSalary: 18, maxPerDay: 1150, shortByDays: null }, o || {}); };
const short = function(m){ return m && m.title.length <= 30 && m.body.length <= 40; };

console.log("\n--- 1. Morning text ---");
{
  let m = sb.nudgeMorningMsg_(rw());
  assert(m.title === "Today's limit: ₹1,150" && m.body === "18 days to salary", "normal: " + m.title + " / " + m.body);
  m = sb.nudgeMorningMsg_(rw({ daysToSalary: 1 }));
  assert(m.body === "1 day to salary", "singular day");
  m = sb.nudgeMorningMsg_(rw({ maxPerDay: 900, shortByDays: 4 }));
  assert(m.title === "Keep today under ₹900" && m.body === "Money runs out 4 days before salary", "running short: " + m.title + " / " + m.body);
  assert(short(m), "short enough");
  m = sb.nudgeMorningMsg_(rw({ askBalance: true }));
  assert(m.title === "Confirm your balance" && m.body === "to get today's limit", "balance older than 7 days asks for it");
  m = sb.nudgeMorningMsg_(rw({ hasCheckpoint: false }));
  assert(m.title === "Confirm your balance", "no balance yet asks for it");
  assert(sb.nudgeMorningMsg_(rw({ daysToSalary: null })) === null && sb.nudgeMorningMsg_(rw({ daysToSalary: 0 })) === null, "no salary date, or salary today: nothing");
  assert(sb.nudgeMorningMsg_(rw({ maxPerDay: 0, shortByDays: 18 })).title === "Spend nothing extra today", "nothing spare");
  assert(sb.nudgeMorningMsg_(null) === null, "no runway: nothing");
}

console.log("\n--- 2. Midday text ---");
{
  let m = sb.nudgeMiddayMsg_(rw(), 320, 1150);
  assert(m.title === "₹830 left today" && m.body === "You're ahead, keep going", "ahead: " + m.title);
  m = sb.nudgeMiddayMsg_(rw(), 1000, 1150);
  assert(m.title === "₹150 left today" && m.body === "Go easy this evening", "close to the limit");
  m = sb.nudgeMiddayMsg_(rw(), 0, 1150);
  assert(m.title === "Clean start so far" && m.body === "₹1,150 still free", "nothing spent");
  m = sb.nudgeMiddayMsg_(rw(), 1400, 1150);
  assert(m.title === "₹250 over today's limit", "over: " + m.title);
  assert(sb.nudgeMiddayMsg_(rw({ askBalance: true }), 100, 1150) === null, "old balance: nothing");
  assert(short(sb.nudgeMiddayMsg_(rw(), 1400, 1150)) && short(sb.nudgeMiddayMsg_(rw(), 0, 1150)), "short enough");
}

console.log("\n--- 3. Evening text ---");
{
  let m = sb.nudgeEveningMsg_(rw({ estimatedBalance: 19970, daysToSalary: 18 }), 980, 1150);
  assert(m.title === "₹170 under today's limit" && m.body === "Tomorrow: ₹1,174", "under: " + m.title + " / " + m.body);
  m = sb.nudgeEveningMsg_(rw({ estimatedBalance: 18700 }), 1350, 1150);
  assert(m.title === "₹200 over today" && /^Tomorrow: ₹1,1/.test(m.body), "over: " + m.title + " / " + m.body);
  m = sb.nudgeEveningMsg_(rw(), 0, 1150);
  assert(m.title === "No spending today", "nothing spent");
  m = sb.nudgeEveningMsg_(rw({ daysToSalary: 1 }), 500, 1150);
  assert(m.body === "Salary is almost here", "last day before salary: no tomorrow limit");
  assert(sb.nudgeEveningMsg_(rw({ askBalance: true }), 500, 1150) === null, "old balance: falls back to the plain summary");
}

console.log("\n--- 4. Real data path: spent today comes from the Today screen, limit is remembered ---");
w.addSheet("Transactions", [TXN_HEADER, row(today, 520, "Cafe A", "Food"), row(today, 180, "Cab B", "Transport")]);
["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"]]);
w.props.PWA_PUSH_TOKEN = "tok-owner";
sb.v2dbImportOwner(); sb.v2dbEnableOwner();
sb.v2dbRun_(OWNER, function(db){ db.props().setProperty("PWA_PUSH_TOKEN", "tok-owner-private"); });
sb.v2dbEnableUser(FRIEND);
w.act("friend", { action: "registerPushToken", token: "tok-friend" });
sb.v2dbRun_(FRIEND, function(db){ sb.v2dbEnsureTemplate_(db); db.getSheetByName("Transactions").appendRow(row(today, 90, "Her shop", "Shopping", { note: "" })); });
let runway = rw();
sb.buildRunwayForDashboard_ = function(){ return runway; };
sb.timerIstClock_ = function(){ return { date: "2026-10-21", minutes: 8 * 60 + 1 }; };
{
  const f = sb.v2dbRun_(OWNER, function(){ return sb.dailyNudgeFacts_(); });
  assert(f && f.spent === 700 && f.rw === runway, "spent today = 520 + 180 = 700: " + (f && f.spent));
  sent.length = 0;
  assert(sb.dailyNudgeMorningRun_() === 2 && sent.length === 2, "morning: both people get one");
  const mine = sent.filter(function(s){ return s.token === "tok-owner-private"; })[0];
  assert(mine && mine.title === "Today's limit: ₹1,150" && mine.extra.kind === "nudge", "the owner's goes to his private-copy phone");
  assert(sent.filter(function(s){ return s.token === "tok-friend"; }).length === 1, "and her own goes to her phone");
  const saved = sb.v2dbRun_(OWNER, function(){ return sb.dbProps_().getProperty("NUDGE_LIMIT"); });
  assert(saved === "2026-10-21|1150", "the morning limit is remembered: " + saved);

  // midday uses the remembered limit even if the live number moved
  runway = rw({ maxPerDay: 999 });
  sb.timerIstClock_ = function(){ return { date: "2026-10-21", minutes: 13 * 60 + 1 }; };
  sent.length = 0;
  sb.dailyNudgeMiddayRun_();
  const midMine = sent.filter(function(s){ return s.token === "tok-owner-private"; })[0];
  assert(midMine && midMine.title === "₹450 left today", "midday: 1,150 remembered limit - 700 spent = 450: " + (midMine && midMine.title));
  const midHers = sent.filter(function(s){ return s.token === "tok-friend"; })[0];
  assert(midHers && /left today|over today's|Clean/.test(midHers.title) && !/700|520/.test(midHers.title + midHers.body), "her midday text has none of the owner's numbers: " + (midHers && midHers.title));

  // evening is part of the 9pm summary
  runway = rw({ estimatedBalance: 19970 });
  sent.length = 0;
  sb.dailySummaryRun_();
  const ev = sent.filter(function(s){ return s.token === "tok-owner-private"; })[0];
  assert(ev && ev.title === "₹450 under today's limit" && /^Tomorrow: /.test(ev.body) && ev.extra.kind === "summary", "evening: " + (ev && ev.title) + " / " + (ev && ev.body));
  runway = null;
  sent.length = 0;
  sb.dailySummaryRun_();
  const fb = sent.filter(function(s){ return s.token === "tok-owner-private"; })[0];
  assert(fb && fb.title === "You spent ₹700 today" && short(fb), "no limit known: the short plain summary: " + (fb && fb.title) + " / " + (fb && fb.body));
  runway = rw();
}

console.log("\n--- 5. Too late, switched off, no phone, one failing ---");
{
  sb.timerIstClock_ = function(){ return { date: "2026-10-21", minutes: 21 * 60 }; };
  sent.length = 0;
  assert(sb.dailyNudgeMorningRun_() === 0 && sb.dailyNudgeMiddayRun_() === 0 && sent.length === 0, "a server that wakes up at 9pm sends no morning or midday nudge");
  sb.timerIstClock_ = function(){ return { date: "2026-10-21", minutes: 8 * 60 + 5 }; };
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_DAILY_SUMMARY_OFF", "1"); });
  sent.length = 0;
  assert(sb.dailyNudgeMorningRun_() === 1 && sent[0].token === "tok-friend", "switched off = nothing for that person, the other still gets theirs");
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_DAILY_SUMMARY_OFF", ""); });
  const real = sb.splitNotifyToken_;
  sb.splitNotifyToken_ = function(e){ return e === FRIEND ? "" : real(e); };
  sent.length = 0;
  assert(sb.dailyNudgeMorningRun_() === 1 && sent[0].token === "tok-owner-private", "no phone registered = skipped");
  sb.splitNotifyToken_ = real;
  const realFacts = sb.dailyNudgeFacts_;
  sb.dailyNudgeFacts_ = function(){ if(String(sb.V2DB_REQ_.user).toLowerCase() === OWNER) throw new Error("boom"); return realFacts(); };
  sent.length = 0;
  assert(sb.dailyNudgeMorningRun_() === 1 && sent[0].token === "tok-friend", "one person failing does not stop the next");
  assert(w.errors("NUDGE_ERROR").length >= 1, "and it is logged");
  sb.dailyNudgeFacts_ = realFacts;
}

console.log("\n--- 6. The timer has the 08:00 and 13:00 jobs ---");
{
  const j = function(k){ return sb.TIMER_DAILY_JOBS_.filter(function(x){ return x.key === k; })[0]; };
  assert(j("morning").hour === 8 && j("morning").minute === 0, "morning at 08:00");
  assert(j("midday").hour === 13 && j("midday").minute === 0, "midday at 13:00");
  assert(sb.timerDailyRunner_("morning") === sb.dailyNudgeMorningRun_ && sb.timerDailyRunner_("midday") === sb.dailyNudgeMiddayRun_, "they run the nudges");
}

console.log("\nAll checks passed.");
