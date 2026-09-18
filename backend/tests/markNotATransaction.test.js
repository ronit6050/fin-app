// backend/tests/markNotATransaction.test.js
//
// Plain-English what this checks: the new "this isn't a real
// transaction" button (Pending screen, for a spam SMS that slipped past
// the SMS parser and got saved as "UNCERTAIN"). Tapping it should:
//   1. Copy the row's data into a new Transactions_Ignored sheet, with
//      every original column intact — nothing about the message is
//      lost, just archived — then CLEAR the original row's cells in
//      place (same row number, nothing below it moves). Earlier this
//      used sheet.deleteRow(), which change-reviewer caught before ship:
//      deleting shifts every row below it up by one, and every row
//      number this app hands out (Pending, History) is just "current
//      position in the sheet" — a shift could make an already-open
//      Pending card or History entry silently point at the WRONG
//      transaction, corrupting it on the next Save. Clearing in place
//      fixes this at the root — see the fuller comment on
//      markNotATransaction itself. Test 7 below proves the fix directly.
//   2. If the message text is specific enough, also save a "fingerprint"
//      of it to a new LearnedSpamPatterns sheet, so the separate
//      sms-parser-backend project can recognize similar junk later —
//      and report patternLearned:true/false so the frontend can be
//      honest about whether that actually happened.
//   3. Skip step 2 (but still clear the row) when the text is too
//      short/generic to safely generalize from.
//   4. Refuse to touch anything if the row isn't genuinely still
//      pending (already noted, or the row number is out of range) —
//      defends against a stale row number sent from the frontend.
//
// Loads the REAL backend/PWA.js into a small fake Google Sheets
// environment (no real Apps Script/Google account needed), same
// approach as backend/tests/autoLogSaving.test.js.
//
// Run with: node backend/tests/markNotATransaction.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(condition, message){
  if(!condition){
    console.error("FAIL: " + message);
    process.exitCode = 1;
  } else {
    console.log("PASS: " + message);
  }
}

// ---------------------------------------------------------------------
// A tiny fake Google Sheets environment — just enough for the functions
// under test (getDataRange/getValues, getLastRow, appendRow, deleteRow,
// insertSheet, getSheetByName).
// ---------------------------------------------------------------------
function makeFakeSheetsEnv(){
  const sheetsByName = {};

  function FakeSheet(name, initialRows){
    this.name = name;
    this.rows = initialRows.map(function(r){ return r.slice(); });
  }
  // Real Google Sheets' getLastRow() reports "the last row that has ANY
  // content" — NOT just how many rows have ever physically existed. This
  // matters a lot here: change-reviewer caught that a naive fake (just
  // `rows.length`) would make it IMPOSSIBLE for this test suite to ever
  // catch the real bug found in this feature's second review round (see
  // markNotATransaction's own "SECOND ROUND" comment in PWA.js) — a
  // cleared trailing row making getLastRow() shrink, and a genuinely new
  // transaction then silently landing on that same recycled row number.
  // So this fake mimics the real behavior precisely: a row only counts
  // as "having content" if at least one cell in it is non-empty, and
  // appendRow() targets "last content row + 1" — REUSING an existing
  // physically-blank row at that position if one is already there,
  // rather than always growing the array. This is what lets Test 8
  // below actually prove the fix, instead of trivially passing no
  // matter what PWA.js does.
  function rowHasContent(row){
    return row.some(function(cell){ return cell !== "" && cell !== null && cell !== undefined; });
  }
  FakeSheet.prototype.getLastRowWithContent_ = function(){
    for(let i = this.rows.length - 1; i >= 0; i--){
      if(rowHasContent(this.rows[i])) return i + 1; // 1-based
    }
    return 0;
  };
  FakeSheet.prototype.appendRow = function(row){
    const targetRow = this.getLastRowWithContent_() + 1; // 1-based, matches real appendRow's targeting
    if(targetRow - 1 < this.rows.length){
      this.rows[targetRow - 1] = row.slice(); // reuses an existing, currently-blank physical row
    } else {
      this.rows.push(row.slice());
    }
  };
  FakeSheet.prototype.getDataRange = function(){
    const self = this;
    return { getValues: function(){ return self.rows.map(function(r){ return r.slice(); }); } };
  };
  FakeSheet.prototype.getLastRow = function(){ return this.getLastRowWithContent_(); };
  FakeSheet.prototype.getLastColumn = function(){ return this.rows[0] ? this.rows[0].length : 0; };
  // Supports both the 2-arg single-cell form (row, col) and the 4-arg
  // range form (row, col, numRows, numCols) markNotATransaction now uses
  // for clearContent()/setValues() — real Apps Script's getRange
  // supports both too.
  FakeSheet.prototype.getRange = function(row, col, numRows, numCols){
    const self = this;
    if(numRows === undefined && numCols === undefined){
      return {
        getValue: function(){ return self.rows[row - 1] ? self.rows[row - 1][col - 1] : ""; },
        setValue: function(v){ self.rows[row - 1][col - 1] = v; }
      };
    }
    return {
      clearContent: function(){
        for(let r = row; r < row + numRows; r++){
          for(let c = col; c < col + numCols; c++){
            if(self.rows[r - 1]) self.rows[r - 1][c - 1] = "";
          }
        }
      },
      setValues: function(values){
        for(let r = 0; r < numRows; r++){
          if(!self.rows[row - 1 + r]) self.rows[row - 1 + r] = new Array(numCols).fill("");
          for(let c = 0; c < numCols; c++){
            self.rows[row - 1 + r][col - 1 + c] = values[r][c];
          }
        }
      }
    };
  };
  // Kept for completeness / any future test that needs real deletion —
  // markNotATransaction itself no longer calls this (see the file
  // header comment above for why: deleting shifts every row below it,
  // which is exactly the bug this feature's real fix avoids).
  FakeSheet.prototype.deleteRow = function(row){ this.rows.splice(row - 1, 1); };

  function seedSheet(name, headerAndRows){
    sheetsByName[name] = new FakeSheet(name, headerAndRows);
    return sheetsByName[name];
  }

  const SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return {
        getSheetByName: function(name){ return sheetsByName[name] || null; },
        insertSheet: function(name){
          const s = new FakeSheet(name, []);
          sheetsByName[name] = s;
          return s;
        }
      };
    }
  };

  return { SpreadsheetApp, seedSheet, sheetsByName };
}

