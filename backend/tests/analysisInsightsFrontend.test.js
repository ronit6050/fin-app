// Checks the pure logic behind the Analysis makeover (index.html, the block between AN-LOGIC-START and
// AN-LOGIC-END): the pace chips, the "Smart read" sentences (each rule both firing and NOT firing),
// the week / day-by-day / money-flow / trend / places / plan models, and that missing or odd data
// (older saved copies, zero last month, a failed "extras" call) hides a piece instead of throwing or
// printing NaN / undefined. Also checks the markup and demo wiring the screen relies on.
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const m = html.match(/AN-LOGIC-START\r?\n([\s\S]*?)\/\/ AN-LOGIC-END/);
if (!m) { console.log("FAIL: logic block not found"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
const names = ["analysisRs", "anNum", "anCompact", "anMonthName", "anDayLabel", "anTodayInfo", "anMonthStillRunning", "anDetail", "anSumTo",
  "anPrevDigest", "anPrevMonthName", "anTrendSpent", "anUsual", "anPlanModel", "anPace", "anPaceVsText", "anWeekdayAverages", "anBiggestWeekday",
  "buildAnalysisInsights", "anCatChange", "anFlowModel", "anDailyModel", "anWeekModel", "anPlacesModel", "anBiggestModel", "anTrendModel", "anSpikeDay", "anFinishedDays"];
vm.runInContext(m[1] + "; " + names.map((n) => "this." + n + " = " + n).join("; "), ctx);
const f = ctx;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ")");
const clean = (s) => typeof s === "string" && !/NaN|undefined|null|Infinity|\[object/.test(s);

// October 2026: 1 Oct is a Thursday. "Today" = 18 Oct 2026 (a Sunday); the month has 31 days.
const NOW = new Date(2026, 9, 18);
const T = f.anTodayInfo(2026, 10, NOW);
eq([T.day, T.daysInMonth, T.isCurrent, T.daysLeft], [18, 31, true, 13], "today info, running month");
const TP = f.anTodayInfo(2026, 9, NOW);
eq([TP.day, TP.daysInMonth, TP.isCurrent, TP.daysLeft], [30, 30, false, 0], "today info, finished month");
const TF = f.anTodayInfo(2026, 11, NOW);
eq([TF.day, TF.isFuture, TF.isCurrent], [0, true, false], "today info, month that has not started");
ok(f.anTodayInfo(2028, 2, new Date(2028, 1, 10)).daysInMonth === 29, "leap February has 29 days");

// ---- a daily array: even spend of 1000, with chosen days changed ----
function daily(n, base, over) { const a = []; for (let i = 0; i < n; i++) a.push(base); Object.keys(over || {}).forEach((d) => { a[d - 1] = over[d]; }); return a; }
function slice(o) {
  return Object.assign({
    totalDebit: 18000, totalCredit: 65000, categories: [{ category: "Food", amount: 8000 }, { category: "Shopping", amount: 6000 }, { category: "Transport", amount: 4000 }],
    fixedObligations: 0, invested: 0, saved: 0,
    needWantSaving: { need: 9000, want: 5000, saving: 0, investment: 0, untagged: 4000, untaggedCount: 3, taggedTotal: 14000 },
    detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? 1000 : 0)), places: [], smallCount: 0, smallTotal: 0, smallLimit: 100, biggest: [] }
  }, o || {});
}
const textOf = (arr) => arr.map((i) => i.text);

// ---- no data at all ----
eq(f.buildAnalysisInsights(null, null, "all", T), [], "null slice -> no insights");
eq(f.buildAnalysisInsights({}, null, "all", T), [], "empty slice -> no insights");
eq(f.buildAnalysisInsights(slice(), null, "all", T), [], "an even month with no extras says nothing");
eq(f.buildAnalysisInsights(slice(), undefined, undefined, T), [], "mode defaults to all");
eq(f.buildAnalysisInsights(slice(), null, "all", TF), [], "month not started -> none");
ok(f.anPace(slice({ totalDebit: 0 }), null, "all", T) === null, "pace: nothing spent -> null");
ok(f.anPace(slice(), null, "all", TF) === null, "pace: month not started -> null");

