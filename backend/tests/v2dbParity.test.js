// backend/tests/v2dbParity.test.js
//
// Plain-English what this checks: the REAL backend code (the same screens and saves the live app uses) gives
// IDENTICAL answers and leaves IDENTICAL data whether it runs on a plain Sheet or on the Firestore-backed
// virtual spreadsheet (v2db.js). It uses a copy of the owner's real data when a Sheet backup is on this computer
// (local-data/backups); otherwise it skips. The plain-Sheet run is the "answer key".
// Run with: node backend/tests/v2dbParity.test.js

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const OWNER = "ronitnadar9@gmail.com";
const FIXED_NOW = Date.now();                    // one moment shared by both worlds
const IST_MIN = 330;
const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "investmentInstruments.js",
  "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "obligationReminders.js", "appHealth.js",
  "firestore.js", "viewPublisher.js", "splits.js", "planner.js", "CCAdvisor.js", "DebtAdvisor.js", "SavingsAdvisor.js", "cash.js",
  "v2db.js"
];
// Which columns of each tab the real Sheet shows as dates/times (Apps Script hands those over as Date objects)
const DATECOLS = { Transactions: [0, 1], Transactions_Ignored: [0, 1], Cash: [1, 2, 9], Debts: [0, 5, 7], Savings: [0], Goals: [5], Investments: [0],
                   InvestmentInstruments: [], FinancialEvents: [3], Budgets: [0], SmartMemory: [5], NoteMemory: [4], TypeVotes: [3], LearnedSpamPatterns: [0] };
const toDate = function(serial){ return new Date(Date.UTC(1899, 11, 30) + serial * 86400000 - IST_MIN * 60000); };

function findBackup(){
  const root = path.join(__dirname, "..", "..", "local-data", "backups");
  try{
    const all = fs.readdirSync(root).filter(function(d){ return fs.existsSync(path.join(root, d, "manifest.json")); }).sort();
    return all.length ? path.join(root, all[all.length - 1]) : null;
  }catch(e){ return null; }
}

function loadTabs(folder){
  const tabs = {};
  Object.keys(DATECOLS).forEach(function(tab){
    const f = path.join(folder, tab + ".raw.json");
    if(!fs.existsSync(f)) return;
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    tabs[tab] = (Array.isArray(d) ? d : d.values).map(function(r){
      return r.map(function(v, ci){ return (DATECOLS[tab].indexOf(ci) >= 0 && typeof v === "number" && v > 0) ? toDate(v) : v; });
    });
  });
  // The backup has every transaction already handled; make the last few debits "new" again so the save tests have real work.
  const T = tabs.Transactions;
  let made = 0;
  for(let i = T.length - 1; i > 0 && made < 6; i--){
    const r = T[i];
    while(r.length < 21) r.push("");
    if(String(r[3]).toLowerCase() === "debit" && r[0] && r[5]){ r[15] = "YES"; r[12] = ""; r[13] = ""; r[16] = ""; r[17] = ""; r[18] = ""; r[19] = ""; made++; }
  }
  return tabs;
}

