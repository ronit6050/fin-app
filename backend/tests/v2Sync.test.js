// backend/tests/v2Sync.test.js
//
// Plain-English what this checks: the Apps Script job that mirrors the Google Sheet into the owner's private
// Firestore folder (v2Sync.js). Big promises:
//   1. It builds EXACTLY the documents the verified Python copy tool builds (proved on a real backup of the
//      Sheet, when one is on this computer; skipped otherwise).
//   2. Its first run ADOPTS what is already in Firestore and never writes duplicates, even if the two
//      languages disagreed about ids.
//   3. It only writes what changed, never deletes in bulk, can't run twice at once, recovers from a failure,
//      backs off by itself if slow, and can never break the background timer. All data here is invented.
// Run with: node backend/tests/v2Sync.test.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { makeWorld, assert } = require("./_fakeSheetsKit");

const OWNER = "ronitnadar9@gmail.com";
const IST_MIN = 330;

// ---- a faithful-enough Apps Script world -------------------------------------------------
function world(){
  const w = makeWorld(["Logger.js", "firestore.js", "PWA.js", "appHealth.js", "v2Sync.js"]);
  const sb = w.sb;
  w.addSheet("AILogs", [["Timestamp", "Type", "Message"]]);
  sb.V2SYNC_ENABLED_ = true;                  // the live switch is OFF (see v2Sync.js); the tests exercise the code with it on
  const pad = function(n, l){ return String(n).padStart(l || 2, "0"); };
  // India time formatting for the few patterns the sync uses
  sb.Utilities.formatDate = function(d, tz, fmt){
    const t = new Date(new Date(d).getTime() + IST_MIN * 60000);
    const map = { yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()),
                  mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()), SSS: pad(t.getUTCMilliseconds(), 3) };
    return fmt.replace(/yyyy|MM|dd|HH|mm|ss|SSS/g, function(k){ return map[k]; }).replace(/'T'/g, "T");
  };
  w.cache = {};
  sb.CacheService = { getScriptCache: function(){ return {
    get: function(k){ return Object.prototype.hasOwnProperty.call(w.cache, k) ? w.cache[k] : null; },
    put: function(k, v){ w.cache[k] = String(v); }, remove: function(k){ delete w.cache[k]; } }; } };
  w.lockBusy = false;
  sb.LockService = { getScriptLock: function(){ return { tryLock: function(){ return !w.lockBusy; }, releaseLock: function(){} }; } };

  // A fake Firestore: just remembers documents, and can be told to fail.
  w.store = {};
  w.commits = [];
  w.failOnCommit = 0;                         // fail the Nth commit from now (1 = the next one)
  sb.fsCommit_ = function(ops){
    w.commits.push(ops.length);
    if(w.failOnCommit && --w.failOnCommit === 0){ throw new Error("simulated Firestore failure"); }
    ops.forEach(function(op){
      if(op.set) w.store[op.set.path] = sb.fsEncodeFields_(op.set.fields);
      else if(op.del) delete w.store[op.del.path];
    });
    return true;
  };
  sb.fsListPath_ = function(collectionPath){
    return Object.keys(w.store).filter(function(p){ return p.indexOf(collectionPath + "/") === 0 && p.slice(collectionPath.length + 1).indexOf("/") === -1; })
      .map(function(p){ return { id: p.split("/").pop(), fields: {}, raw: w.store[p] }; });
  };
  sb.fsFlushUsage_ = function(){};
  w.errors = function(type){ return w.sheets.AILogs.rows.slice(1).filter(function(r){ return r[1] === type; }); };
  return w;
}

const TXN_HEADER = ["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","Channel","Source","RawSMS","Sender","Note","Category","TelegramMsgID","Processed","NeedWantSaving","FinancialEvent","FinancialEventName","AutoSettled"];
function istDate(y, mo, d, h, mi, s){ return new Date(Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0) - IST_MIN * 60000); }
function txn(day, amount, ref, cp, o){
  o = o || {};
  return [istDate(2026, 10, day), istDate(1899, 12, 30, 10, 30, 0), "HDFC", o.type || "debit", "upi", amount, ref, cp, "SMS", "Tasker", "raw", "HDFCBK", o.note || "", o.category || "Food", "", "YES", "Want", "", "", ""];
}

