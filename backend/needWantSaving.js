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

// Recognizes a person-to-person loan or repayment from the note (and
// counterparty) text — e.g. "lent", "borrowed", "paid back". Unlike
// getFinancialSubtype below, this is an UNCONDITIONAL exclusion, not a
// cold-start guess: lending isn't spending at all (you expect the money
// back), so it's excluded from Need/Want/Saving/Investment every time,
// not just as a first guess.
//
// Replaces an old category-based exclusion rule that never actually
// worked: the category engine only ever produces "Financial" as the
// top-level category for a lending transaction — "Lending" was a more
// specific sub-type computed internally but never passed through to
// this function, so the old rule ("skip if category is Lent") could
// never fire. Found 2026-08-09 when the user noticed the app still
// asking Need/Want/Saving for a transaction they'd noted "lent".
//
// Uses whole-word matching (\b...\b), NOT a plain substring check — a
// plain substring check was shipped first and immediately caused a much
// worse silent bug (found 2026-08-10): "lent" as a bare substring also
// matches inside "exceLLENT", "siLENT", "taLENT", "caLENDar",
// "spLENDid", etc. Since this function's result silently skips saving
// the type (see the caller in PWA.js's saveTransactionNote) rather than
// showing any error, real transactions with completely ordinary
// merchant names or notes were having their Need/Want/Saving/Investment
// choice silently dropped, while the save still reported success. Word
// boundaries mean "lent" only matches as its own word, not buried
// inside a longer one.
var LENDING_PATTERNS = [/\blent\b/, /\blend\b/, /\bborrowed\b/, /\bpaid back\b/, /\bgave back\b/, /\breturned\b/];
function isLendingTransfer(counterparty, note) {
  var text = ((counterparty || "") + " " + (note || "")).toString().toLowerCase();
  for (var i = 0; i < LENDING_PATTERNS.length; i++) {
    if (LENDING_PATTERNS[i].test(text)) return true;
  }
  return false;
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
// note is optional too — pass it whenever it's known (History,
// Reconciliation) so isLendingTransfer can actually detect a loan/
// repayment; Pending has no note yet at suggestion time, so this rule
// simply won't fire there (not a regression — it never could before).
function getSuggestedType(txnType, category, counterparty, amount, typeVotesData, note) {
  // Rule 1: money coming IN is never a spend.
  if (txnType === "credit") return null;

  // Rule 2: a person-to-person loan or repayment isn't spending either —
  // it's a transfer you expect back, not consumption.
  if (isLendingTransfer(counterparty, note)) return null;

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
  Logger.log("Test 2 (real-world lending scenario — category is just \"Financial\", note is \"lent\", expect null): " +
    getSuggestedType("debit", "Financial", "TEST FRIEND", 100, null, "lent"));
  Logger.log("Test 2b (borrowed FROM a friend, expect null): " +
    getSuggestedType("debit", "Financial", "TEST FRIEND", 500, null, "borrowed from him"));
  // Regression test for the 2026-08-10 false-positive bug: "lent" as a
  // plain substring also matched inside these completely ordinary words.
  // Must NOT be excluded — a real type should be suggested/allowed.
  Logger.log("Test 2c (\"excellent\" in note, expect NOT null): " +
    getSuggestedType("debit", "Food", "TEST RESTAURANT", 400, null, "excellent food"));
  Logger.log("Test 2d (\"CALENDAR\" in counterparty, expect NOT null): " +
    getSuggestedType("debit", "Shopping", "CALENDAR APP SUBSCRIPTION", 200, null, ""));
  Logger.log("Test 2e (\"talent\" in note, expect NOT null): " +
    getSuggestedType("debit", "Education", "TEST ACADEMY", 5000, null, "talent academy fees"));
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