// ---- Rule 1: biggest category move vs last month ----
const prevBase = { all: { spent: 20000, income: 65000, categories: { Food: 10100, Shopping: 4600, Transport: 4100 }, daily: daily(30, 700) }, year: 2026, month: 9 };
// Past month (finished): Food is down 2,100 (-21%) -> fires "down".
let r = f.buildAnalysisInsights(slice(), { prev: prevBase }, "all", TP);
ok(textOf(r).includes("Food is down ₹2,100 vs September."), "category move down fires for a finished month: " + JSON.stringify(textOf(r)));
ok(r.find((x) => x.kind === "categoryMove").tone === "good", "down = good tone");
// Running month: the same "down" is NOT claimed (month not over), but an "up" is, worded "already up".
r = f.buildAnalysisInsights(slice(), { prev: prevBase }, "all", T);
ok(!textOf(r).some((t) => /Food is down/.test(t)), "running month: no 'down' claim");
const prevUp = { all: { categories: { Food: 5000, Shopping: 4600 }, daily: [] }, month: 9 };
r = f.buildAnalysisInsights(slice(), { prev: prevUp }, "all", T);
ok(textOf(r).includes("Food is already up ₹3,000 vs September."), "running month: 'already up' fires: " + JSON.stringify(textOf(r)));
ok(r.find((x) => x.kind === "categoryMove").tone === "warn", "up = warn tone");
r = f.buildAnalysisInsights(slice(), { prev: { all: { categories: {} }, month: 9 } }, "all", TP);
ok(!r.some((x) => x.kind === "categoryMove"), "category absent last month (previous 0) -> no division by zero, no insight");
r = f.buildAnalysisInsights(slice(), { prev: { all: { categories: { Food: 8300, Shopping: 6100 } }, month: 9 } }, "all", TP);
ok(!r.some((x) => x.kind === "categoryMove"), "small moves (under 500 and under 15%) -> none");
r = f.buildAnalysisInsights(slice({ categories: [{ category: "Food", amount: 9000 }] }), { prev: { all: { categories: { Food: 8000 } }, month: 9 } }, "all", TP);
ok(!r.some((x) => x.kind === "categoryMove"), "+1,000 but only 12.5% -> none (needs both 500 and 15%)");
r = f.buildAnalysisInsights(slice({ categories: [{ category: "Food", amount: 1000 }] }), { prev: { all: { categories: { Food: 1400 } }, month: 9 } }, "all", TP);
ok(!r.some((x) => x.kind === "categoryMove"), "-29% but only 400 rupees -> none");
// A category that dropped to nothing counts as down.
r = f.buildAnalysisInsights(slice({ categories: [] }), { prev: { all: { categories: { Lifestyle: 3000 } }, month: 9 } }, "all", TP);
ok(textOf(r).includes("Lifestyle is down ₹3,000 vs September."), "category gone this month = down by its old total");
// Biggest move wins.
r = f.buildAnalysisInsights(slice(), { prev: { all: { categories: { Food: 4000, Shopping: 2000 } }, month: 9 } }, "all", TP);
ok(textOf(r)[0] === "Food is up ₹4,000 vs September." || textOf(r).includes("Food is up ₹4,000 vs September."), "the biggest move is the one named (finished month says 'up' not 'already up')");
// Mode slice uses that mode's last-month numbers.
r = f.buildAnalysisInsights(slice(), { prev: { all: { categories: { Food: 100 } }, card: { categories: { Food: 5000 } }, month: 9 } }, "card", TP);
ok(textOf(r).includes("Food is up ₹3,000 vs September."), "card mode compares with card's own last month");
// Last month name comes from the answer; January wraps to December.
r = f.buildAnalysisInsights(slice(), { prev: { all: { categories: { Food: 4000 } } } }, "all", f.anTodayInfo(2027, 1, new Date(2027, 1, 20)));
ok(textOf(r).some((t) => /vs December\./.test(t)), "without prev.month, January compares with December");

// ---- Rule 2: budgets ----
const budgetsKey = "2026-10";
function ex(budgets, more) { return Object.assign({ year: 2026, month: 10, trend: [], prev: null, budgets: budgets }, more || {}); }
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 10000, actual: 9200 }, { category: "Food", target: 20000, actual: 8000 }] }), "all", T);
eq(textOf(r)[0], "Shopping is at 92% of its target with 13 days left. Spend about ₹62 a day to stay inside.", "budget warning wording and per-day maths (800 / 13 = 61.5 -> 62)");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Transport", target: 3000, actual: 3900 }] }), "all", T);
eq(textOf(r)[0], "Transport is over its target by ₹900.", "over target wording");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Food", target: 20000, actual: 8000 }] }), "all", T);
ok(!r.some((x) => x.kind === "budget"), "under 85% -> no budget insight");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Food", target: 10000, actual: 8500 }] }), "all", T);
ok(r.some((x) => x.kind === "budget"), "exactly 85% fires");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Food", target: 10000, actual: 8400 }] }), "all", T);
ok(!r.some((x) => x.kind === "budget"), "84% does not");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 10000, actual: 9200 }] }), "card", T);
ok(!r.some((x) => x.kind === "budget"), "budgets only apply to the All view");
r = f.buildAnalysisInsights(slice(), ex({ month: "2026-09", categories: [{ category: "Shopping", target: 10000, actual: 9200 }] }), "all", T);
ok(!r.some((x) => x.kind === "budget"), "targets saved for a different month are ignored");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 0, actual: 9200 }] }), "all", T);
ok(!r.some((x) => x.kind === "budget"), "a zero target never divides");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 10000, actual: 10000 }] }), "all", T);
eq(textOf(r)[0], "Shopping has used all of its target.", "exactly at target");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 10000, actual: 9200 }] }), "all", f.anTodayInfo(2026, 10, new Date(2026, 9, 31)));
eq(textOf(r)[0], "Shopping used 92% of its target.", "last day of the month: no 'days left' advice");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 10000, actual: 9200 }] }), "all", f.anTodayInfo(2026, 10, new Date(2026, 9, 30)));
ok(/with 1 day left/.test(textOf(r)[0]), "1 day left is singular");
r = f.buildAnalysisInsights(slice(), ex({ month: budgetsKey, categories: [{ category: "Food", target: 10000, actual: 8800 }, { category: "Shopping", target: 5000, actual: 4700 }] }), "all", T);
ok(/^Shopping is at 94%/.test(textOf(r)[0]), "the category with the highest use% is named");
r = f.buildAnalysisInsights(slice(), ex(null), "all", T);
ok(!r.some((x) => x.kind === "budget"), "budgets null -> none");

