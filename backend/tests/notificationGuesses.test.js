// backend/tests/notificationGuesses.test.js
//
// Plain-English what this checks: the notification now offers up to TWO remembered notes
// as buttons ("Tea . Want", "Coffee . Want") and, in the native app, a reply box for a
// typed note. This proves:
//   1. getSuggestedNotes picks the best two remembered notes with the same trust rules
//      as before (used 2+ times for this shop and amount band; other bands need 3+).
//   2. The push the background check sends carries those guesses, the reply details,
//      and still the OLD single-button fields (so an older app keeps working).
//   3. Nothing is offered for money coming in, Rent/EMI/SIP look-alikes or wallet top-ups.
//   4. A typed reply gets a Need/Want ONLY when its words have a clear history (autoType),
//      and never overrides a type that was sent.
// All data is invented.
//
// Run with: node backend/tests/notificationGuesses.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "v2route.js", "flags.js", "v2db.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

function txn(o){
  const r = new Array(19).fill("");
  r[0] = o.date || daysAgo(2); r[1] = "10:00:00"; r[2] = "TESTBANK"; r[3] = o.type || "debit"; r[4] = o.mode || "upi";
  r[5] = o.amount || 17; r[6] = o.ref || ""; r[7] = o.cp === undefined ? "Coffee Makers" : o.cp; r[12] = o.note || "";
  r[13] = o.cat || ""; r[15] = o.processed === undefined ? "YES" : o.processed; r[16] = o.nws || "";
  return r;
}
const times = (n, o) => Array.from({ length: n }, () => txn(o));

// History that teaches the note words: tea -> Want, coffee -> Want
const taught = [].concat(times(10, { note: "Tea", nws: "Want", cat: "Food", ref: "" }))
                 .concat(times(10, { note: "Coffee", nws: "Want", cat: "Food", ref: "" }));

function world(newRow, noteMemoryRows, extraSheets){
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [HEADER].concat(taught, [newRow]));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]].concat((extraSheets && extraSheets.fe) || []));
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"], ["coffee makers", "Food", "Cafe", 100, 9, new Date()]]);
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]]);
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]].concat(noteMemoryRows));
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]]);
  w.props.lastCheckedRow = String(1 + taught.length);      // everything before the new row is already alerted
  return w;
}
const nm = (note, used, band, daysOld) => ["Coffee Makers", band || "Small", note, used, daysAgo(daysOld || 1)];

console.log("\n--- 1. getSuggestedNotes: best two, same trust rules ---");
{
  const w = world(txn({ processed: "" }), []);
  const sb = w.sb;
  const mem = [["Merchant","AmountBand","Note","TimesUsed","LastUsed"], nm("Tea", 5), nm("Coffee", 3), nm("Chai", 1), nm("Lunch", 4, "Medium"), nm("tea ", 2)];
  const out = sb.getSuggestedNotes("Coffee Makers", 17, mem, 2);
  assert(JSON.stringify(out) === JSON.stringify(["Tea", "Coffee"]), "top two by use count: Tea (5) then Coffee (3) (got " + JSON.stringify(out) + ")");
  assert(!out.includes("Chai"), "a note used only once is never offered");
  assert(!out.some((n) => n.trim().toLowerCase() === "tea" && n !== "Tea"), "a duplicate that differs only in capitals/spaces is dropped");
  const one = sb.getSuggestedNotes("Coffee Makers", 17, [mem[0], nm("Tea", 5)], 2);
  assert(one.length === 1, "only one qualifying note -> one guess");
  const other = sb.getSuggestedNotes("Coffee Makers", 17, [mem[0], nm("Tea", 5), nm("Lunch", 4, "Medium")], 2);
  assert(JSON.stringify(other) === JSON.stringify(["Tea", "Lunch"]), "a note from ANOTHER amount band may fill the free slot, but only if used 3+ times");
  const strict = sb.getSuggestedNotes("Coffee Makers", 17, [mem[0], nm("Tea", 5), nm("Lunch", 2, "Medium")], 2);
  assert(JSON.stringify(strict) === JSON.stringify(["Tea"]), "another band's note used only twice is NOT enough");
  assert(sb.getSuggestedNotes("", 17, mem, 2).length === 0 && sb.getSuggestedNotes("Nobody", 17, mem, 2).length === 0, "no merchant / unknown merchant -> nothing");
  assert(sb.getSuggestedNote("Coffee Makers", 17, mem) === "Tea", "the old single-note function is unchanged");
}