// ---------------------------------------------------------------- 1. converters
console.log("\n--- 1. Converters ---");
{
  const w = world(), sb = w.sb;
  assert(sb.v2Paise_(19.99) === 1999 && sb.v2Paise_(0.1 + 0.2) === 30, "19.99 -> 1999 paise and 0.1+0.2 -> 30 (no floating-point drift)");
  assert(sb.v2Paise_("1,234.50") === 123450 && sb.v2Paise_("") === 0 && sb.v2Paise_(null) === 0 && sb.v2Paise_("abc") === 0, "text amounts, blanks and junk");
  assert(sb.v2Paise_(2.675) === 268 && sb.v2Paise_(-1.005) === -101 && sb.v2Paise_(8728) === 872800 && sb.v2Paise_(-50) === -5000, "half-paisa rounds away from zero, whole and negative amounts");
  assert(sb.v2Paise_(1e-7) === 0 && sb.v2Paise_(12345678901.5) === 1234567890150, "tiny and large numbers");
  assert(sb.v2DateStr_(46082) === "2026-03-01" && sb.v2DateStr_(46082.9) === "2026-03-01", "a sheet day-number 46082 is 2026-03-01");
  assert(sb.v2DateStr_(istDate(2026, 10, 12, 23, 59, 59)) === "2026-10-12", "a date cell is read in India time");
  assert(sb.v2DateStr_("05/09/2026") === "2026-09-05" && sb.v2DateStr_("2026-09-05") === "2026-09-05" && sb.v2DateStr_("5 Sep 2026") === "2026-09-05", "text dates are read day-first");
  assert(sb.v2DateStr_("31/02/2026") === null && sb.v2DateStr_("nonsense") === null && sb.v2DateStr_("") === "", "an impossible/unreadable date is None, never guessed; blank stays blank");
  assert(sb.v2TimeStr_(0.7752430555555555) === "18:36:21" && sb.v2TimeStr_("09:05") === "09:05:00" && sb.v2TimeStr_("") === "00:00:00", "times from a day fraction, text and blank");
  assert(sb.v2TimeStr_(istDate(1899, 12, 30, 18, 36, 21)) === "18:36:21", "a time cell (a Date on 30 Dec 1899) reads back the same");
  assert(sb.v2TimeStr_(new Date(istDate(1899, 12, 30, 18, 36, 20).getTime() + 700)) === "18:36:21", "a time a few hundred ms short of the next second rounds to the nearest second");
  assert(sb.v2TimeStr_(0.99999999) === "23:59:59", "the last instant of a day never becomes 24:00:00");
  assert(sb.v2Ts_("2026-03-01", "00:30:00").toISOString() === "2026-02-28T19:00:00.000Z", "India 00:30 on 1 March is 19:00 UTC the day before");
  assert(sb.v2TsCell_(46244.55258185185).getTime() % 1000 === 0, "a date-time number becomes an exact moment on a whole second");
  assert(sb.v2Text_(753022182554) === "753022182554" && sb.v2Text_(12.5) === "12.5" && sb.v2Text_("  hi ") === "hi" && sb.v2Text_(null) === "", "text cleaning");
}

// ---------------------------------------------------------------- 2. one row
console.log("\n--- 2. One transaction row ---");
{
  const w = world(), sb = w.sb;
  const row = txn(11, 274.5, 753022182554, "ZEPTO", { note: "Zepto", category: "Groceries" });
  row[20] = 100;
  const m = sb.v2MapTransaction_(row);
  assert(m.doc.amountPaise === 27450 && m.doc.type === "debit" && m.doc.date === "2026-10-11" && m.doc.time === "10:30:00", "amount, type, date and time");
  assert(m.doc.reference === "753022182554" && m.doc.friendSharePaise === 10000 && m.id.length === 24, "reference keeps its digits; friend share carried; 24-character id");
  const edited = txn(11, 274.5, 753022182554, "ZEPTO", { note: "A different note", category: "Shopping" });
  assert(sb.v2MapTransaction_(edited).id === m.id, "editing the note or category does not change the id");
  assert(sb.v2MapTransaction_(txn(11, 275, 753022182554, "ZEPTO")).id !== m.id, "a different amount is a different transaction");
  assert(sb.v2MapTransaction_(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "IGNORED"]) === null, "an empty placeholder row is skipped");
  const rows = [TXN_HEADER, txn(11, 50, "", "SHOP"), txn(11, 50, "", "SHOP"), [], txn(12, 9, "r", "X")];
  const docs = sb.v2BuildDocs_(rows, sb.v2MapTransaction_, true);
  const ids = Object.keys(docs);
  assert(ids.length === 3 && ids.some(function(i){ return /-2$/.test(i); }), "two identical-looking rows are both kept (the second gets -2); blank rows skipped");
  const changed = Object.assign({}, docs[ids[0]], { note: "x" });
  assert(sb.v2HashDoc_(changed) !== sb.v2HashDoc_(docs[ids[0]]), "any change to a document changes its fingerprint");
  const reordered = {}; Object.keys(docs[ids[0]]).reverse().forEach(function(k){ reordered[k] = docs[ids[0]][k]; });
  assert(sb.v2HashDoc_(reordered) === sb.v2HashDoc_(docs[ids[0]]), "the fingerprint ignores field order");
}

