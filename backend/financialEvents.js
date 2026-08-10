// financialEvents.js
// Detects recurring, non-spending "Financial Events" — Rent, EMI, and
// Investment — so they can be excluded from your spend total and shown
// as their own dashboard lines instead of blended into regular category
// spending. See docs/features/financial-events.md.
//
// Two layers, same self-learning shape as everything else in this app:
// 1. A remembered AMOUNT match — once you've confirmed a Rent/EMI/
//    Investment payment once, a future payment close to the same
//    amount gets suggested with high confidence (one-tap confirm).
//    Works well for anything that recurs at a genuinely fixed amount
//    (rent, a real bank-auto-debited EMI, a SIP mandate).
// 2. A NOTE-TEXT match, specifically for EMI (added 2026-08-10) — some
//    EMIs are NOT a fixed amount every time (e.g. an informal
//    arrangement paying a family member, where the amount sent varies
//    month to month depending on other adjustments). For those, the
//    user's own wording ("Laptop emi...") is the reliable repeat
//    signal, not the amount. Real example that led to this: a mutual
//    fund transaction correctly matched by amount, but a laptop EMI
//    paid to the user's dad — ₹1,427 one month after deducting some
//    home expenses, "really" ₹4,000 most months — would never match by
//    amount at all.
// 3. A soft keyword hint (reuses getFinancialSubtype from
//    needWantSaving.js, plus a plain "emi" check here) — used only when
//    neither of the above matched yet (e.g. the very first time for
//    this specific EMI). Low confidence — needs a full manual confirm/
//    naming, not just a tap.
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
    sheet.appendRow(["Type", "Amount", "Counterparty", "Confirmed", "Name"]);
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

// Strips the word "emi" out of a name like "Laptop EMI" to get the
// distinguishing word(s) — "laptop" — used to recognize the SAME named
// EMI again by note wording, when the amount itself can't be trusted.
function emiKeywordFromName(name){
  return (name || "").toString().toLowerCase().replace(/\bemi\b/g, "").trim();
}

// Tries every previously-confirmed EMI, amount first (works for a
// normal fixed-amount EMI), then note-text (works for an EMI whose
// amount varies, as long as the name's distinguishing word shows up in
// the note again — e.g. "laptop" in "Laptop emi after deduction..."
// matching a previously-named "Laptop EMI"). Returns {name} or null —
// never invents a name, only recognizes one already confirmed once.
function matchRecurringEmi(amount, note, financialEventsData){
  var noteText = (note || "").toString().toLowerCase();
  var seenNames = {};

  // Amount match first — checked across ALL confirmed EMIs, not just
  // one, since more than one EMI can exist (see docs).
  for(var i = 1; i < financialEventsData.length; i++){
    if(financialEventsData[i][0] !== "EMI") continue;
    var name = (financialEventsData[i][4] || "").toString();
    if(!name || seenNames[name]) continue;
    if(amountsMatch(financialEventsData[i][1], amount)){
      return { name: name };
    }
  }

  // Note-text match — only useful once a name has been confirmed once
  // before, so there's a keyword to look for.
  if(noteText){
    for(var j = 1; j < financialEventsData.length; j++){
      if(financialEventsData[j][0] !== "EMI") continue;
      var n = (financialEventsData[j][4] || "").toString();
      if(!n || seenNames[n]) continue;
      seenNames[n] = true;
      var keyword = emiKeywordFromName(n);
      if(keyword && noteText.indexOf(keyword) !== -1){
        return { name: n };
      }
    }
  }

  return null;
}

// Returns {type, name, confident} or null.
// - type: "Rent" | "Investment" | "EMI"
// - name: only meaningful for EMI (e.g. "Laptop EMI"); null means "this
//   looks like some EMI, but which one isn't known yet — ask the user
//   to name it" (see index.html's EMI-naming UI).
// - confident: true = matched a remembered amount or note keyword, safe
//   for a one-tap confirm. false = just a soft hint, needs a real
//   decision (and, for a brand-new EMI, a name).
//
// note is optional — Pending never has one yet, but History always
// does, and a real bank Counterparty text rarely spells out "rent" or
// "laptop emi" the way a user's own note does (fixed 2026-08-10).
function suggestFinancialEvent(counterparty, amount, financialEventsData, note){
  if(matchRecurringFinancialEvent("Rent", amount, financialEventsData)){
    return { type: "Rent", confident: true };
  }
  if(matchRecurringFinancialEvent("Investment", amount, financialEventsData)){
    return { type: "Investment", confident: true };
  }
  var emiMatch = matchRecurringEmi(amount, note, financialEventsData);
  if(emiMatch){
    return { type: "EMI", name: emiMatch.name, confident: true };
  }

  var subtype = getFinancialSubtype(counterparty, note); // from needWantSaving.js
  if(subtype === "rent") return { type: "Rent", confident: false };
  if(subtype === "investment") return { type: "Investment", confident: false };
  if(subtype === "homeLoanEmi") return { type: "EMI", name: "Home Loan EMI", confident: false };

  // A generic "emi" mention with no specific match yet — still worth
  // flagging (so it doesn't just silently count as ordinary spend), but
  // there's no name to suggest, so the UI has to ask for one. Whole-word
  // match, same reasoning as the lending word-boundary fix elsewhere in
  // this project — a bare substring would also match "premium", etc.
  var text = ((counterparty || "") + " " + (note || "")).toLowerCase();
  if(/\bemi\b/.test(text)){
    return { type: "EMI", name: null, confident: false };
  }

  return null;
}

// Called once a Financial Event is confirmed (first time, or a one-tap
// re-confirm) — remembers the amount (and, for EMI, the name) so a
// future payment gets recognized automatically next time.
function recordFinancialEvent(type, amount, counterparty, name){
  var sheet = getFinancialEventsSheet();
  sheet.appendRow([type, Number(amount) || 0, counterparty || "", new Date(), name || ""]);
}
