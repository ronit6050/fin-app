// backend/tests/cardCoach.test.js
//
// Plain-English what this checks: "Card Coach" (backend/cardCoach.js, 2026-10-18) - the calm "safe to put on the card" block that
// getCCAdvisorData now returns as `coach`, the ONE extra line on a card swipe's notification, and the "card bill due in 3 days" reminder.
//   A. the pure coach: cycle edges (18th vs 19th, December -> January), fixed-bill detection, "you decide" (a Want tag always wins),
//      unsorted swipes counted, wants limit + suggestion, safe-to-put (positive / negative / unknown / 30% cap, never counting a rupee twice),
//      the paid-in-full streak, the bill plan lines; any failure -> null.
//   B. the notification line: all variants, and the cases that must stay silent.
//   C. getCCAdvisorData carries `coach` and is otherwise unchanged.
//   D. the real push built by the timer carries the line (and never breaks without it).
//   E. the reminder: once per bill, not when paid, not outside the 3-day window, quiet hours, per-person switch.
//   F. the two new Settings values round-trip.
// All data is invented. Run with: node backend/tests/cardCoach.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

// ---------- a bare sandbox holding only the pure coach code ----------
function pureSandbox(){
  const sb = { console: console, Utilities: { formatDate: function(d){ return String(d); } } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "cardCoach.js"), "utf8"), sb, { filename: "cardCoach.js" });
  return sb;
}
const P = pureSandbox();
const D = function(y, m, d){ return new Date(y, m - 1, d); };

const HEADER = ["Date", "Time", "Bank", "Type", "Mode", "Amount", "Reference", "Counterparty", "Channel", "Source", "RawSMS", "Sender", "Note", "Category", "TelegramMsgID", "Processed", "NeedWantSaving", "FinancialEvent", "FinancialEventName"];
function row(date, amount, o){
  o = o || {};
  const r = new Array(19).fill("");
  r[0] = date; r[1] = "10:00"; r[2] = "HDFC"; r[3] = o.type || "debit"; r[4] = o.mode || "card 1264"; r[5] = amount;
  r[7] = o.cp === undefined ? "Some Shop" : o.cp; r[12] = o.note || ""; r[13] = o.cat || "Other"; r[15] = "YES";
  r[16] = o.tag || ""; r[17] = o.event || "";
  return r;
}
const TODAY = D(2026, 10, 25);    // current cycle: 19 Oct - 18 Nov, due 9 Dec.  Closed 0: 19 Sep - 18 Oct (due 9 Nov); 1: 19 Aug - 18 Sep; 2: 19 Jul - 18 Aug.
const LIMIT = 50000;
function coachOf(rows, extra){
  return P.getCardCoach_(Object.assign({ txnData: [HEADER].concat(rows), today: TODAY, limit: LIMIT, wantsLimitSetting: 0, outstanding: null, runway: null, obligations: [] }, extra || {}));
}

console.log("\n--- A1. Cycle edges: the 18th belongs to the closing bill, the 19th starts the next ---");
{
  const c = coachOf([row(D(2026, 10, 18), 1000), row(D(2026, 10, 19), 2000), row(D(2026, 10, 25), 300)]);
  assert(c.cycleSpent === 2300, "swipes on the 19th and later are this cycle's (18th is the old bill): " + c.cycleSpent);
  assert(c.safeUntil === "2026-12-09", "this cycle's swipes land in the bill due 9 Dec: " + c.safeUntil);
  const jan = P.getCardCoach_({ txnData: [HEADER, row(D(2026, 12, 18), 111), row(D(2026, 12, 19), 222), row(D(2027, 1, 4), 33)], today: D(2027, 1, 5), limit: LIMIT, wantsLimitSetting: 0, outstanding: null, runway: null, obligations: [] });
  assert(jan.cycleSpent === 255, "January: 19 Dec onwards is this cycle, 18 Dec is the old bill: " + jan.cycleSpent);
  assert(jan.safeUntil === "2027-02-09", "December -> January rolls over to a 9 Feb due date: " + jan.safeUntil);
  const dec = P.getCardCoach_({ txnData: [HEADER, row(D(2026, 12, 20), 500)], today: D(2026, 12, 20), limit: LIMIT, wantsLimitSetting: 0, outstanding: null, runway: null, obligations: [] });
  assert(dec.safeUntil === "2027-02-09", "on 20 Dec the cycle 19 Dec - 18 Jan is due 9 Feb: " + dec.safeUntil);
  const onClose = P.getCardCoach_({ txnData: [HEADER, row(D(2026, 10, 18), 400), row(D(2026, 10, 19), 100)], today: D(2026, 10, 18), limit: LIMIT, wantsLimitSetting: 0, outstanding: null, runway: null, obligations: [] });
  assert(onClose.cycleSpent === 0 && onClose.safeUntil === "2026-12-09", "on the 18th itself the new cycle has just begun (same rule as CC Advisor): nothing counted yet, due 9 Dec: " + onClose.cycleSpent + " " + onClose.safeUntil);
}

