// needWantSaving.js
// Self-learning Need/Want/Saving/Investment suggestion engine. See
// docs/features/need-want-saving.md in the PWA repo for the full design
// and reasoning — this file only has short comments, that doc is the
// source of truth.

// Buckets an amount into one of four fixed ranges. Used as part of the
// TypeVotes lookup key, so the same merchant can have separately-learned
// patterns for its usual purchase size vs an unusual one.
function getAmountBand(amount) {
  amount = Number(amount) || 0;
  if (amount < 200) return "Small";
  if (amount < 1000) return "Medium";
  if (amount < 5000) return "Large";
  return "XLarge";
}

// How many of your most recent answers (for this merchant+band) to base a
// suggestion on, once there IS real answer history. Deliberately NOT an
// all-time running total — a big batch of unsure guesses (e.g. clearing a
// large backlog in one sitting) would otherwise outweigh careful,
// real-time answers forever. With a window, once you've answered the same
// merchant this many times for real, the old guesses age out completely.
var TYPE_VOTE_WINDOW = 5;

// Recognizes a handful of specific financial instruments directly from
// the transaction text — independent of the visible Category field
// (SmartMemory's category doesn't carry this level of detail; see
// docs/features/need-want-saving.md for why this had to be its own,
// separate check). Used ONLY as a cold-start guess, never to override
// real answer history — see getSuggestedType.
//
// EMI is deliberately NOT included here (other than the specific "home
// loan" phrasing). Unlike rent, an EMI's nature depends entirely on what
// was financed — a TV EMI and a home loan EMI are not the same kind of
// spend — so guessing would often be wrong. Left to normal per-lender
// learning instead, same as any other merchant.
function getFinancialSubtype(counterparty) {
  var text = (counterparty || "").toString().toLowerCase();

  if (text.indexOf("home loan") !== -1 || text.indexOf("housing loan") !== -1) return "homeLoanEmi";
  if (text.indexOf("rent") !== -1 || text.indexOf("landlord") !== -1 || text.indexOf("house rent") !== -1) return "rent";
  if (text.indexOf("insurance") !== -1 || text.indexOf("lic") !== -1) return "insurance";
  if (text.indexOf("ppf") !== -1 || text.indexOf("fixed deposit") !== -1 || text.indexOf("recurring deposit") !== -1) return "saving";
  if (
    text.indexOf("mutual fund") !== -1 || text.indexOf("sip") !== -1 || text.indexOf("stock") !== -1 ||
    text.indexOf("zerodha") !== -1 || text.indexOf("groww") !== -1 || text.indexOf("nps") !== -1
  ) return "investment";

  return null;
}

function getTypeVotesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("TypeVotes");
  if (!sheet) {
    sheet = ss.insertSheet("TypeVotes");
    sheet.appendRow(["Merchant", "AmountBand", "Type", "Timestamp"]);
  }
  return sheet;
}

// Returns "Need" / "Want" / "Saving" / "Investment", or null if this
// transaction shouldn't be tagged at all (not a real spend, or too
// ambiguous to guess).
//
// typeVotesData is optional: pass the already-read TypeVotes sheet values
// (sheet.getDataRange().getValues()) when checking many transactions in a
// row, so the sheet only gets read once instead of once per transaction —
// re-reading it per transaction is what made getPending very slow once
// there was a real backlog (see docs/features/need-want-saving.md). If
// omitted, this reads the sheet itself — fine for a single one-off check.
function getSuggestedType(txnType, category, counterparty, amount, typeVotesData) {
  // Rule 1: money coming IN is never a spend.
  if (txnType === "credit") return null;

  // Rule 2: money lent out (or other debt-settlement categories) isn't
  // spending either — it's a transfer you expect back.
  var excludedCategories = ["Lent"];
  if (excludedCategories.indexOf(category) !== -1) return null;

  // Rule 3: the category engine itself couldn't recognize this
  // counterparty — likely an unrecognized personal transfer. Don't guess.
  if (category === "Other") return null;

  // Rule 4: look at your most recent answers for this merchant+amount-band.
  var band = getAmountBand(amount);
  var data = typeVotesData;
  if (!data) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("TypeVotes");
    data = sheet ? sheet.getDataRange().getValues() : [];
  }

  // Columns: Merchant(0) AmountBand(1) Type(2) Timestamp(3) — one row per
  // answer, not a running total, so "recent" can actually mean recent.
  // recordTypeVote only ever appends, so the sheet's row order already IS
  // the chronological order — deliberately NOT sorting by the Timestamp
  // column itself, since two answers saved in quick succession (e.g. a
  // fast backlog session) can land in the exact same millisecond, which
  // would make a date-comparison sort silently fall back to an unreliable
  // order. Row position is always unambiguous.
  var matches = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === counterparty && data[i][1] === band) {
      matches.push(data[i][2]);
    }
  }

  // Cold start: no real answers yet for this specific merchant+band. A
  // handful of financial instruments are recognizable enough from the
  // transaction text alone to give a smarter first guess than a flat
  // "Need" — but this is ONLY ever a starting point. As soon as you've
  // actually answered this merchant for real, the vote-count below always
  // wins over this guess, even if you consistently disagree with it (e.g.
  // an insurance policy you personally treat differently). This matters —
  // a hard-coded rule that could never be overridden by real behavior
  // would repeat the exact mistake already fixed once for Need/Want/Saving
  // generally (see the sliding-window redesign note above/in the doc).
  if (matches.length === 0) {
    var subtype = getFinancialSubtype(counterparty);
    if (subtype === "rent" || subtype === "homeLoanEmi" || subtype === "insurance") return "Need";
    if (subtype === "saving") return "Saving";
    if (subtype === "investment") return "Investment";
    return "Need"; // generic cold-start default, unchanged from before
  }

  var recent = matches.slice(-TYPE_VOTE_WINDOW); // last N, order doesn't matter for counting
  var counts = { Need: 0, Want: 0, Saving: 0, Investment: 0 };
  recent.forEach(function (t) {
    if (counts.hasOwnProperty(t)) counts[t]++;
  });

  var best = "Need"; // tie-break
  if (counts.Want > counts[best]) best = "Want";
  if (counts.Saving > counts[best]) best = "Saving";
  if (counts.Investment > counts[best]) best = "Investment";
  return best;
}

