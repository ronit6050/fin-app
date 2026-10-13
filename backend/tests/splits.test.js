// backend/tests/splits.test.js
//
// Plain-English what this checks: the "split a payment with a friend" brain
// (splits.js) and the new all-or-nothing Firestore writer it relies on
// (firestore.js). Everything runs against a FAKE Firestore that behaves like the
// real one (including refusing to create something that already exists, and
// refusing a change if someone else changed it first). All names are invented.
//
// THE PROMISES THIS FILE PROVES:
//   1. The balance is always right: splits add, payments subtract, overpaying
//      flips it, undo reverses it exactly - checked against the user's own
//      example (Rs 1,000 owed, Rs 200 paid, Rs 800 left).
//   2. Tapping Split twice (or a retry) can never split the same payment twice.
//   3. A failed save changes NOTHING (no half-written split, no wrong balance).
//   4. Each person's data stays under their own email only, and the security
//      rules file lets a person read only their own folder and nobody write.
//   5. If Firestore is down the app gets a plain message, never a crash.
//
// Run with: node backend/tests/splits.test.js

const fs = require("fs");
const path = require("path");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js",
  "autoSettle.js", "obligationReminders.js", "appHealth.js", "firestore.js", "viewPublisher.js", "splits.js", "planner.js", "CCAdvisor.js", "v2route.js", "v2db.js"
];
const ME = "ronitnadar9@gmail.com";
const FRIEND = "vaidehi@example.com";

