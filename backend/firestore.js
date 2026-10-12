// firestore.js (added 2026-10-11)
//
// PLAIN-ENGLISH WHAT THIS IS: the connector between the app's brain (Apps
// Script) and the new Firestore database. It can sign in, write a document,
// read a document back, and keep count of how much of Firestore's free daily
// allowance has been used.
//
// WHY IT LOOKS LIKE THIS (see CLAUDE.md, "DECISION RECORD - v2 foundation"):
// - It signs in with the SAME Google "robot" key already saved for push
//   notifications (Script Property FIREBASE_SERVICE_ACCOUNT), just asking for
//   the database permission instead of the messaging one. No new secret.
// - Every call is counted. Firestore's free plan allows 50,000 reads and
//   20,000 writes a day; Apps Script allows ~20,000 outgoing calls a day.
// - Nothing in here ever decides to hide an error. Callers (viewPublisher.js)
//   are the ones who catch it, so a Firestore problem can never break a save,
//   a notification, or a transaction.
//
// Nothing here reads or writes the Google Sheet.

var FS_SCOPE_ = "https://www.googleapis.com/auth/datastore";
var FS_TOKEN_CACHE_KEY_ = "FS_ACCESS_TOKEN";
var FS_FREE_READS_PER_DAY_ = 50000;
var FS_FREE_WRITES_PER_DAY_ = 20000;

// Hard safety limit (added 2026-10-12): the app stops using Firestore at 90% of the free
// daily allowance, so it can never go over it and never costs money, even on a paid plan.
// When the limit is reached, calls fail with a clear message (screens fall back to the
// slower direct way and splits show "couldn't reach the database") until the day rolls over.
var FS_SAFE_READS_PER_DAY_ = 45000;
var FS_SAFE_WRITES_PER_DAY_ = 18000;
var FS_PERSISTED_ = null;           // today's saved totals, read once per run

// Counts for THIS run only; fsFlushUsage_() adds them to today's total.
var FS_USAGE_ = { reads: 0, writes: 0, calls: 0 };
var FS_SA_CACHE_ = null;

function fsServiceAccount_(){
  if(FS_SA_CACHE_) return FS_SA_CACHE_;
  var raw = PropertiesService.getScriptProperties().getProperty("FIREBASE_SERVICE_ACCOUNT");
  if(!raw) throw new Error("Firestore: no FIREBASE_SERVICE_ACCOUNT saved in Script Properties.");
  FS_SA_CACHE_ = JSON.parse(raw);
  return FS_SA_CACHE_;
}

// A short-lived (1 hour) permission slip, remembered for 50 minutes so most
// runs do not have to ask Google again.
function fsAccessToken_(){
  var cache = CacheService.getScriptCache();
  var cached = cache.get(FS_TOKEN_CACHE_KEY_);
  if(cached) return cached;

  var sa = fsServiceAccount_();
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: "RS256", typ: "JWT" };
  var claim = {
    iss: sa.client_email, scope: FS_SCOPE_,
    aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now
  };
  var input = Utilities.base64EncodeWebSafe(JSON.stringify(header)) + "." +
              Utilities.base64EncodeWebSafe(JSON.stringify(claim));
  var signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(input, sa.private_key));

  var resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: input + "." + signature },
    muteHttpExceptions: true
  });
  FS_USAGE_.calls++;
  var body = JSON.parse(resp.getContentText());
  if(!body.access_token){
    throw new Error("Firestore sign-in failed: " + String(body.error_description || body.error || "unknown").slice(0, 160));
  }
  cache.put(FS_TOKEN_CACHE_KEY_, body.access_token, 3000);
  return body.access_token;
}

function fsDocumentsUrl_(){
  return "https://firestore.googleapis.com/v1/projects/" + fsServiceAccount_().project_id + "/databases/(default)/documents";
}

// ---- Turning plain JavaScript values into Firestore's typed format ------
function fsEncodeValue_(v){
  if(v === null || v === undefined) return { nullValue: null };
  if(v instanceof Date) return { timestampValue: v.toISOString() };
  if(Array.isArray(v)) return { arrayValue: { values: v.map(fsEncodeValue_) } };
  switch(typeof v){
    case "string":  return { stringValue: v };
    case "boolean": return { booleanValue: v };
    case "number":  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case "object":  return { mapValue: { fields: fsEncodeFields_(v) } };
  }
  return { stringValue: String(v) };
}

function fsEncodeFields_(obj){
  var out = {};
  Object.keys(obj).forEach(function(k){ out[k] = fsEncodeValue_(obj[k]); });
  return out;
}

