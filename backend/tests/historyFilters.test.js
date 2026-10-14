// backend/tests/historyFilters.test.js
//
// Plain-English what this checks: History can now be searched and filtered
// (All / Needs attention / Rent / EMI / Investment / Credits / Split), jump to a
// month, and shows a per-name summary for Rent / EMI / Investment. The filter
// must happen BEFORE the page is cut (so pages and totals are right), the
// old call with no options must behave exactly as before, and nothing here may
// change any data. All data below is invented.
//
// Run with: node backend/tests/historyFilters.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "splits.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName","AutoSettled","FriendShare"];
const day = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0, 0);

function txn(o){
  const r = new Array(21).fill("");
  r[0] = o.date; r[1] = o.time || "10:00:00"; r[2] = "TESTBANK"; r[3] = o.type || "debit";
  r[4] = o.mode || "upi"; r[5] = o.amount; r[6] = o.ref === undefined ? "" : o.ref;
  r[7] = o.cp === undefined ? "SOME SHOP" : o.cp;
  r[8] = "SMS"; r[9] = "Tasker"; r[10] = "raw"; r[11] = "TESTBK"; r[12] = o.note === undefined ? "a note" : o.note;
  r[13] = o.category || "Other"; r[15] = "YES"; r[16] = o.nws || "";
  r[17] = o.fe || ""; r[18] = o.feName || ""; r[20] = o.share || "";
  return r;
}
const nativeDate = (w, d) => vm.runInContext("new Date(" + d.getTime() + ")", w.sb);
const nativeRow = (w, r) => { const c = r.slice(); if(c[0] instanceof Date) c[0] = nativeDate(w, c[0]); return c; };

function world(rows){
  const w = makeWorld(FILES);
  rows = rows.map((r) => nativeRow(w, r));
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  return w;
}
const hist = (w, o, off, lim) => w.sb.getTransactionHistory(off || 0, lim || 50, o);
const rowsOf = (h) => h.transactions.map((t) => t.row);

// 14 invented rows across Sept and Oct 2026 (oldest first in the sheet).
const ROWS = [
  txn({ date: day(2026, 9, 5),  amount: 15000, cp: "LANDLORD",  note: "september rent", fe: "Rent", category: "Bills" }),          // row 2
  txn({ date: day(2026, 9, 10), amount: 4000,  cp: "DAD",       note: "laptop emi", fe: "EMI", feName: "Laptop EMI", category: "Financial" }), // row 3
  txn({ date: day(2026, 9, 12), amount: 3000,  cp: "BANDHAN",   note: "sip", fe: "Investment", feName: "Bandhan SIP", category: "Financial" }), // row 4
  txn({ date: day(2026, 9, 30), amount: 45000, cp: "ACME CO",   note: "salary", type: "credit", category: "Income" }),             // row 5
  txn({ date: day(2026, 10, 1), amount: 349,   cp: "SWIGGY",    note: "lunch", category: "Food" }),                               // row 6
  txn({ date: day(2026, 10, 3), amount: 15000, cp: "LANDLORD",  note: "october rent", fe: "Rent", category: "Bills" }),           // row 7
  txn({ date: day(2026, 10, 5), amount: 4000,  cp: "DAD",       note: "laptop emi", fe: "EMI", feName: "Laptop EMI", category: "Financial" }), // row 8
  txn({ date: day(2026, 10, 6), amount: 1427,  cp: "DAD",       note: "laptop emi", fe: "EMI", feName: "Laptop EMI", category: "Financial" }), // row 9
  txn({ date: day(2026, 10, 7), amount: 15000, cp: "HDFC LTD",  note: "home loan emi", fe: "EMI", feName: "Home Loan EMI", category: "Financial" }), // row 10
  txn({ date: day(2026, 10, 8), amount: 4000,  cp: "DAD",       note: "emi for laptop", category: "Financial" }),                // row 11  NOT confirmed -> needs attention
  txn({ date: day(2026, 10, 9), amount: 120,   cp: "CAFE",      note: "tea with vaidehi", category: "Food", share: 60 }),          // row 12  split
  txn({ date: day(2026, 10, 10), amount: 20000, cp: "LANDLORD", note: "rent for november", category: "Bills" }),                 // row 13  NOT confirmed -> needs attention
  txn({ date: day(2026, 10, 11), amount: 60,   cp: "METRO",     note: "metro", category: "Transport" }),                           // row 14
  txn({ date: day(2026, 10, 12), amount: 500,  cp: "REFUNDER",  note: "refund", type: "credit", category: "Other" })              // row 15
];