// ---- Rule 3: weekends ----
// Oct 2026: Sat 3, Sun 4, Sat 10, Sun 11, Sat 17, Sun 18. Make weekend days 2.4x a weekday.
const wkd = {}; [3, 4, 10, 11, 17, 18].forEach((d) => { wkd[d] = 2400; });
const wkSlice = (extra) => slice(Object.assign({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (wkd[i + 1] || 1000) : 0)), places: [], smallCount: 0, smallTotal: 0, smallLimit: 100, biggest: [] } }, extra));
r = f.buildAnalysisInsights(wkSlice(), null, "all", T);
eq(textOf(r), ["Weekends cost you 2.4x a weekday. Saturday is your biggest day."], "weekend insight wording (Sat and Sun tie -> first = Saturday)");
const wkd2 = Object.assign({}, wkd); wkd2[4] = 3000; wkd2[11] = 3000; wkd2[18] = 3000;
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (wkd2[i + 1] || 1000) : 0)), places: [] } }), null, "all", T);
ok(/Sunday is your biggest day\./.test(textOf(r)[0] || ""), "biggest day follows the data (Sunday)");
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? ((new Date(2026, 9, i + 1).getDay() % 6 === 0) ? 1400 : 1000) : 0)), places: [] } }), null, "all", T);
ok(!r.some((x) => x.kind === "weekend"), "1.4x is under 1.5x -> none");
// Only one weekend day elapsed -> none.
r = f.buildAnalysisInsights(wkSlice(), null, "all", f.anTodayInfo(2026, 10, new Date(2026, 9, 3)));
ok(!r.some((x) => x.kind === "weekend"), "fewer than 2 weekend days elapsed -> none");
// Weekdays all zero -> no division by zero.
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (wkd[i + 1] || 0)), places: [] } }), null, "all", T);
ok(!r.some((x) => x.kind === "weekend"), "weekday average 0 -> none, no Infinity");
// Rule only uses days that have passed: the zero days after today must not dilute weekdays.
ok(f.anWeekdayAverages(daily(31, 100), 2026, 10, 18).reduce((s, x) => s + x.count, 0) === 18, "weekday averages count only elapsed days");
eq(f.anWeekdayAverages(daily(31, 100), 2026, 10, 7).map((x) => x.count), [1, 1, 1, 1, 1, 1, 1], "first 7 days = one of each weekday, Monday first");
ok(f.anWeekdayAverages(daily(31, 100), 2026, 10, 1)[3].count === 1, "1 Oct 2026 is a Thursday (index 3)");

// ---- Rule 4 / 5: small payments, spike day ----
const sm = (c, t) => slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? 1000 : 0)), places: [], smallCount: c, smallTotal: t, smallLimit: 100, biggest: [] } });
r = f.buildAnalysisInsights(sm(7, 420), null, "all", T);
eq(textOf(r), ["7 small payments under ₹100 added up to ₹420."], "small payments wording");
r = f.buildAnalysisInsights(sm(4, 420), null, "all", T);
ok(!r.some((x) => x.kind === "small"), "4 small payments -> none");
r = f.buildAnalysisInsights(sm(5, 123.5), null, "all", T);
ok(textOf(r)[0] === "5 small payments under ₹100 added up to ₹123.50.", "paise show two decimals: " + textOf(r)[0]);
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (i === 8 ? 9000 : 1000) : 0)), places: [], smallCount: 0 } }), null, "all", T);
eq(textOf(r), ["9 Oct was your big day: ₹9,000."], "spike day wording");
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (i === 8 ? 2000 : 1000) : 0)), places: [] } }), null, "all", T);
ok(!r.some((x) => x.kind === "spike"), "2x the average is not a spike for the sentence (needs 3x)");
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (i === 8 ? 1400 : 100) : 0)), places: [] } }), null, "all", T);
ok(!r.some((x) => x.kind === "spike"), "3x the average but under 1,500 -> none");
r = f.buildAnalysisInsights(slice({ detail: { daysInMonth: 31, daily: daily(31, 0), places: [] } }), null, "all", T);
ok(!r.some((x) => x.kind === "spike"), "all-zero days -> no spike, no NaN");
r = f.buildAnalysisInsights(slice({ detail: undefined }), null, "all", T);
eq(r, [], "an answer without `detail` -> detail rules are skipped");
r = f.buildAnalysisInsights(slice({ detail: { smallCount: 9, smallTotal: 5 } }), null, "all", T);
eq(r, [], "a detail block without `daily` is treated as missing");

