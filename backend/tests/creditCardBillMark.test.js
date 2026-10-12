// backend/tests/creditCardBillMark.test.js
//
// Plain-English what this checks: the Pending card's "Mark as > Card bill" button (index.html)
// writes the note "Credit card bill payment". That works only because the backend recognises
// those words as "this is the user paying their credit card bill - not new spending". This pins
// that contract, so a future change to the wording check cannot silently break the button.
// All data is invented.
//
// Run with: node backend/tests/creditCardBillMark.test.js

const fs = require("fs");
const path = require("path");
const { makeWorld, assert } = require("./_fakeSheetsKit");
const FILES = ["category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js"];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const NOTE = "Credit card bill payment";   // exactly what the button writes

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
assert(html.indexOf('"' + NOTE + '"') !== -1, "the button in index.html writes exactly the note this test uses");

const w = makeWorld(FILES);
const today = new Date(); today.setHours(0, 0, 0, 0);
const r = new Array(19).fill("");
r[0] = today; r[1] = "10:00:00"; r[2] = "TESTBANK"; r[3] = "debit"; r[4] = "upi"; r[5] = 14139; r[6] = "100000000001"; r[7] = "CRED CLUB"; r[15] = "YES";
w.addSheet("Transactions", [HEADER, r]);
["FinancialEvents", "Investments", "SmartMemory", "TypeVotes", "NoteMemory", "AILogs", "Cash"].forEach((n) => w.addSheet(n, [["h"]]));

console.log("\n--- The note the button writes is recognised as a credit card bill payment ---");
assert(w.sb.isCreditCardBillPayment("upi", "CRED CLUB", NOTE, 14139) === true, "recognised for a UPI payment to a bill-pay app (any payee, any amount)");
assert(w.sb.isCreditCardBillPayment("upi", "SOME SHOP", NOTE, 20) === true, "recognised whatever the amount is (the words decide, not the amount)");
assert(w.sb.isCreditCardBillPayment("upi", "CRED CLUB", "Lunch", 14139) === false, "an ordinary note at the same payee is NOT a bill payment");
assert(w.sb.isCreditCardBillPayment("card 1264", "CRED CLUB", NOTE, 14139) === false, "a real card swipe is never treated as a bill payment, whatever its note says");

console.log("\n--- Saving it: no Need/Want is stored, and the note and category are ---");
const res = w.sb.saveTransactionNote(2, NOTE, "Financial", "CRED CLUB", "Want", undefined, undefined, undefined, undefined, undefined, undefined);
assert(res.ok === true, "the save works");
assert(w.sheets.Transactions.rows[1][12] === NOTE && w.sheets.Transactions.rows[1][13] === "Financial", "note and category are stored");
assert(w.sheets.Transactions.rows[1][16] === "", "even if a Need/Want were sent, none is stored for a bill payment");

console.log("\nDone.");
