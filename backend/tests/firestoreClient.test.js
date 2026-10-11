// backend/tests/firestoreClient.test.js
//
// Plain-English what this checks: the new Firestore connector (firestore.js)
// and the Home-screen publisher (viewPublisher.js) that now hooks into the
// background check and every data-changing action. All data is invented.
//
// THE PROMISE THIS FILE PROVES (the reason it exists):
//   if Firestore is down, slow, or misconfigured, a transaction is STILL
//   processed, the notification is STILL sent, and a save STILL returns
//   exactly what it would have, with at most one error line in the log.
//
// Also proves: values round-trip through Firestore's typed format; the
// sign-in asks only for the database permission and is remembered; every
// call is counted; the throttle / "changed" flag / 30-minute heartbeat work;
// only data-changing actions publish; oversized screens are refused.
//
// Run with: node backend/tests/firestoreClient.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js",
  "autoSettle.js", "obligationReminders.js", "appHealth.js", "firestore.js", "viewPublisher.js"
];

const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];

function today(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function txn(o){
  return [o.date || today(), "10:00:00", "TESTBANK", o.type || "debit", o.mode || "upi", o.amount, "",
    o.counterparty || "", "SMS", "Tasker", "raw", "TESTBK", "", "", "", "", ""];
}

// A whole fake world: sheets + a fake Google cache + a fake Firestore server.
function world(rows, mode){
  const w = makeWorld(FILES);
  const sb = w.sb;
  w.addSheet("Transactions", [TXN_HEADER].concat(rows || []));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);

  w.props.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "robot@test.iam", private_key: "fake-private-key", project_id: "test-project" });

  w.cache = {};
  sb.CacheService = { getScriptCache: function(){ return {
    get: function(k){ return Object.prototype.hasOwnProperty.call(w.cache, k) ? w.cache[k] : null; },
    put: function(k, v){ w.cache[k] = String(v); },
    remove: function(k){ delete w.cache[k]; }
  }; } };

  const b64 = function(x){ return Buffer.from(typeof x === "string" ? x : Buffer.from(x)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"); };
  sb.Utilities.base64EncodeWebSafe = b64;
  sb.Utilities.computeRsaSha256Signature = function(){ return Buffer.from("signature"); };

  w.mode = mode || "ok";        // ok | fail500 | authfail
  w.fetches = [];
  w.docs = {};
  w.tokens = 0;
  const reply = function(code, obj){ return { getResponseCode: function(){ return code; }, getContentText: function(){ return JSON.stringify(obj); } }; };
  sb.UrlFetchApp = { fetch: function(url, options){
    w.fetches.push({ url: url, options: options || {} });
    if(url.indexOf("oauth2.googleapis.com/token") !== -1){
      if(w.mode === "authfail") return reply(400, { error: "invalid_grant", error_description: "bad key" });
      w.tokens++; return reply(200, { access_token: "token-" + w.tokens });
    }
    if(w.mode === "fail500") return reply(500, { error: { message: "backend exploded" } });
    const m = /documents\/([^/]+)\/([^/?]+)/.exec(url);
    const key = m ? m[1] + "/" + m[2] : "";
    if(options.method === "patch"){
      w.docs[key] = JSON.parse(options.payload).fields;
      return reply(200, { name: key, fields: w.docs[key] });
    }
    if(options.method === "get"){
      return w.docs[key] ? reply(200, { fields: w.docs[key] }) : reply(404, { error: { message: "not found" } });
    }
    return reply(400, { error: { message: "unexpected" } });
  } };

  w.dash = { todaySpend: 100, monthSpend: 5000, pendingCount: 2, recent: [], full: { pending: [] } };
  sb.getDashboardData = function(){ return w.dash; };
  w.errors = function(){ return w.sheets.AILogs.rows.slice(1).filter(function(r){ return r[1] === "V2_PUBLISH_ERROR"; }); };
  w.writes = function(){ return w.fetches.filter(function(f){ return f.options.method === "patch"; }); };
  return w;
}

console.log("\n--- 1. Values survive the round trip through Firestore's format ---");
{
  const w = world();
  const original = { s: "hi", i: 42, f: 1.5, b: true, n: null, when: vm.runInContext('new Date("2026-10-11T00:00:00Z")', w.sb), list: [1, "a", { x: 2 }], nested: { deep: { v: "ok" } } };
  const decoded = w.sb.fsDecodeFields_(w.sb.fsEncodeFields_(original));
  assert(decoded.s === "hi" && decoded.i === 42 && decoded.f === 1.5 && decoded.b === true && decoded.n === null, "plain values round-trip");
  assert(decoded.when === "2026-10-11T00:00:00.000Z", "a date comes back as a timestamp string");
  assert(JSON.stringify(decoded.list) === JSON.stringify([1, "a", { x: 2 }]) && decoded.nested.deep.v === "ok", "lists and nested objects round-trip");
  assert(w.sb.fsEncodeValue_(7).integerValue === "7", "whole numbers are sent as integerValue strings, as Firestore requires");
}

console.log("\n--- 2. Sign-in: right permission only, remembered, never leaks the key ---");
{
  const w = world();
  const t1 = w.sb.fsAccessToken_();
  const t2 = w.sb.fsAccessToken_();
  assert(t1 === "token-1" && t2 === "token-1" && w.tokens === 1, "second call reuses the remembered token (Google asked once)");
  const assertion = w.fetches[0].options.payload.assertion;
  const claim = JSON.parse(Buffer.from(assertion.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert(claim.scope === "https://www.googleapis.com/auth/datastore", "asks ONLY for the database permission, not messaging (got " + claim.scope + ")");
  assert(claim.iss === "robot@test.iam", "signs as the saved robot account");

  const bad = world([], "authfail");
  let msg = "";
  try{ bad.sb.fsAccessToken_(); }catch(e){ msg = e.message; }
  assert(/sign-in failed/i.test(msg) && msg.indexOf("fake-private-key") === -1, "a rejected sign-in throws a plain message without the key (got: " + msg + ")");

  const none = world();
  delete none.props.FIREBASE_SERVICE_ACCOUNT;
  let m2 = "";
  try{ none.sb.fsAccessToken_(); }catch(e){ m2 = e.message; }
  assert(/FIREBASE_SERVICE_ACCOUNT/.test(m2), "no saved key gives a clear message");
}

console.log("\n--- 3. Writing and reading one document ---");
{
  const w = world();
  w.sb.fsSetDocument_("views", "dashboard", { json: "{}", bytes: 2 });
  const call = w.fetches.filter(function(f){ return f.options.method === "patch"; })[0];
  assert(call.url === "https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/views/dashboard", "writes to views/dashboard in the right project (got " + call.url + ")");
  assert(call.options.headers.Authorization === "Bearer token-1", "sends the token");
  assert(JSON.parse(call.options.payload).fields.json.stringValue === "{}", "fields are sent in Firestore's typed format");
  const back = w.sb.fsGetDocument_("views", "dashboard");
  assert(back.json === "{}" && back.bytes === 2, "reads it back as plain values");
  assert(w.sb.fsGetDocument_("views", "nope") === null, "a missing document gives null, not an error");
  assert(w.sb.FS_USAGE_.writes === 1 && w.sb.FS_USAGE_.reads === 2, "every call is counted (writes 1, reads 2)");

  const bad = world([], "fail500");
  let msg = "";
  try{ bad.sb.fsSetDocument_("views", "dashboard", { a: 1 }); }catch(e){ msg = e.message; }
  assert(/HTTP 500/.test(msg) && /backend exploded/.test(msg), "a failed write throws with the HTTP code and Google's reason (got: " + msg + ")");
}

console.log("\n--- 4. The free-allowance meter ---");
{
  const w = world();
  w.props["FS_USAGE_20200101"] = JSON.stringify({ reads: 9, writes: 9, calls: 9 });
  w.sb.fsSetDocument_("views", "a", { x: 1 });
  w.sb.fsGetDocument_("views", "a");
  w.sb.fsFlushUsage_();
  const u = w.sb.fsUsageToday_();
  assert(u.reads === 1 && u.writes === 1 && u.calls >= 3, "today's totals added up (reads 1, writes 1, calls " + u.calls + ")");
  assert(w.props["FS_USAGE_20200101"] === undefined, "old days are forgotten");
  assert(w.sb.FS_USAGE_.reads === 0 && w.sb.FS_USAGE_.writes === 0, "this run's counter is reset after flushing");
  assert(u.readsPct === 0 && u.writesPct === 0, "percent of the free allowance is reported (tiny here)");
  w.props[w.sb.fsTodayKey_()] = JSON.stringify({ reads: 40000, writes: 18000, calls: 1 });
  const hi = w.sb.fsUsageToday_();
  assert(hi.readsPct === 80 && hi.writesPct === 90, "80% of reads / 90% of writes shows as such (got " + hi.readsPct + "/" + hi.writesPct + ")");
}

console.log("\n--- 5. Publishing the Home screen ---");
{
  const w = world();
  assert(w.sb.publishViewsBestEffort_("test", false) === true, "publish succeeds");
  const doc = w.sb.fsDecodeFields_(w.docs["views/dashboard"]);
  assert(doc.json === JSON.stringify(w.dash), "the stored screen is exactly what getDashboard returns");
  assert(doc.bytes === doc.json.length && doc.reason === "test" && doc.version === 2 && typeof doc.updatedAt === "string", "size, reason, version and time are saved with it");

  assert(w.sb.publishViewsBestEffort_("again", false) === false && w.writes().length === 1, "a second publish within 15 seconds is skipped (throttle)");
  assert(w.cache.V2_DIRTY === "1", "...and a 'changed' flag is left so the timer catches up");
  assert(w.sb.publishViewsBestEffort_("forced", true) === true && w.writes().length === 2, "force skips the throttle");
  assert(w.cache.V2_DIRTY === undefined && w.cache.V2_HEARTBEAT === "1", "success clears the flag and starts the 30-minute heartbeat");
}

console.log("\n--- 5b. A change that arrives DURING a publish is not lost ---");
{
  const w = world();
  w.sb.getDashboardData = function(){ w.cache.V2_DIRTY = "1"; return w.dash; };
  w.sb.publishViewsBestEffort_("x", true);
  assert(w.cache.V2_DIRTY === "1", "the 'changed' flag set during the publish is still there afterwards, so the next timer run republishes");
}

console.log("\n--- 6. THE PROMISE: a broken Firestore never breaks anything, and logs once ---");
{
  const w = world([], "fail500");
  let threw = false, r;
  try{ r = w.sb.publishViewsBestEffort_("x", true); }catch(e){ threw = true; }
  assert(!threw && r === false, "a failing publish returns false and does not throw");
  assert(w.errors().length === 1, "exactly one V2_PUBLISH_ERROR line is logged");
  w.cache.V2_THROTTLE && delete w.cache.V2_THROTTLE;
  w.sb.publishViewsBestEffort_("x", true);
  assert(w.errors().length === 1, "a second failure within the hour does not add another log line");

  assert(w.cache.V2_BACKOFF === "1" && w.cache.V2_DIRTY === "1", "a failure leaves a 'changed' flag (copy is stale) and starts a 15-minute backoff");
  const before = w.fetches.length;
  assert(w.sb.publishViewsBestEffort_("timer", false) === false && w.fetches.length === before, "during the backoff the timer makes NO Firestore calls at all");
  delete w.cache.V2_BACKOFF; delete w.cache.V2_THROTTLE;
  w.sb.publishViewsBestEffort_("timer", false);
  assert(w.fetches.length > before, "once the backoff has passed it tries again");

  const multibyte = world();
  multibyte.dash = { blob: "₹".repeat(320000) };
  assert(multibyte.sb.publishViewsBestEffort_("x", true) === false && multibyte.writes().length === 0, "size is counted in BYTES: 320k rupee signs (960 KB) is refused");

  const big = world();
  big.dash = { blob: "x".repeat(950000) };
  assert(big.sb.publishViewsBestEffort_("x", true) === false && big.writes().length === 0, "a screen too big for one document is refused, not truncated");
  assert(big.errors().length === 1 && /too big/.test(big.errors()[0][2]), "...with a clear error line");

  const off = world();
  off.sb.V2_PUBLISH_ENABLED = false;
  assert(off.sb.publishViewsBestEffort_("x", true) === false && off.fetches.length === 0, "the off switch really stops everything");
}

console.log("\n--- 7. The timer: only publishes when something changed or it's been 30 minutes ---");
{
  const w = world();
  assert(w.sb.publishViewsIfNeeded_() === true && w.writes().length === 1, "no heartbeat yet -> publishes once");
  assert(w.sb.publishViewsIfNeeded_() === false && w.writes().length === 1, "heartbeat fresh and nothing changed -> does nothing (no calls at all)");
  w.cache.V2_DIRTY = "1"; delete w.cache.V2_THROTTLE;
  assert(w.sb.publishViewsIfNeeded_() === true && w.writes().length === 2, "a 'changed' flag -> publishes");
}

console.log("\n--- 8. After an action: only data-changing, successful actions publish ---");
{
  const w = world();
  const okResp = { getContent: function(){ return JSON.stringify({ ok: true }); } };
  const badResp = { getContent: function(){ return JSON.stringify({ ok: false, error: "no" }); } };
  w.sb.publishAfterAction_("getPending", okResp);
  w.sb.publishAfterAction_("ping", okResp);
  w.sb.publishAfterAction_("previewSavingsSplit", okResp);
  assert(w.writes().length === 0, "read-only actions never publish");
  w.sb.publishAfterAction_("saveNote", badResp);
  assert(w.writes().length === 0, "a FAILED save does not publish");
  w.sb.publishAfterAction_("saveNote", okResp);
  assert(w.writes().length === 0 && w.cache.V2_DIRTY === "1", "PHASE 1 DEFAULT: a successful save only flags 'changed' (no extra time added to the save)");
  w.sb.V2_PUBLISH_INLINE_AFTER_ACTIONS_ = true;
  w.sb.publishAfterAction_("saveNote", okResp);
  assert(w.writes().length === 1 && w.sb.fsDecodeFields_(w.docs["views/dashboard"]).reason === "action:saveNote", "with the inline switch on, a successful saveNote publishes, labelled with the action");
  const n = w.sb.V2_WRITE_ACTIONS_.length;
  assert(n >= 20 && w.sb.V2_WRITE_ACTIONS_.indexOf("settleDebt") !== -1 && w.sb.V2_WRITE_ACTIONS_.indexOf("getDashboard") === -1, "the list of data-changing actions looks right (" + n + " actions)");
}

console.log("\n--- 9. handlePwaRequest returns the very same response, even if publishing blows up ---");
{
  const w = world();
  const resp = { getContent: function(){ return JSON.stringify({ ok: true }); }, marker: "same-object" };
  w.sb.handlePwaRequestCore_ = function(){ return resp; };
  const out0 = w.sb.handlePwaRequest({ action: "saveNote" });
  assert(out0 === resp && w.writes().length === 0 && w.cache.V2_DIRTY === "1", "default: response untouched, and the screen is just flagged as changed");
  w.sb.V2_PUBLISH_INLINE_AFTER_ACTIONS_ = true; delete w.cache.V2_THROTTLE;
  const out = w.sb.handlePwaRequest({ action: "saveNote" });
  assert(out === resp, "the response object is returned untouched");
  assert(w.writes().length === 1, "with the inline switch on, a publish happens after it");

  const broken = world([], "fail500");
  broken.sb.handlePwaRequestCore_ = function(){ return resp; };
  broken.sb.V2_PUBLISH_INLINE_AFTER_ACTIONS_ = true;
  let threw = false, out2;
  try{ out2 = broken.sb.handlePwaRequest({ action: "saveNote" }); }catch(e){ threw = true; }
  assert(!threw && out2 === resp, "with Firestore broken the save STILL returns its normal response");
  const read = world();
  read.sb.handlePwaRequestCore_ = function(){ return resp; };
  read.sb.handlePwaRequest({ action: "getPending" });
  assert(read.writes().length === 0, "a read action causes no publish through the wrapper either");
}

console.log("\n--- 10. The background check: transactions are STILL processed when Firestore is down ---");
{
  const row = txn({ amount: 55, counterparty: "SOME CORNER SHOP" });

  const ok = world([row]);
  ok.sb.sendPushNotification = function(title, body, extra){ ok.pushes.push({ title: title, body: body, extra: extra || null }); ok.fetchesAtPush = ok.fetches.length; };
  ok.sb.processNewTransactions();
  assert(ok.fetchesAtPush === 0, "the new-transaction notification goes out BEFORE any Firestore call is made");
  assert(ok.sheets.Transactions.rows[1][15] === "YES" && ok.pushes.length === 1, "healthy: the row is processed and the notification sent");
  assert(ok.writes().length >= 1 && ok.sb.fsDecodeFields_(ok.docs["views/dashboard"]).reason === "new-transactions", "...and the Home screen copy is refreshed with reason new-transactions");

  const down = world([row], "fail500");
  let threw = false;
  try{ down.sb.processNewTransactions(); }catch(e){ threw = true; console.error(e); }
  assert(!threw, "Firestore down: processNewTransactions does not throw");
  assert(down.sheets.Transactions.rows[1][15] === "YES", "Firestore down: the row is STILL marked processed");
  assert(down.pushes.length === 1, "Firestore down: the notification is STILL sent");
  assert(down.props.lastCheckedRow === "2", "Firestore down: the bookmark STILL moves forward (got " + down.props.lastCheckedRow + ")");
  assert(down.errors().length >= 1, "Firestore down: the problem is logged");

  const quiet = world([]);
  quiet.sb.processNewTransactions();
  assert(quiet.writes().length === 1 && quiet.sb.fsDecodeFields_(quiet.docs["views/dashboard"]).reason === "timer", "no new rows but no heartbeat yet: one 'timer' publish");
  quiet.sb.processNewTransactions();
  assert(quiet.writes().length === 1, "next run with nothing changed: no Firestore calls at all");
}

console.log("\n--- 11. The health monitor now watches for publish errors ---");
{
  const w = world();
  assert(w.sb.HEALTH_ERROR_LOG_TYPES.indexOf("V2_PUBLISH_ERROR") !== -1, "V2_PUBLISH_ERROR is on the watched list");
}

console.log("\n--- 12. refreshViews: rebuilds the copy now and reports when it started building ---");
{
  const stub = function(w){
    w.sb.verifyGoogleIdToken = function(){ return { email: w.who || "ronitnadar9@gmail.com", name: "T" }; };
    w.sb.jsonResponse = function(o){ return { getContent: function(){ return JSON.stringify(o); } }; };
    return w;
  };
  const call = function(w){ return JSON.parse(w.sb.handlePwaRequest({ action: "refreshViews", idToken: "t" }).getContent()); };
  const w = stub(world());
  const before = Date.now();
  const out = call(w);
  const after = Date.now();
  const doc = w.sb.fsDecodeFields_(w.docs["views/dashboard"]);
  assert(out.ok === true && out.published === true, "refreshViews publishes and says so");
  assert(out.builtAt >= before && out.builtAt <= after, "it reports when the build started (a real moment)");
  assert(doc.builtAt === out.builtAt && doc.reason === "refresh" && doc.version === 2, "the stored copy carries the same builtAt, reason 'refresh', version 2");

  w.cache.V2_THROTTLE = "1";
  const again = call(w);
  assert(again.published === true && again.builtAt >= out.builtAt, "it ignores the 15-second throttle (a save must never wait on it)");

  const down = stub(world([], "fail500"));
  const bad = call(down);
  assert(bad.ok === true && bad.published === false && bad.builtAt === 0, "Firestore down: no crash, published:false, builtAt 0 (the app then asks Apps Script directly)");

  const wrong = stub(world());
  wrong.who = "someone@else.com";
  const no = call(wrong);
  assert(no.ok === false && wrong.writes().length === 0, "another account cannot trigger it");
}

console.log("\nDone.");