// Records one answer for chosenType against this merchant+band combo, with
// the current time — called after the user confirms or corrects the tag
// in Pending. Just appends; nothing is ever overwritten, which is what
// lets getSuggestedType look at "the last 5" instead of an all-time total.
function recordTypeVote(counterparty, amount, chosenType) {
  var band = getAmountBand(amount);
  var sheet = getTypeVotesSheet();
  sheet.appendRow([counterparty, band, chosenType, new Date()]);
}

// One-off test — safe to delete once we've confirmed everything works.
// Uses "TEST ZEPTO" as a fake merchant name so it never mixes with real data.
function testNeedWantSaving() {
  Logger.log("Test 1 (credit excluded, expect null): " + getSuggestedType("credit", "Income", "SALARY", 40000));
  Logger.log("Test 2 (Lent excluded, expect null): " + getSuggestedType("credit", "Lent", "TEST FRIEND", 12000));
  Logger.log("Test 3 (Other excluded, expect null): " + getSuggestedType("debit", "Other", "TEST RANDOM PERSON", 500));
  Logger.log("Test 4 (cold start, no subtype match, expect Need): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));

  Logger.log("Test 5 (rent, cold start, expect Need): " + getSuggestedType("debit", "Bills", "TEST LANDLORD RENT", 11000));
  Logger.log("Test 6 (home loan EMI, cold start, expect Need): " + getSuggestedType("debit", "Financial", "TEST HOME LOAN EMI", 15000));
  Logger.log("Test 7 (plain EMI, cold start, expect Need via generic fallback, NOT a hard rule): " + getSuggestedType("debit", "Financial", "TEST BAJAJ EMI", 3000));
  Logger.log("Test 8 (mutual fund SIP, cold start, expect Investment): " + getSuggestedType("debit", "Financial", "TEST SIP MUTUAL FUND", 5000));
  Logger.log("Test 9 (fixed deposit, cold start, expect Saving): " + getSuggestedType("debit", "Financial", "TEST FIXED DEPOSIT", 10000));

  recordTypeVote("TEST ZEPTO", 274, "Want");
  recordTypeVote("TEST ZEPTO", 274, "Want");
  recordTypeVote("TEST ZEPTO", 274, "Want");
  Logger.log("Test 10 (after 3 Want answers, expect Want): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));

  recordTypeVote("TEST ZEPTO", 274, "Need");
  recordTypeVote("TEST ZEPTO", 274, "Need");
  recordTypeVote("TEST ZEPTO", 274, "Need");
  Logger.log("Test 11 (last 5 of 6 answers are 3 Need + 2 Want, expect Need): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));

  // A specific insurance merchant the user has repeatedly overridden to
  // Investment — real answer history must win over the cold-start guess.
  recordTypeVote("TEST LIC POLICY", 5000, "Investment");
  recordTypeVote("TEST LIC POLICY", 5000, "Investment");
  Logger.log("Test 12 (insurance merchant, but user has voted Investment twice, expect Investment — real history beats the cold-start guess): " +
    getSuggestedType("debit", "Financial", "TEST LIC POLICY", 5000));
}
