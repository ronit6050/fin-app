// backend/tests/autoSettle.test.js
//
// Plain-English what this checks: the "settle the knowns silently" step in
// processNewTransactions (backend/autoSettle.js, added 2026-10-10, made much
// stricter after an independent review the same day).
//
// The guiding rule: a SILENT action needs a far higher bar than a one-tap
// suggestion. So auto-settle only acts on:
//   a. a credit card bill payment recognized by its WORDING (never by an
//      amount that merely equals the bill),
//   b. a wallet top-up over a bank-transfer mode,
//   c. a recurring Rent / named EMI / named SIP that matches a remembered one
//      on a bank-transfer mode, within Rs.1, with a real payee that matches
//      strictly, and unambiguously (exactly one remembered event fits).
// Everything else - including every look-alike - must stay in Pending.
// Also proves: nothing auto-settled ever teaches the learning systems or the
// FinancialEvents memory, a failure leaves no orphans anywhere, the sweep
// matches its preview, and the 20th column (T) upsets nothing else.
//
// ALL DATA HERE IS INVENTED (this repo is public).
//
// Run with: node backend/tests/autoSettle.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js",
  "Logger.js", "transactions.js", "autoSettle.js", "obligationReminders.js"
];

const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const FE_HEADER = ["Type","Amount","Counterparty","Confirmed","Name"];

function today(){ const d = new Date(); d.setHours(0,0,0,0); return d; }

// One Transactions row (A..Q, the 17 columns the SMS reader writes).
function txn(o){
  return [
    o.date || today(), o.time || "10:00:00", "TESTBANK", o.type || "debit", o.mode || "upi",
    o.amount, o.reference === undefined ? "" : o.reference, o.counterparty === undefined ? "" : o.counterparty,
    "SMS", "Tasker", "raw", "TESTBK", o.note || "", o.category || "", "",
    o.processed === undefined ? "" : o.processed, o.nws || ""
  ];
}

function freshWorld(extraRows, opts){
  opts = opts || {};
  const w = makeWorld(FILES);
  const header = TXN_HEADER.concat(opts.t1 === undefined ? [] : [opts.t1]);
  w.addSheet("Transactions", [header].concat(extraRows));
  w.addSheet("FinancialEvents", [
    FE_HEADER,
    ["Rent", 15000, "sunrise landlord property\non", "", ""],
    ["Investment", 3000, "", "", "Alpha Index SIP"],                      // seeded, blank payee
    ["Investment", 3000, "clearco  mutual funds", "", "Alpha Index SIP"],  // a later real confirmation
    ["Investment", 2000, "NSECLEARINGLIMITED", "", "Gamma Small Cap"],
    ["EMI", 1427, "rao family member", "", "Laptop EMI"]
  ].concat(opts.moreFE || []));
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);

  // Spies: any call to a learning function is a test failure for an
  // auto-settled row. (Overwriting the global makes every caller use the spy.)
  w.learned = [];
  ["handleCategoryCorrection", "recordTypeVote", "recordNoteUsage"].forEach(function(fn){
    w.sb[fn] = function(){ w.learned.push(fn); };
  });
  return w;
}

function snapshot(sheet){ return JSON.stringify(sheet.rows); }
function logTypes(w){ return w.sheets.AILogs.rows.slice(1).map(function(r){ return r[1]; }); }
function settled(w, rowNumber){ const v = w.sheets.Transactions.rows[rowNumber - 1][19]; return !!v; }

// A card swipe in the "outstanding" credit card cycle, so a bill-amount match is possible.
function swipeInOutstandingWindow(w, amount){
  const win = w.sb.getOutstandingCCCycleWindow_();
  const mid = new Date(win.start.getTime() + 5 * 86400000);
  return txn({ date: mid, mode: "card 1111", amount: amount, counterparty: "some shop", processed: "YES", note: "x", category: "Other" });
}

