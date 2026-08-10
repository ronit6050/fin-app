// financialEvents.js
// Detects recurring, non-spending "Financial Events" — Rent and
// Investment for now — so they can be excluded from your spend total
// and shown as their own dashboard lines instead of blended into
// regular category spending. See docs/features/financial-events.md.
//
// Two layers, same self-learning shape as everything else in this app:
// 1. A remembered AMOUNT match — once you've confirmed a Rent or
//    Investment payment once, a future payment close to the same
//    amount gets suggested with high confidence (one-tap confirm).
//    Rent/EMI/SIP payments are, by nature, close to the same amount
//    every time they recur.
// 2. A soft keyword hint (reuses getFinancialSubtype from
//    needWantSaving.js) — used only when there's no amount match yet
//    (e.g. the very first time). Low confidence — needs a full manual
//    confirm, not just a tap.
//
// Deliberately does NOT try to guess with full confidence from raw SMS
// wording alone — real bank/UPI text varies too much platform to
// platform to trust blindly (confirmed with the user 2026-08-10, after
// finding real Counterparty data was inconsistent even for the exact
// same kind of transaction sent twice).

function getFinancialEventsSheet(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("FinancialEvents");
  if(!sheet){
    sheet = ss.insertSheet("FinancialEvents");
    sheet.appendRow(["Type", "Amount", "Counterparty", "Confirmed"]);
  }
  return sheet;
}

// A payment "recurs" if it's within 5% (or at least Rs.50, for small
// amounts) of a previously confirmed one. EMIs/mandates are nearly
// always the exact same amount every time; the slack covers small
// variations (e.g. a rent adjustment).
function amountsMatch(a, b){
  a = Number(a) || 0;
  b = Number(b) || 0;
  var tolerance = Math.max(50, a * 0.05);
  return Math.abs(a - b) <= tolerance;
}

function matchRecurringFinancialEvent(type, amount, financialEventsData){
  for(var i = 1; i < financialEventsData.length; i++){
    if(financialEventsData[i][0] === type && amountsMatch(financialEventsData[i][1], amount)){
      return true;
    }
  }
  return false;
}

// Returns {type, confident} or null. Only ever suggests "Rent" or
// "Investment" for now — EMI (which needs its own name per loan) and
// Lending (deliberately note-only, see isLendingTransfer in
// needWantSaving.js) are separate, later pieces, not this one.
//
// note is optional (fixed 2026-08-10) — Pending never has one yet, but
// History always does, and a real bank Counterparty text rarely spells
// out "rent" the way a user's own note ("July rent") does. Found live:
// a mutual fund transaction correctly triggered because "mutual funds"
// happened to be in its Counterparty text, while an otherwise identical
// rent transaction didn't, purely because "rent" only ever appeared in
// the note, which this function previously never looked at.
function suggestFinancialEvent(counterparty, amount, financialEventsData, note){
  if(matchRecurringFinancialEvent("Rent", amount, financialEventsData)){
    return { type: "Rent", confident: true };
  }
  if(matchRecurringFinancialEvent("Investment", amount, financialEventsData)){
    return { type: "Investment", confident: true };
  }

  var subtype = getFinancialSubtype(counterparty, note); // from needWantSaving.js
  if(subtype === "rent") return { type: "Rent", confident: false };
  if(subtype === "investment") return { type: "Investment", confident: false };

  return null;
}

// Called once a Financial Event is confirmed (first time, or a one-tap
// re-confirm) — remembers the amount so a future payment of a similar
// size gets recognized automatically next time.
function recordFinancialEvent(type, amount, counterparty){
  var sheet = getFinancialEventsSheet();
  sheet.appendRow([type, Number(amount) || 0, counterparty || "", new Date()]);
}
