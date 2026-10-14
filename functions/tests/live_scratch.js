// functions/tests/live_scratch.js  (NOT part of the automatic suite: it talks to the REAL Firestore)
//
// Plain-English what this does: proves, against the real database, that the NEW server's SAVING works and that two servers saving at
// the same moment never lose or double anything. It works ONLY inside a throwaway test person (qa-fnwrites@example.com, who has a
// made-up "owner" so no real data is ever touched), uses its own lock document (_system/lock_qa, NOT the real one), and deletes
// everything it created at the end.
//
// Needs the robot key: set FIN_LOCAL_KEY to the key file path (kept outside the repo). Run:
//   FIN_LOCAL_KEY=~/.fin-app/claude-sa-key.json node functions/tests/live_scratch.js
// Never run on Firebase (the shim refuses the local shortcuts there).

const { spawn } = require("node:child_process");
const path = require("node:path");
const { createRuntime } = require("../runtime/shim");
const { syncFetch } = require("../runtime/syncfetch");
const { getFirestoreToken } = require("../runtime/tokens");

const SCRATCH = "qa-fnwrites@example.com";
const LOCK_PATH = "_system/lock_qa";
const PROJECT = "fin-app-76c40";
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";

function makeRt(){
  const rt = createRuntime({
    localEmail: SCRATCH, ownerEmail: SCRATCH, log: function(){},
    sharedProps: function(){ return { V2DB_OWNER: "on", V2_FN_WRITES: "on" }; }
  });
  rt.sandbox.LEASE_PATH_ = LOCK_PATH;                 // a test-only lock document: never blocks the real app
  return rt;
}
const call = function(rt, data){ return rt.call(Object.assign({ idToken: "local" }, data)); };

// ---- cleanup: delete everything under users/<scratch> and the test lock ----
function api(method, url, body){
  const r = syncFetch({ url: url, method: method, headers: { Authorization: "Bearer " + getFirestoreToken(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r;
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
function cleanup(){ try{ deleteTree("users/" + SCRATCH); }catch(e){ console.log("cleanup (user): " + e.message); } try{ api("DELETE", BASE + "/" + LOCK_PATH); }catch(e){} }

// ---- worker mode: one "server" doing N saves ----
if(process.argv[2] === "worker"){
  const n = Number(process.argv[3]) || 5, tag = process.argv[4] || "w";
  const rt = makeRt();
  const out = [];
  for(let i = 0; i < n; i++){
    const t0 = Date.now();
    const r = call(rt, { action: "addCashEntry", type: "credit", amount: 1, note: "qa " + tag + i, category: "Other" });
    out.push({ ok: r.ok === true, ms: Date.now() - t0, error: r.error || "" });
  }
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
}

let failures = 0;
function assert(cond, msg){ if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; } else console.log("PASS: " + msg); }

(async function main(){
  if(!process.env.FIN_LOCAL_KEY){ console.error("Set FIN_LOCAL_KEY first."); process.exit(2); }
  cleanup();                                         // start from nothing
  try{
    const rt = makeRt();

    console.log("\n--- 1. A normal run of saves, one after another ---");
    const acc = call(rt, { action: "getMyAccess" });
    assert(acc.ok === true, "getMyAccess answers for the test person");
    const c1 = call(rt, { action: "addCashEntry", type: "credit", amount: 100, note: "qa start", category: "Other" });
    assert(c1.ok === true, "addCashEntry (saving) works on the new server's code");
    const g1 = call(rt, { action: "getCash" });
    assert(g1.ok === true && Number(g1.cash.balance) === 100, "reading it back shows the saved entry (balance 100)");
    const m = call(rt, { action: "addManualTransaction", type: "debit", amount: 50, counterparty: "QA Shop" });
    assert(m.ok === true, "addManualTransaction works");
    const p = call(rt, { action: "getPending" });
    const item = p.ok && (p.transactions || []).find(function(x){ return /QA Shop/.test(x.counterparty || ""); });
    if(!item) console.log("getPending answer keys: " + Object.keys(p || {}).join(",") + " | " + JSON.stringify(p).slice(0, 400));
    assert(!!item, "the new transaction appears in Pending");
    if(item){
      const s = call(rt, { action: "saveNote", row: item.row, note: "qa note", category: "Other", counterparty: item.counterparty, fp: item.fp });
      assert(s.ok === true, "saveNote works");
      const p2 = call(rt, { action: "getPending" });
      assert(!(p2.transactions || []).some(function(x){ return /QA Shop/.test(x.counterparty || ""); }), "and it leaves Pending");
    }
    // refreshViews rebuilds the Home copy: capture it instead of writing (the real one belongs to the real owner)
    const captured = [];
    rt.sandbox.fsSetDocument_ = function(col, id, fields){ captured.push({ col: col, id: id, fields: fields }); return true; };
    const rv = call(rt, { action: "refreshViews" });
    assert(rv.ok === true && rv.published === true && rv.builtAt > 0, "refreshViews builds the Home copy on the new server");
    assert(captured.length === 1 && captured[0].col === "views" && captured[0].id === "dashboard" && /"balance":100/.test(captured[0].fields.json.replace(/\s/g, "")), "the copy holds the test person's data (captured, not written)");
    const lock1 = JSON.parse(api("GET", BASE + "/" + LOCK_PATH).text).fields || {};
    assert(lock1.holder && lock1.holder.stringValue === "" , "the lock was given back after the saves");

    console.log("\n--- 2. Two servers saving at the same moment (6 saves each) ---");
    const run = function(tag){
      return new Promise(function(resolve){
        const p = spawn(process.execPath, [__filename, "worker", "6", tag], { env: process.env });
        let text = ""; p.stdout.on("data", function(d){ text += d; }); p.stderr.on("data", function(d){ text += d; });
        p.on("close", function(){ resolve(text); });
      });
    };
    const started = Date.now();
    const [t1, t2] = await Promise.all([run("A"), run("B")]);
    console.log("both finished in " + Math.round((Date.now() - started) / 100) / 10 + " s");
    const parse = function(t){ const m2 = /RESULT (.*)/.exec(t); return m2 ? JSON.parse(m2[1]) : null; };
    const r1 = parse(t1), r2 = parse(t2);
    assert(!!r1 && !!r2, "both servers finished their saves");
    const all = (r1 || []).concat(r2 || []);
    console.log("each save took (ms): " + all.map(function(x){ return x.ms; }).join(" "));
    if(all.some(function(x){ return !x.ok; })) console.log("failed saves: " + JSON.stringify(all.filter(function(x){ return !x.ok; })));
    assert(all.length === 12 && all.every(function(x){ return x.ok; }), "all 12 saves reported success (none refused, none lost to a clash)");
    const g2 = call(rt, { action: "getCash" });
    assert(Number(g2.cash.balance) === 112, "the balance is exactly 100 + 12 (no save lost, none saved twice): " + g2.cash.balance);
    const lock2 = JSON.parse(api("GET", BASE + "/" + LOCK_PATH).text).fields || {};
    assert(lock2.holder && lock2.holder.stringValue === "", "the lock is free again at the end");
  }catch(e){
    console.error("TEST CRASHED: " + (e && e.stack || e)); failures++; process.exitCode = 1;
  }finally{
    cleanup();
    const left = JSON.parse(api("POST", BASE + "/users/" + SCRATCH + ":listCollectionIds", {}).text).collectionIds || [];
    console.log(left.length === 0 ? "cleanup done: nothing left behind" : "WARNING: left behind: " + left.join(","));
  }
  console.log(failures === 0 ? "\nLIVE SCRATCH TEST OK" : "\n" + failures + " FAILED");
})();
