// sms-parser-backend/tests/lockServiceRace.test.js
//
// Plain-English what this checks: a real bug found live 2026-08-26 —
// the new weekly "resync" job (Tasker resending a batch of past SMS to
// catch anything the real-time listener missed) sends many requests to
// this webhook close together. A real transaction's log entry said
// "TRANSACTION SAVED", but the row never actually showed up in the
// Sheet. Root cause: doPost() had no locking around its
// check-if-already-saved-then-append step, so two nearly-simultaneous
// executions could both check isDuplicate() at the same moment, both
// see "nothing matches yet," and both try to append — Google Sheets'
// appendRow() isn't safe against that race, and one write can silently
// vanish even though the code logged success for it.
//
// Fixed by wrapping that check-then-write step in
// LockService.getScriptLock() so every execution waits its turn.
//
// This test can't simulate TRUE concurrency (Node is single-threaded,
// Apps Script executions genuinely run in parallel) — instead it proves
// the important properties that make the fix correct:
//   1. Every real transaction still acquires the lock before checking
//      for a duplicate, and releases it afterward (proven by requiring
//      strict lock/unlock pairing in the mock — a mismatched pair
//      throws immediately, so this test would fail loudly if the real
//      code ever locked twice without releasing, or released without
//      locking).
//   2. The lock is released even when something inside throws (the
//      original scenario that motivated wrapping this in try/finally,
//      not just try) — proven by making saveTransaction throw once,
//      then confirming a completely separate, later transaction still
//      saves normally instead of deadlocking forever.
//   3. Existing behavior for a normal, single, successful transaction
//      is completely unchanged — proven by checking the real end-to-end
//      duplicate-detection + save flow still works exactly as before.
//   4. A genuine duplicate SMS still gets skipped, not double-saved —
//      the whole reason this project's resync design is safe to re-run.
//
// Run with: node sms-parser-backend/tests/lockServiceRace.test.js

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

function assertEqual(actual, expected, message){
  assert(actual === expected, message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

// A real HDFC transaction SMS (from the actual project's own real log
// data) — needs to genuinely pass isTransactionSMS() so the test
// exercises the real lock/duplicate/save path, not get filtered out
// earlier as "NOT TRANSACTION".
const REAL_SMS = "Txn Rs.109.08\nOn HDFC Bank Card 8132\nAt zomato.eternaltsp.payu@hd\nby UPI 128446210518\nOn 24-08\nNot You?\nCall 18002586161/SMS BLOCK CC 8132 to 7308080808";
const REAL_SENDER = "AD-HDFCBK-S";

function loadSandbox(){
  const appended = []; // rows written to the fake Transactions sheet
  const logged = [];   // rows written to the fake Logs sheet
  const lockEvents = []; // "lock" / "unlock" in call order

  let locked = false;

  const sandbox = {
    PropertiesService: {
      getScriptProperties: function(){ return { getProperty: function(){ return ""; } }; } // no real Gemini key — AI path is skipped/harmless either way
    },
    LockService: {
      // Strict mock: throws if waitLock is called while already locked
      // (proves the real code never double-locks), and throws if
      // releaseLock is called while NOT locked (proves it never
      // releases without having locked). This is what makes assertions
      // 1 and 2 below meaningful, not just "it didn't crash."
      getScriptLock: function(){
        return {
          waitLock: function(){
            if(locked) throw new Error("TEST FAILURE: tried to acquire the lock while already locked — real concurrent executions would collide here");
            locked = true;
            lockEvents.push("lock");
          },
          releaseLock: function(){
            if(!locked) throw new Error("TEST FAILURE: released a lock that was never acquired");
            locked = false;
            lockEvents.push("unlock");
          }
        };
      }
    },
    SpreadsheetApp: (function(){
      // getSheetByName() must return the SAME object every time it's
      // called for a given sheet name — real Code.js calls getSheet()
      // freshly from multiple places (isDuplicate, saveTransaction), and
      // a test that wants to intercept a real method (like appendRow,
      // used further below to simulate a save failure) needs that
      // override to stick across all of those calls, not just apply to
      // whichever call happened to grab a throwaway copy.
      const transactionsSheet = {
        getLastRow: function(){ return appended.length + 1; }, // +1 for a pretend header row
        getRange: function(startRow, startCol, numRows, numCols){
          // Only ever used by isDuplicate() to read the Reference column (col 7).
          return { getValues: function(){ return appended.map(function(r){ return [r[6]]; }); } };
        },
        appendRow: function(row){ appended.push(row); }
      };
      const logsSheet = { appendRow: function(row){ logged.push(row); } };
      return {
        openById: function(){
          return {
            getSheetByName: function(name){
              if(name === "Transactions") return transactionsSheet;
              if(name === "Logs") return logsSheet;
              return null;
            }
          };
        }
      };
    })(),
    ContentService: {
      createTextOutput: function(text){ return { text: text }; }
    },
    Utilities: {
      formatDate: function(date, tz, fmt){
        const d = new Date(date);
        const pad = function(n){ return String(n).padStart(2, "0"); };
        if(fmt === "HH:mm:ss") return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
        return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
      }
    },
    console: console
  };
  vm.createContext(sandbox);

  const src = fs.readFileSync(path.join(__dirname, "..", "Code.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "Code.js" });

  sandbox.__appended = appended;
  sandbox.__logged = logged;
  sandbox.__lockEvents = lockEvents;
  return sandbox;
}

function mkEvent(sms, sender, timestamp){
  return { parameter: { sms: sms, sender: sender, timestamp: String(timestamp || 1787500000) } };
}

// ---------------------------------------------------------------------
// 1 & 3. A normal, single, successful transaction — locks once, saves once.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  sandbox.doPost(mkEvent(REAL_SMS, REAL_SENDER, 1787500000));

  assertEqual(sandbox.__appended.length, 1, "a real transaction is saved exactly once");
  assertEqual(sandbox.__lockEvents.join(","), "lock,unlock", "the lock was acquired exactly once and released exactly once — proper pairing");
  const savedStatuses = sandbox.__logged.map(function(r){ return r[4]; });
  assert(savedStatuses.indexOf("TRANSACTION SAVED") !== -1, "the log correctly says TRANSACTION SAVED");
})();

// ---------------------------------------------------------------------
// 4. A genuine duplicate (same reference) is correctly skipped, not
//    double-saved — proves the resync job's "safe to re-run" design
//    still holds with the lock in place.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  sandbox.doPost(mkEvent(REAL_SMS, REAL_SENDER, 1787500000));
  sandbox.doPost(mkEvent(REAL_SMS, REAL_SENDER, 1787500000)); // the exact same SMS, sent again (e.g. resync overlapping the real-time listener)

  assertEqual(sandbox.__appended.length, 1, "the second, duplicate send did NOT create a second row");
  assertEqual(sandbox.__lockEvents.join(","), "lock,unlock,lock,unlock", "the lock was still correctly acquired and released for BOTH calls, including the one that turned out to be a duplicate");
  const statuses = sandbox.__logged.map(function(r){ return r[4]; });
  assertEqual(statuses.filter(function(s){ return s === "TRANSACTION SAVED"; }).length, 1, "exactly one SAVED entry across both calls");
  assertEqual(statuses.filter(function(s){ return s === "DUPLICATE IGNORED"; }).length, 1, "exactly one DUPLICATE IGNORED entry for the resend");
})();

