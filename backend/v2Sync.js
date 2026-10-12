// v2Sync.js (added 2026-10-12)
//
// PLAIN-ENGLISH WHAT THIS IS: "step 2" of the plan to make Firestore the app's real database
// (docs/v2-firestore-native.md). Every few minutes it copies whatever CHANGED in the Google
// Sheet into the owner's private Firestore folder, so the Firestore copy never goes stale.
// The Sheet is still the record; nothing reads this copy yet. It changes nothing in the Sheet
// (except its own small bookkeeping tab, "_V2Sync").
//
// HOW IT STAYS CORRECT
// - It builds, from the Sheet, the exact documents tools/v2_migrate.py wrote (the same field names,
//   ids and paise/date rules). tools/test_v2_migrate.py + backend/tests/v2Sync.test.js prove the two
//   languages agree on the real data, and `python tools/v2_migrate.py --verify` re-checks Firestore.
// - A fingerprint (hash) of every document is remembered in the hidden "_V2Sync" tab, so each run
//   writes ONLY documents that changed, adds new ones and deletes the ones whose row is gone.
//   (Reading the Sheet is free; this keeps Firestore writes tiny.)
// - Safety: it never deletes in bulk (a sudden drop in rows is treated as a read problem and the
//   run is abandoned), one run at a time (a lock), and any failure is logged once an hour and
//   never stops a transaction, a notification or a save. It runs AFTER the real work of the
//   background timer (see transactions.js), at most every 3 minutes.
// - Everything written goes under users/<owner>/<collection>/ for the 14 collections below only.
//   It never touches friends, splitMarkers, debtMoves or views.

// SWITCHED OFF 2026-10-13: in real Apps Script one run took 148 seconds (about 2 minutes), far more than the few seconds measured in tests
// (every date/time cell costs a Utilities.formatDate call). At that speed it would eat the daily trigger-runtime allowance that also runs the
// transaction alerts. The Firestore-backed virtual spreadsheet (v2db.js) replaces this mirror, so it stays off.
var V2SYNC_ENABLED_ = false;             // flip to true to run the mirror again (not recommended)
var V2SYNC_MIN_GAP_SEC_ = 600;           // at most every 10 minutes (keeps the daily trigger-runtime quota safe)
var V2SYNC_TAB_ = "_V2Sync";
var V2SYNC_TZ_ = "Asia/Kolkata";
var V2SYNC_BATCH_ = 300;
var V2SYNC_MAX_DELETES_ = 25;

// ---------------------------------------------------------------- small converters
// The Sheet's own time zone (date/time cells must be read as the wall-clock the Sheet shows).
var V2SYNC_TZ_CACHE_ = null;
function v2Tz_(){
  if(V2SYNC_TZ_CACHE_) return V2SYNC_TZ_CACHE_;
  var tz = V2SYNC_TZ_;
  try{ var z = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); if(z) tz = z; }catch(ignore){}
  V2SYNC_TZ_CACHE_ = tz;
  return tz;
}

function v2IsDate_(v){ return Object.prototype.toString.call(v) === "[object Date]"; }

function v2Text_(v){
  if(v === null || v === undefined) return "";
  if(typeof v === "boolean") return v ? "True" : "False";
  if(typeof v === "number") return String(v);
  if(v2IsDate_(v)) return isNaN(v.getTime()) ? "" : Utilities.formatDate(v, v2Tz_(), "yyyy-MM-dd'T'HH:mm:ss");
  return String(v).trim();
}

// Rupees (number or text) -> whole paise, EXACTLY (no floating-point drift): the digits of the
// number are read as text and the third decimal digit decides rounding (half up), like the Python side.
function v2Paise_(x){
  if(x === null || x === undefined || x === "") return 0;
  var s = String(x).replace(/,/g, "").trim();
  if(typeof x === "number"){
    if(!isFinite(x)) return 0;
    if(/e/i.test(s)) s = x.toFixed(10);
  }
  var m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if(!m || (m[2] === "" && !m[3])) return 0;
  var frac = (m[3] || "") + "000";
  var cents = parseInt(m[2] || "0", 10) * 100 + parseInt(frac.slice(0, 2), 10) + (parseInt(frac.charAt(2), 10) >= 5 ? 1 : 0);
  return m[1] === "-" ? -cents : cents;
}

var V2SYNC_MONTHS_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
var V2SYNC_MONTHS_FULL_ = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function v2Pad2_(n){ return (n < 10 ? "0" : "") + n; }