console.log("\n--- A2. Fixed bills: same merchant in 2 of the last 3 closed cycles, amounts within 25% ---");
{
  const hist = [
    row(D(2026, 7, 25), 649, { cp: "NETFLIX 1234" }), row(D(2026, 8, 25), 650, { cp: "Netflix" }), row(D(2026, 9, 25), 649, { cp: "netflix" }),
    row(D(2026, 8, 5), 100, { cp: "Gym" }), row(D(2026, 9, 5), 300, { cp: "Gym" }),            // 100 vs 300: not within 25%
    row(D(2026, 9, 6), 900, { cp: "One Time Store" })
  ];
  const c = coachOf(hist.concat([row(D(2026, 10, 25), 649, { cp: "NETFLIX" }), row(D(2026, 10, 26 - 1), 300, { cp: "Gym" }), row(D(2026, 10, 24), 450, { cp: "One Time Store" })]));
  assert(c.split.fixed === 649, "Netflix (digits and capitals ignored) is fixed: " + JSON.stringify(c.split));
  assert(c.fixedMerchants.length === 1 && c.fixedMerchants[0] === "NETFLIX", "and is named: " + JSON.stringify(c.fixedMerchants));
  assert(c.split.unsorted === 750, "the gym (amounts too different) and a one-time store are not fixed: " + c.split.unsorted);
  // only ONE closed cycle with a charge -> not fixed
  const one = coachOf([row(D(2026, 9, 25), 649, { cp: "Streamy" }), row(D(2026, 10, 25), 649, { cp: "Streamy" })]);
  assert(one.split.fixed === 0, "a merchant seen in only one earlier cycle is not fixed");
  // a swipe the app already marked as a Rent/EMI/SIP event is fixed on its own
  const ev = coachOf([row(D(2026, 9, 25), 4000, { cp: "Dad", event: "EMI" }), row(D(2026, 10, 25), 4000, { cp: "Dad" })]);
  assert(ev.split.fixed === 4000, "a merchant with a Financial Event in its history is fixed");
}

console.log("\n--- A3. The person decides: a Want tag always wins; Need/Saving/Investment count as need; untagged is unsorted ---");
{
  const hist = [row(D(2026, 8, 25), 649, { cp: "Netflix" }), row(D(2026, 9, 25), 649, { cp: "Netflix" })];
  const c = coachOf(hist.concat([
    row(D(2026, 10, 21), 649, { cp: "Netflix", tag: "Want" }),     // recurring, but the person called it a Want
    row(D(2026, 10, 22), 649, { cp: "Netflix" }),                   // recurring, no tag -> fixed
    row(D(2026, 10, 23), 1000, { tag: "Need" }), row(D(2026, 10, 23), 500, { tag: "Saving" }), row(D(2026, 10, 23), 250, { tag: "Investment" }),
    row(D(2026, 10, 24), 800, { tag: "Want", cp: "Mall" }), row(D(2026, 10, 24), 120, { cp: "Kiosk" })
  ]));
  assert(c.split.want === 649 + 800, "Want-tagged swipes (even from a recurring merchant) are wants: " + c.split.want);
  assert(c.split.fixed === 649, "the untagged Netflix swipe is fixed: " + c.split.fixed);
  assert(c.split.need === 1750, "Need + Saving + Investment tags land in need: " + c.split.need);
  assert(c.split.unsorted === 120, "an untagged one-off is unsorted: " + c.split.unsorted);
  assert(c.cycleSpent === c.split.fixed + c.split.need + c.split.want + c.split.unsorted, "the four parts add up to the cycle spend");
  // rows that are not card swipes never count
  const d = coachOf([row(D(2026, 10, 22), 900, { mode: "upi" }), row(D(2026, 10, 22), 900, { type: "credit" }), row(D(2026, 10, 22), 0), row(D(2026, 10, 22), 70)]);
  assert(d.cycleSpent === 70, "UPI, credits and zero rows are not card swipes: " + d.cycleSpent);
}

console.log("\n--- A4. Wants limit, suggestion and wantsOver ---");
{
  const wantRow = function(date, amt){ return row(date, amt, { tag: "Want", cp: "Fun " + amt + date.getMonth() }); };
  const history = [wantRow(D(2026, 8, 1), 3000), wantRow(D(2026, 9, 1), 4000), wantRow(D(2026, 10, 1), 5000)];   // cycles 2, 1, 0
  const c = coachOf(history.concat([wantRow(D(2026, 10, 22), 3500)]), { wantsLimitSetting: 2000 });
  assert(c.wantsLimit === 2000 && c.wantsOver === 1500, "wants 3,500 against a limit of 2,000 -> 1,500 over: " + c.wantsOver);
  assert(c.suggestedWantsLimit === 4000, "suggestion = average of the closed cycles' wants (3,000/4,000/5,000), nearest 500: " + c.suggestedWantsLimit);
  assert(c.tone === "over", "a wants overspend makes the tone 'over'");
  const none = coachOf(history.concat([wantRow(D(2026, 10, 22), 3500)]));
  assert(none.wantsLimit === null && none.wantsOver === null, "no limit set -> wantsLimit and wantsOver are null");
  const under = coachOf([wantRow(D(2026, 10, 22), 900)], { wantsLimitSetting: 2000 });
  assert(under.wantsOver === 0, "under the limit -> wantsOver 0 (not negative)");
  assert(under.suggestedWantsLimit === 5000, "no closed-cycle history -> 10% of the limit (5,000): " + under.suggestedWantsLimit);
  const big = coachOf([row(D(2026, 9, 5), 30000, { tag: "Want", cp: "Big" })]);
  assert(big.suggestedWantsLimit === 10000, "a huge past want is capped at 20% of the limit: " + big.suggestedWantsLimit);
  const tiny = P.getCardCoach_({ txnData: [HEADER], today: TODAY, limit: 4000, wantsLimitSetting: 0, outstanding: null, runway: null, obligations: [] });
  assert(tiny.suggestedWantsLimit === 1000, "never below 1,000: " + tiny.suggestedWantsLimit);
}

