// Checks for the new-look makeover, Part B (index.html):
//  1. finParseCountText: which pieces of screen text may count up (one number only).
//  2. The wiring tables still point at things that really exist in the page (a renamed id would
//     silently stop a screen from animating or a form from opening in the sheet).
//  3. Safety: every new CSS rule for Part B is behind the New look switch, and it ships no raw colours.
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };

// ---- 1. count-up text parsing ----
const m = html.match(/FIN-LOGIC-START\r?\n([\s\S]*?)\/\/ FIN-LOGIC-END/);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + "; this.parse = finParseCountText;", ctx);
const P = (t) => ctx.parse(t);
let r = P("₹1,24,000");
ok(r && r.value === 124000 && r.prefix === "₹" && r.suffix === "", "rupees with Indian commas");
r = P("-₹500");
ok(r && r.value === 500 && r.prefix === "-₹", "sign stays in the prefix");
r = P("− ₹750");
ok(r && r.value === 750 && /^− ₹$/.test(r.prefix), "minus sign + space stays in the prefix");
r = P("37%");
ok(r && r.value === 37 && r.suffix === "%", "percent suffix");
r = P("₹12.5");
ok(r && r.value === 12.5, "decimals");
r = P("₹820 ");
ok(r && r.value === 820 && r.suffix === " ", "trailing space is kept so a following label does not touch it");
ok(P("₹100 of ₹500") === null, "two numbers: left alone");
ok(P("12:30") === null, "a time: left alone");
ok(P("None yet") === null, "no number: left alone");
ok(P("") === null && P(null) === null && P(undefined) === null, "empty input is safe");
ok(P("1.2.3") === null, "not a number: left alone");

// ---- 2. wiring tables point at real things ----
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));
const subBlock = html.match(/const SUB = \{([\s\S]*?)\n      \};/)[1];
const roots = [...subBlock.matchAll(/root: "([^"]+)"/g)].map((x) => x[1]);
ok(roots.length >= 11, "all 11 More screens are registered for the open animation (" + roots.length + ")");
roots.forEach((id) => ok(ids.has(id), "play root exists: " + id));
[...subBlock.matchAll(/#([A-Za-z0-9]+)/g)].map((x) => x[1]).forEach((id) => ok(ids.has(id), "selector id exists: #" + id));
const targets = [...html.matchAll(/class="more-menu-item[^"]*"[^>]*data-target="([^"]+)"/g)].map((x) => x[1]);
const subNames = [...subBlock.matchAll(/^\s{8}([a-z]+):\s*\{/gm)].map((x) => x[1]);
targets.forEach((t) => ok(subNames.includes(t), "More tile '" + t + "' has an open animation entry"));

const formsBlock = html.match(/const FIN_SHEET_FORMS = \[([\s\S]*?)\n    \];/)[1];
[...formsBlock.matchAll(/(?:form|focus|opener|cancel): "([^"]+)"/g)].forEach((x) => ok(ids.has(x[1]), "sheet table id exists: " + x[1]));
[...formsBlock.matchAll(/save: "([^"]+)"/g)].forEach((x) => x[1].split(",").forEach((sel) => ok(ids.has(sel.trim().replace(/^#/, "")), "save button exists: " + sel.trim())));
FIN_FORMS = [...formsBlock.matchAll(/form: "([^"]+)"/g)].map((x) => x[1]);
ok(FIN_FORMS.length === 7, "7 forms lent to the bottom sheet");
FIN_FORMS.forEach((f) => ok(new RegExp('id="' + f + '"[^>]*style="[^"]*display:\\s*none').test(html), f + " starts hidden (the sheet opens when it is shown)"));
ok(ids.has("moreGroupAdvisors") && ids.has("finSheetSub"), "label hooks exist");

// ---- 3. CSS safety ----
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const partB = css.slice(css.lastIndexOf("/*", css.indexOf("UI/UX MAKEOVER, PART B")));
const stripped = partB.replace(/\/\*[\s\S]*?\*\//g, "");
// every rule's selector list must start with :root[data-look="new"], or be one of the allowed always-on helpers
const rules = [...stripped.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((x) => x[2].trim()).filter(Boolean);
const allowedBase = [".fin-switch, .fin-whatsnew-list", ".fin-onb-only", "body.friend-mode .fin-onb-only", ".fin-sheet .fin-in-sheet", ".fin-sheet .fin-in-sheet .pending-result",
  ".fin-sheet .fin-in-sheet > button,\n    .fin-sheet .fin-in-sheet > div > button", ".fin-sheet #quickActionLabel", ".fin-sheet #quickActionCancelButton", ".fin-sheet.fin-nosub .fin-sheet-title"];
let stray = [];
rules.forEach((sel) => {
  const parts = []; let depth = 0, cur = "";          // split on commas that are not inside (...)
  for (const ch of sel) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
  parts.push(cur.trim());
  parts.forEach((p) => { if (!p.startsWith(':root[data-look="new"]') && !p.startsWith(".fin-sheet") && p !== ".fin-switch" && p !== ".fin-whatsnew-list" && p !== ".fin-onb-only" && p !== "body.friend-mode .fin-onb-only") stray.push(p); });
});
ok(stray.length === 0, "all Part B rules are behind the New look switch (stray: " + stray.slice(0, 3).join(" | ") + ")");
ok(!/#[0-9a-fA-F]{3,8}\b(?![^()]*\))/.test(stripped.replace(/url\([^)]*\)/g, "")), "no raw hex colours in Part B CSS");
ok(!/rgba?\(/.test(stripped), "no raw rgb colours in Part B CSS");
// the generic reduced-motion block exists for Part B
ok(/prefers-reduced-motion: reduce\) \{\s*:root\[data-look="new"\] #view-more \.fin-slide-r/.test(partB), "Part B has a reduced-motion block");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
