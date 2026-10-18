// backend/tests/homePendingMakeover.test.js
//
// Plain-English what this checks (Home + Pending makeover, 2026-10-18):
//   A. Pending items carry `ready`, `readyWhy`, `duplicateOf`; the fingerprint ignores them.
//   B. A double-text (same amount + payee within 10 minutes) is flagged; a far-apart or
//      different-amount one is not; ready is false when a duplicate is suspected.
//   C. Home's `homeExtra`: todayCount, usualDay, last7, prevSamePoint, watch.
//   D. A failure inside homeExtra gives null and never throws.
// All data is invented. Run with: node backend/tests/homePendingMakeover.test.js

const { makeWorld, assert } = require("./_fakeSheetsKit");

const FILES = [
  "category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js",
  "investmentInstruments.js", "savingsGoals.js", "planner.js", "PWA.js", "Recon.js", "Logger.js", "transactions.js", "autoSettle.js", "v2route.js", "flags.js", "v2db.js"
];
const HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source",
  "RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName"];

// Dates built from today's real calendar date so "today" lines up with the code under test.
const now = new Date();
const dayAt = (n) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 0, 0, 0); return d; };

function row(o){
  const r = new Array(19).fill("");
  r[0] = o.date || dayAt(1); r[1] = o.time || "10:00:00"; r[2] = o.bank || "TESTBANK"; r[3] = o.type || "debit"; r[4] = o.mode || "upi";
  r[5] = o.amount === undefined ? 20 : o.amount; r[6] = o.ref || ""; r[7] = o.cp === undefined ? "SHOP" : o.cp; r[12] = o.note || ""; r[13] = o.cat || "Food";
  r[15] = o.processed === undefined ? "YES" : o.processed; r[16] = o.nws || "";
  return r;
}