// ---------------------------------------------------------------- 3. the real data, both languages
console.log("\n--- 3. The JavaScript sync equals the verified Python copy, on a real backup ---");
{
  const root = path.join(__dirname, "..", "..", "local-data", "backups");
  let folder = null;
  try{ const all = fs.readdirSync(root).filter(function(d){ return fs.existsSync(path.join(root, d, "manifest.json")); }).sort(); folder = all.length ? path.join(root, all[all.length - 1]) : null; }catch(e){}
  if(!folder){
    console.log("SKIP: no Sheet backup on this computer (local-data/backups), so the real-data comparison is skipped");
  } else {
    const out = path.join(require("os").tmpdir(), "v2_expected_" + process.pid + ".json");
    execFileSync("python", [path.join(__dirname, "..", "..", "tools", "v2_dump_expected.py"), folder, out], { stdio: "pipe" });
    const expected = JSON.parse(fs.readFileSync(out, "utf8"));
    fs.unlinkSync(out);

    const w = world(), sb = w.sb;
    // Which columns of each tab the real Sheet shows as dates/times (Apps Script hands those over as Date objects)
    const DATECOLS = { Transactions: [0, 1], Transactions_Ignored: [0, 1], Cash: [1, 2, 9], Debts: [0, 5, 7], Savings: [0], Goals: [5],
                       Investments: [0], InvestmentInstruments: [], FinancialEvents: [3], Budgets: [0], SmartMemory: [5], NoteMemory: [4], TypeVotes: [3], LearnedSpamPatterns: [0] };
    const toDate = function(serial){ return new Date(Date.UTC(1899, 11, 30) + serial * 86400000 - IST_MIN * 60000); };
    Object.keys(DATECOLS).forEach(function(tab){
      const f = path.join(folder, tab + ".raw.json");
      if(!fs.existsSync(f)) return;
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      const rows = (Array.isArray(d) ? d : d.values).map(function(r){
        return r.map(function(v, ci){ return (DATECOLS[tab].indexOf(ci) >= 0 && typeof v === "number" && v > 0) ? toDate(v) : v; });
      });
      w.addSheet(tab, rows);
    });
    const built = sb.v2BuildAll_();
    let totalDocs = 0; const mismatches = [];
    const isDate = function(x){ return Object.prototype.toString.call(x) === "[object Date]"; };
    Object.keys(expected).forEach(function(coll){
      const want = expected[coll], got = built[coll] || {};
      totalDocs += Object.keys(want).length;
      Object.keys(want).forEach(function(id){
        if(!got[id]){ mismatches.push(coll + " missing " + id); return; }
        const a = got[id].doc, b = want[id];
        Object.keys(b).forEach(function(k){
          const av = isDate(a[k]) ? a[k].toISOString().slice(0, 19) : a[k];
          if(av !== b[k] && !(av === null && b[k] === null)) mismatches.push(coll + "." + k + " differs in " + id);
        });
        Object.keys(a).forEach(function(k){ if(!(k in b)) mismatches.push(coll + "." + k + " extra in " + id); });
      });
      Object.keys(got).forEach(function(id){ if(!want[id]) mismatches.push(coll + " extra doc " + id); });
    });
    assert(totalDocs > 1000, "compared " + totalDocs + " real documents across " + Object.keys(expected).length + " collections");
    assert(mismatches.length === 0, "JavaScript and Python build identical documents, ids and values for every row" + (mismatches.length ? " (first problems: " + mismatches.slice(0, 5).join("; ") + ")" : ""));
  }
}

