// v2db.js (added 2026-10-12)
//
// PLAIN-ENGLISH WHAT THIS IS: a "virtual spreadsheet" whose tabs live in a person's own private Firestore
// folder instead of a Google Sheet. It behaves like the Sheet the rest of the backend already talks to
// (get a tab, read cells, write cells, append a row, sort, delete a row ...), so the app's tested logic
// can run on it WITHOUT being rewritten. This is the heart of "Firestore as the only database, one private
// folder per person" (docs/v2-firestore-native.md, revised plan).
//
// HOW IT STORES DATA
//   users/<email>/sheets/<tab>                   a tiny marker so tabs can be listed
//   users/<email>/sheets/<tab>/pages/<0000..>    the rows, a few hundred KB per page, as JSON text
// Page 0 also remembers how many pages the tab has, so opening a tab is ONE read (two for a big tab).
// Rows are stored as JSON text (not as Firestore arrays) so Firestore's "no nested arrays" and index-size
// limits can never bite, and a real Date survives exactly (stored as milliseconds).
//
// HOW A REQUEST USES IT (v2dbRun_)
//   - it opens the person's tabs lazily, as the code asks for them;
//   - every change happens in memory; at the END the changed tabs are written in ONE all-or-nothing batch;
//   - if the action throws, NOTHING is written (the request is all-or-nothing);
//   - a tab changed by someone else meanwhile is detected (update-time check) and refused, never overwritten.
//
// dbSs_() is the one place the rest of the backend asks "which spreadsheet?": the real Google Sheet (today,
// and always outside a v2dbRun_) or the person's virtual one (inside a v2dbRun_).
//
// Not supported on purpose (maintenance-only helpers that need a real Sheet): copyTo, formatting calls.

var V2DB_PAGE_ROWS_ = 1000;            // most rows in one page
var V2DB_PAGE_BYTES_ = 500000;         // most JSON BYTES in one page (Firestore documents max out near 1 MiB)
var V2DB_REQ_ = null;                  // the virtual spreadsheet for the request in progress, or null

function dbSs_(){
  return V2DB_REQ_ || SpreadsheetApp.getActiveSpreadsheet();
}

// ---------------------------------------------------------------- cells <-> JSON
function v2dbIsDate_(v){ return Object.prototype.toString.call(v) === "[object Date]"; }

function v2dbCell_(v){                      // a value as the tab keeps it
  if(v === null || v === undefined) return "";
  if(v2dbIsDate_(v)) return isNaN(v.getTime()) ? "" : new Date(v.getTime());
  if(typeof v === "number" && !isFinite(v)) return "";
  return v;
}

// Real Google Sheets treats text written by a script (setValue / appendRow) as if it were typed: "123" becomes the
// number 123, "2026-10-12" becomes a date, "TRUE" becomes true. The backend relies on that in places (amounts, dates,
// references), so a virtual spreadsheet must do the same or the same code would store different values.
function v2dbMidnightDate_(y, mo, d, h, mi, s){
  var iso = y + "-" + ("0" + mo).slice(-2) + "-" + ("0" + d).slice(-2) + " " + ("0" + h).slice(-2) + ":" + ("0" + mi).slice(-2) + ":" + ("0" + s).slice(-2);
  try{
    if(typeof Utilities !== "undefined" && Utilities.parseDate) return Utilities.parseDate(iso, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");   // uses the same time-zone rules the real Sheet does
  }catch(ignore){}
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 330 * 60000);
}

function v2dbCoerce_(v){
  if(typeof v !== "string") return v2dbCell_(v);
  var s = v.trim(), m;
  if(s === "") return v;
  if(/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) && s.replace(/[^0-9]/g, "").length <= 15) return Number(s);
  if(/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if(/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))){
    var y = +m[1], mo = +m[2], d = +m[3];
    if(mo >= 1 && mo <= 12 && d >= 1 && d <= 31){
      var chk = new Date(Date.UTC(y, mo - 1, d));
      if(chk.getUTCMonth() === mo - 1 && chk.getUTCDate() === d) return v2dbMidnightDate_(y, mo, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
  }
  if((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)) && +m[1] < 24 && +m[2] < 60) return v2dbMidnightDate_(1899, 12, 30, +m[1], +m[2], +(m[3] || 0));
  return v;
}