console.log("\n--- A5. Safe to put: positive, negative, unknown, the 30% cap, nothing counted twice ---");
{
  const swipes = [row(D(2026, 10, 22), 6000, { cp: "Shop A" })];     // S = 6,000 this cycle
  const outstandingUnpaid = { total: 8000, isPaid: false, isOverdue: false, daysUntilDue: 15, dueDate: D(2026, 11, 9) };
  const runway = function(balance, o){ return Object.assign({ estimatedBalance: balance, billsAhead: 15000, bills: [{ label: "Rent", amount: 15000, daysUntil: 3 }], dailyPace: 700, daysToSalary: 10, salaryDate: "2026-11-04" }, o || {}); };
  // worked example: 60,000 - 15,000 (rent) - 8,000 (closed card bill, due after salary so the runway left it out) - 7,000 (10 days x 700) - 6,000 (swipes) = 24,000 free; 30% cap = 15,000 - 6,000 = 9,000
  let c = coachOf(swipes, { runway: runway(60000), outstanding: outstandingUnpaid });
  assert(c.safeToPut === 9000, "plenty of money: the 30% cap (9,000 = 15,000 - 6,000 already used) is the limit: " + c.safeToPut);
  assert(c.utilisationWatch === false && c.tone === "watch", "9,000 left is under 20% of the limit (10,000): tone watch: " + c.tone);
  c = coachOf([row(D(2026, 10, 22), 1000)], { runway: runway(200000) });
  assert(c.safeToPut === 14000 && c.tone === "ok", "lots of room (cap 15,000 - 1,000 = 14,000): tone ok: " + c.safeToPut + " " + c.tone);
  // 40,000 -> free = 4,000, below the cap
  c = coachOf(swipes, { runway: runway(40000), outstanding: outstandingUnpaid });
  assert(c.safeToPut === 4000 && c.tone === "watch", "less money: safe 4,000 and tone watch (under 20% of the limit): " + c.safeToPut + " " + c.tone);
  // 30,000 -> free = -6,000: already over
  c = coachOf(swipes, { runway: runway(30000), outstanding: outstandingUnpaid });
  assert(c.safeToPut === -6000 && c.tone === "over", "already past the safe amount: negative and tone over: " + c.safeToPut + " " + c.tone);
  // the closed card bill counted by the runway itself (due before salary) must NOT be subtracted a second time
  c = coachOf(swipes, { runway: runway(60000, { billsAhead: 23000, bills: [{ label: "Rent", amount: 15000 }, { label: "Card bill", amount: 8000 }] }), outstanding: outstandingUnpaid });
  assert(c.safeToPut === 9000, "a card bill the runway already counted is not subtracted again (24,000 free either way): " + c.safeToPut);
  c = coachOf(swipes, { runway: runway(40000, { billsAhead: 23000, bills: [{ label: "Rent", amount: 15000 }, { label: "Card bill", amount: 8000 }] }), outstanding: outstandingUnpaid });
  assert(c.safeToPut === 4000, "...same with less money (40,000 - 23,000 - 7,000 - 6,000 = 4,000): " + c.safeToPut);
  // a PAID closed bill reduces nothing
  c = coachOf(swipes, { runway: runway(40000), outstanding: Object.assign({}, outstandingUnpaid, { isPaid: true }) });
  assert(c.safeToPut === 9000, "a paid closed bill is not subtracted (40,000 - 15,000 - 7,000 - 6,000 = 12,000, capped at 9,000): " + c.safeToPut);
  // 30% cap: never suggests going past it, even with huge money
  c = coachOf([row(D(2026, 10, 22), 14000)], { runway: runway(900000) });
  assert(c.safeToPut === 1000, "never past 30%: 15,000 - 14,000 = 1,000 even with 9 lakh in the bank: " + c.safeToPut);
  c = coachOf([row(D(2026, 10, 22), 16000)], { runway: runway(900000) });
  assert(c.safeToPut === -1000 && c.tone === "over" && c.utilisationWatch === true, "already past 30% -> negative, over: " + c.safeToPut);
  // unknown: no balance checkpoint / no runway
  c = coachOf(swipes, { runway: Object.assign(runway(0), { estimatedBalance: null }) });
  assert(c.safeToPut === null && c.tone === "unknown", "no balance checkpoint -> null and tone unknown: " + c.safeToPut + " " + c.tone);
  c = coachOf(swipes);
  assert(c.safeToPut === null && c.tone === "unknown", "no runway at all -> unknown");
  c = coachOf([row(D(2026, 10, 22), 16000)]);
  assert(c.safeToPut === null && c.tone === "watch" && c.utilisationWatch === true, "unknown money but 30% already used -> watch (this part needs no balance)");
  // salary day unknown -> a 30-day horizon is assumed (more cautious)
  c = coachOf(swipes, { runway: runway(60000, { daysToSalary: null, salaryDate: null }), outstanding: outstandingUnpaid });
  assert(c.safeToPut === 9000, "unknown salary day: 30 days of living costs (21,000) assumed; free = 10,000, capped at 9,000: " + c.safeToPut);
  c = coachOf(swipes, { runway: runway(50000, { daysToSalary: null, salaryDate: null }), outstanding: outstandingUnpaid });
  assert(c.safeToPut === 0, "...and with 50,000 free is exactly 0: " + c.safeToPut);
  c = coachOf(swipes, { runway: runway(60000, { daysToSalary: null, salaryDate: null }), outstanding: outstandingUnpaid });
  assert(c.limitUsedPct === 12, "limitUsedPct is the cycle spend as a % of the limit (6,000 / 50,000): " + c.limitUsedPct);
}

