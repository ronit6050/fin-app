// sms-parser-backend/tests/learnedSpamPatterns2026-09-18.test.js
//
// Plain-English what this checks: the new self-learning spam filter.
// When a promotional/spam SMS wrongly slips past classifySms() and gets
// saved as UNCERTAIN ("NEEDS REVIEW: ..." in Pending), the PWA now has a
// button letting the user say "this isn't a real transaction" -- that
// writes a row to a shared LearnedSpamPatterns sheet (from the OTHER
// Apps Script project, backend/PWA.js). This script only ever READS
// that sheet, to recognize the same junk automatically next time.
//
// THE NON-NEGOTIABLE SAFETY RULE this suite exists to prove: a learned
// pattern may ONLY ever downgrade a message classifySms() already
// decided is "UNCERTAIN" into "IGNORE". It must NEVER be checked
// against, or able to affect, a message classifySms() decided is a
// confident "TRANSACTION" -- see PART 1 below, which constructs a
// message that would classify as confident TRANSACTION, puts an
// exact-matching learned pattern in the sheet for it anyway, and
// confirms the transaction still gets saved normally, completely
// unaffected.
//
// Run with: node sms-parser-backend/tests/learnedSpamPatterns2026-09-18.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;

function assert(condition, message){
  if(!condition){
    console.error("FAIL: " + message);
    fail++;
    process.exitCode = 1;
  } else {
    pass++;
  }
}

