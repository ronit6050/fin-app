// noteWordModel.js (added 2026-10-11)
//
// PLAIN-ENGLISH WHAT THIS IS: the app's first real "learns from you"
// piece for the words you type in a note. If you have written "tea" on
// 60 payments and 59 of them ended up as Food, then the next time you write
// "tea" the app can already guess Food without asking.
//
// Why notes and not just the shop name: a shop name often says little
// (a corner shop sells everything, a wallet payment has no shop name at
// all), but the word YOU typed ("cab", "lunch", "milk") is what you
// actually meant. Replayed on the real history, a note word with a clear
// track record predicted the category right 96% of the time and covered
// about half of all payments.
//
// HOW IT STAYS SAFE (the rules every learning piece in this app follows):
// - It only learns from rows YOU labelled (a note AND a category you chose).
//   It never learns from its own guesses.
// - A word needs a real track record before it is trusted: seen at least
//   3 times, and at least 90% of those times with the same answer. A word
//   that is genuinely mixed (like "lunch" for Need vs Want) is left alone
//   and the question is still asked.
// - It only ever returns a suggestion or nothing. Whether a suggestion is
//   used silently, shown pre-filled, or only used for a one-time backfill
//   is decided by the caller, never here.
//
// This file is pure logic (no sheet reads or writes), so it can be tested
// with plain data. See backend/tests/noteWordModel.test.js.

// The only category answers worth learning from. Early in the app's life
// other names were used ("Groceries", "Lent", ...); those must not teach
// the model anything.
var NOTE_MODEL_CATEGORIES_ = ["Food", "Transport", "Bills", "Shopping", "Lifestyle",
  "Financial", "Income", "Education", "Health", "Other"];

// Words too common or too personal to say anything about the category.
var NOTE_MODEL_STOP_WORDS_ = {
  me: 1, and: 1, with: 1, for: 1, the: 1, to: 1, from: 1, paid: 1, through: 1, via: 1,
  but: 1, will: 1, be: 1, refunded: 1, after: 1, of: 1, in: 1, on: 1, at: 1, a: 1, an: 1
};

// "Tea with Asha!" -> ["tea", "asha"]. Lower-case, letters only,
// 3+ letters, stop words dropped.
function noteWords_(note){
  var cleaned = (note || "").toString().toLowerCase().replace(/[^a-z ]/g, " ");
  var out = [];
  cleaned.split(" ").forEach(function(w){
    if(w.length >= 3 && !NOTE_MODEL_STOP_WORDS_[w]) out.push(w);
  });
  return out;
}

// Learns from the Transactions sheet values (header row first).
// labelCol: 0-based column holding the answer to learn (13 = Category N,
//   16 = NeedWantSaving Q).
// allowed: the answers worth learning (anything else is skipped).
// sinceDate: only rows on/after this date teach the model (the app's
//   habits and category names have changed over time).
// Returns { word: { answer: count } }.
function buildNoteWordModel_(txnData, labelCol, allowed, sinceDate){
  var model = {};
  var allowedSet = {};
  allowed.forEach(function(a){ allowedSet[a] = true; });
  var since = sinceDate ? new Date(sinceDate).getTime() : 0;

  for(var i = 1; i < txnData.length; i++){
    var row = txnData[i];
    var type = (row[3] || "").toString().trim().toLowerCase();
    if(type !== "debit") continue;                       // spending only
    var note = (row[12] || "").toString().trim();        // column M
    if(!note) continue;
    var answer = (row[labelCol] || "").toString().trim();
    if(!allowedSet[answer]) continue;
    if(since){
      var t = new Date(row[0]).getTime();
      if(isNaN(t) || t < since) continue;
    }
    noteWords_(note).forEach(function(w){
      if(!model[w]) model[w] = {};
      model[w][answer] = (model[w][answer] || 0) + 1;
    });
  }
  return model;
}

// Looks up one note. Every word in the note with a clear track record gets
// one vote; the answer with the most votes wins. Returns the answer, or
// null when nothing is clear enough (the caller then falls back to
// whatever it did before, or asks the user).
function predictFromNoteWords_(model, note, minUses, minAgreement){
  minUses = minUses || 3;
  minAgreement = minAgreement || 0.9;
  var votes = {};
  noteWords_(note).forEach(function(w){
    var counts = model[w];
    if(!counts) return;
    var total = 0, best = null, bestCount = 0;
    Object.keys(counts).forEach(function(a){
      total += counts[a];
      if(counts[a] > bestCount){ bestCount = counts[a]; best = a; }
    });
    if(total >= minUses && bestCount / total >= minAgreement){
      votes[best] = (votes[best] || 0) + 1;
    }
  });
  var winner = null, winnerVotes = 0, tie = false;
  Object.keys(votes).forEach(function(a){
    if(votes[a] > winnerVotes){ winner = a; winnerVotes = votes[a]; tie = false; }
    else if(votes[a] === winnerVotes){ tie = true; }
  });
  return (winner && !tie) ? winner : null;
}
