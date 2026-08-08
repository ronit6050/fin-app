// needWantSaving.js
// Self-learning Need/Want/Saving suggestion engine. See
// docs/features/need-want-saving.md in the PWA repo for the full design
// and reasoning — this file only has short comments, that doc is the
// source of truth.

// Buckets an amount into one of four fixed ranges. Used as part of the
// TypeMemory lookup key, so the same merchant can have separately-learned
// patterns for its usual purchase size vs an unusual one.
function getAmountBand(amount) {
  amount = Number(amount) || 0;
  if (amount < 200) return "Small";
  if (amount < 1000) return "Medium";
  if (amount < 5000) return "Large";
  return "XLarge";
}

// Returns "Need" / "Want" / "Saving", or null if this transaction
// shouldn't be tagged at all (not a real spend, or too ambiguous to guess).
function getSuggestedType(txnType, category, counterparty, amount) {
  // Rule 1: money coming IN is never a spend.
  if (txnType === "credit") return null;

  // Rule 2: money lent out (or other debt-settlement categories) isn't
  // spending either — it's a transfer you expect back.
  var excludedCategories = ["Lent"];
  if (excludedCategories.indexOf(category) !== -1) return null;

  // Rule 3: the category engine itself couldn't recognize this
  // counterparty — likely an unrecognized personal transfer. Don't guess.
  if (category === "Other") return null;

  // Rule 4: look up how this merchant+amount-band has voted before.
  var band = getAmountBand(amount);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("TypeMemory");
  var data = sheet.getDataRange().getValues();
  // Columns: Merchant(0) AmountBand(1) NeedCount(2) WantCount(3) SavingCount(4) TimesUsed(5) LastUsed(6)
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === counterparty && data[i][1] === band) {
      var counts = { Need: data[i][2], Want: data[i][3], Saving: data[i][4] };
      var best = "Need"; // tie-break / all-zero default
      if (counts.Want > counts[best]) best = "Want";
      if (counts.Saving > counts[best]) best = "Saving";
      return best;
    }
  }

  // Never seen this merchant+band combo before — neutral cold-start
  // default. Deliberately NOT based on category, so no category-to-type
  // assumption sneaks back in. Gets replaced by real votes after one use.
  return "Need";
}

// Records one vote for chosenType against this merchant+band combo.
// Called after the user confirms or corrects the tag in Pending.
function recordTypeVote(counterparty, amount, chosenType) {
  var band = getAmountBand(amount);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("TypeMemory");
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === counterparty && data[i][1] === band) {
      var rowNum = i + 1; // sheet rows are 1-indexed; row 1 is the header
      var colIndex = { Need: 3, Want: 4, Saving: 5 }[chosenType]; // C/D/E
      var currentCount = sheet.getRange(rowNum, colIndex).getValue();
      sheet.getRange(rowNum, colIndex).setValue(currentCount + 1);

      var timesUsed = data[i][2] + data[i][3] + data[i][4] + 1;
      sheet.getRange(rowNum, 6).setValue(timesUsed); // TimesUsed
      sheet.getRange(rowNum, 7).setValue(new Date()); // LastUsed
      return;
    }
  }

  // First time seeing this merchant+band combo — add a new row.
  var newRow = [counterparty, band, 0, 0, 0, 1, new Date()];
  var typeColIndex = { Need: 2, Want: 3, Saving: 4 }[chosenType]; // 0-indexed
  newRow[typeColIndex] = 1;
  sheet.appendRow(newRow);
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
  Logger.log("Test 5 (after 3 Want votes, expect Want): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));

  recordTypeVote("TEST ZEPTO", 274, "Need");
  Logger.log("Test 6 (1 Need vote shouldn't beat 3 Want votes, expect Want): " + getSuggestedType("debit", "Food", "TEST ZEPTO", 274));
}