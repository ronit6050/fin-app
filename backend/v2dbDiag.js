// v2dbDiag.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: a safe, one-click check of the Firestore-backed virtual spreadsheet (v2db.js) in the
// REAL Apps Script environment, where speed and date handling can differ from the tests.
//
// Run v2dbSmokeTest() by hand from the Apps Script editor (pick it in the function list, press Run). It:
//   1. copies each real Sheet tab (only READS the Sheet) into a TEST folder in Firestore (users/v2db-smoketest@example.com/...),
//      never into the owner's real folder, and times it;
//   2. re-opens every copied tab and checks every cell (numbers, text, and Dates to the millisecond) against the Sheet;
//   3. runs the real screens (Home dashboard, History, ...) once on the Sheet and once on the test copy, and compares the answers;
//   4. times a "read the Transactions tab" on the Sheet and on the copy;
//   5. writes a short report to the AILogs tab (type V2DB_SMOKETEST) so it can be read without copy-pasting.
// It changes NOTHING in the Sheet and nothing in the owner's real data. Run v2dbSmokeTestCleanup() afterwards to delete the test folder.

var V2DB_SMOKE_USER_ = "v2db-smoketest@example.com";
var V2DB_SMOKE_TABS_ = ["Transactions", "Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents",
                        "Budgets", "SmartMemory", "NoteMemory", "TypeVotes", "LearnedSpamPatterns", "Transactions_Ignored"];

function v2dbSmokeSame_(a, b){
  var norm = function(v){ return v2dbIsDate_(v) ? "D" + v.getTime() : v; };
  if(a.length !== b.length) return false;
  for(var i = 0; i < a.length; i++){
    var ra = a[i], rb = b[i], n = Math.max(ra.length, rb.length);
    for(var j = 0; j < n; j++){
      var x = ra[j] === undefined ? "" : ra[j], y = rb[j] === undefined ? "" : rb[j];
      if(norm(x) !== norm(y)) return false;
    }
  }
  return true;
}

function v2dbSmokeTest(){
  var report = [], started = Date.now();
  var note = function(s){ report.push(s); };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allExact = true;

  // 1 + 2. copy every tab into the test folder, then check it cell by cell
  V2DB_SMOKE_TABS_.forEach(function(name){
    var sh = ss.getSheetByName(name);
    if(!sh){ note(name + ": (no such tab)"); return; }
    var t = Date.now();
    var rows = sh.getDataRange().getValues();
    var readMs = Date.now() - t;
    t = Date.now();
    v2dbImportTab_(V2DB_SMOKE_USER_, name, rows);
    var importMs = Date.now() - t;
    t = Date.now();
    var back = new V2Db_(V2DB_SMOKE_USER_).getSheetByName(name).getDataRange().getValues();
    var reopenMs = Date.now() - t;
    var exact = v2dbSmokeSame_(rows, back);
    if(!exact) allExact = false;
    note(name + ": " + rows.length + " rows | sheet read " + readMs + "ms | copy " + importMs + "ms | reopen " + reopenMs + "ms | cell-exact " + (exact ? "YES" : "NO"));
  });

  // 3. the real screens, on the Sheet and on the copy
  var screens = [
    ["Home dashboard", function(){ return getDashboardData(); }],
    ["History (50)", function(){ return getTransactionHistory(0, 50); }],
    ["Debts", function(){ return getDebtsData(); }],
    ["Investments", function(){ return getInvestmentsData(); }],
    ["Pending", function(){ return getPendingTransactions(); }]
  ];
  var allSame = true;
  screens.forEach(function(sc){
    try{
      var t = Date.now();
      var a = JSON.stringify(sc[1]());
      var sheetMs = Date.now() - t;
      t = Date.now();
      var b = JSON.stringify(v2dbRun_(V2DB_SMOKE_USER_, sc[1]));
      var copyMs = Date.now() - t;
      var same = a === b;
      if(!same) allSame = false;
      note("screen " + sc[0] + ": sheet " + sheetMs + "ms | copy " + copyMs + "ms | same answer " + (same ? "YES" : "NO"));
    }catch(e){
      allSame = false;
      note("screen " + sc[0] + ": ERROR " + String(e && e.message).slice(0, 120));
    }
  });

  // 4. a plain "read the whole Transactions tab" on each
  var t1 = Date.now(); ss.getSheetByName("Transactions").getDataRange().getValues(); var sheetRead = Date.now() - t1;
  t1 = Date.now(); new V2Db_(V2DB_SMOKE_USER_).getSheetByName("Transactions").getDataRange().getValues(); var copyRead = Date.now() - t1;
  note("read the whole Transactions tab: sheet " + sheetRead + "ms | virtual copy " + copyRead + "ms");

  // 5. a small write on the copy (test folder only), timed
  t1 = Date.now();
  v2dbRun_(V2DB_SMOKE_USER_, function(){ var s = dbSs_().getSheetByName("Cash"); if(s) s.appendRow(["", "2026-10-13", "", "Debit", 1, "smoke test", "Other"]); return "ok"; });
  note("one save on the copy (read + change + write): " + (Date.now() - t1) + "ms");

  note("TOTAL " + Math.round((Date.now() - started) / 1000) + "s | every cell exact: " + (allExact ? "YES" : "NO") + " | every screen identical: " + (allSame ? "YES" : "NO"));
  Logger.log(report.join("\n"));
  try{ logAI("V2DB_SMOKETEST", report.join(" || ")); }catch(ignore){}
  try{ fsFlushUsage_(); }catch(ignore){}
  return { exact: allExact, same: allSame, report: report };
}

// Deletes the test folder created above (only that folder).
function v2dbSmokeTestCleanup(){
  var root = "users/" + V2DB_SMOKE_USER_ + "/sheets";
  var removed = 0;
  fsListPath_(root, 100).forEach(function(tab){
    fsListPath_(root + "/" + tab.id + "/pages", 200).forEach(function(p){
      fsCommit_([{ del: { path: root + "/" + tab.id + "/pages/" + p.id } }]); removed++;
    });
    fsCommit_([{ del: { path: root + "/" + tab.id } }]); removed++;
  });
  try{ logAI("V2DB_SMOKETEST", "cleanup removed " + removed + " documents"); }catch(ignore){}
  try{ fsFlushUsage_(); }catch(ignore){}
  return removed;
}