function v2ValidYmd_(y, mo, d){
  if(!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  var t = new Date(Date.UTC(y, mo - 1, d));
  if(t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return y + "-" + v2Pad2_(mo) + "-" + v2Pad2_(d);
}

// A date cell -> "yyyy-MM-dd", "" when blank, or null when it can't be read (never guessed).
function v2DateStr_(v){
  if(v === null || v === undefined || v === "") return "";
  if(v2IsDate_(v)) return isNaN(v.getTime()) ? null : Utilities.formatDate(v, v2Tz_(), "yyyy-MM-dd");
  if(typeof v === "number"){
    var t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return t.getUTCFullYear() + "-" + v2Pad2_(t.getUTCMonth() + 1) + "-" + v2Pad2_(t.getUTCDate());
  }
  var s = String(v).trim(), m;
  if((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return v2ValidYmd_(+m[3], +m[2], +m[1]);
  if((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return v2ValidYmd_(+m[1], +m[2], +m[3]);
  if((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s))) return v2ValidYmd_(+m[3], +m[2], +m[1]);
  if((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s))) return v2ValidYmd_(+m[3] < 69 ? 2000 + +m[3] : 1900 + +m[3], +m[2], +m[1]);
  if((m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s))) return V2SYNC_MONTHS_[m[2].toLowerCase()] ? v2ValidYmd_(+m[3], V2SYNC_MONTHS_[m[2].toLowerCase()], +m[1]) : null;
  if((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s))) return V2SYNC_MONTHS_[m[2].toLowerCase()] ? v2ValidYmd_(+m[3], V2SYNC_MONTHS_[m[2].toLowerCase()], +m[1]) : null;
  if((m = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(s))) return V2SYNC_MONTHS_FULL_[m[2].toLowerCase()] ? v2ValidYmd_(+m[3], V2SYNC_MONTHS_FULL_[m[2].toLowerCase()], +m[1]) : null;
  return null;
}

// A time cell -> "HH:mm:ss" (rounded to the nearest second, never 24:00:00).
function v2TimeStr_(v){
  var secs;
  if(v === null || v === undefined || v === "") return "00:00:00";
  if(v2IsDate_(v)){
    if(isNaN(v.getTime())) return "00:00:00";
    var hh = +Utilities.formatDate(v, v2Tz_(), "HH"), mm = +Utilities.formatDate(v, v2Tz_(), "mm"),
        ss = +Utilities.formatDate(v, v2Tz_(), "ss"), ms = +Utilities.formatDate(v, v2Tz_(), "SSS");
    secs = hh * 3600 + mm * 60 + ss + (ms >= 500 ? 1 : 0);
  } else if(typeof v === "number"){
    secs = Math.round((v - Math.floor(v)) * 86400);
  } else {
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v).trim());
    if(!m) return "00:00:00";
    return v2Pad2_(+m[1]) + ":" + m[2] + ":" + v2Pad2_(+(m[3] || 0));
  }
  if(secs >= 86400) secs = 86399;
  return v2Pad2_(Math.floor(secs / 3600)) + ":" + v2Pad2_(Math.floor((secs % 3600) / 60)) + ":" + v2Pad2_(secs % 60);
}

// "yyyy-MM-dd" + "HH:mm:ss" read as India time -> an exact moment (a Date).
function v2Ts_(dateStr, timeStr){
  if(!dateStr) return null;
  var d = dateStr.split("-"), t = timeStr.split(":");
  return new Date(Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1], +t[2]) - 330 * 60000);
}

// A date-time cell (a real Date, or a day-number) -> an exact moment rounded to the second, or null.
function v2TsCell_(v){
  if(v2IsDate_(v)){
    if(isNaN(v.getTime())) return null;
    return new Date(Math.round(v.getTime() / 1000) * 1000);
  }
  if(typeof v === "number" && v > 0){
    var ms = Date.UTC(1899, 11, 30) + v * 86400000 - 330 * 60000;
    return new Date(Math.round(ms / 1000) * 1000);
  }
  return null;
}

// A language-neutral key for a date-time cell (used inside document ids): the rounded UTC second, or "".
function v2TsKey_(v){
  var d = v2TsCell_(v);
  return d ? d.toISOString().slice(0, 19) + "Z" : "";
}