// ---------------------------------------------------------------------
// 2. The lock is released even when something inside throws — proves
//    this uses try/finally, not just try. Simulated by making
//    saveTransaction throw once (by breaking the Transactions sheet
//    temporarily), then confirming a later, unrelated transaction still
//    saves normally instead of deadlocking on a lock that was never
//    released.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();

  // Break appendRow just for the FIRST call, so saveTransaction() throws.
  const realSheet = sandbox.SpreadsheetApp.openById().getSheetByName("Transactions");
  const originalAppendRow = realSheet.appendRow;
  let callCount = 0;
  realSheet.appendRow = function(row){
    callCount++;
    if(callCount === 1) throw new Error("simulated Sheets failure on the first save attempt");
    return originalAppendRow(row);
  };

  // First call: this SMS's own saveTransaction() throws internally —
  // doPost's OWN outer try/catch swallows it (logs "ERROR: ..."), same
  // as any other unexpected error already did before this fix existed.
  sandbox.doPost(mkEvent(REAL_SMS, REAL_SENDER, 1787500001));
  assertEqual(sandbox.__lockEvents.join(","), "lock,unlock", "even when saveTransaction throws, the lock is still released (finally ran)");

  // Second call: a DIFFERENT transaction (different reference, via a
  // slightly different SMS), sent right after. If the lock from the
  // first call had leaked (never released), this waitLock() call would
  // throw per the mock's strict pairing check above, and this whole
  // test would fail loudly instead of silently hanging like a real
  // deadlock would.
  const secondSms = REAL_SMS.replace("128446210518", "999999999999");
  sandbox.doPost(mkEvent(secondSms, REAL_SENDER, 1787500002));
  assertEqual(sandbox.__appended.length, 1, "the second, unrelated transaction saved normally — the lock did not leak from the first call's error");
  assertEqual(sandbox.__lockEvents.join(","), "lock,unlock,lock,unlock", "both calls show proper lock/unlock pairing, including the one that errored");
})();

console.log("\nDone.");
