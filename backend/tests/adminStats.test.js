// backend/tests/adminStats.test.js
//
// Plain-English what this checks: the admin counters (adminStats.js) and the HONEST score built from them (adminScores.js), 2026-10-16.
//   1. Small helpers: weeks start on Monday (India time), error text is cleaned (no numbers / e-mail / links), bank names are tidy.
//   2. Recording: every bank SMS is counted by how well it was understood; a note save counts "checked", "amount corrected" and "guess kept";
//      "Not a transaction" and Undo are counted the right way round; nothing personal (amount, note, payee, message) lands in any counter.
//   3. The score never flatters: too little data -> "collecting"; nobody has checked the readings -> "unverified" (no score); the numbers
//      add up by hand; junk the reader flagged is not held against it; statement-check misses ARE held against it; no blended "overall".
//   4. The app's own report (adminLog): only known screens, capped, errors cleaned and grouped; friends may send it, only the owner may read
//      the dashboard; a recording problem NEVER affects saving a message or a note.
// All data here is invented. Run with: node backend/tests/adminStats.test.js

const crypto = require("crypto");
const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

function make(rowsFn){
  const w = build(); const sb = w.sb;
  sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
  sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
  sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
  sb.sendPushNotification = function(title, body, extra){ w.pushes.push({ title: title, body: body, extra: extra || null }); };
  sb.CacheService = { getScriptCache: function(){ const s = w.__cache || (w.__cache = {}); return { get: function(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, put: function(k, v){ s[k] = String(v); }, remove: function(k){ delete s[k]; } }; } };
  const today = new w.D(); today.setHours(10, 0, 0, 0); w.today = today;
  const row = function(amt, ref, cp, bank, channel, source){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), bank || "HDFC", "debit", "upi", amt, ref, cp, channel || "SMS", source || "Phone", "raw sms " + ref, "HDFCBK", "", "", "", "YES", "", "", "", "", ""]; };
  w.row = row;
  w.addSheet("Transactions", [TXN_HEADER].concat(rowsFn ? rowsFn(row) : [row(120, 111111, "Cafe A"), row(80, 222222, "Shop B"), row(60, 333333, "NEEDS REVIEW: unrecognized message"), row(500, 444444, "Hand entry", "", "Manual")]));
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.props.lastCheckedRow = "5"; w.props.PWA_PUSH_TOKEN = "device-token-123";
  sb.v2dbImportOwner(); sb.v2dbEnableOwner(); sb.v2dbEnableOwnerDirect();
  w.key = w.act("owner", { action: "getMyIngestKey" }).key;
  sb.logAI = function(type, message){ (w.log = w.log || []).push({ type: type, message: String(message) }); };
  w.send = function(sms, sender){ return JSON.parse(sb.handlePwaRequest({ action: "smsIn", key: w.key, sms: sms, sender: sender || "HDFCBK", timestamp: Math.floor(today.getTime() / 1000) }).getContent()); };
  w.rows = function(){ return w.virtualTab(OWNER, "Transactions"); };
  w.week = function(){ return (w.store["adminStats/u_" + sb.adminWeekIndex_(Date.now())] || { fields: {} }).fields; };
  return w;
}
const num = function(v){ return Number(v) || 0; };

console.log("\n--- 1. Small helpers ---");
{
  const w = make(); const sb = w.sb;
  // 2026-10-12 is a Monday (India). The week number goes up exactly at Monday 00:00 India time, not at UTC midnight.
  const monIst = Date.UTC(2026, 9, 11, 18, 30, 0);              // Monday 12 Oct 2026, 00:00 India time
  assert(sb.adminWeekIndex_(monIst) === sb.adminWeekIndex_(monIst + 6 * 86400000 + 86000000), "Monday 00:00 India time and the following Sunday night are the same week");
  assert(sb.adminWeekIndex_(monIst) === sb.adminWeekIndex_(monIst - 1) + 1, "one second before Monday 00:00 India time is the previous week");
  assert(sb.adminWeekStartMs_(sb.adminWeekIndex_(monIst)) === monIst, "the week's start time is that Monday 00:00 India time");
  assert(sb.adminDayKey_(monIst) === 20261012 && sb.adminDayKey_(monIst - 1) === 20261011, "day keys follow the India calendar day");
  const clean = sb.adminCleanErrorText_("Failed for ronit@example.com amount 1,250.50 at https://x.test/a?b=1 row 77");
  assert(clean.indexOf("@") === -1 && !/\d/.test(clean) && clean.indexOf("http") === -1, "error text keeps no e-mail, digit or link: " + clean);
  assert(sb.adminCleanErrorText_("x".repeat(400)).length === 160, "error text is cut to 160 characters");
  assert(sb.adminBankKey_("HDFC", "HDFCBK") === "HDFC" && sb.adminBankKey_("", "VM-BOBSMS-S") === "UNK_BOBSMS" && sb.adminBankKey_("Bank of Baroda", "x") === "BANK_OF_BARODA", "bank names are tidy; an unnamed bank is told by its sender");
  const k1 = sb.adminPersonKey_("A@x.com"), k2 = sb.adminPersonKey_("a@x.com ");
  assert(k1 === k2 && /^[0-9a-f]{16}$/.test(k1) && k1.indexOf("a@x") === -1, "a person's key is stable, ignores case and spaces, and does not contain the e-mail");
}

