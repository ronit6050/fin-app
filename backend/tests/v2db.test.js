// backend/tests/v2db.test.js
//
// Plain-English what this checks: the "virtual spreadsheet" (v2db.js) whose tabs live in a person's private
// Firestore folder. It must behave exactly like the Google Sheet the rest of the app already talks to, keep
// every value (numbers, text, true/false, dates down to the millisecond) perfectly, write all-or-nothing,
// refuse to overwrite someone else's change, and keep each person's data in their own folder.
// A fake Firestore stands in for the real one. All data is invented.
// Run with: node backend/tests/v2db.test.js

const { makeWorld, assert, FakeSheet } = require("./_fakeSheetsKit");

function fresh(){
  const w = makeWorld(["Logger.js", "firestore.js", "v2db.js"]);
  const sb = w.sb;
  // ---- a fake Firestore with update-times and "only if" checks, like the real one ----
  w.store = {}; w.clock = 0; w.commits = []; w.reads = 0; w.failNext = null;
  const clone = function(o){ return JSON.parse(JSON.stringify(o)); };
  sb.fsGetPathMeta_ = function(path){
    w.reads++;
    const d = w.store[path];
    return d ? { fields: clone(d.fields), updateTime: d.updateTime } : null;
  };
  sb.fsListPath_ = function(collectionPath){
    return Object.keys(w.store).filter(function(p){ return p.indexOf(collectionPath + "/") === 0 && p.slice(collectionPath.length + 1).indexOf("/") === -1; })
      .map(function(p){ return { id: p.split("/").pop(), fields: clone(w.store[p].fields), updateTime: w.store[p].updateTime }; });
  };
  sb.fsCommit_ = function(ops){
    if(w.failNext){ const e = w.failNext; w.failNext = null; throw e; }
    w.commits.push(ops.length);
    ops.forEach(function(op){
      if(op.set){
        const cur = w.store[op.set.path];
        if(op.set.onlyIfNew && cur){ const e = new Error("exists"); e.httpCode = 409; throw e; }
        if(op.set.onlyIfUpdateTime && (!cur || cur.updateTime !== op.set.onlyIfUpdateTime)){ const e = new Error("the stored version (x) does not match the required base version (y)"); e.httpCode = 400; throw e; }
      }
    });
    return ops.map(function(op){
      if(op.set){ w.store[op.set.path] = { fields: clone(op.set.fields), updateTime: "t" + String(++w.clock).padStart(6, "0") }; return { updateTime: w.store[op.set.path].updateTime }; }
      if(op.del){ delete w.store[op.del.path]; return {}; }
      return {};
    });
  };
  return w;
}

const same = function(a, b){
  const norm = function(v){ return Object.prototype.toString.call(v) === "[object Date]" ? { d: v.getTime() } : v; };
  return JSON.stringify(a.map(function(r){ return r.map(norm); })) === JSON.stringify(b.map(function(r){ return r.map(norm); }));
};
const D = function(y, mo, d, h, mi, s, ms){ return new Date(Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0, ms || 0)); };