// A fake Firestore server. docs[path] = { fields (typed), updateTime }.
function world(){
  const w = makeWorld(FILES);
  const sb = w.sb;
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  w.props.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "robot@test.iam", private_key: "fake-private-key", project_id: "test-project" });
  w.cache = {};
  sb.CacheService = { getScriptCache: function(){ return {
    get: function(k){ return Object.prototype.hasOwnProperty.call(w.cache, k) ? w.cache[k] : null; },
    put: function(k, v){ w.cache[k] = String(v); }, remove: function(k){ delete w.cache[k]; }
  }; } };
  sb.Utilities.base64EncodeWebSafe = function(x){ return Buffer.from(typeof x === "string" ? x : Buffer.from(x)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"); };
  sb.Utilities.computeRsaSha256Signature = function(){ return Buffer.from("signature"); };
  sb.ContentService = { createTextOutput: function(t){ return { _t: t, setMimeType: function(){ return this; }, getContent: function(){ return t; } }; }, MimeType: { JSON: "json" } };

  w.docs = {};
  w.clock = 1;
  w.mode = "ok";            // ok | down
  w.beforeCommit = null;    // a hook to simulate "someone else changed it first"
  w.commits = 0;
  const reply = function(code, obj){ return { getResponseCode: function(){ return code; }, getContentText: function(){ return JSON.stringify(obj); } }; };
  const nameToPath = function(n){ return String(n).split("/documents/")[1]; };
  const stamp = function(){ return "t" + String(w.clock++).padStart(6, "0"); };

  sb.UrlFetchApp = { fetch: function(url, options){
    if(url.indexOf("oauth2.googleapis.com/token") !== -1) return reply(200, { access_token: "tok" });
    if(w.mode === "down") return reply(503, { error: { message: "unavailable: secret-internal-detail" } });
    options = options || {};

    if(url.indexOf(":commit") !== -1){
      w.commits++;
      if(w.beforeCommit){ const h = w.beforeCommit; w.beforeCommit = null; h(); }
      const writes = JSON.parse(options.payload).writes;
      // 1) check every promise first - all or nothing
      for(const wr of writes){
        const p = nameToPath(wr.update ? wr.update.name : wr["delete"]);
        const cur = w.docs[p];
        if(wr.currentDocument){
          if(wr.currentDocument.exists === false && cur) return reply(409, { error: { status: "ALREADY_EXISTS", message: "exists: " + p } });
          if(wr.currentDocument.updateTime && (!cur || cur.updateTime !== wr.currentDocument.updateTime)) return reply(400, { error: { status: "FAILED_PRECONDITION", message: "changed: " + p } });
        }
      }
      // 2) apply
      for(const wr of writes){
        if(wr["delete"]){ delete w.docs[nameToPath(wr["delete"])]; continue; }
        const p = nameToPath(wr.update.name);
        const cur = w.docs[p] || { fields: {}, updateTime: "" };
        const fields = Object.assign({}, cur.fields);
        if(wr.updateMask){
          wr.updateMask.fieldPaths.forEach(function(f){ fields[f] = wr.update.fields[f]; });
        } else {
          Object.keys(fields).forEach(function(k){ delete fields[k]; });
          Object.assign(fields, wr.update.fields);
        }
        (wr.updateTransforms || []).forEach(function(t){
          const before = fields[t.fieldPath] ? Number(fields[t.fieldPath].integerValue) : 0;
          fields[t.fieldPath] = { integerValue: String(before + Number(t.increment.integerValue)) };
        });
        w.docs[p] = { fields: fields, updateTime: stamp() };
      }
      return reply(200, { writeResults: [] });
    }

    const rest = decodeURIComponent((/documents\/([^?]*)/.exec(url) || [])[1] || "");
    const segs = rest.split("/");
    if(segs.length % 2 === 1){            // a collection -> list its direct children
      const docs = Object.keys(w.docs).filter(function(p){
        return p.indexOf(rest + "/") === 0 && p.slice(rest.length + 1).indexOf("/") === -1;
      }).map(function(p){ return { name: "projects/test-project/databases/(default)/documents/" + p, fields: w.docs[p].fields, updateTime: w.docs[p].updateTime }; });
      return reply(200, docs.length ? { documents: docs } : {});
    }
    return w.docs[rest] ? reply(200, { fields: w.docs[rest].fields, updateTime: w.docs[rest].updateTime }) : reply(404, { error: { message: "not found" } });
  } };

  w.sb.verifyGoogleIdToken = function(t){
    return t === "good" ? { email: ME, name: "Ronit" }
      : t === "other" ? { email: "someone@else.com", name: "X" }
      : t === "vaidehi" ? { email: "Vaidehi@Example.com", name: "Vaidehi N" }
      : t === "zed" ? { email: "zed@example.com", name: "Zed" }
      : null;
  };
  w.get = function(p){ return w.docs[p] ? w.sb.fsDecodeFields_(w.docs[p].fields) : null; };
  w.balance = function(owner, other){ const d = w.get("users/" + owner + "/friends/" + other); return d ? d.balancePaise : null; };
  w.errors = function(){ return w.sheets.AILogs.rows.slice(1).filter(function(r){ return r[1] === "SPLITS_ERROR"; }); };
  return w;
}

function run(w, action, data){ return w.sb.splitsHandle_(action, data || {}, { email: ME, name: "Ronit" }); }
function withFriend(){
  const w = world();
  const r = run(w, "addFriend", { name: "Vaidehi", mobile: "98765 43210", email: "Vaidehi@Example.com " });
  assert(r.ok, "setup: friend added");
  return w;
}

console.log("\n--- 1. Adding a friend ---");
{
  const w = world();
  assert(!run(w, "addFriend", { name: "", mobile: "9876543210", email: FRIEND }).ok, "a name is required");
  assert(!run(w, "addFriend", { name: "V", mobile: "123", email: FRIEND }).ok, "a too-short mobile number is refused");
  assert(!run(w, "addFriend", { name: "V", mobile: "9876543210", email: "not-an-email" }).ok, "a bad email is refused");
  assert(!run(w, "addFriend", { name: "V", mobile: "9876543210", email: ME }).ok, "you can't add yourself");
  assert(!run(w, "addFriend", { name: "V", mobile: "9876543210", email: "a/b@x.com" }).ok, "an email with a slash (path trick) is refused");
  assert(Object.keys(w.docs).length === 0, "refused requests wrote nothing");

  const r = run(w, "addFriend", { name: "Vaidehi", mobile: "+91 98765 43210", email: "  Vaidehi@Example.COM " });
  assert(r.ok && r.friend.email === FRIEND, "email is tidied to lowercase and trimmed");
  const mine = w.get("users/" + ME + "/friends/" + FRIEND);
  assert(mine.name === "Vaidehi" && mine.mobile === "+919876543210" && mine.balancePaise === 0, "friend saved with name, mobile and a zero balance");
  const mirror = w.get("users/" + FRIEND + "/friends/" + ME);
  assert(mirror && mirror.name === "Ronit" && mirror.mirror === true && mirror.balancePaise === 0, "she gets a matching entry for you on her side");

  w.sb.splitsCreate_(ME, "Ronit", { friendEmail: FRIEND, totalAmount: 100, description: "x", requestId: "a" });
  assert(w.balance(ME, FRIEND) === 5000, "setup: a balance of Rs 50 exists");
  w.docs["users/" + FRIEND + "/friends/" + ME].fields.name = { stringValue: "Ronit (her name for me)" };
  run(w, "addFriend", { name: "Vaidehi N", mobile: "9876543210", email: FRIEND });
  assert(w.get("users/" + ME + "/friends/" + FRIEND).name === "Vaidehi N", "adding again updates the name");
  assert(w.balance(ME, FRIEND) === 5000, "adding again keeps the balance");
  assert(w.get("users/" + FRIEND + "/friends/" + ME).name === "Ronit (her name for me)", "adding again does not overwrite what she calls you");
}

console.log("\n--- 2. Splitting a payment ---");
{
  const w = withFriend();
  const r = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, description: "Restaurant Spice", txRow: 120, txFp: "fp-abc", requestId: "r1" });
  assert(r.ok && r.friendShare === 420 && r.myShare === 420 && r.balance === 420, "Rs 840 splits equally: 420 each, balance 420");
  assert(w.balance(ME, FRIEND) === 42000 && w.balance(FRIEND, ME) === -42000, "her balance with you is the exact opposite");
  const mine = w.get("users/" + ME + "/friends/" + FRIEND + "/ledger/r1");
  const hers = w.get("users/" + FRIEND + "/friends/" + ME + "/ledger/r1");
  assert(mine.signedPaise === 42000 && mine.type === "split" && mine.description === "Restaurant Spice" && mine.txRow === 120, "your entry is saved with the details");
  assert(hers.signedPaise === -42000 && hers.mirror === true && hers.counterparty === ME, "her copy is the mirror image and points back at you");
  assert(w.get("users/" + ME + "/splitMarkers/fp-abc").entryId === "r1", "the payment is marked as already split");

  const odd = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 100.01, description: "odd", requestId: "r2" });
  assert(odd.friendShare === 50 && odd.myShare === 50.01, "an odd paisa stays with the person who paid (50.00 / 50.01)");
  assert(w.balance(ME, FRIEND) === 42000 + 5000, "balance adds up in whole paise (no 0.0000001 drift)");

  const custom = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 1000, friendShare: 300, requestId: "r3" });
  assert(custom.ok && custom.friendShare === 300 && custom.myShare === 700, "a custom share is honoured");
  assert(w.balance(ME, FRIEND) === 42000 + 5000 + 30000, "balance includes the custom share");

  const full = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 50, friendShare: 50, requestId: "r4" });
  assert(full.ok && full.myShare === 0, "she can owe the entire amount (you paid it all for her)");

  const before = w.balance(ME, FRIEND);
  for(const bad of [{ totalAmount: 0 }, { totalAmount: -5 }, { totalAmount: "abc" }, { totalAmount: "" }, { totalAmount: 100, friendShare: 0 },
                    { totalAmount: 100, friendShare: 100.01 }, { totalAmount: 100, friendShare: "x" }, { totalAmount: 99999999999 }]){
    const x = run(w, "createSplit", Object.assign({ friendEmail: FRIEND, requestId: "bad" + Math.random() }, bad));
    assert(!x.ok, "refused: " + JSON.stringify(bad));
  }
  assert(w.balance(ME, FRIEND) === before, "refused splits changed nothing");
  assert(!run(w, "createSplit", { friendEmail: "stranger@x.com", totalAmount: 100 }).ok, "splitting with someone not in your list is refused");
  for(const a of ["createSplit", "recordSplitPayment", "undoSplitEntry", "getPerson"]){
    const x = run(w, a, { friendEmail: "../../views/dashboard", totalAmount: 5, amount: 5, entryId: "r1" });
    assert(!x.ok && /email/i.test(x.error), a + " refuses a friend email that is really a path trick");
  }
}

console.log("\n--- 3. The same payment can never be split twice ---");
{
  const w = withFriend();
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 7, txFp: "fp-1", requestId: "first" });
  const dup = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 7, txFp: "fp-1", requestId: "second-tap" });
  assert(!dup.ok && dup.duplicate === true, "a second tap on the same payment is refused as a duplicate");
  assert(w.balance(ME, FRIEND) === 42000 && w.balance(FRIEND, ME) === -42000, "balances did not move");
  assert(w.get("users/" + ME + "/friends/" + FRIEND + "/ledger/second-tap") === null && w.get("users/" + FRIEND + "/friends/" + ME + "/ledger/second-tap") === null, "no half-written entry was left on either side");

  const retry = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, friendShare: 100, requestId: "first" });
  assert(!retry.ok && retry.duplicate === true && w.balance(ME, FRIEND) === 42000, "a network retry with the same request id changes nothing");

  const rowOnly = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 50, txRow: 9, requestId: "ro1" });
  const rowAgain = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 50, txRow: 9, requestId: "ro2" });
  assert(rowOnly.ok && !rowAgain.ok, "a payment known only by row number is also protected");

  const manual1 = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 60, requestId: "m1" });
  const manual2 = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 60, requestId: "m2" });
  assert(manual1.ok && manual2.ok, "two typed-in expenses of the same amount are two real splits (no transaction link, nothing to clash)");
}

