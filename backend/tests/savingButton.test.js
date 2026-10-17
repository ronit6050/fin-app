// backend/tests/savingButton.test.js
//
// Plain English: tapping the "Saving" button on a payment you SENT used to only put a label on it:
// it still counted as spending and never reached the Savings screen. Now it works like writing the
// word "saving" in the note: the payment leaves "Spent", is logged on the Savings screen (Free
// Savings), and shows in Analysis as "Saved". Changing it away from Saving takes the Savings entry
// back out (only when it is exactly the one the app wrote). All data is invented.
//
// Run with: node backend/tests/savingButton.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "settings.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "splits.js", "DebtAdvisor.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName","AutoSettled","FriendShare"];
const day = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0, 0);

function txn(o){
  const r = new Array(21).fill("");
  r[0] = o.date; r[1] = "10:00:00"; r[2] = "TESTBANK"; r[3] = o.type || "debit"; r[4] = "upi"; r[5] = o.amount;
  r[6] = o.ref || ""; r[7] = o.cp || "MY SAVINGS BANK"; r[8] = "SMS"; r[9] = "Tasker"; r[10] = "raw"; r[11] = "TESTBK"; r[15] = "YES";
  return r;
}
const nativeDate = (w, d) => vm.runInContext("new Date(" + d.getTime() + ")", w.sb);

function world(rows, savings){
  const w = makeWorld(FILES);
  rows = rows.map((r) => { const c = r.slice(); c[0] = nativeDate(w, c[0]); return c; });
  const savRowsIn = (savings || []).map((r) => [nativeDate(w, r[0]), r[1], r[2], r[3], r[4]]);
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("Savings", [["Date","Amount","Type","Note","Destination"]].concat(savRowsIn));
  w.addSheet("Debts", [["Date","Person","Type","Amount","Note","DueDate","Status","SettledDate"]]);
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  return w;
}
// opts.typeChosen = a person picked the tag (what the Pending card and History send). Pass {} for a notification-style save.
const save = (w, row, note, type, cp, opts, amount) =>
  w.sb.saveTransactionNote(row, note, "Financial", cp || "MY SAVINGS BANK", type, amount, undefined, undefined, undefined, undefined, undefined, opts || { typeChosen: true });
const savRows = (w) => w.sheets.Savings.rows.slice(1);
const cell = (w, row, col) => w.sheets.Transactions.rows[row - 1][col - 1];

console.log("\n--- 1. Tapping Saving on a debit ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 5000 })]);
  const r = save(w, 2, "moved to piggy bank", "Saving");
  assert(r.ok && r.savingEvent === true, "the save reports a saving event");
  assert(r.typeSaved === true && cell(w, 2, 17) === "Saving", "the Saving tag itself is kept on the row (column Q)");
  assert(cell(w, 2, 18) === "Saving", "the row is marked as a Saving event (column R)");
  assert(savRows(w).length === 1 && Number(savRows(w)[0][1]) === 5000 && savRows(w)[0][4] === "Free" && savRows(w)[0][2] === "payment",
    "exactly one 5000 entry lands on the Savings screen, in Free Savings");
  const again = save(w, 2, "moved to piggy bank", "Saving");
  assert(again.ok && savRows(w).length === 1, "saving the same payment again does not log a second entry (got " + savRows(w).length + ")");

  console.log("\n--- 2. What Analysis shows ---");
  const a = w.sb.getMonthlyAnalysis(2026, 10);
  assert(a.totalDebit === 0, "it is NOT counted as Spent (got " + a.totalDebit + ")");
  assert(a.saved === 5000, "Saved = 5000 from the Savings screen (got " + a.saved + ")");
  assert(a.needWantSaving.saving === 5000, "it still shows in the Need/Want/Saving chart's Saving slice");
  assert(typeof a.savingGoal === "number", "the monthly goal is returned");

  console.log("\n--- 3. Changing it away from Saving ---");
  const back = save(w, 2, "moved to piggy bank", "Want");
  assert(back.ok && back.savingUndone === true && savRows(w).length === 0, "the automatic Savings entry is taken back out");
  assert(cell(w, 2, 18) === "", "the Saving marker is cleared");
  assert(cell(w, 2, 17) === "Want", "the new tag is saved");
  const a2 = w.sb.getMonthlyAnalysis(2026, 10);
  assert(a2.totalDebit === 5000 && a2.saved === 0, "it is counted as Spent again and Saved is 0 (spent " + a2.totalDebit + ", saved " + a2.saved + ")");
}

console.log("\n--- 4. Cases that must NOT become a saving ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 700, type: "credit" }), txn({ date: day(2026, 10, 13), amount: 300, cp: "RAJ" })]);
  const r1 = save(w, 2, "got paid", "Saving");
  assert(r1.ok && r1.savingEvent === false && savRows(w).length === 0, "Saving tapped on money RECEIVED is not a saving");
  const r2 = save(w, 3, "lent to Raj", "Saving", "RAJ");
  assert(r2.ok && r2.savingEvent === false && savRows(w).length === 0, "a lending transfer is never a saving");
}

