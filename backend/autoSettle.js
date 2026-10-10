// autoSettle.js (added 2026-10-10)
//
// PLAIN-ENGLISH WHAT THIS IS: the user's goal is "the app should only ask
// me about things only I know." Some new bank transactions are not a
// question at all - the app already knows exactly what they are:
//   a. a credit card BILL PAYMENT whose own wording says so (never an
//      amount that merely equals the bill - that could be a coincidence),
//   b. a WALLET TOP-UP (money moving from the bank into your own wallet),
//   c. a recurring Rent / named EMI / named SIP that matches something
//      you already confirmed before - almost exactly the same amount
//      (within Rs.1), a real payee that matches strictly, a bank-transfer
//      mode (not card / wallet / unknown), and only ONE remembered event
//      fits (a tie goes to you).
// For these, the app settles the row itself the moment it arrives - no
// notification, nothing in Pending. Everything else is left completely
// alone and goes to Pending with the usual notification. A SILENT action
// needs a far higher bar than a one-tap suggestion: when in doubt, the row
// stays in Pending.
//
// HARD RULES (see docs/features/auto-settle-and-health.md):
//  - A row the app settled by itself NEVER teaches the learning systems
//    (SmartMemory category memory, Need/Want/Saving votes, NoteMemory) and
//    never writes the FinancialEvents memory either.
//    Those learn only from your own human confirmations - guessed
//    answers polluted them once before.
//  - Only DEBITs. Credits, lending, debts, salary: never touched here.
//  - A row that looks like an UNCERTAIN parse ("NEEDS REVIEW: ...") is
//    never auto-settled - a human should look at those.
//  - Every settled row is marked in Transactions column T ("AutoSettled")
//    with a short reason code, so it is always traceable.
//  - FAIL SAFE: if anything goes wrong for a row, whatever was half-
//    written to that row is put back, the error is logged
//    (AUTO_SETTLE_ERROR), and the row carries on down the normal path
//    (notification + Pending).

var AUTO_SETTLED_COL    = 20;            // column T (1-based)
var AUTO_SETTLED_HEADER = "AutoSettled";

// Adds the "AutoSettled" header to column T if it is blank. Safe to run
// any number of times. Returns true when column T is (now) ours to use;
// false when T1 already holds a different label, in which case nothing
// is written and auto-settle stays switched off rather than overwrite it.
function ensureAutoSettledHeader_(sheet){
  var cell = sheet.getRange(1, AUTO_SETTLED_COL);
  var current = (cell.getValue() || "").toString().trim();
  if(current === "") { cell.setValue(AUTO_SETTLED_HEADER); return true; }
  return current === AUTO_SETTLED_HEADER;
}