// ---- Rule 6: pace vs usual ----
const trend5 = (vals) => vals.map((v, i) => ({ year: 2026, month: 5 + i, spent: v, income: 65000, fixed: 0, invested: 0, byMode: { bank: v * 0.6, card: v * 0.3, wallet: v * 0.1 } }));
const trendNow = trend5([30000, 32000, 31000, 29000, 30000]).concat([{ year: 2026, month: 10, spent: 18000, income: 65000, fixed: 0, invested: 0, byMode: { bank: 10000, card: 6000, wallet: 2000 } }]);
// 18,000 over 18 days -> P = 31,000; usual = 30,400 -> diff 600 (>= 500, and >= 5% of usual 1,520? no, 5% = 1,520 so NOT firing)
r = f.buildAnalysisInsights(slice(), ex(null, { trend: trendNow }), "all", T);
ok(!r.some((x) => x.kind === "pace"), "projection within 5% of usual -> none");
r = f.buildAnalysisInsights(slice({ totalDebit: 24000 }), ex(null, { trend: trendNow }), "all", T);
eq(textOf(r).filter((t) => /On this pace/.test(t)), ["On this pace you will spend about ₹41,333, ₹10,933 more than usual."], "pace more than usual");
ok(r.find((x) => x.kind === "pace").tone === "warn", "more = warn");
r = f.buildAnalysisInsights(slice({ totalDebit: 12000 }), ex(null, { trend: trendNow }), "all", T);
eq(textOf(r).filter((t) => /On this pace/.test(t)), ["On this pace you will spend about ₹20,667, ₹9,733 less than usual."], "pace less than usual");
ok(r.find((x) => x.kind === "pace").tone === "good", "less = good");
r = f.buildAnalysisInsights(slice({ totalDebit: 12000 }), ex(null, { trend: trendNow.slice(4) }), "all", T);
ok(!r.some((x) => x.kind === "pace"), "only one earlier month with spending -> no 'usual' -> none");
r = f.buildAnalysisInsights(slice({ totalDebit: 12000 }), ex(null, { trend: trendNow }), "all", f.anTodayInfo(2026, 10, new Date(2026, 9, 4)));
ok(!r.some((x) => x.kind === "pace"), "before day 5 no projection is made");
r = f.buildAnalysisInsights(slice({ totalDebit: 12000 }), ex(null, { trend: trendNow }), "all", TP);
ok(!r.some((x) => x.kind === "pace"), "a finished month has no projection");
r = f.buildAnalysisInsights(slice({ totalDebit: 12000 }), ex(null, { trend: trendNow }), "card", T);
ok(!r.some((x) => /NaN|undefined/.test(x.text)), "card mode reads byMode for usual");

// ---- Rule 7: wants ----
const nw = (want, extra) => slice({ needWantSaving: Object.assign({ need: 5000, want: want, saving: 0, investment: 0, untagged: 0, untaggedCount: 0, taggedTotal: 5000 + want }, extra || {}) });
r = f.buildAnalysisInsights(nw(4000), null, "all", T);   // 4000 / 9000 = 44%
eq(textOf(r), ["Wants are 44% of your spending, 14 points above the 30% guide."], "wants wording");
r = f.buildAnalysisInsights(nw(2200), null, "all", T);   // 2200/7200 = 31%
ok(!r.some((x) => x.kind === "wants"), "31% -> not 5 points above");
r = f.buildAnalysisInsights(nw(2700), null, "all", T);   // 2700/7700 = 35% exactly 5 over
ok(r.some((x) => x.kind === "wants"), "35% (5 points over) fires");
r = f.buildAnalysisInsights(nw(0), null, "all", T);
ok(!r.some((x) => x.kind === "wants"), "no wants -> none");
r = f.buildAnalysisInsights(slice({ needWantSaving: undefined }), null, "all", T);
ok(!r.some((x) => x.kind === "wants"), "no Need/Want data -> none");
r = f.buildAnalysisInsights(nw(4000, { taggedTotal: 0, untagged: 0 }), null, "all", T);
ok(!r.some((x) => /NaN|undefined/.test(x.text)), "odd totals never print NaN");
r = f.buildAnalysisInsights(slice({ fixedObligations: 20000, needWantSaving: { need: 5000, want: 4000, saving: 0, investment: 0, untagged: 0, untaggedCount: 0, taggedTotal: 9000 } }), null, "all", T);
ok(!r.some((x) => x.kind === "wants"), "Rent/EMI counts in the total, so 4,000 of 29,000 is only 14%");