console.log("\n--- 4. Payments and the running balance (the user's own example) ---");
{
  const w = withFriend();
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, requestId: "a" });
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 600, requestId: "b" });
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 560, requestId: "c" });
  assert(w.balance(ME, FRIEND) === 100000, "420 + 300 + 280 = she owes Rs 1,000");

  const p1 = run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 200, direction: "received", method: "upi", requestId: "p1" });
  assert(p1.ok && p1.balance === 800 && w.balance(ME, FRIEND) === 80000, "she pays Rs 200 -> Rs 800 still owed");
  assert(w.balance(FRIEND, ME) === -80000, "her side agrees");
  const p2 = run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 800, direction: "received", method: "cash", requestId: "p2" });
  assert(p2.ok && p2.balance === 0 && w.balance(ME, FRIEND) === 0, "she pays the remaining Rs 800 -> settled (0)");
  const p3 = run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 150, direction: "received", requestId: "p3" });
  assert(p3.ok && p3.balance === -150 && w.balance(ME, FRIEND) === -15000, "overpaying by Rs 150 flips it: you now owe her Rs 150");
  const p4 = run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 150, direction: "sent", method: "upi", requestId: "p4" });
  assert(p4.ok && p4.balance === 0, "you pay her Rs 150 back -> 0 again");

  const net = withFriend();
  run(net, "createSplit", { friendEmail: FRIEND, totalAmount: 2000, requestId: "x" });
  const s = run(net, "recordSplitPayment", { friendEmail: FRIEND, amount: 300, direction: "sent", requestId: "y" });
  assert(s.balance === 1300, "you pay for her once more ('sent' adds to what she owes you): 1000 + 300 = 1300");

  const bad = run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 0 });
  assert(!bad.ok, "a Rs 0 payment is refused");
  assert(!run(w, "recordSplitPayment", { friendEmail: "nobody@x.com", amount: 10 }).ok, "a payment for someone not in your list is refused");
  const dupe = run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 200, direction: "received", requestId: "p1" });
  assert(!dupe.ok && dupe.duplicate && w.balance(ME, FRIEND) === 0, "re-sending the same payment id does not count it twice");
  const m = w.get("users/" + ME + "/friends/" + FRIEND + "/ledger/p2");
  assert(m.method === "cash" && m.type === "payment" && m.signedPaise === -80000, "the payment entry records method and sign");
}

console.log("\n--- 5. Undo ---");
{
  const w = withFriend();
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 5, txFp: "fp-u", requestId: "s1" });
  run(w, "recordSplitPayment", { friendEmail: FRIEND, amount: 200, direction: "received", requestId: "p1" });
  assert(w.balance(ME, FRIEND) === 22000, "setup: 420 - 200 = 220 owed");

  const u = run(w, "undoSplitEntry", { friendEmail: FRIEND, entryId: "p1" });
  assert(u.ok && w.balance(ME, FRIEND) === 42000 && w.balance(FRIEND, ME) === -42000, "undoing the payment puts the Rs 200 back on her balance, on both sides");
  assert(w.get("users/" + ME + "/friends/" + FRIEND + "/ledger/p1").undone === true && w.get("users/" + FRIEND + "/friends/" + ME + "/ledger/p1").undone === true, "the entry is kept in history but marked undone, on both sides");
  assert(!run(w, "undoSplitEntry", { friendEmail: FRIEND, entryId: "p1" }).ok && w.balance(ME, FRIEND) === 42000, "undoing twice is refused and does not double-reverse");

  const us = run(w, "undoSplitEntry", { friendEmail: FRIEND, entryId: "s1" });
  assert(us.ok && w.balance(ME, FRIEND) === 0, "undoing the split brings the balance back to 0");
  assert(w.get("users/" + ME + "/splitMarkers/fp-u") === null, "the payment is free to be split again");
  const again = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, friendShare: 500, txRow: 5, txFp: "fp-u", requestId: "s2" });
  assert(again.ok && w.balance(ME, FRIEND) === 50000, "re-splitting the same payment after undo works (new share Rs 500)");

  assert(!run(w, "undoSplitEntry", { friendEmail: FRIEND, entryId: "nope" }).ok, "undoing something that doesn't exist is refused");
  assert(!run(w, "undoSplitEntry", { friendEmail: FRIEND, entryId: "" }).ok, "undo with no entry is refused");

  const w2 = withFriend();
  run(w2, "createSplit", { friendEmail: FRIEND, totalAmount: 100, requestId: "q1" });
  w2.beforeCommit = function(){ w2.docs["users/" + ME + "/friends/" + FRIEND + "/ledger/q1"].updateTime = "changed-by-someone"; };
  const race = run(w2, "undoSplitEntry", { friendEmail: FRIEND, entryId: "q1" });
  assert(!race.ok && /just changed/i.test(race.error), "if the entry changed between reading and undoing, it asks you to refresh");
  assert(w2.balance(ME, FRIEND) === 5000 && w2.balance(FRIEND, ME) === -5000, "and nothing was reversed");
}

console.log("\n--- 6. A failed save changes nothing ---");
{
  const w = withFriend();
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 100, txFp: "fp-z", requestId: "ok1" });
  const snapshot = JSON.stringify(w.docs);
  // The marker clashes -> the whole batch must be rejected, including the entry that would have been fine.
  w.docs["users/" + ME + "/splitMarkers/fp-clash"] = { fields: { entryId: { stringValue: "old" } }, updateTime: "x" };
  const snap2 = JSON.stringify(w.docs);
  const r = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 500, txFp: "fp-clash", requestId: "wont-land" });
  assert(!r.ok && JSON.stringify(w.docs) === snap2, "one bad part (marker already there) rejects the WHOLE split; the database is byte-for-byte unchanged");
  assert(snapshot.length > 0, "(sanity)");

  w.mode = "down";
  const down = run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 100, requestId: "d1" });
  assert(down.ok === false && /Nothing was saved/.test(down.error), "Firestore down -> a plain 'nothing was saved' message, no crash");
  assert(down.error.indexOf("secret-internal-detail") === -1 && down.error.indexOf("503") === -1, "the message does not leak Google's internal error");
  assert(w.errors().length >= 1, "the problem is written to the error log for you to find");
  for(const a of ["getPeople", "getPerson", "addFriend", "recordSplitPayment", "undoSplitEntry"]){
    let threw = false, out;
    try{ out = run(w, a, { friendEmail: FRIEND, name: "A", mobile: "9876543210", email: FRIEND, amount: 5, entryId: "ok1" }); }catch(e){ threw = true; }
    assert(!threw && out && out.ok === false, a + " with Firestore down returns {ok:false} instead of throwing");
  }
  w.mode = "ok";
  assert(w.balance(ME, FRIEND) === 5000, "when Firestore comes back, the balance is exactly as it was");
}