console.log("\n--- 1. Old call (no options) behaves exactly as before ---");
{
  const w = world(ROWS);
  const h = w.sb.getTransactionHistory(0, 20);
  assert(h.total === 14 && h.transactions.length === 14, "all 14 noted rows, newest first (" + h.transactions.length + ")");
  assert(h.transactions[0].row === 15 && h.transactions[13].row === 2, "newest first");
  const h2 = w.sb.getTransactionHistory(5, 4);
  assert(h2.transactions.length === 4 && h2.total === 14 && h2.transactions[0].row === 10, "offset/limit still page through the list");
  assert(h.transactions[0].fp && h.transactions[0].suggestedFinancialEvent === null, "cards still carry fp and the same suggestion fields");
}

console.log("\n--- 2. Counts for the chips ---");
{
  const w = world(ROWS);
  const c = hist(w, {}).counts;
  assert(c.all === 14, "all = 14");
  assert(c.Rent === 2, "Rent confirmed = 2 (got " + c.Rent + ")");
  assert(c.EMI === 4, "EMI confirmed = 4 (got " + c.EMI + ")");
  assert(c.Investment === 1, "Investment confirmed = 1 (got " + c.Investment + ")");
  assert(c.credit === 2, "credits = 2 (got " + c.credit + ")");
  assert(c.split === 1, "split = 1 (got " + c.split + ")");
  assert(c.attn === 2, "needs attention = 2: the unconfirmed laptop emi and the unconfirmed rent (got " + c.attn + ")");
}

console.log("\n--- 3. Filters pick the right rows, before paging ---");
{
  const w = world(ROWS);
  assert(rowsOf(hist(w, { filter: "attn" })).join() === "13,11", "Needs attention = rows 13 and 11 (got " + rowsOf(hist(w, { filter: "attn" })).join() + ")");
  assert(rowsOf(hist(w, { filter: "Rent" })).join() === "7,2", "Rent = rows 7, 2");
  assert(rowsOf(hist(w, { filter: "EMI" })).join() === "10,9,8,3", "EMI = rows 10, 9, 8, 3");
  assert(rowsOf(hist(w, { filter: "Investment" })).join() === "4", "Investment = row 4");
  assert(rowsOf(hist(w, { filter: "credit" })).join() === "15,5", "Credits = rows 15, 5");
  assert(rowsOf(hist(w, { filter: "split" })).join() === "12", "Split = row 12");
  const p1 = hist(w, { filter: "EMI" }, 0, 2), p2 = hist(w, { filter: "EMI" }, 2, 2);
  assert(p1.total === 4 && rowsOf(p1).join() === "10,9" && rowsOf(p2).join() === "8,3", "paging happens AFTER the filter (total " + p1.total + ")");
  assert(hist(w, { filter: "nonsense" }).total === 14, "an unknown filter is treated as All");
}

console.log("\n--- 4. Search ---");
{
  const w = world(ROWS);
  assert(rowsOf(hist(w, { query: "laptop" })).join() === "11,9,8,3", "'laptop' finds the 4 laptop payments");
  assert(rowsOf(hist(w, { query: "LAPTOP EMI" })).join() === "9,8,3", "search ignores case (only the 3 confirmed Laptop EMI payments carry that exact event name and note)");
  assert(hist(w, { query: "Home Loan EMI" }).total === 1, "finds by the confirmed event name");
  assert(rowsOf(hist(w, { query: "swiggy" })).join() === "6", "finds by payee");
  assert(rowsOf(hist(w, { query: "food" })).join() === "12,6", "finds by category");
  assert(rowsOf(hist(w, { query: "4000" })).join() === "11,8,3", "'4000' finds the Rs 4,000 payments");
  assert(rowsOf(hist(w, { query: "4,000" })).join() === "11,8,3", "'4,000' works too");
  assert(rowsOf(hist(w, { query: "₹349" })).join() === "6", "'₹349' works too");
  assert(hist(w, { query: "zzzz-nothing" }).total === 0, "no match = empty, not an error");
  assert(rowsOf(hist(w, { query: "laptop", filter: "EMI" })).join() === "9,8,3", "search + filter combine");
  assert(hist(w, { query: "x".repeat(500) }).total === 0, "an absurdly long query is clipped, not an error");
}