console.log("\n--- 2. Recording ---");
{
  const w = make(); const sb = w.sb;
  const CAFE = "Sent Rs.40.00 From HDFC Bank A/C x1234 To Aarogyumm Cafe On 13/10/26 Ref 665226905838 Not You? Call 18002586161";
  const r = w.send(CAFE);
  assert(r.ok && r.outcome === "SAVED" && Object.keys(r).sort().join() === "ok,outcome,reason", "the phone's answer is unchanged (no admin field leaks): " + JSON.stringify(r));
  assert(num(w.week().b_HDFC__full) === 1, "a fully understood message is counted as 'full' under its bank: " + JSON.stringify(w.week()));
  assert(num(w.week().b_HDFC__nopayee) === 0, "payee found, so no 'no payee' count");
  w.send(CAFE);                                                             // the same message again
  assert(Object.keys(w.week()).filter(function(k){ return /__dup$/.test(k); }).reduce(function(a, k){ return a + num(w.week()[k]); }, 0) === 1 && num(w.week().b_HDFC__full) === 1, "a duplicate delivery is counted as a duplicate, not as another reading");
  w.send("Hi, win a prize, call now", "AD-PROMO");
  assert(Object.keys(w.week()).some(function(k){ return /__ign$/.test(k); }), "junk the reader ignored is counted as ignored");
  const unc = w.send("Your account XX1234 shows activity of Rs 321 pending on 13/10/26 ref 5566", "HDFCBK");
  if(unc.outcome === "UNCERTAIN_SAVED") assert(Object.keys(w.week()).some(function(k){ return /__unc$/.test(k); }), "a 'needs review' message is counted as uncertain");
  const me = sb.adminPersonKey_(OWNER);
  assert(w.store["adminStats/p_" + me] && num(w.store["adminStats/p_" + me].fields.lastSmsMs) > 0 && w.store["adminStats/p_" + me].fields.email === OWNER, "the person's 'last SMS received' time is kept (in the owner-only presence document)");
  assert(num(w.store["adminStats/w" + sb.adminWeekIndex_(Date.now()) + "_" + me].fields.sms_saved) === 1, "and their own weekly SMS count");
  const dump = JSON.stringify(Object.keys(w.store).filter(function(p){ return p.indexOf("adminStats/") === 0 && p.indexOf("adminStats/p_") !== 0; }).map(function(p){ return w.store[p]; }));
  assert(!/aarogyumm|665226905838|40\.00|1234|@/i.test(dump), "no payee, reference, amount, account digits or e-mail is in any weekly counter document");
}

