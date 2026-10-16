// admin.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: three small actions behind the app's "Access" panel.
//   getMyAccess        any signed-in allowed person asks "what may I use?" -> { isOwner, fullApp }.
//                      The app uses it to decide whether a friend sees only Splits or the whole tracker.
//   getAdminOverview   OWNER ONLY. Who has access, who has the full app, today's Firestore usage, last backup.
//   setFriendScreen    OWNER ONLY (added 2026-10-14). Shows or hides one screen (CC Advisor, Reconcile...) for one friend.
//   setFriendFullApp   OWNER ONLY. Switches one existing friend's full app on or off (the same switch as v2dbEnableUser).
// Nobody can add themselves: a friend exists only if the owner added them (Splits), and only the owner can turn the full app on.
// The full app for a friend runs on THEIR OWN private data (v2route.js); it never touches the owner's Sheet.

// Screens the owner may hide for one friend (added 2026-10-14). Home, Pending and Analysis are never hideable: every user needs them.
// The names are the same as the data-target of each button in the app's More menu. Hiding is for CLUTTER, not privacy: a friend only
// ever sees their own data anyway.
var ADMIN_SCREENS_ = ["today", "cash", "history", "investments", "cc", "debts", "savings", "planner", "reconcile"];

// Clean list of hidden screens out of whatever is stored: only known names, no repeats, always in the same order.
function adminCleanHidden_(raw){
  var list = Array.isArray(raw) ? raw : [];
  return ADMIN_SCREENS_.filter(function(name){ return list.indexOf(name) !== -1; });
}

function adminIsOwner_(verified){
  return !!verified && String(verified.email || "").toLowerCase() === String(PWA_ALLOWED_EMAIL).toLowerCase();
}

// Returns a response object for the three actions above, or null if the action is not one of them.
function adminHandle_(data, verified){
  var action = data && data.action;
  if(action !== "getMyAccess" && action !== "getAdminOverview" && action !== "setFriendFullApp" && action !== "setFriendScreen" && action !== "getMyIngestKey" && action !== "getSmsFormats" && action !== "teachBank" && action !== "forgetBank" &&
     action !== "adminLog" && action !== "getAdminDashboard" && action !== "resolveAdminProblem") return null;
  var isOwner = adminIsOwner_(verified);
  // adminLog (2026-10-16): the app's own usage / error report, from any allowed person (adminStats.js). Counts only, never data.
  if(action === "adminLog") return adminLogHandle_(data, verified);
  try{
    if(action === "getMyAccess"){
      var fullApp = isOwner ? true : v2EngineFor_(verified.email) === "v2db";
      // Which screens the owner has hidden for THIS friend (never for the owner). A failed read shows everything rather than breaking the app.
      var hidden = [];
      if(!isOwner && fullApp){
        try{
          var mine = fsGetPathMeta_(splitsFriendPath_(splitsKey_(PWA_ALLOWED_EMAIL), splitsKey_(verified.email)));
          hidden = adminCleanHidden_(mine && mine.fields && mine.fields.hiddenScreens);
        }catch(ignoreRead){ hidden = []; }
      }
      return { ok: true, isOwner: isOwner, fullApp: fullApp, hidden: hidden };
    }
    if(action === "getMyIngestKey"){
      // The private key the friend's phone sends with every SMS (ingest.js). Only for a friend who has the full app.
      if(isOwner && !(typeof smsInOwnerDirectOn_ === "function" && smsInOwnerDirectOn_() && v2EngineFor_(verified.email) === "v2db")) return { ok: false, error: "The owner does not need a key." };
      if(v2EngineFor_(verified.email) !== "v2db") return { ok: false, error: "Full app is not switched on." };
      return { ok: true, key: ingestGetOrCreateKey_(verified.email) };
    }
    if(!isOwner) return { ok: false, error: "This account is not allowed." };
    if(action === "getSmsFormats") return smsFormatsSummary_();
    if(action === "getAdminDashboard") return adminDashboard_();            // adminScores.js: the admin web page's one answer
    if(action === "resolveAdminProblem") return adminResolveProblem_(data.id);
    if(action === "teachBank") return smsInTeachBank_(data.sender, data.bank, false);
    if(action === "forgetBank") return smsInTeachBank_(data.sender, "", true);
    if(action === "setFriendFullApp"){
      var email = splitsKey_(data.email);
      if(!splitsValidEmail_(email) || email === splitsKey_(PWA_ALLOWED_EMAIL)) return { ok: false, error: "Pick one of your friends." };
      if(!splitsIsOwnersFriend_(email)) return { ok: false, error: "That person is not one of your friends." };
      if(data.on === true) v2dbEnableUser(email);
      else{ v2dbDisableUser(email); if(typeof ingestRevokeKey_ === "function") ingestRevokeKey_(email); }   // switching off also stops their SMS
      try{ logAI("ADMIN_FULL_APP", email + " -> " + (data.on === true ? "on" : "off")); }catch(ignore){}
    }
    if(action === "setFriendScreen"){
      var femail = splitsKey_(data.email);
      if(!splitsValidEmail_(femail) || femail === splitsKey_(PWA_ALLOWED_EMAIL) || !splitsIsOwnersFriend_(femail)) return { ok: false, error: "Pick one of your friends." };
      var screen = String(data.screen || "");
      if(ADMIN_SCREENS_.indexOf(screen) === -1) return { ok: false, error: "That screen can't be switched." };
      if(typeof data.visible !== "boolean") return { ok: false, error: "Say whether to show or hide it." };
      var fpath = splitsFriendPath_(splitsKey_(PWA_ALLOWED_EMAIL), femail);
      // Read the current list and write the changed one back; if two taps race, the second is refused and retried once with fresh data.
      for(var attempt = 0; attempt < 2; attempt++){
        var cur = fsGetPathMeta_(fpath);
        if(!cur) return { ok: false, error: "That person is not one of your friends." };
        var list = adminCleanHidden_(cur.fields.hiddenScreens).filter(function(n){ return n !== screen; });
        if(data.visible !== true) list.push(screen);
        try{
          fsCommit_([{ merge: { path: fpath, fields: { hiddenScreens: adminCleanHidden_(list) }, onlyIfUpdateTime: cur.updateTime } }]);
          break;
        }catch(writeErr){
          if(attempt === 1 || (writeErr && writeErr.httpCode !== 400)) throw writeErr;
        }
      }
      try{ logAI("ADMIN_SCREEN", femail + " " + screen + " -> " + (data.visible === true ? "shown" : "hidden")); }catch(ignore){}
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
      hidden: adminCleanHidden_(d.fields.hiddenScreens),
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
