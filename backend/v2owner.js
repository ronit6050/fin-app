// v2owner.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: everything needed to move the OWNER's own data from the Google Sheet to his private Firestore
// space, safely and reversibly. Nothing here does anything until the owner is switched on (v2dbEnableOwner() in v2route.js).
//
//   1. v2dbImportOwner()      run ONCE by hand: copies every Sheet tab into the owner's private space, checks it cell by cell, and
//                             copies his settings, timer bookmark and push token. Does NOT switch him on.
//   2. v2OwnerTakeOver_(fn)   used at the top of each background job (the timers): when the owner is switched on the job runs on his
//                             private copy instead of the Sheet; otherwise it does nothing and the job runs as before.
//   3. v2InboxSync_(db)       new bank SMS rows still land in the Google Sheet (the SMS reader is a separate project); before each
//                             job they are copied across into his private copy exactly once.
//   4. v2dbBackupOwner()      writes his private copy out as a normal Google Sheet backup (run daily by a trigger, or by hand).
//
// Going back: v2dbDisableOwner() puts him back on the Sheet at once. Rows that arrived by SMS meanwhile were also stamped
// "YES" (already handled) in the Sheet, so going back does not re-announce them; but edits made while switched on live only in the
// private copy (use v2dbBackupOwner() to get them out as a Sheet).

// Tabs that are never copied: logs stay in the Sheet (logAI writes there), "_V2Sync" belongs to the retired mirror.
var V2OWNER_SKIP_TABS_ = ["Logs", "AILogs", "_V2Sync", "_Props"];
// Script Properties that are secrets or switches and must NEVER be copied into a data folder.
var V2OWNER_SKIP_PROP_ = /TOKEN|KEY|SECRET|SERVICE_ACCOUNT|CHAT_ID|V2DB|^fs|^FS_|V2_|^HEALTH_/i;

function v2OwnerEmail_(){ return String(PWA_ALLOWED_EMAIL).toLowerCase(); }
function v2OwnerOn_(){ return v2EngineFor_(v2OwnerEmail_()) === "v2db"; }

// ---------------------------------------------------------------- 2. running a background job on the owner's private copy
// Returns { ran: false } when the caller should just carry on as before (owner not switched on, or already inside a private run),
// or { ran: true, value } when the job was run here on his private copy.
function v2OwnerTakeOver_(jobFn){
  if(V2DB_REQ_ || !v2OwnerOn_()) return { ran: false };
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);                                          // one saving job at a time, same lock as the app's saves
  try{
    var marks = { rows: [] };
    var attempt = function(){
      marks.rows = [];
      V2_AFTER_SAVE_ = [];
      return v2dbRun_(v2OwnerEmail_(), function(db){
        v2dbEnsureTemplate_(db);
        marks.rows = v2InboxSync_(db);
        return jobFn();
      }, { prefetch: V2_PREFETCH_ALL_ });
    };
    var value;
    try{ value = attempt(); }
    catch(e){ if(e && e.v2dbConflict) value = attempt(); else throw e; }
    v2InboxStampSheet_(marks.rows);                              // only AFTER the private copy was saved
    v2FinishSave_(value);
    return { ran: true, value: value };
  }finally{
    V2_AFTER_SAVE_ = [];
    try{ lock.releaseLock(); }catch(ignore){}
  }
}

// ---------------------------------------------------------------- shadow rows for the SMS reader
// The SMS reader (a separate project) decides "is this a duplicate?" by looking at the REAL Sheet only. A row that Reconcile adds
// while the owner is on his private copy would be invisible to it, so the same SMS arriving later would be added a second time.
// So Reconcile also queues a plain copy of each row here; the copy is written to the real Sheet only AFTER the private copy saved
// (never for a failed or refused save). The inbox sync skips rows whose Channel is "Import" so they never come back as doubles.
var V2_AFTER_SAVE_ = [];