console.log("\n--- A6. The closed bill and the plan around it ---");
{
  const out = { total: 8000, isPaid: false, isOverdue: false, daysUntilDue: 15, dueDate: D(2026, 11, 9) };
  const rw = { estimatedBalance: 50000, billsAhead: 15000, bills: [], dailyPace: 700, daysToSalary: 10, salaryDate: "2026-11-04" };
  const obligations = [
    { label: "Rent", enoughHistory: true, alreadyThisMonth: false, daysUntil: 8, avgAmount: 15000 },
    { label: "Laptop EMI", enoughHistory: true, alreadyThisMonth: true, daysUntil: 9, avgAmount: 4000 },        // already paid this month: not planned
    { label: "SIP", enoughHistory: true, alreadyThisMonth: false, daysUntil: 20, avgAmount: 2000 },             // after the bill's due date: not planned
    { label: "New", enoughHistory: false }
  ];
  const txn = [row(D(2026, 9, 20), 45000, { type: "credit", cat: "Income", cp: "Employer" }), row(D(2026, 10, 22), 100)];
  const c = coachOf(txn, { outstanding: out, runway: rw, obligations: obligations });
  assert(c.bill && c.bill.amount === 8000 && c.bill.dueDate === "2026-11-09" && c.bill.daysUntilDue === 15 && c.bill.isPaid === false && c.bill.isOverdue === false, "bill basics: " + JSON.stringify(c.bill && { a: c.bill.amount, d: c.bill.dueDate }));
  const labels = c.bill.planLines.map(function(l){ return l.label + ":" + l.sign + ":" + l.amount; });
  assert(labels.join("|") === "Salary expected 4 Nov:1:45000|Rent:-1:15000|Card bill:-1:8000", "plan = salary in, Rent out (only bills before the due date and not yet paid), card bill out: " + labels.join("|"));
  assert(c.bill.leftUntilSalary === 35000, "leftUntilSalary = balance - bills before salary (50,000 - 15,000): " + c.bill.leftUntilSalary);
  const paid = coachOf(txn, { outstanding: Object.assign({}, out, { isPaid: true }), runway: rw, obligations: obligations });
  assert(paid.bill.isPaid === true && paid.bill.planLines.length === 0, "a paid bill has no plan lines");
  const none = coachOf(txn, { outstanding: { total: 0, isPaid: false, isOverdue: false, daysUntilDue: 15, dueDate: D(2026, 11, 9) }, runway: rw });
  assert(none.bill === null, "no closed bill -> bill is null");
  const noRunway = coachOf(txn, { outstanding: out });
  assert(noRunway.bill.leftUntilSalary === null && noRunway.bill.planLines.length === 1, "no runway: leftUntilSalary null, only the bill line");
}

