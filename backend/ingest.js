// ingest.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: how a FRIEND's own bank SMS reaches THEIR OWN private space (never the owner's Sheet).
//
//   1. The friend's app asks getMyIngestKey (signed in, full app switched on by the owner) and gets a long private key.
//      The Android app stores it and sends it along with every SMS it forwards to the SMS reader.
//   2. The SMS reader (a separate project) recognises a message with a key, does its usual "is this a transaction and what are
//      its details" work, and hands the finished details to ingestSms below - instead of writing to the owner's Sheet.
//   3. ingestSms looks the key up (only a fingerprint of it is stored in ingestKeys/), finds whose key it is, checks that person
//      still has the full app, and adds the row to THAT person's private Transactions tab - nothing else, ever.
//
// A key can only add transactions to its own person's space. If the owner switches the person off, the key is deleted.
// Stored: ingestKeys/<sha256 of key> = { email }   and   users/<email>/ingest/key = { key }  (readable only by that person).

var INGEST_KEY_RE_ = /^[A-Za-z0-9]{32,80}$/;

function ingestHash_(key){
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key));
  return bytes.map(function(b){ return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

function ingestNewKey_(){
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

// Returns the person's key, creating it the first time. Only for a friend who has the full app.
function ingestGetOrCreateKey_(email){
  var e = splitsKey_(email);
  var mine = fsGetPathMeta_("users/" + e + "/ingest/key");
  if(mine && mine.fields && mine.fields.key && INGEST_KEY_RE_.test(String(mine.fields.key))) return String(mine.fields.key);
  var key = ingestNewKey_();
  fsCommit_([
    { set: { path: "ingestKeys/" + ingestHash_(key), fields: { email: e }, onlyIfNew: true } },
    { set: { path: "users/" + e + "/ingest/key", fields: { key: key } } }
  ]);
  return key;
}

// Deletes the person's key (called when the owner switches them off).
function ingestRevokeKey_(email){
  var e = splitsKey_(email);
  try{
    var mine = fsGetPathMeta_("users/" + e + "/ingest/key");
    var ops = [{ del: { path: "users/" + e + "/ingest/key" } }];
    if(mine && mine.fields && mine.fields.key) ops.push({ del: { path: "ingestKeys/" + ingestHash_(mine.fields.key) } });
    fsCommit_(ops);
  }catch(err){
    try{ logAI("INGEST_ERROR", "revoke: " + String(err && err.message).slice(0, 200)); }catch(ignore){}
  }
}

// Who owns this key? "" if it is not a real key.
function ingestEmailForKey_(key){
  if(!INGEST_KEY_RE_.test(String(key || ""))) return "";
  var doc = fsGetPathMeta_("ingestKeys/" + ingestHash_(key));
  return doc && doc.fields && doc.fields.email ? splitsKey_(doc.fields.email) : "";
}

// Cut to a length, and make sure a value can never act as a spreadsheet formula if it is ever exported (a leading = + - @ gets a ' in front).
function ingestClip_(v, max){
  var t = String(v === undefined || v === null ? "" : v).slice(0, max);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

// Cheap abuse limits, kept in the script's memory (CacheService): too many wrong keys per minute, and too many messages per person.
var INGEST_MAX_BAD_PER_MIN_ = 30;
var INGEST_MAX_PER_PERSON_PER_BLOCK_ = 100;      // per 6-hour block

function ingestCache_(){ try{ return CacheService.getScriptCache(); }catch(e){ return null; } }
function ingestCount_(cache, key){ try{ return cache ? Number(cache.get(key) || 0) : 0; }catch(e){ return 0; } }
function ingestBump_(cache, key, ttl){ try{ if(cache) cache.put(key, String(ingestCount_(cache, key) + 1), ttl); }catch(e){} }

// The SMS reader's call. No sign-in: the KEY is the credential, and it only ever unlocks its own person's space.
function ingestSmsHandle_(data){
  var cache = ingestCache_();
  // Wrong keys are free to try for an attacker (the address is public), so refuse after a burst WITHOUT reading anything.
  if(ingestCount_(cache, "ING_BAD") >= INGEST_MAX_BAD_PER_MIN_) return { ok: false, error: "Unknown key. Too many tries." };
  var email = "";
  try{ email = ingestEmailForKey_(data.key); }catch(e){
    try{ logAI("INGEST_ERROR", "lookup: " + String(e && e.message).slice(0, 200)); }catch(ignore){}
    return { ok: false, error: "Couldn't check the key. Try again." };
  }
  if(!email){ ingestBump_(cache, "ING_BAD", 60); return { ok: false, error: "Unknown key." }; }
  if(email === splitsKey_(PWA_ALLOWED_EMAIL)) return { ok: false, error: "Not for the owner." };       // the owner's SMS never comes this way
  if(v2EngineFor_(email) !== "v2db") return { ok: false, error: "Full app is not switched on." };

  var block = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd") + "_" + Math.floor(Number(Utilities.formatDate(new Date(), "Asia/Kolkata", "HH")) / 6);
  var personKey = "ING_N_" + email + "_" + block;
  if(ingestCount_(cache, personKey) >= INGEST_MAX_PER_PERSON_PER_BLOCK_) return { ok: false, error: "Too many messages for now." };

  var tx = data.tx || {};
  var type = ingestClip_(tx.type, 10).toLowerCase();
  if(type !== "debit" && type !== "credit" && type !== "") type = "";
  var amount = Number(tx.amount);
  var hasAmount = isFinite(amount) && amount > 0;
  var sms = ingestClip_(data.sms, 2000), sender = ingestClip_(data.sender, 60);
  var ts = Number(data.timestamp);
  var when = isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
  var counterparty = ingestClip_(tx.counterparty, 200);
  var reference = ingestClip_(tx.reference, 60);

  var lock = LockService.getScriptLock();
  try{
    lock.waitLock(25000);
    var outcome = v2dbRun_(email, function(db){
      v2dbEnsureTemplate_(db);
      var sheet = db.getSheetByName("Transactions");
      var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues() : [];
      // Same message twice (the app retries, or a resync): exact reference (only a real one) or exact SMS text
      var dup = rows.some(function(r){
        if(reference && String(r[6]) !== "" && String(r[6]).indexOf("NOREF_") !== 0 && String(r[6]) === reference) return true;
        return sms !== "" && String(r[10]) === sms;
      });
      if(dup) return { ok: true, saved: false, duplicate: true };
      ingestBump_(cache, personKey, 21600);
      sheet.appendRow([
        Utilities.formatDate(when, "Asia/Kolkata", "yyyy-MM-dd"), Utilities.formatDate(when, "Asia/Kolkata", "HH:mm:ss"),
        ingestClip_(tx.bank, 40), type, ingestClip_(tx.mode, 40), hasAmount ? amount : "", reference, counterparty,
        "SMS", "Phone", sms, sender, "", "", "", "YES", "", "", "", "", ""        // Processed = YES: alerted below, so Pending lists it
      ]);
      try{
        sendPushNotification("New transaction", (hasAmount ? "₹" + amount : "A transaction") + (counterparty ? " - " + counterparty : ""));
      }catch(ignorePush){}
      return { ok: true, saved: true };
    }, { prefetch: ["Transactions", "_Props"] });
    return outcome;
  }catch(err){
    try{ logAI("INGEST_ERROR", "save: " + String(err && err.message).slice(0, 200)); }catch(ignore){}
    return { ok: false, error: "Couldn't save. Try again." };
  }finally{
    try{ lock.releaseLock(); }catch(ignore){}
  }
}