function v2QueueShadowRow_(row){
  if(!V2DB_REQ_ || String(V2DB_REQ_.user).toLowerCase() !== v2OwnerEmail_()) return;
  V2_AFTER_SAVE_.push(row.slice());
}

// Call after a private run finished. Writes the queued shadow rows (if the run really saved) and always empties the queue.
function v2FinishSave_(result){
  var rows = V2_AFTER_SAVE_;
  V2_AFTER_SAVE_ = [];
  if(!rows.length || v2dbAnswerFailed_(result)) return;
  try{
    var real = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
    rows.forEach(function(r){ real.appendRow(r); });
  }catch(err){
    try{ logAI("V2_SHADOW_ERROR", String(err && err.message).slice(0, 200)); }catch(ignore){}
  }
}

// ---------------------------------------------------------------- 3. new SMS rows: Sheet -> private copy, exactly once
// Copies the Sheet's Transactions rows beyond the remembered count into the private Transactions tab. The count is kept in the
// private _Props, so it is saved in the SAME all-or-nothing step as the rows (no row can be lost or copied twice).
// Returns the Sheet row numbers copied (to stamp afterwards).
function v2InboxSync_(db){
  var props = db.props();
  var seen = Number(props.getProperty("inboxSheetRows") || 0);
  if(!seen) return [];                                           // not imported yet: never guess
  var real = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  var mine = db.getSheetByName("Transactions");
  if(!real || !mine) return [];
  var last = real.getLastRow();
  if(last < seen){ props.setProperty("inboxSheetRows", String(last)); logAI("V2_INBOX_SHRANK", "Sheet has " + last + " rows, expected " + seen); return []; }
  if(last === seen) return [];
  var cols = Math.max(mine.getLastColumn(), 21);
  var rows = real.getRange(seen + 1, 1, last - seen, cols).getValues();
  var copied = [];
  rows.forEach(function(r, i){
    if(String(r[8]) === "Import") return;                        // a Reconcile shadow copy: already in his private copy
    mine.appendRow(r);
    copied.push(seen + 1 + i);
  });
  props.setProperty("inboxSheetRows", String(last));
  return copied;
}

// Stamps "YES" in the Sheet's Processed column (P) for rows that were copied, so a switch back never re-announces them.
function v2InboxStampSheet_(sheetRows){
  if(!sheetRows || !sheetRows.length) return;
  try{
    var real = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
    var first = sheetRows[0], n = sheetRows[sheetRows.length - 1] - first + 1;   // rows may not be next to each other
    var cells = real.getRange(first, 16, n, 1).getValues();
    sheetRows.forEach(function(r){
      var c = cells[r - first];
      if(c[0] === "" || c[0] === null) c[0] = "YES";             // never overwrite IGNORED etc.
    });
    real.getRange(first, 16, n, 1).setValues(cells);
  }catch(err){
    try{ logAI("V2_INBOX_STAMP_ERROR", String(err && err.message).slice(0, 200)); }catch(ignore){}
  }
}

// ---------------------------------------------------------------- 1. the one-time copy
function v2OwnerRowsSame_(a, b){
  var norm = function(v){ return v2dbIsDate_(v) ? "D" + v.getTime() : v; };
  if(a.length !== b.length) return false;
  for(var i = 0; i < a.length; i++){
    var n = Math.max(a[i].length, b[i].length);
    for(var j = 0; j < n; j++){
      var x = a[i][j] === undefined ? "" : a[i][j], y = b[i][j] === undefined ? "" : b[i][j];
      if(norm(x) !== norm(y)) return false;
    }
  }
  return true;
}