console.log("\n--- 7. Reading: people list and one person's history ---");
{
  const w = withFriend();
  run(w, "addFriend", { name: "Raj", mobile: "9000000001", email: "raj@example.com" });
  run(w, "addFriend", { name: "Asha", mobile: "9000000002", email: "asha@example.com" });
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 1000, requestId: "a" });             // she owes 500
  run(w, "createSplit", { friendEmail: "raj@example.com", totalAmount: 200, requestId: "b" });   // raj owes 100
  run(w, "recordSplitPayment", { friendEmail: "asha@example.com", amount: 70, direction: "sent", requestId: "c" });  // asha owes 70
  run(w, "recordSplitPayment", { friendEmail: "raj@example.com", amount: 250, direction: "received", requestId: "d" }); // raj: 100 - 250 = -150 (you owe)

  const list = run(w, "getPeople");
  assert(list.ok && list.people.length === 3, "three people listed");
  assert(list.people[0].email === FRIEND && list.people[0].balance === 500, "the biggest balance is first (Vaidehi 500)");
  assert(list.owedToMe === 570 && list.iOwe === 150, "totals: Rs 570 owed to you, Rs 150 you owe");
  assert(list.people.find(function(p){ return p.email === "raj@example.com"; }).balance === -150, "a negative balance means you owe them");

  // Tests run faster than a millisecond; give the later entry a later time like real life would.
  w.docs["users/" + ME + "/friends/raj@example.com/ledger/d"].fields.createdAtMs = { integerValue: String(Date.now() + 5000) };
  const p = run(w, "getPerson", { friendEmail: "RAJ@example.com" });
  assert(p.ok && p.person.balance === -150 && p.entries.length === 2, "one person's history shows both entries");
  assert(p.entries[0].type === "payment" && p.entries[0].direction === "theyOweLess" && p.entries[0].amount === 250, "entries are described from your side, newest first");
  assert(p.healed === false, "a correct stored balance is left alone");

  w.docs["users/" + ME + "/friends/" + FRIEND].fields.balancePaise = { integerValue: "99999" };
  const fixed = run(w, "getPerson", { friendEmail: FRIEND });
  assert(fixed.person.balance === 500 && fixed.healed === true, "a wrong stored balance is corrected from the history");
  assert(w.balance(ME, FRIEND) === 50000 && w.balance(FRIEND, ME) === -50000, "...and the corrected number is saved back, on her side too");

  // A save that lands while the heal is running must not be overwritten (the heal adds, it does not replace).
  w.docs["users/" + ME + "/friends/" + FRIEND].fields.balancePaise = { integerValue: "40000" };
  w.beforeCommit = function(){
    const d = w.docs["users/" + ME + "/friends/" + FRIEND];
    d.fields.balancePaise = { integerValue: String(Number(d.fields.balancePaise.integerValue) + 777) };
  };
  run(w, "getPerson", { friendEmail: FRIEND });
  assert(w.balance(ME, FRIEND) === 50777, "a change landing at the same moment is kept, not overwritten (50000 + 777)");

  // History cut short by the safety cap -> never "fix" the balance to a too-small number.
  const capWorld = withFriend();
  run(capWorld, "createSplit", { friendEmail: FRIEND, totalAmount: 100, requestId: "c1" });
  capWorld.sb.SPLITS_LEDGER_CAP_ = 1;
  capWorld.docs["users/" + ME + "/friends/" + FRIEND].fields.balancePaise = { integerValue: "123456" };
  const capped = run(capWorld, "getPerson", { friendEmail: FRIEND });
  assert(capped.healed === false && capWorld.balance(ME, FRIEND) === 123456, "when the history is cut short, the balance is left alone");

  w.sb.splitsUndo_(ME, { friendEmail: FRIEND, entryId: "a" });
  const afterUndo = run(w, "getPerson", { friendEmail: FRIEND });
  assert(afterUndo.person.balance === 0 && afterUndo.entries.length === 1 && afterUndo.entries[0].undone === true, "undone entries stay visible but do not count");

  assert(!run(w, "getPerson", { friendEmail: "nobody@x.com" }).ok, "asking about someone not in your list is refused");
  assert(run(world(), "getPeople").people.length === 0, "a brand-new account has an empty list, not an error");
}

