// Checks the pure logic behind Card Coach (index.html, the block between CC-LOGIC-START and CC-LOGIC-END):
// every tone's wording, missing / null / zero data, a negative safe amount, no NaN or "undefined" in any text,
// no interest amounts, month wording taken from the real dates, the plan lines, the suggestion button and the
// optimistic limit update. Also checks the markup and Demo Mode wiring and a few safety rules.
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const m = html.match(/CC-LOGIC-START\r?\n([\s\S]*?)\/\/ CC-LOGIC-END/);
if (!m) { console.log("FAIL: logic block not found"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
const names = ["cchNum", "cchOpt", "cchRs", "cchDate", "cchMonth", "cchSalaryPhrase", "cchTone", "cchHero", "cchUtil", "cchMerchantsText",
  "cchSplitRows", "cchWantsLine", "cchSuggestion", "cchDueChip", "cchPlanSum", "cchPlan", "cchReminderText", "cchStreakText", "cchApplyLimit"];
vm.runInContext(m[1] + "; " + names.map((n) => "this." + n + " = " + n).join("; "), ctx);
const f = ctx;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ")");
const clean = (s) => typeof s === "string" && !/NaN|undefined|null|Infinity|\[object/.test(s);
const cleanDeep = (o) => JSON.stringify(o, (k, v) => (typeof v === "string" && !clean(v) ? "BAD:" + v : v)).indexOf("BAD:") === -1;
const shame = /fail|bad|guilt|shame|reckless|careless|blow|irresponsible|overspend|wasted|stupid|!/i;

const base = () => ({
  limit: 50000, limitUsedPct: 30, cycleSpent: 15000, split: { fixed: 2000, need: 4000, want: 6000, unsorted: 3000 },
  fixedMerchants: ["Netflix", "Jio"], wantsLimit: 5000, suggestedWantsLimit: 5000, wantsOver: 1000, safeToPut: 12400, safeUntil: "2026-11-09",
  tone: "watch", utilisationWatch: false,
  bill: { amount: 6200, dueDate: "2026-11-09", daysUntilDue: 22, isPaid: false, isOverdue: false,
    planLines: [{ label: "Salary", amount: 55000, sign: 1 }, { label: "Rent and EMI", amount: 15000, sign: -1 }, { label: "This card bill", amount: 6200, sign: -1 }], leftUntilSalary: 33800 },
  paidInFullStreak: 3
});

// ---------- basics ----------
eq(f.cchRs(1234.6), "₹1,235", "rupees rounded and grouped the Indian way");
eq(f.cchRs(-500), "₹500", "negative shown without a sign");
eq([f.cchRs(NaN), f.cchRs(undefined), f.cchRs(null), f.cchRs("x")], ["₹0", "₹0", "₹0", "₹0"], "odd numbers become ₹0, not NaN");
eq([f.cchOpt(null), f.cchOpt(undefined), f.cchOpt(""), f.cchOpt(true), f.cchOpt("abc"), f.cchOpt(0), f.cchOpt("12")], [null, null, null, null, null, 0, 12], "cchOpt keeps null as null and 0 as 0");
eq([f.cchDate("2026-11-09"), f.cchDate("2026-01-31"), f.cchDate("2026-12-01")], ["9 Nov", "31 Jan", "1 Dec"], "short dates");
eq([f.cchDate(""), f.cchDate(null), f.cchDate("garbage")], ["", "", ""], "bad dates give nothing");
eq([f.cchMonth("2026-11-09"), f.cchMonth("2027-02-03"), f.cchMonth("nope")], ["November", "February", ""], "month names come from the real date");

// ---------- tone ----------
eq(f.cchTone(base()), "watch", "wants over -> watch");
eq(f.cchTone(Object.assign(base(), { wantsOver: 0, tone: "ok" })), "ok", "nothing to watch -> ok");
eq(f.cchTone(Object.assign(base(), { wantsOver: null, tone: "ok", utilisationWatch: true })), "watch", "high share of limit -> watch");
eq(f.cchTone(Object.assign(base(), { safeToPut: -300 })), "over", "negative safe amount -> over");
eq(f.cchTone(Object.assign(base(), { safeToPut: null })), "unknown", "no safe amount -> unknown");
eq(f.cchTone(Object.assign(base(), { safeToPut: 0, wantsOver: 0, tone: "ok" })), "ok", "exactly zero is not over");
eq(f.cchTone(Object.assign(base(), { tone: "over", safeToPut: 500, wantsOver: 0 })), "ok", "a server 'over' with money left is not a false alarm");
eq([f.cchTone(null), f.cchTone(undefined), f.cchTone("x"), f.cchTone({})], ["unknown", "unknown", "unknown", "unknown"], "missing coach -> unknown");

// ---------- hero wording, one test per tone ----------
let h = f.cchHero(Object.assign(base(), { wantsOver: 0, tone: "ok" }), "home");
eq([h.tone, h.title, h.amount, h.showAmount, h.sentence], ["ok", "Safe to put on card until 9 Nov", "₹12,400", true, "Nice: your card is on track this cycle."], "ok hero");
h = f.cchHero(base(), "home");
eq([h.tone, h.title, h.amount, h.showAmount], ["watch", "Safe to put on card until 9 Nov", "₹12,400", true], "watch hero");
eq(h.sentence, "₹1,000 of your wants on the card is borrowed from next month. It will come out of your November salary.", "watch (wants over) sentence names the month");
h = f.cchHero(Object.assign(base(), { wantsOver: 0, utilisationWatch: true, cycleSpent: 30000 }), "home");
ok(/60% of your card limit/.test(h.sentence), "watch (high share) sentence uses the real percent: " + h.sentence);
h = f.cchHero(Object.assign(base(), { wantsOver: 0, utilisationWatch: false, tone: "watch" }), "home");
ok(clean(h.sentence) && h.sentence.length > 10, "watch with no other detail still has a calm sentence");
h = f.cchHero(Object.assign(base(), { safeToPut: -1200 }), "home");
eq([h.tone, h.title, h.amount, h.showAmount], ["over", "Past the safe amount", "₹1,200", true], "over hero shows the amount past, positive");
eq(h.sentence, "You're ₹1,200 past the safe amount. It will come out of your November salary.", "over sentence");
eq(h.hint, "Use UPI or wait for the next salary.", "over gives one gentle option");
h = f.cchHero(Object.assign(base(), { safeToPut: null }), "home");
eq([h.tone, h.showAmount, h.sentence], ["unknown", false, "Card Coach needs your salary and about two weeks of history before it can show this."], "unknown on Home");
h = f.cchHero(Object.assign(base(), { safeToPut: 0, safeReason: "budget_full", tone: "watch" }), "home");
eq([h.title, h.showAmount], ["No room for card wants this month", false], "budget_full never says 'past the safe amount' and shows no amount");
ok(!/past/i.test(h.sentence) && clean(h.sentence), "budget_full sentence is calm");
h = f.cchHero(Object.assign(base(), { safeToPut: -500, safeReason: "budget_full" }), "home");
eq(h.title, "No room for card wants this month", "budget_full wins even when the number is negative");
h = f.cchHero(Object.assign(base(), { safeToPut: null }), "cc");
eq(h.sentence, "Card Coach needs your salary and about two weeks of history before it can show this.", "unknown on the card screen");
h = f.cchHero(Object.assign(base(), { safeUntil: "" }), "home");
eq(h.title, "Safe to put on card", "no date -> no 'until'");
h = f.cchHero(Object.assign(base(), { safeToPut: -50, bill: null, safeUntil: "2026-12-05" }), "home");
ok(/December salary/.test(h.sentence), "month comes from safeUntil when there is no bill: " + h.sentence);
h = f.cchHero(Object.assign(base(), { safeToPut: -50, bill: null, safeUntil: "" }), "home");
ok(/your next salary\./.test(h.sentence), "no date at all -> 'next salary'");
ok(cleanDeep(f.cchHero(null, "home")) && cleanDeep(f.cchHero(undefined, "cc")) && cleanDeep(f.cchHero({}, "home")), "empty coach gives clean text");
// January check: a bill due in January talks about a January salary, not a hard-coded month.
ok(/January salary/.test(f.cchHero(Object.assign(base(), { safeToPut: -1, bill: Object.assign(base().bill, { dueDate: "2027-01-09" }) }), "home").sentence), "month wording follows the bill's due month");

// ---------- tone of voice ----------
[base(), Object.assign(base(), { safeToPut: -1200 }), Object.assign(base(), { safeToPut: null }), Object.assign(base(), { wantsOver: 0, tone: "ok" }),
  Object.assign(base(), { wantsOver: 0, utilisationWatch: true })].forEach((c, i) => {
  const hh = f.cchHero(c, "home");
  ok(!shame.test(hh.sentence + " " + hh.hint + " " + hh.title), "case " + i + " has no shaming words: " + hh.sentence);
});

// ---------- utilisation ----------
let u = f.cchUtil(base());
eq([u.text, u.pct, u.width, u.tone], ["Used this cycle ₹15,000 of ₹50,000 · 30%", 30, 30, ""], "utilisation line");
u = f.cchUtil(Object.assign(base(), { utilisationWatch: true }));
eq(u.tone, "watch", "watch colour only when asked");
u = f.cchUtil(Object.assign(base(), { cycleSpent: 62000 }));
eq([u.pct, u.width, u.tone], [124, 100, "over"], "over the limit: bar capped at 100, tone over");
eq(f.cchUtil(Object.assign(base(), { limit: 0 })), null, "zero limit -> no bar, no divide by zero");
eq(f.cchUtil(Object.assign(base(), { limit: "x" })), null, "bad limit -> no bar");
eq(f.cchUtil(null), null, "no coach -> no bar");
u = f.cchUtil(Object.assign(base(), { cycleSpent: NaN }));
eq(u.text, "Used this cycle ₹0 of ₹50,000 · 0%", "NaN spend -> ₹0");
u = f.cchUtil(Object.assign(base(), { cycleSpent: -400 }));
eq(u.pct, 0, "negative spend counts as 0");

// ---------- the four rows ----------
let s = f.cchSplitRows(base());
eq(s.rows.map((r) => r.key), ["fixed", "need", "want", "unsorted"], "all four rows in order");
eq(s.rows.map((r) => r.text), ["₹2,000", "₹4,000", "₹6,000", "₹3,000"], "row amounts");
ok(Math.abs(s.rows.reduce((t, r) => t + r.pct, 0) - 100) < 0.5, "bar widths add up to 100");
eq(s.rows.map((r) => r.chip.text), ["Fine", "Fine", "Borrowed from next month", "Tag them in Pending"], "row notes");
eq(s.rows[2].chip.tone, "warn", "wants over the limit -> amber chip");
eq(f.cchSplitRows(Object.assign(base(), { wantsOver: 0 })).rows[2].chip.tone, "", "wants within the limit -> quiet chip");
eq(s.rows[3].action, "pending", "not sorted row can open Pending");
eq(s.rows[0].sub, "Netflix, Jio", "fixed bills list their names");
s = f.cchSplitRows(Object.assign(base(), { split: { fixed: 0, need: 0, want: 800, unsorted: 0 } }));
eq(s.rows.map((r) => r.key), ["want"], "zero rows are left out");
eq(s.rows[0].pct, 100, "a single row fills the bar");
s = f.cchSplitRows(Object.assign(base(), { split: { fixed: 0, need: 0, want: 0, unsorted: 0 } }));
eq([s.empty, s.rows.length, s.total], [true, 0, 0], "nothing on the card -> empty");
for (const bad of [null, undefined, "x", {}, { split: null }, { split: { fixed: "a", need: NaN, want: -5, unsorted: null } }]) {
  const r = f.cchSplitRows(bad);
  ok(r.empty && r.rows.length === 0 && cleanDeep(r), "bad split " + JSON.stringify(bad) + " gives an empty, clean result");
}
eq(f.cchMerchantsText(["A", "B", "C", "D", "E"]), "A, B, C and 2 more", "long list of names is shortened");
eq([f.cchMerchantsText(null), f.cchMerchantsText([]), f.cchMerchantsText([1, "", "  "])], ["", "", ""], "bad names give nothing");

// ---------- wants limit line ----------
eq(f.cchWantsLine(base()), { text: "Your wants limit on card: ₹5,000 · over by ₹1,000", tone: "over" }, "over by");
eq(f.cchWantsLine(Object.assign(base(), { wantsOver: 0 })).tone, "", "server says not over -> no warning tone");
eq(f.cchWantsLine(Object.assign(base(), { wantsOver: null, split: { want: 3200 } })), { text: "Your wants limit on card: ₹5,000 · ₹1,800 left", tone: "" }, "room left (worked out when the server gives none)");
eq(f.cchWantsLine(Object.assign(base(), { wantsOver: null, split: { want: 5000 } })).text, "Your wants limit on card: ₹5,000 · right at your limit", "exactly at the limit");
eq(f.cchWantsLine(Object.assign(base(), { wantsLimit: null })), null, "no limit set -> no line");
eq(f.cchWantsLine(Object.assign(base(), { wantsLimit: 0 })), null, "limit 0 means not set");
eq(f.cchWantsLine(null), null, "no coach -> no line");

// ---------- suggestion ----------
eq(f.cchSuggestion(Object.assign(base(), { wantsLimit: null })), { text: "Set a wants limit. Suggested ₹5,000, based on your last months.", btn: "Use ₹5,000", amount: 5000 }, "suggestion with button");
eq(f.cchSuggestion(Object.assign(base(), { wantsLimit: 0 })).btn, "Use ₹5,000", "0 means not set, so it is suggested");
eq(f.cchSuggestion(base()), null, "limit already set -> no prompt");
eq(f.cchSuggestion(Object.assign(base(), { wantsLimit: null, suggestedWantsLimit: 0 })).btn, "", "no suggestion number -> prompt without a button");
eq(f.cchSuggestion(Object.assign(base(), { wantsLimit: null, suggestedWantsLimit: undefined })).amount, 0, "missing suggestion -> 0");
eq(f.cchSuggestion(Object.assign(base(), { wantsLimit: null, suggestedWantsLimit: 4999.6 })).btn, "Use ₹5,000", "suggestion is rounded");
eq(f.cchSuggestion(null), null, "no coach -> no prompt");

// ---------- the plan ----------
let p = f.cchPlan(base());
eq([p.amountText, p.dueText, p.chip.text, p.chip.tone], ["₹6,200", "Due 9 Nov", "in 22 days", ""], "plan header");
eq(p.note, "Pay the full amount by 9 Nov. Paying only the minimum would add interest.", "plain note, no interest amount");
eq(p.lines.map((l) => l.text), ["+ ₹55,000", "− ₹15,000", "− ₹6,200"], "plan lines with signs");
eq([p.left.label, p.left.text, p.left.short], ["Left until next salary", "₹33,800", false], "left until salary");
eq(f.cchPlanSum([{ sign: 1, amount: 55000 }, { sign: -1, amount: 15000 }, { sign: -1, amount: 6200 }]), 33800, "plan lines add up");
eq(f.cchPlanSum(null), 0, "no lines -> 0");
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { leftUntilSalary: -2500 }) }));
eq([p.left.label, p.left.text, p.left.short], ["Short until next salary", "₹2,500", true], "short is shown as a positive gap");
ok(!shame.test(p.left.note), "short note is gentle: " + p.left.note);
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { leftUntilSalary: null }) }));
eq(p.left, null, "left unknown -> hidden");
let bill2 = base().bill; delete bill2.leftUntilSalary;
p = f.cchPlan(Object.assign(base(), { bill: bill2 }));
eq(p.left.text, "₹33,800", "left missing -> worked out from the lines");
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { daysUntilDue: 2 }) }));
eq([p.chip.text, p.chip.tone], ["in 2 days", "soon"], "due soon");
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { daysUntilDue: 0 }) }));
eq(p.chip.text, "due today", "due today");
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { daysUntilDue: -3, isOverdue: true }) }));
eq([p.chip.text, p.chip.tone], ["overdue", "late"], "overdue chip");
ok(/^Pay the full amount as soon as you can\./.test(p.note) && !shame.test(p.note), "overdue note is calm: " + p.note);
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { dueDate: "" }) }));
ok(/by the due date/.test(p.note) && p.dueText === "", "no date -> generic note");
p = f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { planLines: [{ label: "x", amount: NaN, sign: 1 }, null, { label: "", amount: 5, sign: 1 }, { amount: 5 }] }) }));
eq(p.lines.length, 0, "bad plan lines are dropped");
eq(f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { isPaid: true }) })), null, "paid bill -> no plan");
eq(f.cchPlan(Object.assign(base(), { bill: Object.assign(base().bill, { amount: 0 }) })), null, "zero bill -> no plan");
eq([f.cchPlan(Object.assign(base(), { bill: null })), f.cchPlan(null), f.cchPlan({}), f.cchPlan(Object.assign(base(), { bill: "x" }))], [null, null, null, null], "no bill -> no plan");
ok(cleanDeep(f.cchPlan(base())), "plan text is clean");
ok(!/interest[^.]*₹|₹[^.]*interest/i.test(JSON.stringify(f.cchPlan(base()))), "the plan never claims an interest amount");

