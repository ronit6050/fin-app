// backend/tests/flags.test.js
//
// Plain-English what this checks: the shared on/off switches (backend/flags.js), now kept in ONE database document that both servers read and change:
//   - reading: the shared document wins; with no document the old Script Properties are used; a busy minute costs one database read, not one per
//     request; when the database cannot be read the last copy seen is used (and failing that the old settings); the emergency brake
//     (FLAGS_LEGACY) makes Apps Script ignore the database;
//   - changing: creates the document the first time, keeps the other switches, switching OFF removes only that switch, two people changing
//     different switches at the same instant both succeed (the second looks again), a failed save says so plainly and changes NOTHING anywhere,
//     an unknown switch name is refused, and Apps Script's own old settings are kept in step;
//   - on the new server: reads its own copy (the shim keeps it in step with the document) and a change updates that copy at once;
//   - seeding: exportFlagsToFunctions fills a missing document from the old settings and never overwrites an existing one.
// No network. Run with: node backend/tests/flags.test.js

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let failures = 0;
function assert(cond, msg){
  if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

function makeWorld(opts){
  opts = opts || {};
  const w = { docs: {}, clock: 0, now: 1000000, reads: 0, commits: 0, props: Object.assign({}, opts.props || {}), cache: {}, logs: [], failRead: false, failCommit: null, beforeCommit: null };
  const sb = { console: console };
  vm.createContext(sb);
  sb.PropertiesService = { getScriptProperties: function(){ return {
    getProperty: function(k){ return Object.prototype.hasOwnProperty.call(w.props, k) ? w.props[k] : null; },
    setProperty: function(k, v){ w.props[k] = String(v); return this; },
    deleteProperty: function(k){ delete w.props[k]; return this; }
  }; } };
  sb.CacheService = { getScriptCache: function(){ return {
    get: function(k){ const e = w.cache[k]; if(!e) return null; if(e.until <= w.now){ delete w.cache[k]; return null; } return e.v; },
    put: function(k, v, ttl){ w.cache[k] = { v: String(v), until: w.now + (ttl || 600) * 1000 }; },
    remove: function(k){ delete w.cache[k]; }
  }; } };
  sb.logAI = function(t, m){ w.logs.push(t + ": " + m); };
  sb.fsGetPathMeta_ = function(p){ w.reads++; if(w.failRead) throw new Error("firestore down"); const d = w.docs[p]; return d ? { fields: JSON.parse(JSON.stringify(d.fields)), updateTime: d.updateTime } : null; };
  sb.fsCommit_ = function(ops){
    if(w.failCommit){ const e = w.failCommit; throw e; }
    if(w.beforeCommit){ const f = w.beforeCommit; w.beforeCommit = null; f(); }
    return ops.map(function(op){
      const cur = w.docs[op.set.path];
      if(op.set.onlyIfNew && cur){ const e = new Error("exists"); e.httpCode = 409; throw e; }
      if(op.set.onlyIfUpdateTime && (!cur || cur.updateTime !== op.set.onlyIfUpdateTime)){ const e = new Error("changed"); e.httpCode = 400; throw e; }
      w.commits++;
      w.docs[op.set.path] = { fields: JSON.parse(JSON.stringify(op.set.fields)), updateTime: "t" + String(++w.clock).padStart(6, "0") };
      return { updateTime: w.docs[op.set.path].updateTime };
    });
  };
  const RealDate = Date;
  sb.Date = function(a){ return a === undefined ? new RealDate(w.now) : new RealDate(a); };
  sb.Date.now = function(){ return w.now; };
  if(opts.newServer) sb.V2_ON_NEW_SERVER_ = true;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "flags.js"), "utf8"), sb, { filename: "flags.js" });
  w.sb = sb;
  w.doc = function(){ return w.docs["_system/props"] ? w.docs["_system/props"].fields : null; };
  return w;
}