console.log("\n--- 3. A note save: checked, corrected, guess kept ---");
{
  const w = make(); const sb = w.sb;
  const n = w.rows().length;                                              // the last row = the manual entry; rows 2.. are SMS
  // Row 2 (Cafe A, SMS, HDFC): saved unchanged, with a guess that was kept.
  let r = w.act("owner", { action: "saveNote", row: 2, note: "lunch", category: "Food", counterparty: "Cafe A", type: "Want", amount: 120, guess: { c: "Food", t: "Want" } });
  assert(r.ok === true, "the save itself works: " + JSON.stringify(r));
  let f = w.week();
  assert(num(f.b_HDFC__rev) === 1 && num(f.b_HDFC__fix) === 0, "checked once, amount not corrected");
  assert(num(f.g__saves) === 1 && num(f.g__cat_kept) === 1 && num(f.g__type_kept) === 1 && num(f.g__cat_changed) === 0, "both guesses were kept");
  // Row 3 (Shop B): the person corrected the amount and changed the category.
  r = w.act("owner", { action: "saveNote", row: 3, note: "x", category: "Shopping", counterparty: "Shop B", type: "Need", amount: 85, guess: { c: "Food", t: "Want" } });
  f = w.week();
  assert(num(f.b_HDFC__rev) === 2 && num(f.b_HDFC__fix) === 1, "the corrected amount (80 -> 85) is counted as a reading that was wrong");
  assert(num(f.g__cat_changed) === 1 && num(f.g__type_changed) === 1, "the changed category and tag are counted as guesses that were not kept");
  // Saving the very same thing again (double tap) counts nothing new.
  const before = JSON.stringify(w.week());
  w.act("owner", { action: "saveNote", row: 3, note: "x", category: "Shopping", counterparty: "Shop B", type: "Need", amount: 85, guess: { c: "Food", t: "Want" } });
  assert(JSON.stringify(w.week()) === before, "a repeated identical save (double tap) is not counted twice");
  // Editing it later in History with a different category = a correction made later.
  w.act("owner", { action: "saveNote", row: 2, note: "lunch", category: "Other", counterparty: "Cafe A", type: "Want", amount: 120 });
  assert(num(w.week().g__revised) === 1, "changing the category later in History is counted as a correction made later");
  assert(num(w.week().g__saves) === 2, "History edits are not counted as new payments");
  // Correcting the amount LATER in History is also counted as a wrong reading.
  w.act("owner", { action: "saveNote", row: 2, note: "lunch", category: "Other", counterparty: "Cafe A", type: "Want", amount: 125 });
  assert(num(w.week().b_HDFC__fix) === 2, "an amount corrected later in History is counted as a reading that was wrong");
  // A hand-entered payment is not an SMS reading: it must not touch the reading counters.
  const revBefore = num(w.week().b_HDFC__rev);
  w.act("owner", { action: "saveNote", row: 5, note: "cash thing", category: "Other", counterparty: "Hand entry", type: "Want", amount: 500 });
  assert(num(w.week().b_HDFC__rev) === revBefore && !Object.keys(w.week()).some(function(k){ return /^b_UNK__/.test(k); }), "a hand-entered payment is not counted as an SMS reading");
  // A notification reply (autoType) is not a Pending-card decision: no guess counts.
  w.act("owner", { action: "saveNote", row: 4, note: "z", category: "Other", counterparty: "x", autoType: true, guess: { c: "Food", t: "Want" } });
  assert(num(w.week().g__cat_kept) === 1 && num(w.week().g__cat_changed) === 1, "a note typed into a notification does not count as a guess decision");
}

console.log("\n--- 4. Removing as junk and Undo ---");
{
  const w = make(); const sb = w.sb;
  // row 4 is a 'NEEDS REVIEW' junk; row 2 is a normal, confidently read payment
  let r = w.act("owner", { action: "markNotATransaction", row: 4 });
  assert(r.ok === true && num(w.week().b_HDFC__unc_junk) + num(w.week().b_UNK_HDFCBK__unc_junk) === 1, "junk the reader itself flagged is counted as 'caught junk', not as a reading error: " + JSON.stringify(w.week()));
  r = w.act("owner", { action: "markNotATransaction", row: 2 });
  assert(r.ok === true && num(w.week().b_HDFC__conf_removed) === 1, "a confidently read payment that was removed is counted against the reading");
  const back = w.act("owner", { action: "restoreIgnoredTransaction", archiveRow: r.archiveRow, fp: r.fp });
  assert(back.ok === true && num(w.week().b_HDFC__restored) === 1, "putting it back is counted, so the removal is not held against the reader");
}

console.log("\n--- 5. A recording problem never affects saving ---");
{
  const w = make(); const sb = w.sb;
  const real = sb.fsCommit_;
  sb.fsCommit_ = function(ops){ if(ops.some(function(o){ return o.merge && String(o.merge.path).indexOf("adminStats/") === 0; })) throw new Error("stats down"); return real(ops); };
  const r = w.send("Sent Rs.40.00 From HDFC Bank A/C x1234 To Aarogyumm Cafe On 13/10/26 Ref 665226905838 Not You? Call 18002586161");
  assert(r.ok === true && r.outcome === "SAVED", "the SMS is saved and answered normally even when the counters cannot be written");
  const s = w.act("owner", { action: "saveNote", row: 2, note: "lunch", category: "Food", counterparty: "Cafe A", type: "Want", amount: 120, guess: { c: "Food", t: "Want" } });
  assert(s.ok === true, "the note save works even when the counters cannot be written");
  sb.fsCommit_ = real;
  assert(sb.adminRecordSms_(OWNER, "SAVED", { bank: "HDFC", type: "debit", amount: 1 }, "HDFCBK") === true, "and recording works again afterwards");
  sb.ADMIN_STATS_ENABLED_ = false;
  const snap = JSON.stringify(Object.keys(w.store).filter(function(p){ return p.indexOf("adminStats/") === 0; }).map(function(p){ return [p, w.store[p].fields]; }));
  w.send("Sent Rs.41.00 From HDFC Bank A/C x1234 To Cafe Two On 13/10/26 Ref 665226905111 Not You? Call 18002586161");
  const after = JSON.stringify(Object.keys(w.store).filter(function(p){ return p.indexOf("adminStats/") === 0; }).map(function(p){ return [p, w.store[p].fields]; }));
  assert(snap === after, "with the switch off nothing new is recorded");
  sb.ADMIN_STATS_ENABLED_ = true;
}