console.log("\n--- 5. Month jump and the month list ---");
{
  const w = world(ROWS);
  const h = hist(w, {});
  assert(h.months.length === 2 && h.months[0].month === "2026-10" && h.months[0].count === 10 && h.months[1].month === "2026-09" && h.months[1].count === 4,
    "months newest first with counts: " + JSON.stringify(h.months));
  assert(hist(w, { month: "2026-09" }).total === 4, "September has 4");
  assert(rowsOf(hist(w, { month: "2026-09", filter: "credit" })).join() === "5", "month + filter combine");
  assert(hist(w, { month: "garbage" }).total === 14, "a bad month is ignored");
  assert(hist(w, { month: "2025-01" }).total === 0, "an empty month is empty");
  assert(hist(w, { month: "2026-09" }).counts.all === 14, "chip counts always describe the whole list, not the current view");
}

console.log("\n--- 6. Per-name summaries for Rent / EMI / Investment ---");
{
  const w = world(ROWS);
  const emi = hist(w, { filter: "EMI" }).summaries;
  assert(emi.length === 2, "two EMI names (got " + emi.length + ")");
  const laptop = emi.filter((s) => s.name === "Laptop EMI")[0], home = emi.filter((s) => s.name === "Home Loan EMI")[0];
  assert(laptop.count === 3 && laptop.total === 9427 && laptop.lastDate === "06 Oct 2026", "Laptop EMI: 3 payments, 9427, last 06 Oct 2026 (" + JSON.stringify(laptop) + ")");
  assert(home.count === 1 && home.total === 15000, "Home Loan EMI: 1 payment, 15000");
  const rent = hist(w, { filter: "Rent" }).summaries;
  assert(rent.length === 1 && rent[0].name === "Rent" && rent[0].count === 2 && rent[0].total === 30000, "Rent: one line, 2 payments, 30000");
  assert(hist(w, { filter: "all" }).summaries.length === 0 && hist(w, { filter: "attn" }).summaries.length === 0, "no summaries for other views");
  assert(hist(w, { filter: "EMI", query: "home" }).summaries.length === 1, "summaries follow the search");
}

console.log("\n--- 7. Cards keep their suggestion fields, and a CC bill / wallet top-up is never 'needs attention' ---");
{
  const w = world(ROWS);
  const a = hist(w, { filter: "attn" }).transactions;
  assert(a.every((t) => !t.financialEvent && t.suggestedFinancialEvent), "each attention card carries its suggested event for the one-tap confirm");
  const rows = ROWS.concat([txn({ date: day(2026, 10, 13), amount: 9000, cp: "PAYZAPP WALLET", ref: "123456789012", note: "wallet topup rent", category: "Other" })]);
  const w2 = world(rows);
  assert(!hist(w2, { filter: "attn" }).transactions.some((t) => t.row === 16), "a wallet top-up is never a Rent/EMI/Investment question");
}

console.log("\n--- 8. Read-only: nothing in the sheet changes ---");
{
  const w = world(ROWS);
  const before = JSON.stringify(w.sheets.Transactions.rows) + JSON.stringify(w.sheets.FinancialEvents.rows);
  hist(w, { filter: "attn", query: "rent", month: "2026-10" });
  hist(w, { filter: "EMI" });
  const after = JSON.stringify(w.sheets.Transactions.rows) + JSON.stringify(w.sheets.FinancialEvents.rows);
  assert(before === after, "History reads never write");
}

console.log("\n--- 9. The router passes the options through ---");
{
  const w = world(ROWS);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "PWA.js"), "utf8");
  assert(/getTransactionHistory\(data\.offset, data\.limit, \{ filter: data\.filter, query: data\.query, month: data\.month \}\)/.test(src), "PWA.js router forwards filter, query and month");
}

