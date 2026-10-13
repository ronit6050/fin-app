// backend/tests/smsReplay.test.js
//
// Plain-English what this checks: the strongest proof that landing SMS directly gives the SAME result as the old way. It takes every
// real SMS event the phone ever sent (local-data/sms_replay.json, in time order, repeats included: weekly resyncs and double texts),
// feeds them one by one through (A) the OLD SMS reader into an empty list of rows and (B) the NEW direct path into an empty private
// copy, and requires that both end up with the SAME saved transactions in the same order (same amount, type, reference and merchant).
// Skipped when that file is not on this computer (it holds private messages and is never committed).
// Run with: node backend/tests/smsReplay.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { build, OWNER, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const file = path.join(__dirname, "..", "..", "local-data", "sms_replay.json");
if(!fs.existsSync(file)){
  console.log("SKIP: no local-data/sms_replay.json on this computer, so the real-message replay is skipped");
  process.exit(0);
}
const events = JSON.parse(fs.readFileSync(file, "utf8"));

// ---- A: the OLD SMS reader (Code.js doPost) writing into an in-memory Transactions list
function runOld(){
  const rows = [];
  const sandbox = {
    SpreadsheetApp: { openById: function(){ return { getSheetByName: function(name){
      if(name === "Transactions") return {
        getLastRow: function(){ return rows.length + 1; },
        getRange: function(r, c, nr, nc){ return { getValues: function(){ return rows.map(function(row){ const o = []; for(let i = 0; i < nc; i++) o.push(row[c - 1 + i] !== undefined ? row[c - 1 + i] : ""); return o; }); } }; },
        appendRow: function(row){ rows.push(row); }
      };
      if(name === "Logs") return { appendRow: function(){} };
      return null;                                              // no LearnedSpamPatterns tab
    } }; } },
    ContentService: { createTextOutput: function(t){ return { text: t }; } },
    LockService: { getScriptLock: function(){ return { waitLock: function(){}, releaseLock: function(){} }; } },
    Utilities: { formatDate: function(date, tz, fmt){
      const d = new Date(new Date(date).getTime() + 330 * 60000); const pad = function(n){ return String(n).padStart(2, "0"); };
      if(fmt === "HH:mm:ss") return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
      return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
    } },
    console: { log: function(){}, error: console.error }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "sms-parser-backend", "Code.js"), "utf8"), sandbox, { filename: "Code.js" });
  events.forEach(function(e){
    sandbox.doPost({ parameter: { sms: e.sms, sender: e.sender, timestamp: String(e.ts) }, postData: { contents: "" } });
  });
  return rows;
}

// ---- B: the NEW direct path (smsIn) into an empty private copy
function runNew(){
  const w = build(); const sb = w.sb;
  sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
  sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
  sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
  const oldFormat = sb.Utilities.formatDate;
  sb.Utilities.formatDate = function(date, tz, fmt){
    const d = new Date(new Date(date).getTime() + 330 * 60000); const pad = function(n){ return String(n).padStart(2, "0"); };
    if(fmt === "HH:mm:ss") return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
    if(fmt === "yyyyMMdd") return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  };
  sb.CacheService = { getScriptCache: function(){ return { get: function(){ return null; }, put: function(){}, remove: function(){} }; } };
  sb.sendPushNotification = function(){};
  sb.smsFormatRecord_ = function(){};                           // not part of this comparison
  w.addSheet("Transactions", [TXN_HEADER]);
  ["Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  sb.v2dbImportOwner(); sb.v2dbEnableOwner(); sb.v2dbEnableOwnerDirect();
  const key = w.act("owner", { action: "getMyIngestKey" }).key;
  const outcomes = {};
  events.forEach(function(e){
    const r = JSON.parse(sb.handlePwaRequest({ action: "smsIn", key: key, sms: e.sms, sender: e.sender, timestamp: e.ts }).getContent());
    const k = r.ok ? r.outcome : "ERROR:" + r.error;
    outcomes[k] = (outcomes[k] || 0) + 1;
  });
  return { rows: w.virtualTab(OWNER, "Transactions").slice(1), outcomes: outcomes };
}

console.log("\nReplaying " + events.length + " real SMS events through both paths (this takes a little while)...");
const oldRows = runOld();
const t0 = Date.now();
const nu = runNew();
console.log("  old path saved " + oldRows.length + " rows; new path saved " + nu.rows.length + " rows (" + Math.round((Date.now() - t0) / 1000) + "s). New outcomes: " + JSON.stringify(nu.outcomes));

const key = function(r){ return [Number(r[5]) || String(r[5]), String(r[3]), String(Number(r[6]) || r[6]), String(r[7])].join("|"); };
let firstDiff = -1;
for(let i = 0; i < Math.max(oldRows.length, nu.rows.length); i++){
  if(!oldRows[i] || !nu.rows[i] || key(oldRows[i]) !== key(nu.rows[i])){ firstDiff = i; break; }
}
if(firstDiff !== -1){
  console.error("  first difference at saved row " + firstDiff + ":\n    old: " + JSON.stringify(oldRows[firstDiff] && oldRows[firstDiff].slice(0, 8)) + "\n    new: " + JSON.stringify(nu.rows[firstDiff] && nu.rows[firstDiff].slice(0, 8)));
}
assert(oldRows.length === nu.rows.length, "both paths saved the same NUMBER of transactions (" + oldRows.length + " vs " + nu.rows.length + ")");
assert(firstDiff === -1, "and every saved transaction is the same, in the same order (amount, type, reference, merchant)");
assert(oldRows.length > 100, "the replay really contains hundreds of real transactions");
