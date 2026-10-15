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

const LOGS = [];
const SCRATCH = "qa-fnwrites@example.com";
const LOCK_PATH = "_system/lock_qa";
const PROJECT = "fin-app-76c40";
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";

function makeRt(){
  const rt = createRuntime({
    localEmail: SCRATCH, ownerEmail: SCRATCH, log: function(l){ LOGS.push(String(l)); },
    sharedProps: function(){ return { V2DB_OWNER: "on", V2_FN_WRITES: "on", V2DB_OWNER_DIRECT: "on", V2_FN_SMS: "on", V2_FN_TIMER: "on" }; }
  });
  rt.sandbox.LEASE_PATH_ = LOCK_PATH;
  rt.sandbox.TIMER_DOC_ = "_system/timer_qa";             // the test must never touch the REAL timer document (its heartbeat tells Apps Script the new server is alive)                 // a test-only lock document: never blocks the real app
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
const KEYHASH_FILE = require("node:path").join(require("node:os").tmpdir(), "fnwrites_scratch_keyhash.txt");
function cleanup(){
  try{ const fsx = require("node:fs"); if(fsx.existsSync(KEYHASH_FILE)){ api("DELETE", BASE + "/ingestKeys/" + fsx.readFileSync(KEYHASH_FILE, "utf8").trim()); fsx.unlinkSync(KEYHASH_FILE); } }catch(e){ console.log("cleanup (key): " + e.message); }
  try{ deleteTree("users/" + SCRATCH); }catch(e){ console.log("cleanup (user): " + e.message); } try{ api("DELETE", BASE + "/" + LOCK_PATH); }catch(e){} try{ api("DELETE", BASE + "/_system/timer_qa"); }catch(e){} }

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

if(process.argv[2] === "smsworker"){
  const rt = makeRt(), key = process.env.QA_KEY, sms = process.argv[3];
  const out = [];
  for(let i = 0; i < 3; i++) out.push(call(rt, { action: "smsIn", key: key, sms: sms, sender: "HDFCBK", timestamp: Math.floor(Date.now() / 1000) }));
  console.log("RESULT " + JSON.stringify(out.map(function(r){ return r.ok ? r.outcome : "ERR:" + r.error; })));
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
    console.log("\n--- 1b. The SMS door: a bank SMS lands in the test person's private space ---");
    const key = rt.sandbox.ingestGetOrCreateKey_(SCRATCH);
    require("node:fs").writeFileSync(KEYHASH_FILE, rt.sandbox.ingestHash_(key));
    process.env.QA_KEY = key;
    const sms1 = "Sent Rs.250.00 From HDFC Bank A/C x1234 To QA Pizza On 14/10/26 Ref 710000000001 Not You? Call 18002586161";
    const ts = Math.floor(Date.now() / 1000);
    const s1 = call(rt, { action: "smsIn", key: key, sms: sms1, sender: "HDFCBK", timestamp: ts });
    assert(s1.ok === true && s1.outcome === "SAVED", "a real-looking debit SMS is SAVED: " + JSON.stringify(s1));
    // (for the owner a new SMS row stays "not yet alerted" on purpose: the timer sends the notification, then it shows in Pending - so read the rows)
    const rowsOf = function(){ return rt.sandbox.v2dbRun_(SCRATCH, function(db){ return db.getSheetByName("Transactions").getDataRange().getValues(); }, { prefetch: ["Transactions"] }); };
    const pizza = rowsOf().filter(function(r){ return /QA Pizza/i.test(String(r[7])); });
    assert(pizza.length === 1 && Number(pizza[0][5]) === 250 && pizza[0][3] === "debit" && pizza[0][2] === "HDFC", "and the row is in the private Transactions tab with the right amount, type and bank");
    const s2 = call(rt, { action: "smsIn", key: key, sms: sms1, sender: "HDFCBK", timestamp: ts });
    assert(s2.ok === true && s2.outcome === "DUPLICATE", "the same message again is a DUPLICATE (not saved twice)");
    const s3 = call(rt, { action: "smsIn", key: key, sms: "Get a Loan on your HDFC Bank Credit Card at ZERO fee https://1.hdfc.bank.in/x", sender: "HDFCBK", timestamp: ts });
    assert(s3.ok === true && s3.outcome === "IGNORED", "a promo with a link is IGNORED");
    const bad = call(rt, { action: "smsIn", key: "z".repeat(40), sms: sms1, sender: "HDFCBK", timestamp: ts });
    assert(bad.ok === false && /Unknown key/.test(bad.error), "a wrong key is refused");
    let throttled = false;
    for(let i = 0; i < 8; i++){ const b = call(rt, { action: "smsIn", key: "y".repeat(40 + i), sms: sms1, sender: "HDFCBK", timestamp: ts }); if(/Too many/.test(b.error || "")) throttled = true; }
    assert(throttled, "a burst of wrong keys is throttled (6 a minute on the new server)");
    // two servers get the SAME new message at the same moment (a phone retry racing a slow first try)
    const sms2 = "Sent Rs.333.00 From HDFC Bank A/C x1234 To QA Burger On 14/10/26 Ref 710000000002 Not You? Call 18002586161";
    const runSms = function(){
      return new Promise(function(resolve){
        const p = spawn(process.execPath, [__filename, "smsworker", sms2], { env: process.env });
        let text = ""; p.stdout.on("data", function(d){ text += d; }); p.stderr.on("data", function(d){ text += d; });
        p.on("close", function(){ resolve(text); });
      });
    };
    const [x1, x2] = await Promise.all([runSms(), runSms()]);
    const outs = [x1, x2].map(function(t){ const m3 = /RESULT (.*)/.exec(t); return m3 ? JSON.parse(m3[1]) : ["no result: " + t.slice(0, 200)]; });
    console.log("two servers x 3 sends of one message -> " + JSON.stringify(outs));
    const flat = outs[0].concat(outs[1]);
    assert(flat.filter(function(o){ return o === "SAVED"; }).length === 1 && flat.filter(function(o){ return o === "DUPLICATE"; }).length === 5, "exactly ONE saved, the other five are duplicates");
    assert(rowsOf().filter(function(r){ return /QA Burger/i.test(String(r[7])); }).length === 1, "and the Transactions tab holds that message exactly once");

    console.log("\n--- 1c. The alert timer (tick) on the real database ---");
    const usage = function(){ return rt.sandbox.FS_USAGE_ ? rt.sandbox.FS_USAGE_.reads : 0; };
    rt.sandbox.sendPushNotification = function(t, b){ pushedTitles.push(t); return { sent: true, code: 200, detail: "fake" }; };
    const pushedTitles = [];
    rt.sandbox.timerIstClock_ = function(){ return { date: "2026-10-15", minutes: 180 }; };           // 03:00 India time: no daily job due during the alert checks
    const settle = Date.now() + 6000; while(Date.now() < settle){}        // marks newer than the 5 s clock margin would make the next tick look again (harmless, but this test wants a clean quiet tick)
    const tk1 = rt.runTimer();
    assert(tk1.ran === true, "the first tick runs (never looked yet): " + JSON.stringify(tk1));
    assert(pushedTitles.filter(function(x){ return /New Transaction/.test(x); }).length >= 1, "it alerted the waiting SMS rows (" + pushedTitles.length + " notification(s))");
    const stillWaiting = rowsOf().filter(function(r){ return String(r[15]) === ""; }).length;
    assert(stillWaiting === 0, "no row is left waiting for its alert");
    const before = usage(), pushesBefore = pushedTitles.length;
    const tk2 = rt.runTimer();
    const quietReads = usage() - before;
    assert(tk2.ran === false && pushedTitles.length === pushesBefore, "the next tick is quiet: it does nothing");
    assert(quietReads <= 2, "a quiet tick costs " + quietReads + " Firestore read(s) (budget: 2)");
    rt.sandbox.CacheService.getScriptCache().remove("ING_BAD");        // the wrong-key test above filled the throttle for a minute
    const sms3 = "Sent Rs.444.00 From HDFC Bank A/C x1234 To QA Noodles On 14/10/26 Ref 710000000003 Not You? Call 18002586161";
    const s5 = call(rt, { action: "smsIn", key: key, sms: sms3, sender: "HDFCBK", timestamp: Math.floor(Date.now() / 1000) });
    assert(s5.ok === true && s5.outcome === "SAVED", "a new SMS arrives (and marks 'something changed')");
    const until = Date.now() + 5; while(Date.now() < until){}
    const tk3 = rt.runTimer();
    assert(tk3.ran === true && pushedTitles.length === pushesBefore + 1, "the next tick alerts it exactly once");
    rt.runTimer();                                                          // (a mark made just before a run may be looked at once more: harmless)
    const settle2 = Date.now() + 6000; while(Date.now() < settle2){}
    rt.runTimer();
    assert(rt.runTimer().ran === false && pushedTitles.length === pushesBefore + 1, "and goes quiet again, with no repeat announcement");

    console.log("\n--- 1d. The four daily jobs on the real database (real code, no stand-ins) ---");
    LOGS.length = 0;
    rt.sandbox.timerIstClock_ = function(){ return { date: "2026-10-15", minutes: 21 * 60 }; };      // pretend it is 21:00 India time, nothing run yet today
    const pushesBeforeDaily = pushedTitles.length;
    const dj = rt.runTimer();
    assert(dj.daily && dj.daily.length === 4, "all four daily jobs ran: " + JSON.stringify(dj));
    const badLogs = LOGS.filter(function(l){ return /DAILY_JOB_FAILED|_ERROR|THROWN/.test(l); });
    assert(badLogs.length === 0, "with no errors logged" + (badLogs.length ? ": " + badLogs.join(" | ").slice(0, 400) : ""));
    assert(pushedTitles.slice(pushesBeforeDaily).some(function(x){ return /Evening Check-in/.test(x); }), "the evening cash check-in produced its notification");
    const again = rt.runTimer();
    assert(!again.daily || again.daily.length === 0, "a second tick the same day runs none of them again");

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