// ---------- reminder wording ----------
const NOW = new Date(2026, 9, 18, 10, 0);
eq(f.cchReminderText(base(), true, NOW), "The reminder is on. We will remind you on 6 Nov, 3 days before it is due.", "reminder date");
ok(/due very soon/.test(f.cchReminderText(Object.assign(base(), { bill: Object.assign(base().bill, { dueDate: "2026-10-20" }) }), true, NOW)), "already inside 3 days");
ok(/turn it on in Settings/.test(f.cchReminderText(base(), false, NOW)), "reminder off");
ok(/before the due date/.test(f.cchReminderText(null, true, NOW)), "no bill, no crash");
ok(cleanDeep([f.cchReminderText({}, true, NOW), f.cchReminderText(base(), undefined, NOW)]), "reminder text clean");

// ---------- streak ----------
eq([f.cchStreakText(3), f.cchStreakText(1), f.cchStreakText(12)], ["Paid in full 3 months in a row", "Paid in full 1 month in a row", "Paid in full 12 months in a row"], "streak wording");
eq([f.cchStreakText(0), f.cchStreakText(null), f.cchStreakText(undefined), f.cchStreakText(-2), f.cchStreakText("x")], ["", "", "", "", ""], "no streak -> nothing shown");
eq(f.cchStreakText(2.9), "Paid in full 2 months in a row", "fractions are floored");

