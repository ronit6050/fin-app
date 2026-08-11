// financialEvents.js
// Detects recurring, non-spending "Financial Events" — Rent, EMI, and
// Investment — so they can be excluded from your spend total and shown
// as their own dashboard lines instead of blended into regular category
// spending. See docs/features/financial-events.md.
//
// Three layers, same self-learning shape as everything else in this app:
// 1. A remembered AMOUNT match — once you've confirmed a Rent/EMI/
//    Investment payment once, a future payment close to the same
//    amount gets suggested with high confidence (one-tap confirm).
//    Works well for anything that recurs at a genuinely fixed amount
//    (rent, a real bank-auto-debited EMI, a SIP mandate).
// 2. A NOTE-TEXT match, for EMI and Investment (Investment added
//    2026-08-10, generalized from EMI's mechanism) — both can have more
//    than one distinct instance (two EMIs, two different SIPs), and
//    some EMIs specifically are NOT a fixed amount every time (e.g. an
//    informal arrangement paying a family member, where the amount sent
//    varies month to month). For those, the user's own wording
//    ("Laptop emi...") is the reliable repeat signal, not the amount.
//    Real example that led to this: a laptop EMI paid to the user's dad
//    — ₹1,427 one month after deducting home expenses, "really" ₹4,000
//    most months — would never match by amount alone.
// 3. A soft keyword hint (reuses getFinancialSubtype from
//    needWantSaving.js, plus a plain "emi" check here) — used only when
//    neither of the above matched yet (e.g. the very first time for
//    this specific EMI/investment). Low confidence — needs a full
//    manual confirm/naming, not just a tap.
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

// Only for Rent — there's only ever one, so no name is needed to tell
// two apart, unlike EMI/Investment.
function matchRecurringFinancialEvent(type, amount, financialEventsData){
  for(var i = 1; i < financialEventsData.length; i++){
    if(financialEventsData[i][0] === type && amountsMatch(financialEventsData[i][1], amount)){
      return true;
    }
  }
  return false;
}

// Strips the word "emi" (or nothing, for Investment) out of a name like
// "Laptop EMI" to get the distinguishing word(s) — "laptop" — used to
// recognize the SAME named event again by note wording, when the amount
// itself can't be trusted. Works for both EMI and Investment names.
function eventKeywordFromName(name){
  return (name || "").toString().toLowerCase().replace(/\bemi\b/g, "").trim();
}

// Tries every previously-confirmed named event of this Type, amount
// first (works for anything at a genuinely fixed amount), then note-
// text (works when the amount varies, as long as the name's
// distinguishing word shows up in the note again — e.g. "laptop" in
// "Laptop emi after deduction..." matching a previously-named "Laptop
// EMI"). Returns {name} or null — never invents a name, only recognizes
// one already confirmed once. Generalized 2026-08-10 from an EMI-only
// version so Investment (which can also have more than one — separate
// SIPs, stocks, etc.) can reuse the exact same mechanism instead of a
// duplicate copy.
function matchRecurringNamedEvent(type, amount, note, financialEventsData){
  var noteText = (note || "").toString().toLowerCase();
  var seenNames = {};

  for(var i = 1; i < financialEventsData.length; i++){
    if(financialEventsData[i][0] !== type) continue;
    var name = (financialEventsData[i][4] || "").toString();
    if(!name || seenNames[name]) continue;
    if(amountsMatch(financialEventsData[i][1], amount)){
      return { name: name };
    }
  }

  if(noteText){
    for(var j = 1; j < financialEventsData.length; j++){
      if(financialEventsData[j][0] !== type) continue;
      var n = (financialEventsData[j][4] || "").toString();
      if(!n || seenNames[n]) continue;
      seenNames[n] = true;
      var keyword = eventKeywordFromName(n);
      if(keyword && noteText.indexOf(keyword) !== -1){
        return { name: n };
      }
    }
  }

  return null;
}

// A whole-word check for "saving"/"savings" in the note — same idea as
// isLendingTransfer (needWantSaving.js): trusts what the user actually
// typed rather than guessing from raw bank text, which has no reliable
// "this is a saving" wording the way "SIP"/"mutual fund" signals an
// investment. Added 2026-08-10, the user's own suggestion after
// confirming general savings can't be detected the way Rent/EMI/
// Investment can. Whole-word, not substring — same lesson as the
// "lent" bug (a substring version would also match unrelated words).
function isSavingsNote(note){
  return /\bsaving(s)?\b/i.test((note || "").toString());
}

