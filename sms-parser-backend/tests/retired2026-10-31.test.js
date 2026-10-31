// The old SMS reader is retired (2026-10-31): it must answer "not ok, retired" and must not touch the Sheet, so a phone that still points here
// keeps its message and retries on the new server instead of believing it was saved.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
function ok(cond, label){ if(cond) console.log("PASS: " + label); else { failed++; console.log("FAIL: " + label); } }

let sheetTouched = false;
const sandbox = {
  console,
  Utilities: { formatDate: function(){ return ""; } },
  ContentService: { createTextOutput: function(t){ return { text: t }; } },
  SpreadsheetApp: { openById: function(){ sheetTouched = true; throw new Error("must not open the Sheet"); } },
  PropertiesService: { getScriptProperties: function(){ return { getProperty: function(){ return null; } }; } },
  LockService: { getScriptLock: function(){ sheetTouched = true; throw new Error("must not lock"); } },
  UrlFetchApp: { fetch: function(){ sheetTouched = true; throw new Error("must not fetch"); } }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "Code.js"), "utf8"), sandbox, { filename: "Code.js" });

const out = sandbox.doPost({
  postData: { contents: "" },
  parameter: { sms: "Rs.500 debited from a/c XX1234 on 31-10-26 to ZOMATO", sender: "HDFCBK", timestamp: "1" }
});
const body = JSON.parse(out.text);
ok(body.ok === false, "answers ok:false");
ok(body.retired === true, "says it is retired");
ok(sheetTouched === false, "does not open the Sheet, take a lock or call out");

console.log(failed ? "FAILED: " + failed : "retired reader: all passed");
process.exit(failed ? 1 : 0);