function assertEqual(actual, expected, message){
  assert(actual === expected, message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

// Same sandbox loader pattern as the existing test files in this folder
// (each file is self-contained, no shared test-helper module exists in
// this project yet) -- extended here with a fake LearnedSpamPatterns
// sheet, since the existing loader only ever mocked Transactions/Logs.
function loadSandbox(learnedSpamRows){

  const txRows = [];
  const logged = [];
  const spamRows = (learnedSpamRows || []).map(function(r){ return r.slice(); });
  let locked = false;

  const sandbox = {
    LockService: {
      getScriptLock: function(){
        return {
          waitLock: function(){
            if(locked) throw new Error("TEST FAILURE: tried to acquire the lock while already locked");
            locked = true;
          },
          releaseLock: function(){
            if(!locked) throw new Error("TEST FAILURE: released a lock that was never acquired");
            locked = false;
          }
        };
      }
    },
    SpreadsheetApp: (function(){
      const transactionsSheet = {
        getLastRow: function(){ return txRows.length + 1; },
        getRange: function(startRow, startCol, numRows, numCols){
          return {
            getValues: function(){
              return txRows.map(function(r){
                const out = [];
                for(let c=0;c<numCols;c++){
                  out.push(r[startCol - 1 + c] !== undefined ? r[startCol - 1 + c] : "");
                }
                return out;
              });
            }
          };
        },
        appendRow: function(row){ txRows.push(row); }
      };
      const logsSheet = { appendRow: function(row){ logged.push(row); } };
      const learnedSpamSheet = {
        getLastRow: function(){ return spamRows.length + 1; },
        getRange: function(startRow, startCol, numRows, numCols){
          return {
            getValues: function(){
              return spamRows.map(function(r){
                const out = [];
                for(let c=0;c<numCols;c++){
                  out.push(r[startCol - 1 + c] !== undefined ? r[startCol - 1 + c] : "");
                }
                return out;
              });
            }
          };
        }
      };
      return {
        openById: function(){
          return {
            getSheetByName: function(name){
              if(name === "Transactions") return transactionsSheet;
              if(name === "Logs") return logsSheet;
              if(name === "LearnedSpamPatterns") return learnedSpamSheet;
              return null; // sheet doesn't exist -- must be handled without throwing
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

  sandbox.__txRows = txRows;
  sandbox.__logged = logged;
  sandbox.__spamRows = spamRows;
  return sandbox;
}

function mkEvent(sms, sender, timestamp){
  return { parameter: { sms: sms, sender: sender, timestamp: String(timestamp || 1787500000) } };
}

function lastLogStatus(sandbox){
  const last = sandbox.__logged[sandbox.__logged.length - 1];
  return last ? last[4] : undefined;
}

// =======================================================================
// PART 0 -- normalizeForFingerprint() basic behavior (must match the
// exact given logic, since a separate copy in the other project's
// PWA.js must produce byte-identical output for the same input).
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  assertEqual(
    sandbox.normalizeForFingerprint("Get a Loan on your HDFC Bank Credit Card @ ZERO Processing Fee! Apply now: https://1.hdfc.bank.in/HDFCBK/s/V6JLK9Rx"),
    "get a loan on your hdfc bank credit card @ zero processing fee! apply now: <URL>",
    "normalizeForFingerprint lowercases, replaces URLs with <URL>, and replaces digit runs with <NUM> (no digits in this example besides the URL, so ZERO stays a word)"
  );
  assertEqual(
    sandbox.normalizeForFingerprint("Rs.500 debited, Ref 128395408722"),
    "rs.<NUM> debited, ref <NUM>",
    "normalizeForFingerprint lowercases the message text but the <NUM>/<URL> replacement tokens themselves stay uppercase (inserted after the lowercase step)"
  );
  assertEqual(
    sandbox.normalizeForFingerprint("  extra   spaces   here  "),
    "extra spaces here",
    "normalizeForFingerprint collapses whitespace and trims"
  );
  assertEqual(sandbox.normalizeForFingerprint(""), "", "normalizeForFingerprint handles empty text");
  assertEqual(sandbox.normalizeForFingerprint(undefined), "", "normalizeForFingerprint handles undefined without throwing");
})();

// =======================================================================
// PART 1 -- THE SAFETY INVARIANT. A message that classifies as a
// confident TRANSACTION must be saved normally, completely unaffected
// by a learned pattern, even when that pattern is an EXACT match for
// this exact message's sender + normalized text.
// =======================================================================

(function(){
  const realTransactionSms = "Rs.500.00 debited from HDFC Bank A/C x8774 to VPA merchant@okhdfcbank on 05-09-2026. Ref 128395408722. Not you? Call 18002586161";
  const sender = "HDFCBK";

  const sandbox = loadSandbox();

  // Sanity check first: confirm this message really is a confident
  // TRANSACTION classification (test integrity, not testing the
  // learned-pattern feature itself). The template planted below is
  // computed via normalizeForFingerprint() itself, not hand-typed, so
  // this test can't drift from the real function's actual behavior.
  assertEqual(sandbox.classifySms(realTransactionSms, sender), "TRANSACTION", "sanity check: this message classifies as a confident TRANSACTION");
  const normalizedTemplate = sandbox.normalizeForFingerprint(realTransactionSms);
  assert(normalizedTemplate.length >= 20, "sanity check: the planted template clears the minimum-specificity guard");

  // Now plant an exact-matching learned "spam" pattern for this exact
  // sender + exact normalized text -- as if (wrongly) the user had
  // marked this real transaction as junk.
  sandbox.__spamRows.push(["2026-09-18", sender, normalizedTemplate, realTransactionSms]);

  sandbox.doPost(mkEvent(realTransactionSms, sender, 1787500000));

  assertEqual(sandbox.__txRows.length, 1, "SAFETY INVARIANT: a confident TRANSACTION is still saved even with an exact-matching learned pattern present");
  assertEqual(lastLogStatus(sandbox), "TRANSACTION SAVED", "SAFETY INVARIANT: the log reflects a normal save, not any learned-pattern path");
  assert(String(sandbox.__txRows[0][7] || "").indexOf("NEEDS REVIEW") === -1, "SAFETY INVARIANT: the saved row is not flagged NEEDS REVIEW -- it was never touched by the learned-pattern check at all");
})();

// =======================================================================
// PART 2 -- a genuine UNCERTAIN message with a matching sender +
// normalized-template learned pattern gets IGNORED.
// =======================================================================

(function(){
  // A known-sender message with wording classifySms() doesn't recognize
  // -- lands as UNCERTAIN by design (see Code.js's Step 3 comment).
  const uncertainSms = "HDFC Bank: Your account statement for card ending 1264 is now ready to download from NetBanking. Check it out today!";
  const sender = "HDFCBK";

  const sandbox = loadSandbox();
  const classification = sandbox.classifySms(uncertainSms, sender);
  assertEqual(classification, "UNCERTAIN", "sanity check: this message classifies as UNCERTAIN (known sender, unrecognized wording)");

  const normalizedTemplate = sandbox.normalizeForFingerprint(uncertainSms);
  assert(normalizedTemplate.length >= 20, "sanity check: the template is long enough to clear the minimum-specificity guard");

  sandbox.__spamRows.push(["2026-09-17", sender, normalizedTemplate, uncertainSms]);

  sandbox.doPost(mkEvent(uncertainSms, sender, 1787500000));

  assertEqual(sandbox.__txRows.length, 0, "a matching learned pattern downgrades this UNCERTAIN message to IGNORE -- nothing saved to Transactions");
  assertEqual(lastLogStatus(sandbox), "IGNORED (LEARNED PATTERN)", "the log shows the distinct learned-pattern reason, visible for troubleshooting");
})();

// =======================================================================
// PART 3 -- same normalized template, but a DIFFERENT sender, does NOT
// match (sender must match too).
// =======================================================================

(function(){
  const uncertainSms = "HDFC Bank: Your account statement for card ending 1264 is now ready to download from NetBanking. Check it out today!";
  const realSender = "HDFCBK";
  const otherSender = "AXISBK"; // learned pattern was for a different sender

  const sandbox = loadSandbox();
  const normalizedTemplate = sandbox.normalizeForFingerprint(uncertainSms);

  sandbox.__spamRows.push(["2026-09-17", otherSender, normalizedTemplate, uncertainSms]);

  sandbox.doPost(mkEvent(uncertainSms, realSender, 1787500000));

  assertEqual(sandbox.__txRows.length, 1, "a learned pattern for a DIFFERENT sender does not match -- message still saved (as UNCERTAIN/NEEDS REVIEW)");
  assertEqual(lastLogStatus(sandbox), "TRANSACTION SAVED", "the log reflects a normal UNCERTAIN save, not the learned-pattern path");
  assert(String(sandbox.__txRows[0][7] || "").indexOf("NEEDS REVIEW") !== -1, "the saved row is still flagged NEEDS REVIEW, exactly as an ordinary unmatched UNCERTAIN message would be");
})();

// =======================================================================
// PART 4 -- a close-but-not-exact text variation does NOT match
// (matching is exact-on-normalized-text, not fuzzy).
// =======================================================================

(function(){
  const learnedSms = "HDFC Bank: Your account statement for card ending 1264 is now ready to download from NetBanking. Check it out today!";
  const differentWordingSms = "HDFC Bank: Your monthly statement for card ending 1264 is now available to view on NetBanking. Take a look today!";
  const sender = "HDFCBK";

  const sandbox = loadSandbox();

  assertEqual(sandbox.classifySms(differentWordingSms, sender), "UNCERTAIN", "sanity check: the differently-worded message also classifies as UNCERTAIN");

  const learnedTemplate = sandbox.normalizeForFingerprint(learnedSms);
  const incomingTemplate = sandbox.normalizeForFingerprint(differentWordingSms);
  assert(learnedTemplate !== incomingTemplate, "sanity check: the two normalized templates are genuinely different (different wording, not just a different number/URL)");

  sandbox.__spamRows.push(["2026-09-17", sender, learnedTemplate, learnedSms]);

  sandbox.doPost(mkEvent(differentWordingSms, sender, 1787500000));

  assertEqual(sandbox.__txRows.length, 1, "a close-but-not-exact wording variation does not match the learned pattern -- still saved as UNCERTAIN");
  assert(String(sandbox.__txRows[0][7] || "").indexOf("NEEDS REVIEW") !== -1, "the saved row is flagged NEEDS REVIEW, unaffected by the near-miss learned pattern");
})();

// =======================================================================
// PART 5 -- the too-short/too-generic guard actually prevents a short
// learned template from matching.
// =======================================================================

(function(){
  // Deliberately short/generic -- would normalize to something under 20
  // characters if it were the whole message. We construct an UNCERTAIN
  // message whose real normalized text genuinely equals this short
  // stored template, to prove the guard blocks it specifically because
  // of length, not because of a mismatch.
  const shortSms = "Rs.5 credited";
  const sender = "HDFCBK";

  const sandbox = loadSandbox();

  const normalizedTemplate = sandbox.normalizeForFingerprint(shortSms);
  assert(normalizedTemplate.length < 20, "sanity check: this stored template is genuinely under the 20-character minimum");

  sandbox.__spamRows.push(["2026-09-17", sender, normalizedTemplate, shortSms]);

  // matchesLearnedSpamPattern is called directly here (rather than via
  // doPost) since classifySms() would likely not even produce UNCERTAIN
  // for such a short, ambiguous string -- this isolates the guard itself.
  const matched = sandbox.matchesLearnedSpamPattern(sender, shortSms);
  assertEqual(matched, false, "a too-short/generic learned template (under 20 chars) is never treated as a match, even with an exact sender+text match");
})();

// A second angle on the same guard: a long enough INCOMING message, but
// the guard is also re-checked against the STORED row's own template
// length (defense in depth, in case the writer's own guard is ever
// missing/wrong) -- simulate a short stored template paired with a
// coincidentally-short normalized incoming text.
(function(){
  const sandbox = loadSandbox();
  const sender = "HDFCBK";
  const shortStoredTemplate = "rs <NUM> credited"; // under 20 chars
  sandbox.__spamRows.push(["2026-09-17", sender, shortStoredTemplate, "Rs.5 credited"]);

  const matched = sandbox.matchesLearnedSpamPattern(sender, "Rs.5 credited");
  assertEqual(matched, false, "a short stored template row is skipped even if it would otherwise exact-match the incoming text");
})();

// =======================================================================
// PART 6 -- no LearnedSpamPatterns sheet at all (nobody has used the
// feature yet) must not throw, and must behave exactly like "no match".
// =======================================================================

(function(){
  // loadSandbox with undefined learnedSpamRows still creates the sheet
  // object (getSheetByName returns a real, empty sheet) -- to actually
  // simulate the sheet not existing at all, this test needs its own
  // sandbox where getSheetByName returns null for that name specifically.
  // Reuse loadSandbox's internals is overkill here -- simplest accurate
  // simulation: directly call matchesLearnedSpamPattern in a sandbox
  // whose SpreadsheetApp.openById().getSheetByName("LearnedSpamPatterns")
  // returns null (already true whenever spamRows is never queried --
  // but loadSandbox always registers the sheet). So build a minimal
  // one-off sandbox here instead, matching the real "sheet not found"
  // case precisely.
  const src = fs.readFileSync(path.join(__dirname, "..", "Code.js"), "utf8");
  const sandbox = {
    LockService: { getScriptLock: function(){ return { waitLock: function(){}, releaseLock: function(){} }; } },
    SpreadsheetApp: {
      openById: function(){
        return {
          getSheetByName: function(name){
            if(name === "Transactions") return { getLastRow: function(){ return 1; }, appendRow: function(){} };
            if(name === "Logs") return { appendRow: function(){} };
            return null; // LearnedSpamPatterns genuinely doesn't exist yet
          }
        };
      }
    },
    ContentService: { createTextOutput: function(text){ return { text: text }; } },
    Utilities: { formatDate: function(){ return ""; } },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "Code.js" });

  let threw = false;
  let matched;
  try{
    matched = sandbox.matchesLearnedSpamPattern("HDFCBK", "Some genuinely uncertain message text that is long enough to pass the guard");
  }catch(err){
    threw = true;
  }

  assertEqual(threw, false, "matchesLearnedSpamPattern never throws when the LearnedSpamPatterns sheet doesn't exist yet");
  assertEqual(matched, false, "with no LearnedSpamPatterns sheet at all, matchesLearnedSpamPattern correctly behaves as 'no match'");
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
if(fail > 0) process.exit(1);
