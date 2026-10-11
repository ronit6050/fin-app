// backend/tests/timerSkipsPlaceholderRows.test.js
//
// Plain-English what this checks: the timer that processes new transactions
// must NEVER treat a placeholder row as a new transaction. Real incident,
// 2026-10-11: after a bank-statement reconcile re-sorted the Transactions
// sheet, 11 "IGNORED" placeholder rows ended up below the timer's bookmark,
// were treated as new transactions, got their IGNORED marker overwritten with
// YES, and appeared in Pending as Rs.0 phantoms. All data below is invented.
//
// Run with: node backend/tests/timerSkipsPlaceholderRows.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];

function today(){ const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
const real = (amount, processed, cp) => [today(), "10:00:00", "TESTBANK", "debit", "upi", amount, "", cp || "SOME SHOP", "SMS", "Tasker", "raw", "TESTBK", "", "", "", processed, ""];
const blank = (marker) => { const r = new Array(17).fill(""); r[15] = marker; return r; };

function world(rows, bookmark){
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  w.props.lastCheckedRow = String(bookmark);
  return w;
}

console.log("\n--- The incident: placeholder rows below the bookmark ---");
{
  // 3 real rows already processed, then 11 IGNORED placeholders the bookmark never covered
  const rows = [real(10, "YES"), real(20, "YES"), real(30, "YES")];
  for(let i = 0; i < 11; i++) rows.push(blank("IGNORED"));
  const w = world(rows, 4);                       // bookmark = last REAL row (row 4)
  w.sb.processNewTransactions();
  const marks = w.sheets.Transactions.rows.slice(4).map((r) => r[15]);
  assert(marks.length === 11 && marks.every((m) => m === "IGNORED"), "all 11 placeholder rows keep their IGNORED marker (got " + marks.join(",") + ")");
  assert(w.pushes.length === 0, "no 'New Transaction' notification is sent for a placeholder");
  assert(w.props.lastCheckedRow === "15", "the bookmark still moves forward past them (got " + w.props.lastCheckedRow + ")");
  assert(w.sb.getPendingTransactions().length === 3, "Pending shows only the 3 real un-noted rows, no placeholders (got " + w.sb.getPendingTransactions().length + ")");
}

console.log("\n--- A completely empty row is never a transaction either ---");
{
  const w = world([real(10, "YES"), blank("")], 2);
  w.sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[2][15] === "", "an empty row is left alone (not stamped YES)");
  assert(w.pushes.length === 0, "and causes no notification");
}

console.log("\n--- Real new transactions next to placeholders are still processed normally ---");
{
  const w = world([real(10, "YES"), blank("IGNORED"), real(55, ""), blank("IGNORED"), real(66, "")], 2);
  w.sb.processNewTransactions();
  const rows = w.sheets.Transactions.rows;
  assert(rows[3][15] === "YES" && rows[5][15] === "YES", "the two real new rows are marked processed");
  assert(rows[2][15] === "IGNORED" && rows[4][15] === "IGNORED", "the placeholders between them stay IGNORED");
  assert(w.pushes.length === 2, "exactly two notifications, one per real transaction (got " + w.pushes.length + ")");
}
console.log("\n--- A 'NEEDS REVIEW' row with a blank amount is STILL a real row (the SMS reader saves these) ---");
{
  // Date and time are always written by the SMS reader; only the amount may be blank.
  const uncertain = [new Date(), "10:00:00", "TESTBANK", "", "other", "", "", "NEEDS REVIEW: unrecognized message", "SMS", "Tasker", "raw", "TESTBK", "", "", "", "", ""];
  const w = world([real(10, "YES"), uncertain], 2);
  w.sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[2][15] === "YES", "the blank-amount row is processed and marked YES");
  assert(w.pushes.length === 1, "and it still sends its notification (got " + w.pushes.length + ")");
}

console.log("\n--- Pending itself never shows an empty row, even one stamped YES (the live state on 11 Oct) ---");
{
  const rows = [real(10, "YES")];
  for(let i = 0; i < 11; i++) rows.push(blank("YES"));
  const w = world(rows, 13);
  assert(w.sb.getPendingTransactions().length === 1, "11 empty rows stamped YES are not listed as pending (got " + w.sb.getPendingTransactions().length + ")");
}


console.log("\nDone.");
