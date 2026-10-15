// backend/tests/reconcileRows.test.js
//
// Plain-English what this checks: Reconcile (uploading a bank or credit-card statement) when the PHONE has already read the spreadsheet and
// sends its rows (added 2026-10-15), so no Google Drive is needed and it can run on the new server:
//   - a bank statement as rows: what is already tracked is matched, the rest is "missing", with the right type/amount/date;
//   - the same statement with dates as text (dd/mm/yy), as spreadsheet date numbers, and as date objects gives the same answer;
//   - a credit-card statement as rows (header found by its words);
//   - unreadable input is refused with a plain message;
//   - the approved rows are saved on the owner's private copy WITHOUT any Google Sheet (as on the new server): added once, marked processed,
//     and nothing is written to a Sheet.
// All data is invented. Run with: node backend/tests/reconcileRows.test.js

const { build, OWNER, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

function seed(w){
  const sb = w.sb;
  sb.sendPushNotification = function(title, body, extra){ w.pushes.push({ title: title, body: body, extra: extra || null }); };
  const today = new w.D(); today.setHours(10, 0, 0, 0);
  w.today = today;
  w.row = function(amt, ref, cp, proc){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, ref, cp, "SMS", "Tasker", "raw sms " + ref, "HDFCBK", "", "", "", proc === undefined ? "YES" : proc, "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, w.row(120, 111111, "Cafe A"), w.row(80, 222222, "Shop B")]);
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes", "LearnedSpamPatterns"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.props.lastCheckedRow = "3"; w.props.PWA_PUSH_TOKEN = "device-token-123";
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
  w.pushes.length = 0;
}
const pad = function(n){ return String(n).padStart(2, "0"); };
const ddmmyy = function(d){ return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + String(d.getFullYear()).slice(2); };
const serial = function(d){ return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(1899, 11, 30).getTime()) / 86400000); };

// A statement laid out like the bank's .xls: 22 lines of header, then one transaction per row:
// [date, narration, reference, value date, withdrawal, deposit, closing balance]
function bankRows(dateCell){
  const rows = [];
  for(let i = 0; i < 22; i++) rows.push(i === 3 ? ["Account Statement", "", "", "", "", "", ""] : ["", "", "", "", "", "", ""]);
  rows.push([dateCell, "UPI-CAFE A-CAFEA@ybl-HDFC0000001-0000111111-lunch", "0000111111", dateCell, 120, "", 9000]);          // already tracked (same reference and amount)
  rows.push([dateCell, "UPI-NEW SHOP-NEWSHOP@ybl-HDFC0000001-0000777777-books", "0000777777", dateCell, 55, "", 8945]);        // missing, debit, with a typed note
  rows.push([dateCell, "NEFT-SALARY CO-N123456", "0000888888", dateCell, "", 500, 9445]);                                         // missing, credit
  rows.push([dateCell, "OPENING BALANCE", "", dateCell, "", 1000, 1000]);                                                         // a summary line, never a transaction
  return rows;
}

function checkStatement(label, w, rows){
  const r = w.act("owner", { action: "reconcileStatement", rows: rows });
  assert(r.ok === true, label + ": answered ok" + (r.ok ? "" : " (" + r.error + ")"));
  assert(r.total === 3 && r.matched === 1 && r.missing.length === 2, label + ": 3 lines found, 1 already tracked, 2 missing (got " + r.total + "/" + r.matched + "/" + (r.missing || []).length + ")");
  const deb = (r.missing || []).find(function(m){ return m.type === "debit"; }), cred = (r.missing || []).find(function(m){ return m.type === "credit"; });
  assert(deb && deb.amount === 55 && deb.mode === "upi" && deb.ref === "777777" && /books/i.test(deb.note), label + ": the missing debit has the right amount, mode, reference and the typed note");
  assert(cred && cred.amount === 500 && cred.mode === "neft", label + ": the missing credit is a credit of 500 by NEFT");
  return r;
}

console.log("\n--- 1. A bank statement as rows (dates as text, like the bank's own file) ---");
{
  const w = build(); seed(w);
  checkStatement("text dates", w, bankRows(ddmmyy(w.today)));
}

console.log("\n--- 2. Same statement, dates as spreadsheet numbers or date objects ---");
{
  const w = build(); seed(w);
  checkStatement("number dates", w, bankRows(serial(w.today)));
  checkStatement("date objects", w, bankRows({ __date: w.today.getTime() }));
}

