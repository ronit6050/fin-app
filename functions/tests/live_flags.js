// functions/tests/live_flags.js  (NOT part of the automatic suite: it talks to the REAL Firestore)
//
// Plain-English what this does: proves on the real database that the shared on/off switches (backend/flags.js) work: a change made by one
// "server" is seen by another, two servers changing DIFFERENT switches at the very same moment both succeed, and a switch can be turned off again.
// It uses its own test document (_system/props_qa), NEVER the real _system/props, and deletes it at the end.
//
//   FIN_LOCAL_KEY=~/.fin-app/claude-sa-key.json node functions/tests/live_flags.js

const { spawn } = require("node:child_process");
const { createRuntime } = require("../runtime/shim");
const { syncFetch } = require("../runtime/syncfetch");
const { getFirestoreToken } = require("../runtime/tokens");

const QA_DOC = "_system/props_qa";
const BASE = "https://firestore.googleapis.com/v1/projects/fin-app-76c40/databases/(default)/documents";

function api(method, url, body){
  return syncFetch({ url: url, method: method, headers: { Authorization: "Bearer " + getFirestoreToken(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}
function readQa(){
  const r = api("GET", BASE + "/" + QA_DOC);
  if(r.status === 404) return {};
  const f = JSON.parse(r.text).fields || {}, out = {};
  Object.keys(f).forEach(function(k){ if(f[k].stringValue !== undefined) out[k] = f[k].stringValue; });
  return out;
}
function deleteQa(){ try{ api("DELETE", BASE + "/" + QA_DOC); }catch(e){} }

// the shim copies this document into its own "Script Properties" every 20 s; here it reads the TEST document instead of the real one
function makeRt(){
  const rt = createRuntime({ localEmail: "qa-flags@example.com", ownerEmail: "qa-flags@example.com", log: function(){}, sharedProps: function(){ return readQa(); } });
  rt.sandbox.FLAGS_DOC_ = QA_DOC;
  return rt;
}

if(process.argv[2] === "worker"){
  const flag = process.argv[3], rt = makeRt();
  rt.sandbox.flagsSet_(JSON.parse('{"' + flag + '":"on"}'));
  console.log("DONE " + flag);
  process.exit(0);
}

let failures = 0;
function assert(cond, msg){ if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; } else console.log("PASS: " + msg); }

(async function(){
  if(!process.env.FIN_LOCAL_KEY){ console.error("Set FIN_LOCAL_KEY first."); process.exit(2); }
  deleteQa();
  try{
    const a = makeRt(), b = makeRt();
    a.sandbox.flagsSet_({ V2_FN_SMS: "on" });
    assert(readQa().V2_FN_SMS === "on", "a change made by one server is written to the shared document");
    b.refreshProps();
    assert(b.smsEnabled() === true, "another server sees it (after its 20-second refresh, forced here)");
    b.sandbox.flagsSet_({ V2DB_USERS: JSON.stringify(["friend@example.com"]) });
    const doc = readQa();
    assert(doc.V2_FN_SMS === "on" && doc.V2DB_USERS === JSON.stringify(["friend@example.com"]), "the second server's change did not wipe the first one's");
    a.sandbox.flagsSet_({ V2_FN_SMS: null });
    assert(readQa().V2_FN_SMS === undefined && readQa().V2DB_USERS !== undefined, "switching one off removes only that one");

    // two servers, different switches, same moment, several rounds
    let allBoth = true;
    for(let round = 0; round < 4; round++){
      deleteQa();
      const run = function(flag){
        return new Promise(function(resolve){
          const p = spawn(process.execPath, [__filename, "worker", flag], { env: process.env });
          let text = ""; p.stdout.on("data", function(d){ text += d; }); p.stderr.on("data", function(d){ text += d; });
          p.on("close", function(){ resolve(text); });
        });
      };
      const outs = await Promise.all([run("V2_FN_WRITES"), run("V2_FN_TIMER"), run("V2DB_OWNER_DIRECT")]);
      const d = readQa();
      const ok = d.V2_FN_WRITES === "on" && d.V2_FN_TIMER === "on" && d.V2DB_OWNER_DIRECT === "on";
      if(!ok){ allBoth = false; console.log("round " + round + " outputs: " + outs.map(function(o){ return o.trim().slice(0, 120); }).join(" | ") + " doc=" + JSON.stringify(d)); }
    }
    assert(allBoth, "three servers changing three different switches at the same instant: all three landed, every round (4 rounds)");
  }catch(e){
    console.error("TEST CRASHED: " + (e && e.stack || e)); failures++; process.exitCode = 1;
  }finally{
    deleteQa();
    console.log(api("GET", BASE + "/" + QA_DOC).status === 404 ? "cleanup done: test document removed" : "WARNING: test document left behind");
  }
  console.log(failures === 0 ? "\nLIVE FLAGS TEST OK" : "\n" + failures + " FAILED");
})();
