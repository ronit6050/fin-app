// backend/tests/reconcileXlsEndToEnd.test.js
//
// Plain-English what this checks: the whole Reconcile path for a REAL .xls file (the old binary spreadsheet format a bank gives you):
//   1. a genuine .xls file is created (blank lines at the top, bank-style layout, text dates, numeric amounts);
//   2. the phone-side reader in index.html (sheetRowsFromWorkbook, the exact code the app runs, with the SheetJS library) turns it into rows;
//   3. those rows go to the server's Reconcile preview, which must find the transactions on the bank's own row positions.
// It needs the open-source SheetJS library, which is NOT a dependency of this project: install it anywhere and point XLSX_DIR at the folder
// that contains node_modules/xlsx (default: %TEMP%/xlsxtest). Without it this test prints SKIP and passes.
// All data is invented. Run with: node backend/tests/reconcileXlsEndToEnd.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = process.env.XLSX_DIR || path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "xlsxtest");
let XLSX = null;
try{ XLSX = require(path.join(dir, "node_modules", "xlsx")); }catch(e){ XLSX = null; }
if(!XLSX){ console.log("SKIP: the SheetJS library was not found in " + dir + " (set XLSX_DIR). Nothing was checked."); process.exit(0); }

const { build } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

// ---- the REAL reader code from index.html
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const a = html.indexOf("    function sheetRowsFromWorkbook(");
const b = html.indexOf("    async function extractSheetRowsClientSide(");
assert(a > 0 && b > a, "found the phone-side reader in index.html");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + "\nthis.sheetRowsFromWorkbook = sheetRowsFromWorkbook;", ctx);

function seed(w){
  const sb = w.sb;
  sb.sendPushNotification = function(){};
  const today = new w.D(); today.setHours(10, 0, 0, 0);
  w.today = today;
  const { TXN_HEADER } = require("./_ownerWorld");
  const row = function(amt, ref, cp){ return [new w.D(today.getTime()), new w.D(1899, 11, 30, 18, 30, 0), "HDFC", "debit", "upi", amt, ref, cp, "SMS", "Tasker", "raw " + ref, "HDFCBK", "", "", "", "YES", "", "", "", "", ""]; };
  w.addSheet("Transactions", [TXN_HEADER, row(120, 111111, "Cafe A"), row(80, 222222, "Shop B")]);
  ["Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets", "SmartMemory", "NoteMemory", "TypeVotes", "LearnedSpamPatterns"].forEach(function(t){ w.addSheet(t, [["h"]]); });
  w.addSheet("Cash", [["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"], ["", today, "", "Credit", 500, "Opening Cash"]]);
  w.props.lastCheckedRow = "3";
  sb.v2dbImportOwner(); sb.v2dbEnableOwner();
}
const pad = function(n){ return String(n).padStart(2, "0"); };
const ddmmyy = function(d){ return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + String(d.getFullYear()).slice(2); };

console.log("\n--- A real .xls file, with empty lines at the top, read like the app reads it ---");
{
  const w = build(); seed(w);
  const d = ddmmyy(w.today);
  // truly empty rows first (they have no cells at all, so the file's own 'used range' starts lower down than row 1)
  const aoa = [[], [], [], [], ["Account Statement for XX1234"]];
  while(aoa.length < 22) aoa.push([]);
  aoa.push([d, "UPI-CAFE A-CAFEA@ybl-HDFC0000001-0000111111-lunch", "0000111111", d, 120, null, 9000]);
  aoa.push([d, "UPI-NEW SHOP-NEWSHOP@ybl-HDFC0000001-0000777777-books", "0000777777", d, 55, null, 8945]);
  aoa.push([d, "NEFT-SALARY CO-N123456", "0000888888", d, null, 500, 9445]);
  aoa.push([d, "OPENING BALANCE", "", d, null, 1000, 1000]);
  const wsOut = XLSX.utils.aoa_to_sheet(aoa);
  const wbOut = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbOut, wsOut, "Statement");
  const bytes = XLSX.write(wbOut, { bookType: "biff8", type: "buffer" });
  assert(bytes[0] === 0xD0 && bytes[1] === 0xCF, "the test file really is an old binary .xls (OLE2 header), not a newer format");

  const wbIn = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const rows = ctx.sheetRowsFromWorkbook(XLSX, wbIn);
  assert(Array.isArray(rows) && rows.length === 26, "the reader returns 26 rows counted from the very first row of the sheet (got " + (rows && rows.length) + ")");
  assert(rows[4][0] === "Account Statement for XX1234" && rows[22][2] === "0000111111", "the title is on row 5 and the first transaction on row 23, exactly like the bank's file");
  assert(typeof rows[22][4] === "number" && rows[22][4] === 120, "amounts stay numbers");
  assert(JSON.stringify(rows).length < 20000, "the payload is small");

  const r = w.act("owner", { action: "reconcileStatement", rows: JSON.parse(JSON.stringify(rows)) });   // through JSON, like the real request
  assert(r.ok === true && r.total === 3 && r.matched === 1 && r.missing.length === 2, "the server finds 3 transactions, 1 already tracked, 2 missing" + (r.ok ? "" : " (" + r.error + ")"));
  const deb = (r.missing || []).find(function(m){ return m.type === "debit"; });
  assert(deb && deb.amount === 55 && /books/i.test(deb.note), "the missing debit is the Rs 55 one with its note");

  // the wrong way to read it, to prove the row positions really matter: dropping the empty top lines breaks the parse
  const wsTrim = wbIn.Sheets[wbIn.SheetNames[0]];
  const naive = XLSX.utils.sheet_to_json(wsTrim, { header: 1, raw: true, defval: "" });
  const bad = w.act("owner", { action: "reconcileStatement", rows: JSON.parse(JSON.stringify(naive)) });
  assert(bad.ok === true && bad.total !== 3, "(sanity) a reader that ignores the empty top lines would NOT find the transactions (it found " + bad.total + ")");
}

console.log("\n--- A newer .xlsx file gives the same rows ---");
{
  const w = build(); seed(w);
  const d = ddmmyy(w.today);
  const aoa = []; while(aoa.length < 22) aoa.push([]);
  aoa.push([d, "UPI-NEW SHOP-NEWSHOP@ybl-HDFC0000001-0000777777-books", "0000777777", d, 55, null, 8945]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "S");
  const rows = ctx.sheetRowsFromWorkbook(XLSX, XLSX.read(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }), { type: "buffer" }));
  const r = w.act("owner", { action: "reconcileStatement", rows: JSON.parse(JSON.stringify(rows)) });
  assert(r.ok === true && r.total === 1 && r.missing.length === 1, ".xlsx works the same way");
}

console.log("\nDone.");