// ---------- optimistic limit change ----------
const before = base();
let a = f.cchApplyLimit(before, 5000);
eq([a.wantsLimit, a.wantsOver], [5000, 1000], "limit applied, over worked out");
eq(before.wantsLimit, 5000, "original not changed");
a = f.cchApplyLimit(Object.assign(base(), { wantsLimit: null }), 7000);
eq([a.wantsLimit, a.wantsOver], [7000, 0], "limit above wants -> not over");
a = f.cchApplyLimit(base(), 0);
eq([a.wantsLimit, a.wantsOver], [null, null], "0 removes the limit");
a = f.cchApplyLimit(base(), "abc");
eq(a.wantsLimit, null, "bad number removes nothing odd");
eq(f.cchTone(f.cchApplyLimit(Object.assign(base(), { tone: "ok" }), 9000)), "ok", "limit above wants -> tone back to ok");

// ---------- page wiring ----------
ok(/id="homeCoach"[^>]*data-goto-tab="cc"/.test(html), "Home card exists and opens the card screen");
ok(html.indexOf('id="homeNeeds"') < html.indexOf('id="homeCoach"') && html.indexOf('id="homeCoach"') < html.indexOf('id="homeMonth"'), "Home card sits directly below 'Needs you'");
ok(/id="ccCoachWhat"/.test(html) && /id="ccCoachPlan"/.test(html) && /id="ccCoachStreak"/.test(html), "card screen sections exist");
ok(/id="settingsCardWantsLimit"/.test(html) && /id="settingsCardReminder"/.test(html), "settings fields exist");
ok(/cardWantsLimit:\s+Math\.max/.test(html), "settings save sends cardWantsLimit");
ok(/reminderShown \? \{ cardReminder/.test(html), "cardReminder is only sent when the server showed it");
ok(/function renderHomeCoach/.test(html) && /renderHomeCoach\(d\)/.test(html), "Home card is drawn from renderDashboard");
ok(/renderCCCoach\(cc\)/.test(html), "card sections are drawn from renderCCAdvisor");
ok(/function demoComputeCoach/.test(html) && /coach: demoComputeCoach\(/.test(html), "Demo Mode builds a coach");
ok(/cardWantsLimit: 4000, cardReminder: true/.test(html), "Demo settings carry the new fields");
ok(/APP_VERSION = "2026-10-(18-0[5-9]|19-[0-9]+)"/.test(html), "APP_VERSION bumped");
ok(/APP_CHANGELOG = "[^"]*Card Coach/.test(html), "changelog mentions Card Coach");
// hand-written colours: none in the new CSS
const css = (html.match(/Card Coach \(2026-10-18\): Home card[\s\S]*?prefers-reduced-motion: reduce\) \{[\s\S]*?\}\r?\n    \}/) || [""])[0];
ok(css.length > 500, "found the Card Coach CSS");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no hard-coded hex colours in the Card Coach CSS");
ok(/prefers-reduced-motion/.test(css), "Card Coach CSS respects reduced motion");
// every place user text goes into HTML is escaped
const rj = (html.match(/function renderHomeCoach[\s\S]*?\r?\n    \}\r?\n/) || [""])[0] + (html.match(/function renderCCCoach[\s\S]*?\r?\n    \}\r?\n/) || [""])[0];
ok(rj.length > 1000, "found the render functions");
ok(!/innerHTML\s*=\s*[^;]*\bcoach\.(fixedMerchants|bill\.planLines)/.test(rj), "raw coach text never goes straight into HTML");
ok(/escapeHtml\(r\.sub\)/.test(rj) && /escapeHtml\(l\.label\)/.test(rj), "names from the server are escaped");
ok(!/interestAmount|interest:\s*[0-9]/i.test(html.slice(html.indexOf("CC-LOGIC-START"), html.indexOf("CC-LOGIC-END"))), "no interest number anywhere in the logic");

console.log("cardCoachFrontend: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