console.log("\n--- A7. Paid-in-full streak ---");
{
  // closed 0 (19 Sep - 18 Oct): 9,000.  closed 1 (19 Aug - 18 Sep): 5,000 paid on 9 Sep... (payments after 18 Aug, up to 18 Sep).  closed 2: 3,000 not paid.
  const swipes = [row(D(2026, 9, 25), 9000), row(D(2026, 8, 25), 5000), row(D(2026, 7, 25), 3000), row(D(2026, 6, 25), 2000)];
  const pay1 = row(D(2026, 10, 9), 5000, { mode: "upi", cp: "Bank", cat: "Bills" });     // pays the bill that closed 18 Sep (due 9 Oct)
  const pay0 = row(D(2026, 11, 8), 9000, { mode: "upi", cp: "HDFC CREDIT CARD", cat: "Bills" });
  const out = function(o){ return Object.assign({ total: 9000, isPaid: true, isOverdue: false, daysUntilDue: 15, dueDate: D(2026, 11, 9) }, o || {}); };
  let c = coachOf(swipes.concat([pay1]), { outstanding: out() });
  assert(c.paidInFullStreak === 2, "latest bill paid + the one before paid, the one before that not: streak 2: " + c.paidInFullStreak);
  c = coachOf(swipes.concat([pay1]), { outstanding: out({ isPaid: false }) });
  assert(c.paidInFullStreak === 1, "an open (not yet due) latest bill neither counts nor breaks it: streak 1: " + c.paidInFullStreak);
  c = coachOf(swipes.concat([pay1]), { outstanding: out({ isPaid: false, isOverdue: true, daysUntilDue: -3 }) });
  assert(c.paidInFullStreak === 0, "an overdue bill -> 0");
  c = coachOf([row(D(2026, 10, 22), 100)]);
  assert(c.paidInFullStreak === null, "no closed bill at all -> null (not determinable)");
  const wording = swipes.concat([row(D(2026, 10, 9), 4990, { mode: "upi", cp: "x", note: "credit card bill" })]);
  c = coachOf(wording, { outstanding: out(), isBillWording: function(m, cp, n){ return /credit card/i.test(String(cp) + " " + String(n)); } });
  assert(c.paidInFullStreak === 1, "a payment of the wrong size but with 'credit card bill' wording and a short amount is NOT enough on its own (only 4,990 of 5,000): " + c.paidInFullStreak);
}

console.log("\n--- A8. Any failure -> null ---");
{
  assert(P.getCardCoach_(null) === null && P.getCardCoach_({}) === null, "no input -> null");
  assert(P.getCardCoach_({ txnData: [HEADER, null], today: TODAY, limit: LIMIT }) === null, "a broken row -> null, no throw");
  assert(P.getCardCoach_({ txnData: [HEADER], today: TODAY, limit: 0 }) === null, "no limit -> null");
  assert(P.getCardCoach_({ txnData: [HEADER], today: TODAY, limit: LIMIT, runway: { get estimatedBalance(){ throw new Error("boom"); } } }) === null, "a runway that explodes -> null");
}