function fsDecodeValue_(v){
  if(!v) return null;
  if("stringValue" in v) return v.stringValue;
  if("integerValue" in v) return Number(v.integerValue);
  if("doubleValue" in v) return v.doubleValue;
  if("booleanValue" in v) return v.booleanValue;
  if("timestampValue" in v) return v.timestampValue;
  if("nullValue" in v) return null;
  if("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fsDecodeValue_);
  if("mapValue" in v) return fsDecodeFields_((v.mapValue && v.mapValue.fields) || {});
  return null;
}

function fsDecodeFields_(fields){
  var out = {};
  Object.keys(fields || {}).forEach(function(k){ out[k] = fsDecodeValue_(fields[k]); });
  return out;
}

function fsErrorText_(text){
  try{ var e = JSON.parse(text); return String((e.error && e.error.message) || text).slice(0, 200); }
  catch(err){ return String(text).slice(0, 200); }
}

// Refuses (throws) when today's totals are at the safe limit. Reads the saved total once per
// run and adds this run's own counts, so it costs no extra Firestore calls.
function fsGuard_(isWrite){
  if(!FS_PERSISTED_) FS_PERSISTED_ = fsUsageToday_();
  var reads = FS_PERSISTED_.reads + FS_USAGE_.reads;
  var writes = FS_PERSISTED_.writes + FS_USAGE_.writes;
  if(reads >= FS_SAFE_READS_PER_DAY_ || (isWrite && writes >= FS_SAFE_WRITES_PER_DAY_)){
    var e = new Error("Firestore daily safety limit reached (keeps the app inside the free allowance; resets tomorrow).");
    e.httpCode = 429;
    e.safetyLimit = true;
    throw e;
  }
}

function fsFetch_(method, url, payload){
  fsGuard_(method !== "get");
  var options = {
    method: method,
    headers: { Authorization: "Bearer " + fsAccessToken_() },
    muteHttpExceptions: true
  };
  if(payload){ options.contentType = "application/json"; options.payload = JSON.stringify(payload); }
  var resp = UrlFetchApp.fetch(url, options);
  FS_USAGE_.calls++;
  return { code: resp.getResponseCode(), text: resp.getContentText() };
}

// Creates or REPLACES one whole document. fields = a plain JS object.
function fsSetDocument_(collection, docId, fields){
  var url = fsDocumentsUrl_() + "/" + encodeURIComponent(collection) + "/" + encodeURIComponent(docId);
  var r = fsFetch_("patch", url, { fields: fsEncodeFields_(fields) });
  FS_USAGE_.writes++;
  if(r.code !== 200) throw new Error("Firestore write failed (HTTP " + r.code + "): " + fsErrorText_(r.text));
  return true;
}

// Reads one document back as a plain JS object, or null if it doesn't exist.
function fsGetDocument_(collection, docId){
  var url = fsDocumentsUrl_() + "/" + encodeURIComponent(collection) + "/" + encodeURIComponent(docId);
  var r = fsFetch_("get", url, null);
  FS_USAGE_.reads++;
  if(r.code === 404) return null;
  if(r.code !== 200) throw new Error("Firestore read failed (HTTP " + r.code + "): " + fsErrorText_(r.text));
  return fsDecodeFields_(JSON.parse(r.text).fields || {});
}

// ---- Nested paths, lists and all-or-nothing batches (added 2026-10-12) ------
// Used by splits.js. "path" looks like "users/a@b.com/friends/c@d.com" - every
// piece is made URL-safe on its own, so the slashes stay as slashes.
function fsPathUrl_(path){
  return fsDocumentsUrl_() + "/" + String(path).split("/").map(encodeURIComponent).join("/");
}

function fsResourceName_(path){
  return "projects/" + fsServiceAccount_().project_id + "/databases/(default)/documents/" + path;
}

// Reads one document by full path. Returns null if missing, otherwise
// { fields: {...plain values...}, updateTime: "..." } (updateTime lets a later
// write say "only if nobody changed it since").
function fsGetPathMeta_(path){
  var r = fsFetch_("get", fsPathUrl_(path), null);
  FS_USAGE_.reads++;
  if(r.code === 404) return null;
  if(r.code !== 200) throw fsError_("read", r);
  var body = JSON.parse(r.text);
  return { fields: fsDecodeFields_(body.fields || {}), updateTime: body.updateTime || "" };
}

// Lists every document directly inside one collection path (pages of 300).
// Returns [{ id, fields, updateTime }]. Capped so a runaway list can't eat the
// day's free reads.
function fsListPath_(collectionPath, maxDocs){
  var limit = maxDocs || 2000, out = [], pageToken = "";
  while(out.length < limit){
    var url = fsPathUrl_(collectionPath) + "?pageSize=300" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    var r = fsFetch_("get", url, null);
    if(r.code === 404) { FS_USAGE_.reads++; return out; }
    if(r.code !== 200) { FS_USAGE_.reads++; throw fsError_("read", r); }
    var body = JSON.parse(r.text);
    var docs = body.documents || [];
    FS_USAGE_.reads += Math.max(1, docs.length);
    docs.forEach(function(d){
      out.push({ id: String(d.name).split("/").pop(), fields: fsDecodeFields_(d.fields || {}), raw: d.fields || {}, updateTime: d.updateTime || "" });
    });
    pageToken = body.nextPageToken || "";
    if(!pageToken) break;
  }
  return out;
}

// Builds an error that remembers Google's HTTP code, so callers can tell
// "already exists" (409) and "changed since you read it" (400) from a real outage.
function fsError_(what, r){
  var e = new Error("Firestore " + what + " failed (HTTP " + r.code + "): " + fsErrorText_(r.text));
  e.httpCode = r.code;
  return e;
}

// ALL-OR-NOTHING batch: either every write lands or none does. Each item is
//   { set: {path, fields, onlyIfNew: bool, onlyIfUpdateTime: "..."} }       whole/partial document
//   { merge: {path, fields, adds, onlyIfUpdateTime} }                       change only these fields (+ optional adds / unchanged-since check)
//   { add: {path, field, amountInt} }                                       add to a whole-number field (safe against two writers)
//   { del: {path} }                                                         delete a document
// "set" with onlyIfNew fails the whole batch with httpCode 409 if it exists.
function fsCommit_(ops){
  var writes = [];
  ops.forEach(function(op){
    if(op.set){
      var w = { update: { name: fsResourceName_(op.set.path), fields: fsEncodeFields_(op.set.fields) } };
      if(op.set.onlyIfNew) w.currentDocument = { exists: false };
      if(op.set.onlyIfUpdateTime) w.currentDocument = { updateTime: op.set.onlyIfUpdateTime };
      writes.push(w);
    } else if(op.merge){
      // Change only the named fields; optionally also add to whole-number
      // fields (op.merge.adds = [{field, amountInt}]) and/or require that
      // nobody changed the document since we read it (onlyIfUpdateTime).
      var mw = {
        update: { name: fsResourceName_(op.merge.path), fields: fsEncodeFields_(op.merge.fields || {}) },
        updateMask: { fieldPaths: Object.keys(op.merge.fields || {}) }
      };
      if(op.merge.adds && op.merge.adds.length){
        mw.updateTransforms = op.merge.adds.map(function(a){
          return { fieldPath: a.field, increment: { integerValue: String(a.amountInt) } };
        });
      }
      if(op.merge.onlyIfUpdateTime) mw.currentDocument = { updateTime: op.merge.onlyIfUpdateTime };
      writes.push(mw);
    } else if(op.add){
      writes.push({
        update: { name: fsResourceName_(op.add.path), fields: {} },
        updateMask: { fieldPaths: [] },
        updateTransforms: [{ fieldPath: op.add.field, increment: { integerValue: String(op.add.amountInt) } }]
      });
    } else if(op.del){
      writes.push({ "delete": fsResourceName_(op.del.path) });
    }
  });
  var r = fsFetch_("post", fsDocumentsUrl_() + ":commit", { writes: writes });
  FS_USAGE_.writes += writes.length;
  if(r.code !== 200) throw fsError_("write", r);
  // One entry per write, in the same order (each has the new updateTime); an empty list is still "true-ish" for old callers.
  try{ return JSON.parse(r.text).writeResults || []; }catch(parseErr){ return []; }
}

// ---- Usage meter ----------------------------------------------------------
function fsTodayKey_(){
  return "FS_USAGE_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
}

// Adds this run's counts to today's running total, and forgets old days.
function fsFlushUsage_(){
  if(FS_USAGE_.calls === 0 && FS_USAGE_.reads === 0 && FS_USAGE_.writes === 0) return;
  var props = PropertiesService.getScriptProperties();
  var key = fsTodayKey_();
  var total = { reads: 0, writes: 0, calls: 0 };
  try{ total = JSON.parse(props.getProperty(key) || "") || total; }catch(err){}
  total.reads  = (total.reads  || 0) + FS_USAGE_.reads;
  total.writes = (total.writes || 0) + FS_USAGE_.writes;
  total.calls  = (total.calls  || 0) + FS_USAGE_.calls;
  props.setProperty(key, JSON.stringify(total));
  FS_USAGE_ = { reads: 0, writes: 0, calls: 0 };
  FS_PERSISTED_ = null;

  var all = props.getProperties();
  Object.keys(all).forEach(function(k){
    if(k.indexOf("FS_USAGE_") === 0 && k !== key) props.deleteProperty(k);
  });
}

// For the health check: today's totals and how much of the free allowance.
function fsUsageToday_(){
  var raw = PropertiesService.getScriptProperties().getProperty(fsTodayKey_());
  var t = { reads: 0, writes: 0, calls: 0 };
  try{ t = JSON.parse(raw || "") || t; }catch(err){}
  return {
    reads: t.reads || 0, writes: t.writes || 0, calls: t.calls || 0,
    readsPct: Math.round(100 * (t.reads || 0) / FS_FREE_READS_PER_DAY_),
    writesPct: Math.round(100 * (t.writes || 0) / FS_FREE_WRITES_PER_DAY_)
  };
}