// ---------------------------------------------------------------------
// Load the real backend/PWA.js into a sandbox. PWA.js only ever DEFINES
// functions at the top level (no top-level executable code) — so this
// is safe even though most of PWA.js's other functions aren't relevant
// here and their own dependencies (getSuggestedCategoryFast, etc.)
// aren't provided; they're simply never called by this test.
// ---------------------------------------------------------------------
function loadBackendSandbox(){
  const env = makeFakeSheetsEnv();

  const sandbox = {
    SpreadsheetApp: env.SpreadsheetApp,
    console: console
  };
  vm.createContext(sandbox);

  const pwaSrc = fs.readFileSync(path.join(__dirname, "..", "PWA.js"), "utf8");
  vm.runInContext(pwaSrc, sandbox, { filename: "PWA.js" });

  return { sandbox: sandbox, env: env };
}

// A realistic Transactions header + one pending row, matching the real
// 19-column schema (docs/SHEET_SCHEMA.md).
const TXN_HEADER = [
  "Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty",
  "Channel","Source","RawSMS","Sender","Note","Category","TelegramMsgID",
  "Processed","NeedWantSaving","FinancialEvent","FinancialEventName"
];

// A "tombstoned" row: every cell blank EXCEPT column P (Processed,
// index 15), which holds "IGNORED" — never blank, never "YES". See
// markNotATransaction's own comment for exactly why that one cell must
// always stay non-empty (getLastRow() must never be able to shrink past
// this row).
function isTombstoned(row){
  return row.every(function(cell, i){ return i === 15 ? cell === "IGNORED" : cell === ""; });
}

function pendingSpamRow(overrides){
  const base = [
    "2026-09-18", "10:00", "HDFC", "debit", "upi", 0, "",
    "NEEDS REVIEW: Get a Loan on your HDFC Bank Credit Card",
    "SMS", "Tasker",
    "Last chance! Get a Loan on your HDFC Bank Credit Card @ ZERO Processing Fee. Apply now https://1.hdfc.bank.in/HDFCBK/s/V6JLK9Rx",
    "HDFCBK",
    "", "", "",
    "YES", "", "", ""
  ];
  // Object.assign onto an array clone (not {}) — keeps it a real array
  // (with .slice(), needed by the fake sheet's appendRow), while still
  // letting a test override specific numeric-index columns by number.
  return Object.assign(base.slice(), overrides || {});
}