// One world: either plain fake Sheets (the answer key) or the virtual spreadsheet over a fake Firestore.
function makeEnv(tabs, virtual){
  const w = makeWorld(FILES);
  const sb = w.sb;
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  w.props.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "r@t.iam", private_key: "k", project_id: "p" });
  sb.verifyGoogleIdToken = function(){ return { email: OWNER, name: "Ronit" }; };
  sb.publishAfterAction_ = function(){};
  sb.ContentService = { createTextOutput: function(t){ return { getContent: function(){ return t; }, setMimeType: function(){ return this; } }; }, MimeType: { JSON: "json" } };
  sb.CacheService = { getScriptCache: function(){ return { get: function(){ return null; }, put: function(){}, remove: function(){} }; } };
  sb.LockService = { getScriptLock: function(){ return { tryLock: function(){ return true; }, waitLock: function(){}, releaseLock: function(){} }; } };
  sb.UrlFetchApp = { fetch: function(){ throw new Error("no network in tests"); } };
  sb.sendPushNotification = function(){}; sb.sendMessage = function(){};
  w.virtual = !!virtual;
  // Freeze the clock inside the fake Apps Script so both worlds stamp identical times (votes, "today" ...).
  sb.__fixedNow = FIXED_NOW;
  vm.runInContext("(function(){ var R = Date, fixed = __fixedNow; function F(){ if(!(this instanceof F)) return new R(fixed).toString(); if(arguments.length === 0) return new R(fixed); return new (Function.prototype.bind.apply(R, [null].concat([].slice.call(arguments))))(); } F.prototype = R.prototype; F.now = function(){ return fixed; }; F.UTC = R.UTC; F.parse = R.parse; Date = F; })();", sb);
  const SD = vm.runInContext("Date", sb);
  const inRealm = function(rows){ return rows.map(function(r){ return r.map(function(v){ return Object.prototype.toString.call(v) === "[object Date]" ? new SD(v.getTime()) : v; }); }); };
  if(virtual){
    w.store = {}; w.clock = 0;
    const clone = function(o){ return JSON.parse(JSON.stringify(o)); };
    sb.fsGetPathMeta_ = function(p){ const d = w.store[p]; return d ? { fields: clone(d.fields), updateTime: d.updateTime } : null; };
    sb.fsListPath_ = function(c){ return Object.keys(w.store).filter(function(p){ return p.indexOf(c + "/") === 0 && p.slice(c.length + 1).indexOf("/") === -1; }).map(function(p){ return { id: p.split("/").pop(), fields: clone(w.store[p].fields), updateTime: w.store[p].updateTime }; }); };
    sb.fsCommit_ = function(ops){
      ops.forEach(function(op){
        if(op.set){ const cur = w.store[op.set.path];
          if(op.set.onlyIfNew && cur){ const e = new Error("exists"); e.httpCode = 409; throw e; }
          if(op.set.onlyIfUpdateTime && (!cur || cur.updateTime !== op.set.onlyIfUpdateTime)){ const e = new Error("changed"); e.httpCode = 400; throw e; } }
      });
      return ops.map(function(op){
        if(op.set){ w.store[op.set.path] = { fields: clone(op.set.fields), updateTime: "t" + String(++w.clock).padStart(8, "0") }; return { updateTime: w.store[op.set.path].updateTime }; }
        if(op.del){ delete w.store[op.del.path]; return {}; }
        return {};
      });
    };
    Object.keys(tabs).forEach(function(t){ sb.v2dbImportTab_(OWNER, t, inRealm(tabs[t])); });
  } else {
    Object.keys(tabs).forEach(function(t){ w.addSheet(t, inRealm(tabs[t])); });
  }
  // run one app action exactly as the live app does
  w.act = function(payload){
    const run = function(){ return JSON.parse(sb.handlePwaRequest(Object.assign({ idToken: "t" }, payload)).getContent()); };
    return virtual ? sb.v2dbRun_(OWNER, run) : run();
  };
  // the final contents of a tab
  w.tab = function(name){
    let rows;
    if(virtual){ const sh = new sb.V2Db_(OWNER).getSheetByName(name); rows = sh ? sh.getDataRange().getValues() : null; }
    else { const sh = w.sheets[name]; rows = sh ? sh.getDataRange().getValues() : null; }
    if(!rows) return null;
    rows = rows.map(function(r){ const o = r.slice(); while(o.length && (o[o.length - 1] === "" || o[o.length - 1] === undefined)) o.pop(); return o; });
    while(rows.length && rows[rows.length - 1].length === 0) rows.pop();
    return rows;
  };
  return w;
}

const norm = function(v){ return Object.prototype.toString.call(v) === "[object Date]" ? { d: v.getTime() } : v; };
const tabJson = function(rows){ return rows === null ? "null" : JSON.stringify(rows.map(function(r){ return r.map(norm); })); };