// ---- priority and the cap of 4 ----
const fat = slice({
  categories: [{ category: "Food", amount: 8000 }],
  needWantSaving: { need: 5000, want: 4000, saving: 0, investment: 0, untagged: 0, untaggedCount: 0, taggedTotal: 9000 },
  detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (i === 9 ? 12000 : (wkd[i + 1] || 1000)) : 0)), places: [], smallCount: 8, smallTotal: 300, smallLimit: 100, biggest: [] }
});
const fatExtras = ex({ month: budgetsKey, categories: [{ category: "Shopping", target: 10000, actual: 9200 }] }, { trend: trendNow, prev: { all: { categories: { Food: 2000 }, daily: [] }, month: 9 } });
r = f.buildAnalysisInsights(Object.assign({}, fat, { totalDebit: 45000 }), fatExtras, "all", T);
ok(r.length === 4, "at most 4 insights: " + r.length);
eq(r.map((x) => x.kind), ["budget", "categoryMove", "pace", "weekend"], "priority order is budget, category move, pace, weekend (then wants, spike, small are cut)");
r.forEach((x) => { ok(["good", "warn", "info"].indexOf(x.tone) >= 0, "tone is one of the three: " + x.tone); ok(clean(x.text), "no NaN/undefined in: " + x.text); });

// ---- pace chips ----
const prevD = { all: { daily: daily(30, 1000), categories: {} }, month: 9 };
let p = f.anPace(slice({ totalDebit: 14400 }), { prev: prevD }, "all", T);   // through day 18 last month = 18,000
eq([p.vs.pct, p.vs.dir, p.vs.name, p.vs.atThisPoint, p.perDay], [20, "less", "September", true, 800], "pace: 20% less than September at this point, 800 / day");
eq(f.anPaceVsText(p.vs), "20% less than September at this point", "pace chip wording (less)");
p = f.anPace(slice({ totalDebit: 21600 }), { prev: prevD }, "all", T);
eq(f.anPaceVsText(p.vs), "20% more than September at this point", "pace chip wording (more)");
p = f.anPace(slice({ totalDebit: 18000 }), { prev: prevD }, "all", T);
eq(f.anPaceVsText(p.vs), "Same as September at this point", "pace chip wording (same)");
p = f.anPace(slice({ totalDebit: 14400 }), { prev: prevD }, "all", TP);   // finished month: through day 30 = 30,000
eq(f.anPaceVsText(p.vs), "52% less than September", "finished month: no 'at this point'");
eq([p.projection], [null], "finished month has no projection");
p = f.anPace(slice(), { prev: { all: { daily: daily(30, 0) } } }, "all", T);
ok(p.vs === null, "last month at this point was 0 -> no chip (no division by zero)");
p = f.anPace(slice(), { prev: { all: { daily: [] } } }, "all", T);
ok(p.vs === null && p.perDay === 1000, "last month has no daily -> no chip, per day still shown");
p = f.anPace(slice(), null, "all", T);
ok(p.vs === null && p.perDay === 1000, "no extras at all -> per-day chip only");
p = f.anPace(slice(), { prev: { bank: { daily: daily(30, 500) }, month: 9 } }, "bank", T);
ok(p.vs && p.vs.dir === "more", "bank mode reads prev.bank");
// projection and its reference
p = f.anPace(slice(), ex({ month: budgetsKey, categories: [{ category: "Food", target: 20000, actual: 1 }, { category: "Shopping", target: 15000, actual: 1 }] }, { trend: trendNow }), "all", T);
eq([p.projection.amount, p.projection.ref], [31000, { kind: "plan", amount: 35000 }], "projection = spent / day x days in month; plan total wins as the reference");
p = f.anPace(slice(), ex(null, { trend: trendNow }), "all", T);
eq(p.projection.ref, { kind: "usual", amount: 30400 }, "no plan -> usual (average of the other months)");
p = f.anPace(slice(), ex(null, { trend: trendNow }), "card", T);
eq(p.projection.ref.kind, "usual", "card mode never uses the plan");
p = f.anPace(slice(), null, "all", T);
eq(p.projection.ref, null, "no reference -> projection only");
ok(f.anUsual(ex(null, { trend: trendNow }), "all", T) === 30400, "usual excludes the month being viewed");
ok(f.anUsual(ex(null, { trend: trend5([0, 0, 0, 0, 30000]) }), "all", T) === null, "usual needs two months with spending");
ok(f.anUsual(ex(null, { trend: trend5([0, 0, 0, 20000, 30000]) }), "all", T) === 25000, "months with no spending are left out of the average");
ok(f.anUsual(null, "all", T) === null, "usual without extras");

