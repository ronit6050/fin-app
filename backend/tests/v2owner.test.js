// backend/tests/v2owner.test.js
//
// Plain-English what this checks: moving the OWNER's own data from the Google Sheet to his private Firestore copy (v2owner.js):
// the one-time import (exact copy, settings copied, secrets never), background jobs running on the private copy only once he is
// switched on, new SMS rows coming across exactly once (never lost, never doubled, even if saving fails), and the backup.
// All data here is invented. Run with: node backend/tests/v2owner.test.js

const { build, OWNER, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

function seedReal(w){
  w.sb.sendPushNotification = function(title, body, extra){ w.pushes.push({ title: title, body: body, extra: extra || null }); };   // record what would be sent
  const today = new w.D(); today.setHours(10, 0, 0, 0);
  w.row = function(amt, ref, cp, proc){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, ref, cp, "SMS", "Tasker", "raw", "HDFCBK", "", "", "", proc === undefined ? "YES" : proc, "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, w.row(120, 111111, "Cafe A"), w.row(80, 222222, "Shop B")]);
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.props.SETTING_CC_LIMIT = "70000"; w.props.lastCheckedRow = "3"; w.props.PWA_PUSH_TOKEN = "device-token-123";
  w.props.BOT_TOKEN = "SECRET-BOT"; w.props.GEMINI_KEY = "SECRET-GEMINI";
}

console.log("\n--- 1. Import: every tab copied exactly, settings copied, secrets never copied, does not switch him on ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  const report = sb.v2dbImportOwner();
  assert(report.join(" ").indexOf("ALL TABS EXACT") !== -1, "the import reports every tab cell-exact: " + report.slice(-1));
  assert(JSON.stringify(w.virtualTab(OWNER, "Transactions")) === JSON.stringify(w.sheets.Transactions.getDataRange().getValues()), "his private Transactions equals the Sheet's");
  const p = sb.v2dbRun_(OWNER, function(db){ return db.props().getProperties(); });
  assert(p.SETTING_CC_LIMIT === "70000" && p.lastCheckedRow === "3" && p.PWA_PUSH_TOKEN === "device-token-123", "settings, bookmark and push token were copied to his own _Props");
  assert(JSON.stringify(p).indexOf("SECRET") === -1 && !("BOT_TOKEN" in p) && !("GEMINI_KEY" in p), "secrets (bot token, Gemini key) were NOT copied");
  assert(p.inboxSheetRows === "3", "the inbox mark is the Sheet's last row at copy time (3)");
  assert(sb.v2EngineFor_(OWNER) === "sheet", "importing does not switch him on");
  assert(w.errors("V2DB_OWNER_IMPORT").length === 1, "a report line was written to AILogs");
  sb.v2dbEnableOwner();
  let refused = false; try{ sb.v2dbImportOwner(); }catch(e){ refused = /already switched on/.test(e.message); }
  assert(refused, "the import refuses to run once he is switched on (can never overwrite live private data)");
}

console.log("\n--- 2. Owner NOT switched on: the timer runs on the Sheet exactly as before ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  w.sheets.Transactions.appendRow(w.row(55, 333333, "Shop C", ""));
  sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[3][15] === "YES", "the Sheet row was processed in the Sheet");
  assert(w.pushes.length === 1, "one notification went out");
  assert(Object.keys(w.store).every(function(p){ return p.indexOf("users/" + OWNER + "/sheets/") === -1; }), "nothing was written to a private folder");
}

console.log("\n--- 3. Owner switched on: new SMS rows come across exactly once and the timer works on the private copy ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  w.sheets.Transactions.appendRow(w.row(55, 333333, "Shop C", ""));          // the SMS reader adds a row to the Sheet
  w.pushes.length = 0;
  sb.processNewTransactions();
  const mine = w.virtualTab(OWNER, "Transactions");
  assert(mine.length === 4 && mine[3][5] === 55, "the new row was copied into his private Transactions");
  assert(mine[3][15] === "YES", "the timer processed it there (Processed = YES)");
  assert(w.pushes.length === 1, "one notification went out");
  assert(w.sheets.Transactions.rows[3][15] === "YES", "the Sheet's own copy was stamped YES, so switching back would not re-announce it");
  sb.processNewTransactions();
  assert(w.virtualTab(OWNER, "Transactions").length === 4 && w.pushes.length === 1, "running again copies nothing twice and announces nothing twice");
  const pend = w.act("owner", { action: "getPending" });
  assert(pend.ok === true, "his app screens work from the same private copy");
  w.sheets.Transactions.appendRow(w.row(10, 444444, "Shop D", ""));
  w.sheets.Transactions.appendRow(w.row(20, 555555, "Shop E", ""));
  sb.processNewTransactions();
  assert(w.virtualTab(OWNER, "Transactions").length === 6 && w.pushes.length === 3, "two more rows: both copied and announced once");
  assert(w.props.lastCheckedRow === "3", "the bookmark in the global settings was not touched (his own lives in his _Props)");
}

console.log("\n--- 4. If saving the private copy fails, nothing is half-done ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  w.sheets.Transactions.appendRow(w.row(77, 666666, "Shop F", ""));
  const bad = new Error("firestore down"); bad.httpCode = 503;
  w.failCommits = [bad, bad];
  try{ sb.processNewTransactions(); }catch(e){ /* the failure may surface; what matters is what was saved */ }
  assert(w.sheets.Transactions.rows[3][15] === "", "the Sheet row was NOT stamped (so it will be picked up next run)");
  assert(w.virtualTab(OWNER, "Transactions").length === 3, "the private copy did not get a half-saved row");
  w.failCommits = [];
  sb.processNewTransactions();
  assert(w.virtualTab(OWNER, "Transactions").length === 4 && w.sheets.Transactions.rows[3][15] === "YES", "the next run copies it once and stamps it");
}

console.log("\n--- 5. Other jobs also run on the private copy; an IGNORED stamp is never overwritten ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  w.sheets.Transactions.appendRow(w.row(5, 777777, "Shop G", "IGNORED"));
  sb.checkAppHealth();
  assert(w.sheets.Transactions.rows[3][15] === "IGNORED", "a row the Sheet already marked IGNORED keeps that mark");
  assert(w.virtualTab(OWNER, "Transactions").length === 4, "any job brings new rows across first");
  sb.checkDebtDueDates(); sb.sendDailyCashCheckin();
  assert(w.errors("V2DB_REQUEST_ERROR").length === 0, "the other jobs ran without errors");
}

console.log("\n--- 6. The inbox waits until the import has been done; learned spam goes to the REAL Sheet ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  sb.v2dbEnableOwner();                                                  // switched on WITHOUT importing (a mistake)
  w.sheets.Transactions.appendRow(w.row(5, 888888, "Shop H", ""));
  try{ sb.processNewTransactions(); }catch(e){ /* nothing to run on */ }
  assert(w.sheets.Transactions.rows[3][15] === "", "without an import the inbox copies nothing and stamps nothing");
  const w2 = build(); seedReal(w2); const sb2 = w2.sb;
  sb2.v2dbImportOwner(); sb2.v2dbEnableOwner();
  w2.addSheet("LearnedSpamPatterns", [["DateLearned", "Sender", "NormalizedTemplate", "ExampleRawSMS"]]);
  const s = sb2.v2dbRun_(OWNER, function(){ return sb2.getLearnedSpamPatternsSheet_(); });
  assert(s === w2.sheets.LearnedSpamPatterns, "the spam-learning tab used while he is on the private copy is the Sheet's real one (the SMS reader reads it there)");
}

console.log("\n--- 7. Backup: his private copy written out as a normal Sheet ---");
{
  const w = build(); seedReal(w); const sb = w.sb;
  const made = { sheets: {} };
  sb.SpreadsheetApp.create = function(){
    return { getId: function(){ return "backup-id"; }, getUrl: function(){ return "https://example/backup"; },
      getSheetByName: function(n){ return made.sheets[n] || null; },
      insertSheet: function(n){ const s = { rows: [], clearContents: function(){ this.rows = []; }, getRange: function(){ const self = this; return { setValues: function(v){ self.rows = v; } }; } }; made.sheets[n] = s; return s; } };
  };
  assert(/not switched on/.test(sb.v2dbBackupOwner()), "with the owner not switched on, the backup does nothing (the Sheet is the record)");
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  w.sheets.Transactions.appendRow(w.row(55, 333333, "Shop C", ""));
  sb.processNewTransactions();
  const url = sb.v2dbBackupOwner();
  assert(url === "https://example/backup" && w.props.V2OWNER_BACKUP_SHEET_ID === "backup-id", "a backup Sheet was created and remembered");
  assert(made.sheets.Transactions.rows.length === 4 && made.sheets.Transactions.rows[3][5] === 55, "the backup holds the private copy, including the row that arrived after the import");
  assert(Object.keys(made.sheets).indexOf("_Props") !== -1, "his settings tab is in the backup too");
}