console.log("\n--- 1. Reading ---");
{
  const w = makeWorld({ props: { V2DB_OWNER: "on" } });
  assert(w.sb.flagGet_("V2DB_OWNER") === "on" && w.sb.flagOn_("V2DB_OWNER"), "no shared document yet: the old Script Properties are used");
  const w2 = makeWorld({ props: { V2DB_OWNER: "on" } });
  w2.docs["_system/props"] = { fields: { V2_FN_WRITES: "on" }, updateTime: "t1" };
  assert(w2.sb.flagGet_("V2_FN_WRITES") === "on" && w2.sb.flagGet_("V2DB_OWNER") === null, "the shared document wins: a switch only in the old settings counts as OFF (so a change made by the new server cannot be undone by a stale old setting)");
  assert(w2.sb.flagGet_("NOPE") === null, "an unknown or unset switch is simply off");
  const w3 = makeWorld();
  w3.docs["_system/props"] = { fields: { V2DB_USERS: JSON.stringify(["a@x.com"]), V2_FN_SMS: "on", updatedAtMs: 5, other: "ignored" }, updateTime: "t1" };
  assert(w3.sb.flagGet_("V2DB_USERS") === JSON.stringify(["a@x.com"]) && !("updatedAtMs" in w3.sb.flagsAll_()) && !("other" in w3.sb.flagsAll_()), "only the known switches are ever returned");
}

console.log("\n--- 1b. The old settings (the fallback) are kept current by every successful read ---");
{
  const w = makeWorld({ props: { V2DB_OWNER: "on", V2DB_USERS: "[]", V2_FN_TIMER: "on", FIREBASE_SERVICE_ACCOUNT: "secret", SETTING_CC_LIMIT: "70000" } });
  // the NEW server added a friend and turned the timer off: the document changed, Apps Script's own settings did not
  w.docs["_system/props"] = { fields: { V2DB_OWNER: "on", V2DB_USERS: JSON.stringify(["new@x.com"]) }, updateTime: "t9" };
  w.sb.flagGet_("V2DB_OWNER");
  assert(w.props.V2DB_USERS === JSON.stringify(["new@x.com"]) && w.props.V2_FN_TIMER === undefined && w.props.V2DB_OWNER === "on", "after a successful read the old settings equal the shared document (added, changed and removed switches)");
  assert(w.props.FIREBASE_SERVICE_ACCOUNT === "secret" && w.props.SETTING_CC_LIMIT === "70000", "and nothing that is not one of the six switches is touched");
  w.sb.FLAGS_MEMO_ = null; w.now += 40000; w.failRead = true;
  assert(w.sb.flagGet_("V2DB_USERS") === JSON.stringify(["new@x.com"]), "so the fallback is right even for a change made by the other server");
  const cold = makeWorld({ props: { V2DB_USERS: "[]" } });
  cold.failRead = true;
  cold.sb.flagGet_("V2DB_USERS");
  assert(cold.props.V2DB_USERS === "[]", "a failed read never changes the old settings");
}

console.log("\n--- 2. A busy minute costs one database read ---");
{
  const w = makeWorld();
  w.docs["_system/props"] = { fields: { V2DB_OWNER: "on" }, updateTime: "t1" };
  for(let i = 0; i < 20; i++) w.sb.flagGet_("V2DB_OWNER");
  assert(w.reads === 1, "20 asks -> 1 database read (got " + w.reads + ")");
  w.sb.FLAGS_MEMO_ = null; w.now += 31000;
  w.docs["_system/props"] = { fields: { V2DB_OWNER: "on", V2_FN_TIMER: "on" }, updateTime: "t2" };
  assert(w.sb.flagGet_("V2_FN_TIMER") === "on" && w.reads === 2, "after 30 seconds it looks again and sees a change made elsewhere");
}