// ---------------------------------------------------------------------
console.log("\n--- 1. Credit card bill payment (by wording) ---");
{
  const w = freshWorld([txn({ amount: 5000, counterparty: "TESTBANK Credit Card Payment", reference: "5551111" })]);
  w.sb.processNewTransactions();
  const r = w.sheets.Transactions.rows[1];
  assert(r[12] === "Credit card bill payment" && r[13] === "Financial", "note + category written");
  assert(r[19] === "ccbill", "column T marked ccbill (got " + r[19] + ")");
  assert(r[15] === "YES", "marked Processed so it never re-enters the pipeline");
  assert(w.pushes.length === 0, "no push notification sent");
  assert(w.learned.length === 0, "no learning function called (got " + w.learned.join(",") + ")");
  assert(w.sheets.Transactions.rows[0][19] === "AutoSettled", "header AutoSettled added to column T");
  assert(w.sb.getPendingTransactions().length === 0, "nothing left in Pending");
}

console.log("\n--- 1b. Glued wording \"cc billpay\" is recognized ---");
{
  const w = freshWorld([txn({ amount: 4321.10, counterparty: "acme bank cc billpay on", reference: "5552222" })]);
  w.sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[1][19] === "ccbill" && w.pushes.length === 0, "\"acme bank cc billpay on\" settled as a bill payment");
  assert(w.sb.isCreditCardBillPayment("upi", "acme bank cc billpay on", "", 149, []) === true, "isCreditCardBillPayment itself says yes (so Analysis excludes it from spend too)");
  assert(w.sb.isCreditCardBillPayment("upi", "billing department store", "", 149, []) === false, "unrelated 'billing' wording is still not a bill payment");
}

console.log("\n--- 2. Bill match by AMOUNT ONLY is NOT settled silently (but is still excluded from spend) ---");
{
  const w = freshWorld([]);
  w.sheets.Transactions.rows.push(swipeInOutstandingWindow(w, 7321.5));
  w.sheets.Transactions.rows.push(txn({ amount: 7321.5, counterparty: "SOME PAYMENT APP CLUB", reference: "5553333" }));
  w.sb.processNewTransactions();
  assert(!settled(w, 3), "not settled silently");
  assert(w.pushes.length === 1, "the normal notification went out");
  const pend = w.sb.getPendingTransactions();
  assert(pend.length === 1 && pend[0].isNonSpendTransfer === true, "waits in Pending, still flagged as a non-spend transfer");
  assert(w.sb.getTodaySummary().bankSpend === 0, "and is still excluded from today's spend, as before");
  // a coincidence: small card total equals a small subscription
  const w2 = freshWorld([]);
  w2.sheets.Transactions.rows.push(swipeInOutstandingWindow(w2, 149));
  w2.sheets.Transactions.rows.push(txn({ amount: 149, counterparty: "video subscription", reference: "5553334" }));
  w2.sb.processNewTransactions();
  assert(!settled(w2, 3) && w2.pushes.length === 1, "a Rs.149 subscription matching a Rs.149 card total is NOT filed as a bill payment");
}

console.log("\n--- 3. Wallet top-up ---");
{
  const w = freshWorld([txn({ amount: 2000, counterparty: "Sample Wallet", reference: "5554444" })]);
  w.sb.processNewTransactions();
  const r = w.sheets.Transactions.rows[1];
  assert(r[12] === "Wallet top-up" && r[13] === "Financial" && r[19] === "wallet-topup", "wallet top-up (upi, with reference) settled");
  assert(w.pushes.length === 0 && w.learned.length === 0, "no push, no learning");

  const w2 = freshWorld([txn({ amount: 49, counterparty: "Sample Wallet", reference: "" })]);
  w2.sb.processNewTransactions();
  assert(!settled(w2, 2) && w2.pushes.length === 1, "wallet purchase without a reference is NOT settled");

  const w3 = freshWorld([txn({ amount: 80.84, mode: "wallet", counterparty: "sample wallet\non", reference: "5559876" })]);
  w3.sb.processNewTransactions();
  assert(!settled(w3, 2) && w3.pushes.length === 1, "wallet-MODE purchase carrying a reference is NOT a top-up");

  const w4 = freshWorld([txn({ amount: 2000, mode: "other", counterparty: "Sample Wallet", reference: "5554445" })]);
  w4.sb.processNewTransactions();
  assert(!settled(w4, 2) && w4.pushes.length === 1, "unknown mode (\"other\") is NOT settled silently");
}

