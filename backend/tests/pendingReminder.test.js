// backend/tests/pendingReminder.test.js
//
// Plain-English what this checks: the pending-payment reminder (pendingReminder.js, 2026-10-17) and the cost / annoyance rules the owner set:
//   - quiet hours (10pm-8am): nothing is sent and NOTHING is read from the database;
//   - a payment that has only just arrived is not reminded about (it must have been waiting since the previous check);
//   - hourly by default, 30 minutes or twice a day by choice, never faster than 30 minutes, "off" means off;
//   - at most 8 per person per day;
//   - nothing while the app was open in the last 10 minutes, nothing when nothing is pending, nothing without a phone;
//   - each person is reminded only about THEIR OWN pending payments, on THEIR OWN phone; one person failing never stops the next;
//   - the text says how many, how much, and how old; no pronouns;
//   - the Settings choice round-trips; the tick looks at reminders about every 15 minutes and a reminder problem never breaks the tick.
// All data here is invented. Run with: node backend/tests/pendingReminder.test.js

const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");
const crypto = require("crypto");

const w = build(); const sb = w.sb;
sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
const sent = [];
sb.sendPushToToken_ = function(token, title, body, extra){ sent.push({ token: token, title: title, body: body, extra: extra }); return { sent: true, code: 200 }; };
sb.sendPushNotification = function(){};
const D = w.D;
const at = function(h, m, dayOffset){ const n = new D(); return new D(n.getFullYear(), n.getMonth(), n.getDate() + (dayOffset || 0), h, m || 0, 0).getTime(); };
const row = function(daysAgo, amt, cp, o){
  o = o || {};
  const n = new D();
  return [new D(n.getFullYear(), n.getMonth(), n.getDate() - daysAgo, 12, 0, 0), new D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, "r" + Math.random(), cp, "SMS", "Phone", "raw", "HDFCBK",
    o.note === undefined ? "" : o.note, "Other", "", (o.processed !== undefined ? o.processed : "YES"), "", "", "", "", ""];
};

w.addSheet("Transactions", [TXN_HEADER, row(0, 500, "Cafe A"), row(2, 740, "Old shop B"), row(1, 90, "Has note", { note: "tea" }), row(0, 30, "Not alerted yet", { processed: "" })]);
["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", new D(), "", "Credit", 500, "Opening"]]);
w.props.PWA_PUSH_TOKEN = "tok-owner";
sb.v2dbImportOwner(); sb.v2dbEnableOwner();
sb.v2dbRun_(OWNER, function(db){ db.props().setProperty("PWA_PUSH_TOKEN", "tok-owner-private"); });
sb.v2dbEnableUser(FRIEND);
w.act("friend", { action: "registerPushToken", token: "tok-friend" });
sb.v2dbRun_(FRIEND, function(db){ sb.v2dbEnsureTemplate_(db); db.getSheetByName("Transactions").appendRow(row(0, 61, "Her shop")); });