// Run by hand from the Apps Script editor. Safe to run again BEFORE switching on (it replaces the private copy with a fresh one);
// refuses once the owner is switched on, so it can never overwrite live private data.
function v2dbImportOwner(){
  if(v2OwnerOn_()) throw new Error("The owner is already switched on - turn him off first (v2dbDisableOwner) if you really want a fresh copy.");
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var report = [], allExact = true;
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var user = v2OwnerEmail_();
    var started = Date.now();
    var txnRowsAtCopy = 0;
    ss.getSheets().forEach(function(sh){
      var name = sh.getName();
      if(V2OWNER_SKIP_TABS_.indexOf(name) !== -1) return;
      var rows = sh.getDataRange().getValues();
      if(name === "Transactions") txnRowsAtCopy = sh.getLastRow();      // taken from the SAME read as the copy
      if(name === "Transactions") rows = rows.slice(0, txnRowsAtCopy);
      v2dbImportTab_(user, name, rows);
      var back = new V2Db_(user).getSheetByName(name).getDataRange().getValues();
      var exact = v2OwnerRowsSame_(rows, back);
      if(!exact) allExact = false;
      report.push(name + ": " + rows.length + " rows, cell-exact " + (exact ? "YES" : "NO"));
    });
    // settings, timer bookmark, push token -> his own _Props
    var db = new V2Db_(user);
    var global = PropertiesService.getScriptProperties().getProperties();
    var copiedProps = 0;
    Object.keys(global).forEach(function(k){
      var allow = k === "PWA_PUSH_TOKEN" || k === "lastCheckedRow" || k.indexOf("SETTING_") === 0 || k.indexOf("OBLIGATION") === 0 || k.indexOf("obligation") === 0;
      if(!allow && V2OWNER_SKIP_PROP_.test(k)) return;
      if(!allow) return;                                           // copy only what we know is per-person
      db.props().setProperty(k, global[k]); copiedProps++;
    });
    db.props().setProperty("inboxSheetRows", String(txnRowsAtCopy));
    db.flush();
    report.push("settings/bookmark/token: " + copiedProps + " values; inbox mark = Sheet row " + txnRowsAtCopy);
    report.push((allExact ? "ALL TABS EXACT" : "SOME TABS DIFFER - do not switch on") + " in " + Math.round((Date.now() - started) / 1000) + "s");
  }finally{
    try{ lock.releaseLock(); }catch(ignore){}
  }
  try{ logAI("V2DB_OWNER_IMPORT", report.join(" | ").slice(0, 4000)); }catch(ignore){}
  return report;
}

// ---------------------------------------------------------------- 4. backup out as a normal Google Sheet
// Writes the owner's private copy into a separate Google Sheet in his Drive (created the first time, id remembered).
// Works on whichever copy is the real record: when the owner is not switched on it does nothing (the Sheet itself is the record).
function v2dbBackupOwner(){
  if(!v2OwnerOn_()) return "owner is not switched on; the Google Sheet itself is the record";
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("V2OWNER_BACKUP_SHEET_ID");
  var backup = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create("Finance tracker - backup of private copy");
  if(!id) props.setProperty("V2OWNER_BACKUP_SHEET_ID", backup.getId());
  var tabs = 0, rowsTotal = 0;
  v2dbRun_(v2OwnerEmail_(), function(db){
    db.getSheets().forEach(function(sh){
      var name = sh.getName();
      var vals = sh.getDataRange().getValues();
      if(!vals.length || (vals.length === 1 && vals[0].length === 1 && vals[0][0] === "")) vals = [[""]];
      var width = vals.reduce(function(m, r){ return Math.max(m, r.length); }, 1);
      vals = vals.map(function(r){ var o = r.slice(); while(o.length < width) o.push(""); return o; });
      var t = backup.getSheetByName(name) || backup.insertSheet(name);
      t.clearContents();
      t.getRange(1, 1, vals.length, width).setValues(vals);
      tabs++; rowsTotal += vals.length;
    });
  }, { prefetch: V2_PREFETCH_ALL_ });
  props.setProperty("V2OWNER_BACKUP_LAST", new Date().toISOString());
  try{ logAI("V2DB_OWNER_BACKUP", tabs + " tabs, " + rowsTotal + " rows -> " + backup.getUrl()); }catch(ignore){}
  return backup.getUrl();
}
