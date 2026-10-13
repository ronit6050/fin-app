// backend/tests/v2route.test.js
//
// Plain-English what this checks: the switchboard (v2route.js) that decides whether a person's request runs on the Google Sheet or on
// their own private Firestore-backed spreadsheet. By default NOBODY is switched on and nothing changes. When a person is switched on:
// their data lives only in their own folder, a brand-new person starts empty (never with anyone else's data), a friend can use only the
// allowed actions, saves are all-or-nothing, locked, and retried once on a clash. All data here is invented.
// Run with: node backend/tests/v2route.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const OWNER = "ronitnadar9@gmail.com";
const FRIEND = "vaidehi@example.com";
const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "investmentInstruments.js", "savingsGoals.js",
  "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "obligationReminders.js", "appHealth.js", "firestore.js", "viewPublisher.js",
  "splits.js", "planner.js", "CCAdvisor.js", "DebtAdvisor.js", "SavingsAdvisor.js", "cash.js", "v2db.js", "settings.js", "v2route.js"
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

function ownerSheets(w){
  const today = new w.D();
  today.setHours(10, 0, 0, 0);
  const row = function(amt, ref, cp, note, proc){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, ref, cp, "SMS", "Tasker", "raw", "HDFCBK", note || "", note ? "Food" : "", "", proc || "YES", "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, row(120, 111111, "Cafe A", "tea"), row(80, 222222, "Shop B", "")]);
  ["Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [vm.runInContext("[]", w.sb).concat(["h"])]); });
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.addSheet("Debts", [["Date", "Person", "Type", "Amount", "Note", "DueDate", "Status", "SettledDate"]]);
  w.addSheet("InvestmentInstruments", [["Name", "Category", "SipAmount"], ["Owner Fund", "SIP", 1000]]);
}

console.log("\n--- 1. By default nobody is switched on, and nothing changes ---");
{
  const w = build(); ownerSheets(w); const sb = w.sb;
  assert(sb.v2EngineFor_(OWNER) === "sheet" && sb.v2EngineFor_(FRIEND) === "sheet" && sb.v2EngineFor_("") === "sheet", "everyone is on the Sheet by default");
  const before = w.commits;
  const r = w.act("owner", { action: "addCashEntry", type: "debit", amount: 30, note: "chai", category: "Food", needWantSaving: "Want" });
  assert(r.ok === true && w.sheets.Cash.rows.length === 3, "the owner's save goes to the real Sheet as always");
  assert(w.commits === before && Object.keys(w.store).every(function(p){ return p.indexOf("/sheets/") === -1; }), "nothing was written to any virtual spreadsheet");
  const f = w.act("friend", { action: "getCash" });
  assert(f.ok === false && /not allowed/i.test(f.error), "a friend not switched on still cannot use the tracker (Splits only)");
  assert(w.act("friend", { action: "getPeople" }).ok === true, "...but Splits still works for them");
}

console.log("\n--- 2. Switching the owner on routes his requests to his virtual spreadsheet only ---");
{
  const w = build(); ownerSheets(w); const sb = w.sb;
  ["Transactions", "Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){
    if(w.sheets[t]) sb.v2dbImportTab_(OWNER, t, w.sheets[t].getDataRange().getValues());
  });
  const sheetCashBefore = JSON.stringify(w.sheets.Cash.rows);
  const answerSheet = w.act("owner", { action: "getCash" });
  w.props.V2DB_OWNER = "on";
  assert(sb.v2EngineFor_(OWNER) === "v2db", "the owner flag switches him on");
  const answerVirtual = w.act("owner", { action: "getCash" });
  assert(JSON.stringify(answerSheet) === JSON.stringify(answerVirtual), "his Cash screen gives the identical answer from the virtual spreadsheet");
  const r = w.act("owner", { action: "addCashEntry", type: "debit", amount: 45, note: "parity chai", category: "Food", needWantSaving: "Want" });
  assert(r.ok === true, "a save works");
  assert(JSON.stringify(w.sheets.Cash.rows) === sheetCashBefore, "the real Sheet was NOT touched");
  assert(w.virtualTab(OWNER, "Cash").length === 3, "the save landed in his private Firestore folder");
  assert(w.lockEvents.join(",") === "wait,release", "a saving request takes the lock and always lets it go");
  w.lockEvents.length = 0;
  w.act("owner", { action: "getCash" });
  assert(w.lockEvents.length === 0, "a read does not take the lock");
  const balanceWithSave = w.act("owner", { action: "getCash" }).cash.balance;
  delete w.props.V2DB_OWNER;
  const balanceOnSheet = w.act("owner", { action: "getCash" }).cash.balance;
  assert(balanceOnSheet === answerSheet.cash.balance && balanceOnSheet !== balanceWithSave, "switching back to the Sheet is instant: it shows the Sheet's own data (without the virtual save)");
}

console.log("\n--- 3. A brand-new friend gets the full app on empty, private tabs ---");
{
  const w = build(); ownerSheets(w); const sb = w.sb;
  ["Transactions", "Cash", "Debts", "InvestmentInstruments"].forEach(function(t){ sb.v2dbImportTab_(OWNER, t, w.sheets[t].getDataRange().getValues()); });
  sb.v2dbEnableUser(FRIEND);
  assert(sb.v2EngineFor_(FRIEND) === "v2db" && sb.v2EngineFor_(OWNER) === "sheet", "only the chosen friend is switched on");
  const ownerFolderBefore = JSON.stringify(w.userFolderPaths(OWNER).map(function(p){ return w.store[p]; }));
  const reads = ["getDashboard", "getPending", "getTodaySummary", "getCCAdvisor", "getDebts", "getCash", "getInvestments", "getInvestmentInstruments", "getSavingsGoals", "getSettings", "ping", "getPeople"];
  reads.forEach(function(a){ const r = w.act("friend", { action: a }); assert(r.ok !== false, "new friend: " + a + " works on empty tabs" + (r.ok === false ? " (" + String(r.error).slice(0, 80) + ")" : "")); });
  const now = new Date();
  assert(w.act("friend", { action: "getMonthlyAnalysis", year: now.getFullYear(), month: now.getMonth() + 1 }).ok !== false, "new friend: Analysis works");
  assert(w.act("friend", { action: "getTransactionHistory", offset: 0, limit: 20 }).ok !== false, "new friend: History works");
  assert(w.act("friend", { action: "getPlannerData", month: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") }).ok !== false, "new friend: Planner works");
  const tabs = w.userFolderPaths(FRIEND).filter(function(p){ return /\/pages\/0000$/.test(p); }).length;
  assert(tabs >= 12, "the friend's template tabs were created (" + tabs + " tabs)");
  const inst = w.act("friend", { action: "getInvestmentInstruments" });
  assert(JSON.stringify(inst).indexOf("Owner Fund") === -1 && JSON.stringify(inst).indexOf("HDFC") === -1, "the friend's investment list is EMPTY: never the owner's funds");
  assert(JSON.stringify(w.act("friend", { action: "getDebts" })).indexOf("Owner") === -1 && w.act("friend", { action: "getCash" }).cash.balance === 0, "the friend sees none of the owner's cash or debts");

  const c = w.act("friend", { action: "addCashEntry", type: "debit", amount: 60, note: "lunch", category: "Food", needWantSaving: "Need" });
  assert(c.ok === true && w.act("friend", { action: "getCash" }).cash.balance === -60, "she can add cash and sees her own balance");
  const dbt = w.act("friend", { action: "addDebt", person: "Raj", type: "LENT", amount: 200, note: "x", dueDate: "" });
  assert(dbt.ok === true && w.act("friend", { action: "getDebts" }).debts.totalTheyOwe === 200, "she can track her own debts");
  assert(w.act("friend", { action: "addInvestmentInstrument", name: "My Fund", category: "SIP" }).ok === true, "she can add her own investment");
  assert(w.act("friend", { action: "logInvestment", amount: 500, instrumentName: "My Fund" }).ok === true, "...and log into it");
  assert(w.act("friend", { action: "addSavingsGoal", name: "Phone", type: "OneTime", target: 20000 }).ok === true, "...a savings goal");
  assert(w.act("friend", { action: "saveSavingsAuto", amount: 300, note: "x" }).ok !== undefined, "...and a savings split");
  assert(w.act("friend", { action: "updateSettings", settings: { ccLimit: 25000 } }).ok === true && w.act("friend", { action: "getSettings" }).settings.ccLimit === 25000, "her own settings are saved");
  assert(w.act("owner", { action: "getSettings" }).settings.ccLimit === 50000, "...and do not change the owner's");

  // a transaction arrives for her (as an SMS would) and she works through Pending
  sb.v2dbRun_(FRIEND, function(db){
    db.getSheetByName("Transactions").appendRow([new w.D(), new w.D(1899, 11, 30, 12, 0, 0), "SBI", "debit", "upi", 99, "777888", "Cafe Z", "SMS", "App", "raw", "SBIINB", "", "", "", "YES", "", "", "", "", ""]);
  });
  const pend = w.act("friend", { action: "getPending" });
  assert(pend.transactions.length === 1 && pend.transactions[0].counterparty === "Cafe Z", "her new transaction appears in HER Pending");
  assert(w.act("owner", { action: "getPending" }).transactions.length === 1 && w.act("owner", { action: "getPending" }).transactions[0].counterparty === "Shop B", "the owner's Pending shows only his own");
  const t = pend.transactions[0];
  const s = w.act("friend", { action: "saveNote", row: t.row, note: "coffee", category: "Food", counterparty: t.counterparty, fp: t.fp, type: "Want" });
  assert(s.ok === true && w.act("friend", { action: "getPending" }).transactions.length === 0, "she saves a note and it leaves her Pending");
  assert(w.virtualTab(FRIEND, "SmartMemory").some(function(r){ return String(r[0]).indexOf("Cafe Z") !== -1; }), "what the app learned (merchant to category) is stored in HER folder");
  assert(!JSON.stringify(w.virtualTab(OWNER, "SmartMemory")).includes("Cafe Z"), "...and never in the owner's");

  assert(JSON.stringify(w.userFolderPaths(OWNER).map(function(p){ return w.store[p]; })) === ownerFolderBefore, "the owner's folder is byte-for-byte unchanged by everything she did");
  assert(w.userFolderPaths(FRIEND).every(function(p){ return p.indexOf("users/" + FRIEND + "/") === 0; }) && Object.keys(w.store).every(function(p){ return p.indexOf("users/" + OWNER + "/") === 0 || p.indexOf("users/" + FRIEND + "/") === 0; }), "every document is under the owner's or her own folder");
  assert(JSON.stringify(w.sheets.Cash.rows).indexOf("lunch") === -1 && w.sheets.Debts.rows.length === 1, "the real Sheet never saw any of it");
}

console.log("\n--- 4. Who may do what ---");
{
  const w = build(); ownerSheets(w); const sb = w.sb;
  sb.v2dbEnableUser(FRIEND);
  ["refreshViews", "moveDebtToFriend", "reconcileStatement", "reconcileCreditCardStatement", "insertReconciledTransactions", "fixCreditCardTransactionMode", "nonsense"].forEach(function(a){
    const r = w.act("friend", { action: a });
    assert(r.ok === false && /not allowed/i.test(r.error), "a switched-on friend still cannot use " + a);
  });
  const w2 = build(); ownerSheets(w2); w2.sb.v2dbEnableUser(FRIEND);
  delete w2.store["users/" + OWNER + "/friends/" + FRIEND];
  const r2 = w2.act("friend", { action: "getCash" });
  assert(r2.ok === false && /not allowed/i.test(r2.error), "switched on but NOT in the owner's friend list: refused (both gates must pass)");
  const r3 = w2.act("stranger", { action: "getCash" });
  assert(r3.ok === false, "a stranger is refused");
  assert(w.act("friend", { action: "registerPushToken", token: "abc-token" }).ok === true && w.props.PWA_PUSH_TOKEN === undefined, "her push device is saved per person, never over the owner's global one");
  assert(sb.v2dbDisableUser(FRIEND).length === 0 && sb.v2EngineFor_(FRIEND) === "sheet", "switching her off is instant");
  assert(w.act("friend", { action: "getCash" }).ok === false, "...and the full app is closed to her again");
}

console.log("\n--- 5. Saves are all-or-nothing, retried once on a clash, and honest about outages ---");
{
  const w = build(); ownerSheets(w); const sb = w.sb;
  sb.v2dbEnableUser(FRIEND);
  w.act("friend", { action: "getCash" });                                // create her tabs
  const base = JSON.stringify(w.virtualTab(FRIEND, "Cash"));

  const clash = new Error("the stored version does not match the required base version"); clash.httpCode = 400;
  w.failCommits = [clash];                                              // the first save is refused as a clash; the retry must succeed
  const r = w.act("friend", { action: "addCashEntry", type: "debit", amount: 10, note: "retry me", category: "Food", needWantSaving: "Want" });
  assert(r.ok === true && w.virtualTab(FRIEND, "Cash").filter(function(x){ return x[5] === "retry me"; }).length === 1, "a clash on saving is retried once and saved exactly once (no duplicate)");

  const down = new Error("Firestore is down"); down.httpCode = 503;
  w.failCommits = [down];
  const before = JSON.stringify(w.virtualTab(FRIEND, "Cash"));
  const o = w.act("friend", { action: "addCashEntry", type: "debit", amount: 20, note: "should not stay", category: "Food", needWantSaving: "Want" });
  assert(o.ok === false && /nothing was saved/i.test(o.error) && o.error.indexOf("503") === -1 && o.error.indexOf("Firestore is down") === -1, "an outage gives a plain 'nothing was saved' message with no technical detail");
  assert(JSON.stringify(w.virtualTab(FRIEND, "Cash")) === before, "and nothing was changed");
  assert(w.errors("V2DB_REQUEST_ERROR").length === 1, "the problem is written to the log for you to find");
  assert(w.lockEvents[w.lockEvents.length - 1] === "release" && w.lockEvents.filter(function(e){ return e === "wait"; }).length === w.lockEvents.filter(function(e){ return e === "release"; }).length, "the lock is always released, even after a failure");

  const twice = new Error("the stored version does not match the required base version"); twice.httpCode = 400;
  w.failCommits = [twice, twice];
  const t = w.act("friend", { action: "addCashEntry", type: "debit", amount: 5, note: "two clashes", category: "Food", needWantSaving: "Want" });
  assert(t.ok === false && /same moment/i.test(t.error) && JSON.stringify(w.virtualTab(FRIEND, "Cash")) === before, "two clashes in a row give a friendly 'try again', still saving nothing");

  // an {ok:false} answer saves nothing: a stale card
  sb.v2dbRun_(FRIEND, function(db){ db.getSheetByName("Transactions").appendRow([new w.D(), new w.D(1899, 11, 30, 12, 0, 0), "SBI", "debit", "upi", 50, "999000", "Shop Q", "SMS", "App", "raw", "SBIINB", "", "", "", "YES", "", "", "", "", ""]); });
  const p = w.act("friend", { action: "getPending" }).transactions[0];
  const txBefore = JSON.stringify(w.virtualTab(FRIEND, "Transactions"));
  const stale = w.act("friend", { action: "saveNote", row: p.row, note: "n", category: "Food", counterparty: p.counterparty, fp: "not-the-fingerprint", type: "Want" });
  assert(stale.ok === false && stale.stale === true && JSON.stringify(w.virtualTab(FRIEND, "Transactions")) === txBefore, "a stale card is refused and changes nothing, exactly like on the Sheet");
}

console.log("\n--- 6. Speed: only the tabs an action needs are fetched, together ---");
{
  const w = build(); ownerSheets(w); const sb = w.sb;
  sb.v2dbEnableUser(FRIEND);
  w.act("friend", { action: "getCash" });
  let batches = 0, singles = 0;
  const bg = sb.fsBatchGetPaths_, sg = sb.fsGetPathMeta_;
  sb.fsBatchGetPaths_ = function(p){ batches++; return bg(p); };
  sb.fsGetPathMeta_ = function(p){ singles++; return sg(p); };
  w.act("friend", { action: "getCash" });
  assert(batches === 1 && singles <= 2, "a Cash screen is one batched read (plus the friend check), not one request per tab (" + batches + " batch, " + singles + " single)");
  batches = 0; singles = 0;
  w.act("friend", { action: "getDashboard" });
  assert(batches >= 1 && batches <= 2, "the whole Home dashboard is fetched in " + batches + " batch request(s)");
}

process.exitCode = process.exitCode || 0;
