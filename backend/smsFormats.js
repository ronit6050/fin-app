// smsFormats.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: a shared library of bank SMS FORMATS, collected automatically from everyone who uses the app, so
// a new bank (say Bank of Baroda for a friend) can be taught to the parser from real examples instead of guesses.
//
// What is kept, per distinct message shape: the sender ID (like HDFCBK), an ANONYMISED template of the text, the bank/mode/type the
// parser worked out, how often it was seen, how often the parser was NOT sure ("uncertain") and how often it missed the amount,
// type, payee or reference. The template has every number, link, payee name and UPI id replaced by a placeholder, so it holds no
// account number, amount, balance, name or phone number. NOTHING links a template to a person: no email, no row, no date of the
// transaction. It lives in Firestore at smsFormats/<hash>, closed to every phone (only the owner's server code reads it).
//
// It is for LEARNING only: the owner (and I, when improving the parser) read it to see which banks/wordings are not understood yet.
// It never changes how a message is parsed by itself.

function smsFormatHash_(text){
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text));
  return bytes.map(function(b){ return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("").slice(0, 40);
}

// The anonymised shape of a message.
function smsFormatTemplate_(sms, counterparty){
  var t = String(sms || "").toLowerCase();
  var payee = String(counterparty || "").toLowerCase().replace(/^needs review:\s*/, "").trim();
  if(payee.length >= 3){
    var esc = payee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(esc, "g"), "<payee>");
  }
  t = t.replace(/[a-z0-9._\-]+@[a-z0-9.\-]+/g, "<vpa>");             // UPI ids and emails
  t = t.replace(/\d+(?:[.,]\d+)*/g, "0");                              // 1,250.00 and 99 are both just "a number"
  return normalizeForFingerprint(t).slice(0, 500);                      // links -> <URL>, every digit run -> <NUM>
}

// info: { sender, sms, bank, type, mode, amount, reference, counterparty, uncertain }. Never throws, never blocks anything.
function smsFormatRecord_(info){
  try{
    if(!info || !info.sms || String(info.sms) === "-") return false;
    var sender = String(info.sender || "").trim().slice(0, 40);
    if(!sender || sender === "-") return false;
    var template = smsFormatTemplate_(info.sms, info.counterparty);
    if(template.length < 15) return false;                              // too short to say anything useful
    var uncertain = !!info.uncertain || /^needs review:/i.test(String(info.counterparty || ""));
    var adds = [{ field: "seen", amountInt: 1 }];
    if(uncertain) adds.push({ field: "uncertain", amountInt: 1 });
    if(!(Number(info.amount) > 0)) adds.push({ field: "missingAmount", amountInt: 1 });
    if(!info.type) adds.push({ field: "missingType", amountInt: 1 });
    if(!info.counterparty || uncertain) adds.push({ field: "missingPayee", amountInt: 1 });
    if(!info.reference) adds.push({ field: "missingReference", amountInt: 1 });
    fsCommit_([{ merge: {
      path: "smsFormats/" + smsFormatHash_(sender.toLowerCase() + "|" + template),
      fields: {
        sender: sender, template: template, bank: String(info.bank || "").slice(0, 40), mode: String(info.mode || "").slice(0, 40),
        type: String(info.type || "").slice(0, 10), lastSeenMs: Date.now()
      },
      adds: adds
    } }]);
    return true;
  }catch(err){
    try{ logAI("SMS_FORMAT_ERROR", String(err && err.message).slice(0, 200)); }catch(ignore){}
    return false;
  }
}

// From a Transactions row (the timer calls this for each new SMS row, for the owner's own messages).
function smsFormatRecordRow_(row){
  try{
    if(!row || String(row[8]) !== "SMS") return false;                    // only real SMS rows (not Manual / Import)
    return smsFormatRecord_({ sender: row[11], sms: row[10], bank: row[2], type: row[3], mode: row[4], amount: row[5], reference: row[6], counterparty: row[7] });
  }catch(err){ return false; }
}

// Owner-only summary for the Access screen: how many formats, from how many senders, and which senders are not understood yet.
function smsFormatsSummary_(){
  var docs = fsListPath_("smsFormats", 1000);
  var bySender = {};
  var total = 0, notUnderstood = 0;
  docs.forEach(function(d){
    var f = d.fields || {};
    var seen = Number(f.seen || 0), unc = Number(f.uncertain || 0);
    total++;
    var s = String(f.sender || "?");
    var b = bySender[s] || (bySender[s] = { sender: s, formats: 0, seen: 0, uncertain: 0 });
    b.formats++; b.seen += seen; b.uncertain += unc;
    if(unc > 0 && unc >= seen / 2) notUnderstood++;
  });
  var list = Object.keys(bySender).map(function(k){ return bySender[k]; });
  list.sort(function(a, b){ return b.uncertain - a.uncertain || b.seen - a.seen; });
  return { ok: true, formats: total, senders: list.length, notUnderstood: notUnderstood, top: list.slice(0, 8) };
}