console.log("\n--- 6. The score never flatters ---");
{
  const w = make(); const sb = w.sb;
  const cur = sb.adminWeekIndex_(Date.now());
  const wk = function(i, fields){ return { weekIdx: cur - i, fields: fields }; };
  const U = function(weeks){ return sb.adminComputeUnderstanding_(weeks, Date.now()); };

  let u = U([]);
  assert(u.reading.status === "collecting" && u.reading.score === null && u.guessing.score === null && u.handled.score === null, "no data -> nothing is scored");
  assert(!("overall" in u) && !("score" in u), "there is deliberately no single blended 'overall' number");

  u = U([wk(0, { b_HDFC__full: 10 })]);
  assert(u.reading.status === "collecting" && u.reading.score === null && /at least 20/.test(u.reading.why), "10 messages is too few to score, and the reason says why: " + u.reading.why);

  u = U([wk(0, { b_HDFC__full: 30 })]);
  assert(u.reading.status === "unverified" && u.reading.score === null && Math.abs(u.reading.readRate - 1) < 1e-9, "30 messages all read fully but NONE checked by a person -> 'unverified', no score (even though the raw read rate is 100%)");
  assert(/not scored yet/i.test(u.reading.why), "and it says so in words");

  u = U([wk(0, { b_HDFC__full: 25, b_HDFC__rev: 12, b_HDFC__fix: 3 })]);
  assert(u.reading.status === "verified" && Math.abs(u.reading.score - 0.75) < 1e-9, "25 read fully (100%), 12 checked, 3 had the amount corrected -> 100% x 75% = 75%, got " + u.reading.score);
  assert(/Score = 100% x 75% = 75%/.test(u.reading.why), "the reasoning shows the sum: " + u.reading.why);
  assert(u.reading.verdict === "fair", "75% is 'fair', never 'strong': verdict " + u.reading.verdict);

  u = U([wk(0, { b_HDFC__full: 20, b_HDFC__partial: 5, b_HDFC__unc: 5, b_HDFC__rev: 20 })]);
  assert(Math.abs(u.reading.readRate - 20 / 30) < 1e-9 && Math.abs(u.reading.score - 20 / 30) < 1e-9, "partial and 'needs review' messages lower the read rate: 20 of 30 = 67%, got " + u.reading.readRate);

  u = U([wk(0, { b_HDFC__full: 20, b_HDFC__unc: 10, b_HDFC__unc_junk: 10, b_HDFC__rev: 20 })]);
  assert(Math.abs(u.reading.readRate - 1) < 1e-9, "'needs review' messages that turned out to be junk are NOT held against the reader (they were not real transactions)");

  u = U([wk(0, { b_HDFC__full: 40, b_HDFC__rev: 30, g__recon_added: 10 })]);
  assert(Math.abs(u.reading.readRate - 40 / 50) < 1e-9 && u.reading.missedFound === 10, "payments the SMS never delivered (found by a statement check) count against it: 40 of 50 = 80%");

  u = U([wk(0, { b_HDFC__full: 40, b_HDFC__rev: 18, b_HDFC__conf_removed: 4, b_HDFC__restored: 2 })]);
  assert(u.reading.checked === 20 && u.reading.wrong === 2 && Math.abs(u.reading.accuracy - 0.9) < 1e-9, "2 removed and not put back = 2 wrong out of 20 checked (18 saved + 2 removed): accuracy 90%");

  u = U([wk(0, { b_HDFC__full: 30, b_HDFC__rev: 15 }), wk(5, { b_HDFC__partial: 500, b_HDFC__fix: 99 })]);
  assert(u.reading.messages === 30, "a week older than the 4-week window is not part of the headline score");

  // Per bank: a weak new bank is visible and a strong one does not hide it.
  u = U([wk(0, { b_HDFC__full: 60, b_HDFC__rev: 40, b_UNK_NEWBK__unc: 30, b_UNK_NEWBK__ign: 4 })]);
  const hd = u.banks.filter(function(b){ return b.bank === "HDFC"; })[0], nb = u.banks.filter(function(b){ return b.bank === "UNK_NEWBK"; })[0];
  assert(hd && hd.status === "verified" && Math.abs(hd.score - 1) < 1e-9, "the strong bank is scored on its own");
  assert(nb && nb.status === "unverified" && nb.score === null && nb.readRate === 0 && nb.unknownBank === true, "the weak, unnamed bank shows a 0% read rate and is NOT hidden by the strong one");
  assert(u.banks.every(function(b){ return b.messages > 0; }), "a sender that only sent ignored junk is not listed as a bank");

  // Guessing
  u = U([wk(0, { g__cat_kept: 15, g__cat_changed: 5, g__type_kept: 15, g__type_changed: 5, g__revised: 5, g__saves: 25 })]);
  assert(u.guessing.status === "verified" && Math.abs(u.guessing.score - 25 / 40) < 1e-9, "40 guesses, 30 kept, 5 corrected later -> 25 of 40 = 62.5%, got " + u.guessing.score);
  assert(/minus 5 that were corrected later/.test(u.guessing.why) && /not proof/.test(u.guessing.why), "the reasoning names the correction and the limit");
  u = U([wk(0, { g__cat_kept: 10, g__saves: 10 })]);
  assert(u.guessing.status === "collecting" && u.guessing.score === null, "10 guesses is too few");

  // Done for you
  u = U([wk(0, { g__auto: 6, g__saves: 94 })]);
  assert(u.handled.status === "verified" && Math.abs(u.handled.score - 0.06) < 1e-9, "6 settled by the app out of 100 payments = 6% (it is allowed to be low)");

  // Trend
  u = U([wk(1, { b_HDFC__full: 20, b_HDFC__rev: 10, b_HDFC__fix: 1 }), wk(0, { b_HDFC__full: 3 })]);
  const tw = U([wk(0, { b_HDFC__full: 200, b_HDFC__rev: 5 })]);
  assert(tw.reading.status === "unverified" && tw.trend[7].reading === null, "a week with 200 messages and only 5 checks is not plotted on the trend either (same rules as the headline)");
  assert(u.trend.length === 8 && u.trend[6].reading !== null && Math.abs(u.trend[6].reading - 0.9) < 1e-9 && u.trend[7].reading === null, "the trend shows a week only when it has enough data of its own (last week 90%, this week blank)");
  assert(u.blindSpots.length >= 4 && u.blindSpots.every(function(s){ return typeof s === "string" && s.length > 20; }), "the blind spots are always listed in plain words");
}

