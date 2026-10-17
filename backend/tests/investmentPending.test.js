// backend/tests/investmentPending.test.js
//
// Plain English: when a payment is marked as an Investment in a named holding (the new Investment button on a Pending
// card, or the "Mark as SIP" panel), it is logged on the Investments screen and leaves your spending. This checks that
// it says so honestly when it could not log (a repeat), that a repeat is judged per holding (two different funds with
// the same amount in one week are NOT repeats), and that "No, regular spend" takes the entry back out safely.
// All data is invented.
//
// Run with: node backend/tests/investmentPending.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = ["category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "investmentInstruments.js", "settings.js", "PWA.js", "Logger.js"];
const TX_HEADER = ["Date", "Time", "Bank", "Type", "Mode", "Amount", "Reference", "Counterparty", "Channel", "Source", "RawSMS", "Sender", "Note", "Category", "TelegramMsgID", "Processed", "NeedWantSaving", "FinancialEvent", "FinancialEventName"];
const INS = [["HDFC Mid Cap Fund", "SIP", 4000, 10, "yes"], ["Tata Steel", "Stock", "", "", ""], ["Digital Gold", "Gold", "", "", ""]];
const txRow = (date, amount) => [date, "10:00", "HDFC", "debit", "upi", amount, "", "", "", "", "", "", "", "", "", "YES", "", "", ""];

function world(txRows, invRows){
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [TX_HEADER].concat(txRows));
  w.addSheet("Investments", [["Date", "Name", "Amount", "Note", "Kind"]].concat(invRows || []));
  w.addSheet("InvestmentInstruments", [["Name", "Category", "SipAmount", "SipDay", "SipActive"]].concat(INS));
  w.addSheet("FinancialEvents", [["Type", "Amount", "Counterparty", "Confirmed", "Name"]]);
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  return w;
}
const save = (w, row, name, extra) => w.sb.saveTransactionNote(row, "mutual fund", "Financial", "", "", undefined, name ? "Investment" : "", name || null, undefined, undefined, undefined, extra || {});
const inv = (w) => w.sheets.Investments.rows.slice(1);
const tx = (w, row, col) => w.sheets.Transactions.rows[row - 1][col - 1];

console.log("\n--- 1. Marked as an Investment: logged, honest answer ---");
{
  const w = world([txRow("2026-10-12", 5000)]);
  const r = save(w, 2, "Tata Steel");
  assert(r.ok === true && r.eventInvestmentLogged === true, "it is logged and the answer says so");
  assert(inv(w).length === 1 && inv(w)[0][1] === "Tata Steel" && inv(w)[0][2] === 5000 && inv(w)[0][4] === "payment", "one Investments entry, in the chosen holding, from the bank");
  assert(tx(w, 2, 18) === "Investment" && tx(w, 2, 19) === "Tata Steel", "the payment is marked Investment in Tata Steel (so it leaves Spent)");
  assert(tx(w, 2, 17) === "", "no Need/Want tag is stored for it");
}

console.log("\n--- 2. Repeat check is per holding ---");
{
  const w = world([txRow("2026-10-12", 5000)], [["2026-10-11", "Digital Gold", 5000, "x", "payment"]]);
  const r = save(w, 2, "Tata Steel");
  assert(r.eventInvestmentLogged === true && inv(w).length === 2, "5,000 into Tata Steel is not a repeat of 5,000 into Digital Gold");
  const w2 = world([txRow("2026-10-12", 5000)], [["2026-10-11", "Tata Steel", 5000, "x", "payment"]]);
  const r2 = save(w2, 2, "Tata Steel");
  assert(r2.ok === true && r2.eventInvestmentLogged === false && inv(w2).length === 1, "the same amount in the same holding within 3 days is not added again, and the answer says so");
  assert(tx(w2, 2, 18) === "Investment", "the payment is still marked as an Investment");
}

