// functions/runtime/shim.js
//
// PLAIN-ENGLISH WHAT THIS IS: the finance backend (backend/*.js) was written for Google Apps Script. This file builds a small
// "pretend Apps Script" around it inside Node, so THE SAME CODE runs on Firebase Cloud Functions without being rewritten:
//   Utilities / Session / PropertiesService / CacheService / LockService / UrlFetchApp / ContentService / ScriptApp ...
// There is deliberately NO pretend Google Sheet: the people on the new server keep their data in Firestore (the private copy,
// backend/v2db.js), so nothing here ever needs a real Sheet. If something does try to use one, it fails loudly and the app
// quietly falls back to the Apps Script server.
//
// The on/off switches (V2DB_OWNER / V2DB_USERS / V2_FN_*) live in the Firestore document _system/props, shared with Apps Script (backend/flags.js):
// this server reads them into its own copy of "Script Properties" every 20 seconds, and flagsSet_ writes them back to the same document.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { syncFetch, syncSleep } = require("./syncfetch");
const { getFirestoreToken, getMessagingToken } = require("./tokens");

const TZ = "Asia/Kolkata";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "fin-app-76c40";
const PROPS_DOC = "_system/props";
const PROPS_TTL_MS = 20000;

// Backend files that are NOT loaded: the retired Telegram bot, the statement/Drive features, the (switched off) old mirror, and
// the diagnostics that need a real Sheet. Everything else is loaded in file-name order.
const SKIP_FILES = new Set(["main.js", "handlers.js", "telegram.js", "v2Sync.js", "v2dbDiag.js", "Analysis.js", "Summary.js", "AIAdvisor.js"]);

// ---------------------------------------------------------------- time helpers
function tzParts(ms, tz){
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const o = {};
  f.formatToParts(new Date(ms)).forEach(function(p){ o[p.type] = p.value; });
  return o;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function tzOffsetMinutes(ms, tz){
  const p = tzParts(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// Utilities.formatDate(date, tz, pattern) for the pattern letters this backend uses (y M d H h m s a E Z and 'quoted text').
function formatDate(date, tz, pattern){
  const ms = Object.prototype.toString.call(date) === "[object Date]" ? date.getTime() : new Date(date).getTime();
  if(!isFinite(ms)) throw new Error("Invalid date");
  const p = tzParts(ms, tz || TZ);
  const monthIdx = +p.month - 1;
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const pad = function(n, len){ return String(n).padStart(len, "0"); };
  return String(pattern).replace(/'([^']*)'|y+|M+|d+|H+|h+|m+|s+|a|E+|Z+/g, function(tok, quoted){
    if(quoted !== undefined) return quoted === "" ? "'" : quoted;
    const c = tok[0], n = tok.length;
    if(c === "y") return n === 2 ? String(p.year).slice(-2) : p.year;
    if(c === "M") return n >= 4 ? MONTHS[monthIdx] : n === 3 ? MONTHS[monthIdx].slice(0, 3) : pad(monthIdx + 1, n);
    if(c === "d") return pad(+p.day, n);
    if(c === "H") return pad(+p.hour, n);
    if(c === "h") return pad((+p.hour % 12) || 12, n);
    if(c === "m") return pad(+p.minute, n);
    if(c === "s") return pad(+p.second, n);
    if(c === "a") return +p.hour < 12 ? "AM" : "PM";
    if(c === "E") return n >= 4 ? DAYS[dayIdx] : DAYS[dayIdx].slice(0, 3);
    if(c === "Z"){ const off = tzOffsetMinutes(ms, tz || TZ); const s = off < 0 ? "-" : "+"; const a = Math.abs(off); return s + pad(Math.floor(a / 60), 2) + pad(a % 60, 2); }
    return tok;
  });
}

// Utilities.parseDate for "yyyy-MM-dd" and "yyyy-MM-dd HH:mm:ss" style text, read as a time in the given zone.
function parseDate(text, tz, pattern, DateCtor){
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(text));
  if(!m) throw new Error("Cannot parse date: " + text);
  const asIfUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  let ms = asIfUtc - tzOffsetMinutes(asIfUtc, tz || TZ) * 60000;
  ms = asIfUtc - tzOffsetMinutes(ms, tz || TZ) * 60000;                 // second pass settles daylight-saving edges
  return new DateCtor(ms);
}