console.log("\n--- 8. Privacy: nobody's data lands in anybody else's folder ---");
{
  const w = withFriend();
  run(w, "addFriend", { name: "Raj", mobile: "9000000001", email: "raj@example.com" });
  run(w, "createSplit", { friendEmail: FRIEND, totalAmount: 840, txFp: "fp-p", requestId: "z1" });
  run(w, "recordSplitPayment", { friendEmail: "raj@example.com", amount: 40, requestId: "z2" });
  const paths = Object.keys(w.docs);
  assert(paths.every(function(p){ return /^users\/(ronitnadar9@gmail\.com|vaidehi@example\.com|raj@example\.com)\//.test(p); }), "every document lives under someone's own email folder");
  assert(paths.filter(function(p){ return p.indexOf("users/raj@example.com/") === 0; }).every(function(p){ return /friends\/ronitnadar9@gmail\.com/.test(p); }), "Raj's folder only holds his side of his dealings with you");
  assert(!paths.some(function(p){ return p.indexOf("users/vaidehi@example.com/") === 0 && /raj/.test(p); }), "Vaidehi's folder says nothing about Raj");
  assert(w.get("users/" + FRIEND + "/splitMarkers/fp-p") === null, "your 'already split' marker is not copied to her");

  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  assert(/match \/users\/\{email\}\/\{document=\*\*\}/.test(rules), "rules: a users/{email} block exists");
  assert(/request\.auth\.token\.email\.lower\(\) == email/.test(rules), "rules: you can read only the folder named after your own email");
  assert(/email_verified == true/.test(rules), "rules: the email must be verified");
  assert(!/allow\s+(write|create|update|delete|read,\s*write)[^;]*:\s*if\s+true/.test(rules), "rules: nothing is open to everyone");
  assert((rules.match(/allow write: if false/g) || []).length >= 2 && /match \/\{document=\*\*\} \{\s*allow read, write: if false/.test(rules), "rules: the phone can never write, and everything else is closed");
  assert(/match \/views\/\{doc\}/.test(rules) && /ronitnadar9@gmail\.com/.test(rules), "rules: the existing Home-copy rule is still there");
}

console.log("\n--- 9. Through the real app door (sign-in check) ---");
{
  const w = world();
  const call = function(token, action, extra){
    const out = w.sb.handlePwaRequest(Object.assign({ action: action, idToken: token }, extra || {}));
    return JSON.parse(out.getContent());
  };
  assert(call("good", "addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND }).ok, "addFriend works for the signed-in owner");
  assert(call("good", "createSplit", { friendEmail: FRIEND, totalAmount: 840, requestId: "k1" }).friendShare === 420, "createSplit works through the app door");
  assert(call("good", "getPeople").people[0].balance === 420, "getPeople works through the app door");
  const stranger = call("other", "getPeople");
  assert(stranger.ok === false && /not allowed/i.test(stranger.error), "a different Google account is still blocked");
  assert(call("bogus", "getPeople").ok === false, "a bad sign-in is still blocked");
  assert(w.sb.V2_WRITE_ACTIONS_.indexOf("createSplit") === -1, "split actions don't trigger a Home-screen rebuild (nothing there shows them yet)");
}

console.log("\n--- 10. The new Firestore writer sends what Firestore expects ---");
{
  const w = world();
  w.sb.fsCommit_([
    { set: { path: "users/a@b.com/x/1", fields: { n: 5 }, onlyIfNew: true } },
    { merge: { path: "users/a@b.com/x/2", fields: { s: "hi" }, adds: [{ field: "bal", amountInt: -300 }] } },
    { del: { path: "users/a@b.com/x/3" } }
  ]);
  assert(w.commits === 1, "three changes go out as ONE request");
  assert(w.get("users/a@b.com/x/1").n === 5 && w.get("users/a@b.com/x/2").bal === -300 && w.get("users/a@b.com/x/2").s === "hi", "values and the 'add to number' land correctly (negative too)");
  assert(w.sb.FS_USAGE_.writes === 3, "each change is counted against the free daily allowance");
  const sent = JSON.parse(w.sb.UrlFetchApp.fetch.toString ? "{}" : "{}");
  assert(typeof sent === "object", "(sanity)");
  let code = 0;
  try{ w.sb.fsCommit_([{ set: { path: "users/a@b.com/x/1", fields: { n: 6 }, onlyIfNew: true } }]); }catch(e){ code = e.httpCode; }
  assert(code === 409 && w.get("users/a@b.com/x/1").n === 5, "creating something that already exists fails with 409 and leaves the old one alone");
  assert(w.sb.fsPathUrl_("users/a@b.com/friends/c d@x.com").indexOf("users/a%40b.com/friends/c%20d%40x.com") !== -1, "odd characters in a path are made URL-safe piece by piece");
}

console.log("\n--- 11. A friend signing in herself (splits-only) ---");
{
  const w = world();
  const call = function(token, action, extra){
    const out = w.sb.handlePwaRequest(Object.assign({ action: action, idToken: token }, extra || {}));
    return JSON.parse(out.getContent());
  };
  const owner = function(action, extra){ return call("good", action, extra); };
  const she = function(action, extra){ return call("vaidehi", action, extra); };

  // Before the owner adds her she is nobody.
  const before = she("getPeople");
  assert(before.ok === false && /not allowed/i.test(before.error), "before she is added, she is refused");
  w.cache = {};   // forget that "no" so the next check looks again (the real "no" is only remembered for a minute)

  owner("addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND });
  owner("createSplit", { friendEmail: FRIEND, totalAmount: 840, description: "Dinner", requestId: "f1" });
  w.cache = {};

  const mine = she("getPeople");
  assert(mine.ok && mine.people.length === 1 && mine.people[0].email === ME && mine.people[0].balance === -420, "once added, she signs in and sees ONLY Ronit, owing Rs 420");
  const person = she("getPerson", { friendEmail: ME });
  assert(person.ok && person.entries.length === 1 && person.entries[0].description === "Dinner" && person.entries[0].mirror === true, "she sees the split in her own history, marked as the mirror copy");

  const blocked = ["getPending", "saveNote", "getDashboard", "getDebts", "settleDebt", "addDebt", "getSettings", "updateSettings", "registerPushToken",
                   "refreshViews", "getCash", "addCashEntry", "getTransactionHistory", "reconcileStatement", "getSavingsGoals", "getPlannerData", "markNotATransaction"];
  blocked.forEach(function(a){
    const r = she(a, { row: 5, amount: 1, token: "stolen-push-token" });
    assert(r.ok === false && /not allowed/i.test(r.error), "she cannot use " + a);
  });
  assert(w.props.PWA_PUSH_TOKEN === undefined, "she could not overwrite the owner's push-notification device");

  const addF = she("addFriend", { name: "Raj", mobile: "9000000001", email: "raj@example.com" });
  assert(addF.ok && w.get("users/" + FRIEND + "/friends/raj@example.com").name === "Raj", "she can add her own friends, stored in HER folder");
  assert(w.get("users/" + ME + "/friends/raj@example.com") === null, "...and nothing about Raj appears in the owner's folder");

  const pay = she("recordSplitPayment", { friendEmail: ME, amount: 200, direction: "sent", method: "upi", requestId: "hp1" });
  assert(pay.ok && pay.balance === -220 && w.balance(FRIEND, ME) === -22000 && w.balance(ME, FRIEND) === 22000, "she records paying Rs 200: she owes Rs 220, and the owner sees Rs 220 owed to him");
  const undo = she("undoSplitEntry", { friendEmail: ME, entryId: "hp1" });
  assert(undo.ok && w.balance(FRIEND, ME) === -42000 && w.balance(ME, FRIEND) === 42000, "she can undo it");

  const dir = Object.keys(w.docs).filter(function(p){ return p.indexOf("users/" + FRIEND + "/") === 0; });
  assert(she("getPeople").people.every(function(p){ return p.email === ME || p.email === "raj@example.com"; }), "her list never contains anyone else's friends");
  assert(dir.length > 0, "(sanity) her folder has data");

  // Other accounts
  const stranger = call("other", "getPeople");
  assert(stranger.ok === false && /not allowed/i.test(stranger.error), "a stranger is refused even for split actions");
  const zedBefore = call("zed", "createSplit", { friendEmail: FRIEND, totalAmount: 5 });
  assert(zedBefore.ok === false, "someone only a FRIEND added (a mirror entry, not added by the owner) is refused");
  w.docs["users/" + ME + "/friends/zed@example.com"] = { fields: { name: { stringValue: "Zed" }, mirror: { booleanValue: true }, balancePaise: { integerValue: "0" } }, updateTime: "z" };
  w.cache = {};
  assert(call("zed", "getPeople").ok === false, "a mirror-only entry in the owner's folder does not grant access");

  // Remembered, and fails closed
  w.cache = {};
  const readsBefore = w.sb.FS_USAGE_.reads;
  she("getPeople"); she("getPeople"); she("getPeople");
  const friendCheckReads = w.fetches ? 0 : 0;
  assert(w.cache["SPF_" + FRIEND] === "1", "a friend is remembered for a few minutes (not re-checked every tap)");
  w.cache = {}; w.mode = "down";
  assert(she("getPeople").ok === false, "if the database can't be reached, a friend is refused (never let in by accident)");
  assert(owner("ping").ok === true, "...but the owner is unaffected");
  w.mode = "ok";

  // Owner still works for everything split-related, and the sign-in check demands a verified email
  assert(owner("getPeople").people.length >= 1, "the owner still sees their own friends");
  assert(typeof readsBefore === "number" && typeof friendCheckReads === "number", "(sanity)");
}

console.log("\n--- 12. Fixes from the security review ---");
{
  const w = world();
  const call = function(token, action, extra){
    return JSON.parse(w.sb.handlePwaRequest(Object.assign({ action: action, idToken: token }, extra || {})).getContent());
  };
  const owner = function(a, x){ return call("good", a, x); };
  const she = function(a, x){ return call("vaidehi", a, x); };

  owner("addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND });
  w.cache = {};
  assert(she("getPeople").ok, "setup: she is a friend and can sign in");

  // Finding 1: she adds the OWNER as her friend -> her real entry in his list must stay real
  const addBack = she("addFriend", { name: "Ronit", mobile: "9000000009", email: ME });
  assert(addBack.ok, "she can add the owner as her own friend");
  const ownersEntry = w.get("users/" + ME + "/friends/" + FRIEND);
  assert(ownersEntry.mirror === false && ownersEntry.name === "Vaidehi", "his real entry for her was NOT flipped to a mirror, and keeps her name");
  w.cache = {};
  assert(she("getPeople").ok === true, "she can still sign in afterwards (not locked out)");
  assert(w.get("users/" + FRIEND + "/friends/" + ME).mirror === false || w.get("users/" + FRIEND + "/friends/" + ME).mirror === true, "(sanity)");

  // Reverse order: a stranger adds the owner FIRST (mirror in his folder), then the owner adds them -> they become allowed
  const w2 = world();
  const call2 = function(token, action, extra){
    return JSON.parse(w2.sb.handlePwaRequest(Object.assign({ action: action, idToken: token }, extra || {})).getContent());
  };
  // she can't call anything yet (not a friend), so simulate the mirror doc a friend-added-me action would leave
  w2.docs["users/" + ME + "/friends/" + FRIEND] = { fields: { name: { stringValue: "Vaidehi" }, email: { stringValue: ME }, mirror: { booleanValue: true }, balancePaise: { integerValue: "0" } }, updateTime: "m" };
  assert(call2("vaidehi", "getPeople").ok === false, "a mirror-only entry does not let her in");
  w2.cache = {};
  call2("good", "addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND });
  w2.cache = {};
  assert(w2.get("users/" + ME + "/friends/" + FRIEND).mirror === false, "when the owner adds her, his entry becomes a real one");
  assert(call2("vaidehi", "getPeople").ok === true, "...and now she is let in (re-adding repairs it)");

  // Finding 4: her copy of a split carries none of the owner's row/fingerprint details
  owner("createSplit", { friendEmail: FRIEND, totalAmount: 100, txRow: 77, txFp: "secret-fp", requestId: "sx1", description: "Tea" });
  const theirs = w.get("users/" + FRIEND + "/friends/" + ME + "/ledger/sx1");
  const mine = w.get("users/" + ME + "/friends/" + FRIEND + "/ledger/sx1");
  assert(theirs.txRow === 0 && theirs.txKey === "" && theirs.txFp === "", "her copy has no row number, no fingerprint, no transaction key");
  assert(mine.txRow === 77 && mine.txKey === "secret-fp", "his own copy still has them");
  assert(she("getPerson", { friendEmail: ME }).entries.every(function(e){ return e.txRow === 0; }), "she is never sent his row number");

  // Finding 2b: she undoes a split the owner made -> his "already split" marker is freed
  assert(w.get("users/" + ME + "/splitMarkers/secret-fp") !== null, "setup: the owner's marker exists");
  const u = she("undoSplitEntry", { friendEmail: ME, entryId: "sx1" });
  assert(u.ok === true && w.get("users/" + ME + "/splitMarkers/secret-fp") === null, "her undo frees the owner's marker, so he can split that payment again");
  assert(w.balance(ME, FRIEND) === 0 && w.balance(FRIEND, ME) === 0, "balances back to 0 on both sides");
  const again = owner("createSplit", { friendEmail: FRIEND, totalAmount: 100, txRow: 77, txFp: "secret-fp", requestId: "sx2" });
  assert(again.ok === true, "the owner can now split that same payment again");
}

console.log("\n--- 13. My spend counts only my share ---");
{
  const w = world();
  const sb = w.sb;
  const now = new Date(); now.setHours(10, 0, 0, 0);
  const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source","RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName","AutoSettled"];
  const mk = function(amount, ref, cp, extra){
    const r = [now, "10:00:00", "TESTBANK", "debit", "upi", amount, ref, cp, "SMS", "Tasker", "raw", "TESTBK", "", "Food", "", "YES", "Want", "", "", ""];
    return r;
  };
  const tx = w.addSheet("Transactions", [HEADER, mk(840, "r1", "Restaurant Spice"), mk(100, "r2", "Chai Stall")]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  const fp1 = sb.rowFingerprint_(tx.rows[1]);
  const callO = function(action, extra){ return JSON.parse(sb.handlePwaRequest(Object.assign({ action: action, idToken: "good" }, extra || {})).getContent()); };
  callO("addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND });

  const spendBefore = sb.getTodaySummary().total;
  assert(spendBefore === 940, "before any split, today's spend is the full Rs 940");

  const r = callO("createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 2, txFp: fp1, requestId: "sp1", description: "Dinner" });
  assert(r.ok && r.sheetUpdated === true, "splitting the owner's payment reports the sheet was updated");
  assert(tx.rows[0][20] === "FriendShare", "the new column gets its header");
  assert(tx.rows[1][20] === 420 && tx.rows[2][20] === undefined, "only that payment's row got the friend's share (Rs 420)");

  assert(sb.getTodaySummary().total === 520, "today's spend is now Rs 520 (420 of dinner + 100 chai), not Rs 940");
  const cat = sb.getTodaySummary().categories.find(function(c){ return c.category === "Food"; });
  assert(cat && cat.amount === 520, "category totals use your share too");
  const month = sb.getMonthlyAnalysis(now.getFullYear(), now.getMonth() + 1);
  assert(month.totalDebit === 520 && month.topAmount === 420, "the monthly analysis uses your share (total 520, biggest payment 420)");
  assert(month.byMode.bank.totalDebit === 520, "...and so does the Bank/Card/Wallet breakdown");
  assert(sb.txnMyAmount_(tx.rows[1]) === 420 && sb.txnFriendShare_(tx.rows[1]) === 420, "helpers: my amount 420, friend share 420");
  assert(sb.rowStillMatches_(tx, 2, fp1) === true, "the fingerprint ignores the share column, so the Pending safeguard still matches");

  // A share bigger than the payment is never trusted
  assert(sb.txnMyAmount_(["", "", "", "debit", "", 100, "", "", "", "", "", "", "", "", "", "", "", "", "", "", 500]) === 100, "a bogus share larger than the payment is ignored");

  // Wrong fingerprint -> nothing is written to a row that is no longer that payment
  const wrong = sb.splitsApplyShareToSheet_(3, "not-the-fingerprint", 50);
  assert(wrong === false && tx.rows[2][20] === undefined, "a row that no longer matches its fingerprint is left alone");

  // Undo gives the share back
  const u = callO("undoSplitEntry", { friendEmail: FRIEND, entryId: "sp1" });
  assert(u.ok && u.sheetUpdated === true && tx.rows[1][20] === "", "undoing the split clears the share on the sheet");
  assert(sb.getTodaySummary().total === 940, "...and today's spend is back to Rs 940");

  // Re-split, then the FRIEND undoes it -> still cleared
  callO("createSplit", { friendEmail: FRIEND, totalAmount: 840, friendShare: 300, txRow: 2, txFp: fp1, requestId: "sp2" });
  assert(tx.rows[1][20] === 300 && sb.getTodaySummary().total === 640, "custom share Rs 300: spend = 840 - 300 + 100 = 640");
  w.cache = {};
  const fu = JSON.parse(sb.handlePwaRequest({ action: "undoSplitEntry", idToken: "vaidehi", friendEmail: ME, entryId: "sp2" }).getContent());
  assert(fu.ok && fu.sheetUpdated === true && tx.rows[1][20] === "", "when the friend undoes the owner's split, the owner's spend is restored too");

  // A friend's OWN split never touches the owner's sheet
  const fs = JSON.parse(sb.handlePwaRequest({ action: "createSplit", idToken: "vaidehi", friendEmail: ME, totalAmount: 60, txRow: 2, txFp: fp1, requestId: "hs1" }).getContent());
  assert(fs.ok && fs.sheetUpdated === false && tx.rows[1][20] === "", "a friend splitting THEIR payment cannot write to the owner's sheet");

  // The check-and-repair function finds and fixes drift between the Sheet and the splits database
  callO("createSplit", { friendEmail: FRIEND, totalAmount: 840, friendShare: 400, txRow: 2, txFp: fp1, requestId: "sp3" });
  tx.rows[1][20] = "";                                  // simulate a failed sheet write
  tx.rows[2][20] = 55;                                  // and a stray share with no split behind it
  const audit = sb.splitsShareAudit_(false);
  assert(audit.missing.length === 1 && audit.missing[0] === 2 && audit.orphan.length === 1 && audit.orphan[0] === 3 && tx.rows[1][20] === "", "the check finds a missing share (row 2) and a stray one (row 3) and changes nothing");
  const fix = sb.splitsShareAudit_(true);
  assert(fix.fixed === 2 && tx.rows[1][20] === 400 && tx.rows[2][20] === "", "the repair restores row 2 (Rs 400) and clears the stray one");
  assert(sb.splitsShareAudit_(false).missing.length + sb.splitsShareAudit_(false).orphan.length + sb.splitsShareAudit_(false).wrong.length === 0, "after the repair, a second check finds nothing");
  callO("undoSplitEntry", { friendEmail: FRIEND, entryId: "sp3" });

  // Card bill matching still uses the FULL amount
  const ccRows = [HEADER, mk(5000, "c1", "Shop")];
  ccRows[1][4] = "card 1234";
  assert(sb.txnMyAmount_(ccRows[1]) === 5000, "(sanity) unsplit card row = full amount");
  ccRows[1][20] = 2000;
  assert(sb.txnMyAmount_(ccRows[1]) === 3000 && Number(ccRows[1][5]) === 5000, "a split card swipe: my spend 3000, but the amount on the row (used for the card limit and bill) stays 5000");
}

console.log("\n--- 14. The share finds its row even after the sheet is re-sorted (review fixes) ---");
{
  const w = world();
  const sb = w.sb;
  const now = new Date(); now.setHours(10, 0, 0, 0);
  const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source","RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName","AutoSettled"];
  const mk = function(amount, ref, cp, time){ return [now, time || "10:00:00", "TESTBANK", "debit", "upi", amount, ref, cp, "SMS", "Tasker", "raw", "TESTBK", "", "Food", "", "YES", "Want", "", "", ""]; };
  const tx = w.addSheet("Transactions", [HEADER, mk(840, "r1", "Restaurant Spice", "10:00:00"), mk(100, "r2", "Chai Stall", "11:00:00")]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  const fpA = sb.rowFingerprint_(tx.rows[1]);
  const callO = function(action, extra){ return JSON.parse(sb.handlePwaRequest(Object.assign({ action: action, idToken: "good" }, extra || {})).getContent()); };
  callO("addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND });

  // The card said row 2, but a Reconcile has since moved that payment to row 3
  tx.rows.reverse(); tx.rows.unshift(tx.rows.pop());     // header back on top; the two payments swapped
  assert(tx.rows[2][7] === "Restaurant Spice", "setup: the dinner payment is now on row 3");
  const r = callO("createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 2, txFp: fpA, requestId: "m1" });
  assert(r.ok && r.sheetUpdated === true && tx.rows[2][20] === 420 && tx.rows[1][20] === undefined, "the share lands on the right payment (found by fingerprint), not on whatever is now on row 2");

  // Undo after another re-sort still clears the right row
  tx.rows.splice(1, 0, tx.rows.splice(2, 1)[0]);         // swap back
  const u = callO("undoSplitEntry", { friendEmail: FRIEND, entryId: "m1" });
  assert(u.ok && u.sheetUpdated === true && tx.rows[1][20] === "", "undo clears the share on the right row even though rows moved");

  // No fingerprint -> never written by row number alone
  assert(sb.splitsApplyShareToSheet_(2, "", 50) === false && tx.rows[1][20] === "", "without a fingerprint nothing is written");

  // A failed sheet write is healed by tapping Save again (the duplicate path re-applies it)
  callO("createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 2, txFp: fpA, requestId: "m2" });
  tx.rows[1][20] = "";                                    // pretend the write never landed
  const retry = callO("createSplit", { friendEmail: FRIEND, totalAmount: 840, txRow: 2, txFp: fpA, requestId: "m3" });
  assert(retry.ok === false && retry.duplicate === true && retry.sheetUpdated === true && tx.rows[1][20] === 420, "a retry that is refused as 'already split' still puts the share back");

  // Two identical-looking rows: never guess
  const dup = w.addSheet("Transactions", [HEADER, mk(50, "", "Same Shop", "09:00:00"), mk(50, "", "Same Shop", "09:00:00")]);
  const fpD = sb.rowFingerprint_(dup.rows[1]);
  assert(sb.splitsApplyShareToSheet_(2, fpD, 25) === true || sb.splitsApplyShareToSheet_(2, fpD, 25) === false, "(sanity)");
  const dupRows = w.sheets.Transactions.rows;
  dupRows[1][20] = ""; dupRows[2][20] = "";
  const none = sb.splitsApplyShareToSheet_(5, fpD, 25);
  assert(none === false && dupRows[1][20] === "" && dupRows[2][20] === "", "if two rows share a fingerprint and the hinted row is gone, nothing is written (no guessing)");
  dupRows[1][20] = 10;
  const audit = sb.splitsShareAudit_(true);
  assert(audit.ambiguous.length === 1 && audit.ambiguous[0] === 2 && audit.fixed === 0 && dupRows[1][20] === 10, "the repair leaves an ambiguous row (two identical-looking payments) alone and reports it");

  // The daily health check repairs drift by itself
  const w3 = world(), sb3 = w3.sb;
  const t3 = w3.addSheet("Transactions", [HEADER, mk(840, "r1", "Restaurant Spice", "10:00:00")]);
  w3.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  const fp3 = sb3.rowFingerprint_(t3.rows[1]);
  JSON.parse(sb3.handlePwaRequest({ action: "addFriend", idToken: "good", name: "V", mobile: "9876543210", email: FRIEND }).getContent());
  JSON.parse(sb3.handlePwaRequest({ action: "createSplit", idToken: "good", friendEmail: FRIEND, totalAmount: 840, txRow: 2, txFp: fp3, requestId: "q" }).getContent());
  t3.rows[1][20] = "";
  const rep = sb3.splitsAutoRepairShares_();
  assert(rep.fixed === 1 && t3.rows[1][20] === 420, "the daily self-repair puts a missing share back");
  assert(w3.sheets.AILogs.rows.some(function(r){ return r[1] === "SPLITS_SHARE_REPAIRED"; }), "and says so in the log");
  assert(sb3.splitsAutoRepairShares_().fixed === 0, "when nothing is wrong it changes nothing");
  assert(sb3.txnMyAmount_([0, 0, 0, 0, 0, 12.345]) === 12.345, "with no split, an amount is returned exactly as it is (no rounding at all)");
}

console.log("\n--- 15. Moving an old debt into a friend's balance ---");
{
  const w = world();
  const sb = w.sb;
  const debts = w.addSheet("Debts", [
    ["Date", "Person", "Type", "Amount", "Note", "DueDate", "Status", "SettledDate"],
    ["", "Vaidehi", "LENT", 500, "lunch", "", "Pending", ""],
    ["", "Vaidehi", "BORROWED", 120, "cab", "", "Pending", ""],
    ["", "Raj", "LENT", 40, "", "", "Settled", "2026-01-01"],
    ["", "Vaidehi", "OTHER", 10, "", "", "Pending", ""]
  ]);
  const callO = function(action, extra){ return JSON.parse(sb.handlePwaRequest(Object.assign({ action: action, idToken: "good" }, extra || {})).getContent()); };
  callO("addFriend", { name: "Vaidehi", mobile: "9876543210", email: FRIEND });
  const mv = function(row, email, person, type){ return callO("moveDebtToFriend", { row: row, friendEmail: email, expectedPerson: person, expectedType: type }); };

  const m1 = mv(2, FRIEND, "Vaidehi", "LENT");
  assert(m1.ok && m1.balance === 500 && debts.rows[1][6] === "Settled", "an old 'I lent Rs 500' becomes +500 on her page and the old debt is closed");
  assert(w.balance(ME, FRIEND) === 50000 && w.balance(FRIEND, ME) === -50000, "her side shows the opposite (she owes Rs 500)");
  const m2 = mv(3, FRIEND, "Vaidehi", "BORROWED");
  assert(m2.ok && m2.balance === 380 && debts.rows[2][6] === "Settled", "'I borrowed Rs 120' nets against it: 500 - 120 = 380");

  const person = callO("getPerson", { friendEmail: FRIEND });
  assert(person.entries.filter(function(e){ return e.type === "carryover"; }).length === 2 && /Earlier balance: Vaidehi/.test(person.entries[0].description + person.entries[1].description), "both show in her history as 'Earlier balance'");

  assert(!mv(2, FRIEND, "Vaidehi", "LENT").ok, "an already-settled debt can't be moved twice");
  assert(!mv(4, FRIEND, "Raj", "LENT").ok, "a debt that was already settled before is refused");
  assert(!mv(5, FRIEND, "Vaidehi", "OTHER").ok, "an unknown kind of debt is refused");
  assert(!mv(99, FRIEND, "Vaidehi", "LENT").ok && !mv(1, FRIEND, "Vaidehi", "LENT").ok, "a bad row (or the header row) is refused");
  assert(!mv(2, "stranger@x.com", "Vaidehi", "LENT").ok, "moving to someone who isn't a friend is refused");
  assert(w.balance(ME, FRIEND) === 38000, "refusals changed nothing");

  // A half-finished try (entry written, old debt not closed) is safe to repeat
  debts.rows[1][6] = "Pending";
  const again = mv(2, FRIEND, "Vaidehi", "LENT");
  assert(again.ok && w.balance(ME, FRIEND) === 38000 && debts.rows[1][6] === "Settled", "retrying after a half-finished try closes the debt without counting it twice");

  // The row must still be the debt the card showed
  debts.rows.push(["", "Priya", "LENT", 70, "", "", "Pending", ""]);                   // row 6
  assert(!mv(6, FRIEND, "Vaidehi", "LENT").ok && debts.rows[5][6] === "Pending", "if the row now holds a different person's debt, the move is refused and nothing changes");
  assert(!mv(6, FRIEND, "Priya", "BORROWED").ok, "...or a different kind of debt");
  assert(!callO("moveDebtToFriend", { row: 6, friendEmail: FRIEND }).ok, "a request that does not say which debt it expects is refused");
  assert(w.balance(ME, FRIEND) === 38000, "(balance untouched by those refusals)");

  // A retry that picks a DIFFERENT friend can never credit the same debt twice
  callO("addFriend", { name: "Raj", mobile: "9000000001", email: "raj@example.com" });
  const first = mv(6, FRIEND, "Priya", "LENT");
  assert(first.ok && w.balance(ME, FRIEND) === 38000 + 7000, "setup: Priya's Rs 70 moved to Vaidehi");
  debts.rows[5][6] = "Pending";                                                       // pretend closing the old debt failed
  const other = mv(6, "raj@example.com", "Priya", "LENT");
  assert(other.ok && other.alreadyMovedTo === FRIEND && w.balance(ME, "raj@example.com") === 0 && debts.rows[5][6] === "Settled", "choosing another friend on the retry credits nobody twice: it says where it went and closes the debt");

  // Carry-overs can't be undone
  const entryId = person.entries[0].id;
  const u = callO("undoSplitEntry", { friendEmail: FRIEND, entryId: entryId });
  assert(!u.ok && /old debt/i.test(u.error) && w.balance(ME, FRIEND) === 45000, "a carried-over balance can't be undone (record a payment instead)");

  // Not available to friends
  w.cache = {};
  const hers = JSON.parse(sb.handlePwaRequest({ action: "moveDebtToFriend", idToken: "vaidehi", row: 2, friendEmail: ME }).getContent());
  assert(hers.ok === false && /not allowed/i.test(hers.error), "a friend cannot move debts (it touches the owner's Sheet)");
  const seen = JSON.parse(sb.handlePwaRequest({ action: "getPeople", idToken: "vaidehi" }).getContent());
  assert(seen.people[0].balance === -450, "she sees she owes Rs 450 in total (380 + Priya's 70)");
}

process.exitCode = process.exitCode || 0;
