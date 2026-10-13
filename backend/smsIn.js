// smsIn.js (added 2026-10-14)
//
// PLAIN-ENGLISH WHAT THIS IS: bank SMS landing DIRECTLY in a person's private Firestore space, with no Google Sheet in between.
//
//   The phone sends the raw message + the person's private key to the action "smsIn". This file then:
//     1. finds whose key it is (ingest.js), and checks they are switched on (the owner needs the extra "direct" switch);
//     2. runs the SMS reader's OWN decisions on it (backend/smsPipelineCore.js is a word-for-word copy, proven identical on 2,185 real
//        messages): is it a transaction at all, what are its details, is it junk the person already taught the app to ignore, is it a
//        duplicate of a message already saved (same reference, same text, a statement placeholder, the double card text);
//     3. saves it in THAT person's own Transactions tab. For the owner the row is left "not yet alerted", so the existing timer sends the
//        usual rich notification (guesses, quick-confirm buttons); a friend gets a plain notification straight away.
//
// If anything is not ready the answer says so and the PHONE falls back to the old way (the old SMS reader writing the Sheet), so no
// message can be lost. The owner's direct switch (v2dbEnableOwnerDirect) can be turned off at any time.

var SMSIN_MIN_FINGERPRINT_ = 20;        // same backstop the SMS reader uses for learned-spam patterns

function smsInOwnerDirectOn_(){
  return PropertiesService.getScriptProperties().getProperty("V2DB_OWNER_DIRECT") === "on";
}

// By hand from the editor. The owner must already be on the private copy.
function v2dbEnableOwnerDirect(){
  if(v2EngineFor_(splitsKey_(PWA_ALLOWED_EMAIL)) !== "v2db") throw new Error("Switch the owner onto the private copy first (v2dbEnableOwner).");
  PropertiesService.getScriptProperties().setProperty("V2DB_OWNER_DIRECT", "on");
  return "the owner's bank SMS now land directly in his private copy (the phone falls back to the old way if anything fails)";
}
function v2dbDisableOwnerDirect(){
  PropertiesService.getScriptProperties().deleteProperty("V2DB_OWNER_DIRECT");
  return "the owner's bank SMS go the old way again (through the Sheet)";
}

// Has this person taught the app to ignore a message like this? Only ever asked for an UNCERTAIN message (never a confident
// transaction), exactly like the SMS reader. Reads the person's OWN LearnedSpamPatterns tab.
function smsInMatchesLearnedSpam_(db, sender, sms){
  var sheet = db.getSheetByName("LearnedSpamPatterns");
  if(!sheet || sheet.getLastRow() < 1) return false;
  var incoming = normalizeForFingerprint(sms);
  if(incoming.length < SMSIN_MIN_FINGERPRINT_) return false;
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), 4).getValues();
  for(var i = 0; i < rows.length; i++){
    var template = String(rows[i][2] || "");
    if(template.length < SMSIN_MIN_FINGERPRINT_) continue;
    if(String(rows[i][1] || "") === sender && template === incoming) return true;
  }
  return false;
}

