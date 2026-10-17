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

// ---- DEBT notifications (added 2026-10-17) -----------------------------------------------------------------------------------
// When someone adds a debt (Debts > "+ Add Debt"), records a payment on one, or settles one, and the person named on that debt is
// ALSO a person they split with who uses the app, that person gets a push, the same way a split does. How the person is found: the
// debt's name must match EXACTLY ONE person in the sender's own friends list (case and spaces ignored). No match, or more than one,
// means nobody is told (a wrong person must never be notified). A friend with no phone token (Splits-only) simply gets no push.
// Best-effort like every notification here: never changes or blocks the debt itself.
// kind: "added" | "payment" | "settled".  d: { type: "LENT"|"BORROWED", amount, note, settled }.
function debtNotifyFriend_(verified, personName, kind, d){
  try{
    var me = splitsKey_(verified && verified.email);
    var who = String((verified && verified.name) || me).trim().slice(0, 40) || "Your friend";
    var wanted = String(personName || "").trim().toLowerCase().replace(/\s+/g, " ");
    if(!me || !wanted) return false;
    var docs = fsListPath_("users/" + me + "/friends", 500);
    var matches = docs.filter(function(f){
      return f.id !== me && String((f.fields && f.fields.name) || "").trim().toLowerCase().replace(/\s+/g, " ") === wanted;
    });
    if(matches.length !== 1) return false;
    var friendEmail = matches[0].id;
    var title, body;
    if(kind === "added"){
      var amount = splitNotifyMoney_(d.amount);
      var reason = d.note ? " (\"" + String(d.note).slice(0, 40) + "\")" : "";
      title = "New debt recorded";
      body = String(d.type).toUpperCase() === "BORROWED"
        ? who + " recorded a debt with you: " + who + " owes you " + amount + reason + "."
        : who + " recorded a debt with you: you owe " + who + " " + amount + reason + ".";
    }else if(kind === "payment"){
      title = d.settled ? "Debt settled" : "Debt payment recorded";
      body = d.settled ? who + " marked a debt with you as settled." : who + " recorded a payment of " + splitNotifyMoney_(d.amount) + " on a debt with you.";
    }else if(kind === "settled"){
      title = "Debt settled";
      body = who + " marked a debt with you as settled.";
    }else{
      return false;
    }
    var cache = null, limitKey = "sn:" + me + ":" + friendEmail;                       // the same spam limit as the split notifications
    try{ cache = CacheService.getScriptCache(); }catch(ignoreCache){}
    var recent = 0;
    try{ recent = cache ? Number(cache.get(limitKey) || 0) : 0; }catch(ignoreGet){}
    if(recent >= 10) return false;
    var token = splitNotifyToken_(friendEmail);
    if(!token) return false;
    try{ if(cache) cache.put(limitKey, String(recent + 1), 600); }catch(ignorePut){}
    sendPushToToken_(token, title, body, { kind: "debt" });
    return true;
  }catch(err){
    try{ logAI("SPLIT_NOTIFY_ERROR", "debt: " + String(err && err.message).slice(0, 150)); }catch(ignore){}
    return false;
  }
}