function world(rows, extra){
  const w = makeWorld(FILES);
  w.addSheet("Transactions", [HEADER].concat(rows));
  w.addSheet("FinancialEvents", [["Type","Amount","Counterparty","Confirmed","Name"]]);
  w.addSheet("Investments", [["Date","Name","Amount","Note"]]);
  w.addSheet("SmartMemory", [["Merchant","Category","Subcategory","Confidence","TimesUsed","LastUsed"]].concat((extra && extra.smart) || []));
  w.addSheet("TypeVotes", [["Merchant","AmountBand","Type","Timestamp"]].concat((extra && extra.votes) || []));
  w.addSheet("NoteMemory", [["Merchant","AmountBand","Note","TimesUsed","LastUsed"]].concat((extra && extra.notes) || []));
  w.addSheet("AILogs", [["Timestamp","Type","Message"]]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"]].concat((extra && extra.cash) || []));
  if(extra && extra.budgets) w.addSheet("Budgets", [["Month","Category","Type","Target"]].concat(extra.budgets));
  return w;
}

console.log("\n--- A/B. Pending: ready, readyWhy, duplicateOf ---");
{
  const band = (() => { const w0 = world([]); return w0.sb.getAmountBand(20); })();
  const smart = [["SHOP","Food","",100,5,new Date()], ["LONELY","Other","",100,5,new Date()]];
  const votes = [1,2,3,4,5].map(() => ["SHOP", band, "Need", new Date()]);
  const notes = [["SHOP", band, "Groceries", 4, new Date()], ["TWIN", band, "Snack", 3, new Date()]];
  smart.push(["TWIN","Food","",100,5,new Date()]);
  const rows = [
    row({ cp: "SHOP", time: "09:00:00", date: dayAt(3) }),                                  // row 2: ready, no twin
    row({ cp: "TWIN", time: "12:00:00", date: dayAt(2) }),                                  // row 3: double-text pair
    row({ cp: "twin ", time: "12:07:00", date: dayAt(2) }),                                 // row 4: same payee 7 min later
    row({ cp: "LONELY", time: "13:00:00", date: dayAt(2) }),                                // row 5: category Other, no note -> not ready
    row({ cp: "SHOP", time: "14:00:00", date: dayAt(2), amount: 20 }),                      // row 6: same as row 2 but a different day -> no dup
    row({ cp: "SHOP", time: "15:00:00", date: dayAt(2), amount: 20, processed: "IGNORED" }),// row 7: ignored, must not count
    row({ cp: "SHOP", time: "15:05:00", date: dayAt(2), amount: 20 }),                      // row 8: only an IGNORED neighbour -> no dup
    row({ cp: "SHOP", time: "16:00:00", date: dayAt(2), amount: 21 }),                      // row 9: different amount
    row({ cp: "SHOP", time: "16:30:00", date: dayAt(2), amount: 20 }),                      // row 10: 30 min from nothing
    row({ cp: "", mode: "wallet", bank: "PAYZAPP", time: "18:00:00", date: dayAt(2), amount: 46 }), // row 11 wallet pair
    row({ cp: "", mode: "wallet", bank: "PAYZAPP", time: "18:09:00", date: dayAt(2), amount: 46 }), // row 12
    row({ cp: "", mode: "upi", bank: "PAYZAPP", time: "18:05:00", date: dayAt(2), amount: 46 }),    // row 13: other mode -> not a twin
  ];
  const w = world(rows, { smart, votes, notes });
  const data = w.sheets.Transactions.rows;
  const fpBefore = data.slice(1).map((r) => w.sb.rowFingerprint_(r));
  const p = w.sb.getPendingTransactions(data);
  const by = {}; p.forEach((t) => { by[t.row] = t; });

  assert(by[2].ready === true && by[2].duplicateOf === null, "a remembered merchant with note + category + type is ready");
  assert(by[2].readyWhy === "Same as the last 4 times", "readyWhy uses the real count from NoteMemory (got '" + by[2].readyWhy + "')");
  assert(by[3].duplicateOf && by[3].duplicateOf.row === 4 && by[3].duplicateOf.minutesApart === 7, "double-text found (row 3 -> 4, 7 min)");
  assert(by[4].duplicateOf && by[4].duplicateOf.row === 3 && by[4].duplicateOf.minutesApart === 7, "double-text is symmetric, payee compared case/space-insensitively");
  assert(by[3].ready === false && by[4].ready === false, "a suspected double-text is never ready");
  assert(Number.isInteger(by[3].duplicateOf.minutesApart), "minutesApart is a whole number");
  assert(by[5].ready === false, "category 'Other' / no note -> not ready");
  assert(by[6].duplicateOf === null, "same payee+amount hours apart is not a duplicate");
  assert(by[8].duplicateOf === null, "an IGNORED neighbour is not a duplicate");
  assert(by[9].duplicateOf === null, "different amount is not a duplicate");
  assert(by[11].duplicateOf && by[11].duplicateOf.row === 12, "no payee: same mode+bank within 10 minutes is a duplicate");
  assert(by[13].duplicateOf === null, "no payee: a different mode is not a twin (and not an Rs.46 wallet row 4 minutes away that is farther than the pair rule)");
  const fpAfter = data.slice(1).map((r) => w.sb.rowFingerprint_(r));
  assert(JSON.stringify(fpBefore) === JSON.stringify(fpAfter), "fingerprints depend only on the sheet row, so the new fields cannot change them");
  assert(p.every((t) => t.fp === w.sb.rowFingerprint_(data[t.row - 1])), "each item's fp is still the row fingerprint");
}

console.log("\n--- A2. Credits, financial events, speed ---");
{
  const w0 = world([]);
  const band = w0.sb.getAmountBand(20);
  const smart = [["REFUNDER","Shopping","",100,5,new Date()]];
  const notes = [["REFUNDER", band, "Refund", 2, new Date()]];
  const w = world([row({ type: "credit", cp: "REFUNDER" })], { smart, notes });
  const p = w.sb.getPendingTransactions(w.sheets.Transactions.rows);
  assert(p[0].ready === true && p[0].readyWhy === "Same as the last 2 times", "a credit with a note + category is ready");

  // a debit where a Rent/EMI/SIP-looking guess exists but is not confident -> not ready
  const w2 = world([row({ cp: "SHOP" })], { smart: [["SHOP","Food","",100,5,new Date()]], notes: [["SHOP", band, "x", 3, new Date()]],
    votes: [1,2,3,4,5].map(() => ["SHOP", band, "Need", new Date()]) });
  const t = w2.sb.getPendingTransactions(w2.sheets.Transactions.rows)[0];
  assert(t.ready === true, "baseline debit is ready");
  const verdict = w2.sb.computePendingReady_(Object.assign({}, t, { suggestedFinancialEvent: "EMI", financialEventConfident: true, suggestedFinancialEventName: null }), { timesUsed: 3 });
  assert(verdict.ready === false, "a confident EMI guess with no name is not ready");
  assert(w2.sb.computePendingReady_(Object.assign({}, t, { investmentInstrumentLooksNew: true }), { timesUsed: 3 }).ready === false, "'looks like a new investment' is not ready");
  assert(w2.sb.computePendingReady_(Object.assign({}, t, { suggestedType: null, isNonSpendTransfer: false }), { timesUsed: 3 }).ready === false, "no type guess -> not ready");
  assert(w2.sb.computePendingReady_(Object.assign({}, t, { suggestedFinancialEvent: "Rent", financialEventConfident: false }), { timesUsed: 3 }).ready === false, "an unsure Rent guess -> not ready");
  assert(w2.sb.computePendingReady_(Object.assign({}, t, { duplicateOf: { row: 9, minutesApart: 2 } }), { timesUsed: 3 }).ready === false, "duplicate -> not ready");

  // speed: 1000 rows, 10 pending
  const many = [];
  for(let i = 0; i < 1000; i++) many.push(row({ cp: "M" + (i % 50), amount: 10 + (i % 90), processed: "YES", note: "n", time: "10:" + String(i % 60).padStart(2, "0") + ":00" }));
  for(let i = 0; i < 10; i++) many.push(row({ cp: "P" + i, amount: 10 + i, note: "" }));
  const w3 = world(many);
  const t0 = Date.now();
  const res = w3.sb.getPendingTransactions(w3.sheets.Transactions.rows);
  assert(res.length === 10 && Date.now() - t0 < 2000, "1000 rows x 10 pending is fast (" + (Date.now() - t0) + " ms)");
}

console.log("\n--- C. homeExtra ---");
{
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const mk = (n, amt, extra) => row(Object.assign({ date: dayAt(n), amount: amt, cp: "S" + n, note: "n", cat: "Food" }, extra || {}));
  // today: 2 payments (one is a credit-card bill payment -> excluded; one is a loan -> excluded)
  const rows = [mk(0, 100), mk(0, 50), mk(0, 999, { cp: "SOMEONE", note: "lent to raj" })];
  for(let n = 1; n <= 40; n++) rows.push(mk(n, 100));          // 100 every day for 40 days back
  const cash = [[1, dayAt(0), "10:00", "debit", 30, "tea", "Food"]];
  const budgets = [];
  const mkey = y + "-" + String(m).padStart(2, "0");
  const w = world(rows, { cash, budgets: [
    [mkey, "Food", "", 100],            // actual today+this month >> target -> watch (>=0.85)
    [mkey, "Bills", "Need", 5000], [mkey, "Bills", "Want", 5000],   // split: target 10000, actual 0 -> not watched
    [mkey, "_Income", "", 1],           // pseudo row ignored
    ["1999-01", "Food", "", 1],         // other month ignored
  ]});
  const data = w.sheets.Transactions.rows, cd = w.sheets.Cash.rows;
  const today = w.sb.getTodaySummary(data, cd);
  const month = w.sb.getMonthlyAnalysis(y, m, data, cd);
  const ex = w.sb.buildHomeExtra_(now, today, month, data, cd, w.sb.dbSs_());
  assert(ex && ex.todayCount === 3, "todayCount = 2 bank (lent one excluded) + 1 cash = 3 (got " + (ex && ex.todayCount) + ")");
  assert(today.total === 180, "sanity: today's spend is 100+50+30 (loan excluded)");
  assert(ex.last7.length === 7 && ex.last7[6].amount === 180, "last7 ends with today's total");
  assert(ex.last7[5].amount === 100 && ex.last7[0].amount === 100, "earlier days use the daily totals (100 each)");
  assert(/^[A-Z][a-z]{2}$/.test(ex.last7[0].label) && /^\d{4}-\d{2}-\d{2}$/.test(ex.last7[0].date), "label/date shapes");
  const todayStr = w.sb.Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
  assert(ex.last7[6].date === todayStr, "last item's date is today (" + todayStr + ")");
  assert(ex.usualDay === 100, "usualDay = 100 average over the last 28 completed days (got " + ex.usualDay + ")");
  assert(Array.isArray(ex.watch) && ex.watch.length === 1 && ex.watch[0].category === "Food" && ex.watch[0].target === 100, "Food is on watch; split Bills (0 spent), pseudo row and old month are not");
  assert(ex.watch[0].actual === month.categories.filter((c) => c.category === "Food")[0].amount, "watch actual = month.categories amount");
  const dim = new Date(y, m - 1, 0).getDate();
  let expPrev = 0;
  for(let n = 1; n <= 40; n++){ const d = dayAt(n); if(d.getMonth() + 1 === (m === 1 ? 12 : m - 1) && d.getDate() <= now.getDate()) expPrev += 100; }
  assert(ex.prevSamePoint === (expPrev > 0 ? expPrev : null), "prevSamePoint = last month day 1..today's date (" + expPrev + "), got " + ex.prevSamePoint);

  // young account -> usualDay null
  const w2 = world([mk(0, 10), mk(2, 10)]);
  const d2 = w2.sheets.Transactions.rows, c2 = w2.sheets.Cash.rows;
  const e2 = w2.sb.buildHomeExtra_(now, w2.sb.getTodaySummary(d2, c2), w2.sb.getMonthlyAnalysis(y, m, d2, c2), d2, c2, w2.sb.dbSs_());
  assert(e2.usualDay === null, "fewer than 7 days of history -> usualDay null");
  assert(e2.watch.length === 0, "no Budgets sheet -> watch is []");
  assert(e2.prevSamePoint === null || typeof e2.prevSamePoint === "number", "prevSamePoint is a number or null");

  console.log("\n--- D. failures never break the dashboard ---");
  assert(w.sb.buildHomeExtra_(now, null, month, data, cd, w.sb.dbSs_()) !== undefined, "bad input does not throw");
  const realSession = w.sb.Session;
  w.sb.Session = { getScriptTimeZone: function(){ throw new Error("boom"); } };
  let bad;
  try{ bad = w.sb.buildHomeExtra_(now, today, month, data, cd, w.sb.dbSs_()); }catch(e){ bad = "threw"; }
  w.sb.Session = realSession;
  assert(bad === null, "a total failure gives null, not an exception");
}

console.log("\nAll home/pending makeover checks passed.");