console.log("\n--- 10. Payments with no note yet (still in Pending) show under Needs attention only ---");
{
  const extra = [
    txn({ date: day(2026, 10, 13), amount: 15000, cp: "HOME RENT PAYMENT", note: "", category: "" }),            // row 16: unnoted, looks like rent
    txn({ date: day(2026, 10, 13), amount: 250,   cp: "SWIGGY",            note: "", category: "" }),            // row 17: unnoted, ordinary
    txn({ date: day(2026, 10, 14), amount: 9000,  cp: "RENT REFUND CO", note: "", type: "credit", category: "" }), // row 18: unnoted credit
    txn({ date: day(2026, 10, 14), amount: 700,   cp: "PAYZAPP WALLET RENT", ref: "123456789012", note: "", category: "" }) // row 19: unnoted wallet top-up
  ];
  const w = world(ROWS.concat(extra));
  const a = hist(w, { filter: "attn" });
  assert(rowsOf(a).join() === "16,13,11", "Needs attention = unnoted row 16 plus noted rows 13, 11, newest first (got " + rowsOf(a).join() + ")");
  assert(a.transactions[0].unnoted === true && a.transactions[1].unnoted !== true, "the not-yet-noted one is flagged unnoted");
  assert(a.transactions[0].suggestedFinancialEvent === "Rent", "and carries its suggestion");
  assert(a.counts.attn === 3, "chip count includes it (got " + a.counts.attn + ")");
  assert(hist(w, {}).total === 14 && !rowsOf(hist(w, {}, 0, 50)).includes(16), "All is unchanged: still only the 14 noted rows");
  assert(hist(w, { filter: "credit" }).total === 2 && hist(w, { filter: "Rent" }).total === 2, "other views never show unnoted rows");
  assert(hist(w, { filter: "attn", query: "home rent" }).total === 1, "search works on them");
  assert(hist(w, { filter: "attn", month: "2026-09" }).total === 0, "and the month filter");
  assert(!rowsOf(a).some((r) => r === 17 || r === 18 || r === 19), "an ordinary unnoted payment, an unnoted credit and a wallet top-up are never flagged");
}

console.log("\n--- 11. 'No, regular spend' is remembered (column V) and stops the nagging ---");
{
  const w = world(ROWS);
  const decline = (row) => w.sb.saveTransactionNote(row, "emi for laptop", "Financial", "DAD", undefined, undefined, undefined, undefined, undefined, undefined, undefined, { eventDeclined: true });
  assert(hist(w, { filter: "attn" }).counts.attn === 2, "before: 2 need attention");
  const r = decline(11);
  assert(r.ok === true, "the save itself works");
  assert(w.sheets.Transactions.rows[0][21] === "EventDeclined", "the column V header is added the first time");
  assert(w.sheets.Transactions.rows[10][21] === "YES", "row 11 is marked declined");
  const h = hist(w, { filter: "attn" });
  assert(h.counts.attn === 1 && rowsOf(h).join() === "13", "it leaves Needs attention (now only row 13)");
  const card = hist(w, {}, 0, 50).transactions.filter((t) => t.row === 11)[0];
  assert(card.suggestedFinancialEvent === null && card.eventDeclined === true, "its card no longer suggests Rent/EMI");
  assert(!w.sheets.Transactions.rows[10][17], "declining does NOT write a Rent/EMI/Investment into column R");
  w.sb.saveTransactionNote(11, "emi for laptop", "Financial", "DAD");
  assert(w.sheets.Transactions.rows[10][21] === "YES", "an ordinary re-save keeps the answer");
  w.sb.saveTransactionNote(11, "laptop emi", "Financial", "DAD", undefined, undefined, "EMI", "Laptop EMI");
  assert(!w.sheets.Transactions.rows[10][21] && w.sheets.Transactions.rows[10][17] === "EMI", "confirming an event later clears the declined marker");
  assert(!w.sheets.Transactions.rows[12][21], "no other row was marked");
}

console.log("\n--- 12. The router passes the declined answer through ---");
{
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "PWA.js"), "utf8");
  assert(/data\.eventDeclined === true\) replyOpts\.eventDeclined = true/.test(src), "PWA.js saveNote route forwards eventDeclined");
}

console.log("\nAll history filter checks passed.");