console.log("\n--- 7. The app's report (adminLog) ---");
{
  const w = make(); const sb = w.sb;
  const body = { action: "adminLog", screens: { pending: 3, history: 2, hacker: 99, cc: -5 }, actions: { saveNote: 4, evil: 9 },
    errors: [{ kind: "server", screen: "saveNote", msg: "Failed for ronit@example.com amount 1,250.50 row 77" }, { kind: "app", screen: "page", msg: "x is not defined" }], version: "2026-10-16-01", platform: "android" };
  const r = w.act("friend", body);
  assert(r.ok === true && r.recorded === true, "a friend (even Splits-only) can send the report: " + JSON.stringify(r));
  const fk = sb.adminPersonKey_(FRIEND), wk = sb.adminWeekIndex_(Date.now());
  const usage = w.store["adminStats/w" + wk + "_" + fk].fields;
  assert(num(usage.s_pending) === 3 && num(usage.s_history) === 2 && !("s_hacker" in usage) && !("s_cc" in usage) && num(usage.a_saveNote) === 4 && !("a_evil" in usage), "only known screens and actions are kept, negatives dropped");
  assert(num(usage.errs) === 2, "two errors counted for this person");
  const pres = w.store["adminStats/p_" + fk].fields;
  assert(pres.version === "2026-10-16-01" && pres.platform === "android" && pres.email === FRIEND && num(pres.lastSeenMs) > 0, "presence: version, platform, last seen");
  const errs = Object.keys(w.store).filter(function(p){ return p.indexOf("adminErrors/") === 0; }).map(function(p){ return w.store[p].fields; });
  assert(errs.length === 2 && errs.every(function(e){ return !/@|\d/.test(e.msg); }), "errors are grouped and stored without e-mail or digits: " + JSON.stringify(errs.map(function(e){ return e.msg; })));
  w.act("friend", body);
  const again = Object.keys(w.store).filter(function(p){ return p.indexOf("adminErrors/") === 0; });
  assert(again.length === 2 && num(w.store[again[0]].fields.count) === 2, "the same error from the same person groups into ONE problem with a count of 2");
  assert(w.act("stranger", body).ok === false, "a stranger cannot send it");
  // caps
  for(let i = 0; i < 100; i++) w.act("friend", { action: "adminLog", screens: { pending: 1 } });
  assert(num(w.store["adminStats/w" + wk + "_" + fk].fields.s_pending) < 100, "a person can send only so many reports a day (cap)");
}