// ---- category change chips ----
eq(f.anCatChange(1310, 1000, TP), { pct: 31, dir: "up", text: "+31%" }, "+31%");
eq(f.anCatChange(770, 1000, TP), { pct: -23, dir: "down", text: "-23%" }, "-23% in a finished month");
ok(f.anCatChange(770, 1000, T) === null, "running month: a drop is not shown");
eq(f.anCatChange(1310, 1000, T).dir, "up", "running month: a rise is shown");
ok(f.anCatChange(1040, 1000, TP) === null && f.anCatChange(960, 1000, TP) === null, "under 5% -> no chip");
ok(f.anCatChange(1050, 1000, TP) !== null, "exactly 5% shows");
ok(f.anCatChange(500, 0, TP) === null && f.anCatChange(500, undefined, TP) === null && f.anCatChange(500, "x", TP) === null, "previous 0 / missing / junk -> no chip");

// ---- money flow ----
let fl = f.anFlowModel({ totalCredit: 100000, totalDebit: 40000, fixedObligations: 20000, invested: 10000, saved: 10000 }, "all");
eq([fl.income, fl.notUsed, fl.left, fl.usedFromEarlier, fl.savingsRate], [100000, 20000, { amount: 20000, pct: 20 }, 0, 10], "flow: left and savings rate");
eq(fl.parts.map((x) => x.pct), [40, 20, 10, 10], "flow: legend percentages are of income");
ok(Math.abs(fl.parts.reduce((s, x) => s + x.widthPct, 0) - 80) < 0.001, "flow: bar widths add up to what was used");
fl = f.anFlowModel({ totalCredit: 50000, totalDebit: 40000, fixedObligations: 20000, invested: 0, saved: 5000 }, "all");
eq([fl.left, fl.notUsed, fl.usedFromEarlier], [null, -15000, 15000], "flow: used more than came in -> no Left, a note instead");
ok(Math.abs(fl.parts.reduce((s, x) => s + x.widthPct, 0) - 100) < 0.001, "flow: bar is full when over");
ok(f.anFlowModel({ totalCredit: 0, totalDebit: 10, saved: 0 }, "all") === null, "flow: no income -> hidden");
ok(f.anFlowModel({ totalCredit: 1000, totalDebit: 10, saved: 0 }, "card") === null, "flow: other modes -> hidden");
ok(f.anFlowModel({ totalCredit: 1000, totalDebit: 10 }, "all") === null, "flow: an older copy without `saved` -> hidden");
ok(f.anFlowModel(null, "all") === null, "flow: null");
fl = f.anFlowModel({ totalCredit: 1000, totalDebit: 100, saved: -400 }, "all");
eq([fl.savingsRate, fl.parts[3].amount], [0, 0], "flow: money taken out of savings -> rate 0, no negative segment");
fl = f.anFlowModel({ totalCredit: 1000, totalDebit: 100, saved: 5000 }, "all");
eq(fl.savingsRate, 100, "flow: savings rate is capped at 100");

// ---- day by day ----
let dm = f.anDailyModel(slice(), T);
eq([dm.bars.length, dm.avg, dm.max, dm.bars[17].future, dm.bars[18].future, dm.bars[0].label], [31, 1000, 1000, false, true, "1 Oct"], "daily: 31 slots, average over elapsed days only, future days marked");
dm = f.anDailyModel(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (i === 4 ? 5000 : 1000) : 0)), places: [] } }), T);
ok(dm.bars[4].spike && !dm.bars[3].spike, "daily: a day of 2x the average and 1,000+ is a spike");
dm = f.anDailyModel(slice({ detail: { daysInMonth: 31, daily: daily(31, 0).map((_, i) => (i < 18 ? (i === 4 ? 900 : 100) : 0)), places: [] } }), T);
ok(!dm.bars.some((b) => b.spike), "daily: 2x but under 1,000 is not a spike");
ok(f.anDailyModel(slice({ totalDebit: 0 }), T) === null, "daily: nothing spent -> hidden");
ok(f.anDailyModel(slice({ detail: undefined }), T) === null, "daily: no detail -> hidden");
ok(f.anDailyModel(slice({ detail: { daily: [] } }), T) === null, "daily: empty daily -> hidden");
dm = f.anDailyModel(slice({ detail: { daily: daily(30, 100) } }), TP);
ok(dm.bars.length === 30 && !dm.bars.some((b) => b.future), "daily: finished month has no future slots");
dm = f.anDailyModel(slice({ detail: { daily: daily(10, 100) } }), TP);
ok(dm.bars.length === 30 && dm.bars[29].amount === 0 && clean(JSON.stringify(dm)), "daily: a too-short array is padded with zeros");