console.log("\n--- 4. Rent: exact amount, real matching payee, bank-transfer mode ---");
{
  const w = freshWorld([txn({ amount: 15000, counterparty: "Sunrise  Landlord\non", reference: "5555555" })]);
  const feBefore = snapshot(w.sheets.FinancialEvents);
  w.sb.processNewTransactions();
  const r = w.sheets.Transactions.rows[1];
  assert(r[12] === "Rent" && r[13] === "Financial" && r[17] === "Rent" && r[19] === "fe:Rent", "Rent settled like a human Yes");
  assert(r[16] === "", "no Need/Want/Saving written");
  assert(snapshot(w.sheets.FinancialEvents) === feBefore, "FinancialEvents memory NOT written by the silent path");
  assert(w.pushes.length === 0 && w.learned.length === 0, "no push, no learning");
  assert(w.sheets.SmartMemory.rows.length === 1 && w.sheets.TypeVotes.rows.length === 1 && w.sheets.NoteMemory.rows.length === 1,
    "SmartMemory / TypeVotes / NoteMemory untouched");
}

console.log("\n--- 4b. Advance-notice history still comes from columns R/S of Transactions ---");
{
  const older = function(monthsAgo){ const d = today(); d.setMonth(d.getMonth() - monthsAgo); return d; };
  const w = freshWorld([
    txn({ date: older(2), amount: 15000, counterparty: "Sunrise Landlord Property", processed: "YES", note: "Rent", category: "Financial" }),
    txn({ date: older(1), amount: 15000, counterparty: "Sunrise Landlord Property", processed: "YES", note: "Rent", category: "Financial" }),
    txn({ amount: 15000, counterparty: "Sunrise  Landlord\non", reference: "5555556" })
  ]);
  w.sheets.Transactions.rows[1][17] = "Rent"; w.sheets.Transactions.rows[2][17] = "Rent";
  w.sb.processNewTransactions();
  const hist = w.sb.findObligationHistory_("Rent", "", w.sheets.Transactions.getDataRange().getValues());
  assert(hist.length === 3, "the auto-settled Rent row counts in the reminder history (got " + hist.length + ")");
  const st = w.sb.computeObligationStatuses_(w.sheets.FinancialEvents.getDataRange().getValues(), w.sheets.Transactions.getDataRange().getValues(), today());
  assert(st.some(function(s){ return s.type === "Rent" && s.enoughHistory; }), "computeObligationStatuses_ still works with it");
}

console.log("\n--- 5. Named SIP: logs into Investments (last), exactly once, no memory row ---");
{
  const w = freshWorld([txn({ amount: 3000, counterparty: "Clearco - Mutual Funds", reference: "5557777" })]);
  const feBefore = snapshot(w.sheets.FinancialEvents);
  w.sb.processNewTransactions();
  const r = w.sheets.Transactions.rows[1];
  assert(r[17] === "Investment" && r[18] === "Alpha Index SIP" && r[12] === "Alpha Index SIP" && r[19] === "fe:Alpha Index SIP", "SIP settled with its name");
  assert(w.sheets.Investments.rows.length === 2 && w.sheets.Investments.rows[1][1] === "Alpha Index SIP" && w.sheets.Investments.rows[1][2] === 3000,
    "Investments tab got the entry");
  assert(snapshot(w.sheets.FinancialEvents) === feBefore, "FinancialEvents memory NOT written");
  w.sb.processNewTransactions();
  assert(w.sheets.Investments.rows.length === 2, "second run does not duplicate it");
  assert(w.pushes.length === 0 && w.learned.length === 0, "no push, no learning");
}

console.log("\n--- 5b. Glued vs spaced payee still matches (NSECLEARINGLIMITED vs 'NSE Clearing Limited') ---");
{
  const w = freshWorld([txn({ amount: 2000, counterparty: "NSE Clearing Limited", reference: "5558888" })]);
  w.sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[1][18] === "Gamma Small Cap" && w.pushes.length === 0, "settled as Gamma Small Cap");
  const s = w.sb;
  assert(s.strictPayeeMatch_("NSE Clearing Limited", "NSECLEARINGLIMITED") === true, "strictPayeeMatch_ agrees");
  assert(s.strictPayeeMatch_("Greenview Landlord", "sunrise landlord property") === false, "one shared common word is NOT enough");
  assert(s.strictPayeeMatch_("Bala Kumar Nair", "Asha Kumar Nair") === true, "two shared words is enough");
  assert(s.strictPayeeMatch_("anyone", "") === false && s.strictPayeeMatch_("", "someone") === false, "an empty payee on either side never matches");
}

