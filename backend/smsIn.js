// smsIn.js (added 2026-10-14)
//
// PLAIN-ENGLISH WHAT THIS IS: bank SMS landing DIRECTLY in a person's private Firestore space, with no Google Sheet in between.
//
//   The phone sends the raw message + the person's private key to the action "smsIn". This file then:
//     1. finds whose key it is (ingest.js), and checks they are switched on (the owner needs the extra "direct" switch);
//     2. runs the SMS reader's OWN decisions on it (backend/smsPipelineCore.js is a word-for-word copy, proven identical on 2,185 real
//        messages): is it a transaction at all, what are its details, is it junk the person already taught the app to ignore, is it a
//        duplicate of a message already saved (same reference, same text, a statement placeholder, the double card text);
//     3. saves it in THAT person's own Transactions tab. A friend gets a plain notification straight away. The owner gets the usual RICH
//        notification (guesses, quick-confirm buttons) straight away too (added 2026-10-16, "instant alert"): right after the row is saved
//        and the save lock is released, the very same alert step the 5-minute timer runs (processNewTransactionsCore_) runs once, here. If it
//        cannot (not on the new server, switch off, short of time, lock busy, any error) the row is simply left "not yet alerted" and the
//        timer alerts it on its next tick, exactly as before: the timer is now only the safety net.
//
// If anything is not ready the answer says so and the PHONE falls back to the old way (the old SMS reader writing the Sheet), so no
// message can be lost. The owner's direct switch (v2dbEnableOwnerDirect) can be turned off at any time.

var SMSIN_MIN_FINGERPRINT_ = 20;        // same backstop the SMS reader uses for learned-spam patterns

function smsInOwnerDirectOn_(){
  return flagOn_("V2DB_OWNER_DIRECT");
}

// By hand from the editor. The owner must already be on the private copy.
function v2dbEnableOwnerDirect(){
  if(v2EngineFor_(splitsKey_(PWA_ALLOWED_EMAIL)) !== "v2db") throw new Error("Switch the owner onto the private copy first (v2dbEnableOwner).");
  var copied = smsInCopyLearnedJunk_();
  flagsSet_({ V2DB_OWNER_DIRECT: "on" });                      // the shared switch: both servers see it
  return "the owner's bank SMS now land directly in his private copy (the phone falls back to the old way if anything fails); " + copied + " junk pattern(s) copied across";
}
// Junk patterns the owner taught the app since his data was imported live only in the Sheet's tab; the new path reads his private tab.
// Copies any that are missing (same sender + same template = already there). Returns how many were added.
function smsInCopyLearnedJunk_(){
  var real = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LearnedSpamPatterns");
  if(!real || real.getLastRow() < 1) return 0;
  var added = 0;
  v2dbRun_(splitsKey_(PWA_ALLOWED_EMAIL), function(db){
    var mine = db.getSheetByName("LearnedSpamPatterns") || db.insertSheet("LearnedSpamPatterns");
    var have = {};
    if(mine.getLastRow() > 0) mine.getRange(1, 1, mine.getLastRow(), 4).getValues().forEach(function(r){ have[String(r[1]) + "|" + String(r[2])] = true; });
    real.getRange(1, 1, real.getLastRow(), 4).getValues().forEach(function(r){
      var k = String(r[1]) + "|" + String(r[2]);
      if(String(r[2]).length >= SMSIN_MIN_FINGERPRINT_ && !have[k]){ mine.appendRow(r); have[k] = true; added++; }
    });
  });
  return added;
}

