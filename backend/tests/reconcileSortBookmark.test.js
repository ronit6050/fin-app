// backend/tests/reconcileSortBookmark.test.js
//
// Plain-English what this checks: when you reconcile a bank statement the app
// adds rows and re-sorts the whole Transactions sheet by date. The background
// timer remembers how far it has looked as a row NUMBER (the bookmark). A sort
// can move a real, not-yet-alerted transaction UP past that number, and then
// the timer never alerts it. Found 2026-10-11 (the same family as the phantom
// rows incident). All data is invented.
//
// The picture used here (rows, top to bottom, BEFORE the reconcile):
//   1 header | 2-4 three real, processed | 5-7 three IGNORED placeholders |
//   8 a REAL new SMS transaction not yet alerted.  Bookmark = 7.
// The reconcile adds 2 OLDER rows. After the sort: 2 new rows go to the top
// (+2 for everything below), the 3 blank placeholders go to the bottom
// (-3 for the real rows above them) so the unprocessed row moves 8 -> 7,
// which is NOT after the bookmark (7). Without a fix it is missed forever.
//
// Run with: node backend/tests/reconcileSortBookmark.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const real = (amount, processed, ago, note) => [daysAgo(ago), "10:00:00", "TESTBANK", "debit", "upi", amount, "", "SOME SHOP", "SMS", "Tasker", "raw", "TESTBK", note || "", "", "", processed, ""];
const blank = (marker) => { const r = new Array(17).fill(""); r[15] = marker; return r; };

function world(opts){
  opts = opts || {};
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [HEADER, real(10, "YES", 10, "n"), real(20, "YES", 9, "n"), real(30, "YES", 8, "n"),
    blank("IGNORED"), blank("IGNORED"), blank("IGNORED"), real(77, "", 0)]);       // row 8 = the unalerted real one
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  w.props.lastCheckedRow = "7";
  // Unprocessed means the same thing everywhere; spies for what the timer alerts:
  if(opts.noFlush)  w.sb.processNewTransactions = function(){};
  if(opts.noRepair) w.sb.resetBookmarkAfterSort_ = function(){};
  return w;
}

const OLDER = [
  { date: daysAgo(20), type: "debit", mode: "upi", amount: 111, ref: "9001", name: "", note: "older one", category: "", needWantSaving: "" },
  { date: daysAgo(19), type: "debit", mode: "upi", amount: 222, ref: "9002", name: "", note: "older two", category: "", needWantSaving: "" }
];
const unprocessedRowNumber = (w) => w.sheets.Transactions.rows.findIndex((r) => r[5] === 77) + 1;

console.log("\n--- 1. PROOF THE TEST HAS TEETH: with both protections off, the row IS missed ---");
{
  const w = world({ noFlush: true, noRepair: true });
  const res = w.sb.insertReconciledTransactions(OLDER, "Bank Statement");
  assert(res.ok && res.added === 2, "the reconcile itself works");
  assert(unprocessedRowNumber(w) === 7, "the sort moved the unalerted row from 8 to 7 (got " + unprocessedRowNumber(w) + ")");
  w.sb.processNewTransactionsCore_();
  assert(w.pushes.length === 0 && w.sheets.Transactions.rows[6][15] === "", "WITHOUT the fix the timer never alerts it (0 notifications, still unprocessed)");
}

console.log("\n--- 2. The bookmark repair alone catches it ---");
{
  const w = world({ noFlush: true });
  w.sb.insertReconciledTransactions(OLDER, "Bank Statement");
  assert(w.props.lastCheckedRow === "6", "the bookmark is pulled back to just above the unalerted row (got " + w.props.lastCheckedRow + ")");
  w.sb.processNewTransactionsCore_();
  assert(w.pushes.length === 1 && w.sheets.Transactions.rows[6][15] === "YES", "the next timer run alerts it exactly once and marks it YES");
  assert(w.sheets.Transactions.rows.slice(7).every((r) => r[15] === "IGNORED"), "the placeholders are untouched, still IGNORED");
}

console.log("\n--- 3. The full fix: it is alerted BEFORE anything moves, and never twice ---");
{
  const w = world();
  w.sb.insertReconciledTransactions(OLDER, "Bank Statement");
  assert(w.pushes.length === 1, "the unalerted row was alerted during the reconcile, before the sort (got " + w.pushes.length + ")");
  assert(w.sheets.Transactions.rows[6][15] === "YES", "and marked processed");
  w.sb.processNewTransactionsCore_();
  assert(w.pushes.length === 1, "a later timer run does not alert it again (still 1)");
  const dates = w.sheets.Transactions.rows.slice(1).filter((r) => r[0] !== "").map((r) => r[0].getTime());
  assert(dates.every((d, i) => i === 0 || d >= dates[i - 1]), "the sheet is still in date order, so 'newest first' in the app is still right");
  assert(w.sheets.Transactions.rows.slice(1).filter((r) => r[0] !== "").length === 6, "all 6 real rows are there (3 old + 2 reconciled + 1 new)");
}

console.log("\n--- 4. The repair only ever LOWERS the bookmark ---");
{
  const w = world({ noFlush: true });
  w.props.lastCheckedRow = "2";
  w.sb.insertReconciledTransactions(OLDER, "Bank Statement");
  assert(w.props.lastCheckedRow === "2", "a bookmark that is already low is left alone (got " + w.props.lastCheckedRow + ")");

  const clean = world();
  clean.sheets.Transactions.rows[7][15] = "YES";                // nothing unprocessed at all
  clean.props.lastCheckedRow = "8";
  clean.sb.insertReconciledTransactions(OLDER, "Bank Statement");
  assert(clean.props.lastCheckedRow === "8", "with nothing unprocessed the bookmark is not touched (got " + clean.props.lastCheckedRow + ")");
}

console.log("\nDone.");
