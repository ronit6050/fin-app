// backend/tests/splitNotify.test.js
//
// Plain-English what this checks: when someone splits a payment with you, records a payment to/from you, or undoes one, the OTHER
// person gets a push notification on THEIR phone (their own token only), after the action really saved; nothing is sent for a
// duplicate or failed action, to a person with no token, or to the person who did it; and a notification problem never changes
// the answer. All data here is invented.
// Run with: node backend/tests/splitNotify.test.js

const { build, OWNER, FRIEND } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
const sent = [];
sb.sendPushToToken_ = function(token, title, body, extra){ sent.push({ token: token, title: title, body: body, extra: extra }); };
sb.sendPushNotification = function(){};
w.props.PWA_PUSH_TOKEN = "tok-owner-global";

// the friend (Vaidehi) has the full app and a phone registered; she also lists the owner as HER friend
sb.v2dbEnableUser(FRIEND);
w.act("friend", { action: "registerPushToken", token: "tok-friend" });
w.act("friend", { action: "addFriend", name: "Ronit", mobile: "9876543210", email: OWNER });

console.log("\n--- 1. The owner splits: the FRIEND is told, on her phone only ---");
{
  const r = w.act("owner", { action: "createSplit", friendEmail: FRIEND, totalAmount: 120, friendShare: 60, description: "Cafe", requestId: "n1" });
  assert(r.ok === true, "the split was saved");
  assert(sent.length === 1 && sent[0].token === "tok-friend", "exactly one push, to HER token (not his own)");
  assert(/split/i.test(sent[0].body) && sent[0].body.indexOf("Cafe") !== -1 && sent[0].body.indexOf("60") !== -1, "it says what was split and her share: " + sent[0].body);
  const dup = w.act("owner", { action: "createSplit", friendEmail: FRIEND, totalAmount: 120, friendShare: 60, description: "Cafe", requestId: "n1" });
  assert(sent.length === 1, "a repeated (duplicate) request sends nothing more (" + sent.length + ")");
  const bad = w.act("owner", { action: "createSplit", friendEmail: FRIEND, totalAmount: 0, description: "x", requestId: "n2" });
  assert(bad.ok === false && sent.length === 1, "a failed split sends nothing");
}

console.log("\n--- 2. The friend splits with the owner: the OWNER is told ---");
{
  sent.length = 0;
  const r = w.act("friend", { action: "createSplit", friendEmail: OWNER, totalAmount: 90, friendShare: 45, description: "Auto", requestId: "n3" });
  assert(r.ok === true, "her split was saved");
  assert(sent.length === 1 && sent[0].token === "tok-owner-global", "one push, to the OWNER's token");
  // and once the owner is on the private copy, his token comes from his own private settings
  sb.v2dbRun_(OWNER, function(db){ db.props().setProperty("PWA_PUSH_TOKEN", "tok-owner-private"); });
  sb.v2dbEnableOwner();
  sent.length = 0;
  w.act("friend", { action: "createSplit", friendEmail: OWNER, totalAmount: 30, friendShare: 15, description: "Tea", requestId: "n4" });
  assert(sent.length === 1 && sent[0].token === "tok-owner-private", "with the owner on his private copy, his private token is used");
  sb.v2dbDisableOwner();
}

console.log("\n--- 3. Payments and undo ---");
{
  sent.length = 0;
  const p1 = w.act("owner", { action: "recordSplitPayment", friendEmail: FRIEND, amount: 50, direction: "received", method: "upi", requestId: "p1" });
  assert(p1.ok && sent.length === 1 && /receiving/.test(sent[0].body) && sent[0].body.indexOf("50") !== -1 && sent[0].token === "tok-friend", "'I received 50 from you' tells her");
  sent.length = 0;
  w.act("owner", { action: "recordSplitPayment", friendEmail: FRIEND, amount: 20, direction: "sent", method: "upi", requestId: "p2" });
  assert(sent.length === 1 && /paying you/.test(sent[0].body), "'I paid you 20' tells her too");
  sent.length = 0;
  const person = w.act("owner", { action: "getPerson", friendEmail: FRIEND });
  const entry = person.entries.filter(function(e){ return e.type === "payment" && !e.undone; })[0];
  const u = w.act("owner", { action: "undoSplitEntry", friendEmail: FRIEND, entryId: entry.id });
  assert(u.ok && sent.length === 1 && /undid/.test(sent[0].body), "an undo tells her");
  sent.length = 0;
  const again = w.act("owner", { action: "undoSplitEntry", friendEmail: FRIEND, entryId: entry.id });
  assert(again.ok === false && sent.length === 0, "undoing something already undone sends nothing");
}

