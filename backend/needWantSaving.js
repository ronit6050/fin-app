// needWantSaving.js
// Self-learning Need/Want/Saving suggestion engine. See
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
// suggestion on. Deliberately NOT an all-time running total — a big batch
// of unsure guesses (e.g. clearing a large backlog in one sitting) would
// otherwise outweigh careful, real-time answers forever. With a window,
// once you've answered the same merchant this many times for real, the
// old guesses age out completely and stop influencing anything. Confirmed
// with the user 2026-08-09 after clearing a 249-item backlog mostly with
// guessed answers.
var TYPE_VOTE_WINDOW = 5;

function getTypeVotesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("TypeVotes");
  if (!sheet) {
    sheet = ss.insertSheet("TypeVotes");
    sheet.appendRow(["Merchant", "AmountBand", "Type", "Timestamp"]);
  }
  return sheet;
}

// Returns "Need" / "Want" / "Saving", or null if this transaction
// shouldn't be tagged at all (not a real spend, or too ambiguous to guess).
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

  if (matches.length === 0) {
    // Never seen this merchant+band combo before — neutral cold-start
    // default. Deliberately NOT based on category, so no category-to-type
    // assumption sneaks back in. Gets replaced by real answers after one use.
    return "Need";
  }

  var recent = matches.slice(-TYPE_VOTE_WINDOW); // last N, oldest of those first — order doesn't matter for counting

  var counts = { Need: 0, Want: 0, Saving: 0 };
  recent.forEach(function (t) {
    if (counts.hasOwnProperty(t)) counts[t]++;
  });

  var best = "Need"; // tie-break
  if (counts.Want > counts[best]) best = "Want";
  if (counts.Saving > counts[best]) best = "Saving";
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
  Logger.log("Test 4 (cold start, expect Need): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));

  recordTypeVote("TEST ZEPTO", 274, "Want");
  recordTypeVote("TEST ZEPTO", 274, "Want");
  recordTypeVote("TEST ZEPTO", 274, "Want");
  Logger.log("Test 5 (after 3 Want answers, expect Want): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));

  recordTypeVote("TEST ZEPTO", 274, "Need");
  recordTypeVote("TEST ZEPTO", 274, "Need");
  recordTypeVote("TEST ZEPTO", 274, "Need");
  Logger.log("Test 6 (last 5 of 6 answers are 3 Need + 2 Want, expect Need): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));
}
