// backend/tests/staleCardSafeguard.test.js
//
// Plain-English what this checks: the app saves a note by ROW NUMBER, but row
// numbers move (a bank-statement reconcile re-sorts the whole sheet). A card
// left open on a backgrounded app, a second device, or an old notification
// holds the OLD number, so its save used to be able to land on a DIFFERENT
// transaction. Every card now carries a fingerprint of the transaction's
// never-edited details; the backend refuses a save whose fingerprint no longer
// matches the row. All data below is invented.
//
// Run with: node backend/tests/staleCardSafeguard.test.js

const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

// One Transactions row (columns A..S).
function txn(o){
  const r = new Array(19).fill("");
  r[0] = o.date || daysAgo(1); r[1] = o.time || "10:00:00"; r[2] = o.bank || "TESTBANK"; r[3] = o.type || "debit";
  r[4] = o.mode || "upi"; r[5] = o.amount; r[6] = o.ref === undefined ? "" : o.ref;
  r[7] = o.cp === undefined ? "SOME SHOP" : o.cp;
  r[8] = "SMS"; r[9] = "Tasker"; r[10] = "raw"; r[11] = "TESTBK"; r[12] = o.note || ""; r[13] = o.category || "";
  r[15] = o.processed === undefined ? "YES" : o.processed; r[16] = o.nws || "";
  return r;
}

// The backend runs in its own "room" (vm); a Date made outside it is not recognised
// as a Date inside. Real Google Sheets hands the backend native dates, so mimic that.
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
const snap = (w) => JSON.stringify(w.sheets.Transactions.rows);
// saveTransactionNote(row, note, category, counterparty, type, amount, ..., expectFp as 11th argument)
const save = (w, row, note, cat, cp, type, amount, fp) =>
  w.sb.saveTransactionNote(row, note, cat, cp, type, amount, undefined, undefined, undefined, undefined, fp);

console.log("\n--- 1. The fingerprint only uses details that are never edited ---");
{
  const w = world([]);
  const fp = (o) => w.sb.rowFingerprint_(nativeRow(w, txn(o)));
  const base = { amount: 100, ref: "000123456", cp: "Coffee Makers", note: "", category: "" };
  const f0 = fp(base);
  assert(typeof f0 === "string" && f0.length > 0, "a fingerprint is a short piece of text");
  assert(fp(base) === f0, "the same transaction always gives the same fingerprint");
  assert(fp(Object.assign({}, base, { amount: 999, note: "tea", category: "Food", nws: "Want", mode: "card 1111" })) === f0,
    "editing amount, note, category, type or mode does NOT change it (your own edits never cause a false alarm)");
  assert(fp(Object.assign({}, base, { ref: "123456" })) === f0, "a leading zero dropped by the sheet in the reference does not matter");
  assert(fp(Object.assign({}, base, { cp: "  coffee   MAKERS\n" })) === f0, "merchant case / spacing / line breaks do not matter");
  assert(fp(Object.assign({}, base, { cp: "Other Shop" })) !== f0, "a different merchant gives a different fingerprint");
  assert(fp(Object.assign({}, base, { time: "10:07:00" })) !== f0, "a different time gives a different fingerprint");
  assert(fp(Object.assign({}, base, { date: daysAgo(2) })) !== f0, "a different date gives a different fingerprint");
  assert(fp(Object.assign({}, base, { ref: "777" })) !== f0, "a different reference gives a different fingerprint");
  assert(fp(Object.assign({}, base, { type: "credit" })) !== f0, "debit vs credit gives a different fingerprint");
}

