// functions/tests/live_sweep.js  (NOT part of the automatic suite: it talks to the REAL Firestore, in a made-up person only)
//
// Plain-English what this does: runs EVERY saving action the new server accepts, one by one, in a throwaway test person
// (qa-sweep@example.com, with a made-up "owner" so no real data is touched), and flags the kind of failure that only shows up on the new
// server: "this server has no Google Sheet", "is not defined", "is not a function". It exists because the first real tap of "Not a
// transaction" on the new server hit exactly that. It cleans up after itself.
//
//   FIN_LOCAL_KEY=~/.fin-app/claude-sa-key.json node functions/tests/live_sweep.js

const { createRuntime } = require("../runtime/shim");
const { syncFetch } = require("../runtime/syncfetch");
const { getFirestoreToken } = require("../runtime/tokens");

const SCRATCH = "qa-sweep@example.com";
const LOCK_PATH = "_system/lock_qa_sweep";
const BASE = "https://firestore.googleapis.com/v1/projects/fin-app-76c40/databases/(default)/documents";

const rt = createRuntime({
  localEmail: SCRATCH, ownerEmail: SCRATCH, log: function(){},
  sharedProps: function(){ return { V2DB_OWNER: "on", V2_FN_WRITES: "on" }; }
});
rt.sandbox.LEASE_PATH_ = LOCK_PATH;
const call = function(data){ return rt.call(Object.assign({ idToken: "local" }, data)); };

