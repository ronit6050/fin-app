// Checks the pure logic behind the new-look first-run welcome tour (index.html, block between
// FIN-ONB-LOGIC-START and FIN-ONB-LOGIC-END): once-per-account memory, which cards a splits-only
// friend vs a full-app person sees, and how "what I use" answers are layered on top of the
// owner's hidden-screens list (they may add hiding, never remove the owner's).
// Also a few text checks that the real wiring in index.html is in place.
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const m = html.match(/FIN-ONB-LOGIC-START\r?\n([\s\S]*?)\/\/ FIN-ONB-LOGIC-END/);
if (!m) { console.log("FAIL: logic block not found"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + `; this.api = { Q: FIN_ONB_QUESTIONS, seen: finOnbSeenKey, usedKey: finOnbUsedKey, should: finOnbShouldShow,
  cards: finOnbCards, msg: finOnbMessagesVariant, qs: finOnbQuestionsFor, parse: finOnbParseUsed, set: finOnbSetUsed,
  hidden: finOnbHiddenByUsed, splitsOff: finOnbSplitsTileOff, isHidden: finOnbIsHidden };`, ctx);
const A = ctx.api;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- once per account ----
ok(A.seen(" Me@Gmail.com ") === "finOnboarded:me@gmail.com", "seen key is per account, lower-cased and trimmed");
ok(A.seen("a@x.com") !== A.seen("b@x.com"), "two accounts never share a memory slot");
ok(A.usedKey("a@x.com") !== A.seen("a@x.com"), "answers and 'seen' use different keys");
ok(A.should(null, "full") === true, "first open, full app: show");
ok(A.should("", "full") === true, "empty memory counts as never seen");
ok(A.should("full", "full") === false, "second open: do not show again");
ok(A.should("friend", "friend") === false, "friend already saw theirs: not again");
ok(A.should(null, "friend") === true, "first open, splits-only friend: show");
ok(A.should("friend", "full") === true, "splits-only friend later given the whole app: the full tour once");
ok(A.should("full", "friend") === false, "never shows a friend tour to someone who already had the full one");
ok(A.should(null, "bogus") === false && A.should(null, undefined) === false, "unknown variant never shows");

// ---- which cards ----
ok(same(A.cards("friend", true), ["welcomeFriend", "splitsHow", "done"]), "friend: only cards that are true for splits-only");
ok(!A.cards("friend", true).some(c => ["messages", "banks", "screens", "arrives"].indexOf(c) !== -1), "friend never hears about SMS, banks, Pending or hidden screens");
ok(same(A.cards("full", true), ["welcome", "arrives", "messages", "banks", "screens", "done"]), "full app with questions: six cards");
ok(same(A.cards("full", false), ["welcome", "arrives", "messages", "banks", "done"]), "no questions left (owner hid them all): the screens card is dropped");
ok(A.msg("Mozilla/5.0 (Linux; Android 14) FinAppNativeAndroid/1.0") === "native", "Android app detected by its marker");
ok(A.msg("Mozilla/5.0 (Linux; Android 14) Chrome/120") === "web", "plain browser = web variant");
ok(A.msg("") === "web" && A.msg(undefined) === "web", "no user agent = web variant, no crash");

// ---- questions follow the owner's hidden list ----
ok(A.qs([]).length === 5, "nothing hidden by the owner: all five questions");
ok(A.qs(["cc"]).map(q => q.key).indexOf("cc") === -1 && A.qs(["cc"]).length === 4, "owner hid CC: no CC question");
ok(A.qs(["debts"]).map(q => q.key).join() === "cc,invest,cash", "owner hid Debts: lending and splits questions both gone");
ok(A.qs(["investments"]).some(q => q.key === "invest"), "owner hid only Investments: Savings is still worth asking about");
ok(A.qs(["investments", "savings"]).every(q => q.key !== "invest"), "owner hid both: no invest question");
ok(A.qs(undefined).length === 5 && A.qs("x").length === 5, "bad input = ask everything, no crash");

// ---- parsing saved answers ----
ok(same(A.parse(null), {}) && same(A.parse(""), {}) && same(A.parse("not json"), {}), "missing / broken storage = no answers (nothing hidden)");
ok(same(A.parse('{"cc":false,"cash":true,"zzz":false}'), { cc: false }), "only a real 'no' for a known question counts");
ok(same(A.parse('[1,2]'), {}) && same(A.parse('"x"'), {}) && same(A.parse("null"), {}), "wrong shapes ignored");
const u1 = A.set({}, "cc", false);
ok(same(u1, { cc: false }), "turn a question off");
ok(same(A.set(u1, "cc", true), {}), "turn it back on removes it");
ok(same(u1, { cc: false }), "set() does not change what it was given");

// ---- hiding: defaults hide nothing ----
ok(same(A.hidden({}, false), []), "no answers: nothing hidden");
ok(same(A.hidden(undefined, false), []), "no answers object: nothing hidden");
ok(same(A.hidden({ cc: true, cash: true }, false), []), "yes answers hide nothing");
ok(same(A.hidden({ cc: false }, false), ["cc"]), "no credit card hides CC");
ok(same(A.hidden({ cash: false }, false), ["cash"]), "no cash hides Cash");
ok(same(A.hidden({ invest: false }, false), ["investments", "savings"]), "no investing hides Investments and Savings");
ok(same(A.hidden({ lend: false }, false), []), "no lending alone keeps Debts (it also holds the splits)");
ok(same(A.hidden({ splits: false }, false), []), "no splitting alone keeps Debts (lending still uses it)");
ok(same(A.hidden({ lend: false, splits: false }, false), ["debts"]), "no lending AND no splitting hides Debts");
ok(same(A.hidden({ cc: false, cash: false, invest: false, lend: false, splits: false }, true), []), "a splits-only friend never has anything hidden");
ok(A.splitsOff({ splits: false }, false) === true && A.splitsOff({}, false) === false && A.splitsOff({ splits: false }, true) === false, "splits shortcut hides only for a full-app person who said no");
ok(A.splitsOff(undefined, false) === false, "splitsOff with no answers: false");

// ---- layering over the owner's list ----
const owner = ["cc", "planner"];
ok(A.isHidden("cc", owner, {}, false) === true, "owner-hidden stays hidden when the person says nothing");
ok(A.isHidden("cc", owner, { cc: true }, false) === true, "saying 'yes, I have a credit card' never un-hides what the owner hid");
ok(A.isHidden("planner", owner, { cc: false, cash: false }, false) === true, "owner-hidden screens stay hidden whatever else is answered");
ok(A.isHidden("cash", owner, {}, false) === false, "nothing hidden unless someone chose it");
ok(A.isHidden("cash", owner, { cash: false }, false) === true, "the person's own 'no' hides it");
ok(A.isHidden("cc", [], { cc: false }, false) === true, "works with an empty owner list");
ok(A.isHidden("cash", undefined, { cash: false }, false) === true && A.isHidden("cash", undefined, {}, false) === false, "bad owner list is treated as empty");
ok(A.isHidden("cash", [], { cash: false }, true) === false, "friend mode: local choices are ignored");
// For every combination of answers, every owner-hidden name is still hidden.
let allKept = true, nothingExtra = true;
const keys = A.Q.map(q => q.key);
for (let mask = 0; mask < (1 << keys.length); mask++) {
  const used = {}; keys.forEach((k, i) => { if (mask & (1 << i)) used[k] = false; });
  ["cc", "cash", "debts", "investments", "savings", "planner", "today"].forEach(n => {
    if (!A.isHidden(n, [n], used, false)) allKept = false;
    if (A.isHidden(n, [], {}, false)) nothingExtra = false;
  });
}
ok(allKept, "for all 32 answer combinations an owner-hidden screen is still hidden");
ok(nothingExtra, "with no answers and an empty owner list nothing is hidden");

// ---- wiring in the real file ----
ok(/const local = finLocalHidden\(\);/.test(html) && /hiddenScreens\.indexOf\(name\) !== -1 \|\| local\.indexOf\(name\) !== -1/.test(html), "applyHiddenScreens ORs the owner's list with the local list");
ok(/function finLocalHidden\(\) \{ return \(!finLookOn\(\) \|\| friendMode\) \? \[\]/.test(html), "local layer is empty with the switch off or in friend mode");
ok(/if \(finIsScreenHidden\(name\)\) \{ showMoreMenu\(\); return; \}/.test(html), "opening a hidden screen sends you back to the menu (owner's or local)");
ok(/if \(!finLookOn\(\) \|\| finOnbOpen \|\| finSheetOpen \|\| demoMode/.test(html), "tour only starts in the new look, not in demo mode, not over another sheet");
ok(/localStorage\.setItem\(key, variant\);[\s\S]{0,200}catch \(e\) \{ return; \}/.test(html), "remembered before showing; blocked storage = skip");
ok(/id="finOnbSkip"/.test(html), "Skip button exists");
ok(/APP_VERSION = "2026-10-17-06"/.test(html), "APP_VERSION bumped");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