// ---------------------------------------------------------------- 4. the sync behaviour
console.log("\n--- 4. Syncing: only what changed ---");
{
  const w = world(), sb = w.sb;
  const tx = w.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "SHOP A"), txn(10, 200, "r2", "SHOP B"), txn(11, 300, "r3", "SHOP C")]);
  w.addSheet("Cash", [["ID","Date","Time","Type","Amount","Note","Category"], ["", istDate(2026, 10, 10), "", "Debit", 20, "Water", "Bills"]]);
  w.addSheet("Debts", [["Date","Person","Type","Amount","Note","DueDate","Status","SettledDate"], [istDate(2026, 10, 1), "Raj", "LENT", 500, "x", "", "Pending", ""]]);

  const r1 = sb.v2SyncSheetToFirestore_({});
  assert(r1.written === 5 && r1.deleted === 0, "the first run (empty Firestore) writes everything (3 transactions + 1 cash + 1 debt)");
  assert(Object.keys(w.store).every(function(p){ return p.indexOf("users/" + OWNER + "/") === 0; }), "everything lands in the owner's own folder");
  assert(Object.keys(w.store).every(function(p){ return /^users\/[^/]+\/(transactions|cash|debts)\/[0-9a-f]{24}$/.test(p); }), "only the sync's own collections are written (never friends, splitMarkers, debtMoves or views)");
  assert(w.sheets._V2Sync && w.sheets._V2Sync.rows.length === 5 && w.sheets._V2Sync.hidden === true, "the fingerprints are remembered in a hidden _V2Sync tab");

  const r2 = sb.v2SyncSheetToFirestore_({});
  assert(r2.written === 0 && r2.deleted === 0 && r2.unchanged === 5 && w.commits.length === 1, "an immediate second run writes nothing (no Firestore request at all)");

  tx.rows[1][12] = "Lunch";                                           // edit a note
  const r3 = sb.v2SyncSheetToFirestore_({});
  assert(r3.written === 1 && r3.deleted === 0, "editing one note writes exactly one document");
  const noteDoc = Object.keys(w.store).map(function(p){ return sb.fsDecodeFields_(w.store[p]); }).find(function(d){ return d.note === "Lunch"; });
  assert(noteDoc && noteDoc.counterparty === "SHOP A", "...and the new note is in Firestore");

  tx.rows[2][5] = 250;                                               // change an amount: a different transaction id
  const r4 = sb.v2SyncSheetToFirestore_({});
  assert(r4.written === 1 && r4.deleted === 1 && Object.keys(w.store).length === 5, "changing an amount replaces the document (one written, the old one deleted), no duplicate left behind");

  tx.rows.push(txn(12, 40, "r4", "SHOP D"));                          // a new SMS arrives
  const r5 = sb.v2SyncSheetToFirestore_({});
  assert(r5.written === 1 && r5.deleted === 0 && Object.keys(w.store).length === 6, "a new transaction adds one document");

  tx.rows.splice(1, 1);                                              // a row disappears
  const r6 = sb.v2SyncSheetToFirestore_({});
  assert(r6.deleted === 1 && Object.keys(w.store).length === 5, "a row that is gone from the Sheet is removed from Firestore");

  w.lockBusy = true;
  assert(sb.v2SyncSheetToFirestore_({}).skipped === "busy", "two runs can never overlap (the second just stands down)");
  w.lockBusy = false;
}