function v2dbBytes_(str){ return unescape(encodeURIComponent(str)).length; }       // the real size in bytes (a character like the rupee sign is 3)

function v2dbEncodeRows_(rows){
  return JSON.stringify(rows.map(function(row){
    return row.map(function(c){ return v2dbIsDate_(c) ? { "$d": c.getTime() } : c; });
  }));
}

function v2dbDecodeRows_(json){
  return JSON.parse(json).map(function(row){
    return row.map(function(c){ return (c !== null && typeof c === "object" && c["$d"] !== undefined) ? new Date(c["$d"]) : c; });
  });
}

function v2dbSafeName_(name){ return String(name).replace(/[^A-Za-z0-9_\-]/g, "_"); }
function v2dbPad4_(n){ return ("0000" + n).slice(-4); }

function v2dbIsBlankCell_(c){ return c === "" || c === null || c === undefined; }

// ---------------------------------------------------------------- one tab
function V2Sheet_(db, name, rows, loaded){
  this.db = db;
  this.name = name;
  this.rows = rows;                         // array of arrays; row r (1-based) is rows[r-1]
  this.loaded = loaded;                     // null for a brand-new tab, else { pageJsons: [...], updateTime }
  this.dirty = !loaded;                     // a new tab always gets written
}

V2Sheet_.prototype.touch_ = function(){ this.dirty = true; };

V2Sheet_.prototype.getName = function(){ return this.name; };
V2Sheet_.prototype.setName = function(newName){
  this.db.renameSheet_(this, String(newName));
};

V2Sheet_.prototype.getLastRow = function(){
  for(var i = this.rows.length - 1; i >= 0; i--){
    var row = this.rows[i];
    for(var j = 0; j < row.length; j++) if(!v2dbIsBlankCell_(row[j])) return i + 1;
  }
  return 0;
};

V2Sheet_.prototype.getLastColumn = function(){
  var max = 0;
  this.rows.forEach(function(row){
    for(var j = row.length - 1; j >= max; j--){ if(!v2dbIsBlankCell_(row[j])){ max = j + 1; break; } }
  });
  return max;
};