// ---------------------------------------------------------------------
// THE decision - one function, used by the live path AND the one-time
// sweep, so the two can never disagree.
//
// info: { type, mode, amount, reference, counterparty, note, marked }
//   (marked = whatever is already in column T for that row)
// ctx:  { txnData, financialEventsData }  (both full sheet reads)
//
// Returns null (leave it for the human) or
//   { reason, label, note, category, financialEvent, financialEventName }
// ---------------------------------------------------------------------
function decideAutoSettle_(info, ctx){
  if((info.type || "").toString().trim().toLowerCase() !== "debit") return null;
  if((info.note || "").toString().trim() !== "") return null;      // already has a note = already handled
  if((info.marked || "").toString().trim() !== "") return null;    // already auto-settled once
  var amount = Number(info.amount) || 0;
  if(!(amount > 0)) return null;

  var counterparty = (info.counterparty || "").toString();
  // The SMS reader saves wording it could not understand as "NEEDS
  // REVIEW: ..." - those are exactly the ones a human must look at.
  if(/^\s*needs review/i.test(counterparty)) return null;

  var modeText = (info.mode || "").toString().trim().toLowerCase();

  // a. Credit card bill payment - by the payment's own WORDING only
  // ("credit card", "cc bill", "cc billpay"...). An amount that merely equals
  // the outstanding bill is NOT enough for a silent action (a Rs.149
  // subscription vs a Rs.149 card total): such a row still gets excluded
  // from spend by isCreditCardBillPayment, but it stays in Pending for you.
  if(modeText !== "wallet" && isCreditCardBillWording_(info.mode, counterparty, "")){
    return {
      reason: "ccbill", label: "a credit card bill payment",
      note: "Credit card bill payment", category: "Financial",
      financialEvent: "", financialEventName: ""
    };
  }

  // b. Wallet top-up. A top-up is money moving from the BANK into the
  // wallet (a bank-transfer Mode: upi/neft/...). A row whose Mode is
  // "wallet" is the wallet spending its own balance - a real purchase that
  // can carry a reference number (real data: "Paid through wallet").
  if(autoSettleModeAllowed_(modeText) && isWalletTopUp(counterparty, info.reference)){
    return {
      reason: "wallet-topup", label: "a wallet top-up",
      note: "Wallet top-up", category: "Financial",
      financialEvent: "", financialEventName: ""
    };
  }

  // c. Recurring Rent / named EMI / named SIP - the STRICT silent matcher
  // (see findSilentFinancialEventMatch_). Far tighter than the one-tap chip.
  if(autoSettleModeAllowed_(modeText)){
    var m = findSilentFinancialEventMatch_(counterparty, amount, ctx.financialEventsData);
    if(m){
      // Belt and braces: the human-facing suggestion must agree with the
      // strict matcher, otherwise stay out of it.
      var chip = suggestFinancialEvent(counterparty, amount, ctx.financialEventsData, "");
      if(chip && chip.confident && chip.type === m.type && (m.type === "Rent" || chip.name === m.name)){
        if(m.type === "Rent"){
          return {
            reason: "fe:Rent", label: "your recurring Rent",
            note: "Rent", category: "Financial",
            financialEvent: "Rent", financialEventName: ""
          };
        }
        return {
          reason: "fe:" + m.name, label: "your recurring " + m.type + " \"" + m.name + "\"",
          note: m.name, category: "Financial",
          financialEvent: m.type, financialEventName: m.name
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------
// STRICT matching for the silent path (added 2026-10-10 after review).
// Guiding rule: a SILENT action needs a far higher bar than a one-tap
// suggestion you get to look at. When in doubt the row stays in Pending.
// The human-facing chip (suggestFinancialEvent) is deliberately unchanged.
// ---------------------------------------------------------------------

// Only bank-transfer-type modes can really be Rent / EMI / SIP / a wallet
// top-up. Card swipes, wallet debits and anything unknown ("other", blank)
// never settle silently.
var AUTO_SETTLE_ALLOWED_MODE_RE_ = /^(upi|neft|imps|rtgs|nach|ach|ecs|enach|e-nach|emandate|e-mandate|autopay|mandate)\b/;
function autoSettleModeAllowed_(modeText){
  return AUTO_SETTLE_ALLOWED_MODE_RE_.test((modeText || "").toString().trim().toLowerCase());
}

// "Same amount" for a silent action = within Rs.1 (rounding), not the 5% /
// Rs.50 the chip uses.
var AUTO_SETTLE_AMOUNT_TOLERANCE_ = 1;

function autoSettleSquash_(text){
  return (text || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Strict payee match. Both sides must have a real payee, and then ONE of:
//  - the names are the same once spaces/punctuation are removed (>= 5
//    letters), or one contains the other with the shorter at least 8 letters
//    (NSECLEARINGLIMITED vs "NSE Clearing Limited");
//  - at least TWO meaningful words are shared;
//  - the remembered payee has exactly ONE meaningful word and it is shared.
// A single shared common word ("kumar") between two longer names is NOT
// enough.
function strictPayeeMatch_(incoming, remembered){
  var inWords = payeeWords_(incoming);
  var remWords = payeeWords_(remembered);
  if(inWords.length === 0 || remWords.length === 0) return false;

  var x = autoSettleSquash_(incoming), y = autoSettleSquash_(remembered);
  if(x.length >= 5 && x === y) return true;
  var shorter = x.length <= y.length ? x : y;
  var longer  = x.length <= y.length ? y : x;
  if(shorter.length >= 8 && longer.indexOf(shorter) !== -1) return true;

  var uniqueRem = remWords.filter(function(w, i){ return remWords.indexOf(w) === i; });
  var shared = uniqueRem.filter(function(w){ return inWords.indexOf(w) !== -1; });
  if(shared.length >= 2) return true;
  if(uniqueRem.length === 1 && shared.length === 1) return true;
  return false;
}

// Finds THE one remembered Rent / named EMI / named SIP this payment is.
// Every remembered row considered must have a real payee, a near-exact
// amount (within Rs.1), and a strict payee match. If zero events fit, or
// MORE THAN ONE distinct event fits (e.g. two SIPs of the same amount to
// the same payee), returns null - ambiguous means "ask the human".
function findSilentFinancialEventMatch_(counterparty, amount, financialEventsData){
  var keys = {};
  var found = [];
  for(var i = 1; i < financialEventsData.length; i++){
    var type = (financialEventsData[i][0] || "").toString().trim();
    if(type !== "Rent" && type !== "EMI" && type !== "Investment") continue;
    var name = (financialEventsData[i][4] || "").toString().trim();
    if(type === "Rent") name = "";
    else if(!name) continue; // an unnamed EMI/Investment can't be settled by name
    if(Math.abs((Number(financialEventsData[i][1]) || 0) - amount) > AUTO_SETTLE_AMOUNT_TOLERANCE_) continue;
    if(!strictPayeeMatch_(counterparty, financialEventsData[i][2])) continue;
    var key = type + "||" + name;
    if(!keys[key]){ keys[key] = true; found.push({ type: type, name: name }); }
  }
  return found.length === 1 ? found[0] : null;
}

// Pulls the fields decideAutoSettle_ needs out of one row of values
// (the same column positions the rest of the backend uses).
function autoSettleInfoFromRow_(rowValues){
  return {
    type:         rowValues[3],
    mode:         rowValues[4],
    amount:       rowValues[5],
    reference:    rowValues[6],
    counterparty: rowValues[7],
    note:         rowValues[12],
    marked:       rowValues[AUTO_SETTLED_COL - 1]
  };
}

// Reads the two big lookups once. Returns null if column T can't be used.
function loadAutoSettleContext_(sheet){
  if(!ensureAutoSettledHeader_(sheet)){
    logAI("AUTO_SETTLE_ERROR", "Transactions column T already has a different header - auto-settle is switched off until that is sorted out.");
    return null;
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feSheet = ss.getSheetByName("FinancialEvents");
  return {
    txnData: sheet.getDataRange().getValues(),
    financialEventsData: feSheet ? feSheet.getDataRange().getValues() : []
  };
}

// Writes the settlement into the sheet. Same Note/Category/Financial Event
// cells a human "Yes" writes, plus our column T marker. NEVER calls
// handleCategoryCorrection / recordTypeVote / recordNoteUsage, and (unlike a
// human confirmation) NEVER writes the FinancialEvents memory sheet - the
// app learns only from your own confirmations, so a wrongly-settled payee
// can never get remembered.
//
// ORDER MATTERS: every cell write comes first and the one side effect that
// lives outside the row (the Investments-tab entry for a SIP) comes LAST, so
// a failure earlier leaves nothing behind anywhere. If that last step
// itself throws, the cells are put back to what they were and the error is
// re-thrown for the caller to log (the row then continues to Pending).
function applyAutoSettle_(sheet, rowIndex, decision, counterparty){
  var cols = [13, 14, 18, 19, AUTO_SETTLED_COL]; // M, N, R, S, T
  var before = cols.map(function(c){ return sheet.getRange(rowIndex, c).getValue(); });
  try{
    if(decision.financialEvent){
      writeFinancialEventCells_(sheet, rowIndex, decision.financialEvent, decision.financialEventName);
    }
    sheet.getRange(rowIndex, 13).setValue(decision.note);
    sheet.getRange(rowIndex, 14).setValue(decision.category);
    sheet.getRange(rowIndex, AUTO_SETTLED_COL).setValue(decision.reason);
    if(decision.financialEvent === "Investment"){
      runFinancialEventSideEffects_(sheet, rowIndex, decision.financialEvent, decision.financialEventName, counterparty, decision.note, false);
    }
  }catch(err){
    cols.forEach(function(c, k){
      try{ sheet.getRange(rowIndex, c).setValue(before[k]); }catch(e2){ /* best effort */ }
    });
    throw err;
  }
}

// ---------------------------------------------------------------------
// LIVE PATH helper - called by processNewTransactions for one new row.
// Returns true if the row was settled (caller then skips the alert),
// false otherwise. Never throws.
// ctxHolder is { ctx, tried } shared across the rows of one run, so the
// big sheet reads happen at most once.
// ---------------------------------------------------------------------
function tryAutoSettleNewRow_(sheet, rowIndex, rowValues, ctxHolder){
  try{
    if((rowValues[3] || "").toString().trim().toLowerCase() !== "debit") return false; // cheap pre-check: no big reads for credits

    if(!ctxHolder.tried){
      ctxHolder.tried = true;
      ctxHolder.ctx = loadAutoSettleContext_(sheet);
    }
    if(!ctxHolder.ctx) return false;

    var info = autoSettleInfoFromRow_(rowValues);
    // The live read only has columns A-Q, so look at T for this one row.
    info.marked = sheet.getRange(rowIndex, AUTO_SETTLED_COL).getValue();
    // Re-read the note fresh too (cheap, one cell) so a half-finished
    // earlier attempt can't be mistaken for a clean row.
    info.note = sheet.getRange(rowIndex, 13).getValue();

    if((info.marked || "").toString().trim() !== "" && (info.note || "").toString().trim() !== ""){
      return true; // settled on an earlier run that was cut off before marking Processed - just finish the job
    }

    var decision = decideAutoSettle_(info, ctxHolder.ctx);
    if(!decision) return false;

    applyAutoSettle_(sheet, rowIndex, decision, (info.counterparty || "").toString());
    return true;
  }catch(err){
    logAI("AUTO_SETTLE_ERROR", "Row " + rowIndex + ": " + err.toString());
    return false;
  }
}

// ---------------------------------------------------------------------
// ONE-TIME SWEEP for rows already sitting in Pending.
// Run by hand from the Apps Script editor (pick the function, press Run,
// then View > Logs). Same pattern as previewMissingCategories /
// backfillMissingCategories in Logger.js.
//   previewAutoSettle()    - read-only, changes nothing
//   autoSettlePendingNow() - applies exactly what the preview listed
// ---------------------------------------------------------------------

// A row is "in Pending" by the same rule getPendingTransactions uses:
// Processed == YES and the Note is empty (plus: not already auto-settled).
function findAutoSettleSweepMatches_(data, ctx){
  var matches = [];
  for(var i = 1; i < data.length; i++){
    var processed = (data[i][15] || "").toString().trim();
    var note      = (data[i][12] || "").toString().trim();
    if(processed !== "YES" || note) continue;
    var info = autoSettleInfoFromRow_(data[i]);
    var decision = decideAutoSettle_(info, ctx);
    if(decision) matches.push({ row: i + 1, info: info, decision: decision });
  }
  return matches;
}

function describeAutoSettleMatch_(m){
  var cp = (m.info.counterparty || "").toString().replace(/\s+/g, " ").trim() || "no payee name";
  return "Row " + m.row + ": Rs." + (Number(m.info.amount) || 0) + " to " + cp +
    " -> " + m.decision.label + " (would be noted as \"" + m.decision.note + "\")";
}

function previewAutoSettle(){
  var out = [];
  var log = function(s){ out.push(s); Logger.log(s); };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  if(!sheet) return "Transactions tab not found.";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feSheet = ss.getSheetByName("FinancialEvents");
  var ctx = {
    txnData: sheet.getDataRange().getValues(),
    financialEventsData: feSheet ? feSheet.getDataRange().getValues() : []
  };

  log("===== PENDING ROWS THAT WOULD BE SETTLED AUTOMATICALLY (nothing changed) =====");
  log("");
  var matches = findAutoSettleSweepMatches_(ctx.txnData, ctx);
  matches.forEach(function(m){ log("- " + describeAutoSettleMatch_(m)); });
  log("");
  log(matches.length === 0
    ? "Nothing in Pending is a known type - all of it needs you."
    : matches.length + " row(s) would be settled. Everything else in Pending stays exactly as it is. If the list looks right, run autoSettlePendingNow().");
  return out.join("\n");
}

function autoSettlePendingNow(){
  var out = [];
  var log = function(s){ out.push(s); Logger.log(s); };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  if(!sheet) return "Transactions tab not found.";

  var ctx = loadAutoSettleContext_(sheet); // also adds the column T header
  if(!ctx){
    log("Column T on Transactions already has a different heading - nothing was changed.");
    return out.join("\n");
  }

  var matches = findAutoSettleSweepMatches_(ctx.txnData, ctx);
  var done = 0, failed = 0;
  matches.forEach(function(m){
    try{
      applyAutoSettle_(sheet, m.row, m.decision, (m.info.counterparty || "").toString());
      done++;
      log("- Settled: " + describeAutoSettleMatch_(m));
    }catch(err){
      failed++;
      logAI("AUTO_SETTLE_ERROR", "Sweep row " + m.row + ": " + err.toString());
      log("- COULD NOT settle row " + m.row + " (left in Pending): " + err.toString());
    }
  });
  log("");
  log(done + " row(s) settled" + (failed ? ", " + failed + " could not be (still in Pending)." : "."));
  return out.join("\n");
}
