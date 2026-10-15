// Shared setup for v2owner.test.js (copied from v2route.test.js's build()). Not a test itself.
const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const OWNER = "ronitnadar9@gmail.com";
const FRIEND = "vaidehi@example.com";
const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "investmentInstruments.js", "savingsGoals.js",
  "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "obligationReminders.js", "appHealth.js", "firestore.js", "viewPublisher.js",
  "splits.js", "planner.js", "CCAdvisor.js", "DebtAdvisor.js", "SavingsAdvisor.js", "cash.js", "v2db.js", "settings.js", "v2route.js", "flags.js", "sharedLock.js", "fnTimer.js", "Credit Card.js", "v2owner.js", "admin.js", "ingest.js", "manualTxn.js", "smsFormats.js", "splitNotify.js", "push.js", "smsPipelineCore.js", "smsIn.js"
];
const TXN_HEADER = ["Date", "Time", "Bank", "Type", "Mode", "Amount", "Reference", "Counterparty", "Channel", "Source", "RawSMS", "Sender", "Note", "Category", "TelegramMsgID", "Processed", "NeedWantSaving", "FinancialEvent", "FinancialEventName", "AutoSettled", "FriendShare"];

function build(){
  const w = makeWorld(FILES);
  const sb = w.sb;
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  w.props.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "r@t.iam", private_key: "k", project_id: "p" });
  sb.verifyGoogleIdToken = function(t){ return t === "owner" ? { email: OWNER, name: "Ronit" } : t === "friend" ? { email: FRIEND, name: "Vaidehi" } : t === "stranger" ? { email: "x@y.com", name: "X" } : null; };
  sb.publishAfterAction_ = function(){};
  sb.ContentService = { createTextOutput: function(t){ return { getContent: function(){ return t; }, setMimeType: function(){ return this; } }; }, MimeType: { JSON: "json" } };
  sb.CacheService = { getScriptCache: function(){ return { get: function(){ return null; }, put: function(){}, remove: function(){} }; } };
  w.lockEvents = [];
  sb.LockService = { getScriptLock: function(){ return { tryLock: function(){ return true; }, waitLock: function(){ w.lockEvents.push("wait"); }, releaseLock: function(){ w.lockEvents.push("release"); } }; } };
  sb.UrlFetchApp = { fetch: function(){ throw new Error("no network in tests"); } };
  sb.sendPushNotification = function(){}; sb.sendMessage = function(){};
  const D = vm.runInContext("Date", sb);
  w.D = D;
  // fake Firestore
  w.store = {}; w.clock = 0; w.commits = 0; w.failCommits = [];
  const clone = function(o){ return JSON.parse(JSON.stringify(o)); };
  sb.fsGetPathMeta_ = function(p){ const d = w.store[p]; return d ? { fields: clone(d.fields), updateTime: d.updateTime } : null; };
  sb.fsBatchGetPaths_ = function(paths){ const out = {}; paths.forEach(function(p){ const d = w.store[p]; out[p] = d ? { fields: clone(d.fields), updateTime: d.updateTime } : null; }); return out; };
  sb.fsListPath_ = function(c){ return Object.keys(w.store).filter(function(p){ return p.indexOf(c + "/") === 0 && p.slice(c.length + 1).indexOf("/") === -1; }).map(function(p){ return { id: p.split("/").pop(), fields: clone(w.store[p].fields), updateTime: w.store[p].updateTime }; }); };
  sb.fsCommit_ = function(ops){
    if(w.failCommits.length){ const e = w.failCommits.shift(); if(e) throw e; }
    ops.forEach(function(op){ if(op.set){ const cur = w.store[op.set.path];
      if(op.set.onlyIfNew && cur){ const e = new Error("exists"); e.httpCode = 409; throw e; }
      if(op.set.onlyIfUpdateTime && (!cur || cur.updateTime !== op.set.onlyIfUpdateTime)){ const e = new Error("the stored version does not match the required base version"); e.httpCode = 400; throw e; } } });
    w.commits++;
    return ops.map(function(op){
      if(op.set){ w.store[op.set.path] = { fields: clone(op.set.fields), updateTime: "t" + String(++w.clock).padStart(8, "0") }; return { updateTime: w.store[op.set.path].updateTime }; }
      if(op.del){ delete w.store[op.del.path]; return {}; }
      if(op.merge){ const cur = w.store[op.merge.path] || { fields: {} }; const f = clone(cur.fields); Object.keys(op.merge.fields || {}).forEach(function(k){ f[k] = op.merge.fields[k]; });
        (op.merge.adds || []).forEach(function(a){ f[a.field] = (Number(f[a.field]) || 0) + a.amountInt; }); w.store[op.merge.path] = { fields: f, updateTime: "t" + String(++w.clock).padStart(8, "0") }; return {}; }
      return {};
    });
  };
  sb.fsFlushUsage_ = function(){};
  w.act = function(token, payload){ return JSON.parse(sb.handlePwaRequest(Object.assign({ idToken: token }, payload)).getContent()); };
  w.errors = function(type){ return w.sheets.AILogs.rows.slice(1).filter(function(r){ return r[1] === type; }); };
  // the owner's friends list (so the friend may sign in) and the real Sheet's contents
  w.store["users/" + OWNER + "/friends/" + FRIEND] = { fields: { name: "Vaidehi", email: FRIEND, mirror: false, balancePaise: 0 }, updateTime: "t0" };
  w.virtualTab = function(user, name){ const sh = new sb.V2Db_(user).getSheetByName(name); return sh ? sh.getDataRange().getValues() : null; };
  w.userFolderPaths = function(user){ return Object.keys(w.store).filter(function(p){ return p.indexOf("users/" + user + "/sheets/") === 0; }); };
  return w;
}
module.exports = { build, OWNER, FRIEND, TXN_HEADER, vm };