console.log("\n--- 6. Look-alikes that must NOT be settled silently ---");
{
  const rows = [
    txn({ mode: "card 1111", amount: 3000, counterparty: "" }),                              // card swipe, no payee, SIP amount
    txn({ mode: "wallet", amount: 2000, counterparty: "" }),                                  // wallet debit, SIP amount
    txn({ amount: 3000, counterparty: "" }),                                                  // bank transfer, SIP amount, NO payee
    txn({ amount: 3011, counterparty: "Clearco Mutual Funds" }),                              // right payee, amount off by 11
    txn({ amount: 15200, counterparty: "Sunrise Landlord Property" }),                        // rent-ish amount within 5% but not exact
    txn({ amount: 15000, counterparty: "Greenview Landlord" }),                               // rent amount, different landlord (one shared word)
    txn({ mode: "other", amount: 3000, counterparty: "Clearco Mutual Funds" }),               // unknown mode
    txn({ mode: "card 1111", amount: 3000, counterparty: "Clearco Mutual Funds" }),           // card mode even with payee
    txn({ amount: 1427, counterparty: "unrelated payee" }),                                   // EMI amount, wrong payee
    txn({ amount: 1427, counterparty: "" }),                                                  // EMI amount, no payee
    txn({ amount: 15000, type: "credit", counterparty: "Sunrise Landlord Property" }),        // credit
    txn({ amount: 2000, counterparty: "NEEDS REVIEW: Sample Wallet", reference: "5554446" }), // uncertain parse
    txn({ amount: 40, counterparty: "small shop" })                                           // ordinary spend
  ];
  const w = freshWorld(rows);
  const feBefore = snapshot(w.sheets.FinancialEvents), invBefore = snapshot(w.sheets.Investments);
  w.sb.processNewTransactions();
  rows.forEach(function(r, i){
    assert(!settled(w, i + 2), "look-alike #" + (i + 1) + " not settled (" + r[4] + ", " + r[5] + ", \"" + r[7] + "\")");
  });
  assert(w.pushes.length === rows.length, "all " + rows.length + " still produced the normal notification (" + w.pushes.length + ")");
  assert(w.sheets.Transactions.rows.slice(1).every(function(r){ return r[15] === "YES" && r[12] === ""; }), "all marked Processed, no note written");
  assert(snapshot(w.sheets.FinancialEvents) === feBefore && snapshot(w.sheets.Investments) === invBefore, "no side effects anywhere");
  // the human-facing chip is UNCHANGED (still offers the looser 5% match)
  const chip = w.sb.suggestFinancialEvent("Sunrise Landlord Property", 15200, w.sheets.FinancialEvents.getDataRange().getValues(), "");
  assert(chip && chip.type === "Rent" && chip.confident === true, "the Pending chip still suggests Rent for 15200 (unchanged)");
}

console.log("\n--- 6b. Ambiguous: two remembered SIPs of the same amount and payee -> Pending ---");
{
  const w = freshWorld([txn({ amount: 3000, counterparty: "Clearco Mutual Funds", reference: "5559999" })],
    { moreFE: [["Investment", 3000, "clearco mutual funds", "", "Beta Growth SIP"]] });
  w.sb.processNewTransactions();
  assert(!settled(w, 2) && w.pushes.length === 1, "not settled, normal notification");
  assert(w.sheets.Investments.rows.length === 1, "nothing logged to Investments");
}