// ---------------------------------------------------------------------
// Test 1 — happy path: long/specific enough text, both the archive AND
// the learned pattern happen.
// ---------------------------------------------------------------------
(function testArchivesAndLearnsPattern(){
  const { sandbox, env } = loadBackendSandbox();
  const row2 = pendingSpamRow();
  env.seedSheet("Transactions", [TXN_HEADER, row2]);

  const result = sandbox.markNotATransaction(2);
  assert(result.ok === true, "markNotATransaction() reports ok:true for a genuinely pending spam row");
  assert(result.patternLearned === true, "reports patternLearned:true when the text was specific enough to learn from");

  const txnRows = env.sheetsByName["Transactions"].rows;
  assert(txnRows.length === 2, "row 2 still physically exists in Transactions (cleared in place, not deleted), got " + txnRows.length + " row(s)");
  assert(isTombstoned(txnRows[1]), "row 2 is tombstoned — blank except Processed=\"IGNORED\"");

  const ignoredSheet = env.sheetsByName["Transactions_Ignored"];
  assert(!!ignoredSheet, "Transactions_Ignored was auto-created");
  assert(ignoredSheet.rows.length === 2, "Transactions_Ignored has the header + exactly one archived row");
  assert(JSON.stringify(ignoredSheet.rows[0]) === JSON.stringify(TXN_HEADER),
    "Transactions_Ignored's header row is an exact copy of Transactions' header row");
  assert(JSON.stringify(ignoredSheet.rows[1]) === JSON.stringify(row2),
    "the archived row's data is byte-identical to the original row — nothing lost or altered");

  const patternsSheet = env.sheetsByName["LearnedSpamPatterns"];
  assert(!!patternsSheet, "LearnedSpamPatterns was auto-created");
  assert(patternsSheet.rows.length === 2, "LearnedSpamPatterns has the header + exactly one learned row");
  const learnedRow = patternsSheet.rows[1];
  assert(learnedRow[1] === "HDFCBK", "learned row's Sender matches column L, got \"" + learnedRow[1] + "\"");
  const expectedTemplate = sandbox.normalizeForFingerprint(row2[10]);
  assert(learnedRow[2] === expectedTemplate, "learned row's NormalizedTemplate matches normalizeForFingerprint(RawSMS)");
  // Note: toLowerCase() runs BEFORE the URL replace in
  // normalizeForFingerprint, so the literal replacement text "<URL>"
  // itself stays uppercase in the output — that's the real, correct
  // contract (matches sms-parser-backend/Code.js's copy), not a bug.
  assert(learnedRow[2].indexOf("<URL>") !== -1, "the link in the message was normalized to <URL>, got: " + learnedRow[2]);
  assert(learnedRow[3] === row2[10], "learned row's ExampleRawSMS is the original, untouched raw text (for the user's own future reference)");
})();

// ---------------------------------------------------------------------
// Test 2 — minimum-length guard: a short/generic normalized template
// does NOT create a learning rule, but the row is still archived and
// removed (the user's immediate result is unaffected either way).
// ---------------------------------------------------------------------
(function testShortTemplateSkipsLearningButStillArchives(){
  const { sandbox, env } = loadBackendSandbox();
  // "123456" normalizes to "<num>" — 5 characters, well under the
  // 20-char minimum-specificity guard.
  const row2 = pendingSpamRow({ 10: "123456", 11: "SHORTID" });
  env.seedSheet("Transactions", [TXN_HEADER, row2]);

  const result = sandbox.markNotATransaction(2);
  assert(result.ok === true, "still reports ok:true even when the text is too short to learn from");
  assert(result.patternLearned === false, "reports patternLearned:false when the text was too short to learn from");

  const txnRows = env.sheetsByName["Transactions"].rows;
  assert(txnRows.length === 2, "row 2 still physically exists in Transactions (cleared in place, not deleted)");
  assert(isTombstoned(txnRows[1]), "row 2 is tombstoned — blank except Processed=\"IGNORED\"");

  const ignoredSheet = env.sheetsByName["Transactions_Ignored"];
  assert(ignoredSheet.rows.length === 2, "the row is still archived to Transactions_Ignored");

  const patternsSheet = env.sheetsByName["LearnedSpamPatterns"];
  assert(!patternsSheet, "LearnedSpamPatterns was never even created — nothing short/generic gets learned from");
})();

