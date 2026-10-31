// 2026-10-31: a message the bank-SMS reader could not understand ("NEEDS REVIEW: ...") must read as plain words in the app,
// show the bank's own text, start with an empty note, and stay off Home's Latest list. And the Home runway card must not claim
// "money runs out today" when the balance estimate is zero or below.
const fs = require("fs");
const path = require("path");

let failed = 0;
function ok(c, m){ if(c) console.log("PASS: " + m); else { failed++; console.log("FAIL: " + m); } }

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const pwa = fs.readFileSync(path.join(__dirname, "..", "PWA.js"), "utf8");

const fn = html.match(/function isUnreadableWho\(s\)[\s\S]*?function friendlyWho\(s\) \{[\s\S]*?\n    \}/);
ok(!!fn, "the helper exists in index.html");
const helpers = new Function(fn[0] + "; return { isUnreadableWho, friendlyWho };")();
ok(helpers.friendlyWho("NEEDS REVIEW: unrecognized message") === "Unreadable bank message", "'NEEDS REVIEW: unrecognized message' reads 'Unreadable bank message'");
ok(helpers.friendlyWho("NEEDS REVIEW: Swiggy") === "Swiggy (please check)", "a partly read merchant keeps its name and asks for a check");
ok(helpers.friendlyWho("Swiggy") === "Swiggy" && helpers.friendlyWho("") === "", "a normal name is left alone");
ok(helpers.isUnreadableWho("NEEDS REVIEW: x") && !helpers.isUnreadableWho("Zomato"), "unreadable messages are recognised");

ok(/value="\$\{escapeHtml\(txn\.suggestedNote \|\| \(isUnreadableWho\(txn\.counterparty\) \? "" :/.test(html), "the Pending note starts empty for an unreadable message");
ok(/\(d\.latest \|\| \[\]\)\.filter\(function \(t\) \{ return !isUnreadableWho\(t\.label\); \}\)/.test(html), "Home's Latest list leaves unreadable messages out");
ok(/txn\.rawSms \? '<div class="pl-rawsms">/.test(html), "the Pending card shows the bank's own text");
ok(/rawSms:\s+\/\^NEEDS REVIEW\/i\.test\(String\(counterparty\)\)/.test(pwa), "the server sends the text only for unreadable messages");
ok(/if \(r\.balanceUnknown\) \{[\s\S]{0,300}askForm\("Confirm your bank balance"/.test(html), "a drifted balance asks for the real one instead of claiming a run-out date");

console.log(failed ? "FAILED: " + failed : "unreadableMessage: all passed");
process.exit(failed ? 1 : 0);