V2Sheet_.prototype.getDataRange = function(){
  return new V2Range_(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
};

V2Sheet_.prototype.getRange = function(r, c, nr, nc){
  if(typeof r !== "number") throw new Error("v2db: A1 ranges are not supported (use row/column numbers)");
  return new V2Range_(this, r, c, nr || 1, nc || 1);
};

V2Sheet_.prototype.appendRow = function(values){
  var last = this.getLastRow();
  var row = values.map(v2dbCoerce_);
  this.rows.length = Math.max(this.rows.length, last);
  this.rows.splice(last, this.rows.length - last, row);       // replaces any trailing blank rows, like the real Sheet
  this.touch_();
};

V2Sheet_.prototype.deleteRow = function(r){ this.deleteRows(r, 1); };
V2Sheet_.prototype.deleteRows = function(r, n){
  if(r > this.rows.length) return;
  this.rows.splice(r - 1, n);
  this.touch_();
};
V2Sheet_.prototype.insertRowBefore = function(r){
  while(this.rows.length < r - 1) this.rows.push([]);
  this.rows.splice(r - 1, 0, []);
  this.touch_();
};
V2Sheet_.prototype.insertRowAfter = function(r){ this.insertRowBefore(r + 1); };
V2Sheet_.prototype.clear = function(){ this.rows = []; this.touch_(); };
V2Sheet_.prototype.clearContent = V2Sheet_.prototype.clear;
V2Sheet_.prototype.hideSheet = function(){};
V2Sheet_.prototype.setFrozenRows = function(){};
V2Sheet_.prototype.copyTo = function(){ throw new Error("v2db: copyTo is not supported on a virtual spreadsheet"); };

// ---------------------------------------------------------------- a block of cells
function V2Range_(sheet, r, c, nr, nc){
  this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
}

V2Range_.prototype.getValue = function(){
  var row = this.sheet.rows[this.r - 1];
  var v = row ? row[this.c - 1] : undefined;
  return v === undefined ? "" : (v2dbIsDate_(v) ? new Date(v.getTime()) : v);
};

V2Range_.prototype.getValues = function(){
  var out = [];
  for(var i = 0; i < this.nr; i++){
    var row = this.sheet.rows[this.r - 1 + i] || [], line = [];
    for(var j = 0; j < this.nc; j++){
      var v = row[this.c - 1 + j];
      line.push(v === undefined ? "" : (v2dbIsDate_(v) ? new Date(v.getTime()) : v));
    }
    out.push(line);
  }
  return out;
};

V2Range_.prototype.setValue = function(v){
  this.setValues([[v]]);
};

V2Range_.prototype.setValues = function(vals){
  var sh = this.sheet;
  for(var i = 0; i < vals.length; i++){
    while(sh.rows.length < this.r + i) sh.rows.push([]);
    var row = sh.rows[this.r - 1 + i];
    for(var j = 0; j < vals[i].length; j++){
      while(row.length < this.c + j) row.push("");
      row[this.c - 1 + j] = v2dbCoerce_(vals[i][j]);
    }
  }
  sh.touch_();
};

V2Range_.prototype.clearContent = function(){
  var sh = this.sheet;
  for(var i = 0; i < this.nr; i++){
    var row = sh.rows[this.r - 1 + i];
    if(!row) continue;
    for(var j = 0; j < this.nc; j++) if(this.c - 1 + j < row.length) row[this.c - 1 + j] = "";
  }
  sh.touch_();
};
V2Range_.prototype.clear = V2Range_.prototype.clearContent;

// Sorts the rows of this range by one column (1-based sheet column). Blank cells go last when ascending,
// first when descending (like Google Sheets). Stable.
V2Range_.prototype.sort = function(specs){
  var sh = this.sheet, spec = Array.isArray(specs) ? specs[0] : specs, col = (spec.column || 1) - 1, asc = spec.ascending !== false;
  var from = this.r - 1, slice = [];
  for(var i = 0; i < this.nr; i++){
    var row = sh.rows[from + i] || [];
    var copy = row.slice(); while(copy.length < this.c - 1 + this.nc) copy.push("");
    slice.push(copy);
  }
  var key = function(v){ return v2dbIsDate_(v) ? v.getTime() : v; };
  slice.sort(function(a, b){
    var x = a[col], y = b[col], bx = v2dbIsBlankCell_(x), by = v2dbIsBlankCell_(y);
    if(bx || by){ if(bx && by) return 0; return (bx ? 1 : -1) * (asc ? 1 : -1); }
    var kx = key(x), ky = key(y), cmp;
    var rank = function(k){ return typeof k === "number" ? 0 : (typeof k === "boolean" ? 2 : 1); };
    if(rank(kx) !== rank(ky)) cmp = rank(kx) - rank(ky);
    else if(typeof kx === "number") cmp = kx - ky;
    else if(typeof kx === "boolean") cmp = (kx ? 1 : 0) - (ky ? 1 : 0);
    else cmp = String(kx) < String(ky) ? -1 : String(kx) > String(ky) ? 1 : 0;
    return cmp * (asc ? 1 : -1);
  });
  while(sh.rows.length < from + this.nr) sh.rows.push([]);
  for(var k = 0; k < slice.length; k++) sh.rows[from + k] = slice[k];
  sh.touch_();
};

// ---------------------------------------------------------------- the person's whole virtual spreadsheet
function V2Db_(user){
  this.user = String(user || "").trim().toLowerCase();
  if(!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(this.user)) throw new Error("v2db: a valid person is required");
  this.sheets = {};
}

V2Db_.prototype.root_ = function(){ return "users/" + this.user + "/sheets/"; };
V2Db_.prototype.tabPath_ = function(name){ return this.root_() + v2dbSafeName_(name); };
V2Db_.prototype.pagePath_ = function(name, n){ return this.tabPath_(name) + "/pages/" + v2dbPad4_(n); };

V2Db_.prototype.getSpreadsheetTimeZone = function(){ return "Asia/Kolkata"; };
V2Db_.prototype.getId = function(){ return "v2db:" + this.user; };

// Opens a tab (one read; two or more only for a very large tab). null if the person has no such tab.
V2Db_.prototype.getSheetByName = function(name){
  if(this.sheets[name]) return this.sheets[name];
  if(this.missing && this.missing[name]) return null;
  var first = fsGetPathMeta_(this.pagePath_(name, 0));
  if(!first){ (this.missing = this.missing || {})[name] = true; return null; }
  var pageCount = Number(first.fields.pages) || 1;
  var pageJsons = [String(first.fields.json || "[]")];
  for(var p = 1; p < pageCount; p++){
    var doc = fsGetPathMeta_(this.pagePath_(name, p));
    pageJsons.push(doc ? String(doc.fields.json || "[]") : "[]");
  }
  var rows = [];
  pageJsons.forEach(function(j){ v2dbDecodeRows_(j).forEach(function(r){ rows.push(r); }); });
  var sheet = new V2Sheet_(this, name, rows, { pageJsons: pageJsons, updateTime: first.updateTime });
  this.sheets[name] = sheet;
  return sheet;
};

V2Db_.prototype.insertSheet = function(name){
  if(this.getSheetByName(name)) throw new Error("v2db: a tab named " + name + " already exists");
  var safe = v2dbSafeName_(name), self = this;
  Object.keys(this.sheets).forEach(function(other){
    if(other !== name && v2dbSafeName_(other) === safe) throw new Error("v2db: tab name " + name + " would collide with " + other);
  });
  if(this.missing) delete this.missing[name];
  var sheet = new V2Sheet_(this, name, [], null);
  this.sheets[name] = sheet;
  return sheet;
};

V2Db_.prototype.getSheets = function(){
  var self = this, out = [];
  fsListPath_(this.root_().replace(/\/$/, ""), 500).forEach(function(d){
    var name = d.fields && d.fields.name ? String(d.fields.name) : d.id;
    var s = self.getSheetByName(name);
    if(s) out.push(s);
  });
  return out;
};

V2Db_.prototype.renameSheet_ = function(sheet, newName){
  if(sheet.name === newName) return;
  throw new Error("v2db: renaming a tab is not supported");
};

// Splits rows into pages: at most V2DB_PAGE_ROWS_ rows and V2DB_PAGE_BYTES_ bytes each.
V2Db_.prototype.paginate_ = function(rows){
  var pages = [], current = [], size = 2;
  rows.forEach(function(row){
    var js = v2dbEncodeRows_([row]);
    var len = v2dbBytes_(js);
    if(current.length && (current.length >= V2DB_PAGE_ROWS_ || size + len > V2DB_PAGE_BYTES_)){
      pages.push(current); current = []; size = 2;
    }
    current.push(row); size += len;
  });
  pages.push(current);
  return pages.map(function(p){ return v2dbEncodeRows_(p); });
};

// Writes every changed tab in ONE all-or-nothing batch. Called once, at the end of a successful request.
V2Db_.prototype.flush = function(){
  var self = this, ops = [], touched = [];
  Object.keys(this.sheets).forEach(function(name){
    var sh = self.sheets[name];
    if(!sh.dirty) return;
    var pages = self.paginate_(sh.rows);
    var old = sh.loaded ? sh.loaded.pageJsons : [];
    if(sh.loaded && pages.length === old.length && pages.every(function(j, i){ return j === old[i]; })){
      sh.dirty = false;                                    // changed and changed back: nothing to write
      return;
    }
    var page0Op = -1;
    pages.forEach(function(json, i){
      var changed = !sh.loaded || i === 0 || i >= old.length || old[i] !== json;
      if(!changed) return;
      var fields = { json: json };
      if(i === 0){ fields.pages = pages.length; fields.cols = sh.getLastColumn(); fields.name = name; }
      var set = { path: self.pagePath_(name, i), fields: fields };
      if(i === 0 && sh.loaded) set.onlyIfUpdateTime = sh.loaded.updateTime;     // someone else changed this tab meanwhile: refuse
      if(i === 0 && !sh.loaded) set.onlyIfNew = true;
      if(i === 0) page0Op = ops.length;
      ops.push({ set: set });
    });
    if(!sh.loaded) ops.push({ set: { path: self.tabPath_(name), fields: { name: name } } });
    for(var k = pages.length; k < old.length; k++) ops.push({ del: { path: self.pagePath_(name, k) } });   // the tab got shorter
    touched.push({ sheet: sh, pages: pages, page0Op: page0Op });
  });
  if(!ops.length) return { written: 0 };
  var results;
  try{
    results = fsCommit_(ops);
  }catch(e){
    var msg = String(e && e.message || "");
    var looksLikeConflict = e && (e.httpCode === 409 || e.httpCode === 412 || (e.httpCode === 400 && /does not match|base version|precondition|already exists|was changed|modified/i.test(msg)));
    if(looksLikeConflict){
      var conflict = new Error("v2db: this data was changed by someone else at the same moment; nothing was saved, please try again");
      conflict.v2dbConflict = true;
      throw conflict;
    }
    throw e;
  }
  // The batch landed: what we hold is now what is stored (so the same request may save again).
  touched.forEach(function(t){
    var r = results && results[t.page0Op];
    t.sheet.dirty = false;
    t.sheet.loaded = { pageJsons: t.pages, updateTime: (r && r.updateTime) || "" };
  });
  return { written: ops.length };
};

// ---------------------------------------------------------------- running a request on a person's virtual spreadsheet
// Runs fn() with dbSs_() returning the person's virtual spreadsheet; flushes on success; ALWAYS restores the
// real spreadsheet afterwards. If fn throws, nothing is written.
function v2dbAnswerFailed_(result){
  try{
    var text = result && typeof result.getContent === "function" ? result.getContent() : (typeof result === "string" ? result : "");
    return /"ok"\s*:\s*false/.test(String(text).slice(0, 400));
  }catch(e){ return false; }
}

function v2dbRun_(user, fn){
  var db = new V2Db_(user);
  var previous = V2DB_REQ_;
  V2DB_REQ_ = db;
  try{
    var result = fn(db);
    // If the action reported failure ({ok:false}, which is how the app turns errors into answers), keep NONE of its
    // changes: a half-finished save must never be written.
    if(!v2dbAnswerFailed_(result)) db.flush();
    return result;
  }finally{
    V2DB_REQ_ = previous;
  }
}

// ---------------------------------------------------------------- copying a real Sheet tab into a person's folder (cell-exact)
// Run INSIDE Apps Script, where getValues() gives the real Date values, so nothing is lost in translation.
// Replaces the person's copy of that tab. Returns { rows, cols, pages }.
function v2dbImportTab_(user, tabName, rows){
  var db = new V2Db_(user);
  var existing = db.getSheetByName(tabName);
  var sheet = existing || new V2Sheet_(db, tabName, [], null);
  sheet.rows = rows.map(function(r){ return r.map(v2dbCell_); });
  sheet.dirty = true;
  db.sheets[tabName] = sheet;
  var res = db.flush();
  return { rows: rows.length, written: res.written };
}