console.log("\n--- 8. The dashboard: owner only, and it adds up ---");
{
  const w = make(); const sb = w.sb;
  w.act("friend", { action: "adminLog", screens: { pending: 4 }, errors: [{ kind: "server", screen: "getPending", msg: "timed out" }], version: "v1", platform: "web" });
  w.act("owner", { action: "adminLog", screens: { pending: 2, home: 5 }, version: "v2", platform: "android" });
  assert(w.act("friend", { action: "getAdminDashboard" }).ok === false, "a friend cannot read the dashboard");
  assert(w.act("stranger", { action: "getAdminDashboard" }).ok === false, "a stranger cannot read the dashboard");
  const d = w.act("owner", { action: "getAdminDashboard" });
  assert(d.ok === true && d.tiles.people === 2, "the owner gets it: " + JSON.stringify(d.tiles));
  const you = d.people.filter(function(p){ return p.isOwner; })[0], vai = d.people.filter(function(p){ return p.email === FRIEND; })[0];
  assert(you && you.version === "v2" && you.platform === "android" && you.lastSeenMs > 0, "last seen, version and platform are shown per person");
  assert(vai && vai.status === "splits" && vai.version === "v1", "a friend without the full app is marked 'Splits only'");
  const pend = d.features.filter(function(f){ return f.screen === "pending"; })[0];
  assert(pend && pend.count === 6 && d.features[0].screen === "pending", "feature use adds up across people (4 + 2) and is sorted most-used first");
  assert(d.problems.length === 1 && d.problems[0].screen === "getPending" && d.problems[0].last7 === 1 && d.problems[0].people === 1, "the problem list groups the error with how often and how many people");
  assert(d.tiles.activeToday === 2 && d.tiles.errorsToday === 1, "active people and errors today are counted");
  w.store["adminErrors/" + d.problems[0].id].fields.lastMs = Date.now() - 5000;      // the error happened a few seconds ago
  const res = w.act("owner", { action: "resolveAdminProblem", id: d.problems[0].id });
  assert(res.ok === true, "the owner can mark a problem resolved");
  assert(w.act("owner", { action: "getAdminDashboard" }).problems.length === 0, "a resolved problem leaves the list");
  w.store["adminErrors/" + d.problems[0].id].fields.resolvedAtMs = Date.now() - 1000;      // resolved a second ago
  w.act("friend", { action: "adminLog", errors: [{ kind: "server", screen: "getPending", msg: "timed out" }] });
  assert(w.act("owner", { action: "getAdminDashboard" }).problems.length === 1, "and it comes back by itself if it happens again afterwards");
  assert(w.act("owner", { action: "resolveAdminProblem", id: "../../x" }).ok === false && w.act("friend", { action: "resolveAdminProblem", id: d.problems[0].id }).ok === false, "a bad id is refused; a friend cannot resolve");
  // A person with the full app who has not received SMS for days is flagged.
  sb.v2dbEnableUser(FRIEND);
  w.store["adminStats/p_" + sb.adminPersonKey_(FRIEND)].fields.lastSmsMs = Date.now() - 5 * 86400000;
  const d2 = w.act("owner", { action: "getAdminDashboard" });
  const vai2 = d2.people.filter(function(p){ return p.email === FRIEND; })[0];
  assert(vai2.status === "warn" && /No SMS for 5 days/.test(vai2.note), "a full-app person with no SMS for 5 days is flagged: " + vai2.note);
  assert(Object.keys(d2).indexOf("understanding") !== -1 && d2.understanding.reading.status === "collecting", "the dashboard carries the understanding block, honestly 'collecting' with no data");
}