console.log("\n--- 5. Safety guards ---");
{
  const w = world(), sb = w.sb;
  const rows = [TXN_HEADER];
  for(let i = 1; i <= 100; i++) rows.push(txn(1 + (i % 28), 10 + i, "ref" + i, "SHOP " + i));
  const tx = w.addSheet("Transactions", rows);
  sb.v2SyncSheetToFirestore_({});
  assert(Object.keys(w.store).length === 100, "setup: 100 documents synced");

  const saved = tx.rows.slice();
  tx.rows.splice(11);                                                // the Sheet suddenly "loses" 90 rows
  const drop = sb.v2SyncSheetToFirestore_({});
  assert(drop.skipped === "row-drop-guard" && Object.keys(w.store).length === 100, "a sudden big drop in rows is treated as a read problem: nothing is deleted");
  assert(w.errors("V2SYNC_ERROR").length === 1, "...and it is logged for the health check");

  tx.rows.length = 0; saved.slice(0, 71).forEach(function(r){ tx.rows.push(r); });   // 30 rows gone, over the limit
  delete w.cache.V2SYNC_ERR_LOGGED;                                  // (the log is limited to once an hour; start a fresh hour)
  const before = w.errors("V2SYNC_ERROR").length;
  const mass = sb.v2SyncSheetToFirestore_({});
  assert(mass.deleted === 0 && Object.keys(w.store).length === 100 && w.errors("V2SYNC_ERROR").length === before + 1, "deleting 30 documents at once is refused and logged");

  tx.rows.length = 0; saved.slice(0, 91).forEach(function(r){ tx.rows.push(r); });   // 10 rows gone: within limits
  const ok = sb.v2SyncSheetToFirestore_({});
  assert(ok.deleted === 10 && Object.keys(w.store).length === 90, "a small clean-up (10 rows) is applied");
}

console.log("\n--- 6. Recovery and the timer hook ---");
{
  const w = world(), sb = w.sb;
  const rows = [TXN_HEADER];
  for(let i = 1; i <= 700; i++) rows.push(txn(1 + (i % 28), 10 + i, "ref" + i, "SHOP " + i));
  w.addSheet("Transactions", rows);
  w.failOnCommit = 2;                                                // the second batch of 300 fails
  const bad = sb.v2SyncSheetToFirestore_({});
  assert(bad.error && /simulated/.test(bad.error) && Object.keys(w.store).length === 300, "a failure part-way is reported, with the first batch safely written");
  const fixed = sb.v2SyncSheetToFirestore_({});
  assert(fixed.written === 400 && Object.keys(w.store).length === 700 && !fixed.error, "the next run finishes exactly the missing 400 (no repeats, no gaps)");

  // The timer hook never throws, is throttled, and stays quiet about the daily safety limit
  const w2 = world(), sb2 = w2.sb;
  w2.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "A")]);
  assert(sb2.v2SyncIfDue_() === true && Object.keys(w2.store).length === 1, "the timer hook syncs");
  w2.sheets.Transactions.rows.push(txn(11, 5, "r9", "B"));
  assert(sb2.v2SyncIfDue_() === false && Object.keys(w2.store).length === 1, "...but not again within 10 minutes");
  delete w2.cache.V2SYNC_RECENT;
  sb2.fsCommit_ = function(){ const e = new Error("Firestore daily safety limit reached"); e.safetyLimit = true; throw e; };
  sb2.v2SyncIfDue_();
  assert(w2.errors("V2SYNC_ERROR").length === 0, "hitting the daily Firestore safety limit is not logged as a fault");
  delete w2.cache.V2SYNC_RECENT;
  sb2.fsCommit_ = function(){ throw new Error("boom"); };
  let threw = false;
  try{ sb2.v2SyncIfDue_(); }catch(e){ threw = true; }
  assert(!threw && w2.errors("V2SYNC_ERROR").length === 1, "any other failure is logged once and never escapes into the timer");
  delete w2.cache.V2SYNC_RECENT; delete w2.cache.V2SYNC_ERR_LOGGED;
  w2.sb.PropertiesService = undefined;
  let threw2 = false;
  try{ sb2.v2SyncIfDue_(); }catch(e){ threw2 = true; }
  assert(!threw2, "even a broken environment cannot throw out of the hook");
  const w3 = world();
  w3.sb.V2SYNC_ENABLED_ = false;
  w3.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "A")]);
  assert(w3.sb.v2SyncIfDue_() === false && Object.keys(w3.store).length === 0, "the switch V2SYNC_ENABLED_ = false stops it completely");
}