// ---- your week ----
let wm = f.anWeekModel(wkSlice(), T);
eq([wm.days.map((d) => d.weekend), wm.days.map((d) => d.initial).join("")], [[false, false, false, false, false, true, true], "MTWTFSS"], "week: Mon..Sun, weekend flags");
eq(wm.caption, "Saturday is your biggest day: about ₹2,400 on average.", "week caption");
ok(f.anWeekModel(wkSlice(), f.anTodayInfo(2026, 10, new Date(2026, 9, 6))) === null, "week: under 7 elapsed days -> hidden");
ok(f.anWeekModel(wkSlice(), f.anTodayInfo(2026, 10, new Date(2026, 9, 7))) === null, "week: today does not count, so 7th of the month is still too early");
ok(f.anWeekModel(wkSlice(), f.anTodayInfo(2026, 10, new Date(2026, 9, 8))) !== null, "week: 7 FINISHED days is enough");
ok(f.anFinishedDays(f.anTodayInfo(2026, 10, new Date(2026, 9, 18))) === 17, "finished days exclude today");
ok(f.anFinishedDays(f.anTodayInfo(2026, 9, new Date(2026, 9, 18))) === 30, "a past month counts all its days");
ok(f.anWeekModel(slice({ detail: undefined }), T) === null, "week: no detail -> hidden");
ok(f.anWeekModel(slice({ detail: { daily: daily(31, 0) } }), T) === null, "week: all zero -> hidden");

// ---- places / biggest ----
const places = [{ name: "SWIGGY", amount: 3200, count: 8 }, { name: "zomato@icici", amount: 2000, count: 1 }, { name: "A", amount: 1, count: 1 }, { name: "B", amount: 1, count: 1 }, { name: "C", amount: 1, count: 1 }, { name: "D", amount: 1, count: 1 }];
let pm = f.anPlacesModel(slice({ detail: { daily: [], places: places, smallCount: 3, smallTotal: 150, smallLimit: 100 } }));
eq([pm.rows.length, pm.rows[0].countText, pm.rows[1].countText, pm.max], [5, "8 payments", "1 payment", 3200], "places: top 5, singular/plural");
eq(pm.smallLine, "Small things add up: 3 payments under ₹100 = ₹150", "places: small things line");
pm = f.anPlacesModel(slice({ detail: { daily: [], places: places, smallCount: 2, smallTotal: 150, smallLimit: 100 } }));
eq(pm.smallLine, "", "places: no small line under 3");
ok(f.anPlacesModel(slice({ detail: { daily: [], places: [] } })) === null && f.anPlacesModel(slice({ detail: undefined })) === null, "places: empty / missing -> hidden");
const bg = f.anBiggestModel(slice({ detail: { daily: [], biggest: [{ label: "TV", category: "Shopping", amount: 40000, date: "05 Oct" }, { label: "", category: "", amount: 100, date: "" }, { label: "x", amount: 0 }] } }));
eq([bg.rows.length, bg.rows[0].date, bg.rows[1].label], [2, "05 Oct", "Payment"], "biggest: drops zero amounts, fills a missing label");
ok(f.anBiggestModel(slice({ detail: { daily: [], biggest: [] } })) === null && f.anBiggestModel(slice({ detail: undefined })) === null, "biggest: empty / missing -> hidden");

// ---- trend ----
let tm = f.anTrendModel(ex(null, { trend: trendNow }), "all", T, NOW);
eq([tm.months.length, tm.months[5].sel, tm.months[5].inProgress, tm.months[4].sel, tm.usual, tm.months[5].label], [6, true, true, false, 30400, "Oct"], "trend: 6 months, the selected one flagged, running month flagged, usual excludes it");
ok(tm.months[0].income === 65000, "trend: income shown in the All view");
tm = f.anTrendModel(ex(null, { trend: trendNow }), "card", T, NOW);
ok(tm.months[0].income === null && tm.months[0].spent === 30000 * 0.3 && tm.months[5].spent === 6000, "trend: other views use byMode and no income");
tm = f.anTrendModel(ex(null, { trend: trendNow }), "all", TP, NOW);
ok(tm.months[5].sel === false && tm.months[4].sel === true && tm.months[5].inProgress === true, "trend: viewing September flags September, October still 'in progress'");
ok(f.anTrendModel(ex(null, { trend: trend5([0, 0, 0, 0, 5000]) }), "all", T, NOW) === null, "trend: fewer than 2 months with spending -> hidden");
ok(f.anTrendModel(null, "all", T, NOW) === null && f.anTrendModel({}, "all", T, NOW) === null, "trend: missing -> hidden");
ok(f.anTrendModel(ex(null, { trend: [null, { month: 99 }, { year: 2026, month: 9, spent: 100 }, { year: 2026, month: 10, spent: 100 }] }), "all", T, NOW).months.length === 2, "trend: junk entries are skipped");

