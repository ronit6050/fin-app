// sms-parser-backend/tests/smsParserFalsePositives2026-09-07.test.js
//
// Plain-English what this checks: two REAL SMS messages the user
// received got wrongly logged as transactions on the live app,
// confirmed as false positives. Both fixed in Code.js on 2026-09-07:
//
// 1. "Online Payment of Rs.149 ... was credited to your card ending
//    1264" (from HDFC, a known bank sender) -- this is a credit-card
//    BILL PAYMENT landing back on the card, already logged via the
//    real bank-side debit. The existing "credit card ... payment ...
//    received" block didn't catch it because this message uses
//    different wording ("credited to your card", not "payment ...
//    received"). Fixed with a new, deliberately narrower check: a
//    "credited to your card" message is only treated as a bill-payment
//    echo (IGNORE) when the word "payment" is also present and no
//    refund wording is present -- a genuine refund ("refunded"/
//    "reversed") is let through normally instead, and a message with
//    neither signal is surfaced as UNCERTAIN rather than guessed.
//
// 2. "GROWWINVESTTECHPRIVATELIMITED ... reported your Fund bal
//    Rs.0.000 & Securities bal 0.000..." (an unrecognized sender) --
//    a broker balance report, not a transaction. The final fallback
//    ("unrecognized sender + a real rupee amount -> UNCERTAIN, don't
//    silently drop it") wrongly matched because "Rs.0.000" still has
//    a digit after "Rs.". Fixed with hasNonZeroRupeeAmount(), which
//    requires the actual number to have at least one non-zero digit --
//    a genuine transaction is never for Rs.0, but a genuinely tiny
//    real amount like Rs.0.50 still correctly counts as real money.
//
// Run with: node sms-parser-backend/tests/smsParserFalsePositives2026-09-07.test.js

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

// Same sandbox loader as smsParserRedesign.test.js -- duplicated here
// on purpose (this file is self-contained, same convention already
// used by the existing test file, no shared test-helper module exists
// in this project yet).
function loadSandbox(seedRows){

  const rows = (seedRows || []).map(function(r){ return r.slice(); });
  const logged = [];
  const lockEvents = [];
  let locked = false;

  const sandbox = {
    LockService: {
      getScriptLock: function(){
        return {
          waitLock: function(){
            if(locked) throw new Error("TEST FAILURE: tried to acquire the lock while already locked");
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
      const transactionsSheet = {
        getLastRow: function(){ return rows.length + 1; },
        getRange: function(startRow, startCol, numRows, numCols){
          return {
            getValues: function(){
              return rows.map(function(r){
                const out = [];
                for(let c=0;c<numCols;c++){
                  out.push(r[startCol - 1 + c] !== undefined ? r[startCol - 1 + c] : "");
                }
                return out;
              });
            }
          };
        },
        appendRow: function(row){ rows.push(row); }
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

  sandbox.__rows = rows;
  sandbox.__logged = logged;
  sandbox.__lockEvents = lockEvents;
  return sandbox;
}

function mkEvent(sms, sender, timestamp){
  return { parameter: { sms: sms, sender: sender, timestamp: String(timestamp || 1787500000) } };
}

// =======================================================================
// PART 1 -- the exact real message 1: "Online Payment of Rs.149 ...
//           was credited to your card ending 1264" (HDFC).
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  const realCardPaymentSms = "HDFC Bank Cardmember, Online Payment of Rs.149 vide Ref# 248BRN0JG4RDKDW was credited to your card ending 1264 On 05/SEP/2026_value Date 05/SEP/2026";

  assertEqual(sandbox.classifySms(realCardPaymentSms, "HDFCBK"), "IGNORE", "the exact real 'online payment ... credited to your card' message is now correctly ignored (a bill payment echo, already logged via the real bank-side debit)");

  sandbox.doPost(mkEvent(realCardPaymentSms, "HDFCBK", 1787500000));
  assertEqual(sandbox.__rows.length, 0, "confirmed end-to-end: doPost never saves a spurious ₹149 credit row for it");
})();

// =======================================================================
// PART 2 -- the exact real message 2: broker balance report with
//           "Rs.0.000" from an unrecognized sender.
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  const realBrokerBalanceSms = "GROWWINVESTTECHPRIVATELIMITED on 29-08-2026 reported your Fund bal Rs.0.000 & Securities bal 0.000. This excludes your Bank, DP & PMS bal with the broker-NSE";

  assertEqual(sandbox.classifySms(realBrokerBalanceSms, "GROWWINVESTTECHPRIVATELIMITED"), "IGNORE", "the exact real broker balance report (Rs.0.000, an unrecognized sender) is now correctly ignored -- an all-zero amount is never a real transaction");

  sandbox.doPost(mkEvent(realBrokerBalanceSms, "GROWWINVESTTECHPRIVATELIMITED", 1787500000));
  assertEqual(sandbox.__rows.length, 0, "confirmed end-to-end: doPost never saves a row for it");
})();

// =======================================================================
// PART 3 -- regression: a genuine merchant refund that also says
//           "credited to your card" must still be flagged/saved, not
//           swallowed by the new bill-payment-echo rule.
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  const realRefundSms = "Rs.199 has been refunded and credited to your HDFC Bank Card ending 1264 for your recent cancelled order. Ref# 128395408722";

  assertEqual(sandbox.classifySms(realRefundSms, "HDFCBK"), "TRANSACTION", "a genuine merchant refund ('refunded ... credited to your card') is still confidently recognized, not silently swallowed by the new bill-payment-echo rule");

  sandbox.doPost(mkEvent(realRefundSms, "HDFCBK", 1787500000));
  assertEqual(sandbox.__rows.length, 1, "confirmed end-to-end: a real refund is still saved as a row");
})();