console.log("\n--- 3b. Only the same payments are on both sides of the score ---");
{
  // an old-reader (Tasker) row and a row from before recording started: a check on them must not count
  let w = make(function(r){ return [r(120, 555551, "Old reader", "HDFC", "SMS", "Tasker"), r(80, 555552, "Before", "HDFC", "SMS", "Phone")]; }); let sb = w.sb;
  w.store["adminStats/meta"] = { fields: { sinceMs: Date.now() + 3 * 86400000 }, updateTime: "t0" };      // recording "started" three days from now
  w.act("owner", { action: "saveNote", row: 2, note: "a", category: "Food", counterparty: "Old reader", type: "Want", amount: 130 });
  w.act("owner", { action: "saveNote", row: 3, note: "b", category: "Food", counterparty: "Before", type: "Want", amount: 90 });
  assert(num(w.week().b_HDFC__rev) === 0 && num(w.week().b_HDFC__fix) === 0, "a check on an old-reader row, or on a row from before recording started, is not counted as a check: " + JSON.stringify(w.week()));
  assert(num(w.week().g__saves) === 2, "(the payments themselves still count as typed by a person)");

  w = make(function(r){ return [r(70, 666661, "Bulk", "HDFC", "SMS", "Phone"), r(71, 666662, "Normal", "HDFC", "SMS", "Phone"), r(72, 666663, "Removable", "HDFC", "SMS", "Phone")]; }); sb = w.sb;
  w.store["adminStats/meta"] = { fields: { sinceMs: Date.now() - 86400000 }, updateTime: "t0" };
  w.act("owner", { action: "saveNote", row: 2, note: "bulk", category: "Food", counterparty: "Bulk", type: "Want", noCount: true });
  assert(num(w.week().b_HDFC__rev) === 0 && num(w.week().g__saves) === 0, "Reconcile's bulk 'save found notes' counts nothing (no check, no typed payment, no guess)");
  w.act("owner", { action: "saveNote", row: 3, note: "n", category: "Food", counterparty: "Normal", type: "Want", amount: 71 });
  assert(num(w.week().b_HDFC__rev) === 1, "while a normal save of a recorded row IS a check");
  w.act("owner", { action: "saveNote", row: 3, note: "n", category: "Food", counterparty: "Normal", type: "Want", amount: 71 });
  assert(num(w.week().b_HDFC__rev) === 1 && num(w.week().g__saves) === 1, "a double tap counts nothing more");
  w.act("owner", { action: "saveNote", row: 3, note: "n", category: "Food", counterparty: "Normal", type: "Want", amount: 75 });
  assert(num(w.week().b_HDFC__fix) === 1, "but a double-tap-like save that corrects the AMOUNT is counted as a wrong reading");
  const rm = w.act("owner", { action: "markNotATransaction", row: 4 });
  assert(rm.ok && num(w.week().b_HDFC__conf_removed) === 1, "a removal of a recorded row IS counted");
  // Undoing a removal of a 'needs review' row is subtracted from the junk count
  const c = { full: 20, partial: 0, unc: 10, ign: 0, dup: 0, nopayee: 0, rev: 10, fix: 0, unc_junk: 10, unc_restored: 4, conf_removed: 0, restored: 0 };
  const r = sb.adminReadingFor_(c, 0);
  assert(r.messages === 24 && Math.abs(r.readRate - 20 / 24) < 1e-9, "a real message wrongly removed as junk and then put back is a real message again: 24 real, read rate 20/24");
}

console.log("\n--- 3c. Careful wording ---");
{
  const w = make(); const sb = w.sb;
  const cur = sb.adminWeekIndex_(Date.now());
  const U = function(f){ return sb.adminComputeUnderstanding_([{ weekIdx: cur, fields: f }], Date.now()); };
  let u = U({ b_HDFC__full: 500, b_HDFC__rev: 10 });
  assert(u.reading.status === "unverified" && u.reading.score === null, "10 checks out of 500 messages is NOT enough to give a score (needs a quarter of the messages)");
  u = U({ b_HDFC__full: 40, b_HDFC__rev: 20 });
  assert(u.reading.status === "verified" && u.reading.score === 1 && u.reading.verdict === "promising (small sample)", "a perfect score on 20 checks is only 'promising', never 'strong': " + u.reading.verdict);
  u = U({ b_HDFC__full: 120, b_HDFC__rev: 80 });
  assert(u.reading.verdict === "strong", "a perfect score on 80 checks is 'strong'");
  assert(/needed no correction/.test(u.reading.why) && !/were right/.test(u.reading.why), "the words say 'needed no correction', not 'were right'");
  assert(u.blindSpots.some(function(b){ return /balance read as the amount/.test(b); }) && u.blindSpots.some(function(b){ return /old Tasker reader/.test(b); }), "the blind spots name unseen wrong amounts and the excluded old reader");
  u = U({ b_HDFC__full: 40, b_HDFC__rev: 20, g__recon_added: 20 });
  assert(u.banks[0].note && /cannot be assigned to a bank/.test(u.banks[0].note) && u.reading.missedFound === 20, "per-bank rows say that statement-check misses are left out of them");
  u = U({ g__cat_kept: 15, g__type_kept: 15, g__saves: 15 });
  assert(u.guessing.status === "verified" && u.guessing.verdict === "promising (small sample)", "30 untouched pre-filled guesses are 'promising', not 'strong'");
  // keys: ignored and duplicate share one key; a phone-number sender never becomes a field name
  assert(sb.adminBankKey_("", "9876543210") === "UNK" && sb.adminBankKey_("", "VM-BOBSMS-S") === "UNK_BOBSMS", "a digits-only sender is never used as a name");
  sb.adminRecordSms_(OWNER, "IGNORED", {}, "AD-PROMO"); sb.adminRecordSms_(OWNER, "DUPLICATE", {}, "VM-OTHER");
  const keys = Object.keys((w.store["adminStats/u_" + cur] || { fields: {} }).fields).filter(function(k){ return /^b_/.test(k); });
  assert(keys.every(function(k){ return /^b_ALL__/.test(k); }), "ignored and duplicate messages use one shared key, so these fields cannot grow without limit: " + keys.join());
}