// Returns {type, name, confident} or null.
// - type: "Rent" | "Investment" | "EMI"
// - name: only meaningful for EMI/Investment (e.g. "Laptop EMI",
//   "Mutual Fund"); null means "this looks like one of these, but which
//   isn't known yet — ask the user to name it" (see index.html's
//   naming UI, shared by EMI and Investment since 2026-08-10).
// - confident: true = matched a remembered amount or note keyword, safe
//   for a one-tap confirm. false = just a soft hint, needs a real
//   decision (and, for a brand-new EMI/Investment, a name).
//
// note is optional — Pending never has one yet, but History always
// does, and a real bank Counterparty text rarely spells out "rent" or
// "laptop emi" the way a user's own note does (fixed 2026-08-10).
//
// Saving is NOT returned from here — unlike Rent/EMI/Investment, it's
// detected purely from the note (isSavingsNote) with no amount-matching
// or confirm-chip step at all, same as Lending. See saveTransactionNote
// in PWA.js for where that actually gets applied.
function suggestFinancialEvent(counterparty, amount, financialEventsData, note){
  if(matchRecurringFinancialEvent("Rent", amount, financialEventsData)){
    return { type: "Rent", confident: true };
  }
  var investMatch = matchRecurringNamedEvent("Investment", amount, note, financialEventsData);
  if(investMatch){
    return { type: "Investment", name: investMatch.name, confident: true };
  }
  var emiMatch = matchRecurringNamedEvent("EMI", amount, note, financialEventsData);
  if(emiMatch){
    return { type: "EMI", name: emiMatch.name, confident: true };
  }

  var subtype = getFinancialSubtype(counterparty, note); // from needWantSaving.js
  if(subtype === "rent") return { type: "Rent", confident: false };
  if(subtype === "investment") return { type: "Investment", name: null, confident: false };
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
// re-confirm) — remembers the amount (and, for EMI/Investment, the
// name) so a future payment gets recognized automatically next time.
function recordFinancialEvent(type, amount, counterparty, name){
  var sheet = getFinancialEventsSheet();
  sheet.appendRow([type, Number(amount) || 0, counterparty || "", new Date(), name || ""]);
}

// ===============================
// AUTO-LOGGING — Investments tab + Savings tab (added 2026-08-10)
// ===============================
// Duplicate-avoidance: if a similar amount was already logged manually
// nearby in time, skip auto-logging — decided with the user 2026-08-10
// after confirming they may already have investments logged by hand
// from before this existed, and a duplicate would silently inflate
// those totals. Not perfect (a genuine coincidence could be skipped),
// but catches the common case without requiring the user to change any
// habits immediately.
var DUPLICATE_WINDOW_DAYS = 3;

function isNearbyDate(a, b, windowDays){
  var dayMs = 24 * 60 * 60 * 1000;
  return Math.abs(a.getTime() - b.getTime()) <= windowDays * dayMs;
}

// Investments sheet: [Date, Type, Amount, Note] — see PWA.js's
// logInvestmentFromApp for the manual-entry version this mirrors.
function hasLikelyDuplicateInvestment(dateStr, amount){
  var investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
  if(!investSheet) return false;
  var data = investSheet.getDataRange().getValues();
  var txnDate = new Date(dateStr);
  for(var i = 1; i < data.length; i++){
    var rowDate = data[i][0] ? new Date(data[i][0]) : null;
    var rowAmount = Number(data[i][2]) || 0;
    if(!rowDate || !rowAmount) continue;
    if(isNearbyDate(txnDate, rowDate, DUPLICATE_WINDOW_DAYS) && amountsMatch(rowAmount, amount)){
      return true;
    }
  }
  return false;
}

// Auto-logs a confirmed Investment Financial Event into the real
// Investments tab, unless a likely-duplicate manual entry already
// exists nearby (see hasLikelyDuplicateInvestment above).
//
// skipDuplicateCheck (added 2026-08-11, default false — every EXISTING
// caller is unaffected) — for the note-matched investment-instrument
// confirm flow only (PWA.js's saveTransactionNote, the
// investmentInstrument block). Decided with the user, after both
// change-reviewer and ui-ux-expert independently flagged this as worth
// reconsidering: unlike a Financial Event/SIP being auto-detected
// (where the duplicate check protects against double-counting a
// pre-existing MANUAL entry the user typed in before this feature
// existed), a note-matched confirm is already an explicit, one-tap
// HUMAN decision — the same trust level as the manual "+ Log an
// Investment" form, which has no duplicate check at all. Silently
// dropping a real, just-confirmed entry because it happens to be a
// similar amount to something logged a couple of days earlier (e.g.
// two separate top-ups of the same stock) does more harm than good.
// The Financial Event/SIP call site below is UNCHANGED — still always
// checks for a duplicate.
function autoLogInvestment(dateStr, name, amount, note, skipDuplicateCheck){
  if(!skipDuplicateCheck && hasLikelyDuplicateInvestment(dateStr, amount)) return { logged: false, reason: "duplicate" };
  var investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
  if(!investSheet) return { logged: false, reason: "no sheet" };
  investSheet.appendRow([dateStr, name || "Investment", Number(amount) || 0, note || ""]);
  return { logged: true };
}

// Savings sheet: one LOG SAVING action writes up to 3 rows (Emergency/
// WishList/Free split), so a "similar amount nearby" check has to sum
// same-day rows first, not compare row-by-row — a manual saving is
// almost never a single row.
function hasLikelyDuplicateSaving(dateStr, amount){
  var savSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Savings");
  if(!savSheet) return false;
  var data = savSheet.getDataRange().getValues();
  var txnDate = new Date(dateStr);
  var totalsByDay = {};
  for(var i = 1; i < data.length; i++){
    var rowDate = data[i][0] ? new Date(data[i][0]) : null;
    var rowAmount = Number(data[i][1]) || 0;
    if(!rowDate) continue;
    if(isNearbyDate(txnDate, rowDate, DUPLICATE_WINDOW_DAYS)){
      var key = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
      totalsByDay[key] = (totalsByDay[key] || 0) + rowAmount;
    }
  }
  for(var key in totalsByDay){
    if(amountsMatch(totalsByDay[key], amount)) return true;
  }
  return false;
}

// Auto-logs a note-detected saving into the real Savings tab.
//
// Fixed 2026-08-11 — this used to split the amount using the OLD 4-pot
// system (SavingsAdvisor.js's getSavingsTotals/getSplitRule) and wrote
// Destination values ("Emergency"/"WishList"/"FreeSavings") from that
// retired system. The new Savings v2 engine (savingsGoals.js, see
// docs/features/savings-v2.md) only recognizes "Emergency", "Free", or
// an exact Goals-sheet name — so "WishList"/"FreeSavings" rows were
// silently invisible in the app's real Savings totals (money still sat
// in the sheet, just uncounted). See CLAUDE.md's 2026-08-11 fix note.
//
// This can't know which specific named Goal the user meant (a note
// just says "saving", not "saving for New Phone") and deliberately does
// NOT run the full priority waterfall either (computeAutoSplitFromBreakdown_
// would silently route some of it into locked Emergency or a Goal the
// user never chose, which is too much to assume from an offhand note
// word) — so the whole amount goes to Free Savings, the new system's
// own "no specific goal picked yet" bucket. That's a product-intent
// judgment call (see docs/features/savings-v2.md for detail); a human
// can always move it from Free to a specific goal afterwards via a
// Withdraw + Manual Split, same as any other Free Savings money.
//
// Still skipped if a likely-duplicate manual entry already exists
// nearby (see hasLikelyDuplicateSaving above) — same reasoning as
// Investment, unaffected by this fix.
function autoLogSaving(dateStr, amount, note){
  if(hasLikelyDuplicateSaving(dateStr, amount)) return { logged: false, reason: "duplicate" };

  var savSheet = getSavingsSheet_(); // savingsGoals.js — the same "Savings" sheet the new system reads
  if(!savSheet) return { logged: false, reason: "no sheet" };

  var cleanAmount = Number(amount) || 0;
  if(cleanAmount <= 0) return { logged: false, reason: "invalid amount" };

  // [Date, Amount, Type, Note, Destination] — exact shape saveAutoSplit/
  // saveManualSplit (savingsGoals.js) already use, so this row reads
  // identically to a hand-entered one everywhere in the app.
  savSheet.appendRow([dateStr, cleanAmount, "auto", note || "saving", "Free"]);

  return { logged: true };
}

// ===============================
// AUTO-LOGGING — Debts tab (added 2026-08-10)
// ===============================
// Unlike Investment/Saving, a Debt entry is fundamentally ABOUT a
// specific person — getting that wrong is a real mistake (chasing the
// wrong person, or missing the right one), not a cosmetic one. So this
// deliberately: (a) always confirms a NEW person by name before doing
// anything (see index.html's live debt-field UI, wired to note typing
// since — same as Lending generally — there's no reliable signal before
// you've written something), and (b) only auto-settles a repayment when
// there's EXACTLY ONE matching open debt for that person, falling back
// to "do nothing, settle it yourself in Debts" otherwise rather than
// guessing which of several debts a repayment closes.

// Works out whether a lending-flavored transaction is a NEW debt or a
// REPAYMENT of an existing one, and which direction — the plain
// isLendingTransfer() (needWantSaving.js) only needs to know "is this
// lending-flavored at all" to exclude it from spend, but auto-linking
// to Debts needs to know a lot more. Returns one of:
//   "newLent"       debit + "lent"/"lend"       -> they now owe you
//   "newBorrowed"   credit + "borrowed"         -> you now owe them
//   "repayLent"     credit + "paid back"/etc    -> someone repaying what they owed you
//   "repayBorrowed" debit + "paid back"/etc     -> you repaying what you owed someone
// Any other combination (e.g. a credit with "lent" in the note) is
// genuinely ambiguous and returns null — no auto-action, same as before
// this feature existed.
function classifyDebtDirection(txnType, note){
  var text = (note || "").toString().toLowerCase();
  var isNewLendWord = /\blent\b/.test(text) || /\blend\b/.test(text);
  var isBorrowWord  = /\bborrowed\b/.test(text);
  var isRepayWord   = /\bpaid back\b/.test(text) || /\bgave back\b/.test(text) || /\breturned\b/.test(text);

  if(txnType === "debit"  && isNewLendWord) return "newLent";
  if(txnType === "credit" && isBorrowWord)  return "newBorrowed";
  if(txnType === "credit" && isRepayWord)   return "repayLent";
  if(txnType === "debit"  && isRepayWord)   return "repayBorrowed";
  return null;
}

// Every distinct person already in the Debts sheet — sent to the
// frontend so it can recognize "lent to Raj" again live, as you type,
// without a round trip, once Raj has been confirmed once before.
function getKnownDebtPeople(){
  var debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");
  if(!debtSheet) return [];
  var data = debtSheet.getDataRange().getValues();
  var seen = {};
  var people = [];
  for(var i = 1; i < data.length; i++){
    var person = (data[i][1] || "").toString().trim();
    if(!person || seen[person.toLowerCase()]) continue;
    seen[person.toLowerCase()] = true;
    people.push(person);
  }
  return people;
}

// For a repayment, finds the single Pending debt of the expected type
// for that person. Returns the sheet row number, or null if there isn't
// exactly one match (none, or more than one — either way, too
// ambiguous to guess which one this repayment closes).
function findSettleableDebtRow(person, expectedType, debtsData){
  var matches = [];
  for(var i = 1; i < debtsData.length; i++){
    var p = (debtsData[i][1] || "").toString().trim();
    var t = (debtsData[i][2] || "").toString().trim().toUpperCase();
    var status = (debtsData[i][6] || "Pending").toString().trim();
    if(p && p.toLowerCase() === person.toLowerCase() && t === expectedType && status !== "Settled"){
      matches.push(i + 1);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function autoCreateDebt(person, debtType, amount, note){
  var debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");
  if(!debtSheet) return { logged: false, reason: "no sheet" };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  debtSheet.appendRow([today, person, debtType, Number(amount) || 0, note || "", "", "Pending", ""]);
  return { logged: true };
}

// Orchestrates the whole thing — called from saveTransactionNote once a
// debtPerson has been confirmed (either recognized live from the note,
// or freshly typed) by the frontend. txnType/note are used to work out
// direction server-side (not trusted from the frontend), same defense-
// in-depth pattern as the rest of this project.
//
// A repayment uses applyDebtPayment (PWA.js) — shared with the manual
// "Record a payment" flow in the Debts tab — rather than always fully
// settling. Found 2026-08-10: the first version always fully settled
// the matched debt regardless of how much was actually paid, so a ₹500
// payment against a ₹1500 debt would have wrongly closed the whole
// thing instead of leaving ₹1000 still due. applyDebtPayment reduces
// the amount in place and only settles once the balance reaches zero.
function handleDebtAutoLink(txnType, note, person, amount){
  if(!person) return { logged: false, reason: "no person" };
  var direction = classifyDebtDirection(txnType, note);
  if(!direction) return { logged: false, reason: "no clear direction" };

  if(direction === "newLent")     return autoCreateDebt(person, "LENT", amount, note);
  if(direction === "newBorrowed") return autoCreateDebt(person, "BORROWED", amount, note);

  var debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");
  var debtsData = debtSheet ? debtSheet.getDataRange().getValues() : [];
  if(direction === "repayLent"){
    var row1 = findSettleableDebtRow(person, "LENT", debtsData);
    return row1 ? applyDebtPayment(row1, amount) : { logged: false, reason: "ambiguous or no matching debt" };
  }
  if(direction === "repayBorrowed"){
    var row2 = findSettleableDebtRow(person, "BORROWED", debtsData);
    return row2 ? applyDebtPayment(row2, amount) : { logged: false, reason: "ambiguous or no matching debt" };
  }
  return { logged: false, reason: "unreachable" };
}
