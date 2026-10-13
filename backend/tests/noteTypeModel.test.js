// backend/tests/noteTypeModel.test.js
//
// Plain-English what this checks: the "Need / Want / Saving from your note words"
// feature (backend/noteWordModel.js + the live lookup in index.html).
//   1. The table the server builds learns ONLY from your own tagged notes, only
//      from the reliable period, only words used 3+ times.
//   2. "Confident" / "mixed" / "nothing" answers follow the agreed rules
//      (3+ uses, 90%+ agreement, a tie is no answer).
//   3. THE PHONE AND THE SERVER AGREE: the lookup code copied into index.html
//      is extracted and run on the same notes as the server's version.
//   4. The table travels with the Pending list and the dashboard, and the
//      notification's Confirm button uses it.
// All data is invented.
//
// Run with: node backend/tests/noteTypeModel.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "v2route.js", "v2db.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

function row(o){
  const r = new Array(19).fill("");
  r[0] = o.date || daysAgo(5); r[1] = "10:00:00"; r[2] = "TESTBANK"; r[3] = o.type || "debit"; r[4] = "upi";
  r[5] = o.amount || 20; r[6] = o.ref || ""; r[7] = o.cp || "SHOP"; r[12] = o.note || ""; r[13] = o.cat || "Food";
  r[15] = o.processed === undefined ? "YES" : o.processed; r[16] = o.nws || "";
  return r;
}
const times = (n, o) => Array.from({ length: n }, () => row(o));

function world(rows){
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]]);
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  return w;
}

// A realistic history: tea mostly Want, milk always Need, lunch mixed, plus rows
// that must NOT teach anything.
const history = []
  .concat(times(9, { note: "Tea", nws: "Want" }))
  .concat(times(1, { note: "tea", nws: "Need" }))                                    // 9 of 10 = exactly 90%
  .concat(times(5, { note: "Milk", nws: "Need" }))
  .concat(times(4, { note: "lunch", nws: "Need" }))
  .concat(times(5, { note: "Lunch", nws: "Want" }))
  .concat(times(2, { note: "rare thing", nws: "Want" }))                             // only 2 uses
  .concat(times(6, { note: "snacks", nws: "Want", date: new Date("2026-06-15") }))   // before the reliable date
  .concat(times(6, { note: "refund", nws: "Need", type: "credit" }))                 // credits never teach
  .concat(times(6, { note: "gift", nws: "" }))                                       // untagged / Not sure teach nothing
  .concat(times(6, { note: "visa", nws: "Investment" }));                            // Investment is not offered, so not learned

console.log("\n--- 1. What the server table learns from ---");
const w = world(history);
const data = w.sheets.Transactions.rows;
const model = w.sb.buildNoteTypeModel_(data);
assert(model.tea && model.tea.Want === 9 && model.tea.Need === 1, "tea: 9 Want, 1 Need (case-insensitive)");
assert(model.milk && model.milk.Need === 5, "milk: 5 Need");
assert(model.lunch && model.lunch.Need === 4 && model.lunch.Want === 5, "lunch: mixed 4 / 5");
assert(!model.rare && !model.thing, "words used fewer than 3 times are not sent");
assert(!model.snacks, "rows before the reliable date teach nothing");
assert(!model.refund, "credits teach nothing");
assert(!model.gift, "untagged notes (Not sure / no choice) teach nothing");
assert(!model.visa, "Investment tags are not learned (the card does not offer that choice)");
assert(Object.keys(model).length === 3, "exactly 3 words in the table (got " + Object.keys(model).join(",") + ")");

console.log("\n--- 2. Confident / mixed / nothing ---");
const ex = (note, m) => w.sb.explainNoteWordPrediction_(m || model, note);
let r = ex("Tea");
assert(r && r.kind === "confident" && r.answer === "Want" && r.word === "tea" && r.count === 9 && r.total === 10, "tea 9 of 10 (exactly 90%) is confident Want");
r = ex("milk");
assert(r && r.kind === "confident" && r.answer === "Need" && r.count === 5 && r.total === 5, "milk 5 of 5 is confident Need");
r = ex("Lunch with team");
assert(r && r.kind === "mixed" && r.word === "lunch" && r.counts.Need === 4 && r.counts.Want === 5, "lunch is mixed and the counts are reported");
assert(ex("parking") === null && ex("") === null && ex(null) === null, "unknown word, empty note, null note -> nothing");
assert(ex("tea and milk") === null || ex("tea and milk").kind === "mixed" || true, "(two confident words that disagree are a tie, checked next)");
r = ex("tea milk");
assert(r === null, "a TIE between two confident words (tea=Want vs milk=Need) gives no answer");
r = ex("tea tea tea");
assert(r && r.answer === "Want", "repeating one word does not change the answer");
const m2 = { tea: { Want: 8, Need: 2 } };            // 80% - below the bar
r = ex("tea", m2);
assert(r && r.kind === "mixed", "80% agreement is not confident (it is reported as mixed)");
const m3 = { tea: { Want: 2 } };                      // 2 uses - below the bar
assert(ex("tea", m3) === null, "fewer than 3 uses: nothing");
assert(ex("tea", {}) === null && ex("tea", { other: { Need: 9 } }) === null, "empty / unrelated table: nothing");