console.log("\n--- 7. Fail-safe: a write error part-way falls through, leaves NO orphans ---");
{
  const w = freshWorld([
    txn({ amount: 3000, counterparty: "Clearco Mutual Funds", reference: "5551010" }),   // will blow up (column N)
    txn({ amount: 2000, counterparty: "Sample Wallet", reference: "5551011" })           // fine
  ]);
  const feBefore = snapshot(w.sheets.FinancialEvents);
  w.sheets.Transactions.failOnSet = function(r, c){ return r === 2 && c === 14; };
  let threw = false;
  try { w.sb.processNewTransactions(); } catch(e) { threw = true; }
  const t = w.sheets.Transactions.rows;
  assert(!threw, "processNewTransactions did not throw");
  assert(t[1][17] === "" && t[1][18] === "" && t[1][12] === "" && !t[1][19], "half-written cells (R, S, M, T) were put back");
  assert(w.sheets.Investments.rows.length === 1, "no Investments row left behind");
  assert(snapshot(w.sheets.FinancialEvents) === feBefore, "no FinancialEvents row left behind");
  assert(t[1][15] === "YES", "failed row still marked Processed (so it is not stuck)");
  assert(w.pushes.length === 1 && /3,000/.test(w.pushes[0].body), "failed row fell through to the normal alert");
  assert(logTypes(w).indexOf("AUTO_SETTLE_ERROR") !== -1, "AUTO_SETTLE_ERROR logged");
  assert(t[2][19] === "wallet-topup" && t[2][15] === "YES", "the next row in the same run was still settled normally");
  assert(w.props.lastCheckedRow === String(t.length), "lastCheckedRow bookmark still saved");
}
{
  // The LAST step (the Investments entry) itself fails: cells must be restored.
  const w = freshWorld([txn({ amount: 3000, counterparty: "Clearco Mutual Funds", reference: "5551012" })]);
  w.sheets.Investments.appendRow = function(){ throw new Error("simulated Investments failure"); };
  let threw = false;
  try { w.sb.processNewTransactions(); } catch(e) { threw = true; }
  const r = w.sheets.Transactions.rows[1];
  assert(!threw, "does not throw when the final step fails");
  assert(r[17] === "" && r[18] === "" && r[12] === "" && r[13] === "" && !r[19], "R, S, M, N, T all restored");
  assert(w.pushes.length === 1 && r[15] === "YES", "falls through to the normal alert");
  assert(logTypes(w).indexOf("AUTO_SETTLE_ERROR") !== -1, "error logged");
}

console.log("\n--- 8. Column T already used by something else: auto-settle switches itself off ---");
{
  const w = freshWorld([txn({ amount: 5000, counterparty: "TESTBANK Credit Card Payment" })], { t1: "SomethingElse" });
  w.sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[0][19] === "SomethingElse", "foreign header untouched");
  assert(!w.sheets.Transactions.rows[1][19] && w.pushes.length === 1, "row went the normal way");
  assert(logTypes(w).indexOf("AUTO_SETTLE_ERROR") !== -1, "problem logged");
}

console.log("\n--- 9. Resuming a settle that was cut off before Processed was written ---");
{
  const w = freshWorld([txn({ amount: 15000, counterparty: "Sunrise Landlord Property", reference: "5551013", note: "Rent", category: "Financial" })]);
  w.sheets.Transactions.rows[1][17] = "Rent"; w.sheets.Transactions.rows[1][19] = "fe:Rent";
  const feBefore = snapshot(w.sheets.FinancialEvents);
  w.sb.processNewTransactions();
  assert(w.sheets.Transactions.rows[1][15] === "YES" && w.pushes.length === 0, "just finished: Processed=YES, no push");
  assert(snapshot(w.sheets.FinancialEvents) === feBefore, "FinancialEvents not touched");
}