console.log("\n--- 3. 'No, regular spend' takes the entry back ---");
{
  const w = world([txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  assert(inv(w).length === 1, "(set up: entry logged)");
  const r = save(w, 2, null, { eventDeclined: true });
  assert(r.ok === true && r.investmentUndone === true && inv(w).length === 0, "the Investments entry is removed");
  assert(tx(w, 2, 18) === "" && tx(w, 2, 19) === "", "the marker is cleared");
}
{
  const w = world([txRow("2026-10-12", 5000), txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  w.sheets.Investments.rows.push(["2026-10-12", "Tata Steel", 5000, "x", "payment"]);   // a second, identical entry
  const r = save(w, 2, null, { eventDeclined: true });
  assert(r.investmentUndone === false && inv(w).length === 2, "two identical entries: nothing is removed (cannot tell which is which)");
}
{
  const w = world([txRow("2026-10-12", 5000), txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  w.sheets.Transactions.rows[2][17] = "Investment"; w.sheets.Transactions.rows[2][18] = "Tata Steel";   // another payment, same day/amount/holding
  const r = save(w, 2, null, { eventDeclined: true });
  assert(r.investmentUndone === false && inv(w).length === 1, "another payment is marked the same way: the entry is kept");
}
{
  const w = world([txRow("2026-10-12", 5000)], [["2026-10-12", "Tata Steel", 5000, "added by you", "manual"], ["2026-10-12", "Tata Steel", 5000, "Starting Balance", ""]]);
  w.sheets.Transactions.rows[1][17] = "Investment"; w.sheets.Transactions.rows[1][18] = "Tata Steel";
  const r = save(w, 2, null, { eventDeclined: true });
  assert(inv(w).length === 2, "hand-added and starting-balance entries are never removed");
  assert(r.investmentUndone === false, "and the answer says nothing was removed");
}


console.log("\n--- 4. Changing the holding or amount of a payment already marked as an Investment ---");
{
  const w = world([txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  const r = save(w, 2, "Digital Gold");
  assert(r.ok === true && inv(w).length === 1 && inv(w)[0][1] === "Digital Gold" && inv(w)[0][2] === 5000, "moved to another holding: the old entry is replaced, never counted twice (got " + JSON.stringify(inv(w)) + ")");
  assert(tx(w, 2, 19) === "Digital Gold" && r.investmentUndone === true && r.eventInvestmentLogged === true, "the row and the answer follow");
}
{
  const w = world([txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  w.sheets.Transactions.rows[1][5] = 5000;
  const r = w.sb.saveTransactionNote(2, "mutual fund", "Financial", "", "", 6500, "Investment", "Tata Steel", undefined, undefined, undefined, {});
  assert(inv(w).length === 1 && inv(w)[0][2] === 6500, "a corrected amount replaces the old entry (got " + JSON.stringify(inv(w)) + ")");
}
{
  const w = world([txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  const again = save(w, 2, "Tata Steel");
  assert(again.ok === true && inv(w).length === 1, "saving the same payment again changes nothing");
  assert(again.eventInvestmentLogged === null, "...and does not report a skipped log");
}
{
  const w = world([txRow("2026-10-12", 5000), txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  w.sheets.Transactions.rows[2][17] = "Investment"; w.sheets.Transactions.rows[2][18] = "Tata Steel";   // another payment, same day/amount/holding
  const r = save(w, 2, "Digital Gold");
  assert(inv(w).length === 1 && inv(w)[0][1] === "Tata Steel", "the old entry is shared with another payment: it stays, and no second one is added on top");
  assert(r.investmentUndoKept === true && tx(w, 2, 19) === "Digital Gold", "the answer says it was kept; the row still follows the new holding");
}
{
  const w = world([txRow("2026-10-12", 5000), txRow("2026-10-12", 5000)]);
  save(w, 2, "Tata Steel");
  w.sheets.Investments.rows.push(["2026-10-12", "Tata Steel", 5000, "x", "payment"]);
  const r = save(w, 2, null, { eventDeclined: true });
  assert(r.investmentUndone === false && r.investmentUndoKept === true && inv(w).length === 2, "regular spend with an unmatchable entry: kept and reported");
  assert(tx(w, 2, 18) === "" && tx(w, 2, 19) === "", "...and the payment is no longer marked Investment (no mixed state)");
}

console.log("\nAll Investment-on-Pending checks passed.");