console.log("\n--- 2. Every card the backend sends carries its fingerprint ---");
{
  const rows = [txn({ amount: 10, cp: "Shop A", ref: "11", processed: "YES" }),
                txn({ amount: 20, cp: "Shop B", ref: "22", time: "11:00:00", processed: "YES" }),
                txn({ amount: 30, cp: "Shop C", ref: "33", time: "12:00:00", note: "done", category: "Food" })];
  const w = world(rows);
  const pending = w.sb.getPendingTransactions();
  assert(pending.length === 2 && pending.every((p) => p.fp === w.sb.rowFingerprint_(w.sheets.Transactions.rows[p.row - 1])),
    "every Pending card has an fp equal to its row's fingerprint (" + pending.length + " checked)");
  const hist = w.sb.getTransactionHistory(0, 50);
  const items = Array.isArray(hist) ? hist : (hist.transactions || hist.items || hist.history || []);
  assert(items.length >= 1 && items.every((h) => h.fp === w.sb.rowFingerprint_(w.sheets.Transactions.rows[h.row - 1])),
    "every History card has an fp equal to its row's fingerprint (" + items.length + " checked)");
}

console.log("\n--- 3. saveNote: right fingerprint saves; wrong one refuses and writes NOTHING ---");
{
  const w = world([txn({ amount: 10, cp: "Shop A", ref: "11", processed: "YES" }),
                   txn({ amount: 20, cp: "Shop B", ref: "22", time: "11:00:00", processed: "YES" })]);
  const fpA = w.sb.rowFingerprint_(w.sheets.Transactions.rows[1]);
  const fpB = w.sb.rowFingerprint_(w.sheets.Transactions.rows[2]);

  const before = snap(w);
  const stale = save(w, 2, "WRONG ROW NOTE", "Food", "Shop A", "Want", undefined, fpB);
  assert(stale.ok === false && stale.stale === true && /out of date/i.test(stale.error), "another row's fingerprint is refused with stale:true and a plain message");
  assert(snap(w) === before, "...and not a single cell of the sheet changed");

  const ok = save(w, 2, "tea", "Food", "Shop A", "Want", undefined, fpA);
  assert(ok.ok === true && w.sheets.Transactions.rows[1][12] === "tea" && w.sheets.Transactions.rows[1][13] === "Food", "the matching fingerprint saves normally");

  const legacy = save(w, 3, "milk", "Food", "Shop B", "Need", undefined, undefined);
  assert(legacy.ok === true && w.sheets.Transactions.rows[2][12] === "milk", "NO fingerprint (an older cached copy of the app) still saves exactly as before");

  const edited = save(w, 2, "tea again", "Food", "Shop A", "Want", 55, fpA);
  assert(edited.ok === true && w.sheets.Transactions.rows[1][5] === 55, "editing the amount then saving with the same fingerprint still works (no false alarm after your own edit)");
}

console.log("\n--- 4. 'Not a transaction' and 'fix card type' are guarded the same way ---");
{
  const w = world([txn({ amount: 10, cp: "Shop A", ref: "11", processed: "YES" }),
                   txn({ amount: 0, cp: "NEEDS REVIEW: promo", ref: "", time: "09:00:00", processed: "" })]);
  const fpOther = w.sb.rowFingerprint_(w.sheets.Transactions.rows[1]);
  const before = snap(w);
  const r1 = w.sb.markNotATransaction(3, fpOther);
  assert(r1.ok === false && r1.stale === true, "markNotATransaction with another row's fingerprint is refused");
  assert(snap(w) === before, "...and the row is untouched (not cleared)");

  const m = world([txn({ amount: 10, cp: "Shop A", ref: "11", mode: "upi", processed: "YES" })]);
  const fpM = m.sb.rowFingerprint_(m.sheets.Transactions.rows[1]);
  const bad = m.sb.fixTransactionMode(2, "card 1111", "wrongfp");
  assert(bad.ok === false && bad.stale === true && m.sheets.Transactions.rows[1][4] === "upi", "fixTransactionMode with a wrong fingerprint is refused and Mode is unchanged");
  assert(m.sb.fixTransactionMode(99, "card 1111", fpM).ok === false && m.sb.fixTransactionMode(1, "card 1111", fpM).ok === false, "fixTransactionMode now rejects a row number outside the data");
  const good = m.sb.fixTransactionMode(2, "card 1111", fpM);
  assert(good.ok === true && m.sheets.Transactions.rows[1][4] === "card 1111", "with the right fingerprint it fixes the Mode");
  assert(m.sb.fixTransactionMode(2, "upi").ok === true, "without a fingerprint it still works as before");
}