console.log("\n--- 5. Undo is careful ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 2000 })]);
  save(w, 2, "moved to piggy bank", "Saving");
  w.sheets.Savings.rows[1][1] = 1900;                       // the owner edited that Savings entry by hand
  const r = save(w, 2, "moved to piggy bank", "Need");
  assert(r.ok && r.savingUndone === false && r.savingUndoKept === true, "an entry that no longer matches is kept and reported, not guessed at");
  assert(savRows(w).length === 1, "so nothing was deleted");
  assert(cell(w, 2, 18) === "", "the marker is still cleared");
}

console.log("\n--- 6. The word 'saving' in the note still works, and un-works ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 1500 })]);
  const r = save(w, 2, "monthly saving", undefined);
  assert(r.ok && r.savingEvent === true && savRows(w).length === 1, "a note with the word saving logs a saving (unchanged behaviour)");
  const r2 = save(w, 2, "groceries", "Need");
  assert(r2.ok && r2.savingUndone === true && savRows(w).length === 0 && cell(w, 2, 18) === "", "editing the note away from saving takes it back out");
}

console.log("\n--- 7. Analysis 'Saved' is the month's net Savings entries ---");
{
  const w = world([], [
    [day(2026, 10, 3), 3000, "auto", "x", "Emergency"],
    [day(2026, 10, 9), 2000, "manual", "cash saved", "Free"],
    [day(2026, 10, 20), -500, "withdraw", "", "Free"],
    [day(2026, 9, 30), 9999, "auto", "last month", "Free"]
  ]);
  const a = w.sb.getMonthlyAnalysis(2026, 10);
  assert(a.saved === 4500, "3000 + 2000 - 500 withdrawn = 4500, last month's entry excluded (got " + a.saved + ")");
}

console.log("\n--- 8. A GUESSED Saving (notification button / reply) never moves money ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 800 })]);
  const r = save(w, 2, "moved to piggy bank", "Saving", undefined, {});          // no typeChosen: how a notification button saves
  assert(r.ok && r.savingEvent === false && savRows(w).length === 0 && cell(w, 2, 18) === "", "no saving event, no Savings entry, no marker");
  assert(cell(w, 2, 17) === "Saving", "the tag is still saved as a plain label, exactly as before this feature");
  assert(w.sb.getMonthlyAnalysis(2026, 10).totalDebit === 800, "and the payment still counts as Spent");
  const r2 = save(w, 2, "moved to piggy bank", "Saving", undefined, { typeChosen: true, autoType: true });   // autoType wins: it is the app's own guess
  assert(r2.ok && r2.savingEvent === false && savRows(w).length === 0, "an autoType reply never counts either");
}

console.log("\n--- 9. Editing the amount of a saving does not double-log it ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 500 })]);
  save(w, 2, "moved to piggy bank", "Saving");
  assert(savRows(w).length === 1 && Number(savRows(w)[0][1]) === 500, "starts with one 500 entry");
  const r = save(w, 2, "moved to piggy bank", "Saving", undefined, undefined, 600);   // amount edited to 600
  assert(r.ok && savRows(w).length === 1 && Number(savRows(w)[0][1]) === 600, "after the edit there is still ONE entry, now 600 (got " + savRows(w).map((x) => x[1]).join(",") + ")");
  const a = w.sb.getMonthlyAnalysis(2026, 10);
  assert(a.saved === 600, "Saved is 600, not 1100 (got " + a.saved + ")");
  const note = save(w, 2, "moved to the piggy bank pot", "Saving");                  // note edited
  assert(note.ok && savRows(w).length === 1 && Number(savRows(w)[0][1]) === 600, "editing the note keeps exactly one entry");
}

console.log("\n--- 10. Two identical same-day savings: nothing wrong is ever deleted ---");
{
  const w = world([txn({ date: day(2026, 10, 12), amount: 500 }), txn({ date: day(2026, 10, 12), amount: 500 })]);
  const r1 = save(w, 2, "first piggy", "Saving");
  const r2 = save(w, 3, "second piggy", "Saving");
  assert(r1.savingLogged === true && savRows(w).length === 1, "the first is logged");
  assert(r2.savingEvent === true && r2.savingLogged === false, "the second is counted as a saving but honestly reported as NOT added to Savings (duplicate guard)");
  const un = save(w, 3, "second piggy", "Want");
  assert(un.ok && un.savingUndone === false && savRows(w).length === 1, "un-saving the second never deletes the first one's entry (got " + savRows(w).length + ")");
  assert(cell(w, 2, 18) === "Saving", "the first payment is still a saving");
}

console.log("\n--- 11. A Rent / EMI row is never overwritten by the Saving button ---");
{
  const rows = [txn({ date: day(2026, 10, 12), amount: 15000 })];
  rows[0][17] = "Rent";
  const w = world(rows);
  const r = save(w, 2, "october rent", "Saving");
  assert(r.ok && r.savingEvent === false && cell(w, 2, 18) === "Rent" && savRows(w).length === 0, "marker stays Rent, nothing logged");
}

console.log(process.exitCode ? "\nSome checks FAILED" : "\nAll checks passed.");