// ---------------------------------------------------------------------
// Test 3 — a row that already has a note (not actually pending anymore)
// is rejected, and NOTHING changes (no archive, no delete, no learning).
// ---------------------------------------------------------------------
(function testAlreadyNotedRowRejected(){
  const { sandbox, env } = loadBackendSandbox();
  const row2 = pendingSpamRow({ 12: "Recognized this, it's real", 15: "YES" }); // column M (index 12) has a note now
  env.seedSheet("Transactions", [TXN_HEADER, row2]);

  const result = sandbox.markNotATransaction(2);
  assert(result.ok === false, "an already-noted row is rejected (ok:false)");
  assert(typeof result.error === "string" && result.error.length > 0, "a plain-English error message is returned");

  const txnRows = env.sheetsByName["Transactions"].rows;
  assert(txnRows.length === 2, "the row is still there, untouched (header + the one row)");
  assert(JSON.stringify(txnRows[1]) === JSON.stringify(row2), "the row's data is completely unchanged");
  assert(!env.sheetsByName["Transactions_Ignored"], "Transactions_Ignored was never created — nothing was archived");
  assert(!env.sheetsByName["LearnedSpamPatterns"], "LearnedSpamPatterns was never created — nothing was learned");
})();

// ---------------------------------------------------------------------
// Test 4 — a not-yet-processed row (column P blank, never even alerted
// yet) is also rejected by the same guard, same reasoning.
// ---------------------------------------------------------------------
(function testNotYetProcessedRowRejected(){
  const { sandbox, env } = loadBackendSandbox();
  const row2 = pendingSpamRow({ 15: "" }); // column P (Processed) blank
  env.seedSheet("Transactions", [TXN_HEADER, row2]);

  const result = sandbox.markNotATransaction(2);
  assert(result.ok === false, "a not-yet-processed row is rejected (ok:false)");
  assert(env.sheetsByName["Transactions"].rows.length === 2, "the row is still there, untouched");
})();

// ---------------------------------------------------------------------
// Test 5 — an out-of-range row number is rejected cleanly, no crash.
// ---------------------------------------------------------------------
(function testOutOfRangeRowRejected(){
  const { sandbox, env } = loadBackendSandbox();
  env.seedSheet("Transactions", [TXN_HEADER, pendingSpamRow()]);

  const tooHigh = sandbox.markNotATransaction(99);
  assert(tooHigh.ok === false, "a row number past the end of the sheet is rejected (ok:false)");

  const headerRow = sandbox.markNotATransaction(1);
  assert(headerRow.ok === false, "row 1 (the header row) is rejected (ok:false)");

  const notInteger = sandbox.markNotATransaction(2.5);
  assert(notInteger.ok === false, "a non-integer row is rejected (ok:false)");

  const missing = sandbox.markNotATransaction(undefined);
  assert(missing.ok === false, "a missing row is rejected (ok:false)");

  assert(env.sheetsByName["Transactions"].rows.length === 2, "nothing was ever touched by any of the rejected calls above");
})();

// ---------------------------------------------------------------------
// Test 7 — THE regression test for the bug change-reviewer caught: with
// several pending rows in the sheet, marking one as "not a transaction"
// must NEVER change any other row's number or content. This is the
// exact scenario that would have silently misfiled a Save onto the
// wrong transaction under the old deleteRow()-based version — a card
// for row 4 stays row 4 after row 2 is cleared, with its data untouched.
// ---------------------------------------------------------------------
(function testOtherRowsNeverShiftOrChange(){
  const { sandbox, env } = loadBackendSandbox();
  const row2 = pendingSpamRow(); // the spam row we'll mark
  const row3 = pendingSpamRow({ 7: "Zomato", 10: "A real Zomato order confirmation, nothing to do with the spam row", 11: "VM-ZOMATO" });
  const row4 = pendingSpamRow({ 7: "Swiggy", 10: "A real Swiggy order confirmation, also unrelated", 11: "VM-SWIGGY" });
  env.seedSheet("Transactions", [TXN_HEADER, row2, row3, row4]);

  const result = sandbox.markNotATransaction(2);
  assert(result.ok === true, "marking row 2 succeeds");

  const txnRows = env.sheetsByName["Transactions"].rows;
  assert(txnRows.length === 4, "the sheet still has all 4 rows (header + 3), nothing was removed/shifted");
  assert(isTombstoned(txnRows[1]), "row 2 (the one marked) is tombstoned");
  assert(JSON.stringify(txnRows[2]) === JSON.stringify(row3),
    "row 3 (Zomato) is at the EXACT SAME row number with EXACTLY the same data — this is what would have broken under deleteRow()");
  assert(JSON.stringify(txnRows[3]) === JSON.stringify(row4),
    "row 4 (Swiggy) is also completely untouched and still at row 4");

  // The real-world consequence this prevents: getPendingTransactions()
  // would still correctly report rows 3 and 4 by their real row numbers
  // (a stale cached "row: 3" or "row: 4" on an already-open Pending card
  // is still correct after this call) — proven by re-running the actual
  // pending-listing logic's own guard columns directly here.
  assert((txnRows[2][15] || "") === "YES" && !(txnRows[2][12] || ""), "row 3 still looks like a normal pending row to getPendingTransactions()");
  assert((txnRows[3][15] || "") === "YES" && !(txnRows[3][12] || ""), "row 4 still looks like a normal pending row to getPendingTransactions()");
})();