console.log("\n--- 5. THE INCIDENT: a reconcile re-sorts the sheet while a card is still open ---");
{
  const w = world([txn({ amount: 11, cp: "Old Shop", ref: "1", date: daysAgo(5), note: "x", category: "Food" }),
                   txn({ amount: 77, cp: "Target Shop", ref: "2", date: daysAgo(1), processed: "YES" })]);
  const card = w.sb.getPendingTransactions().find((p) => p.counterparty === "Target Shop");
  assert(card && card.row === 3, "setup: the open card points at row 3");

  w.sb.insertReconciledTransactions([
    { date: daysAgo(30), type: "debit", mode: "upi", amount: 5, ref: "9001", name: "", note: "older a", category: "", needWantSaving: "" },
    { date: daysAgo(29), type: "debit", mode: "upi", amount: 6, ref: "9002", name: "", note: "older b", category: "", needWantSaving: "" }
  ], "Bank Statement");
  assert(w.sheets.Transactions.rows[2][7] !== "Target Shop", "the reconcile moved things: row 3 is now a DIFFERENT transaction (" + w.sheets.Transactions.rows[2][7] + ")");

  const before = snap(w);
  const res = save(w, card.row, "my note", "Food", card.counterparty, "Want", undefined, card.fp);
  assert(res.ok === false && res.stale === true, "saving from the stale card is REFUSED");
  assert(snap(w) === before, "...and nothing was written onto the wrong transaction");

  const fresh = w.sb.getPendingTransactions().find((p) => p.counterparty === "Target Shop");
  assert(fresh && fresh.row !== card.row && fresh.fp === card.fp, "after refreshing, the same transaction is at its NEW row with the SAME fingerprint");
  const ok = save(w, fresh.row, "my note", "Food", fresh.counterparty, "Want", undefined, fresh.fp);
  assert(ok.ok === true && w.sheets.Transactions.rows[fresh.row - 1][7] === "Target Shop" && w.sheets.Transactions.rows[fresh.row - 1][12] === "my note",
    "the save from the refreshed card lands on the RIGHT transaction");
}

console.log("\n--- 6. Notification Confirm buttons and Reconcile preview cards carry it too ---");
{
  const w = world([txn({ amount: 350, cp: "Swiggy", ref: "123456789", processed: "" })]);
  w.sheets.SmartMemory.rows.push(["swiggy", "Food", "Delivery", 100, 5, new Date()]);
  w.sheets.NoteMemory.rows.push(["Swiggy", "Medium", "dinner", 4, new Date()]);
  w.props.lastCheckedRow = "1";
  w.sb.processNewTransactions();
  const push = w.pushes.find((p) => p.extra && p.extra.quickConfirm);
  assert(!!push, "setup: a Confirm-button notification was produced");
  assert(push && push.extra.fp === w.sb.rowFingerprint_(w.sheets.Transactions.rows[1]), "the notification payload carries the row's fingerprint");

  const pre = w.sb.previewReconciliation([{ date: nativeDate(w, daysAgo(1)), type: "debit", amount: 350, ref: "123456789", name: "Swiggy", note: "dinner from statement", mode: "upi" }], { checkCardMode: true, correctCardMode: "card 1111" });
  assert(pre.notesFound.length === 1 && pre.wrongMode.length === 1, "setup: the preview matched the row and produced both a note card and a wrong-mode card");
  const rowFp = w.sb.rowFingerprint_(w.sheets.Transactions.rows[1]);
  assert(pre.notesFound[0].fp === rowFp && pre.wrongMode[0].fp === rowFp, "both Reconcile preview cards carry the matched row's fingerprint");
}

console.log("\nDone.");