console.log("\n--- 3. A credit-card statement as rows ---");
{
  const w = build(); seed(w);
  const d = ddmmyy(w.today).replace(/\/(\d\d)$/, "/20$1");
  const rows = [["HDFC Credit Card Statement"], [], ["Date", "Transaction Description", "Amount"], [d, "AMAZON PAY", "250.00"], [d, "REFUND SHOP Cr", "40.00Cr"]];
  const r = w.act("owner", { action: "reconcileCreditCardStatement", rows: rows });
  assert(r.ok === true && r.total === 2 && r.missing.length === 2, "both card lines are found and missing" + (r.ok ? "" : " (" + r.error + ")"));
  assert(r.missing.every(function(m){ return m.mode === "card"; }), "each comes back as a card transaction");
  assert(r.missing.find(function(m){ return m.amount === 40; }).type === "credit", "the 'Cr' line is a credit");
}

console.log("\n--- 4. Unreadable input is refused plainly ---");
{
  const w = build(); seed(w);
  const a = w.act("owner", { action: "reconcileStatement", rows: [] });
  assert(a.ok === false && /could not be read/i.test(a.error), "an empty list of rows is refused");
  const b = w.act("owner", { action: "reconcileStatement", rows: [["just", "one", "row"]] });
  assert(b.ok === true && b.total === 0 && b.missing.length === 0, "a file with no transactions in it is simply 'nothing found'");
  const c = w.act("owner", { action: "reconcileCreditCardStatement", rows: [["no header here"], ["x"]] });
  assert(c.ok === false, "a card file without a header row is refused (" + c.error + ")");
  const huge = []; for(let i = 0; i < 20001; i++) huge.push(["x"]);
  assert(w.act("owner", { action: "reconcileStatement", rows: huge }).ok === false, "more than 20,000 rows is refused");
  const weird = w.act("owner", { action: "reconcileStatement", rows: bankRows(ddmmyy(w.today)).map(function(r){ return r.concat([{ evil: 1 }, null, undefined]); }) });
  assert(weird.ok === true && weird.total === 3, "odd cell contents (objects, nulls) are turned into plain text and ignored, not trusted");
}

console.log("\n--- 5. Approved rows are saved with NO Google Sheet (as on the new server) ---");
{
  const w = build(); seed(w); const sb = w.sb;
  const r = checkStatement("preview", w, bankRows(ddmmyy(w.today)));
  // from here on: no Google Sheet exists (the new server)
  sb.V2_ON_NEW_SERVER_ = true;
  sb.SpreadsheetApp = { getActiveSpreadsheet: function(){ return { getSheetByName: function(){ return null; }, getSheets: function(){ return []; }, insertSheet: function(){ throw new Error("This server has no Google Sheet"); } }; } };
  sb.logAI = function(type, message){ w.sheets.AILogs.appendRow([new Date(), type, String(message)]); };
  const realRowsBefore = w.sheets.Transactions.getLastRow();
  const save = w.act("owner", { action: "insertReconciledTransactions", source: "Bank Statement", transactions: r.missing.map(function(m){
    return { date: new w.D(m.rawDate + "T10:00:00"), type: m.type, mode: m.mode, amount: m.amount, ref: m.ref, name: m.name, note: m.note, category: "Other", needWantSaving: "" };
  }) });
  assert(save.ok === true && save.added === 2, "both missing rows were saved" + (save.ok ? "" : " (" + save.error + ")"));
  const mine = w.virtualTab(OWNER, "Transactions");
  assert(mine.length === 5, "his private Transactions now has 5 rows (3 + 2)");
  const added = mine.filter(function(r2){ return r2[8] === "Import"; });
  assert(added.length === 2 && added.every(function(r2){ return r2[15] === "YES" && r2[9] === "Bank Statement"; }), "the new rows are marked as imported, processed, from the bank statement");
  assert(w.sheets.Transactions.getLastRow() === realRowsBefore, "nothing was written to a Google Sheet");
  assert(w.errors("V2_SHADOW_ERROR").length === 0, "and no 'could not copy to the Sheet' error was raised");
  const again = w.act("owner", { action: "reconcileStatement", rows: bankRows(ddmmyy(w.today)) });
  assert(again.ok === true && again.matched === 3 && again.missing.length === 0, "uploading the same statement again finds everything tracked (nothing would be added twice)");
}

console.log("\nDone.");
