// backend/tests/debtLinkOnce.test.js
//
// Plain-English what this checks: when a payment's note says "lent to <friend>" the app adds ONE
// entry to Debts. Saving the same payment again (a second Save tap, or fixing a typo in the note)
// used to add ANOTHER identical debt each time (four Save taps made four debts). Now the payment
// itself remembers it already created its debt (Transactions column W "DebtLinked"). A repayment
// ("paid back") is applied once the same way. All data below is invented.
//
// Run with: node backend/tests/debtLinkOnce.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "splits.js", "DebtAdvisor.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName","AutoSettled","FriendShare"];
const day = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0, 0);

function txn(o){
  const r = new Array(21).fill("");
  r[0] = o.date; r[1] = o.time || "10:00:00"; r[2] = "TESTBANK"; r[3] = o.type || "debit";
  r[4] = "upi"; r[5] = o.amount; r[6] = o.ref || ""; r[7] = o.cp || "SOME SHOP";
  r[8] = "SMS"; r[9] = "Tasker"; r[10] = "raw"; r[11] = "TESTBK"; r[12] = ""; r[13] = ""; r[15] = "YES";
  return r;
}
const nativeDate = (w, d) => vm.runInContext("new Date(" + d.getTime() + ")", w.sb);

function world(rows, debts){
  const w = makeWorld(FILES);
  rows = rows.map((r) => { const c = r.slice(); c[0] = nativeDate(w, c[0]); return c; });
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("Debts", [["Date","Person","Type","Amount","Note","DueDate","Status","SettledDate"]].concat(debts || []));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  w.addSheet("DebtPayments", [["Date","Row","Person","Type","Amount"]]);
  return w;
}
const save = (w, row, note, person) =>
  w.sb.saveTransactionNote(row, note, "Financial", "SOME SHOP", undefined, undefined, undefined, undefined, person);
const debtRows = (w) => w.sheets.Debts.rows.slice(1);

console.log("\n--- 1. Saving the same 'lent' payment several times creates ONE debt ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 94, cp: "MEESE FOODS" })]);
  const r1 = save(w, 2, "Lent vaidehi for idli", "Vaidehi");
  assert(r1.ok && r1.debtLinked === true && debtRows(w).length === 1, "first save adds one debt (got " + debtRows(w).length + ")");
  assert(debtRows(w)[0][1] === "Vaidehi" && debtRows(w)[0][2] === "LENT" && debtRows(w)[0][3] === 94, "it is a LENT debt of 94 for Vaidehi");
  assert(w.sheets.Transactions.rows[0][22] === "DebtLinked", "the column W header is added the first time");
  assert(w.sheets.Transactions.rows[1][22] === "YES", "the payment is marked as already linked");
  const r2 = save(w, 2, "Lent vaidehi for idli", "Vaidehi");
  const r3 = save(w, 2, "Lent vaidehi for idli", "Vaidehi");
  const r4 = save(w, 2, "Lent vaidehi for idl", "Vaidehi");   // the note edited afterwards
  assert(r2.ok && r2.debtAlreadyLinked === true && r4.ok && r4.debtAlreadyLinked === true, "later saves say it was already linked");
  assert(debtRows(w).length === 1, "still ONE debt after four saves (got " + debtRows(w).length + ")");
}

console.log("\n--- 2. Different payments still each get their own debt ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 94, cp: "A" }), txn({ date: day(2026, 10, 13), amount: 60, cp: "B", time: "11:00:00" })]);
  save(w, 2, "Lent vaidehi for idli", "Vaidehi");
  save(w, 3, "Lent vaidehi for tea", "Vaidehi");
  assert(debtRows(w).length === 2 && debtRows(w)[1][3] === 60, "two payments, two debts");
}

console.log("\n--- 3. A failed link is not remembered, so a retry can still work ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 94, cp: "A" })]);
  const r = save(w, 2, "Dinner at the cafe", "Vaidehi");   // no lent / repaid wording: no clear direction
  assert(r.ok && r.debtLinked === false && debtRows(w).length === 0, "no debt, nothing linked");
  assert(!w.sheets.Transactions.rows[1][22], "so the payment is NOT marked");
  const r2 = save(w, 2, "Lent vaidehi for dinner", "Vaidehi");
  assert(r2.debtLinked === true && debtRows(w).length === 1, "fixing the note and saving again now creates the debt");
}

console.log("\n--- 4. A repayment is applied once, not on every save ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 40, type: "credit", cp: "VAIDEHI" })],
                  [[day(2026, 10, 1), "Vaidehi", "LENT", 100, "lent", "", "Pending", ""]]);
  const r1 = save(w, 2, "Vaidehi paid back", "Vaidehi");
  assert(r1.ok && Number(w.sheets.Debts.rows[1][3]) === 60, "the 100 debt drops to 60 (got " + w.sheets.Debts.rows[1][3] + ")");
  save(w, 2, "Vaidehi paid back", "Vaidehi");
  save(w, 2, "Vaidehi paid back again", "Vaidehi");
  assert(Number(w.sheets.Debts.rows[1][3]) === 60, "still 60 after more saves, not 20 (got " + w.sheets.Debts.rows[1][3] + ")");
}

console.log("\n--- 5. No person chosen = nothing touched (old behaviour) ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 94, cp: "A" })]);
  const r = save(w, 2, "Lent vaidehi for idli", undefined);
  assert(r.ok && debtRows(w).length === 0 && !w.sheets.Transactions.rows[0][22], "no debt, no marker, no header");
}

console.log("\nAll debt-link-once checks passed.");