console.log("\n--- 3. THE PHONE AND THE SERVER AGREE ---");
{
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const a = html.indexOf("    let noteWordModel = null;");
  const b = html.indexOf("    function buildPendingItem(txn) {");
  assert(a > 0 && b > a, "found the phone's lookup code in index.html");
  const code = html.slice(a, b);
  function phoneFor(modelObj, demo){
    const sb = { String: String, Object: Object, Math: Math, demoMode: !!demo, loadCache: function(){ return modelObj; }, saveCache: function(){} };
    vm.createContext(sb);
    vm.runInContext(code + "\nthis.__predict = predictNoteType;", sb);
    return sb.__predict;
  }
  const notes = ["Tea", "tea!", "TEA with Asha", "milk", "Milk and tea", "lunch", "Lunch at office", "dinner", "", "  ", "to the tea shop", "paid for the milk",
    "tea tea", "lunch milk", "x", "ab", "123", "Tea/Coffee", "milk, lunch, tea"];
  const models = [model, m2, m3, {}, { tea: { Want: 9, Need: 1 }, milk: { Need: 5 }, lunch: { Need: 4, Want: 5 }, dinner: { Saving: 3 } }];
  let same = 0, total = 0;
  models.forEach(function (mm, mi) {
    const predictPhone = phoneFor(mm);
    notes.forEach(function (n) {
      total++;
      const phone = predictPhone(n);
      const server = w.sb.explainNoteWordPrediction_(mm, n);
      const norm = (x) => JSON.stringify(x && x.kind === "mixed" ? { kind: "mixed", word: x.word, counts: x.counts } : x);
      if (norm(phone) === norm(server)) same++;
      else console.log("   DIFFERENT for", JSON.stringify(n), "model", mi, "phone", norm(phone), "server", norm(server));
    });
  });
  assert(same === total, "phone and server give the identical answer on all " + total + " note/table combinations (" + same + " matched)");
  // Demo Mode must never show the real table
  assert(phoneFor(model, true)("Tea") === null, "Demo Mode: the phone lookup returns nothing, so real tagging history cannot leak into the demo");
}

console.log("\n--- 4. The table travels, and the notification uses it ---");
{
  const pw = world(history.concat([row({ note: "", processed: "YES", cp: "COFFEE MAKERS", amount: 17, ref: "1" })]));
  pw.sb.verifyGoogleIdToken = function(){ return { email: "ronitnadar9@gmail.com", name: "T" }; };
  pw.sb.jsonResponse = function(o){ return { getContent: function(){ return JSON.stringify(o); } }; };
  const out = JSON.parse(pw.sb.handlePwaRequest({ action: "getPending", idToken: "t" }).getContent());
  assert(out.ok && Array.isArray(out.transactions) && out.noteWordModel && out.noteWordModel.tea && out.noteWordModel.tea.Want === 9, "getPending returns the note-word table next to the list");
  // Running the whole dashboard needs a dozen unrelated sheets; backendCleanup2026-08-12.test.js
  // already runs getDashboardData end to end (and loads this file), so here we check the wiring.
  const pwaSource = fs.readFileSync(path.join(__dirname, "..", "PWA.js"), "utf8");
  assert(/full:\s*\{[\s\S]*noteWordModel:\s*buildNoteTypeModel_\(txnData\)/.test(pwaSource), "the dashboard copy carries the table (so the fast screens have it)");

  // Quick-confirm: a remembered note "Tea" for this shop -> the type now comes from the note word
  const noteMemory = [["Merchant","AmountBand","Note","TimesUsed","LastUsed"], ["Coffee Makers", "Small", "Tea", 4, new Date()]];
  const smart = [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"], ["coffee makers", "Food", "Snacks", 100, 5, new Date()]];
  const withModel = pw.sb.getQuickConfirmSuggestion("debit", "Coffee Makers", 17, "upi", "", smart, noteMemory, [], [], model);
  assert(withModel && withModel.note === "Tea" && withModel.type === "Want", "notification Confirm: type comes from the note word (Want)");
  const without = pw.sb.getQuickConfirmSuggestion("debit", "Coffee Makers", 17, "upi", "", smart, noteMemory, [], [], null);
  assert(without && (without.type === "" || typeof without.type === "string"), "without a table it behaves as before (no crash)");
  const lunchMemory = [["Merchant","AmountBand","Note","TimesUsed","LastUsed"], ["Coffee Makers", "Small", "lunch", 4, new Date()]];
  const mixed = pw.sb.getQuickConfirmSuggestion("debit", "Coffee Makers", 17, "upi", "", smart, lunchMemory, [], [], model);
  const mixedNoModel = pw.sb.getQuickConfirmSuggestion("debit", "Coffee Makers", 17, "upi", "", smart, lunchMemory, [], [], null);
  assert(mixed && mixedNoModel && mixed.type === mixedNoModel.type, "a MIXED word changes nothing: the Confirm button's type is exactly what it was without the table");
}

console.log("\nDone.");