// a tiny seeded random generator so a failure can be reproduced
let seed = 12345;
const rnd = function(n){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

console.log("\n--- 1. Behaves like a Sheet (random operations, compared with a plain fake Sheet) ---");
{
  const w = fresh(), sb = w.sb;
  const header = ["Date", "Amount", "Note", "Flag"];
  const initial = [header];
  for(let i = 0; i < 30; i++) initial.push([D(2026, 10, 1 + (i * 7) % 28, i % 24), (i * 37 % 100) / 4, "n" + (i % 5), i % 2 === 0]);
  const oracle = new FakeSheet("T", initial);
  const db = new sb.V2Db_("owner@example.com");
  const mine = db.insertSheet("T");
  initial.forEach(function(r){ mine.appendRow(r); });
  let ok = true, why = "";
  const check = function(label){ if(ok && !same(oracle.getDataRange().getValues(), mine.getDataRange().getValues())){ ok = false; why = label; } };
  for(let i = 0; i < 600; i++){
    const op = rnd(8), n = oracle.rows.length, r = 2 + rnd(Math.max(n - 1, 1)), c = 1 + rnd(4);
    const val = [rnd(1000) / 8, "t" + rnd(40), true, false, D(2026, 1 + rnd(12), 1 + rnd(28), rnd(24), rnd(60), rnd(60), rnd(1000)), ""][rnd(6)];
    let label = "op" + op;
    if(op === 0){ oracle.getRange(r, c).setValue(val); mine.getRange(r, c).setValue(val); }
    else if(op === 1){ const row = [val, rnd(1000) / 100, "n" + rnd(9), rnd(2) === 0]; oracle.appendRow(row); mine.appendRow(row); }
    else if(op === 2 && n > 4){ oracle.rows.splice(r - 1, 1); mine.deleteRow(r); }
    else if(op === 3 && n > 2){ oracle.rows.splice(r - 1, 0, []); mine.insertRowBefore(r); }
    else if(op === 4 && n > 4){ const spec = [{ column: 1 + rnd(4), ascending: rnd(2) === 0 }]; oracle.getRange(2, 1, n - 1, 4).sort(spec); mine.getRange(2, 1, n - 1, 4).sort(spec); }
    else if(op === 5){ oracle.getRange(r, c, 1, 2).clearContent(); mine.getRange(r, c, 1, 2).clearContent(); }
    else if(op === 6){ const blk = [[val, "x"], ["y", val]]; oracle.getRange(r, c, 2, 2).setValues(blk); mine.getRange(r, c, 2, 2).setValues(blk); }
    else if(op === 7 && n > 5){ oracle.rows.splice(r - 1, 2); mine.deleteRows(r, 2); }
    // the plain fake keeps trailing empty rows; compare after trimming blank tail rows on both
    const trim = function(rows){ const o = rows.map(function(x){ return x.slice(); }); while(o.length && o[o.length - 1].every(function(x){ return x === "" || x === undefined; })) o.pop(); return o.map(function(x){ while(x.length && (x[x.length - 1] === "" || x[x.length - 1] === undefined)) x.pop(); return x; }); };
    const a = trim(oracle.getDataRange().getValues()), b = trim(mine.getDataRange().getValues());
    if(ok && JSON.stringify(a.map(function(r){ return r.map(function(v){ return Object.prototype.toString.call(v) === "[object Date]" ? { d: v.getTime() } : v; }); })) !== JSON.stringify(b.map(function(r){ return r.map(function(v){ return Object.prototype.toString.call(v) === "[object Date]" ? { d: v.getTime() } : v; }); }))){ ok = false; why = label + " at step " + i; }
  }
  assert(ok, "600 random set/append/delete/insert/sort/clear operations give exactly the same cells as a plain fake Sheet" + (ok ? "" : " (first difference: " + why + ")"));
}

console.log("\n--- 1b. Sorting exactly like the Sheet (blanks, dates, text, both directions) ---");
{
  const w = fresh(), sb = w.sb;
  const header = ["Date", "Amt", "Name"];
  const body = [
    [D(2026, 10, 5), 30, "b"], [D(2026, 10, 2), "", "c"], ["", 10, "a"], [D(2026, 10, 9), 20, ""], [D(2026, 10, 2), 5, "d"],
    [D(2026, 10, 7), "", ""], ["", "", "e"], [D(2026, 10, 1), 15, "a"]
  ];
  [1, 2, 3].forEach(function(col){
    [true, false].forEach(function(asc){
      const rows = [header].concat(body.map(function(r){ return r.slice(); }));
      const oracle = new FakeSheet("T", rows);
      const db = new sb.V2Db_("owner@example.com");
      const mine = db.insertSheet("S" + col + asc);
      rows.forEach(function(r){ mine.appendRow(r.slice()); });
      const spec = [{ column: col, ascending: asc }];
      oracle.getRange(2, 1, body.length, 3).sort(spec);
      mine.getRange(2, 1, body.length, 3).sort(spec);
      assert(same(oracle.getDataRange().getValues(), mine.getDataRange().getValues()), "sorting column " + col + (asc ? " ascending" : " descending") + " with blank cells matches the Sheet");
    });
  });
  const db2 = new sb.V2Db_("owner@example.com"), t = db2.insertSheet("Stable");
  [["x", 1], ["y", 1], ["z", 1], ["w", 0]].forEach(function(r){ t.appendRow(r); });
  t.getRange(1, 1, 4, 2).sort([{ column: 2, ascending: true }]);
  assert(t.getRange(1, 1, 4, 1).getValues().map(function(r){ return r[0]; }).join("") === "wxyz", "sorting is stable (equal rows keep their order)");
}

console.log("\n--- 2. Everything survives being saved and re-opened ---");
{
  const w = fresh(), sb = w.sb;
  const rows = [
    ["Date", "Amount", "Note", "Flag", "Time"],
    [D(2026, 10, 11, 18, 36, 21, 123), 274.5, "Zepto ₹ café 😀 \"quoted\" \\ back\nline", true, D(1899, 12, 30, 18, 36, 21, 456)],
    [D(2026, 3, 1), 19.99, "", false, ""],
    [753022182554, -0.01, "a,b;c", 0, D(1899, 12, 30, 0, 0, 0)],
    [1e15, 1e-7, "x".repeat(5000), 12345678901234, "0123"]
  ];
  sb.v2dbImportTab_("owner@example.com", "Transactions", rows);        // an exact copy of a real tab: nothing is converted
  const back = new sb.V2Db_("owner@example.com").getSheetByName("Transactions").getDataRange().getValues();
  assert(same(back, rows), "numbers, text, true/false, empty cells, unicode, emoji, quotes, newlines, huge text and exact Dates (to the millisecond) all come back identical");
  assert(Object.prototype.toString.call(back[1][0]) === "[object Date]" && back[1][0].getTime() === rows[1][0].getTime(), "a Date comes back as a real Date");
  assert(back[4][4] === "0123" && back[3][0] === 753022182554, "text that looks like a number stays text; a long number stays a number");
  assert(new sb.V2Db_("owner@example.com").getSheetByName("Nope") === null, "a tab the person doesn't have is null (like getSheetByName)");
}

console.log("\n--- 2b. Text a script writes is turned into numbers / dates / true-false, like the real Sheet ---");
{
  const w = fresh(), sb = w.sb;
  const db = new sb.V2Db_("owner@example.com");
  const sh = db.insertSheet("C");
  sh.appendRow(["123", "12.50", "-7", "1,234.5", "0123", "TRUE", "false", "2026-10-12", "2026-10-12 18:36:21", "18:36", "753022182554", "hello", "", "2026-13-45", "12345678901234567890", "1e5", " 42 "]);
  const r = sh.getRange(1, 1, 1, 17).getValues()[0];
  const isDate = function(x){ return Object.prototype.toString.call(x) === "[object Date]"; };
  assert(r[0] === 123 && r[1] === 12.5 && r[2] === -7 && r[3] === 1234.5 && r[4] === 123, "number-looking text becomes a number (including 12.50, negatives, 1,234.5 and 0123)");
  assert(r[5] === true && r[6] === false, "TRUE / false become true / false");
  assert(isDate(r[7]) && r[7].getTime() === Date.UTC(2026, 9, 11, 18, 30), "yyyy-MM-dd becomes a date at midnight India time");
  assert(isDate(r[8]) && r[8].getTime() === Date.UTC(2026, 9, 12, 18 - 5, 36 - 30 + 60, 21) || r[8].getTime() === Date.UTC(2026, 9, 12, 13, 6, 21), "yyyy-MM-dd HH:mm:ss becomes a date-time");
  assert(isDate(r[9]), "HH:mm becomes a time of day");
  assert(r[10] === 753022182554, "a 12-digit reference becomes a number (as in the live Sheet)");
  assert(r[11] === "hello" && r[12] === "", "ordinary text and empty text stay as they are");
  assert(r[13] === "2026-13-45", "an impossible date stays text");
  assert(r[14] === "12345678901234567890" && r[15] === "1e5", "a number too long to hold exactly, and scientific notation, stay text (never silently rounded)");
  assert(r[16] === 42, "spaces around a number are ignored");
  sh.getRange(2, 1).setValue("45"); sh.getRange(2, 2, 1, 2).setValues([["2026-01-02", "x"]]);
  assert(sh.getRange(2, 1).getValue() === 45 && isDate(sh.getRange(2, 2).getValue()) && sh.getRange(2, 3).getValue() === "x", "setValue and setValues convert the same way");
  const imp = sb.v2dbImportTab_("owner@example.com", "Copy", [["0123", "2026-10-12"]]);
  assert(new sb.V2Db_("owner@example.com").getSheetByName("Copy").getRange(1, 1, 1, 2).getValues()[0].join("|") === "0123|2026-10-12", "importing an exact copy of a real tab converts nothing");
  const mix = new sb.V2Db_("owner@example.com").insertSheet("Mix");
  [["b"], ["2026-10-02"], [5], ["2026-10-01"], [true], ["a"], [""]].forEach(function(row){ mix.appendRow(row); });
  mix.getRange(1, 1, 7, 1).sort([{ column: 1, ascending: true }]);
  const order = mix.getRange(1, 1, 7, 1).getValues().map(function(x){ const v = x[0]; return isDate(v) ? "D" + new Date(v.getTime() + 330 * 60000).getUTCDate() : String(v); }).join(",");
  assert(order === "5,D1,D2,a,b,true,", "sorting mixed content like Sheets: numbers and dates first (earlier date first), then text, then true/false, blanks last (got " + order + ")");
}

console.log("\n--- 3. All-or-nothing, and nothing written when nothing changed ---");
{
  const w = fresh(), sb = w.sb;
  sb.v2dbRun_("owner@example.com", function(db){ const a = db.insertSheet("A"); a.appendRow(["h"]); a.appendRow([1]); const b = db.insertSheet("B"); b.appendRow(["h"]); });
  assert(w.commits.length === 1, "a request that changed two tabs is saved in ONE batch");
  const before = JSON.stringify(w.store);
  let threw = false;
  try{ sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("A").appendRow([2]); db.getSheetByName("B").appendRow([9]); throw new Error("the action failed half way"); }); }catch(e){ threw = true; }
  assert(threw && JSON.stringify(w.store) === before, "if the action throws, NOTHING is written (not even the part that came before the error)");
  const c0 = w.commits.length;
  sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("A").getDataRange().getValues(); db.getSheetByName("B").getRange(1, 1).getValue(); });
  assert(w.commits.length === c0, "a request that only reads writes nothing");
  sb.v2dbRun_("owner@example.com", function(db){ const a = db.getSheetByName("A"); a.getRange(2, 1).setValue(99); a.getRange(2, 1).setValue(1); });
  assert(w.commits.length === c0, "changing a cell and changing it back writes nothing");
  assert(sb.dbSs_() !== null && sb.V2DB_REQ_ === null, "after any request, dbSs_() is the real spreadsheet again (even after an error)");
  let inside = null;
  sb.v2dbRun_("owner@example.com", function(db){ inside = sb.dbSs_() === db; });
  assert(inside === true, "inside a request, dbSs_() is that person's virtual spreadsheet");
}