console.log("\n--- 3. When the database cannot be read ---");
{
  const w = makeWorld({ props: { V2DB_OWNER: "on" } });
  w.docs["_system/props"] = { fields: { V2_FN_WRITES: "on" }, updateTime: "t1" };
  w.sb.flagGet_("V2_FN_WRITES");                                            // a good read: remembered
  w.sb.FLAGS_MEMO_ = null; w.now += 40000; w.failRead = true;
  assert(w.sb.flagGet_("V2_FN_WRITES") === "on", "database down: the last copy seen is used");
  const cold = makeWorld({ props: { V2DB_OWNER: "on" } });
  cold.failRead = true;
  assert(cold.sb.flagGet_("V2DB_OWNER") === "on", "database down and nothing remembered: the old Script Properties are used");
}

console.log("\n--- 4. The emergency brake ---");
{
  const w = makeWorld({ props: { V2DB_OWNER: "on", FLAGS_LEGACY: "on" } });
  w.docs["_system/props"] = { fields: { V2_FN_WRITES: "on" }, updateTime: "t1" };
  assert(w.sb.flagGet_("V2DB_OWNER") === "on" && w.sb.flagGet_("V2_FN_WRITES") === null && w.reads === 0, "FLAGS_LEGACY: only the old settings are read, the database is not even asked");
}

console.log("\n--- 5. Changing a switch ---");
{
  const w = makeWorld();
  assert(w.sb.flagsSet_({ V2DB_OWNER: "on" }) === true && w.doc().V2DB_OWNER === "on", "the first change creates the shared document");
  assert(w.sb.flagGet_("V2DB_OWNER") === "on" && w.props.V2DB_OWNER === "on", "it is visible at once, and Apps Script's own old setting is kept in step");
  w.sb.flagsSet_({ V2_FN_WRITES: "on", V2DB_USERS: JSON.stringify(["a@x.com"]) });
  assert(w.doc().V2DB_OWNER === "on" && w.doc().V2_FN_WRITES === "on" && w.doc().V2DB_USERS === JSON.stringify(["a@x.com"]), "another change keeps the switches already on");
  assert(typeof w.doc().updatedAtMs === "number", "the document records when it was last changed");
  w.sb.flagsSet_({ V2_FN_WRITES: null });
  assert(!("V2_FN_WRITES" in w.doc()) && w.doc().V2DB_OWNER === "on" && w.sb.flagGet_("V2_FN_WRITES") === null && !("V2_FN_WRITES" in w.props), "switching one OFF removes only that one (also from the old settings)");
  let msg = ""; try{ w.sb.flagsSet_({ NOT_A_SWITCH: "on" }); }catch(e){ msg = e.message; }
  assert(/Unknown switch/.test(msg) && !("NOT_A_SWITCH" in w.doc()), "an unknown switch name is refused");
}

console.log("\n--- 6. Two people change different switches at the same instant ---");
{
  const w = makeWorld();
  w.sb.flagsSet_({ V2DB_OWNER: "on" });
  // someone else turns V2_FN_SMS on between our read and our write
  w.beforeCommit = function(){ const cur = w.docs["_system/props"]; w.docs["_system/props"] = { fields: Object.assign({}, cur.fields, { V2_FN_SMS: "on" }), updateTime: "t-other" }; };
  w.sb.flagsSet_({ V2_FN_TIMER: "on" });
  assert(w.doc().V2_FN_TIMER === "on" && w.doc().V2_FN_SMS === "on" && w.doc().V2DB_OWNER === "on", "both changes survive: our write was refused once, looked again, and kept theirs");
}