console.log("\n--- 7. The daily self-check ---");
{
  const w = world(), sb = w.sb;
  w.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "A"), txn(11, 200, "r2", "B")]);
  const v = sb.v2VerifyShadow_();
  assert(v.ok === true && v.missing === 0 && v.extra === 0 && v.different === 0, "after a sync, the copy matches the Sheet");
  const path0 = Object.keys(w.store)[0];
  w.store[path0].note = { stringValue: "tampered" };
  const v2 = sb.v2VerifyShadow_();
  assert(v2.ok === false && v2.different === 1 && v2.repaired === 1 && w.errors("V2SYNC_MISMATCH").length === 1, "a document changed behind the sync's back is spotted, logged and put right");
  assert(sb.fsDecodeFields_(w.store[path0]).note !== "tampered", "...the tampered value is gone");
  delete w.store[Object.keys(w.store)[1]];
  const v2b = sb.v2VerifyShadow_();
  assert(v2b.missing === 1 && v2b.repaired === 1 && Object.keys(w.store).length === 2, "a document that went missing is put back");
  w.store["users/" + OWNER + "/transactions/extradoc"] = sb.fsEncodeFields_({ note: "stray" });
  const v3 = sb.v2VerifyShadow_();
  assert(v3.ok === false && v3.extra === 1 && v3.repaired === 1 && !w.store["users/" + OWNER + "/transactions/extradoc"], "a stray document the Sheet doesn't imply is reported and removed");
  assert(sb.v2VerifyShadow_().ok === true, "after the repairs, the next check is clean");
  assert(sb.HEALTH_ERROR_LOG_TYPES.indexOf("V2SYNC_MISMATCH") !== -1 && sb.HEALTH_ERROR_LOG_TYPES.indexOf("V2SYNC_ERROR") !== -1, "the daily health check watches both V2SYNC log types");
  assert(sb.v2VerifyShadowIfDue_() !== undefined, "(sanity) the once-a-day wrapper runs");
  assert(sb.v2VerifyShadowIfDue_() === null, "...and not a second time the same day");
}

