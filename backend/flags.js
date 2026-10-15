// flags.js (added 2026-10-15)
//
// PLAIN-ENGLISH WHAT THIS IS: the app's on/off "switches" (who is on the private copy, whether the new server saves / takes bank SMS / runs
// the alert timer ...) now live in ONE place that both servers share: the database document _system/props. Before, they lived in Apps Script's
// own settings (Script Properties) and were only COPIED to the new server, so the new server could read them but never change them. Now either
// server can read and change them, which is what lets the Access screen run on the new server and lets Apps Script be switched off one day.
//
// HOW IT READS:
//   - the new server: the shim already loads _system/props into its own copy of "Script Properties" every 20 seconds, so flagsAll_() just reads that;
//   - Apps Script: reads _system/props, remembered for 30 seconds (so a busy minute costs one database read, not one per request). If the database
//     cannot be read it uses the last copy it saw, and failing that the old Script Properties (which every change here also keeps up to date).
//   - EMERGENCY BRAKE: Script Property FLAGS_LEGACY = "on" makes Apps Script ignore the database and use only its own Script Properties again.
// HOW IT WRITES (flagsSet_): changes the one shared document (safely, even if two people change it at once), keeps Apps Script's own Script
// Properties in step (so the fallback above is right), forgets the 30-second memory, and (on the new server) updates its own copy at once.
//
// Only the names in FLAGS_NAMES_ are ever read or written here. Everything else in this app's settings is untouched.

var FLAGS_DOC_ = "_system/props";
var FLAGS_NAMES_ = ["V2DB_OWNER", "V2DB_USERS", "V2DB_OWNER_DIRECT", "V2_FN_WRITES", "V2_FN_SMS", "V2_FN_TIMER"];
var FLAGS_CACHE_KEY_ = "FLAGS_JSON_V1";          // 30 s memory
var FLAGS_LAST_KEY_ = "FLAGS_JSON_LAST_V1";      // the last copy ever seen (6 h), used only when the database cannot be read
var FLAGS_CACHE_TTL_ = 30;
var FLAGS_LAST_TTL_ = 21600;
var FLAGS_MEMO_ = null;                          // { at, value }: remembered for 5 s inside one run, so one request does not ask repeatedly

function flagsOnNewServer_(){ return (typeof V2_ON_NEW_SERVER_ !== "undefined") && !!V2_ON_NEW_SERVER_; }

// The switches as the (old) Script Properties hold them.
function flagsLegacy_(){
  var out = {};
  try{
    var p = PropertiesService.getScriptProperties();
    FLAGS_NAMES_.forEach(function(n){ var v = p.getProperty(n); if(v !== null && v !== undefined) out[n] = String(v); });
  }catch(e){}
  return out;
}

// Makes Apps Script's own old settings equal the shared document (only the six switches; only writes what differs, which is rare). The new server
// can change a switch but cannot touch Apps Script's Script Properties, so without this the fallback could go stale. Never throws.
function flagsMirrorToLegacy_(value){
  try{
    var p = PropertiesService.getScriptProperties();
    FLAGS_NAMES_.forEach(function(n){
      var want = (typeof value[n] === "string" && value[n] !== "") ? value[n] : null;
      var have = p.getProperty(n);
      if(want === null){ if(have !== null && have !== undefined) p.deleteProperty(n); }
      else if(have !== want) p.setProperty(n, want);
    });
  }catch(e){}
}

function flagsPick_(fields){
  var out = {};
  FLAGS_NAMES_.forEach(function(n){ if(fields && typeof fields[n] === "string") out[n] = fields[n]; });
  return out;
}

function flagsCache_(){ try{ return CacheService.getScriptCache(); }catch(e){ return null; } }