console.log("\n--- 6b. Two friends added at nearly the same time from different servers: neither is lost ---");
{
  const w = makeWorld();
  w.sb.flagsSet_({ V2DB_USERS: JSON.stringify(["a@x.com"]) });
  const add = function(email){ return function(cur){ const l = JSON.parse(cur || "[]"); if(l.indexOf(email) === -1) l.push(email); return JSON.stringify(l); }; };
  // this server decides to add b@x.com, but just before it writes, the OTHER server adds c@x.com
  w.beforeCommit = function(){ const cur = w.docs["_system/props"]; w.docs["_system/props"] = { fields: Object.assign({}, cur.fields, { V2DB_USERS: JSON.stringify(["a@x.com", "c@x.com"]) }), updateTime: "t-other" }; };
  w.sb.flagsSet_({ V2DB_USERS: add("b@x.com") });
  assert(JSON.stringify(JSON.parse(w.doc().V2DB_USERS).sort()) === JSON.stringify(["a@x.com", "b@x.com", "c@x.com"]), "the list ends with all three: the change was worked out again from the freshest list, not from a stale copy");
  assert(w.props.V2DB_USERS === w.doc().V2DB_USERS && w.sb.flagGet_("V2DB_USERS") === w.doc().V2DB_USERS, "and the old settings and the memory hold what was really saved");
  w.sb.flagsSet_({ V2DB_USERS: function(){ return null; } });
  assert(!("V2DB_USERS" in w.doc()), "a function returning nothing switches the setting off");
}

console.log("\n--- 7. A failed save changes NOTHING ---");
{
  const w = makeWorld({ props: { V2DB_OWNER: "on" } });
  w.docs["_system/props"] = { fields: { V2DB_OWNER: "on" }, updateTime: "t1" };
  w.sb.flagGet_("V2DB_OWNER");
  const down = new Error("firestore down"); down.httpCode = 503; w.failCommit = down;
  let msg = ""; try{ w.sb.flagsSet_({ V2_FN_WRITES: "on" }); }catch(e){ msg = e.message; }
  w.failCommit = null;
  assert(/NOTHING was changed/.test(msg), "it says so in plain words");
  assert(w.doc().V2_FN_WRITES === undefined && w.props.V2_FN_WRITES === undefined && w.sb.flagGet_("V2_FN_WRITES") === null, "the document, the old settings and what the server remembers are all unchanged");
  assert(w.logs.some(function(l){ return /^FLAGS_WRITE_ERROR/.test(l); }), "and it is logged");
}

console.log("\n--- 8. On the new server ---");
{
  const w = makeWorld({ newServer: true, props: { V2DB_OWNER: "on" } });          // props = the shim's copy of the document
  assert(w.sb.flagGet_("V2DB_OWNER") === "on" && w.reads === 0, "it reads its own copy (kept in step with the document by the shim) without asking the database");
  w.sb.flagsSet_({ V2DB_USERS: JSON.stringify(["v@x.com"]) });
  assert(w.doc().V2DB_USERS === JSON.stringify(["v@x.com"]) && w.sb.flagGet_("V2DB_USERS") === JSON.stringify(["v@x.com"]), "a change is written to the shared document and shows in its own copy at once");
}

console.log("\n--- 9. Seeding ---");
{
  const w = makeWorld({ props: { V2DB_OWNER: "on", V2_FN_WRITES: "on", V2DB_USERS: "[\"a@x.com\"]", FIREBASE_SERVICE_ACCOUNT: "secret" } });
  assert(w.sb.exportFlagsToFunctions() === true && w.doc().V2DB_OWNER === "on" && w.doc().V2_FN_WRITES === "on" && w.doc().V2DB_USERS === "[\"a@x.com\"]", "a missing document is filled from the old settings");
  assert(!("FIREBASE_SERVICE_ACCOUNT" in w.doc()), "and no secret (anything that is not a switch) is ever copied");
  w.props.V2DB_OWNER = "changed-old-value";
  w.sb.exportFlagsToFunctions();
  assert(w.doc().V2DB_OWNER === "on", "running it again never overwrites an existing document");
  const bad = makeWorld(); bad.failRead = true;
  assert(bad.sb.exportFlagsToFunctions() === false, "a database problem is reported as false, not thrown");
}

console.log(failures ? "\n" + failures + " check(s) FAILED" : "\nAll checks passed.");
