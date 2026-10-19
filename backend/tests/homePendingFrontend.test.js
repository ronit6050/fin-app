// Checks the pure logic behind the Home + Pending makeover (index.html, the block between HP-LOGIC-START and
// HP-LOGIC-END): the hero wording, 7-bar strip, month chip and "heading for" pace, watch list, due chips, the Pending
// summary numbers, filter counts, day groups, the ready-banner rule, the done-today counter, 12-hour times,
// and that missing / zero / odd data hides a piece instead of printing NaN or undefined. Also checks the markup,
// Demo Mode wiring and a few safety rules the screens rely on.
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const m = html.match(/HP-LOGIC-START\r?\n([\s\S]*?)\/\/ HP-LOGIC-END/);
if (!m) { console.log("FAIL: logic block not found"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
const names = ["hpNum", "hpRs", "hpMoney", "hpPrevMonthName", "hpDateKey", "hpTime12", "hpModeLabel", "hpParseDate", "hpShortDate", "hpDaysAgo", "hpDayGroup",
  "hpIsDup", "hpIsReady", "hpMatches", "hpCounts", "hpSummary", "hpReadyBanner", "hpDoneRead", "hpDoneBump", "hpAdoptFlags", "hpDupText",
  "hpNeedsLabel", "hpTodayChips", "hpBars", "hpPace", "hpMonthChip", "hpWatchRows", "hpDueChip"];
vm.runInContext(m[1] + "; " + names.map((n) => "this." + n + " = " + n).join("; "), ctx);
const f = ctx;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ")");
const clean = (s) => typeof s === "string" && !/NaN|undefined|null|Infinity|\[object/.test(s);
const allClean = (arr) => arr.every(clean);

const NOW = new Date(2026, 9, 18, 14, 0);   // Sunday 18 Oct 2026

// ---------- 12-hour time ----------
eq(f.hpTime12("19:42"), "7:42 pm", "19:42 -> 7:42 pm");
eq(f.hpTime12("07:05"), "7:05 am", "07:05 -> 7:05 am");
eq(f.hpTime12("00:15"), "12:15 am", "midnight hour");
eq(f.hpTime12("12:00"), "12:00 pm", "noon");
eq(f.hpTime12("24:10"), "", "hour 24 is not a time");
eq(f.hpTime12("9:99"), "", "minute 99 is not a time");
eq(f.hpTime12(""), "", "empty time");
eq(f.hpTime12(null), "", "null time");
eq(f.hpTime12(undefined), "", "undefined time");
eq(f.hpTime12("evening"), "", "words are not a time");

// ---------- mode label ----------
eq([f.hpModeLabel("upi"), f.hpModeLabel("UPI"), f.hpModeLabel("card 8132"), f.hpModeLabel("card-hdfc"), f.hpModeLabel("wallet"), f.hpModeLabel("atm"), f.hpModeLabel("neft")],
  ["UPI", "UPI", "Card", "Card", "Wallet", "ATM", "Bank transfer"], "friendly modes");
eq([f.hpModeLabel(""), f.hpModeLabel(null), f.hpModeLabel("other")], ["", "", ""], "blank / other mode hides");
eq(f.hpModeLabel("cheque"), "Cheque", "unknown mode is capitalised");

// ---------- dates and day groups ----------
eq(f.hpDayGroup("18 Oct 2026", NOW), "Today", "today");
eq(f.hpDayGroup("17 Oct 2026", NOW), "Yesterday", "yesterday");
eq(f.hpDayGroup("16 Oct 2026", NOW), "Earlier", "two days ago is Earlier");
eq(f.hpDayGroup("30 Sep 2026", NOW), "Earlier", "last month is Earlier");
eq(f.hpDayGroup("19 Oct 2026", NOW), "Today", "a future date (clock skew) counts as today");
eq(f.hpDayGroup("garbage", NOW), "Earlier", "unreadable date falls to Earlier");
eq(f.hpDayGroup(undefined, NOW), "Earlier", "missing date falls to Earlier");
eq(f.hpDayGroup("01 Jan 2027", new Date(2027, 0, 1)), "Today", "year boundary today");
eq(f.hpDayGroup("31 Dec 2026", new Date(2027, 0, 1)), "Yesterday", "year boundary yesterday");
eq(f.hpShortDate("08 Oct 2026"), "8 Oct", "short date");
eq(f.hpShortDate("nope"), "", "bad short date");
eq(f.hpDaysAgo("13 Oct 2026", NOW), 5, "five days ago");

// ---------- hero chips ----------
eq(f.hpTodayChips(340, 620, 3), ["₹280 below your usual day", "3 payments"], "below usual + count");
eq(f.hpTodayChips(900, 620, 1), ["₹280 above your usual day", "1 payment"], "above usual + singular");
eq(f.hpTodayChips(640, 620, 0), ["No payments yet today"], "difference under 50 is hidden; zero payments wording");
eq(f.hpTodayChips(0, 620, 0), ["₹620 below your usual day", "No payments yet today"], "nothing spent yet, still compared");
eq(f.hpTodayChips(340, null, 2), ["2 payments"], "no usual day -> no usual chip");
eq(f.hpTodayChips(340, 620, undefined), ["₹280 below your usual day"], "no count -> no count chip");
eq(f.hpTodayChips(340, undefined, undefined), [], "no extras at all -> no chips");
eq(f.hpTodayChips(NaN, NaN, NaN), [], "NaN everywhere -> no chips");
ok(allClean(f.hpTodayChips(1234.56, 99999, 12)), "chip text never prints NaN/undefined");
eq(f.hpTodayChips(669, 620, 1)[0] === undefined || f.hpTodayChips(669, 620, 1)[0] === "1 payment", true, "a 49 rupee difference does not show");

// ---------- 7 bars ----------
const seven = [{ label: "Tue", amount: 100 }, { label: "Wed", amount: 400 }, { label: "Thu", amount: 0 }, { label: "Fri", amount: 200 }, { label: "Sat", amount: 800 }, { label: "Sun", amount: 50 }, { label: "Mon", amount: 340 }];
const bars = f.hpBars(seven);
eq(bars.length, 7, "seven bars");
eq(bars.map((b) => b.isToday), [false, false, false, false, false, false, true], "only the last is today");
eq(bars[4].pct, 100, "the biggest day is full height");
ok(bars[2].pct >= 6, "a zero day still has a tiny stub");
eq(bars[6].aria, "Mon ₹340, today", "today's aria label");
eq(bars[0].aria, "Tue ₹100", "aria label has day and amount");
eq(f.hpBars(null), [], "no data -> no bars");
eq(f.hpBars([]), [], "empty -> no bars");
eq(f.hpBars([{ label: "Mon", amount: 5 }]), [], "one bar is not a strip");
const zeroBars = f.hpBars(seven.map((b) => ({ label: b.label, amount: 0 })));
ok(zeroBars.length === 7 && zeroBars.every((b) => b.pct === 6), "all zero -> equal stubs, no NaN");
ok(allClean(f.hpBars([{ label: "Mon", amount: "x" }, { label: "Tue" }]).map((b) => b.aria + b.pct)), "junk amounts do not print NaN");

// ---------- pace ("Heading for") ----------
eq(f.hpPace(9000, 18, 31), 15500, "pace at day 18");
eq(f.hpPace(9000, 4, 31), null, "never before day 5");
eq(f.hpPace(9000, 5, 31), 55800, "from day 5");
eq(f.hpPace(0, 20, 31), null, "nothing spent -> no pace");
eq(f.hpPace(NaN, 20, 31), null, "NaN spent -> no pace");
eq(f.hpPace(100, 20, 10), null, "day beyond the month -> no pace");

// ---------- month chip ----------
eq(f.hpMonthChip(8800, 10000, "September"), { text: "12% less than September at this point", tone: "good" }, "less than last month");
eq(f.hpMonthChip(11500, 10000, "September"), { text: "15% more than September at this point", tone: "up" }, "more than last month");
eq(f.hpMonthChip(10200, 10000, "September"), null, "2% change is hidden");
eq(f.hpMonthChip(10300, 10000, "September") !== null, true, "3% change shows");
eq(f.hpMonthChip(5000, null, "September"), null, "no last-month figure -> hidden");
eq(f.hpMonthChip(5000, 0, "September"), null, "zero last month -> hidden (no divide by zero)");
eq(f.hpMonthChip(5000, undefined, "September"), null, "undefined last month -> hidden");
eq(f.hpPrevMonthName(new Date(2026, 9, 18)), "September", "previous month name");
eq(f.hpPrevMonthName(new Date(2026, 0, 5)), "December", "previous month name across the year");

// ---------- watch list ----------
const w = f.hpWatchRows([{ category: "Food", target: 6000, actual: 5400 }, { category: "Shopping", target: 3000, actual: 3600 }, { category: "Bills", target: 2000, actual: 1000 },
  { category: "Fun", target: 1000, actual: 850 }, { category: "Odd", target: 0, actual: 5 }]);
eq(w.map((r) => r.category), ["Shopping", "Food", "Fun"], "over first, then most used; under 85% and zero-target left out");
eq(w[0].text, "over ₹600", "over wording");
eq(w[0].tone, "over", "over tone");
eq(w[1].text, "90% used", "percent used wording");
eq(w[2].text, "85% used", "85% is included");
eq(f.hpWatchRows([{ category: "A", target: 100, actual: 100 }])[0].text, "100% used", "exactly on target is 100% used, not over");
eq(f.hpWatchRows([{ category: "A", target: 1000, actual: 999.9 }])[0].text, "99% used", "99.99% is not rounded up to 100");
eq(f.hpWatchRows(undefined), [], "missing watch -> none");
eq(f.hpWatchRows([]), [], "empty watch -> none");
eq(f.hpWatchRows([null, {}, { category: "X" }]), [], "junk rows ignored");
eq(f.hpWatchRows([1, 2, 3, 4, 5].map((i) => ({ category: "C" + i, target: 100, actual: 90 + i }))).length, 3, "at most 3 rows");

// ---------- due chips ----------
eq(f.hpDueChip(-2), { text: "overdue", tone: "late" }, "overdue");
eq(f.hpDueChip(0), { text: "due today", tone: "soon" }, "due today");
eq(f.hpDueChip(1), { text: "in 1 day", tone: "soon" }, "one day");
eq(f.hpDueChip(3), { text: "in 3 days", tone: "soon" }, "within 3 days is soon");
eq(f.hpDueChip(9), { text: "in 9 days", tone: "" }, "later is plain");
eq(f.hpDueChip(null), { text: "", tone: "" }, "no date -> no chip");
eq(f.hpDueChip(undefined), { text: "", tone: "" }, "undefined -> no chip");
eq(f.hpNeedsLabel(1), "1 payment to note", "singular label");
eq(f.hpNeedsLabel(7), "7 payments to note", "plural label");
eq(f.hpNeedsLabel(NaN), "0 payments to note", "NaN label");

// ---------- pending list helpers ----------
const mk = (o) => Object.assign({ row: 2, type: "debit", amount: 100, date: "18 Oct 2026", fp: "x" }, o);
const list = [mk({ row: 2, ready: true }), mk({ row: 3, ready: true }), mk({ row: 4, ready: false }), mk({ row: 5, type: "credit", amount: 350, date: "17 Oct 2026" }),
  mk({ row: 6, ready: true, duplicateOf: { row: 2, minutesApart: 7 } }), mk({ row: 7, ready: false, amount: 50, date: "10 Oct 2026" })];
const c = f.hpCounts(list);
eq([c.all, c.ready, c.needs, c.money, c.readyKnown], [6, 2, 3, 1, true], "filter counts (a ready duplicate is NOT ready; credits are Money in only)");
eq(list.filter((t) => f.hpMatches(t, "needs")).map((t) => t.row), [4, 6, 7], "needs-you rows");
eq(list.filter((t) => f.hpMatches(t, "in")).map((t) => t.row), [5], "money-in rows");
eq(list.filter((t) => f.hpMatches(t, "all")).length, 6, "all rows");
const old = [mk({ row: 2 }), mk({ row: 3 })];
eq(f.hpCounts(old).readyKnown, false, "old data with no ready field -> not known (chip and banner hide)");
eq(f.hpCounts(old).ready, 0, "old data has no ready cards");
eq(f.hpCounts(null), { all: 0, ready: 0, needs: 0, money: 0, readyKnown: false }, "null list");
eq(f.hpMatches(undefined, "ready"), true, "a card we know nothing about stays visible");

// banner
eq(f.hpReadyBanner(list), { show: true, count: 2, text: "2 payments look ready to confirm" }, "banner with 2 ready");
eq(f.hpReadyBanner([mk({ ready: true })]).show, false, "one ready card -> no banner");
eq(f.hpReadyBanner(old).show, false, "no ready flags -> no banner");
eq(f.hpReadyBanner([mk({ ready: true }), mk({ ready: true, duplicateOf: { minutesApart: 1 } })]).show, false, "a duplicate does not count toward the banner");
eq(f.hpReadyBanner(undefined).show, false, "undefined list -> no banner");

// summary
const s = f.hpSummary(list, 4, NOW);
eq(s.count, 6, "summary count");
eq(s.waiting, 450, "waiting = money out");
eq(s.moneyIn, 350, "money in");
eq(s.pct, 40, "4 done of 10 total = 40%");
eq(s.moneyText, "₹450 waiting · ₹350 money in", "money text");
eq(s.moneyParts, ["₹450 waiting", "₹350 money in"], "money parts for the two-line summary");
eq(f.hpSummary([mk({})], 0, NOW).moneyParts, ["₹100 waiting"], "one money line when nothing is coming in");
eq(s.caption, "4 done today · oldest is 8 days old", "caption with both parts");
const s2 = f.hpSummary([mk({ amount: 80 })], 0, NOW);
eq(s2.caption, "0 done today", "nothing old -> the age part is left out");
eq(s2.pct, 0, "no progress yet");
eq(s2.moneyText, "₹80 waiting", "no money-in part when there is none");
eq(f.hpSummary([mk({ date: "17 Oct 2026" })], 0, NOW).caption, "0 done today · oldest is 1 day old", "singular day");
const s3 = f.hpSummary([], 0, NOW);
eq([s3.count, s3.pct, s3.waiting], [0, 0, 0], "empty list is all zeros");
ok(allClean([s.moneyText, s.caption, s2.moneyText, s2.caption, s3.moneyText, s3.caption]), "summary text never prints NaN/undefined");
eq(f.hpSummary(null, NaN, NOW).count, 0, "null list and NaN done do not throw");
eq(f.hpSummary([mk({ date: "bad date", amount: "abc" })], 0, NOW).caption, "0 done today", "unreadable date and amount are survived");

// ---------- done-today counter ----------
function fakeStore() { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, raw: d }; }
const st = fakeStore();
eq(f.hpDoneRead(st, "k", "2026-10-18"), 0, "starts at zero");
eq(f.hpDoneBump(st, "k", "2026-10-18", 1), 1, "bump to 1");
eq(f.hpDoneBump(st, "k", "2026-10-18", 1), 2, "bump to 2");
eq(f.hpDoneBump(st, "k", "2026-10-18", -1), 1, "a failed save takes one back");
eq(f.hpDoneBump(st, "k", "2026-10-18", -5), 0, "never below zero");
f.hpDoneBump(st, "k", "2026-10-18", 3);
eq(f.hpDoneRead(st, "k", "2026-10-19"), 0, "a new date resets");
eq(f.hpDoneBump(st, "k", "2026-10-19", 1), 1, "the new day starts at 1");
eq(f.hpDoneRead(fakeStore(), "k", "2026-10-18"), 0, "a different store is separate");
const bad = fakeStore(); bad.setItem("k", "{not json");
eq(f.hpDoneRead(bad, "k", "2026-10-18"), 0, "corrupt storage reads as zero");
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
eq(f.hpDoneRead(throwing, "k", "d"), 0, "blocked storage reads as zero");
eq(f.hpDoneBump(throwing, "k", "d", 1), 1, "blocked storage does not throw on write");
eq(f.hpDateKey(new Date(2026, 0, 5)), "2026-01-05", "date key is zero-padded local date");

// ---------- adopting newer flags ----------
const t1 = { row: 2, ready: false, readyWhy: "", duplicateOf: null };
f.hpAdoptFlags(t1, { ready: true, readyWhy: "because", duplicateOf: { row: 1, minutesApart: 4 } }, false);
eq([t1.ready, t1.readyWhy, !!t1.duplicateOf], [true, "because", true], "fresh flags are adopted");
const t2 = { row: 2, ready: true, duplicateOf: null };
f.hpAdoptFlags(t2, { ready: true, readyWhy: "x", duplicateOf: { minutesApart: 4 } }, true);
eq(t2.duplicateOf, null, "after Keep both the duplicate flag is not brought back");
f.hpAdoptFlags(null, {}, false);
f.hpAdoptFlags({}, null, false);
ok(true, "adopting from nothing does not throw");

// ---------- duplicate wording ----------
eq(f.hpDupText("Swiggy", 7), "Swiggy: same amount, 7 minutes apart", "minutes");
eq(f.hpDupText("Swiggy", 1), "Swiggy: same amount, 1 minute apart", "one minute");
eq(f.hpDupText("Swiggy", 0), "Swiggy: same amount, at almost the same time", "zero minutes");
eq(f.hpDupText("Swiggy", 180), "Swiggy: same amount, 3 hours apart", "hours");
ok(allClean([f.hpDupText("", NaN), f.hpDupText(null, undefined)]), "dup text with nothing never prints NaN");

// ---------- money formatting ----------
eq(f.hpMoney(340), "₹340", "whole rupees");
eq(f.hpMoney(46.5), "₹46.50", "paise are kept");
eq(f.hpMoney(12345), "₹12,345", "Indian grouping");
eq(f.hpMoney(NaN), "₹0", "NaN money");

// ---------- markup, wiring and safety rules ----------
ok(/id="homeToday"/.test(html) && /id="homeRunwayBody"/.test(html), "hero has a today half and a run-out half");
ok(/id="homeMonth"/.test(html) && /id="homeWatch"/.test(html), "This month and Watch list cards exist");
ok(/id="pendingSummary"/.test(html) && /id="pendingFilters"/.test(html) && /id="pendingReadyBanner"/.test(html) && /id="pendingReview"/.test(html), "Pending chrome exists");
ok(/data-filter="ready"/.test(html) && /data-filter="needs"/.test(html) && /data-filter="in"/.test(html), "four filter chips");
ok(/homeExtra:\s*demoComputeHomeExtra/.test(html), "Demo Mode sends homeExtra");
ok(/ready: ready, readyWhy:/.test(html) && /duplicateOf: duplicateOf/.test(html), "Demo Mode pending items carry ready / readyWhy / duplicateOf");
ok(/--danger-text: #a8201a/.test(html), "light danger-text token defined");
ok((html.match(/--danger-text: #F67979/g) || []).length === 2, "danger-text defined in both dark blocks");
ok(/Possible duplicate/.test(html) && /Keep both/.test(html) && /Remove this one/.test(html), "duplicate card wording");
ok(/Review and confirm/.test(html) && /Confirm selected/.test(html), "bulk confirm wording");
ok(/Clear them/.test(html), "Needs you button wording");
ok(/APP_VERSION = "2026-10-(18-0[4-9]|19-[0-9]+)"/.test(html), "APP_VERSION bumped");
ok(/leaves today out of the week average/i.test(html) || /Analysis leaves today out/.test(html) || /APP_CHANGELOG = "[^"]*Card Coach/.test(html), "changelog mentions the latest change (Analysis fixes, or the newer Card Coach note)");
// the new screens must go through the normal Save button, never a second save path
const bulkStart = html.indexOf("function openPendingReview");
const bulk = html.slice(bulkStart, html.indexOf('document.getElementById("pcReadyBtn").addEventListener', bulkStart));
ok(/\.save-btn"\)\.click\(\)/.test(bulk) && !/action:\s*"saveNote"/.test(bulk), "bulk confirm presses each card's own Save button");
// nothing is saved when the review list merely opens
const beforeGo = bulk.slice(0, bulk.indexOf('goBtn.addEventListener("click"'));
ok(!/\.click\(\)/.test(beforeGo.replace(/\.pc-rv-[a-z]+/g, "")), "opening the review list saves nothing");
// no hard-coded colours were added in the new blocks
const hpCss = html.slice(html.indexOf("Home: one hero card + monthly pace"), html.indexOf("/* ---------- Loading spinner"));
const pcCss = html.slice(html.indexOf("Pending makeover (2026-10-18): summary"), html.indexOf("Need / Want / Saving — three tappable"));
ok(!/#[0-9a-fA-F]{3,6}\b/.test(hpCss.replace(/--[a-z-]+:[^;]*;/g, "")), "no hex colours in the Home CSS");
ok(!/#[0-9a-fA-F]{3,6}\b/.test(pcCss.replace(/--[a-z-]+:[^;]*;/g, "").replace(/color: #fff;/g, "").replace(/#fff;/g, "")), "no hex colours in the Pending CSS (besides white on the filled button)");
// user text from the bank/SMS must be escaped wherever it is written into the new cards
ok(/escapeHtml\(name\)/.test(html) && /escapeHtml\(v\.note\)/.test(html) && /escapeHtml\(r\.txn\.readyWhy\)/.test(html), "user text is escaped in the new cards");

ok(!/TEMP-HP-TEST/.test(html), "no temporary test hook left in index.html");
console.log(fail === 0 ? "OK: " + pass + " checks passed" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
