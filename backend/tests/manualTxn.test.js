// backend/tests/manualTxn.test.js
//
// Plain-English what this checks: "Add a transaction" by hand (manualTxn.js). It adds one row like an SMS row would be, already
// alerted, so it shows up in Pending; it validates what you type; it writes only to the signed-in person's own data (a friend's
// private space, or the owner's); a stranger or a friend without the full app cannot use it. All data here is invented.
// Run with: node backend/tests/manualTxn.test.js

const { build, OWNER, FRIEND, TXN_HEADER } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
sb.Utilities.getUuid = function(){ return require("crypto").randomUUID(); };
w.addSheet("Transactions", [TXN_HEADER, ["2026-10-10", "10:00:00", "HDFC", "debit", "upi", 50, "111", "Old", "SMS", "Phone", "x", "S", "", "", "", "YES"]]);
const today = new Date(); const ymd = function(d){ return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const add = function(who, over){ return w.act(who, Object.assign({ action: "addManualTransaction", type: "debit", amount: 250, counterparty: "Big Bazaar", mode: "upi" }, over || {})); };

console.log("\n--- 1. A friend with the full app adds one; it lands in her own Pending ---");
{
  assert(add("friend").ok === false, "a friend who is not switched on cannot use it");
  sb.v2dbEnableUser(FRIEND);
  const r = add("friend");
  assert(r.ok === true && /^MANUAL_/.test(r.reference), "it is added, with a unique MANUAL_ reference");
  const mine = w.virtualTab(FRIEND, "Transactions");
  const row = mine[mine.length - 1];
  assert(row[3] === "debit" && row[4] === "upi" && row[5] === 250 && row[7] === "Big Bazaar" && row[8] === "Manual" && row[15] === "YES", "type, mode, amount, who, channel Manual and Processed=YES are stored");
  assert(row[12] === "" && row[13] === "", "no note or category yet (those are chosen in Pending)");
  const pend = w.act("friend", { action: "getPending" });
  assert(pend.ok && pend.transactions.length === 1 && pend.transactions[0].counterparty === "Big Bazaar", "it shows up in HER Pending list");
  assert(JSON.stringify(w.sheets.Transactions.rows).indexOf("Big Bazaar") === -1, "the owner's Sheet was not touched");
  const again = add("friend");
  assert(again.ok && again.reference !== r.reference && w.virtualTab(FRIEND, "Transactions").length === mine.length + 1, "adding the same thing twice gives two rows (they are two payments)");
}

console.log("\n--- 2. What you type is checked ---");
{
  const before = w.virtualTab(FRIEND, "Transactions").length;
  assert(add("friend", { type: "x" }).ok === false, "an unknown type is refused");
  assert(add("friend", { amount: 0 }).ok === false && add("friend", { amount: -5 }).ok === false && add("friend", { amount: "abc" }).ok === false, "zero, negative and non-number amounts are refused");
  assert(add("friend", { counterparty: "   " }).ok === false, "an empty 'who' is refused");
  assert(add("friend", { mode: "bitcoin" }).ok === false, "an unknown payment method is refused");
  const tomorrow = new Date(today.getTime() + 3 * 86400000);
  assert(add("friend", { date: ymd(tomorrow) }).ok === false, "a date in the future is refused");
  assert(add("friend", { date: "13/10/2026" }).ok === false, "a badly written date is refused");
  assert(add("friend", { date: "2020-01-01" }).ok === false, "a date years ago is refused");
  assert(w.virtualTab(FRIEND, "Transactions").length === before, "none of those saved anything");
  const f = add("friend", { counterparty: "=IMPORTXML(\"http://evil\")" });
  assert(f.ok && w.virtualTab(FRIEND, "Transactions").pop()[7].indexOf("'=") === 0, "text starting with = is stored with a ' in front (never a formula)");
  const past = add("friend", { type: "credit", date: ymd(new Date(today.getTime() - 5 * 86400000)), mode: "netbanking", amount: 99.456 });
  const prow = w.virtualTab(FRIEND, "Transactions").pop();
  assert(past.ok && prow[3] === "credit" && prow[4] === "neft" && prow[5] === 99.46, "an earlier date, 'received' and net banking are stored (amount rounded to paise)");
}

console.log("\n--- 3. The owner's own use, and strangers ---");
{
  const r = add("owner", { counterparty: "Chai Stall", amount: 20 });
  assert(r.ok === true && JSON.stringify(w.sheets.Transactions.rows).indexOf("Chai Stall") !== -1, "the owner (still on the Sheet) adds to his own Sheet");
  assert(add("stranger").ok === false, "a stranger is refused");
}