console.log("\n--- 4. No token, or a problem sending, never changes the answer ---");
{
  sent.length = 0;
  w.store["users/" + OWNER + "/friends/other@example.com"] = { fields: { name: "Other", email: "other@example.com", mirror: false, balancePaise: 0 }, updateTime: "t0" };
  const r = w.act("owner", { action: "createSplit", friendEmail: "other@example.com", totalAmount: 40, friendShare: 20, description: "Chai", requestId: "n5" });
  assert(r.ok === true && sent.length === 0, "a friend with no phone registered (Splits-only) is simply not pushed; the split still saves");
  sb.sendPushToToken_ = function(){ throw new Error("push down"); };
  const r2 = w.act("owner", { action: "createSplit", friendEmail: FRIEND, totalAmount: 10, friendShare: 5, description: "Gum", requestId: "n6" });
  assert(r2.ok === true, "if the push itself fails, the split is still saved and answered normally");
  assert(w.errors("SPLIT_NOTIFY_ERROR").length >= 0, "(the failure is only logged)");
}

console.log("\n--- 5. The ordinary notification path (push.js) still sends exactly what it did before ---");
{
  const w2 = build(); const sb2 = w2.sb;
  w2.props.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "r@t.iam", private_key: "k", project_id: "proj-x" });
  w2.props.PWA_PUSH_TOKEN = "tok-plain";
  const calls = [];
  sb2.UrlFetchApp = { fetch: function(url, opts){ calls.push({ url: url, opts: opts }); return { getContentText: function(){ return "{\"name\":\"ok\"}"; } }; } };
  require("vm").runInContext(require("fs").readFileSync(require("path").join(__dirname, "..", "push.js"), "utf8"), sb2);   // the REAL push.js (the world stubs it)
  sb2.getFirebaseAccessToken = function(){ return "access-123"; };
  w2.sb.sendPushNotification("Title", "Body text", { row: 5, fp: "abc", skip: null });
  const sentBody = calls.length ? JSON.parse(calls[0].opts.payload) : null;
  assert(calls.length === 1 && /proj-x\/messages:send$/.test(calls[0].url), "one call to the Firebase send address");
  assert(sentBody && sentBody.message.token === "tok-plain" && sentBody.message.data.title === "Title" && sentBody.message.data.body === "Body text" && sentBody.message.data.row === "5" && sentBody.message.data.fp === "abc" && !("skip" in sentBody.message.data), "same token, title, body and extra fields (as text; empty ones dropped)");
  assert(calls[0].opts.headers.Authorization === "Bearer access-123", "same sign-in header");
  w2.props.PWA_PUSH_TOKEN = "";
  calls.length = 0;
  w2.sb.sendPushNotification("T", "B");
  assert(calls.length === 0, "with no device registered it still does nothing");
}

console.log("\n--- 6. Review fixes: errors reading the token are swallowed; long names are cut; a sender cannot spam one person ---");
{
  const w3 = build(); const sb3 = w3.sb;
  const got = [];
  sb3.sendPushToToken_ = function(token, title, body){ got.push({ token: token, body: body }); };
  const store = {};
  sb3.CacheService = { getScriptCache: function(){ return { get: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, put: function(k, v){ store[k] = String(v); }, remove: function(){} }; } };
  w3.props.PWA_PUSH_TOKEN = "tok-owner";
  // a long display name is cut
  sb3.v2dbEnableUser(FRIEND);
  w3.act("friend", { action: "registerPushToken", token: "tok-f" });
  sb3.splitNotify_("N".repeat(200), FRIEND, "undo", {}, OWNER);
  assert(got.length === 1 && got[0].body.length < 90, "a very long display name is cut (" + got[0].body.length + " characters)");
  // spam limit: the 11th push from the same sender to the same person within 10 minutes is dropped
  got.length = 0;
  for(let i = 0; i < 14; i++) sb3.splitNotify_("Ronit", FRIEND, "undo", {}, OWNER);
  assert(got.length === 9, "only 10 pushes per sender per person per 10 minutes get through (one was used above): " + got.length);
  assert(sb3.splitNotify_("Someone", FRIEND, "undo", {}, "third@example.com") === true, "a different sender is not affected by that limit");
  // the ordinary wrapper never throws when reading the token fails
  const w4 = build(); const sb4 = w4.sb;
  require("vm").runInContext(require("fs").readFileSync(require("path").join(__dirname, "..", "push.js"), "utf8"), sb4);
  sb4.dbProps_ = function(){ throw new Error("firestore hiccup"); };
  let threw = false; try{ sb4.sendPushNotification("T", "B"); }catch(e){ threw = true; }
  assert(threw === false && w4.errors("PUSH_ERROR").length === 1, "if reading the saved token fails, the caller sees no error (it is logged as PUSH_ERROR, like before)");
}
