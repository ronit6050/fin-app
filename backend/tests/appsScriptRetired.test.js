// Apps Script is retired (2026-10-31): its doPost answers "retired" and touches nothing, the Telegram bot code and the editor-only
// helpers are gone, and the new server's shim still loads and answers a ping.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
function ok(cond, label){ if(cond) console.log("PASS: " + label); else { failed++; console.log("FAIL: " + label); } }

const dir = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(dir, "main.js"), "utf8");
const sandbox = { console, ContentService: { createTextOutput: function(t){ return { text: t, setMimeType: function(){ return this; } }; }, MimeType: { JSON: "json" } } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const out = sandbox.doPost({ postData: { contents: JSON.stringify({ action: "getPending", idToken: "x" }) } });
const body = JSON.parse(out.text);
ok(body.ok === false && body.retired === true, "doPost answers ok:false, retired:true (and never runs an action)");
ok(typeof sandbox.handlePwaRequest === "undefined", "main.js alone does not pull in the app code");
ok(typeof sandbox.checkNewTransactions === "function", "the old trigger name still exists (does nothing)");

["handlers.js", "AIAdvisor.js", "Analysis.js", "Summary.js", "Credit Card.js"].forEach(function(f){
  const p = path.join(dir, f);
  const body2 = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  ok(!/function\s+(handleTelegramUpdate|handleButtons|handleMessages|generateMonthlyAnalysis|sendTodaySummary|generateSmartReaction|processCreditCardStatement)\b/.test(body2), f + " no longer holds the old Telegram bot code");
});

console.log(failed ? "FAILED: " + failed : "apps script retired: all passed");
process.exit(failed ? 1 : 0);