// The phone's call. No sign-in: the KEY is the credential and only ever unlocks its own person's space.
function smsInHandle_(data){
  var email = "";
  try{ email = ingestEmailForKey_(data.key); }catch(e){
    try{ logAI("SMSIN_ERROR", "lookup: " + String(e && e.message).slice(0, 150)); }catch(ignore){}
    return { ok: false, error: "Couldn't check the key. Try again." };
  }
  if(!email) return { ok: false, error: "Unknown key." };
  var isOwner = email === splitsKey_(PWA_ALLOWED_EMAIL);
  if(isOwner && !smsInOwnerDirectOn_()) return { ok: false, error: "Use the old path." };
  if(v2EngineFor_(email) !== "v2db") return { ok: false, error: isOwner ? "Use the old path." : "Full app is not switched on." };

  var sms = String(data.sms === undefined || data.sms === null ? "" : data.sms).slice(0, 2000);
  var sender = String(data.sender === undefined || data.sender === null ? "" : data.sender).slice(0, 60);
  if(!sms.trim()) return { ok: true, outcome: "IGNORED" };
  var ts = Number(data.timestamp);
  var tsSeconds = isFinite(ts) && ts > 0 ? Math.floor(ts) : 0;
  var storedSms = /^[=+\-@]/.test(sms) ? "'" + sms : sms;           // never a spreadsheet formula if the data is ever exported

  var cache = null;
  try{ cache = CacheService.getScriptCache(); }catch(ignore){}
  var perDay = "SMSIN_N_" + email + "_" + Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd");
  try{ if(cache && Number(cache.get(perDay) || 0) >= 400) return { ok: false, error: "Too many messages for now." }; }catch(ignoreLimit){}

  var lock = LockService.getScriptLock();
  var attempt = function(){
    return v2dbRun_(email, function(db){
      v2dbEnsureTemplate_(db);
      var detail = SmsPipeline.classifyDetail(sms, sender);
      var kind = detail.result;
      if(kind === "IGNORE") return { ok: true, outcome: "IGNORED", reason: detail.reason || "" };
      if(kind === "UNCERTAIN" && smsInMatchesLearnedSpam_(db, sender, sms)) return { ok: true, outcome: "IGNORED", reason: "learned" };

      var tx = SmsPipeline.ruleParser(sms, sender);
      if(kind === "UNCERTAIN") tx.counterparty = "NEEDS REVIEW: " + (tx.counterparty || "unrecognized message");

      var dup = SmsPipeline.isDuplicate(tx, storedSms, tsSeconds);
      if(dup.duplicate) return { ok: true, outcome: "DUPLICATE", reason: dup.reason || "" };

      var when = tsSeconds ? new Date(tsSeconds * 1000) : new Date();
      var amount = Number(tx.amount);
      db.getSheetByName("Transactions").appendRow([
        Utilities.formatDate(when, "Asia/Kolkata", "yyyy-MM-dd"), Utilities.formatDate(when, "Asia/Kolkata", "HH:mm:ss"),
        tx.bank || "", tx.type || "", tx.mode || "", isFinite(amount) && amount > 0 ? amount : (tx.amount || ""), tx.reference || "", tx.counterparty || "",
        "SMS", "Phone", storedSms, sender,
        "", "", "", isOwner ? "" : "YES",                           // Processed: the owner's timer alerts it; a friend is alerted below
        "", "", "", "", ""
      ]);
      if(!isOwner){
        try{ sendPushNotification("New transaction", (amount > 0 ? "₹" + amount : "A transaction") + (tx.counterparty ? " - " + tx.counterparty : "")); }catch(ignorePush){}
      }
      return { ok: true, outcome: kind === "UNCERTAIN" ? "UNCERTAIN_SAVED" : "SAVED", _tx: tx };
    }, { prefetch: ["Transactions", "LearnedSpamPatterns", "_Props"] });
  };

  try{
    lock.waitLock(25000);
    var out;
    try{ out = attempt(); }
    catch(e){ if(e && e.v2dbConflict) out = attempt(); else throw e; }
    if(out && (out.outcome === "SAVED" || out.outcome === "UNCERTAIN_SAVED")){
      try{ if(cache) cache.put(perDay, String(Number(cache.get(perDay) || 0) + 1), 21600); }catch(ignoreBump){}
      var tx2 = out._tx || {};
      if(typeof smsFormatRecord_ === "function"){
        smsFormatRecord_({ sender: sender, sms: sms, bank: tx2.bank, type: tx2.type, mode: tx2.mode, amount: tx2.amount, reference: tx2.reference, counterparty: tx2.counterparty });
      }
    }
    return { ok: true, outcome: out.outcome, reason: out.reason || "" };
  }catch(err){
    try{ logAI("SMSIN_ERROR", "save: " + String(err && err.message).slice(0, 200)); }catch(ignore){}
    return { ok: false, error: "Couldn't save. Try again." };
  }finally{
    try{ lock.releaseLock(); }catch(ignore){}
  }
}