function api(method, url, body){
  return syncFetch({ url: url, method: method, headers: { Authorization: "Bearer " + getFirestoreToken(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}
function deleteTree(docPath){
  const ids = JSON.parse(api("POST", BASE + "/" + docPath + ":listCollectionIds", {}).text).collectionIds || [];
  ids.forEach(function(cid){
    let token = "";
    do{
      const r = JSON.parse(api("GET", BASE + "/" + docPath + "/" + cid + "?pageSize=100" + (token ? "&pageToken=" + token : "")).text);
      (r.documents || []).forEach(function(d){ deleteTree(String(d.name).split("/documents/")[1]); });
      token = r.nextPageToken || "";
    }while(token);
  });
  api("DELETE", BASE + "/" + docPath);
}
function cleanup(){ try{ deleteTree("users/" + SCRATCH); }catch(e){ console.log("cleanup: " + e.message); } try{ api("DELETE", BASE + "/" + LOCK_PATH); }catch(e){} }

// An answer that points at the NEW SERVER being unable to run the code (as opposed to a normal "no, that input is not valid").
const ENV_PROBLEM = /no Google Sheet|is not defined|is not a function|Cannot read prop|Cannot set prop|undefined \(reading|not available on the new server|Drive|MailApp|UrlFetch/i;
const results = [];
function run(label, data, expectOk){
  let r;
  try{ r = call(data); }catch(e){ r = { ok: false, error: "THROWN: " + e.message }; }
  const text = JSON.stringify(r).slice(0, 160);
  const env = ENV_PROBLEM.test(String(r.error || ""));
  results.push({ label: label, ok: r.ok === true, env: env });
  console.log((env ? "ENV-PROBLEM " : (r.ok === true ? "ok           " : "no (see)     ")) + label + (r.ok === true ? "" : "  -> " + text));
  return r;
}

if(!process.env.FIN_LOCAL_KEY){ console.error("Set FIN_LOCAL_KEY first."); process.exit(2); }
cleanup();
try{
  call({ action: "getMyAccess" });

  // cash + manual transaction + the action that failed on the phone
  run("addCashEntry", { action: "addCashEntry", type: "debit", amount: 20, note: "qa tea", category: "Food" });
  const cash = call({ action: "getCash" });
  const crow = cash.ok && cash.cash.recent && cash.cash.recent[0] && cash.cash.recent[0].row;
  run("updateCashEntry", { action: "updateCashEntry", row: crow, type: "debit", amount: 25, note: "qa tea 2", category: "Food" });
  run("addManualTransaction", { action: "addManualTransaction", type: "debit", amount: 77, counterparty: "QA Junk Shop" });
  const pend = call({ action: "getPending" });
  const item = (pend.transactions || []).find(function(x){ return /QA Junk/.test(x.counterparty || ""); });
  run("markNotATransaction", { action: "markNotATransaction", row: item && item.row, fp: item && item.fp });
  run("addManualTransaction (2nd)", { action: "addManualTransaction", type: "debit", amount: 33, counterparty: "QA Cafe" });
  const pend2 = call({ action: "getPending" });
  const item2 = (pend2.transactions || []).find(function(x){ return /QA Cafe/.test(x.counterparty || ""); });
  run("saveNote", { action: "saveNote", row: item2 && item2.row, note: "qa coffee", category: "Food", counterparty: "QA Cafe", type: "Want", fp: item2 && item2.fp });

  // Reconcile with statement rows read on the phone (no Google Drive on the new server)
  const nowD = new Date(), p2 = function(n){ return String(n).padStart(2, "0"); };
  const dstr = p2(nowD.getDate()) + "/" + p2(nowD.getMonth() + 1) + "/" + String(nowD.getFullYear()).slice(2);
  const stmt = []; while(stmt.length < 22) stmt.push([]);
  stmt.push([dstr, "UPI-QA RECON SHOP-QA@ybl-HDFC0000001-0000999001-testnote", "0000999001", dstr, 61, "", 5000]);
  stmt.push([dstr, "UPI-QA CAFE-QA2@ybl-HDFC0000001-0000999002-tea", "0000999002", dstr, 29, "", 4971]);
  const prev = run("reconcileStatement (rows)", { action: "reconcileStatement", rows: stmt });
  const toAdd = (prev.missing || []).map(function(m){ return { date: m.rawDate, type: m.type, mode: m.mode, amount: m.amount, ref: m.ref, name: m.name, note: m.note, category: "Other", needWantSaving: "" }; });
  run("insertReconciledTransactions", { action: "insertReconciledTransactions", source: "Bank Statement", transactions: toAdd });
  const prev2 = call({ action: "reconcileStatement", rows: stmt });
  results.push({ label: "reconcile twice finds nothing new", ok: prev2.ok === true && (prev2.missing || []).length === 0 && prev2.matched === 2, env: false });
  console.log((prev2.ok === true && (prev2.missing || []).length === 0 ? "ok           " : "no (see)     ") + "reconcile again: nothing missing (matched " + prev2.matched + ")");

  // debts
  run("addDebt", { action: "addDebt", person: "QA Pal", type: "LENT", amount: 100, note: "qa", dueDate: "" });
  const debts = call({ action: "getDebts" });
  const drow = debts.ok && debts.debts && (debts.debts.debts || [])[0];
  const drowNo = drow && drow.row;
  run("recordDebtPayment", { action: "recordDebtPayment", row: drowNo, amount: 10 });
  run("settleDebt", { action: "settleDebt", row: drowNo });

  // savings
  run("addSavingsGoal", { action: "addSavingsGoal", name: "QA Goal", type: "one-time", target: 1000 });
  run("saveSavingsAuto", { action: "saveSavingsAuto", amount: 500, note: "qa" });
  run("withdrawSavings", { action: "withdrawSavings", bucket: "Free", amount: 10, note: "qa" });
  const sg = call({ action: "getSavingsGoals" });
  const goalRow = sg.ok && sg.savings && (sg.savings.goals || []).find(function(g){ return g.name === "QA Goal"; });
  run("setPrioritySavingsGoal", { action: "setPrioritySavingsGoal", row: goalRow && goalRow.row });
  run("markSavingsGoalDone", { action: "markSavingsGoalDone", row: goalRow && goalRow.row });
  run("purchaseSavingsGoal", { action: "purchaseSavingsGoal", row: goalRow && goalRow.row, name: "QA Goal", amount: 50 });
  run("saveSavingsManual", { action: "saveSavingsManual", amount: 100, rows: [{ destination: "Free", amount: 100 }], note: "qa" });
  run("updateSavingsEntry", { action: "updateSavingsEntry", row: 2, amount: 90, note: "qa edit", destination: "Free" });
  run("deleteSavingsEntry", { action: "deleteSavingsEntry", row: 2 });

  // investments
  run("addInvestmentInstrument", { action: "addInvestmentInstrument", name: "QA Fund", category: "One-time Fund" });
  run("logInvestment", { action: "logInvestment", amount: 100, instrumentName: "QA Fund" });
  const inv = call({ action: "getInvestments" });
  const irow = inv.ok && inv.investments && (inv.investments.recent || inv.investments.entries || [])[0];
  run("updateInvestment", { action: "updateInvestment", row: irow && irow.row, instrumentName: "QA Fund", amount: 120 });

  // settings / budgets / push token
  run("updateSettings", { action: "updateSettings", settings: { ccLimit: 55000 } });
  run("saveBudgets", { action: "saveBudgets", month: "2026-10", budgets: [{ category: "Food", type: "Need", target: 1000 }], income: 1000, fixedObligations: 0 });
  run("registerPushToken", { action: "registerPushToken", token: "qa-device-token-0123456789" });
  const rv = (function(){ const cap = []; rt.sandbox.fsSetDocument_ = function(c, i, f){ cap.push(i); return true; }; const r = call({ action: "refreshViews" }); return { r: r, cap: cap }; })();
  results.push({ label: "refreshViews", ok: rv.r.ok === true, env: false });
  console.log((rv.r.ok === true ? "ok           " : "no (see)     ") + "refreshViews (captured, not written)");

  // reads that use the same data, as a sanity check that nothing the saves wrote broke a screen
  ["getPending", "getDashboard", "getTodaySummary", "getMonthlyAnalysis", "getCCAdvisor", "getDebts", "getCash", "getInvestments", "getSavingsGoals", "getTransactionHistory", "getPlannerData", "getSettings"].forEach(function(a){
    run("(read) " + a, { action: a });
  });
}catch(e){
  console.error("SWEEP CRASHED: " + (e && e.stack || e)); process.exitCode = 1;
}finally{
  cleanup();
  const left = JSON.parse(api("POST", BASE + "/users/" + SCRATCH + ":listCollectionIds", {}).text).collectionIds || [];
  console.log(left.length === 0 ? "cleanup done: nothing left behind" : "WARNING: left behind: " + left.join(","));
}
const envProblems = results.filter(function(r){ return r.env; });
console.log("\n" + results.filter(function(r){ return r.ok; }).length + "/" + results.length + " answered ok; actions that cannot run on the new server: " + (envProblems.length ? envProblems.map(function(r){ return r.label; }).join(", ") : "none"));
if(envProblems.length) process.exitCode = 1;