console.log("\n--- 2. The push carries two guesses, the reply details, and the old fields ---");
{
  const w = world(txn({ processed: "" }), [nm("Tea", 5), nm("Coffee", 3)]);
  w.sb.processNewTransactions();
  const push = w.pushes.find((p) => p.title && p.title.indexOf("New Transaction") !== -1);
  assert(!!push && !!push.extra, "a notification with extra data was sent");
  const x = push.extra;
  const guesses = JSON.parse(x.guesses);
  assert(guesses.length === 2 && guesses[0].note === "Tea" && guesses[1].note === "Coffee", "two guesses, best first");
  assert(guesses[0].category === "Food" && guesses[0].type === "Want" && guesses[1].type === "Want", "each carries the shop's category and a Want from the note word's history");
  assert(x.replyEnabled === "1" && x.replyCategory === "Food", "reply box enabled, saved under the shop's category");
  assert(x.quickConfirm === "1" && x.note === "Tea" && x.category === "Food" && x.type === "Want", "the OLD single-button fields still describe guess 1 (an older app keeps working)");
  assert(x.fp && x.row && x.counterparty === "Coffee Makers", "row, fingerprint and shop travel with it (stale-card safeguard)");
  assert(push.body.indexOf('Save as "Tea" or "Coffee"?') !== -1, "the text says what the two buttons will do");
}

console.log("\n--- 3. One guess, no guess, and the cases that must offer nothing ---");
{
  const one = world(txn({ processed: "" }), [nm("Tea", 5)]);
  one.sb.processNewTransactions();
  const p1 = one.pushes.find((p) => p.extra);
  assert(JSON.parse(p1.extra.guesses).length === 1 && p1.body.indexOf('Tap to save as "Tea"') !== -1, "one remembered note -> one button and 'Tap to save as ...'");

  const none = world(txn({ processed: "" }), []);
  none.sb.processNewTransactions();
  const p0 = none.pushes[0];
  assert(p0.extra && p0.extra.replyEnabled === "1" && !p0.extra.quickConfirm && !p0.extra.guesses, "nothing remembered -> no guess buttons, but the reply box is still offered");
  assert(p0.body.indexOf("Save as") === -1 && p0.body.indexOf("Tap to save") === -1, "and the text does not promise buttons that are not there");

  const credit = world(txn({ processed: "", type: "credit" }), [nm("Tea", 5), nm("Coffee", 3)]);
  credit.sb.processNewTransactions();
  assert(!credit.pushes[0].extra, "money coming IN gets a plain notification (no buttons, no reply box)");

  const topup = world(txn({ processed: "", cp: "PayZapp Wallet", ref: "123456789012" }), [["PayZapp Wallet", "Small", "Tea", 5, daysAgo(1)]]);
  topup.sb.processNewTransactions();
  assert(!topup.pushes.length || !topup.pushes[0].extra, "a wallet top-up gets no buttons (it is settled silently, or at most a plain notification)");

  const rent = world(txn({ processed: "", amount: 15000, cp: "Landlord" }), [["Landlord", "Large", "Rent", 5, daysAgo(1)]],
    { fe: [["Rent", 15000, "Landlord", "YES", ""]] });
  rent.sb.processNewTransactions();
  assert(!rent.pushes.length || !rent.pushes[0].extra, "a Rent/EMI/SIP look-alike gets no buttons (settled silently, or a plain notification - it needs the real card)");
}