console.log("\n--- 9. The phone-side reporter (code taken from index.html) ---");
{
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const a = html.indexOf("    const adminSeen = {"), b = html.indexOf("    function callAppsScriptInner(payload) {");
  assert(a > 0 && b > a, "found the reporter code in index.html");
  const code = html.slice(a, b);
  function app(demo){
    const sent = [];
    const sb2 = { console: console, JSON: JSON, Object: Object, String: String, Array: Array, Promise: Promise, RegExp: RegExp,
      demoMode: !!demo, currentUser: { idToken: "tok" }, APP_VERSION: "2026-10-16-01",
      navigator: { userAgent: "Mozilla FinAppNativeAndroid" }, document: { addEventListener: function(){}, visibilityState: "visible" },
      window: { addEventListener: function(){} }, setInterval: function(){}, setTimeout: function(){},
      callAppsScriptInner: function(p){ sent.push(p); return Promise.resolve(p.reply === undefined ? { ok: true } : p.reply); } };
    vm.createContext(sb2);
    vm.runInContext(code + "\nthis.__t = { call: callAppsScript, flush: adminFlush, seen: adminSeen, screen: adminTrackScreen, err: adminTrackError };", sb2);
    return { t: sb2.__t, sent: sent };
  }
  (async function(){
    let x = app(false);
    const same = await x.t.call({ action: "getPending", reply: { ok: true, transactions: [1, 2] } });
    assert(same.ok === true && same.transactions.length === 2, "a watched request returns exactly what it would have returned");
    await x.t.call({ action: "saveNote", reply: { ok: false, error: "Couldn't save" } });
    await x.t.call({ action: "saveNote", reply: { ok: false, stale: true, error: "This list was out of date" } });
    await x.t.call({ action: "adminLog", reply: { ok: false, error: "nope" } });
    await new Promise(function(r){ setImmediate(r); });
    assert(x.t.seen.errors.length === 1 && x.t.seen.errors[0].msg === "Couldn't save" && x.t.seen.errors[0].screen === "saveNote", "a failed answer is recorded; a 'stale' refresh and the report's own failures are not");
    assert(x.t.seen.actions.saveNote === 2, "the save was counted twice (counts only)");
    x.t.err("app", "page", "ResizeObserver loop completed with undelivered notifications");
    x.t.err("app", "page", "Script error.");
    assert(x.t.seen.errors.length === 1, "harmless browser noise is ignored");
    x.t.screen("history"); x.t.screen("history"); x.t.screen("cash");
    assert(x.t.seen.screens.history === 2 && x.t.seen.screens.cash === 1, "screen opens are counted");
    x.sent.length = 0;
    x.t.flush();
    assert(x.sent.length === 1 && x.sent[0].action === "adminLog" && x.sent[0].version === "2026-10-16-01" && x.sent[0].platform === "android" && x.sent[0].idToken === "tok", "one small report is sent with version and platform");
    assert(Object.keys(x.t.seen.screens).length === 0 && x.t.seen.errors.length === 0, "and the counters start again from zero");
    x.sent.length = 0; x.t.flush();
    assert(x.sent.length === 0, "nothing new -> nothing sent");
    x = app(true);
    x.t.screen("history"); x.t.err("app", "page", "boom"); await x.t.call({ action: "saveNote", reply: { ok: false, error: "x" } });
    assert(Object.keys(x.t.seen.screens).length === 0 && x.t.seen.errors.length === 0 && Object.keys(x.t.seen.actions).length === 0, "Demo Mode records and sends nothing");
    console.log("\nAll checks passed.");
  })();
}