// ---------------------------------------------------------------------
// Test 8 — THE regression test for the SECOND, more severe bug
// change-reviewer found: marking the sheet's actual LAST row as spam
// must never make getLastRow() shrink, because a genuinely new real
// transaction (appended by the separate sms-parser-backend project
// right after, via plain appendRow()) would otherwise land on that same
// recycled row number and become permanently invisible — never
// re-scanned by processNewTransactions()'s row bookmark, never shown
// anywhere. See markNotATransaction's own "SECOND ROUND" comment.
// ---------------------------------------------------------------------
(function testLastRowNeverShrinksAndNewTransactionDoesNotGetRecycled(){
  const { sandbox, env } = loadBackendSandbox();
  const row2 = pendingSpamRow(); // the sheet's only data row — also its LAST row
  const sheet = env.seedSheet("Transactions", [TXN_HEADER, row2]);

  assert(sheet.getLastRow() === 2, "sanity check: before marking anything, the sheet's last row is 2");

  const result = sandbox.markNotATransaction(2);
  assert(result.ok === true, "marking the sheet's last pending row succeeds");

  assert(sheet.getLastRow() === 2,
    "getLastRow() is STILL 2 after clearing the sheet's actual last row — this is the exact real-Sheets behavior " +
    "that would have silently broken things if this row had been left fully blank (a plain clearContent() would " +
    "make a real Google Sheet report getLastRow() === 1 here instead)");

  // Simulate the separate sms-parser-backend project's saveTransaction()
  // — a brand-new, completely real transaction arriving right after —
  // using the exact same appendRow() mechanism it really uses.
  const newRealTxn = pendingSpamRow({
    7: "A Real Restaurant",
    10: "Rs.450 debited from A/c XXXX1234 to A Real Restaurant on 18-Sep-26",
    11: "HDFCBK",
    12: "", // no note yet — genuinely pending
    15: ""  // not yet Processed — that's processNewTransactions()'s job, same as any real new row
  });
  sheet.appendRow(newRealTxn);

  const rowsAfter = env.sheetsByName["Transactions"].rows;
  assert(rowsAfter.length === 3,
    "the new transaction landed in a NEW physical row (3), not recycled into row 2 — proves the tombstone fix works, got " +
    rowsAfter.length + " row(s) total");
  assert(isTombstoned(rowsAfter[1]), "row 2 (the marked spam row) is still tombstoned, completely untouched by the new transaction");
  assert(JSON.stringify(rowsAfter[2]) === JSON.stringify(newRealTxn),
    "row 3 holds the new real transaction's data, byte-identical to what was appended");

  // The failure mode this specifically prevents: if the new transaction
  // HAD been recycled into row 2, processNewTransactions()'s own row
  // bookmark (lastCheckedRow, already advanced past row 2 since it was
  // Processed="YES" before being marked spam) would skip it forever —
  // it would never be marked Processed, never pushed, never shown
  // anywhere. Confirming it's really at row 3 (past any bookmark that
  // only ever covered up to row 2) is what rules that out.
})();

// ---------------------------------------------------------------------
// Test 6 — normalizeForFingerprint's exact contract (must stay
// byte-identical to the copy in sms-parser-backend/Code.js).
// ---------------------------------------------------------------------
(function testNormalizeForFingerprintContract(){
  const { sandbox } = loadBackendSandbox();
  const f = sandbox.normalizeForFingerprint;

  // toLowerCase() runs first, so the literal "<URL>"/"<NUM>" replacement
  // text itself stays uppercase — everything else gets lowercased.
  assert(f("Get Rs.500 OFF! Visit https://bit.ly/abc123 now") === "get rs.<NUM> off! visit <URL> now",
    "lowercases the message, replaces a URL with <URL> and digit runs with <NUM>");
  assert(f("  extra   spaces   here  ") === "extra spaces here",
    "collapses repeated whitespace to a single space and trims");
  assert(f("") === "", "empty input normalizes to an empty string");
  assert(f(null) === "" && f(undefined) === "", "null/undefined are handled safely, never throw");
  assert(f("A") === f("A"), "same input always normalizes identically (deterministic)");
})();

console.log("\nDone.");