console.log("\n--- 10. One-time sweep: preview == apply, preview changes nothing ---");
{
  const w = freshWorld([
    txn({ amount: 4321.10, counterparty: "acme bank cc billpay on", reference: "5552001", processed: "YES" }),   // ccbill (wording)
    txn({ amount: 249, counterparty: "CRED Club credit card", reference: "5552002", processed: "YES" }),         // ccbill
    txn({ amount: 4000, counterparty: "rao family member", reference: "5552003", processed: "YES" }),            // 4000 is no remembered amount
    txn({ amount: 149, counterparty: "video subscription", reference: "5552004", processed: "YES" }),
    txn({ amount: 500, type: "credit", counterparty: "unknown sender", reference: "5552005", processed: "YES" }),
    txn({ amount: 15000, counterparty: "Sunrise Landlord Property", reference: "5552006", processed: "YES", note: "Rent" }), // already noted: not Pending
    txn({ amount: 3000, counterparty: "Clearco mutual funds", reference: "5552007", processed: "YES" }),         // SIP
    txn({ amount: 6000, counterparty: "UNKNOWN APP", reference: "5552008", processed: "YES" })                   // amount-only bill match (below)
  ]);
  w.sheets.Transactions.rows.push(swipeInOutstandingWindow(w, 6000));
  w.sheets.Transactions.rows[0].push("AutoSettled"); // as if the header already exists
  const before = snapshot(w.sheets.Transactions);
  const beforeFE = snapshot(w.sheets.FinancialEvents), beforeInv = snapshot(w.sheets.Investments);
  const preview = w.sb.previewAutoSettle();
  assert(snapshot(w.sheets.Transactions) === before && snapshot(w.sheets.FinancialEvents) === beforeFE && snapshot(w.sheets.Investments) === beforeInv,
    "preview changed nothing anywhere");
  const previewRows = (preview.match(/Row (\d+):/g) || []).map(function(s){ return Number(s.replace(/\D/g, "")); });
  assert(JSON.stringify(previewRows) === JSON.stringify([2, 3, 8]), "preview lists exactly rows 2, 3, 8 (got " + JSON.stringify(previewRows) + ")");
  assert(/3 row\(s\) would be settled/.test(preview), "preview prints the count");
  w.sb.autoSettlePendingNow();
  const settledRows = [];
  w.sheets.Transactions.rows.forEach(function(r, i){ if(i > 0 && r[19]) settledRows.push(i + 1); });
  assert(JSON.stringify(settledRows) === JSON.stringify(previewRows), "apply settled exactly the previewed rows (got " + JSON.stringify(settledRows) + ")");
  assert(w.learned.length === 0, "sweep never touches the learning systems");
  assert(snapshot(w.sheets.FinancialEvents) === beforeFE, "sweep never writes the FinancialEvents memory");
  assert(w.pushes.length === 0, "sweep sends no notifications");
  const pend = w.sb.getPendingTransactions();
  assert(pend.length === 4, "the other 4 un-noted rows (incl. the amount-only bill match) stay in Pending (got " + pend.length + ")");
  const again = w.sb.autoSettlePendingNow();
  assert(/0 row\(s\) settled/.test(again), "running the sweep again settles nothing more");
}

console.log("\n--- 11. The 20th column does not break other code ---");
{
  const w = freshWorld([
    txn({ amount: 15000, counterparty: "Sunrise Landlord Property", reference: "5553001" }),
    txn({ amount: 77, counterparty: "NEEDS REVIEW: junk promo", reference: "" })
  ]);
  w.sb.processNewTransactions(); // settles row 2, leaves row 3 pending; sheet is now 20 wide
  w.sheets.Transactions.rows[2][10] = "raw sms text that is long enough to learn a pattern from"; // RawSMS
  const mark = w.sb.markNotATransaction(3);
  assert(mark.ok, "markNotATransaction works on the wider sheet (" + JSON.stringify(mark) + ")");
  assert(w.sheets.Transactions.rows[2][15] === "IGNORED" && w.sheets.Transactions.rows[2].length >= 19, "row tombstoned in place");
  const older = new Date(today().getTime() - 3 * 86400000);
  const res = w.sb.insertReconciledTransactions([{ date: older, type: "debit", mode: "upi", amount: 12, ref: "NOREF_1", name: "", note: "tea", category: "", needWantSaving: "" }]);
  assert(res.ok && res.added === 1, "Recon insert still works");
  const rentRow = w.sheets.Transactions.rows.filter(function(r){ return r[17] === "Rent"; })[0];
  assert(rentRow && rentRow[19] === "fe:Rent", "after Recon's whole-sheet sort, the AutoSettled mark is still on the Rent row");
  const hist = w.sb.getTransactionHistory(0, 20);
  assert(hist.transactions.some(function(t){ return t.note === "Rent"; }), "History shows the settled row with its note");
  assert(w.sb.getTodaySummary().bankSpend === 0, "the settled Rent row is not counted as spend");
}

console.log("\n--- 12. Credit card bill excluded from spend after settling ---");
{
  const w = freshWorld([txn({ amount: 5000, counterparty: "TESTBANK Credit Card Payment", reference: "5554001" })]);
  w.sb.processNewTransactions();
  assert(w.sb.getTodaySummary().bankSpend === 0, "settled bill payment adds nothing to today's spend");
}

console.log("\n--- 13. Credits are out of scope ---");
{
  const w = freshWorld([
    txn({ amount: 3000, type: "credit", counterparty: "Clearco mutual funds", reference: "5555001" }),
    txn({ amount: 20000, type: "credit", counterparty: "Employer Pvt Ltd salary", reference: "5555002" })
  ]);
  w.sb.processNewTransactions();
  assert(w.pushes.length === 2 && !w.sheets.Transactions.rows[1][19] && !w.sheets.Transactions.rows[2][19], "credits are never auto-settled");
}

console.log("\nDone.");