console.log("\n--- 4. Someone else changed it meanwhile: refused, never overwritten ---");
{
  const w = fresh(), sb = w.sb;
  sb.v2dbRun_("owner@example.com", function(db){ const a = db.insertSheet("A"); a.appendRow(["h"]); a.appendRow([1]); });
  const db = new sb.V2Db_("owner@example.com");
  const a = db.getSheetByName("A");
  a.appendRow([2]);
  sb.v2dbRun_("owner@example.com", function(d2){ d2.getSheetByName("A").appendRow([777]); });          // a second request lands first
  let err = null;
  try{ db.flush(); }catch(e){ err = e; }
  assert(err && err.v2dbConflict === true && /try again/.test(err.message), "the late save is refused with a plain 'try again' message");
  const now = new sb.V2Db_("owner@example.com").getSheetByName("A").getDataRange().getValues();
  assert(now.length === 3 && now[2][0] === 777, "the other request's data is intact (nothing overwritten)");
  const w2 = fresh(), sb2 = w2.sb;
  let e2 = null;
  const dbA = new sb2.V2Db_("owner@example.com"); dbA.insertSheet("A").appendRow(["y"]);                  // I start creating tab A ...
  sb2.v2dbRun_("owner@example.com", function(d){ const t = d.insertSheet("A"); t.appendRow(["x"]); });      // ... someone else creates it first
  try{ dbA.flush(); }catch(e){ e2 = e; }
  assert(e2 && e2.v2dbConflict === true, "creating a tab that someone else created at the same moment is also refused");
  const e3 = new Error("Firestore is down"); e3.httpCode = 503;
  const w3 = fresh(), sb3 = w3.sb;
  w3.failNext = e3;
  let got = null;
  try{ sb3.v2dbRun_("owner@example.com", function(d){ d.insertSheet("A").appendRow([1]); }); }catch(e){ got = e; }
  assert(got && got.httpCode === 503 && !got.v2dbConflict, "a real outage is reported as an outage (not disguised as a conflict)");
}