// SHA-1 written out in plain JavaScript: thousands of ids per run without a Utilities call each.
// tests/v2Sync.test.js proves it equals the real SHA-1 (so ids still match the Python copy).
function v2Utf8Bytes_(str){
  var out = [], enc = unescape(encodeURIComponent(str));
  for(var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
  return out;
}

function v2Sha1Hex_(str){
  var bytes = v2Utf8Bytes_(str), bitLen = bytes.length * 8;
  bytes.push(0x80);
  while(bytes.length % 64 !== 56) bytes.push(0);
  var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
  [hi, lo].forEach(function(n){ bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); });
  var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, w = new Array(80);
  var rotl = function(x, n){ return (x << n) | (x >>> (32 - n)); };
  for(var off = 0; off < bytes.length; off += 64){
    for(var t = 0; t < 16; t++) w[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
    for(t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    var a = h0, b = h1, c = h2, d = h3, e = h4;
    for(t = 0; t < 80; t++){
      var f, k;
      if(t < 20){ f = (b & c) | (~b & d); k = 0x5A827999; }
      else if(t < 40){ f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if(t < 60){ f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      var tmp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map(function(n){ return ("00000000" + (n >>> 0).toString(16)).slice(-8); }).join("");
}

function v2Sha_(parts, n){
  return v2Sha1Hex_(parts.map(String).join("|")).slice(0, n || 24);
}

function v2Pad_(row, width){
  var r = row.slice();
  while(r.length < width) r.push("");
  return r;
}

function v2IsBlankRow_(row){
  return row.every(function(c){ return c === "" || c === null || c === undefined; });
}

function v2Int_(v){ return typeof v === "number" ? Math.trunc(v) : 0; }

// ---------------------------------------------------------------- one mapper per tab (mirror of tools/v2_migrate.py)
function v2MapTransaction_(row){
  var r = v2Pad_(row, 21);
  var dateS = v2DateStr_(r[0]), timeS = v2TimeStr_(r[1]), amountP = v2Paise_(r[5]);
  if(!dateS && !amountP && !v2Text_(r[7])) return null;
  var doc = {
    date: dateS !== null ? dateS : "", dateRaw: dateS !== null ? "" : v2Text_(r[0]),
    time: timeS, ts: dateS ? v2Ts_(dateS, timeS) : null,
    bank: v2Text_(r[2]), type: v2Text_(r[3]).toLowerCase(), mode: v2Text_(r[4]), amountPaise: amountP,
    reference: v2Text_(r[6]), counterparty: v2Text_(r[7]), channel: v2Text_(r[8]), source: v2Text_(r[9]),
    rawSms: v2Text_(r[10]), sender: v2Text_(r[11]), note: v2Text_(r[12]), category: v2Text_(r[13]),
    telegramMsgId: v2Text_(r[14]), processed: v2Text_(r[15]), needWantSaving: v2Text_(r[16]),
    financialEvent: v2Text_(r[17]), financialEventName: v2Text_(r[18]), autoSettled: v2Text_(r[19]),
    friendSharePaise: v2Paise_(r[20])
  };
  return { id: v2Sha_([doc.date, doc.time, doc.type, doc.bank, doc.reference, doc.counterparty, doc.amountPaise]), doc: doc };
}

function v2MapCash_(row){
  var r = v2Pad_(row, 11);
  var dateS = v2DateStr_(r[1]), amountP = v2Paise_(r[4]);
  if(!dateS && !amountP && !v2Text_(r[5])) return null;
  var created = v2TsCell_(r[9]) || (dateS ? v2Ts_(dateS, v2TimeStr_(r[2])) : null);
  var doc = { date: dateS !== null ? dateS : "", time: v2TimeStr_(r[2]), type: v2Text_(r[3]).toLowerCase(),
              amountPaise: amountP, note: v2Text_(r[5]), category: v2Text_(r[6]), source: v2Text_(r[7]),
              telegramMsgId: v2Text_(r[8]), createdAt: created, needWantSaving: v2Text_(r[10]) };
  return { id: v2Sha_([doc.date, doc.time, doc.type, doc.amountPaise, doc.note, v2Text_(r[8]), v2TsKey_(r[9])]), doc: doc };
}

function v2MapDebt_(row){
  var r = v2Pad_(row, 8);
  if(!v2Text_(r[1]) && !v2Paise_(r[3])) return null;
  var doc = { date: v2DateStr_(r[0]) || "", person: v2Text_(r[1]), type: v2Text_(r[2]).toUpperCase(), amountPaise: v2Paise_(r[3]),
              note: v2Text_(r[4]), dueDate: v2DateStr_(r[5]) || "", status: v2Text_(r[6]) || "Pending", settledDate: v2DateStr_(r[7]) || "" };
  return { id: v2Sha_([doc.date, doc.person, doc.type, doc.amountPaise, doc.note, doc.dueDate]), doc: doc };
}

function v2MapSaving_(row){
  var r = v2Pad_(row, 5);
  if(!v2Paise_(r[1]) && !v2Text_(r[3])) return null;
  var doc = { date: v2DateStr_(r[0]) || "", amountPaise: v2Paise_(r[1]), type: v2Text_(r[2]), note: v2Text_(r[3]), destination: v2Text_(r[4]) };
  return { id: v2Sha_([doc.date, doc.amountPaise, doc.type, doc.note, doc.destination]), doc: doc };
}

function v2MapGoal_(row){
  var r = v2Pad_(row, 6);
  if(!v2Text_(r[0])) return null;
  var doc = { name: v2Text_(r[0]), type: v2Text_(r[1]), targetPaise: v2Paise_(r[2]), status: v2Text_(r[3]),
              priority: typeof r[4] === "boolean" ? r[4] : v2Text_(r[4]).toLowerCase() === "true", dateAdded: v2DateStr_(r[5]) || "" };
  return { id: v2Sha_([doc.name]), doc: doc };
}

function v2MapInvestment_(row){
  var r = v2Pad_(row, 4);
  if(!v2Text_(r[1]) && !v2Paise_(r[2])) return null;
  var doc = { date: v2DateStr_(r[0]) || "", name: v2Text_(r[1]), amountPaise: v2Paise_(r[2]), note: v2Text_(r[3]) };
  return { id: v2Sha_([doc.date, doc.name, doc.amountPaise, doc.note]), doc: doc };
}

function v2MapInstrument_(row){
  var r = v2Pad_(row, 3);
  if(!v2Text_(r[0])) return null;
  var doc = { name: v2Text_(r[0]), category: v2Text_(r[1]), sipAmountPaise: v2Paise_(r[2]) };
  return { id: v2Sha_([doc.name]), doc: doc };
}

function v2MapFinEvent_(row){
  var r = v2Pad_(row, 5);
  if(!v2Text_(r[0])) return null;
  var doc = { type: v2Text_(r[0]), amountPaise: v2Paise_(r[1]), counterparty: v2Text_(r[2]), confirmedAt: v2TsCell_(r[3]), name: v2Text_(r[4]) };
  return { id: v2Sha_([doc.type, doc.amountPaise, doc.counterparty, v2TsKey_(r[3])]), doc: doc };
}

function v2MapBudget_(row){
  var r = v2Pad_(row, 4);
  if(!v2Text_(r[1])) return null;
  var m = v2DateStr_(r[0]);
  m = m ? m.slice(0, 7) : "";
  var doc = { month: m, category: v2Text_(r[1]), type: v2Text_(r[2]), targetPaise: v2Paise_(r[3]) };
  return { id: v2Sha_([m, doc.category, doc.type]), doc: doc };
}

function v2MapSmartMemory_(row){
  var r = v2Pad_(row, 6);
  if(!v2Text_(r[0])) return null;
  var doc = { merchant: v2Text_(r[0]), category: v2Text_(r[1]), subcategory: v2Text_(r[2]), confidence: v2Int_(r[3]),
              timesUsed: v2Int_(r[4]), lastUsed: v2TsCell_(r[5]) };
  return { id: v2Sha_([doc.merchant.toLowerCase()]), doc: doc };
}

function v2MapNoteMemory_(row){
  var r = v2Pad_(row, 5);
  if(!v2Text_(r[0])) return null;
  var doc = { merchant: v2Text_(r[0]), amountBand: v2Text_(r[1]), note: v2Text_(r[2]), timesUsed: v2Int_(r[3]), lastUsed: v2TsCell_(r[4]) };
  return { id: v2Sha_([doc.merchant.toLowerCase(), doc.amountBand]), doc: doc };
}

function v2MapSpam_(row){
  var r = v2Pad_(row, 4);
  if(!v2Text_(r[2])) return null;
  var doc = { learnedAt: v2TsCell_(r[0]), sender: v2Text_(r[1]), template: v2Text_(r[2]), example: v2Text_(r[3]) };
  return { id: v2Sha_([doc.sender, doc.template]), doc: doc };
}

// [sheet tab, Firestore collection, mapper, tab has a header row]
var V2SYNC_TABS_ = [
  ["Transactions", "transactions", v2MapTransaction_, true],
  ["Transactions_Ignored", "transactionsIgnored", v2MapTransaction_, true],
  ["Cash", "cash", v2MapCash_, true],
  ["Debts", "debts", v2MapDebt_, true],
  ["Savings", "savings", v2MapSaving_, true],
  ["Goals", "goals", v2MapGoal_, true],
  ["Investments", "investments", v2MapInvestment_, true],
  ["InvestmentInstruments", "instruments", v2MapInstrument_, true],
  ["FinancialEvents", "financialEvents", v2MapFinEvent_, true],
  ["Budgets", "budgets", v2MapBudget_, true],
  ["SmartMemory", "smartMemory", v2MapSmartMemory_, true],
  ["NoteMemory", "noteMemory", v2MapNoteMemory_, true],
  ["LearnedSpamPatterns", "learnedSpamPatterns", v2MapSpam_, false]
];
var V2SYNC_COLLECTIONS_ = V2SYNC_TABS_.map(function(t){ return t[1]; }).concat(["typeVotes"]);

// Same-looking rows get -2, -3 ... in sheet order (identical to the Python side).
function v2BuildDocs_(rows, mapper, hasHeader){
  var data = hasHeader ? rows.slice(1) : rows, docs = {}, seen = {};
  data.forEach(function(row){
    if(v2IsBlankRow_(row)) return;
    var m = mapper(row);
    if(!m) return;
    seen[m.id] = (seen[m.id] || 0) + 1;
    docs[seen[m.id] === 1 ? m.id : m.id + "-" + seen[m.id]] = m.doc;
  });
  return docs;
}

// TypeVotes: the order matters (the newest votes decide), so each vote keeps its place in line.
function v2BuildTypeVotes_(rows){
  var docs = {};
  rows.slice(1).forEach(function(row, i){
    var r = v2Pad_(row, 4);
    if(!v2Text_(r[0])) return;
    docs[("000000" + (i + 1)).slice(-6)] = { seq: i + 1, merchant: v2Text_(r[0]), amountBand: v2Text_(r[1]), type: v2Text_(r[2]), votedAt: v2TsCell_(r[3]) };
  });
  return docs;
}

// A fingerprint of one document's contents (field order and timestamp formatting don't matter).
function v2HashDoc_(doc){
  var keys = Object.keys(doc).sort(), parts = keys.map(function(k){
    var v = doc[k];
    return k + "=" + (v2IsDate_(v) ? "T" + v.toISOString().slice(0, 19) : (v === null ? "null" : typeof v + ":" + v));
  });
  return v2Sha_([parts.join("\u0001")], 16);
}

// ---------------------------------------------------------------- reading the Sheet
function v2ReadTab_(ss, name){
  var sh = ss.getSheetByName(name);
  if(!sh) return null;
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if(lr < 1 || lc < 1) return [];
  return sh.getRange(1, 1, lr, lc).getValues();
}

// -> { collection: { id: { doc, hash } } } built from the whole Sheet. Missing tabs give an empty collection.
function v2BuildAll_(ss){
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var all = {};
  var add = function(coll, docs){
    all[coll] = {};
    Object.keys(docs).forEach(function(id){ all[coll][id] = { doc: docs[id], hash: v2HashDoc_(docs[id]) }; });
  };
  V2SYNC_TABS_.forEach(function(t){
    var rows = v2ReadTab_(ss, t[0]);
    add(t[1], rows ? v2BuildDocs_(rows, t[2], t[3]) : {});
  });
  var tv = v2ReadTab_(ss, "TypeVotes");
  add("typeVotes", tv ? v2BuildTypeVotes_(tv) : {});
  return all;
}

// ---------------------------------------------------------------- remembered fingerprints (hidden tab)
function v2LoadState_(ss){
  var sh = ss.getSheetByName(V2SYNC_TAB_), state = {};
  if(!sh || sh.getLastRow() < 1) return { sheet: sh, state: state };
  sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function(r){ if(r[0]) state[String(r[0])] = String(r[1]); });
  return { sheet: sh, state: state };
}

function v2SaveState_(ss, sheet, state){
  if(!sheet){
    sheet = ss.insertSheet(V2SYNC_TAB_);
    try{ sheet.hideSheet(); }catch(ignore){}
  }
  var keys = Object.keys(state).sort();
  var oldRows = sheet.getLastRow();
  if(keys.length) sheet.getRange(1, 1, keys.length, 2).setValues(keys.map(function(k){ return [k, state[k]]; }));
  if(oldRows > keys.length) sheet.getRange(keys.length + 1, 1, oldRows - keys.length, 2).clearContent();
  return sheet;
}

// ---------------------------------------------------------------- the sync itself
// FIRST RUN (no fingerprints remembered yet): do not blindly write everything. Look at what is already in
// Firestore (the verified Python copy) and ADOPT it: documents that are already identical are simply
// remembered; only missing/different ones get written. If the ids disagree wholesale (for example the two
// languages read time cells differently), stop and write NOTHING, so a wrong guess can never create duplicates.
function v2Bootstrap_(owner, built, state){
  var info = { liveDocs: 0, equal: 0, missing: 0, different: 0, extra: 0, built: 0 };
  V2SYNC_COLLECTIONS_.forEach(function(coll){
    var live = {};
    fsListPath_("users/" + owner + "/" + coll, 5000).forEach(function(d){ live[d.id] = d; });
    info.liveDocs += Object.keys(live).length;
    Object.keys(built[coll]).forEach(function(id){
      info.built++;
      var l = live[id];
      if(!l){ info.missing++; return; }
      if(v2NormalizeTyped_(l.raw) === v2NormalizeTyped_(fsEncodeFields_(built[coll][id].doc))){ info.equal++; state[coll + "/" + id] = built[coll][id].hash; }
      else info.different++;
    });
    Object.keys(live).forEach(function(id){
      if(!built[coll][id]){ info.extra++; state[coll + "/" + id] = "extra"; }       // queued for deletion (the delete guard still applies)
    });
  });
  return info;
}

// Returns { written, deleted, unchanged, skipped?, error? }. Safe to call any time.
function v2SyncSheetToFirestore_(opts){
  opts = opts || {};
  if(!V2SYNC_ENABLED_ && !opts.force) return { skipped: "disabled" };
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(2000)) return { skipped: "busy" };
  var ss = null, loaded = null, state = {}, stateChanged = false;
  try{
    ss = SpreadsheetApp.getActiveSpreadsheet();
    loaded = v2LoadState_(ss);
    state = loaded.state;
    var owner = String(PWA_ALLOWED_EMAIL).toLowerCase();
    var built = v2BuildAll_(ss);

    var builtTotal = 0;
    V2SYNC_COLLECTIONS_.forEach(function(coll){ builtTotal += Object.keys(built[coll]).length; });

    if(Object.keys(state).length === 0 && builtTotal > 0){
      var boot = v2Bootstrap_(owner, built, state);
      var bad = boot.missing + boot.different;
      if(boot.liveDocs > 0 && builtTotal >= 20 && bad > builtTotal * 0.05){
        state = {};                                    // remember nothing, write nothing
        var sample = built.transactions && Object.keys(built.transactions).length ? built.transactions[Object.keys(built.transactions)[0]].doc : null;
        v2LogOncePerHour_("first run stopped, nothing written: Firestore already has " + boot.liveDocs + " documents but only " + boot.equal + " of " + builtTotal +
          " match what the Sheet gives (missing " + boot.missing + ", different " + boot.different + ", extra " + boot.extra + "). The ids probably differ." +
          (sample ? " Sample row reads as date " + sample.date + " time " + sample.time + "." : ""));
        return { skipped: "bootstrap-mismatch", info: boot };
      }
      stateChanged = true;                             // the adopted fingerprints must be saved
    }

    var sets = [], dels = [], seenKeys = {}, builtCount = 0;
    V2SYNC_COLLECTIONS_.forEach(function(coll){
      Object.keys(built[coll]).forEach(function(id){
        var key = coll + "/" + id;
        seenKeys[key] = true;
        builtCount++;
        if(state[key] !== built[coll][id].hash) sets.push({ coll: coll, id: id, key: key });
      });
    });
    Object.keys(state).forEach(function(key){ if(!seenKeys[key]) dels.push(key); });

    // Safety: a sudden big drop almost certainly means the Sheet could not be read properly. Do nothing.
    var known = Object.keys(state).length;
    if(known > 50 && builtCount < known * 0.5){
      v2LogOncePerHour_("abandoned: the Sheet now gives " + builtCount + " documents, was " + known);
      stateChanged = false;
      return { skipped: "row-drop-guard" };
    }
    if(dels.length > V2SYNC_MAX_DELETES_){
      v2LogOncePerHour_("not deleting " + dels.length + " documents at once (limit " + V2SYNC_MAX_DELETES_ + ")");
      dels = [];
    }

    var written = 0, deleted = 0;
    for(var i = 0; i < sets.length; i += V2SYNC_BATCH_){
      var chunk = sets.slice(i, i + V2SYNC_BATCH_);
      fsCommit_(chunk.map(function(s){
        return { set: { path: "users/" + owner + "/" + s.coll + "/" + s.id, fields: built[s.coll][s.id].doc } };
      }));
      chunk.forEach(function(s){ state[s.key] = built[s.coll][s.id].hash; });
      stateChanged = true;
      written += chunk.length;
    }
    for(var j = 0; j < dels.length; j += V2SYNC_BATCH_){
      var dchunk = dels.slice(j, j + V2SYNC_BATCH_);
      fsCommit_(dchunk.map(function(key){ return { del: { path: "users/" + owner + "/" + key } }; }));
      dchunk.forEach(function(key){ delete state[key]; });
      stateChanged = true;
      deleted += dchunk.length;
    }
    return { written: written, deleted: deleted, unchanged: builtCount - sets.length };
  }catch(e){
    return { error: String(e && e.message ? e.message : e).slice(0, 300), safetyLimit: !!(e && e.safetyLimit) };
  }finally{
    try{ if(stateChanged && ss) v2SaveState_(ss, loaded ? loaded.sheet : null, state); }catch(saveErr){
      try{ logAI("V2SYNC_ERROR", "could not save state: " + String(saveErr && saveErr.message).slice(0, 200)); }catch(ignore){}
    }
    try{ fsFlushUsage_(); }catch(ignore){}
    try{ lock.releaseLock(); }catch(ignore){}
  }
}

function v2LogOncePerHour_(msg){
  try{
    var cache = CacheService.getScriptCache();
    if(cache.get("V2SYNC_ERR_LOGGED")) return;
    cache.put("V2SYNC_ERR_LOGGED", "1", 3600);
    logAI("V2SYNC_ERROR", String(msg).slice(0, 300));
  }catch(ignore){}
}

// Called at the end of the background timer. At most every 10 minutes; never throws.
// If a run ever takes over a minute it moves itself to every 30 minutes (protects the daily
// trigger-runtime allowance, which also runs the transaction alerts).
function v2SyncIfDue_(){
  try{
    if(!V2SYNC_ENABLED_) return false;
    var cache = CacheService.getScriptCache();
    if(cache.get("V2SYNC_RECENT")) return false;
    var props = PropertiesService.getScriptProperties();
    var gap = Number(props.getProperty("V2SYNC_GAP")) || V2SYNC_MIN_GAP_SEC_;
    cache.put("V2SYNC_RECENT", "1", Math.min(gap, 21600));
    var t0 = Date.now();
    var r = v2SyncSheetToFirestore_({});
    if(r.skipped === "busy") cache.remove("V2SYNC_RECENT");
    var secs = (Date.now() - t0) / 1000;
    if(secs > 60 && gap < 1800){
      props.setProperty("V2SYNC_GAP", "1800");
      v2LogOncePerHour_("a sync took " + Math.round(secs) + " seconds, so it now runs every 30 minutes");
    }
    if(r.error && !r.safetyLimit) v2LogOncePerHour_(r.error);   // the daily safety limit is not a fault
    if(r.written || r.deleted){
      try{ props.setProperty("V2SYNC_LAST", JSON.stringify({ at: new Date().toISOString(), written: r.written || 0, deleted: r.deleted || 0 })); }catch(ignore){}
    }
    return !r.error && !r.skipped;
  }catch(e){
    v2LogOncePerHour_(e && e.message ? e.message : e);
    return false;
  }
}

// Run by hand from the editor to sync right now and see the numbers.
function v2SyncNow(){
  var r = v2SyncSheetToFirestore_({ force: true });
  Logger.log(JSON.stringify(r));
  return r;
}

// ---------------------------------------------------------------- daily self-check
// Compares the Firestore copy with what the Sheet implies RIGHT NOW (same documents, same contents).
// Differences from changes made in the last few minutes are normal, so only a mismatch that is still
// there after a fresh sync counts. Logs V2SYNC_MISMATCH (watched by the daily health check).
function v2NormalizeTyped_(fields){
  var norm = function(v){
    if(v && v.timestampValue !== undefined) return { t: new Date(v.timestampValue).toISOString().slice(0, 19) };
    if(v && v.integerValue !== undefined) return { i: String(Number(v.integerValue)) };
    if(v && v.doubleValue !== undefined) return { d: v.doubleValue };
    if(v && v.mapValue) { var o = {}; Object.keys(v.mapValue.fields || {}).sort().forEach(function(k){ o[k] = norm(v.mapValue.fields[k]); }); return { m: o }; }
    if(v && v.arrayValue) return { a: (v.arrayValue.values || []).map(norm) };
    if(v && v.stringValue !== undefined) return { s: v.stringValue };
    if(v && v.booleanValue !== undefined) return { b: v.booleanValue };
    return { n: null };
  };
  var out = {};
  Object.keys(fields || {}).sort().forEach(function(k){ out[k] = norm(fields[k]); });
  return JSON.stringify(out);
}

function v2VerifyShadow_(){
  var owner = String(PWA_ALLOWED_EMAIL).toLowerCase();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sync = v2SyncSheetToFirestore_({});                // make sure the copy is current first
  var built = v2BuildAll_(ss);
  var missing = 0, extra = 0, different = 0, perColl = {}, fixSets = [], fixDels = [];
  V2SYNC_COLLECTIONS_.forEach(function(coll){
    var live = {};
    fsListPath_("users/" + owner + "/" + coll, 5000).forEach(function(d){ live[d.id] = d; });
    var want = built[coll], m = 0, e = 0, df = 0;
    Object.keys(want).forEach(function(id){
      if(!live[id]) { m++; fixSets.push({ coll: coll, id: id }); return; }
      if(v2NormalizeTyped_(live[id].raw) !== v2NormalizeTyped_(fsEncodeFields_(want[id].doc))) { df++; fixSets.push({ coll: coll, id: id }); }
    });
    Object.keys(live).forEach(function(id){ if(!want[id]) { e++; fixDels.push("users/" + owner + "/" + coll + "/" + id); } });
    missing += m; extra += e; different += df;
    perColl[coll] = { docs: Object.keys(want).length, missing: m, extra: e, different: df };
  });
  var result = { at: new Date().toISOString(), ok: missing + extra + different === 0, missing: missing, extra: extra, different: different, repaired: 0, sync: sync };
  if(!result.ok){
    logAI("V2SYNC_MISMATCH", "missing " + missing + ", extra " + extra + ", different " + different + " " + JSON.stringify(perColl).slice(0, 200));
    // Put right what it found: rewrite missing/different documents; remove strays (a handful at most, never in bulk).
    try{
      for(var i = 0; i < fixSets.length; i += V2SYNC_BATCH_){
        var chunk = fixSets.slice(i, i + V2SYNC_BATCH_);
        fsCommit_(chunk.map(function(s){ return { set: { path: "users/" + owner + "/" + s.coll + "/" + s.id, fields: built[s.coll][s.id].doc } }; }));
        result.repaired += chunk.length;
      }
      if(fixDels.length <= V2SYNC_MAX_DELETES_){
        fsCommit_(fixDels.map(function(p){ return { del: { path: p } }; }));
        result.repaired += fixDels.length;
      }
    }catch(repairErr){
      logAI("V2SYNC_ERROR", "repair failed: " + String(repairErr && repairErr.message).slice(0, 200));
    }
  }
  try{ PropertiesService.getScriptProperties().setProperty("V2SYNC_VERIFY", JSON.stringify(result)); }catch(ignore){}
  try{ fsFlushUsage_(); }catch(ignore){}
  return result;
}

// Called once a day from checkAppHealth. Never throws.
function v2VerifyShadowIfDue_(){
  try{
    if(!V2SYNC_ENABLED_) return null;
    var props = PropertiesService.getScriptProperties();
    var today = Utilities.formatDate(new Date(), v2Tz_(), "yyyy-MM-dd");
    if(props.getProperty("V2SYNC_VERIFY_DAY") === today) return null;
    props.setProperty("V2SYNC_VERIFY_DAY", today);
    return v2VerifyShadow_();
  }catch(e){
    try{ logAI("V2SYNC_ERROR", "verify: " + String(e && e.message).slice(0, 200)); }catch(ignore){}
    return null;
  }
}
