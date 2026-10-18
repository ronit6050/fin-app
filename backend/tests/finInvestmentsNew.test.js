// backend/tests/finInvestmentsNew.test.js
//
// Plain English: the redesigned Investments screen is wired into several places (the servers' lists of "saving"
// actions, the demo mode, the Back button, the New look switch). A missed list would make a button silently do
// nothing on the new server or in Demo Mode, so this checks that every new action is named everywhere it must be,
// and that the older screen is kept for the switch-off case. (The screen itself was also run in the browser.)
//
// Run with: node backend/tests/finInvestmentsNew.test.js

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let passed = 0, failed = 0;
function ok(cond, name){ if(cond){ passed++; console.log("PASS: " + name); } else { failed++; console.log("FAIL: " + name); } }

const html = read("index.html");
const NEW_ACTIONS = ["saveInvestmentHolding", "recordInvestmentSale", "deleteInvestmentEntry", "startInvestmentsFresh", "removeInvestmentHolding"];

NEW_ACTIONS.forEach((a) => {
  ok(read("backend/PWA.js").includes('data.action === "' + a + '"'), a + " is routed in the backend");
  ok(read("backend/viewPublisher.js").includes('"' + a + '"'), a + " marks the Home copy as changed (viewPublisher.js)");
  ok(read("functions/index.js").includes('"' + a + '"'), a + " is accepted by the new server (functions/index.js)");
  ok(read("backend/v2route.js").includes('"' + a + '"'), a + " is allowed for a switched-on friend (v2route.js)");
  ok((html.match(new RegExp('"' + a + '"', "g")) || []).length >= 4, a + " is in the phone's action lists and the demo router");
  ok(new RegExp('case "' + a + '":').test(html), a + " is handled by Demo Mode");
});

ok(/id="investmentsNew"/.test(html) && /class="iv-old"/.test(html), "the new container and the kept older markup both exist");
ok(/if \(finLookOn\(\) && inv\.overview\) \{[\s\S]{0,200}renderInvestmentsNew\(inv\)/.test(html), "renderInvestments draws the new screen only with the New look AND an overview");
ok(/investmentsContentEl\.classList\.remove\("iv-newon"\)/.test(html), "without them the older screen is used");
ok(/ivLeave\(\);/.test(html) && /ivLookChanged\(\);/.test(html), "leaving the screen and flipping the switch are handled");
ok(/ivOpenName && subViews\.investments\.style\.display !== "none"/.test(html), "the phone's Back button closes a holding page first");
ok(/APP_VERSION = "2026-10-[0-9]+-[0-9]+"/.test(html) && /Investments screen is redesigned/.test(html), "version bumped and the changelog mentions the Investments screen");
ok(/INVESTMENT_CATEGORIES/.test(read("backend/investmentInstruments.js")) && /"InvestmentInstruments": \["Name", "Category", "SipAmount", "SipDay", "SipActive"\]/.test(read("backend/v2route.js")), "a new person's empty tabs have the new columns");
ok(/"Investments": \["Date", "Name", "Amount", "Note", "Kind"\]/.test(read("backend/v2route.js")), "...and the Kind column");

ok(/<button type="button" class="type-btn" data-type="Investment">Investment<\/button>\s*<\/div>\s*<div class="type-hint-row">/.test(html), "the Pending card has an Investment button");
ok(/btn\.dataset\.type === "Investment"[\s\S]{0,500}sipOpt\.click\(\)/.test(html), "that button opens the holding picker (the person must choose a holding)");
ok(/data\.eventInvestmentLogged === false/.test(html), "a marked investment that was not added says so");
ok(/function undoAutoLogInvestment/.test(read("backend/financialEvents.js")) && /eventInvestmentLogged/.test(read("backend/PWA.js")), "the backend can take the entry back and reports whether it logged");
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