// All the switches, as { NAME: "text" }. A switch that is off is simply absent.
function flagsAll_(){
  if(flagsOnNewServer_()) return flagsLegacy_();                        // the shim keeps this in step with _system/props every 20 s
  var now = Date.now();
  if(FLAGS_MEMO_ && now - FLAGS_MEMO_.at < 5000) return FLAGS_MEMO_.value;
  var value = null;
  try{
    if(PropertiesService.getScriptProperties().getProperty("FLAGS_LEGACY") === "on") value = flagsLegacy_();
  }catch(e){}
  if(!value){
    var cache = flagsCache_();
    var hit = null;
    try{ hit = cache ? cache.get(FLAGS_CACHE_KEY_) : null; }catch(e){}
    if(hit){ try{ value = JSON.parse(hit); }catch(e){ value = null; } }
    if(!value){
      try{
        var doc = fsGetPathMeta_(FLAGS_DOC_);
        value = doc && doc.fields ? flagsPick_(doc.fields) : flagsLegacy_();     // no document yet: the old settings
        if(doc && doc.fields) flagsMirrorToLegacy_(value);                       // keep the fallback (old Script Properties) current, whoever changed a switch
        try{ if(cache){ cache.put(FLAGS_CACHE_KEY_, JSON.stringify(value), FLAGS_CACHE_TTL_); cache.put(FLAGS_LAST_KEY_, JSON.stringify(value), FLAGS_LAST_TTL_); } }catch(e){}
      }catch(readErr){
        var last = null;
        try{ last = cache ? cache.get(FLAGS_LAST_KEY_) : null; }catch(e){}
        if(last){ try{ value = JSON.parse(last); }catch(e){ value = null; } }
        if(!value) value = flagsLegacy_();
      }
    }
  }
  FLAGS_MEMO_ = { at: now, value: value };
  return value;
}

// One switch's value ("on", or text such as a JSON list), or null when it is off / not set.
function flagGet_(name){
  var v = flagsAll_()[name];
  return (v === undefined || v === null || v === "") ? null : v;
}
function flagOn_(name){ return flagGet_(name) === "on"; }

// Changes one or more switches: changes = { NAME: "on" | "text" | null } (null switches it off). Throws a plain Error if the change could not be
// saved, so nobody is ever told a switch moved when it did not.
function flagsSet_(changes){
  var names = Object.keys(changes || {});
  names.forEach(function(n){ if(FLAGS_NAMES_.indexOf(n) === -1) throw new Error("Unknown switch: " + n); });
  var apply = function(fields){
    names.forEach(function(n){
      var v = changes[n];
      if(v === null || v === undefined || v === "") delete fields[n]; else fields[n] = String(v);
    });
    return fields;
  };
  var saved = false, lastErr = null, finalFlags = null;
  for(var attempt = 0; attempt < 3 && !saved; attempt++){
    try{
      var doc = fsGetPathMeta_(FLAGS_DOC_);
      var fields = apply(flagsPick_(doc ? doc.fields : null));
      finalFlags = flagsPick_(fields);
      fields.updatedAtMs = Date.now();
      var op = { set: { path: FLAGS_DOC_, fields: fields } };
      if(doc) op.set.onlyIfUpdateTime = doc.updateTime; else op.set.onlyIfNew = true;
      fsCommit_([op]);
      saved = true;
    }catch(e){
      lastErr = e;
      var clash = e && (e.httpCode === 400 || e.httpCode === 409 || e.httpCode === 412);       // someone changed it at the same moment: look again
      if(!clash) break;
    }
  }
  if(!saved){
    try{ logAI("FLAGS_WRITE_ERROR", String(lastErr && lastErr.message).slice(0, 200)); }catch(ignore){}
    throw new Error("Could not save the switch (" + names.join(", ") + "): the database did not accept the change, so NOTHING was changed. Try again.");
  }
  // keep the other places in step
  try{
    var p = PropertiesService.getScriptProperties();
    names.forEach(function(n){
      var v = changes[n];
      if(v === null || v === undefined || v === "") p.deleteProperty(n); else p.setProperty(n, String(v));
    });
  }catch(ignore){}
  // This server's own memory is brought up to date at once (written, not just cleared: a cache that cannot be cleared must not keep the old value).
  FLAGS_MEMO_ = null;
  try{
    var c = flagsCache_();
    if(c && finalFlags){ c.put(FLAGS_CACHE_KEY_, JSON.stringify(finalFlags), FLAGS_CACHE_TTL_); c.put(FLAGS_LAST_KEY_, JSON.stringify(finalFlags), FLAGS_LAST_TTL_); }
  }catch(ignore){}
  return true;
}

// Compatibility + first-time seeding: makes sure the shared document exists, filling it from the old Script Properties if it does not.
// (Safe to run any number of times; never overwrites an existing document.) Returns true when the document is in place.
function exportFlagsToFunctions(){
  try{
    if(fsGetPathMeta_(FLAGS_DOC_)) return true;
    var fields = flagsLegacy_();
    fields.updatedAtMs = Date.now();
    fsCommit_([{ set: { path: FLAGS_DOC_, fields: fields, onlyIfNew: true } }]);
    return true;
  }catch(err){
    try{ logAI("FLAGS_EXPORT_ERROR", String(err && err.message).slice(0, 200)); }catch(ignore){}
    return false;
  }
}
