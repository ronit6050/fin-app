// backend/tests/noteWordModel.test.js
//
// Plain-English what this checks: the "learn from the words you type"
// piece (noteWordModel.js) and its first use, the one-time category
// backfill in Logger.js. All data below is invented (this repo is public).
//
// What this proves:
//   1. Words are cleaned the way we expect (case, punctuation, stop words).
//   2. A word is only trusted after >= 3 uses AND >= 90% the same answer;
//      a genuinely mixed word ("lunch") is never guessed.
//   3. Only YOUR labelled rows teach it: unknown category names, credits,
//      old rows and rows without a note are ignored.
//   4. Several words in one note vote; a tie gives no answer.
//   5. The backfill preview uses it ("cab" -> Transport) but still falls
//      back to the old merchant guesser when the note word is unclear,
//      and still turns a "salary" credit into Income.
//
// Run with: node backend/tests/noteWordModel.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const w = makeWorld(["category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js",
  "financialEvents.js", "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Logger.js"]);
const sb = w.sb;

console.log("\n--- 1. Cleaning words ---");
{
  const out = sb.noteWords_("Tea with Asha!! and 2 snacks");
  assert(JSON.stringify(out) === JSON.stringify(["tea", "asha", "snacks"]),
    "lower-cased, punctuation/digits dropped, stop words and short words removed (got " + JSON.stringify(out) + ")");
}

const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
// A Transactions row: A Date, B Time, C Bank, D Type, E Mode, F Amount, G Ref, H Counterparty, ..., M Note(12), N Category(13)
function row(daysAgo, type, note, category, extra){
  const r = new Array(19).fill("");
  r[0] = day(daysAgo); r[3] = type; r[4] = "upi"; r[5] = 50; r[7] = (extra && extra.cp) || "some shop";
  r[12] = note; r[13] = category; r[15] = "YES";
  return r;
}
const HEADER = new Array(19).fill("h");
const CATS = sb.NOTE_MODEL_CATEGORIES_;
const SINCE = new Date(Date.now() - 120 * 86400000);

console.log("\n--- 2. Trust thresholds ---");
{
  const data = [HEADER,
    row(1, "debit", "Tea", "Food"), row(2, "debit", "Tea", "Food"), row(3, "debit", "Tea", "Food"), row(4, "debit", "Tea", "Food"),
    row(1, "debit", "Cab", "Transport"), row(2, "debit", "Cab", "Transport"),
    row(1, "debit", "Lunch", "Food"), row(2, "debit", "Lunch", "Food"), row(3, "debit", "Lunch", "Food"),
    row(4, "debit", "Lunch", "Other"), row(5, "debit", "Lunch", "Other")
  ];
  const model = sb.buildNoteWordModel_(data, 13, CATS, SINCE);
  assert(sb.predictFromNoteWords_(model, "tea") === "Food", "'tea' seen 4 times, always Food -> Food");
  assert(sb.predictFromNoteWords_(model, "Cab") === null, "'cab' seen only 2 times -> not trusted yet");
  assert(sb.predictFromNoteWords_(model, "lunch") === null, "'lunch' is 3 Food / 2 Other (60%) -> never guessed");
  assert(sb.predictFromNoteWords_(model, "something never seen") === null, "unknown words -> no answer");
}

console.log("\n--- 3. Only labelled spending rows teach it ---");
{
  const data = [HEADER,
    row(1, "debit", "Gym", "Groceries"), row(2, "debit", "Gym", "Groceries"), row(3, "debit", "Gym", "Groceries"),   // not an allowed answer
    row(1, "credit", "Refund", "Shopping"), row(2, "credit", "Refund", "Shopping"), row(3, "credit", "Refund", "Shopping"), // credits skipped
    row(1, "debit", "", "Food"), row(2, "debit", "", "Food"), row(3, "debit", "", "Food"),                           // no note
    row(300, "debit", "Pizza", "Food"), row(301, "debit", "Pizza", "Food"), row(302, "debit", "Pizza", "Food")        // too old
  ];
  const model = sb.buildNoteWordModel_(data, 13, CATS, SINCE);
  assert(sb.predictFromNoteWords_(model, "gym") === null, "an unknown category name teaches nothing");
  assert(sb.predictFromNoteWords_(model, "refund") === null, "credits teach nothing");
  assert(sb.predictFromNoteWords_(model, "pizza") === null, "rows older than the window teach nothing");
}

console.log("\n--- 4. Several words vote, ties give no answer ---");
{
  const data = [HEADER];
  for(let i = 1; i <= 3; i++){ data.push(row(i, "debit", "Cab", "Transport")); data.push(row(i, "debit", "Tea", "Food")); }
  const model = sb.buildNoteWordModel_(data, 13, CATS, SINCE);
  assert(sb.predictFromNoteWords_(model, "cab ride") === "Transport", "one clear word decides");
  assert(sb.predictFromNoteWords_(model, "cab and tea") === null, "two words, two answers (tie) -> no answer");
}

console.log("\n--- 5. The one-time backfill uses it ---");
{
  const data = [HEADER];
  for(let i = 1; i <= 4; i++) data.push(row(i, "debit", "Cab", "Transport", { cp: "driver one" }));
  const wanted = row(1, "debit", "Cab", "", { cp: "driver two" });          // note, no category
  const unclear = row(2, "debit", "Zzyzx thing", "", { cp: "random place" }); // note word never seen
  const salary = row(3, "credit", "Salary sept", "", { cp: "employer pay" });
  data.push(wanted, unclear, salary);
  w.addSheet("Transactions", data);

  const out = sb.previewMissingCategories();
  const get = (needle) => { const m = new RegExp('- Row \\d+: "' + needle + '"[\\s\\S]*?-> (\\w+)').exec(out); return m && m[1]; };
  assert(get("Cab") === "Transport", "the 'Cab' row is filled as Transport from the learned note word (got " + get("Cab") + ")");
  assert(get("Salary sept") === "Income", "a credit with 'salary' in the note becomes Income (got " + get("Salary sept") + ")");
  const fb = get("Zzyzx thing");
  assert(fb && fb.length > 0, "an unclear note falls back to the old merchant guesser and still gets an answer (got " + fb + ")");
  assert(/3 row\(s\) would be filled in/.test(out), "exactly the 3 uncategorised rows are listed");

  const sheet = w.sheets["Transactions"];
  const before = JSON.stringify(sheet.rows);
  sb.previewMissingCategories();
  assert(JSON.stringify(sheet.rows) === before, "the preview changes nothing in the sheet");
  sb.backfillMissingCategories();
  assert(sheet.rows[5][13] === "Transport", "the real backfill writes Transport to the Cab row");
  assert(sheet.rows[7][13] === "Income", "the real backfill writes Income to the salary row");
  assert(sheet.rows[1][13] === "Transport", "rows that already had a category are untouched");
}

console.log("\nDone.");