const ownerPending = 2, ownerTotal = 1240, key = function(e){ return sb.adminPersonKey_(e); };
const state = function(){ return (w.store["_system/reminders"] || { fields: {} }).fields; };
const mineOnly = function(){ return sent.filter(function(s){ return s.token === "tok-owner-private"; }); };
const hers = function(){ return sent.filter(function(s){ return s.token === "tok-friend"; }); };
const reset = function(){ sent.length = 0; delete w.store["_system/reminders"]; delete w.store["adminStats/p_" + key(OWNER)]; delete w.store["adminStats/p_" + key(FRIEND)]; sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_PENDING_REMINDER", ""); }); sb.v2dbRun_(FRIEND, function(){ sb.dbProps_().setProperty("SETTING_PENDING_REMINDER", ""); }); };

console.log("\n--- 1. Quiet hours: nothing sent, nothing read ---");
{
  reset();
  let reads = 0; const realGet = sb.fsGetPathMeta_, realBatch = sb.fsBatchGetPaths_;
  sb.fsGetPathMeta_ = function(p){ reads++; return realGet(p); }; sb.fsBatchGetPaths_ = function(p){ reads++; return realBatch(p); };
  assert(sb.pendingReminderRun_(at(23, 0)) === 0 && sb.pendingReminderRun_(at(7, 59)) === 0 && sb.pendingReminderRun_(at(22, 0)) === 0, "at 23:00, 07:59 and 22:00 nothing is sent");
  assert(reads === 0 && sent.length === 0, "and the database is not even read (cost): " + reads);
  sb.fsGetPathMeta_ = realGet; sb.fsBatchGetPaths_ = realBatch;
}

console.log("\n--- 2. Only when something has been waiting since the last check; hourly by default ---");
{
  reset();
  assert(sb.pendingReminderRun_(at(12, 0)) === 0 && sent.length === 0, "first look at 12:00: a payment that may have just arrived is not reminded about (it is remembered)");
  assert(Number(state()[key(OWNER) + "_prev"]) === ownerPending, "(the count waiting is remembered: " + state()[key(OWNER) + "_prev"] + ")");
  const n = sb.pendingReminderRun_(at(12, 15));
  assert(n === 2 && mineOnly().length === 1 && hers().length === 1, "at 12:15 they were still waiting: one reminder each, to their own phones");
  const m = mineOnly()[0];
  assert(m.title === "2 payments need a note", "the title says how many: " + m.title);
  assert(m.body.indexOf("₹" + ownerTotal.toLocaleString("en-IN")) !== -1 && /Oldest: 2 days ago\./.test(m.body), "the body says how much and how old: " + m.body);
  assert(m.extra.kind === "reminder" && m.extra.tag === "pending-reminder", "it is tagged so a new reminder replaces the old one");
  assert(!/\b(he|she|his|her|him)\b/i.test(m.title + " " + m.body), "no pronouns");
  assert(hers()[0].title === "1 payment needs a note" && /₹61/.test(hers()[0].body) && !/1,240|Cafe|Old shop/.test(hers()[0].title + hers()[0].body), "her reminder is about HER payment only (singular wording, her total, none of the owner's data)");
  sent.length = 0;
  assert(sb.pendingReminderRun_(at(12, 30)) === 0 && sb.pendingReminderRun_(at(12, 50)) === 0, "hourly: nothing at 12:30 or 12:50");
  assert(sb.pendingReminderRun_(at(13, 20)) === 2, "hourly: the next one at 13:20");
}

console.log("\n--- 3. Choices: 30 minutes, twice a day, off; never faster than 30 ---");
{
  reset();
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_PENDING_REMINDER", "30"); });
  sb.pendingReminderRun_(at(12, 0)); sb.pendingReminderRun_(at(12, 15)); sent.length = 0;
  sb.pendingReminderRun_(at(12, 30));
  assert(mineOnly().length === 0, "every 30 minutes: not again 15 minutes after the last one");
  sb.pendingReminderRun_(at(12, 46));
  assert(mineOnly().length === 1, "every 30 minutes: again after 30 minutes");
  reset();
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_PENDING_REMINDER", "twice"); });
  sb.pendingReminderRun_(at(9, 0)); sb.pendingReminderRun_(at(9, 15)); sent.length = 0;
  sb.pendingReminderRun_(at(12, 0)); sb.pendingReminderRun_(at(13, 0));
  assert(mineOnly().length === 0, "twice a day: nothing for 5 hours after one");
  sb.pendingReminderRun_(at(14, 20));
  assert(mineOnly().length === 1, "twice a day: the next one after 5 hours");
  reset();
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_PENDING_REMINDER", "off"); });
  sb.pendingReminderRun_(at(12, 0)); sb.pendingReminderRun_(at(12, 15)); sb.pendingReminderRun_(at(14, 0));
  assert(mineOnly().length === 0 && hers().length >= 1, "off means off for that person (the other person is unaffected)");
  assert(sb.reminderChoice_("5") === "60" && sb.reminderChoice_("") === "60" && sb.reminderChoice_("OFF") === "off", "an unknown choice falls back to hourly; there is no choice faster than 30 minutes");
}

console.log("\n--- 4. The daily cap ---");
{
  reset();
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_PENDING_REMINDER", "30"); });
  sb.pendingReminderRun_(at(8, 0));
  for(let i = 1; i <= 20; i++) sb.pendingReminderRun_(at(8, 0) + i * 31 * 60000);
  assert(mineOnly().length === 8, "at most 8 reminders a day even every 30 minutes: " + mineOnly().length);
  const tomorrow = at(8, 0, 1);
  sb.pendingReminderRun_(tomorrow);
  assert(mineOnly().length === 9, "and the count starts again the next day");
}

console.log("\n--- 5. In the app, nothing pending, no phone, failures ---");
{
  reset();
  sb.pendingReminderRun_(at(12, 0));
  w.store["adminStats/p_" + key(OWNER)] = { fields: { lastSeenMs: at(12, 15) - 5 * 60000 }, updateTime: "t1" };
  sent.length = 0;
  sb.pendingReminderRun_(at(12, 15));
  assert(mineOnly().length === 0 && hers().length === 1, "seen in the app 5 minutes ago: no reminder for that person (the other still gets theirs)");
  w.store["adminStats/p_" + key(OWNER)].fields.lastSeenMs = at(12, 15) - 20 * 60000;
  sb.pendingReminderRun_(at(12, 30));
  assert(mineOnly().length === 1, "seen 20 minutes ago: a reminder is fine");

  reset();
  const rows = sb.v2dbRun_(FRIEND, function(){ const s = sb.dbSs_().getSheetByName("Transactions"); const v = s.getDataRange().getValues(); s.getRange(2, 13, 1, 1).setValues([["noted"]]); return v.length; });
  sb.pendingReminderRun_(at(12, 0)); sent.length = 0; sb.pendingReminderRun_(at(12, 15));
  assert(hers().length === 0 && mineOnly().length === 1, "nothing pending for her (she added the note): nothing sent to her");

  reset();
  const real = sb.splitNotifyToken_;
  sb.splitNotifyToken_ = function(e){ return e === OWNER ? "" : real(e); };
  sb.pendingReminderRun_(at(12, 0)); sb.pendingReminderRun_(at(12, 15));
  assert(mineOnly().length === 0, "no phone registered: nothing, no error");
  sb.splitNotifyToken_ = real;

  reset();
  const realSnap = sb.reminderSnapshot_;
  sb.reminderSnapshot_ = function(n){ if(sb.V2DB_REQ_ && String(sb.V2DB_REQ_.user).toLowerCase() === OWNER) throw new Error("boom"); return realSnap(n); };
  sb.pendingReminderRun_(at(12, 0)); sent.length = 0;
  assert(sb.pendingReminderRun_(at(12, 15)) >= 0 && w.errors("REMINDER_ERROR").length >= 1, "one person failing is logged and does not stop the run");
  sb.reminderSnapshot_ = realSnap;
}

console.log("\n--- 6. Settings round trip ---");
{
  const g = function(){ return w.act("owner", { action: "getSettings" }).settings.pendingReminder; };
  assert(g() === "60", "hourly by default");
  w.act("owner", { action: "updateSettings", settings: { pendingReminder: "30" } });
  assert(g() === "30", "changed to every 30 minutes");
  w.act("owner", { action: "updateSettings", settings: { pendingReminder: "5" } });
  assert(g() === "30", "an invalid value (faster than 30 minutes) is ignored");
  w.act("owner", { action: "updateSettings", settings: { ccLimit: 61000 } });
  assert(g() === "30", "saving other settings does not change it");
  w.act("owner", { action: "updateSettings", settings: { pendingReminder: "off" } });
  assert(g() === "off", "off");
}

console.log("\n--- 7. The tick looks about every 15 minutes, and a problem never breaks it ---");
{
  reset();
  let calls = 0; sb.pendingReminderRun_ = function(){ calls++; };
  const today = "2026-10-17";
  sb.timerIstClock_ = function(){ return { date: today, minutes: 12 * 60 }; };
  const base = Date.now();
  w.store["_system/timer"] = { fields: { fullAtMs: base, doneAtMs: base, dirtyAtMs: 0, daily_obligations: today, daily_debts: today, daily_health: today, daily_cash: today, remindAtMs: 0 }, updateTime: "t0" };
  sb.timerTick_();
  assert(calls === 1 && Number(w.store["_system/timer"].fields.remindAtMs) > 0, "the first tick looks at reminders and notes the time");
  sb.timerTick_();
  assert(calls === 1, "the next tick 5 minutes later does not (about every 15 minutes)");
  w.store["_system/timer"].fields.remindAtMs = Date.now() - 15 * 60000;
  sb.timerTick_();
  assert(calls === 2, "15 minutes later it does");
  sb.pendingReminderRun_ = function(){ throw new Error("reminder exploded"); };
  w.store["_system/timer"].fields.remindAtMs = 0;
  const r = sb.timerTick_();
  assert(r && r.ran === false && Number(w.store["_system/timer"].fields.tickAtMs) > 0, "a reminder failure does not break the tick (the heartbeat is still written)");
}

console.log("\nAll checks passed.");