function v2dbDisableOwnerDirect(){
  flagsSet_({ V2DB_OWNER_DIRECT: null });
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

// Banks the owner taught the app from the Access screen (Firestore _system/bankSenders = { TOKEN: "BANK" }), remembered for 10 minutes.
// Handed to the SMS decision code so a new bank's sender is recognised without any code change.
function smsInLoadTaughtBanks_(){
  var map = {};
  try{
    var cache = CacheService.getScriptCache();
    var cached = cache ? cache.get("SMSIN_BANKS") : null;
    if(cached !== null && cached !== undefined){ map = JSON.parse(cached); }
    else{
      var doc = fsGetPathMeta_("_system/bankSenders");
      map = doc && doc.fields && doc.fields.map ? JSON.parse(String(doc.fields.map)) : {};
      if(cache) cache.put("SMSIN_BANKS", JSON.stringify(map), 600);
    }
  }catch(err){ map = {}; }
  SmsPipeline.setExtraSenders(map);
  return map;
}

// The token a sender is taught by: "VM-BOBSMS-S" -> "BOBSMS", "JD-JioPay-S" -> "JIOPAY". Empty if it cannot be told.
function smsInSenderToken_(sender){
  var t = String(sender || "").trim().toUpperCase().replace(/^[A-Z]{2}-/, "").replace(/-[A-Z]$/, "");
  return /^[A-Z0-9]{3,20}$/.test(t) ? t : "";
}

// Owner-only (Access screen): teach / forget a bank. Saved in Firestore so the new SMS path uses it within 10 minutes.
function smsInTeachBank_(sender, bank, forget){
  var token = /^[A-Z0-9]{3,20}$/.test(String(sender || "").toUpperCase()) ? String(sender).toUpperCase() : smsInSenderToken_(sender);
  if(!token) return { ok: false, error: "That sender name is not usable." };
  var name = String(bank || "").trim().toUpperCase();
  if(!forget && !/^[A-Z0-9 &.\-]{2,30}$/.test(name)) return { ok: false, error: "Type the bank's name (letters and numbers, up to 30)." };
  var doc = fsGetPathMeta_("_system/bankSenders");
  var map = {};
  try{ map = doc && doc.fields && doc.fields.map ? JSON.parse(String(doc.fields.map)) : {}; }catch(e){ map = {}; }
  if(forget) delete map[token]; else map[token] = name;
  if(Object.keys(map).length > 200) return { ok: false, error: "Too many taught banks." };
  fsCommit_([{ set: { path: "_system/bankSenders", fields: { map: JSON.stringify(map), updatedAtMs: Date.now() } } }]);
  try{ CacheService.getScriptCache().remove("SMSIN_BANKS"); }catch(ignore){}
  return { ok: true, token: token, taught: map };
}

// The phone's call. Saves the message (smsInSave_), and for the OWNER then sends the alert at once (smsInAlertNow_).
function smsInHandle_(data){
  var startedAt = Date.now();
  var out = smsInSave_(data);
  var adm = out && out.admin;
  if(out) delete out.admin;                                     // internal note for the admin counters, never sent to the phone
  if(out && out.alertOwner){
    delete out.alertOwner;                                      // internal note, never sent to the phone
    smsInAlertNow_(startedAt);                                  // after the save lock is released; can never change the answer to the phone
  }
  // Admin counters (adminStats.js): how this message was understood. Counts only. After the save lock is released and after the alert,
  // best-effort: it can never change the answer or delay the notification.
  if(adm && typeof adminRecordSms_ === "function"){ try{ adminRecordSms_(adm.email, adm.outcome, adm.tx, adm.sender); }catch(ignoreAdmin){} }
  return out;
}

var SMSIN_ALERT_BUDGET_MS_ = 10000;     // only start the instant alert if the save took less than this (the phone waits 30 s in all)
var SMSIN_ALERT_LOCK_WAIT_MS_ = 8000;   // wait at most this long for the save lock; the timer will do it if the lock is busy

// INSTANT ALERT (2026-10-16). Runs the timer's own alert step for the owner's new row(s). NEW SERVER ONLY, and only while the new-server
// timer switch is on (the same switch: turning it off turns this off too). Never throws and never delays the answer past the budget.
// Safe to run together with the timer: both go through the same save lock and the same "Processed" mark, so a row is announced once.
function smsInAlertNow_(startedAt){
  var result = "", alertMs = 0;
  try{
    if(typeof V2_ON_NEW_SERVER_ === "undefined" || !V2_ON_NEW_SERVER_) return;
    if(typeof fnTimerOn_ !== "function" || !fnTimerOn_()) return;
    if(Date.now() - startedAt > SMSIN_ALERT_BUDGET_MS_){ result = "skipped"; logAI("SMSIN_ALERT_SKIPPED", "save took " + (Date.now() - startedAt) + " ms; the timer will alert it"); return; }
    var t0 = Date.now();
    v2OwnerTakeOver_(processNewTransactionsCore_, SMSIN_ALERT_LOCK_WAIT_MS_);
    TXN_PUBLISH_NOW_ = false;                                   // the Home copy is rebuilt by the timer's next tick (it was marked changed), not here
    alertMs = Date.now() - t0;
    result = "ok";
    logAI("SMSIN_ALERT", "alerted in " + alertMs + " ms (total " + (Date.now() - startedAt) + " ms)");
  }catch(err){
    result = "error";
    try{ logAI("SMSIN_ALERT_ERROR", String(err && err.message).slice(0, 200) + " - the timer will alert it"); }catch(ignore){}
  }finally{
    // Leave the timing where it can be READ later (the log viewer is not always reachable): the last instant alert's result and times,
    // in the timer's own document (merged, so the tick's fields are untouched). One small write; best-effort.
    if(result && typeof timerWrite_ === "function"){
      timerWrite_({ lastInstantResult: result, lastInstantAtMs: Date.now(), lastInstantAlertMs: alertMs, lastInstantTotalMs: Date.now() - startedAt });
    }
  }
}

// The save itself. No sign-in: the KEY is the credential and only ever unlocks its own person's space.
function smsInSave_(data){
  var cacheBad = ingestCache_();
  // Wrong keys cost the caller nothing (the address is public), so refuse after a burst WITHOUT reading the database.
  if(ingestCount_(cacheBad, "ING_BAD") >= INGEST_MAX_BAD_PER_MIN_) return { ok: false, error: "Unknown key. Too many tries." };
  var email = "";
  try{ email = ingestEmailForKey_(data.key); }catch(e){
    try{ logAI("SMSIN_ERROR", "lookup: " + String(e && e.message).slice(0, 150)); }catch(ignore){}
    return { ok: false, error: "Couldn't check the key. Try again." };
  }
  if(!email){ ingestBump_(cacheBad, "ING_BAD", 60); return { ok: false, error: "Unknown key." }; }
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

  smsInLoadTaughtBanks_();                                      // the banks taught from the Access screen (cached)
  var lock = sharedLock_({ failOpen: true });         // a bank SMS must never be dropped because of the lock (sharedLock.js)
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
    lock.waitLock(20000);                                      // less than the phone's 30 s wait, so a slow save never outlives the phone's patience
    var out;
    try{ out = attempt(); }
    catch(e){ if(e && e.v2dbConflict) out = attempt(); else throw e; }
    if(out && (out.outcome === "SAVED" || out.outcome === "UNCERTAIN_SAVED")){
      try{ if(cache) cache.put(perDay, String(Number(cache.get(perDay) || 0) + 1), 21600); }catch(ignoreBump){}
      if(isOwner && typeof timerMarkDirty_ === "function") timerMarkDirty_();     // the owner's row still needs its alert: tell the timer (fnTimer.js)
      var tx2 = out._tx || {};
      if(typeof smsFormatRecord_ === "function"){
        smsFormatRecord_({ sender: sender, sms: sms, bank: tx2.bank, type: tx2.type, mode: tx2.mode, amount: tx2.amount, reference: tx2.reference, counterparty: tx2.counterparty });
      }
    }
    var saved = out.outcome === "SAVED" || out.outcome === "UNCERTAIN_SAVED";
    var answer = { ok: true, outcome: out.outcome, reason: out.reason || "" };
    if(saved && isOwner) answer.alertOwner = true;               // internal: smsInHandle_ removes it before replying
    answer.admin = { email: email, outcome: out.outcome, tx: out._tx || {}, sender: sender };   // internal: removed by smsInHandle_ (adminStats.js)
    return answer;
  }catch(err){
    try{ logAI("SMSIN_ERROR", "save: " + String(err && err.message).slice(0, 200)); }catch(ignore){}
    return { ok: false, error: "Couldn't save. Try again." };
  }finally{
    try{ lock.releaseLock(); }catch(ignore){}
  }
}
