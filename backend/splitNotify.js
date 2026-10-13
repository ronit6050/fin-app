// splitNotify.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: when someone splits a payment with you, records a payment to/from you, or undoes one, YOU get a push
// notification on your own phone ("Ronit split Cafe with you: your share is Rs 60"). Called by splits.js after the action has
// really been saved; it can never change or block the action (everything here is best-effort and swallows its own errors).
//
// Whose phone: each person's push token lives in THEIR OWN space (their private _Props for a person on the full app, the owner's
// own for the owner). A friend who only has Splits (not the full app) has no token, so they simply get no push - they still see the
// split the next time they open the app.

function splitNotifyMoney_(n){
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// The device token for a person, or "" if they have none.
function splitNotifyToken_(email){
  var e = splitsKey_(email);
  try{
    if(v2EngineFor_(e) === "v2db") return new V2Db_(e).props().getProperty("PWA_PUSH_TOKEN") || "";
    if(e === splitsKey_(PWA_ALLOWED_EMAIL)) return PropertiesService.getScriptProperties().getProperty("PWA_PUSH_TOKEN") || "";
  }catch(err){
    try{ logAI("SPLIT_NOTIFY_ERROR", "token: " + String(err && err.message).slice(0, 150)); }catch(ignore){}
  }
  return "";
}

// Tells the OTHER person (friendEmail) what just happened. kind: "split" | "payment" | "undo".
// d: { description, friendShare, amount, direction ("received" = I received money from them, "sent" = I paid them) }.
function splitNotify_(myName, friendEmail, kind, d, myEmail){
  try{
    var who = String(myName || "Your friend").trim().slice(0, 40) || "Your friend";
    var title, body;
    if(kind === "split"){
      title = "New split";
      body = who + " split " + (d.description ? "\"" + String(d.description).slice(0, 40) + "\" " : "a payment ") + "with you: your share is " + splitNotifyMoney_(d.friendShare) + ".";
    }else if(kind === "payment"){
      title = "Payment recorded";
      body = d.direction === "sent"
        ? who + " recorded paying you " + splitNotifyMoney_(d.amount) + "."
        : who + " recorded receiving " + splitNotifyMoney_(d.amount) + " from you.";
    }else if(kind === "undo"){
      title = "Entry undone";
      body = who + " undid a split or payment with you.";
    }else{
      return false;
    }
    // Cheap spam limit: at most 10 of these per sender to the same person in 10 minutes (kept in the script's memory).
    var cache = null, limitKey = "sn:" + splitsKey_(myEmail) + ":" + splitsKey_(friendEmail);
    try{ cache = CacheService.getScriptCache(); }catch(ignoreCache){}
    var recent = 0;
    try{ recent = cache ? Number(cache.get(limitKey) || 0) : 0; }catch(ignoreGet){}
    if(recent >= 10) return false;
    var token = splitNotifyToken_(friendEmail);
    if(!token) return false;
    try{ if(cache) cache.put(limitKey, String(recent + 1), 600); }catch(ignorePut){}
    sendPushToToken_(token, title, body, { kind: "split" });
    return true;
  }catch(err){
    try{ logAI("SPLIT_NOTIFY_ERROR", String(err && err.message).slice(0, 150)); }catch(ignore){}
    return false;
  }
}