// Same idea, "reversed" wording instead of "refunded".
(function(){
  const sandbox = loadSandbox();
  const realReversalSms = "Rs.99 has been reversed and credited to your HDFC Bank Card ending 1264. Ref# 128395408723";
  assertEqual(sandbox.classifySms(realReversalSms, "HDFCBK"), "TRANSACTION", "a 'reversed ... credited to your card' message is also recognized as a genuine credit, not blocked");
})();

// A "credited to your card" message with NEITHER "payment" nor a
// refund word present -- genuinely can't tell payment-echo from
// refund from the wording alone, so this must be UNCERTAIN, not a
// confident guess in either direction.
(function(){
  const sandbox = loadSandbox();
  const ambiguousSms = "Rs.75 was credited to your card ending 1264 on 05/SEP/2026";
  assertEqual(sandbox.classifySms(ambiguousSms, "HDFCBK"), "UNCERTAIN", "a 'credited to your card' message with no 'payment' word and no refund word is genuinely ambiguous -- surfaced as UNCERTAIN rather than guessed");
})();

// =======================================================================
// PART 4 -- regression: the existing "credit card ... payment ...
//           received" block must still work unchanged.
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  assertEqual(sandbox.classifySms("Your credit card payment of Rs.5000 has been received. Thank you.", "HDFCBK"), "IGNORE", "the original 'credit card ... payment ... received' echo block still works, unaffected by the new check");
})();

// =======================================================================
// PART 5 -- regression: a genuine, small, non-zero rupee amount from an
//           unrecognized sender must still be surfaced as UNCERTAIN
//           (the hasNonZeroRupeeAmount fix must not swallow real tiny
//           amounts, only genuinely all-zero ones).
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  assertEqual(sandbox.classifySms("Rs.0.50 has moved out of your account via a new payment method we don't recognize the wording for", "VK-NEWAPP-S"), "UNCERTAIN", "a genuine tiny non-zero amount (Rs.0.50) from an unrecognized sender is still surfaced as UNCERTAIN, not swallowed by the zero-amount fix");
})();

(function(){
  const sandbox = loadSandbox();
  assertEqual(sandbox.classifySms("Rs.999 has moved out of your account via a new payment method we don't recognize the wording for", "VK-NEWAPP-S"), "UNCERTAIN", "sanity check: a normal, larger real amount from an unrecognized sender is unaffected by the zero-amount fix");
})();

(function(){
  const sandbox = loadSandbox();
  assertEqual(sandbox.classifySms("Have a great day! No action needed.", "VK-RANDOM-T"), "IGNORE", "sanity check: an unrecognized sender with no rupee amount at all is still IGNORE, unaffected");
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
if(fail > 0) process.exit(1);
