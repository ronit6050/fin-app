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

// Words that are part of a bank's own wording, never a person's name. A name-like word is only masked if it is NOT one of these.
var SMS_FORMAT_KEEP_WORDS_ = ("bank,upi,hdfc,sbi,icici,axis,kotak,yes,federal,baroda,bob,pnb,idfc,indusind,paytm,payzapp,phonepe,gpay,imps,neft,rtgs,atm,pos,ecom," +
  "ref,rrn,utr,umn,avl,bal,acct,account,card,credit,debit,debited,credited,otp,not,you,your,call,sms,inr,rs,dr,cr,info,txn,mandate,wallet,savings," +
  "current,towards,payment,received,sent,paid,transfer,transferred,withdrawn,deposited,spent,balance,available,limit,customer,cardmember,dear,regards,team," +
  "online,net,banking,netbanking,visa,mastercard,rupay,emi,fee,charges,statement,due,min,total,date,time,on,at,for,of,the,and,via,with,from,to,by").split(",");

// Masks person-name-like words (Capitalised or ALL CAPS, 2+ letters) right after "dear / hi / hello / mr / mrs / ms / sir / madam / to / from / by".
// Done on the ORIGINAL text (capital letters are the clue). Up to 4 name words in a row; stops at the first ordinary banking word.
function smsFormatMaskNames_(text){
  var keep = {};
  SMS_FORMAT_KEEP_WORDS_.forEach(function(w){ keep[w] = true; });
  return String(text).replace(/\b(dear|hi|hello|mr|mrs|ms|sir|madam|to|from|by|paid to|sent to|received from)\b\.?[ \t]+((?:[A-Za-z][A-Za-z.'\-]*[ \t]*){1,6})/gi, function(whole, trigger, rest){
    var words = rest.split(/[ \t]+/).filter(function(x){ return x !== ""; });
    var out = [], masked = 0, stop = false;
    words.forEach(function(wd){
      var bare = wd.replace(/[.']/g, "");
      var nameLike = !stop && masked < 4 && bare.length >= 2 && /^[A-Z]/.test(bare) && !keep[bare.toLowerCase()];
      if(nameLike){ out.push("<name>"); masked++; }
      else{ stop = true; out.push(wd); }
    });
    return trigger + " " + out.join(" ") + (/[ \t]$/.test(rest) ? " " : "");
  });
}

// The anonymised shape of a message.
function smsFormatTemplate_(sms, counterparty){
  var t = smsFormatMaskNames_(String(sms || "")).toLowerCase();
  t = t.replace(/[a-z0-9._\-]+@[a-z0-9.\-]+/g, "<vpa>");             // UPI ids and emails first (they often contain the payee's name)
  var payee = String(counterparty || "").toLowerCase().replace(/^needs review:\s*/, "").trim();
  // Only remove the payee if it really holds a name-like word (a wrongly extracted "hdfc bank a" must not eat the bank's wording).
  var payeeHasName = payee.split(/[^a-z0-9]+/).some(function(wd){ return wd.length >= 3 && SMS_FORMAT_KEEP_WORDS_.indexOf(wd) === -1 && !/^\d+$/.test(wd); });
  if(payee.length >= 3 && payeeHasName){
    var esc = payee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(esc, "g"), "<payee>");
    // also each word of the payee on its own (a short extracted name vs the longer printed one), except ordinary banking words
    payee.split(/[^a-z0-9]+/).forEach(function(wd){
      if(wd.length >= 3 && SMS_FORMAT_KEEP_WORDS_.indexOf(wd) === -1 && !/^\d+$/.test(wd)){
        t = t.replace(new RegExp("\\b" + wd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), "<payee>");
      }
    });
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
        type: String(info.type || "").slice(0, 10), lastSeenMs: Math.floor(Date.now() / 86400000) * 86400000   // the DAY only, never the time
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
    var b = bySender[s] || (bySender[s] = { sender: s, token: "", bank: "", formats: 0, seen: 0, uncertain: 0 });
    b.formats++; b.seen += seen; b.uncertain += unc;
    if(f.bank && !b.bank) b.bank = String(f.bank);
    if(unc > 0 && unc >= seen / 2) notUnderstood++;
  });
  // The banks taught from the Access screen, and which senders still have no bank at all (the ones worth teaching).
  var taught = {};
  try{
    var doc = fsGetPathMeta_("_system/bankSenders");
    taught = doc && doc.fields && doc.fields.map ? JSON.parse(String(doc.fields.map)) : {};
  }catch(err){ taught = {}; }
  var list = Object.keys(bySender).map(function(k){
    var b = bySender[k];
    b.token = typeof smsInSenderToken_ === "function" ? smsInSenderToken_(b.sender) : "";
    if(!b.bank && b.token && taught[b.token]) b.bank = String(taught[b.token]);
    b.needsBank = !b.bank && b.uncertain > 0;
    return b;
  });
  list.sort(function(a, b){ return (b.needsBank ? 1 : 0) - (a.needsBank ? 1 : 0) || b.uncertain - a.uncertain || b.seen - a.seen; });
  var taughtList = Object.keys(taught).map(function(t){ return { token: t, bank: String(taught[t]) }; });
  return { ok: true, formats: total, senders: list.length, notUnderstood: notUnderstood, top: list.slice(0, 10), taught: taughtList };
}
