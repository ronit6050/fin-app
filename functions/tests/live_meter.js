// functions/tests/live_meter.js  (NOT part of the automatic suite: it talks to the REAL Firestore)
//
// Plain-English what this does: proves on the real database that the shared usage counter works: counts from several servers adding at the same
// moment give the EXACT total (none lost, none doubled), the daily safety limit trips on the shared total, and reading the total costs one read.
// It uses its own test counter document (_system/usage_qa), NEVER today's real one, and deletes it at the end.
//
//   FIN_LOCAL_KEY=~/.fin-app/claude-sa-key.json node functions/tests/live_meter.js

const { spawn } = require("node:child_process");
const vm = require("node:vm");
const { createRuntime } = require("../runtime/shim");
const { syncFetch } = require("../runtime/syncfetch");
const { getFirestoreToken } = require("../runtime/tokens");

const QA_PATH = "_system/usage_qa";
const BASE = "https://firestore.googleapis.com/v1/projects/fin-app-76c40/databases/(default)/documents";

function api(method, url, body){
  return syncFetch({ url: url, method: method, headers: { Authorization: "Bearer " + getFirestoreToken(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}
function readQa(){
  const r = api("GET", BASE + "/" + QA_PATH);
  if(r.status === 404) return { reads: 0, writes: 0, calls: 0 };
  const f = JSON.parse(r.text).fields || {};
  const num = function(k){ return f[k] ? Number(f[k].integerValue) : 0; };
  return { reads: num("reads"), writes: num("writes"), calls: num("calls") };
}
function deleteQa(){ try{ api("DELETE", BASE + "/" + QA_PATH); }catch(e){} }
function makeRt(){
  const rt = createRuntime({ localEmail: "qa-meter@example.com", ownerEmail: "qa-meter@example.com", log: function(){}, sharedProps: function(){ return {}; } });
  vm.runInContext('fsUsagePath_ = function(){ return "' + QA_PATH + '"; };', rt.sandbox);        // the test counter, never today's real one
  return rt;
}

if(process.argv[2] === "worker"){
  const rt = makeRt();
  rt.sandbox.FS_USAGE_ = { reads: 100, writes: 10, calls: 110 };
  rt.sandbox.fsFlushUsage_();
  console.log("DONE");
  process.exit(0);
}

let failures = 0;
function assert(cond, msg){ if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; } else console.log("PASS: " + msg); }

(async function(){
  if(!process.env.FIN_LOCAL_KEY){ console.error("Set FIN_LOCAL_KEY first."); process.exit(2); }
  deleteQa();
  try{
    // 1. several servers add at the very same moment
    const run = function(){
      return new Promise(function(resolve){
        const p = spawn(process.execPath, [__filename, "worker"], { env: process.env });
        let text = ""; p.stdout.on("data", function(d){ text += d; }); p.stderr.on("data", function(d){ text += d; });
        p.on("close", function(){ resolve(text); });
      });
    };
    const outs = await Promise.all([run(), run(), run(), run(), run()]);
    const t = readQa();
    assert(outs.every(function(o){ return /DONE/.test(o); }), "five servers flushed at the same moment without errors");
    // each flush adds its own counts plus ONE write and ONE call for the flush itself
    assert(t.reads === 500 && t.writes === 55 && t.calls === 555, "the shared total is EXACT: reads 500, writes 55 (5 x (10 + 1)), calls 555 (5 x (110 + 1)); got " + JSON.stringify(t));

    // 2. reading the total
    const rt = makeRt();
    const before = rt.sandbox.FS_USAGE_.reads;
    const u1 = rt.sandbox.fsUsageToday_(), u2 = rt.sandbox.fsUsageToday_(), u3 = rt.sandbox.fsUsageToday_();
    assert(u1.reads === 500 && u3.reads === 500, "a server reads the shared total back (500 reads)");
    assert(rt.sandbox.FS_USAGE_.reads - before === 1, "asking three times cost ONE database read (remembered for 60 seconds)");

    // 3. the safety limit trips on the SHARED total, even though this server itself has used almost nothing
    api("POST", BASE + ":commit", { writes: [{ update: { name: "projects/fin-app-76c40/databases/(default)/documents/" + QA_PATH, fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: "reads", increment: { integerValue: "44600" } }] }] });
    const rt2 = makeRt();
    let err = null;
    try{ rt2.sandbox.fsGetPathMeta_("_system/qa_does_not_exist"); }catch(e){ err = e; }
    assert(err && err.safetyLimit === true, "at 45,100 shared reads a day, this server's next read is refused (a different server's use counts)");
    const rt3 = makeRt();
    let werr = null;
    try{ rt3.sandbox.fsCommit_([{ del: { path: "_system/qa_does_not_exist" } }]); }catch(e){ werr = e; }
    assert(werr && werr.safetyLimit === true, "...and so is a write (once the read limit is reached the app pauses its Firestore use altogether until tomorrow, exactly as before)");
  }catch(e){
    console.error("TEST CRASHED: " + (e && e.stack || e)); failures++; process.exitCode = 1;
  }finally{
    deleteQa();
    console.log(api("GET", BASE + "/" + QA_PATH).status === 404 ? "cleanup done: test counter removed" : "WARNING: test counter left behind");
  }
  console.log(failures === 0 ? "\nLIVE METER TEST OK" : "\n" + failures + " FAILED");
})();
