// backend/tests/bookmarkSafety.test.js
//
// Plain-English what this checks: the background check remembers "how far have I
// looked" as a row number (the bookmark). On 2026-10-11 that number was 999 while the
// sheet only had 987 rows, so a real payment at row 987 was never alerted and never
// reached Pending. Now the bookmark is only a speed-up: every run also looks for any
// real payment that was never alerted. All data below is invented.
//
// Run with: node backend/tests/bookmarkSafety.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");
const FILES = ["category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js"];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const row = (o) => { const r = new Array(19).fill(""); r[0] = o.date === undefined ? daysAgo(1) : o.date; r[1] = "10:00:00"; r[2] = "TESTBANK"; r[3] = "debit";
  r[4] = "upi"; r[5] = o.amount === undefined ? 92 : o.amount; r[6] = o.ref || ""; r[7] = o.cp || "SHOP"; r[15] = o.processed === undefined ? "" : o.processed; return r; };

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
  if(bookmark !== undefined) w.props.lastCheckedRow = String(bookmark);
  return w;
}
const processedAt = (w, sheetRow) => w.sheets.Transactions.rows[sheetRow - 1][15];

console.log("\n--- 1. THE INCIDENT: bookmark (999) is past the end of the sheet (987 rows) ---");
{
  const done = Array.from({ length: 5 }, (_, i) => row({ processed: "YES", ref: "10" + i, amount: 10 + i }));
  const w = world(done.concat([row({ amount: 92, ref: "665014606455" })]), 999);     // the new payment is sheet row 7
  w.sb.processNewTransactions();
  assert(processedAt(w, 7) === "YES", "the new payment IS processed even though the bookmark said 999");
  assert(w.pushes.length === 1, "and it sends its notification");
  assert(w.props.lastCheckedRow === "7", "the bookmark is healed to the real last row (got " + w.props.lastCheckedRow + ")");
}

console.log("\n--- 2. An un-alerted payment BEFORE the bookmark is still found ---");
{
  const rows = [row({ processed: "YES", ref: "11" }), row({ amount: 55, ref: "12" }), row({ processed: "YES", ref: "13" }), row({ processed: "YES", ref: "14" })];
  const w = world(rows, 5);                                                          // bookmark is past it
  w.sb.processNewTransactions();
  assert(processedAt(w, 3) === "YES" && w.pushes.length === 1, "a missed row in the middle is alerted once the scan finds it");
  w.pushes.length = 0;
  w.sb.processNewTransactions();
  assert(w.pushes.length === 0, "...and not again on the next run");
}

console.log("\n--- 3. Idle sheet: nothing to do, nothing sent ---");
{
  const rows = [row({ processed: "YES", ref: "21" }), row({ processed: "IGNORED", date: "", amount: "" }), row({ processed: "YES", ref: "22" })];
  const w = world(rows, 4);
  w.sb.processNewTransactions();
  assert(w.pushes.length === 0, "no notification when every real row is already processed");
  assert(processedAt(w, 3) === "IGNORED", "an IGNORED placeholder is left exactly as it was");
}

console.log("\n--- 4. A row that keeps failing stops after 3 tries (no notification spam, scan not held back) ---");
{
  const w = world([row({ amount: 77, ref: "31" })], 1);
  let attempts = 0;
  w.sb.sendPushNotification = function(){ attempts++; throw new Error("push service down"); };
  w.sb.processNewTransactions(); w.sb.processNewTransactions();
  assert(processedAt(w, 2) === "" && attempts === 2, "after 2 failures it is still retried (" + attempts + " attempts)");
  w.sb.processNewTransactions();
  assert(processedAt(w, 2) === "YES", "after the 3rd failure it is marked processed so it shows up in Pending");
  const before = attempts;
  w.sb.processNewTransactions(); w.sb.processNewTransactions();
  assert(attempts === before, "and the timer never tries to notify it again");
  const gaveUp = w.sheets.AILogs.rows.some((r) => r[1] === "PROCESS_TXN_GAVE_UP");
  assert(gaveUp, "the give-up is written to the log");
}

console.log("\nDone.");