console.log("\n--- B. The notification line ---");
{
  const coach = function(o){ return Object.assign({ safeToPut: 8200, tone: "ok", fixedMerchants: ["Netflix"] }, o || {}); };
  const swipe = function(o){ o = o || {}; const r = row(D(2026, 10, 25), o.amount === undefined ? 1500 : o.amount, { cp: o.cp === undefined ? "Mall" : o.cp, mode: o.mode || "card 1264", type: o.type, event: o.event }); if(o.ref) r[6] = o.ref; return r; };
  assert(P.cardCoachPushLine_(coach(), swipe()) === "Safe left on card: ₹8,200.", "room left: 'Safe left on card: ₹8,200.'");
  assert(P.cardCoachPushLine_(coach({ safeToPut: 0 }), swipe()) === "Safe left on card: ₹0.", "exactly zero is still 'safe left' (₹0)");
  assert(P.cardCoachPushLine_(coach({ safeToPut: -400 }), swipe({ amount: 1500 })) === "That is ₹400 past your safe amount; it comes out of next salary.", "this swipe pushed it 400 below zero");
  assert(P.cardCoachPushLine_(coach({ safeToPut: -3000 }), swipe({ amount: 1500 })) === "That is ₹1,500 past your safe amount; it comes out of next salary.", "already over before: only THIS swipe's part is 'past' (1,500)");
  assert(P.cardCoachPushLine_(coach(), swipe({ amount: 199 })) === "" && P.cardCoachPushLine_(coach(), swipe({ amount: 200 })) !== "", "under Rs 200 stays silent; 200 gets a line");
  assert(P.cardCoachPushLine_(coach(), swipe({ cp: "NETFLIX 2" })) === "", "a recurring (fixed) merchant stays silent");
  assert(P.cardCoachPushLine_(coach(), swipe({ event: "EMI" })) === "", "a row already marked Rent/EMI/SIP stays silent");
  assert(P.cardCoachPushLine_(coach(), swipe({ mode: "upi" })) === "" && P.cardCoachPushLine_(coach(), swipe({ type: "credit" })) === "", "UPI and credits stay silent");
  assert(P.cardCoachPushLine_(coach({ safeToPut: null, tone: "unknown" }), swipe()) === "" && P.cardCoachPushLine_(null, swipe()) === "", "unknown money picture / no coach -> silent");
  const line = P.cardCoachPushLine_(coach({ safeToPut: -400 }), swipe());
  assert(!/(should|shouldn't|guilty|bad|careful|stop|overspent|blame)/i.test(line), "calm wording, no guilt words: " + line);
}

// ---------- worlds with the real files, for C, D, E, F ----------
const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "investmentInstruments.js", "savingsGoals.js",
  "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "obligationReminders.js", "runway.js", "settings.js", "cardCoach.js", "v2route.js", "flags.js", "v2db.js"
];
// The worlds below run with a FIXED clock (25 Oct 2026, noon) so the tests mean the same on any day, including the 18th.
const FIXED_NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();
class FixedDate extends Date {
  constructor(...a){ if(a.length) super(...a); else super(FIXED_NOW); }
  static now(){ return FIXED_NOW; }
}
const inClosed0 = D(2026, 9, 25);     // inside the bill that closed 18 Oct (19 Sep - 18 Oct)
const inCurrent = D(2026, 10, 22);    // inside the running cycle (19 Oct - 18 Nov)
const FE_HEADER = ["Type", "Amount", "Counterparty", "Confirmed", "Name"];

function world(rows, opts){
  opts = opts || {};
  const w = makeWorld(FILES);
  w.sb.Date = FixedDate;
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("FinancialEvents", [FE_HEADER]);
  w.addSheet("Investments", [["Date", "Name", "Amount", "Note"]]);
  w.addSheet("SmartMemory", [["Merchant", "Category", "Subcategory", "Confidence", "TimesUsed", "LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant", "AmountBand", "Type", "Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category"]]);
  w.addSheet("Goals", [["h"]]); w.addSheet("Savings", [["h"]]);
  if(opts.checkpoint){ w.props.RUNWAY_BALANCE = String(opts.checkpoint); w.props.RUNWAY_BALANCE_AT = String(FIXED_NOW - 86400000); }
  return w;
}

console.log("\n--- C. getCCAdvisorData carries `coach` and is otherwise unchanged ---");
{
  const rows = [row(inClosed0, 3000, { cp: "Shop A" }), row(inCurrent, 1200, { cp: "Shop B", tag: "Want" })];
  const withCoach = world(rows, { checkpoint: 90000 });
  const a = withCoach.sb.getCCAdvisorData(withCoach.sheets.Transactions.getDataRange().getValues(), [[]], { fixedObligations: 0, invested: 0, totalDebit: 20000 }, 0);
  const noCoachFiles = FILES.filter(function(f){ return f !== "cardCoach.js"; });
  const bare = makeWorld(noCoachFiles);
  bare.sb.Date = FixedDate;
  bare.addSheet("Transactions", [HEADER].concat(rows)); bare.addSheet("Cash", [["h"]]); bare.addSheet("FinancialEvents", [FE_HEADER]);
  bare.addSheet("Goals", [["h"]]); bare.addSheet("Savings", [["h"]]);
  const b = bare.sb.getCCAdvisorData(bare.sheets.Transactions.getDataRange().getValues(), [[]], { fixedObligations: 0, invested: 0, totalDebit: 20000 }, 0);
  assert(a.coach && a.coach.cycleSpent === 1200 && a.coach.split.want === 1200, "coach is present and counts this cycle's swipe: " + JSON.stringify(a.coach && a.coach.split));
  assert(a.coach.bill && a.coach.bill.amount === 3000, "and the closed bill (3,000)");
  assert(typeof a.coach.safeToPut === "number", "with a balance checkpoint the safe amount is a number: " + a.coach.safeToPut);
  const strip = function(x){ const c = JSON.parse(JSON.stringify(x)); delete c.coach; return JSON.stringify(c); };
  if(strip(a) !== strip(b)){ const x = JSON.parse(strip(a)), y = JSON.parse(strip(b)); Object.keys(x).forEach(function(k){ if(JSON.stringify(x[k]) !== JSON.stringify(y[k])) console.log("DIFF key", k, JSON.stringify(x[k]).slice(0, 200), JSON.stringify(y[k]).slice(0, 200)); }); }
  assert(b.coach === null && strip(a) === strip(b), "everything else in the result is byte-identical to before");
  assert(a.outstanding.amount === 3000 && a.cycleSpend === 1200, "(the old fields are still right)");
  // failure inside the coach must not touch the rest
  withCoach.sb.getCardCoach_ = function(){ throw new Error("boom"); };
  const c = withCoach.sb.getCCAdvisorData(withCoach.sheets.Transactions.getDataRange().getValues(), [[]], { fixedObligations: 0, invested: 0, totalDebit: 20000 }, 0);
  assert(c.coach === null && strip(c) === strip(b), "if the coach throws, coach is null and nothing else changes");
}

console.log("\n--- D. The real notification built by the timer ---");
{
  // 3 earlier unprocessed? no: everything before is processed; the NEW row is an unprocessed card swipe of 1,500.
  const newRow = function(amount, o){ const r = row(inCurrent, amount, Object.assign({ cp: "Big Mall" }, o || {})); r[15] = ""; return r; };
  const run = function(rows, opts){
    const w = world(rows, opts);
    w.props.lastCheckedRow = String(rows.length);
    w.sb.processNewTransactions();
    return w.pushes.filter(function(p){ return /New Transaction/.test(p.title); });
  };
  const history = [row(inClosed0, 500, { cp: "Old Shop" })];
  let pushes = run(history.concat([newRow(1500)]), { checkpoint: 120000 });
  assert(pushes.length === 1 && /Safe left on card: ₹[\d,]+\./.test(pushes[0].body), "a card swipe's push carries the safe-left line: " + (pushes[0] && pushes[0].body.replace(/\n/g, " / ")));
  assert(pushes[0].body.split("\n").length === 2 || /Save as|Tap to save/.test(pushes[0].body), "one extra line only");
  pushes = run(history.concat([newRow(1500)]), {});
  assert(pushes.length === 1 && !/Safe left|past your safe/.test(pushes[0].body), "no balance checkpoint -> the push is exactly as before (no extra line)");
  pushes = run(history.concat([newRow(150)]), { checkpoint: 120000 });
  assert(pushes.length === 1 && !/Safe left|past your safe/.test(pushes[0].body), "a tiny swipe (under Rs 200) -> no extra line");
  pushes = run(history.concat([newRow(1500, { mode: "upi" })]), { checkpoint: 120000 });
  assert(pushes.length === 1 && !/Safe left|past your safe/.test(pushes[0].body), "a UPI payment -> no extra line");
  pushes = run(history.concat([newRow(40000)]), { checkpoint: 2000 });
  assert(pushes.length === 1 && /past your safe amount; it comes out of next salary\./.test(pushes[0].body), "a swipe that goes past the safe amount says so calmly: " + (pushes[0] && pushes[0].body.replace(/\n/g, " / ")));
  // a failing coach never breaks or removes the notification
  const w = world(history.concat([newRow(1500)]), { checkpoint: 120000 });
  w.props.lastCheckedRow = "2";
  w.sb.cardCoachForPush_ = function(){ throw new Error("boom"); };
  w.sb.processNewTransactions();
  const p = w.pushes.filter(function(x){ return /New Transaction/.test(x.title); });
  assert(p.length === 1 && !/Safe left/.test(p[0].body) && w.sheets.Transactions.rows[2][15] === "YES", "if the coach breaks, the notification still goes out and the row is marked done");
}

console.log("\n--- E. The bill reminder ---");
{
  const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
  const crypto = require("crypto");
  const o = build(); const sb = o.sb;
  sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
  sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
  const sent = [];
  sb.sendPushToToken_ = function(token, title, body, extra){ sent.push({ token: token, title: title, body: body, extra: extra }); return { sent: true, code: 200 }; };
  sb.sendPushNotification = function(){};
  const ND = o.D;
  // the reminder day: 2 days before the 9th of THIS or next month (any fixed day works - the rows are built from the same cycle maths)
  const dueY = 2026, dueM = 10;                                            // 0-based month 10 = November: the bill due 9 Nov 2026
  const dueDate = new ND(dueY, dueM, 9);                                   // closed(0) of a "7th of the month" day is the one due on the 9th
  const nowMs = new ND(dueY, dueM, 7, 12, 0, 0).getTime();
  const todayAtNow = new ND(dueY, dueM, 7);
  const w0 = P.cardCoachCycles_(todayAtNow).closed(0);
  assert(P.cardCoachIso_(w0.due) === P.cardCoachIso_(dueDate), "(test setup: the bill reminded about is due on the 9th)");
  const swipe = function(date, amount, mode, cp){ const r = row(date, amount, { mode: mode, cp: cp || "Shop" }); r.push("", ""); return r; };
  const inW = new ND(w0.start.getTime() + 3 * 86400000);
  o.addSheet("Transactions", [TXN_HEADER, swipe(inW, 7000, "card 1264"), swipe(inW, 1500, "card 8132")].map(function(r, i){ return i ? r.slice(0, 21) : r; }));
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ o.addSheet(t, [["h"]]); });
  o.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  o.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"]]);
  o.props.PWA_PUSH_TOKEN = "tok-owner";
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  sb.v2dbRun_(OWNER, function(db){ db.props().setProperty("PWA_PUSH_TOKEN", "tok-owner-private"); });
  sb.v2dbEnableUser(FRIEND);
  o.act("friend", { action: "registerPushToken", token: "tok-friend" });
  sb.v2dbRun_(FRIEND, function(db){ sb.v2dbEnsureTemplate_(db); });       // she has no card bill
  const mine = function(){ return sent.filter(function(s){ return s.token === "tok-owner-private"; }); };
  const reset = function(){ sent.length = 0; delete o.store["_system/reminders"]; };

  let n = sb.cardBillReminderRun_(nowMs);
  assert(n === 1 && mine().length === 1 && sent.length === 1, "2 days before the due date: one reminder, to the person who has a bill (not to the friend with none)");
  const m = mine()[0];
  assert(m.title === "Card bill due in 2 days" && /^Card bill ₹8,500 is due on 9 [A-Z][a-z]{2}\. Pay it in full\.$/.test(m.body), "calm text with the combined amount and the date: " + m.title + " / " + m.body);
  assert(m.extra.kind === "reminder" && m.extra.tag === "card-bill", "tagged so it replaces itself");
  n = sb.cardBillReminderRun_(nowMs + 3600000);
  assert(n === 0 && mine().length === 1, "running again the same day sends nothing more (once per bill)");
  assert(sb.cardBillReminderRun_(new ND(dueY, dueM, 8, 12, 0, 0).getTime()) === 0 && mine().length === 1, "and the next day, still nothing (same bill)");

  reset();
  assert(sb.cardBillReminderRun_(new ND(dueY, dueM, 5, 12, 0, 0).getTime()) === 0 && mine().length === 0, "4 days before: too early, nothing");
  assert(sb.cardBillReminderRun_(new ND(dueY, dueM, 6, 12, 0, 0).getTime()) === 1, "3 days before: sent");
  reset();
  assert(sb.cardBillReminderRun_(new ND(dueY, dueM, 9, 12, 0, 0).getTime()) === 1 && mine()[0].title === "Card bill is due today", "on the day itself: sent, 'due today'");
  reset();
  assert(sb.cardBillReminderRun_(new ND(dueY, dueM, 10, 12, 0, 0).getTime()) === 0, "after the due date: nothing (not a reminder any more)");

  reset();
  assert(sb.cardBillReminderRun_(new ND(dueY, dueM, 7, 23, 0, 0).getTime()) === 0 && sb.cardBillReminderRun_(new ND(dueY, dueM, 7, 6, 0, 0).getTime()) === 0, "quiet hours (11pm, 6am): nothing");

  // next month's bill is a new reminder
  const next = new ND(dueY, dueM + 1, 7, 12, 0, 0);
  const w1 = P.cardCoachCycles_(new ND(dueY, dueM + 1, 7)).closed(0);
  const sh = o.sheets.Transactions; // (the owner's real sheet; the private copy was imported earlier - add through the private copy instead)
  sb.v2dbRun_(OWNER, function(){ sb.dbSs_().getSheetByName("Transactions").appendRow(swipe(new ND(w1.start.getTime() + 4 * 86400000), 4000, "card 1264").slice(0, 21)); });
  reset();
  assert(sb.cardBillReminderRun_(nowMs) === 1, "(this month's bill again after a reset)");
  assert(sb.cardBillReminderRun_(next.getTime()) === 1, "next month's bill gets its own reminder");

  // switched off by the person
  reset();
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_CARD_REMINDER_OFF", "1"); });
  assert(sb.cardBillReminderRun_(nowMs) === 0 && mine().length === 0, "the person switched it off: nothing");
  sb.v2dbRun_(OWNER, function(){ sb.dbProps_().setProperty("SETTING_CARD_REMINDER_OFF", ""); });

  // already paid (the payment says 'credit card bill'): nothing
  reset();
  sb.v2dbRun_(OWNER, function(){
    sb.dbSs_().getSheetByName("Transactions").appendRow(row(new ND(dueY, dueM, 6), 8500, { mode: "upi", cp: "HDFC CREDIT CARD", note: "credit card bill" }).concat(["", ""]).slice(0, 21));
  });
  assert(sb.cardBillReminderRun_(nowMs) === 0 && mine().length === 0, "the bill was paid in full: no reminder");

  // a failing person does not stop the next; failures are logged
  reset();
  const real = sb.splitNotifyToken_;
  sb.splitNotifyToken_ = function(e){ if(e === OWNER) throw new Error("token boom"); return real(e); };
  let ok = true; try{ sb.cardBillReminderRun_(nowMs); }catch(e){ ok = false; }
  assert(ok && o.errors("REMINDER_ERROR").length >= 1, "one person's failure is logged and never thrown");
  sb.splitNotifyToken_ = real;

  // the new server's tick knows the job
  const job = sb.TIMER_DAILY_JOBS_.filter(function(j){ return j.key === "cardbill"; })[0];
  assert(job && job.hour === 9 && job.minute === 15, "the daily job runs at 09:15 India time");
  assert(sb.timerDailyRunner_("cardbill") === sb.cardBillReminderRun_, "and runs the reminder");
}

console.log("\n--- F. Settings ---");
{
  const w = world([]);
  const g = function(){ return w.sb.getSettings(); };
  assert(g().cardWantsLimit === 0 && g().cardReminder === true, "defaults: wants limit 0 (not set), reminder on");
  w.sb.updateSettings({ cardWantsLimit: 7500, cardReminder: false });
  assert(g().cardWantsLimit === 7500 && g().cardReminder === false, "saved: " + JSON.stringify([g().cardWantsLimit, g().cardReminder]));
  w.sb.updateSettings({ ccLimit: 60000 });
  assert(g().cardWantsLimit === 7500 && g().cardReminder === false, "saving other settings changes neither");
  w.sb.updateSettings({ cardWantsLimit: -5 }); w.sb.updateSettings({ cardWantsLimit: "abc" }); w.sb.updateSettings({ cardWantsLimit: 99999999999 });
  assert(g().cardWantsLimit === 7500, "negative, non-numeric and absurd values are ignored");
  w.sb.updateSettings({ cardWantsLimit: 0 });
  assert(g().cardWantsLimit === 0, "0 clears it");
  w.sb.updateSettings({ cardReminder: true });
  assert(g().cardReminder === true, "reminder switched on again");
}

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL OK");