console.log("\n--- 8. The built-in SHA-1 equals the real one (so ids still match the Python copy) ---");
{
  const w = world(), sb = w.sb;
  const samples = ["", "a", "abc", "2026-10-12|18:36:21|debit|HDFC|753022182554|ZEPTO MARKETPLACE|27450", "Rs ₹ 500 — café 😀 emoji",
                   "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "y".repeat(1000), "line1\nline2\ttab"];
  let allSame = true;
  samples.forEach(function(sm){ if(sb.v2Sha1Hex_(sm) !== crypto.createHash("sha1").update(sm, "utf8").digest("hex")) allSame = false; });
  assert(allSame, "SHA-1 matches the real thing for " + samples.length + " inputs, including empty, unicode, emoji and the 55/56/63/64/65-byte edges");
  let fuzz = true;
  for(let i = 0; i < 300; i++){
    let str = ""; const len = Math.floor(Math.random() * 200);
    for(let j = 0; j < len; j++) str += String.fromCharCode(32 + Math.floor(Math.random() * 3000));
    if(sb.v2Sha1Hex_(str) !== crypto.createHash("sha1").update(str, "utf8").digest("hex")) fuzz = false;
  }
  assert(fuzz, "...and for 300 random strings");
}

console.log("\n--- 9. First run: adopt what is already in Firestore, never write duplicates ---");
{
  const rows = [TXN_HEADER];
  for(let i = 1; i <= 100; i++) rows.push(txn(1 + (i % 28), 10 + i, "ref" + i, "SHOP " + i));
  const fresh = function(){ const w = world(); w.addSheet("Transactions", rows.map(function(r){ return r.slice(); })); return w; };
  // Pretend the Python copy already wrote the right documents
  const seed = function(w){ const built = w.sb.v2BuildAll_(); Object.keys(built.transactions).forEach(function(id){ w.store["users/" + OWNER + "/transactions/" + id] = w.sb.fsEncodeFields_(built.transactions[id].doc); }); return Object.keys(w.store).length; };

  const a = fresh(); const n = seed(a);
  const ra = a.sb.v2SyncSheetToFirestore_({});
  assert(n === 100 && ra.written === 0 && ra.deleted === 0 && a.commits.length === 0, "an identical existing copy is adopted: nothing is written or deleted, not even one request");
  assert(a.sheets._V2Sync && a.sheets._V2Sync.rows.length === 100, "...and the fingerprints are remembered, so later runs only write changes");
  a.sheets.Transactions.rows[3][12] = "edited";
  assert(a.sb.v2SyncSheetToFirestore_({}).written === 1, "after adopting, an edit writes exactly one document");

  const b = fresh();                                             // nothing in Firestore yet: a normal first run
  const rb = b.sb.v2SyncSheetToFirestore_({});
  assert(rb.written === 100 && Object.keys(b.store).length === 100, "an empty Firestore is simply filled");

  const c = fresh(); seed(c);                                    // one document missing, 3 strays: repaired quietly
  delete c.store[Object.keys(c.store)[0]];
  ["s1", "s2", "s3"].forEach(function(id){ c.store["users/" + OWNER + "/transactions/" + id] = c.sb.fsEncodeFields_({ note: "stray" }); });
  const rc = c.sb.v2SyncSheetToFirestore_({});
  assert(rc.written === 1 && rc.deleted === 3 && Object.keys(c.store).length === 100, "a small gap is filled and strays are removed");

  const d = fresh();                                             // the ids DISAGREE (e.g. time cells read differently): stop, write nothing
  const built = d.sb.v2BuildAll_();
  Object.keys(built.transactions).forEach(function(id){ d.store["users/" + OWNER + "/transactions/zz" + id.slice(2)] = d.sb.fsEncodeFields_(built.transactions[id].doc); });
  const beforeKeys = JSON.stringify(Object.keys(d.store).sort());
  const rd = d.sb.v2SyncSheetToFirestore_({});
  assert(rd.skipped === "bootstrap-mismatch" && d.commits.length === 0 && JSON.stringify(Object.keys(d.store).sort()) === beforeKeys, "if the ids disagree wholesale it writes NOTHING and deletes NOTHING (no duplicates, ever)");
  assert(!d.sheets._V2Sync || d.sheets._V2Sync.rows.length === 0, "...and it remembers nothing from that attempt");
  const msgs = d.errors("V2SYNC_ERROR");
  assert(msgs.length === 1 && /first run stopped/.test(msgs[0][2]) && /time 10:30:00/.test(msgs[0][2]), "the log says why, including how a sample row's time was read (so a time-zone problem is obvious)");

  const e = fresh(); seed(e);                                    // a mild mismatch (4 of 100 different) is repaired, not refused
  Object.keys(e.store).slice(0, 4).forEach(function(p){ e.store[p].note = { stringValue: "old" }; });
  const re = e.sb.v2SyncSheetToFirestore_({});
  assert(re.written === 4 && re.skipped === undefined, "a few differing documents are rewritten (under the 5% line)");
}

console.log("\n--- 10. Lock safety and timer back-off ---");
{
  const w = world(), sb = w.sb;
  w.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "A")]);
  let released = 0;
  sb.LockService = { getScriptLock: function(){ return { tryLock: function(){ return true; }, releaseLock: function(){ released++; } }; } };
  sb.v2LoadState_ = function(){ throw new Error("could not read the state tab"); };
  const r = sb.v2SyncSheetToFirestore_({});
  assert(r.error && released === 1, "even if reading the remembered state fails, the lock is always released");

  const w2 = world(), sb2 = w2.sb;
  w2.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "A")]);
  sb2.__clock = 1000000;
  require("vm").runInContext("Date.now = function(){ return __clock; }", sb2);                       // a controllable clock inside the fake Apps Script
  const realSync = sb2.v2SyncSheetToFirestore_;
  sb2.v2SyncSheetToFirestore_ = function(o){ const x = realSync(o); sb2.__clock += 90000; return x; };     // a slow (90 s) run
  sb2.v2SyncIfDue_();
  assert(w2.props.V2SYNC_GAP === "1800" && w2.errors("V2SYNC_ERROR").some(function(r2){ return /every 30 minutes/.test(r2[2]); }), "a run that takes over a minute moves the job to every 30 minutes and logs it");
  assert(w2.cache.V2SYNC_RECENT === "1", "(the pause between runs is in force)");
  const w3 = world();
  w3.addSheet("Transactions", [TXN_HEADER, txn(10, 100, "r1", "A")]);
  w3.lockBusy = true;
  w3.sb.v2SyncIfDue_();
  assert(w3.cache.V2SYNC_RECENT === undefined, "if another run was busy, it is allowed to try again soon (not locked out for 10 minutes)");
}

process.exitCode = process.exitCode || 0;
