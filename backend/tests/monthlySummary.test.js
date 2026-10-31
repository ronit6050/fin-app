// 2026-10-31: the "what happened last month" notification: builds from the Analysis numbers, sends only on the 1st (India time),
// only to people with a phone registered and the nudges switched on, and never one person's problem stopping the others.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
function ok(c, m){ if(c) console.log("PASS: " + m); else { failed++; console.log("FAIL: " + m); } }

const sent = [];
const analysis = {};                  // "yyyy-m" -> getMonthlyAnalysis-like answer
let off = {};                         // email -> true when switched off
const sb = {
  console,
  Utilities: { formatDate: function(d, tz, f){
    const x = new Date(d.getTime() + 330 * 60000), p = (n) => String(n).padStart(2, "0");
    return f === "yyyy" ? String(x.getUTCFullYear()) : f === "M" ? String(x.getUTCMonth() + 1) : f === "d" ? String(x.getUTCDate()) : f; } },
  dbSs_: function(){ return { getSheetByName: function(){ return { getDataRange: function(){ return { getValues: function(){ return [[]]; } }; } }; } }; },
  getMonthlyAnalysis: function(y, m){ return analysis[y + "-" + m] || { totalDebit: 0, categories: [] }; },
  dailySummaryPeople_: function(){ return ["a@x.com", "b@x.com", "c@x.com", "boom@x.com"]; },
  splitNotifyToken_: function(e){ return e === "c@x.com" ? "" : "tok-" + e; },
  v2dbRun_: function(email, fn){ if(email === "boom@x.com") throw new Error("one person broke"); sb.__who = email; return fn(); },
  dbProps_: function(){ return { getProperty: function(){ return off[sb.__who] ? "1" : ""; } }; },
  sendPushToToken_: function(tok, title, body, opts){ sent.push({ tok, title, body, kind: opts && opts.kind }); },
  fsFlushUsage_: function(){},
  logAI: function(){}
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "monthlySummary.js"), "utf8"), sb, { filename: "monthlySummary.js" });

const NOV1 = Date.UTC(2026, 10, 1, 5, 0);    // 1 Nov 2026, 10:30 India time
const NOV2 = Date.UTC(2026, 10, 2, 5, 0);
analysis["2026-10"] = { totalDebit: 10581, categories: [{ category: "Food", amount: 5881 }, { category: "Bills", amount: 1106 }], saved: 2350, savingGoal: 2350 };
analysis["2026-9"] = { totalDebit: 12681, categories: [] };

let r = sb.monthlySummaryBuild_(NOV1);
ok(r.title === "October: you spent ₹10,581", "title names the month that just ended and what was spent (got " + r.title + ")");
ok(/₹2,100 less than September\./.test(r.body), "compares with the month before");
ok(/Biggest: Food ₹5,881 \(56%\)\./.test(r.body), "biggest category with its share");
ok(/You saved ₹2,350 of your ₹2,350 goal\./.test(r.body), "saved against the goal");

analysis["2026-9"] = { totalDebit: 10500, categories: [] };
ok(/About the same as September/.test(sb.monthlySummaryBuild_(NOV1).body), "within 3% reads 'about the same'");
analysis["2026-9"] = { totalDebit: 9000, categories: [] };
ok(/₹1,581 more than September\./.test(sb.monthlySummaryBuild_(NOV1).body), "more than the month before");
analysis["2026-9"] = { totalDebit: 0, categories: [] };
ok(!/than/.test(sb.monthlySummaryBuild_(NOV1).body), "no comparison when the month before is empty");
analysis["2026-10"] = { totalDebit: 0, categories: [] };
ok(sb.monthlySummaryBuild_(NOV1) === null, "a month with no spending sends nothing");
analysis["2026-10"] = { totalDebit: 10581, categories: [{ category: "Food", amount: 5881 }], saved: 0, savingGoal: 0 };

// January: the month that ended is December of last year
analysis["2025-12"] = { totalDebit: 5000, categories: [] };
ok(sb.monthlySummaryBuild_(Date.UTC(2026, 0, 1, 5, 0)).title === "December: you spent ₹5,000", "on 1 January it reports December of the year before");

// the job
ok(sb.monthlySummaryRun_(NOV2) === 0 && sent.length === 0, "does nothing on any day but the 1st");
off = { "b@x.com": true };
const n = sb.monthlySummaryRun_(NOV1);
ok(n === 1 && sent.length === 1 && sent[0].tok === "tok-a@x.com" && sent[0].kind === "summary", "sends to the person with a phone and the switch on only; no phone, switched off and a failing person are skipped (sent " + n + ")");

const j = fs.readFileSync(path.join(__dirname, "..", "fnTimer.js"), "utf8");
ok(/\{ key: "monthly",\s+hour: 9,\s+minute: 45 \}/.test(j) && /key === "monthly"/.test(j), "the timer runs it once a day at 9:45 (it only acts on the 1st)");

console.log(failed ? "FAILED: " + failed : "monthlySummary: all passed");
process.exit(failed ? 1 : 0);