console.log("\n--- 3b. The same rules checked directly on the function ---");
{
  const w = world(txn({ processed: "" }), []);
  const smart = [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"], ["coffee makers", "Food", "Cafe", 100, 9, new Date()]];
  const memHead = ["Merchant","AmountBand","Note","TimesUsed","LastUsed"];
  const mem = [memHead, nm("Tea", 5)];
  const feHead = ["Type","Amount","Counterparty","Confirmed","Name"];
  const o = w.sb.getQuickConfirmOptions("debit", "Coffee Makers", 17, "upi", "", smart, mem, [feHead], [], null);
  assert(o && o.guesses.length === 1, "sanity: a normal debit gets options");
  assert(w.sb.getQuickConfirmOptions("credit", "Coffee Makers", 17, "upi", "", smart, mem, [], [], null) === null, "a credit gets nothing");
  assert(w.sb.getQuickConfirmOptions("debit", "PayZapp Wallet", 17, "upi", "123456789012", smart, [memHead, ["PayZapp Wallet", "Small", "Tea", 5, new Date()]], [], [], null) === null, "a wallet top-up gets nothing");
  const fe = [feHead, ["Rent", 15000, "Landlord", "YES", ""]];
  assert(w.sb.getQuickConfirmOptions("debit", "Landlord", 15000, "upi", "", smart, [memHead, ["Landlord", "Large", "Rent", 5, new Date()]], fe, [], null) === null, "a Rent look-alike gets nothing");
}

console.log("\n--- 4. A typed reply: autoType fills Need/Want only from clear history ---");
{
  const mk = () => {
    const w = world(txn({ processed: "YES" }), []);
    w.sb.verifyGoogleIdToken = function(){ return { email: "ronitnadar9@gmail.com", name: "T" }; };
    w.sb.jsonResponse = function(o){ return { getContent: function(){ return JSON.stringify(o); } }; };
    return w;
  };
  const call = (w, extra) => JSON.parse(w.sb.handlePwaRequest(Object.assign({ action: "saveNote", idToken: "t", row: 2 + taught.length, category: "Food", counterparty: "Coffee Makers" }, extra)).getContent());
  const lastRow = (w) => w.sheets.Transactions.rows[1 + taught.length];

  let w = mk();
  let r = call(w, { note: "tea", autoType: true });
  assert(r.ok && lastRow(w)[16] === "Want", "typed 'tea' with autoType -> Want filled in from your history");

  w = mk();
  r = call(w, { note: "parking", autoType: true });
  assert(r.ok && lastRow(w)[16] === "", "typed 'parking' (no history) -> no tag, nothing invented");

  w = mk();
  r = call(w, { note: "tea" });
  assert(r.ok && lastRow(w)[16] === "", "without autoType nothing is filled in (the website's behaviour is unchanged)");

  w = mk();
  r = call(w, { note: "tea", autoType: true, type: "Need" });
  assert(r.ok && lastRow(w)[16] === "Need", "a type that was sent always wins over autoType");
}

console.log("\n--- 5. Review fixes: replies and repeats must not teach the app things you did not choose ---");
{
  const mk = () => {
    const w = world(txn({ processed: "YES", cp: "New Shop" }), []);
    w.sb.verifyGoogleIdToken = function(){ return { email: "ronitnadar9@gmail.com", name: "T" }; };
    w.sb.jsonResponse = function(o){ return { getContent: function(){ return JSON.stringify(o); } }; };
    return w;
  };
  const rowNo = 2 + taught.length;
  const call = (w, extra) => JSON.parse(w.sb.handlePwaRequest(Object.assign({ action: "saveNote", idToken: "t", row: rowNo, category: "Other", counterparty: "New Shop" }, extra)).getContent());
  const smartCount = (w) => w.sheets.SmartMemory.rows.length;
  const votes = (w) => w.sheets.TypeVotes.rows.length;
  const notes = (w) => w.sheets.NoteMemory.rows.length;

  // 1. a typed reply never teaches the shop's category (here the guess was the fallback "Other")
  let w = mk();
  const smartBefore = smartCount(w);
  let r = call(w, { note: "tea", autoType: true });
  assert(r.ok && smartCount(w) === smartBefore, "a typed reply does NOT write the shop into the category memory (no 'Other' at full confidence)");
  // 2. nor does it add a Need/Want vote, but the tag is still saved and reported back
  assert(r.savedType === "Want" && w.sheets.Transactions.rows[rowNo - 1][16] === "Want", "the tag is still saved (and reported back so the phone can show it)");
  assert(votes(w) === 1, "...but no Need/Want vote was added for the shop (header row only)");
  assert(notes(w) === 2, "the typed note itself IS remembered (you really typed it)");

  // 3. a normal save (the website) still teaches, exactly as before
  w = mk();
  r = call(w, { note: "tea", category: "Food", type: "Want" });
  assert(r.ok && smartCount(w) === smartBefore + 1 && votes(w) === 2 && notes(w) === 2, "a normal Pending-style save still teaches category, vote and note");

  // 4. saving the identical thing again (double tap / retry) does not count twice
  r = call(w, { note: "tea", category: "Food", type: "Want" });
  assert(r.ok && smartCount(w) === smartBefore + 1 && votes(w) === 2, "an identical second save adds no second category entry or vote");
  const used = w.sheets.NoteMemory.rows[1][3];
  assert(used === 1, "...and the note's use count stays at 1, not 2 (got " + used + ")");

  // 5. a real change IS still learned
  r = call(w, { note: "tea", category: "Food", type: "Need" });
  assert(r.ok && votes(w) === 3, "changing the tag later is still a real, learned correction");
}

console.log("\nDone.");