console.log("\n--- 5. Big tabs: pages ---");
{
  const w = fresh(), sb = w.sb;
  sb.v2dbRun_("owner@example.com", function(db){
    const t = db.insertSheet("Big");
    for(let i = 0; i < 2500; i++) t.appendRow([i, "row " + i]);
  });
  const pages = Object.keys(w.store).filter(function(p){ return /\/Big\/pages\//.test(p); });
  assert(pages.length === 3, "2,500 small rows are stored as 3 pages (1,000 rows each at most)");
  assert(w.store["users/owner@example.com/sheets/Big/pages/0000"].fields.pages === 3, "page 0 remembers how many pages there are");
  w.reads = 0; w.commits = [];
  const clockBefore = w.clock;
  sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("Big").getRange(2400, 1).setValue("changed"); });
  assert(w.reads === 3 && w.commits.length === 1, "opening a 3-page tab is 3 reads; changing one cell is one batch");
  const touched = Object.keys(w.store).filter(function(p){ return Number(w.store[p].updateTime.slice(1)) > clockBefore; });
  assert(touched.length === 2 && touched.some(function(p){ return /0002$/.test(p); }) && touched.some(function(p){ return /0000$/.test(p); }), "only the changed page and page 0 were rewritten");
  sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("Big").deleteRows(1001, 1500); });
  const after = Object.keys(w.store).filter(function(p){ return /\/Big\/pages\//.test(p); });
  assert(after.length === 1, "when the tab shrinks, the extra pages are deleted");
  const back = new sb.V2Db_("owner@example.com").getSheetByName("Big").getDataRange().getValues();
  assert(back.length === 1000 && back[999][0] === 999, "and the remaining rows are right");
  sb.v2dbRun_("owner@example.com", function(db){ const t = db.insertSheet("Wide"); for(let i = 0; i < 40; i++) t.appendRow([i, "y".repeat(50000)]); });
  const widePages = Object.keys(w.store).filter(function(p){ return /\/Wide\/pages\//.test(p); });
  assert(widePages.length >= 3 && widePages.every(function(p){ return JSON.stringify(w.store[p].fields).length < 700000; }), "very wide rows are split by size too, so no page nears Firestore's limit");
  assert(new sb.V2Db_("owner@example.com").getSheetByName("Wide").getLastRow() === 40, "...and still read back whole");
}

console.log("\n--- 6. Each person's data stays in their own folder ---");
{
  const w = fresh(), sb = w.sb;
  sb.v2dbRun_("owner@example.com", function(db){ db.insertSheet("Transactions").appendRow(["owner secret"]); });
  sb.v2dbRun_("friend@example.com", function(db){ db.insertSheet("Transactions").appendRow(["friend data"]); });
  assert(Object.keys(w.store).every(function(p){ return p.indexOf("users/owner@example.com/") === 0 || p.indexOf("users/friend@example.com/") === 0; }), "everything is written under users/<that person>/");
  const ownerRows = new sb.V2Db_("owner@example.com").getSheetByName("Transactions").getDataRange().getValues();
  const friendRows = new sb.V2Db_("friend@example.com").getSheetByName("Transactions").getDataRange().getValues();
  assert(ownerRows[0][0] === "owner secret" && friendRows[0][0] === "friend data", "the same tab name holds different data for each person");
  assert(new sb.V2Db_("stranger@example.com").getSheetByName("Transactions") === null, "a person with no data sees no tabs");
  assert(!Object.keys(w.store).some(function(p){ return p.indexOf("owner@example.com") !== -1 && JSON.stringify(w.store[p]).indexOf("friend data") !== -1; }), "one person's data never appears in another's folder");
  let bad = 0;
  ["", "not-an-email", "a/b@x.com", "../x@y.com", "x y@z.com"].forEach(function(u){ try{ new sb.V2Db_(u); }catch(e){ bad++; } });
  assert(bad === 5, "a missing, malformed or path-trick person is refused outright");
  const names = new sb.V2Db_("owner@example.com").getSheets().map(function(s){ return s.getName(); });
  assert(names.length === 1 && names[0] === "Transactions", "getSheets lists only that person's tabs");
}

console.log("\n--- 7. Importing a real Sheet tab, and the Sheet-like details ---");
{
  const w = fresh(), sb = w.sb;
  const rows = [["Name", "Amt"], ["a", 1], ["b", D(2026, 10, 12)]];
  const r = sb.v2dbImportTab_("owner@example.com", "Debts", rows);
  assert(r.rows === 3 && same(new sb.V2Db_("owner@example.com").getSheetByName("Debts").getDataRange().getValues(), rows), "importing a tab copies it exactly");
  sb.v2dbImportTab_("owner@example.com", "Debts", [["Name", "Amt"], ["z", 9]]);
  assert(same(new sb.V2Db_("owner@example.com").getSheetByName("Debts").getDataRange().getValues(), [["Name", "Amt"], ["z", 9]]), "importing again REPLACES the person's copy (not appends)");
  sb.v2dbRun_("owner@example.com", function(db){ const s = db.getSheetByName("Debts"); s.appendRow(["q", 1]); s.appendRow(["r", 2]); });
  const d = new sb.V2Db_("owner@example.com").getSheetByName("Debts");
  assert(d.getLastRow() === 4 && d.getLastColumn() === 2, "getLastRow / getLastColumn count only filled cells");
  d.getRange(10, 1).setValue("far");
  assert(d.getLastRow() === 10 && d.getRange(7, 1).getValue() === "", "writing far below grows the tab; cells in between read as empty");
  assert(d.getRange(1, 1, 2, 3).getValues().length === 2 && d.getRange(1, 1, 2, 3).getValues()[0].length === 3, "getValues pads to the requested size");
  const v = d.getRange(2, 1).getValue();
  assert(v === "z", "getValue reads one cell");
  let threw = false;
  try{ d.getRange("A1:B2"); }catch(e){ threw = true; }
  assert(threw, "A1-style ranges are refused loudly (the backend only uses row/column numbers)");
  const copy = new sb.V2Db_("owner@example.com").getSheetByName("Debts").getRange(2, 1, 1, 1).getValues();
  copy[0][0] = "mutated";
  assert(new sb.V2Db_("owner@example.com").getSheetByName("Debts").getRange(2, 1).getValue() === "z", "values handed out are copies (changing them changes nothing)");
}

console.log("\n--- 8. Review fixes: failed answers save nothing, real errors are not disguised, byte-sized pages ---");
{
  const w = fresh(), sb = w.sb;
  const answer = function(ok){ return { getContent: function(){ return JSON.stringify({ ok: ok, x: 1 }); } }; };
  sb.v2dbRun_("owner@example.com", function(db){ db.insertSheet("A").appendRow([1]); return answer(true); });
  const before = JSON.stringify(w.store);
  const ret = sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("A").appendRow([2]); return answer(false); });
  assert(JSON.stringify(w.store) === before && JSON.parse(ret.getContent()).ok === false, "an action that answers {ok:false} saves NONE of its changes, and its answer is passed through");
  sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("A").appendRow([3]); return answer(true); });
  assert(new sb.V2Db_("owner@example.com").getSheetByName("A").getLastRow() === 2, "an action that answers {ok:true} is saved");
  sb.v2dbRun_("owner@example.com", function(db){ db.getSheetByName("A").appendRow([4]); return "not a response object"; });
  assert(new sb.V2Db_("owner@example.com").getSheetByName("A").getLastRow() === 3, "a plain return value (no answer object) is saved");

  const w2 = fresh(), sb2 = w2.sb;
  const bad = new Error("Invalid argument: document too large"); bad.httpCode = 400;
  w2.failNext = bad;
  let got = null;
  try{ sb2.v2dbRun_("owner@example.com", function(db){ db.insertSheet("A").appendRow([1]); }); }catch(e){ got = e; }
  assert(got && !got.v2dbConflict && /too large/.test(got.message), "a genuine HTTP 400 (like an oversize document) keeps its real message instead of being called a harmless conflict");

  const w3 = fresh(), sb3 = w3.sb;
  sb3.v2dbRun_("owner@example.com", function(db){ const t = db.insertSheet("Wide"); for(let i = 0; i < 12; i++) t.appendRow([i, "₹".repeat(60000)]); });
  const pages = Object.keys(w3.store).filter(function(p){ return /\/Wide\/pages\//.test(p); });
  const bytes = function(str){ return Buffer.byteLength(str, "utf8"); };
  assert(pages.length >= 2 && pages.every(function(p){ return bytes(w3.store[p].fields.json) <= 560000; }), "pages are sized by real bytes: rows full of the rupee sign (3 bytes each) are split before a page nears 1 MiB");
  assert(new sb3.V2Db_("owner@example.com").getSheetByName("Wide").getLastRow() === 12, "...and they read back whole");

  const w4 = fresh(), sb4 = w4.sb;
  sb4.v2dbRun_("owner@example.com", function(db){ db.insertSheet("My Tab").appendRow([1]); });
  let collide = false;
  try{ const d = new sb4.V2Db_("owner@example.com"); d.insertSheet("My Tab2"); d.insertSheet("My_Tab2"); }catch(e){ collide = true; }
  assert(collide, "two tab names that would be stored under the same name are refused");
  const d5 = new sb4.V2Db_("owner@example.com");
  w4.reads = 0; d5.getSheetByName("Nope"); d5.getSheetByName("Nope"); d5.getSheetByName("Nope");
  assert(w4.reads === 1, "asking again for a tab that doesn't exist costs one read, not one per ask");
}

process.exitCode = process.exitCode || 0;