// Apps Script returns signed bytes (-128..127) for these; the backend code only ever does `b & 0xff` on them.
const toSigned = function(buf){ return Array.from(buf, function(b){ return b > 127 ? b - 256 : b; }); };
const b64 = function(x){ return Buffer.from(typeof x === "string" ? x : Buffer.from(x.map(function(b){ return b & 0xff; }))).toString("base64"); };
const b64web = function(x){ return b64(x).replace(/\+/g, "-").replace(/\//g, "_"); };

// ---------------------------------------------------------------- the Firestore document that holds the shared switches
function loadSharedProps(){
  const url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/" + PROPS_DOC;
  const r = syncFetch({ url: url, method: "GET", headers: { Authorization: "Bearer " + getFirestoreToken() } });
  if(r.status === 404) return {};
  if(r.status !== 200) throw new Error("Could not read the shared switches (HTTP " + r.status + ").");
  const fields = (JSON.parse(r.text).fields) || {};
  const out = {};
  Object.keys(fields).forEach(function(k){ if(fields[k].stringValue !== undefined) out[k] = fields[k].stringValue; });
  return out;
}

// ---------------------------------------------------------------- building the pretend Apps Script world
function createRuntime(opts){
  opts = opts || {};
  const backendDir = opts.backendDir || path.join(__dirname, "..", "..", "backend");
  const log = opts.log || function(line){ console.log(line); };
  const props = {};                       // Script Properties (in this instance's memory)
  let propsLoadedAt = 0;
  const cacheStore = new Map();           // CacheService: key -> { value, until }

  const sandbox = { console: console };
  vm.createContext(sandbox);
  const SDate = vm.runInContext("Date", sandbox);

  const makeProps = function(){
    return {
      getProperty: function(k){ return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
      setProperty: function(k, v){ props[k] = String(v); return this; },
      deleteProperty: function(k){ delete props[k]; return this; },
      getProperties: function(){ return Object.assign({}, props); },
      setProperties: function(o){ Object.keys(o || {}).forEach(function(k){ props[k] = String(o[k]); }); return this; }
    };
  };
  const scriptProps = makeProps();
  sandbox.PropertiesService = { getScriptProperties: function(){ return scriptProps; }, getUserProperties: function(){ return makeProps(); }, getDocumentProperties: function(){ return makeProps(); } };

  const makeCache = function(){
    return {
      get: function(k){ const e = cacheStore.get(k); if(!e) return null; if(e.until < Date.now()){ cacheStore.delete(k); return null; } return e.value; },
      put: function(k, v, ttl){ cacheStore.set(k, { value: String(v), until: Date.now() + (ttl || 600) * 1000 }); },
      remove: function(k){ cacheStore.delete(k); }
    };
  };
  const theCache = makeCache();
  sandbox.CacheService = { getScriptCache: function(){ return theCache; }, getUserCache: function(){ return theCache; }, getDocumentCache: function(){ return theCache; } };

  // One request at a time per instance (see syncfetch.js), but there can be several instances AND Apps Script saving at the same time,
  // so the lock is the shared Firestore "lease" (backend/sharedLock.js, defined once the backend files are loaded below).
  sandbox.V2_ON_NEW_SERVER_ = true;
  sandbox.LockService = { getScriptLock: function(){ return sandbox.fsLeaseLock_(); }, getUserLock: function(){ return sandbox.fsLeaseLock_(); } };

  sandbox.Utilities = {
    formatDate: formatDate,
    parseDate: function(text, tz, pattern){ return parseDate(text, tz, pattern, SDate); },
    getUuid: function(){ return crypto.randomUUID(); },
    sleep: function(ms){ syncSleep(ms); },
    base64Encode: b64,
    base64EncodeWebSafe: b64web,
    base64Decode: function(s){ return toSigned(Buffer.from(String(s), "base64")); },
    base64DecodeWebSafe: function(s){ return toSigned(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")); },
    DigestAlgorithm: { MD5: "md5", SHA_1: "sha1", SHA_256: "sha256", SHA_512: "sha512" },
    computeDigest: function(alg, input){ return toSigned(crypto.createHash(alg).update(typeof input === "string" ? input : Buffer.from(input)).digest()); },
    computeRsaSha256Signature: function(input, key){ return toSigned(crypto.sign("RSA-SHA256", Buffer.from(input), key)); },
    newBlob: function(){ throw new Error("Files are not handled on this server."); }
  };
  sandbox.Session = { getScriptTimeZone: function(){ return TZ; }, getActiveUser: function(){ return { getEmail: function(){ return ""; } }; } };
  sandbox.Logger = { log: function(){} };
  sandbox.ScriptApp = { getProjectTriggers: function(){ return []; }, getOAuthToken: function(){ return ""; } };

  sandbox.UrlFetchApp = {
    fetch: function(url, o){
      o = o || {};
      const method = String(o.method || "get").toUpperCase();
      const headers = Object.assign({}, o.headers || {});
      let body = o.payload;
      if(body !== undefined && body !== null && typeof body !== "string"){
        // an object payload is sent as a web form, exactly like Apps Script does
        body = Object.keys(body).map(function(k){ return encodeURIComponent(k) + "=" + encodeURIComponent(body[k]); }).join("&");
        if(!o.contentType) headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      if(o.contentType) headers["Content-Type"] = o.contentType;
      const r = syncFetch({ url: String(url), method: method, headers: headers, body: body, followRedirects: o.followRedirects });
      if(!o.muteHttpExceptions && (r.status < 200 || r.status >= 300)){
        throw new Error("Request failed for " + url + " returned code " + r.status + ". Truncated server response: " + r.text.slice(0, 200));
      }
      return { getResponseCode: function(){ return r.status; }, getContentText: function(){ return r.text; }, getHeaders: function(){ return r.headers; } };
    }
  };

  sandbox.ContentService = {
    MimeType: { JSON: "application/json", TEXT: "text/plain" },
    createTextOutput: function(text){ return { getContent: function(){ return text; }, setMimeType: function(){ return this; } }; }
  };

  // There is no real Sheet on this server. Anything that tries to use one fails loudly (the app then falls back to Apps Script).
  const noSheet = function(){ throw new Error("This server has no Google Sheet (that person is not on the new server yet)."); };
  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet: function(){ return { getSheetByName: function(){ return null; }, getSheets: function(){ return []; }, insertSheet: noSheet, getSpreadsheetTimeZone: function(){ return TZ; } }; },
    openById: noSheet, create: noSheet
  };

  // ---- load the backend files (same global scope, like Apps Script) ----
  const files = fs.readdirSync(backendDir).filter(function(f){ return f.endsWith(".js") && !SKIP_FILES.has(f); }).sort();
  files.forEach(function(f){
    let src = fs.readFileSync(path.join(backendDir, f), "utf8");
    // Local testing only: a made-up "owner" so a test never touches the real owner's data. Refused on Firebase itself.
    if(opts.ownerEmail && f === "PWA.js"){
      if(process.env.K_SERVICE) throw new Error("The test owner shortcut must never run on Firebase.");
      src = src.replace(/const PWA_ALLOWED_EMAIL = "[^"]*";/, 'const PWA_ALLOWED_EMAIL = ' + JSON.stringify(String(opts.ownerEmail)) + ';');
    }
    vm.runInContext(src, sandbox, { filename: f });
  });

  // ---- overrides that replace Apps Script-only behaviour ----
  // Firestore sign-in uses this server's own identity instead of a key kept in Script Properties.
  sandbox.__firestoreToken = getFirestoreToken;
  vm.runInContext("fsAccessToken_ = function(){ return __firestoreToken(); };", sandbox);
  sandbox.__projectId = PROJECT_ID;
  vm.runInContext("fsServiceAccount_ = function(){ return { project_id: __projectId, client_email: 'cloud-functions' }; };", sandbox);
  // Logs go to Cloud Logging (searchable in the Firebase console) instead of the AILogs tab.
  sandbox.__log = function(type, message){ log(JSON.stringify({ severity: /ERROR/i.test(type) ? "ERROR" : "INFO", type: type, message: String(message).slice(0, 1500) })); };
  vm.runInContext("logAI = function(type, message){ __log(type, message); };", sandbox);
  // The retired Telegram bot file is not loaded here, but a few shared functions still read its helpers. Same behaviour as the originals
  // with Telegram off: nothing is sent to Telegram; a message becomes a push notification (first line = title).
  vm.runInContext(`
    var TELEGRAM_ENABLED = false;
    function getConfig(){ return { BOT_TOKEN: "", CHAT_ID: "", GEMINI_KEY: PropertiesService.getScriptProperties().getProperty("GEMINI_KEY") }; }
    function sendMessage(text){
      var lines = String(text).split("\\n").filter(function(l){ return l.trim() !== ""; });
      sendPushNotification(lines[0] || "Fin App", lines.slice(1).join(" ").trim() || "Open the app for details.");
    }
  `, sandbox);
  // Push notifications (e.g. "Vaidehi split a payment with you"): Apps Script signs in with a key kept in Script Properties; this server
  // uses its own identity instead (same message, same Firebase project). Never throws, like the original.
  sandbox.__fcmToken = getMessagingToken;
  vm.runInContext(`
    sendPushToToken_ = function(deviceToken, title, body, extraData){
      try{
        if(!deviceToken) return { sent: false, code: 0, detail: "no device registered" };
        var accessToken = __fcmToken();
        if(!accessToken) return { sent: false, code: 0, detail: "no access token" };
        var dataPayload = { title: title, body: body };
        if(extraData){
          Object.keys(extraData).forEach(function(key){
            if(extraData[key] !== null && extraData[key] !== undefined) dataPayload[key] = String(extraData[key]);
          });
        }
        var response = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + __projectId + "/messages:send", {
          method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + accessToken },
          payload: JSON.stringify({ message: { token: deviceToken, data: dataPayload } }), muteHttpExceptions: true
        });
        logAI("PUSH_SENT", response.getContentText());
        return { sent: response.getResponseCode() === 200, code: response.getResponseCode(), detail: String(response.getContentText()).slice(0, 150) };
      }catch(err){
        logAI("PUSH_ERROR", err.toString());
        return { sent: false, code: -1, detail: String(err).slice(0, 150) };
      }
    };
  `, sandbox);
  // Wrong-key limit for the SMS doors: the count lives in each server instance's own memory and there can be several instances, so each one
  // allows fewer wrong keys a minute than Apps Script does (30). A real phone never sends a wrong key.
  vm.runInContext("INGEST_MAX_BAD_PER_MIN_ = 6;", sandbox);
  // A person who is not on the Firestore copy has nowhere to work on this server: tell the app to use Apps Script instead.
  vm.runInContext(`
    var __origRoute = v2RouteAndDispatch_;
    v2RouteAndDispatch_ = function(data, verified){
      if(v2EngineFor_(verified.email) !== "v2db") return jsonResponse({ ok: false, fallback: true, error: "Not on the new server yet." });
      return __origRoute(data, verified);
    };
  `, sandbox);
  // Local testing only: pretend the sign-in check passed for this email. Refused on Firebase itself.
  if(opts.localEmail){
    if(process.env.K_SERVICE) throw new Error("The local sign-in shortcut must never run on Firebase.");
    sandbox.__localEmail = opts.localEmail;
    vm.runInContext("verifyGoogleIdToken = function(t){ return t === 'local' ? { email: __localEmail, name: 'Local test' } : null; };", sandbox);
  }

  function refreshProps(){
    if(Date.now() - propsLoadedAt < PROPS_TTL_MS) return;
    const shared = opts.sharedProps ? opts.sharedProps() : loadSharedProps();
    Object.keys(shared).forEach(function(k){ props[k] = shared[k]; });
    // a switch that was removed in Apps Script must disappear here too
    ["V2DB_OWNER", "V2DB_USERS", "V2_FN_WRITES", "V2DB_OWNER_DIRECT", "V2_FN_SMS", "V2_FN_TIMER"].forEach(function(k){ if(!(k in shared)) delete props[k]; });
    propsLoadedAt = Date.now();
  }

  // True when the owner has allowed this server to take bank SMS (Apps Script: v2dbEnableFunctionSms()). Re-read every 20 s.
  function smsEnabled(){
    refreshProps();
    return props.V2_FN_SMS === "on";
  }

  // True when the owner has allowed this server to SAVE (Apps Script: v2dbEnableFunctionWrites()). Re-read every 20 s.
  function writesEnabled(){
    refreshProps();
    return props.V2_FN_WRITES === "on";
  }

  // The alert timer (added 2026-10-14): called by the scheduled function "tick" every 5 minutes. Does nothing unless the owner has switched the
  // new-server timer on (Apps Script: v2dbEnableFunctionTimer()) AND saving on the new server is on. See backend/fnTimer.js.
  function runTimer(){
    refreshProps();
    if(props.V2_FN_TIMER !== "on" || props.V2_FN_WRITES !== "on") return { ran: false, reason: "switch off" };
    return sandbox.timerTick_();
  }

  // Adds this instance's Firestore usage counts to the shared daily total (backend/firestore.js fsFlushUsage_). Called before each answer is sent
  // (the server may be paused right after replying). At most every 20 seconds unless forced, so a busy minute costs a handful of writes, not one per request.
  let lastUsageFlush = 0;
  function flushUsage(force){
    const now = Date.now();
    if(!force && now - lastUsageFlush < 20000) return;
    lastUsageFlush = now;
    try{ sandbox.fsFlushUsage_(); }catch(e){ /* the meter never matters more than the request */ }
  }

  // Runs one request through the REAL backend code and returns the parsed answer.
  function call(data){
    refreshProps();
    const out = sandbox.handlePwaRequest(data);
    return JSON.parse(out.getContent());
  }

  return { sandbox: sandbox, call: call, props: props, refreshProps: refreshProps, writesEnabled: writesEnabled, smsEnabled: smsEnabled, runTimer: runTimer, flushUsage: flushUsage, filesLoaded: files };
}

module.exports = { createRuntime, formatDate, parseDate, tzOffsetMinutes };
