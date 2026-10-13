// admin.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: three small actions behind the app's "Access" panel.
//   getMyAccess        any signed-in allowed person asks "what may I use?" -> { isOwner, fullApp }.
//                      The app uses it to decide whether a friend sees only Splits or the whole tracker.
//   getAdminOverview   OWNER ONLY. Who has access, who has the full app, today's Firestore usage, last backup.
//   setFriendFullApp   OWNER ONLY. Switches one existing friend's full app on or off (the same switch as v2dbEnableUser).
// Nobody can add themselves: a friend exists only if the owner added them (Splits), and only the owner can turn the full app on.
// The full app for a friend runs on THEIR OWN private data (v2route.js); it never touches the owner's Sheet.

function adminIsOwner_(verified){
  return !!verified && String(verified.email || "").toLowerCase() === String(PWA_ALLOWED_EMAIL).toLowerCase();
}

// Returns a response object for the three actions above, or null if the action is not one of them.
function adminHandle_(data, verified){
  var action = data && data.action;
  if(action !== "getMyAccess" && action !== "getAdminOverview" && action !== "setFriendFullApp" && action !== "getMyIngestKey" && action !== "getSmsFormats") return null;
  var isOwner = adminIsOwner_(verified);
  try{
    if(action === "getMyAccess"){
      return { ok: true, isOwner: isOwner, fullApp: isOwner ? true : v2EngineFor_(verified.email) === "v2db" };
    }
    if(action === "getMyIngestKey"){
      // The private key the friend's phone sends with every SMS (ingest.js). Only for a friend who has the full app.
      if(isOwner) return { ok: false, error: "The owner does not need a key." };
      if(v2EngineFor_(verified.email) !== "v2db") return { ok: false, error: "Full app is not switched on." };
      return { ok: true, key: ingestGetOrCreateKey_(verified.email) };
    }
    if(!isOwner) return { ok: false, error: "This account is not allowed." };
    if(action === "getSmsFormats") return smsFormatsSummary_();
    if(action === "setFriendFullApp"){
      var email = splitsKey_(data.email);
      if(!splitsValidEmail_(email) || email === splitsKey_(PWA_ALLOWED_EMAIL)) return { ok: false, error: "Pick one of your friends." };
      if(!splitsIsOwnersFriend_(email)) return { ok: false, error: "That person is not one of your friends." };
      if(data.on === true) v2dbEnableUser(email);
      else{ v2dbDisableUser(email); if(typeof ingestRevokeKey_ === "function") ingestRevokeKey_(email); }   // switching off also stops their SMS
      try{ logAI("ADMIN_FULL_APP", email + " -> " + (data.on === true ? "on" : "off")); }catch(ignore){}
    }
    return adminOverview_();
  }catch(e){
    try{ logAI("ADMIN_ERROR", String(action) + ": " + String(e && e.message).slice(0, 250)); }catch(ignore){}
    return { ok: false, error: "Couldn't load that. Try again in a moment." };
  }
}

function adminOverview_(){
  var me = splitsKey_(PWA_ALLOWED_EMAIL);
  var docs = fsListPath_("users/" + me + "/friends", 500);
  var people = [];
  docs.forEach(function(d){
    if(d.fields.mirror) return;                                  // mirror entries are people who added the owner, not people with access
    people.push({
      name: d.fields.name || d.id, email: d.id,
      fullApp: v2EngineFor_(d.id) === "v2db",
      balance: splitsRupees_(d.fields.balancePaise || 0)
    });
  });
  people.sort(function(a, b){ return String(a.name).localeCompare(String(b.name)); });
  var fullCount = people.filter(function(p){ return p.fullApp; }).length;
  var usage = {};
  try{ usage = fsUsageToday_(); }catch(ignore){}
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    owner: { email: me, onPrivateCopy: v2EngineFor_(me) === "v2db", lastBackup: props.getProperty("V2OWNER_BACKUP_LAST") || "" },
    totals: { everyone: people.length + 1, friends: people.length, fullApp: fullCount, splitsOnly: people.length - fullCount },
    people: people,
    usage: { readsPct: usage.readsPct || 0, writesPct: usage.writesPct || 0, reads: usage.reads || 0, writes: usage.writes || 0 }
  };
}