const folder = findBackup();
if(!folder){
  console.log("SKIP: no Sheet backup on this computer (local-data/backups), so the real-data comparison is skipped");
} else {
  const tabs = loadTabs(folder);
  const A = makeEnv(tabs, false);       // answer key: plain Sheet
  const B = makeEnv(tabs, true);        // the same data in the Firestore-backed virtual spreadsheet

  const compare = function(label, payload){
    const a = A.act(payload), b = B.act(payload);
    const same = JSON.stringify(a) === JSON.stringify(b);
    assert(same, label + (same ? "" : "  <-- DIFFERENT: " + JSON.stringify(a).slice(0, 160) + "  vs  " + JSON.stringify(b).slice(0, 160)));
    return a;
  };
  const compareTabs = function(label, names){
    names.forEach(function(n){
      const ta = tabJson(A.tab(n)), tb = tabJson(B.tab(n));
      assert(ta === tb, label + ": tab " + n + " is identical afterwards" + (ta === tb ? "" : " (answer key " + ta.length + " chars vs virtual " + tb.length + ")"));
    });
  };
  const ALL = Object.keys(tabs);

  console.log("\n--- 1. The data copy is exact ---");
  compareTabs("after import", ALL);

  console.log("\n--- 2. Every screen gives the same answer ---");
  compare("Home dashboard", { action: "getDashboard" });
  compare("Today", { action: "getTodaySummary" });
  const now = new Date();
  [0, 1, 2, 3].forEach(function(back){
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    compare("Analysis for " + (d.getMonth() + 1) + "/" + d.getFullYear(), { action: "getMonthlyAnalysis", year: d.getFullYear(), month: d.getMonth() + 1 });
  });
  compare("CC Advisor", { action: "getCCAdvisor" });
  compare("Debts", { action: "getDebts" });
  compare("Cash", { action: "getCash" });
  compare("Investments", { action: "getInvestments" });
  compare("Investment instruments", { action: "getInvestmentInstruments" });
  compare("Savings and goals", { action: "getSavingsGoals" });
  compare("History page 1", { action: "getTransactionHistory", offset: 0, limit: 20 });
  compare("History page 3", { action: "getTransactionHistory", offset: 40, limit: 20 });
  compare("Planner", { action: "getPlannerData", month: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") });
  const pending = compare("Pending list", { action: "getPending" });
  const pend = (pending.transactions || []);
  assert(pend.length > 0, "the Pending list has " + pend.length + " real unprocessed rows to work with");

  console.log("\n--- 3. Real saves leave identical data ---");
  if(pend.length >= 3){
    const t0 = pend[0];
    compare("save a note on the first Pending row", { action: "saveNote", row: t0.row, note: "parity test lunch", category: t0.suggestedCategory || "Food", counterparty: t0.counterparty, fp: t0.fp, type: "Want" });
    compareTabs("after saveNote", ["Transactions", "SmartMemory", "TypeVotes", "NoteMemory"]);
    const t1 = pend[1];
    compare("save a note with a Saving tag", { action: "saveNote", row: t1.row, note: "saving test", category: "Financial", counterparty: t1.counterparty, fp: t1.fp, type: "Saving" });
    const t2 = pend[2];
    compare("a stale card is refused the same way", { action: "saveNote", row: t2.row, note: "x", category: "Food", counterparty: t2.counterparty, fp: "wrongfingerprint", type: "Need" });
    compare("mark a row as not a transaction", { action: "markNotATransaction", row: t2.row, fp: t2.fp });
    compareTabs("after the pending saves", ["Transactions", "Transactions_Ignored", "SmartMemory", "TypeVotes", "NoteMemory", "FinancialEvents", "Investments", "Debts", "Savings"]);
    compare("the Pending list afterwards", { action: "getPending" });
  }
  compare("add a cash spend", { action: "addCashEntry", type: "debit", amount: 45, note: "parity chai", category: "Food", needWantSaving: "Want" });
  compare("add a debt", { action: "addDebt", person: "Parity Pal", type: "LENT", amount: 750, note: "dinner", dueDate: "" });
  const debts = compare("Debts afterwards", { action: "getDebts" });
  const mine = (debts.debts && debts.debts.debts || []).find(function(d){ return d.person === "Parity Pal"; });
  if(mine){
    compare("record a part-payment", { action: "recordDebtPayment", row: mine.row, amount: 250 });
    compare("settle the debt", { action: "settleDebt", row: mine.row });
  }
  compare("log an investment", { action: "logInvestment", amount: 1500, instrumentName: "HDFC Nifty 50 Index Fund" });
  compare("add a savings goal", { action: "addSavingsGoal", name: "Parity Goal", type: "OneTime", target: 5000 });
  compare("save a Savings split", { action: "saveSavingsAuto", amount: 1000, note: "parity" });
  compareTabs("after all the writes", ALL);
  compare("Home dashboard afterwards", { action: "getDashboard" });
  compare("History afterwards", { action: "getTransactionHistory", offset: 0, limit: 30 });
}

process.exitCode = process.exitCode || 0;