// ---- plan ----
let pl = f.anPlanModel(ex({ month: budgetsKey, categories: [{ category: "Food", target: 10000, actual: 5000 }, { category: "Bills", target: 2000, actual: 2600 }, { category: "Health", target: 1000, actual: 900 }] }), "all", T);
eq(pl.rows.map((r) => [r.category, r.state, r.pct]), [["Bills", "over", 130], ["Health", "warn", 90], ["Food", "ok", 50]], "plan: sorted by use, states ok / warn / over");
eq([pl.totalTarget, pl.totalActual, pl.rows[0].over], [13000, 8500, 600], "plan: totals and the over amount");
ok(f.anPlanModel(ex(null), "all", T) === null && f.anPlanModel(ex({ month: budgetsKey, categories: [] }), "all", T) === null && f.anPlanModel(null, "all", T) === null, "plan: null / empty -> hidden");
ok(f.anPlanModel(ex({ month: budgetsKey, categories: [{ category: "Food", target: 100, actual: 1 }] }), "bank", T) === null, "plan: not in other modes");

// ---- small formatting helpers ----
eq([f.anCompact(0), f.anCompact(950), f.anCompact(1000), f.anCompact(1234), f.anCompact(12000), f.anCompact(99999), f.anCompact(150000), f.anCompact(NaN)], ["0", "950", "1k", "1.2k", "12k", "100k", "1.5L", "0"], "compact labels");
eq([f.analysisRs(14081.3), f.analysisRs(1234567), f.analysisRs(null)], ["14,081.30", "12,34,567", "0"], "rupee formatting (Indian grouping, paise to 2 places)");

// ---- the screen is wired up ----
ok(/id="analysisPace"/.test(html) && /id="analysisInsights"/.test(html) && /id="analysisFlow"/.test(html) && /id="analysisDaily"/.test(html) &&
   /id="analysisPlan"/.test(html) && /id="analysisPlaces"/.test(html) && /id="analysisWeek"/.test(html) && /id="analysisTrend"/.test(html) && /id="analysisBiggest"/.test(html), "all new card containers exist");
const order = ["analysisPace", "analysisInsights", "analysisFlow", "analysisDaily", "analysisPlan", "analysisCategories", "analysisPlaces", "analysisWeek", "analysisTrend", "analysisBiggest"].map((id) => html.indexOf('id="' + id + '"'));
ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), "cards are in the agreed order top to bottom: " + order.join(","));
ok(/id="analysisIncomeDetail"/.test(html) && /id="analysisIncomeBtn"/.test(html), "the Income drill-down is still there");
ok(/action:\s*"getAnalysisExtras"/.test(html) && /"analysisx_" \+ year/.test(html), "extras are fetched with their own cache key");
ok(/case "getAnalysisExtras"/.test(html), "Demo Mode answers getAnalysisExtras");
ok(/detail: demoDetailFinish\(allDetail\)/.test(html) && /detail: demoDetailFinish\(bucket\.detailAcc\)/.test(html), "Demo Mode adds `detail` to the All view and to every mode bucket");
ok(/anCatChange\(entry\.amount/.test(html), "category rows get their change chip");
ok(/JSON\.stringify\(anPrevCats\)/.test(html), "the category list signature includes last month's numbers");
ok(/year !== analysisYear \|\| month !== analysisMonth/.test(html), "a late extras answer for another month is ignored");
// Dark mode: the four new tokens exist in the light block and in BOTH dark blocks.
["--an-good-text", "--an-warn-text", "--an-bad-text", "--an-warn-fill"].forEach((t) => {
  const n = (html.match(new RegExp(t + ":", "g")) || []).length;
  ok(n === 3, t + " is defined in light and in both dark blocks (found " + n + ")");
});
// No hard-coded colours were added in the new JS: scan the new render functions.
const an = html.slice(html.indexOf("function renderAnalysisPace"), html.indexOf("// Picks which slice of a getMonthlyAnalysis"));
ok(!/#[0-9a-fA-F]{3,6}\b/.test(an) && !/rgba?\(/.test(an), "no hard-coded colours in the new Analysis render code");
const css = html.slice(html.indexOf("Analysis makeover (2026-10-18) ----------"), html.indexOf("Home charts (2026-08-11)"));
ok(!/#[0-9a-fA-F]{3,6}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no hard-coded colours in the new Analysis CSS");
ok(/APP_VERSION = "2026-10-(18-0[3-9]|19-[0-9]+)"/.test(html), "APP_VERSION bumped");
ok(/prefers-reduced-motion: reduce\) \{\s*\.an-card\.an-in \{ animation: none; \}/.test(html), "new fade respects reduced motion");

console.log((fail ? "FAILED" : "OK") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
