// sms-parser-backend/tests/smsParserRedesign.test.js
//
// Plain-English what this checks: the full from-scratch rewrite of
// Code.js done 2026-08-27 -- removed AI/Gemini from the parsing path,
// added a third "UNCERTAIN -- needs review" outcome instead of silently
// dropping anything unrecognized, fixed several real gaps found by
// analyzing the user's actual 4,498-row Logs sheet (Jupiter/PayZapp
// senders, ICICI salary wording, "paid" as a debit word, AutoPay/
// without-OTP formats, a "withdrawn" type-detection gap), and rebuilt
// duplicate detection to fix the real incident from 2026-08-26 where
// the weekly Tasker resync inserted transactions that were already in
// the Sheet.
//
// Given the user's explicit "no goofups" instruction after that
// incident, this file deliberately over-tests the duplicate-detection
// redesign specifically -- including the exact failure mode that must
// NOT regress (two different real transactions, same day, same amount,
// must never be treated as duplicates of each other).
//
// Run with: node sms-parser-backend/tests/smsParserRedesign.test.js

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

// ---------------------------------------------------------------------
// Sandbox loader. Each test gets a FRESH sandbox with its own in-memory
// Transactions/Logs sheet, so tests never leak state into each other.
// The fake Transactions sheet supports seeding pre-existing rows (to
// simulate a Sheet that already has real data in it, e.g. a
// statement-reconciled row with a NOREF_ reference) via seedRows.
// ---------------------------------------------------------------------
function loadSandbox(seedRows){

  // Each row: [Date, Time, Bank, Type, Mode, Amount, Reference, Counterparty, Channel, Source, RawSMS, Sender]
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
        getLastRow: function(){ return rows.length + 1; }, // +1 for a pretend header row
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

function lastLogStatus(sandbox){
  return sandbox.__logged[sandbox.__logged.length - 1][4];
}

// =======================================================================
// PART 1 -- classifySms() : IGNORE / TRANSACTION / UNCERTAIN
// =======================================================================

(function(){
  const sandbox = loadSandbox();

  assertEqual(sandbox.classifySms("Your OTP is 4567, do not share.", "AD-HDFCBK-S"), "IGNORE", "a real OTP message is ignored");
  assertEqual(sandbox.classifySms("Earn 500 reward points on your next purchase!", "AD-HDFCBK-S"), "IGNORE", "a rewards-points promo is ignored");
  assertEqual(sandbox.classifySms("Get instant EMI on your purchase, check eligibility now", "AD-HDFCBK-S"), "IGNORE", "an EMI offer with no money-movement word is ignored");
  assertEqual(sandbox.classifySms("Your EMI of Rs.4000 will be debited on 05-09", "AD-HDFCBK-S"), "IGNORE", "a future-dated EMI debit alert is ignored (money hasn't moved yet)");
  assertEqual(sandbox.classifySms("Your credit card payment of Rs.5000 has been received. Thank you.", "AD-HDFCBK-S"), "IGNORE", "a CC-payment-received confirmation is ignored (redundant with the real bank-side debit)");

})();

(function(){
  const sandbox = loadSandbox();

  assertEqual(sandbox.classifySms("Rs.500.00 debited from A/c XX1234 on 27-08-26. Info: UPI/DR/128395408722/SWIGGY. Avl Bal Rs.10000.00", "AD-HDFCBK-S"), "TRANSACTION", "a normal HDFC debit is confidently recognized");
  assertEqual(sandbox.classifySms("Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08", "AD-HDFCBK-S"), "TRANSACTION", "the real HDFC card-txn format is confidently recognized");
  assertEqual(sandbox.classifySms("Rs.30 Deducted From PayZapp Wallet On 23-08-2026 13:52:38 Bal: Rs.172.24", "VD-PAYZAP-S"), "TRANSACTION", "a real PayZapp wallet deduction is confidently recognized (sender fix)");
  assertEqual(sandbox.classifySms("Credit of Rs.45000.00 has been initiated to your A/c XX1234", "JX-ICICIO-S"), "TRANSACTION", "real ICICI salary wording is confidently recognized (new 'credit of' phrase)");
  assertEqual(sandbox.classifySms("Rs.500 paid to AMAZON via UPI. Ref 128395408722", "AD-HDFCBK-S"), "TRANSACTION", "a message using 'paid' (new debit word) is confidently recognized");
  assertEqual(sandbox.classifySms("AutoPay (E-mandate) Success for Rs.199 towards NETFLIX", "AD-HDFCBK-S"), "TRANSACTION", "a real AutoPay success message is confidently recognized");
  assertEqual(sandbox.classifySms("Rs.89 without OTP/PIN HDFC Bank Card x1264 At SPOTIFY", "AD-HDFCBK-S"), "TRANSACTION", "a card charge 'without OTP' is confidently recognized");
  assertEqual(sandbox.classifySms("Rs.2000 withdrawn from HDFC ATM XX1234 on 27-08", "AD-HDFCBK-S"), "TRANSACTION", "an ATM withdrawal is confidently recognized");
  assertEqual(sandbox.classifySms("Rs.150 debited via UPI, sent from your Jupiter account", "IM-ONJPTR-S"), "TRANSACTION", "a Jupiter-sender debit is confidently recognized (sender fix)");

})();

(function(){
  const sandbox = loadSandbox();

  assertEqual(sandbox.classifySms("Your HDFC account statement is now ready to download.", "AD-HDFCBK-S"), "UNCERTAIN", "a known bank sender with unrecognized wording is UNCERTAIN, not dropped");
  assertEqual(sandbox.classifySms("Rs.999 has moved out of your account via a new payment method we don't recognize the wording for", "VK-NEWAPP-S"), "UNCERTAIN", "an unknown sender with a real rupee amount is UNCERTAIN, not dropped");
  assertEqual(sandbox.classifySms("Have a great day! No action needed.", "VK-RANDOM-T"), "IGNORE", "an unknown sender with no rupee amount at all is IGNORE");

})();

// =======================================================================
// PART 2 -- ruleParser() field extraction, including bug fixes
// =======================================================================

(function(){
  const sandbox = loadSandbox();

  const tx = sandbox.ruleParser("Rs.2000 withdrawn from HDFC ATM XX1234 on 27-08", "AD-HDFCBK-S");
  assertEqual(tx.type, "debit", "a 'withdrawn' message now correctly gets Type=debit (was a real gap: recognized as a transaction but saved with a blank Type)");
})();

(function(){
  const sandbox = loadSandbox();
  const tx = sandbox.ruleParser("Rs.500 paid to AMAZON via UPI. Ref 128395408722", "AD-HDFCBK-S");
  assertEqual(tx.type, "debit", "'paid' correctly maps to Type=debit");
  assertEqual(tx.amount, "500", "amount extracted correctly from a 'paid' message");
})();

(function(){
  const sandbox = loadSandbox();
  const tx = sandbox.ruleParser("Credit of Rs.45000.00 has been initiated to your A/c XX1234", "JX-ICICIO-S");
  assertEqual(tx.type, "credit", "'credit of' phrasing correctly maps to Type=credit");
  assertEqual(tx.bank, "ICICI", "ICICI sender correctly recognized (was already in the sender list -- 'ICICIO' contains 'ICICI')");
})();

(function(){
  const sandbox = loadSandbox();
  const tx = sandbox.ruleParser("Rs.30 Deducted From PayZapp Wallet On 23-08-2026 13:52:38 Bal: Rs.172.24", "VD-PAYZAP-S");
  assertEqual(tx.bank, "PAYZAPP", "PAYZAP sender now correctly gets Bank=PAYZAPP");
  assertEqual(tx.mode, "wallet", "PayZapp deduction still correctly gets Mode=wallet");
})();

(function(){
  const sandbox = loadSandbox();
  const tx = sandbox.ruleParser("Rs.150 debited via UPI, sent from your Jupiter account", "IM-ONJPTR-S");
  assertEqual(tx.bank, "JUPITER", "ONJPTR sender now correctly gets Bank=JUPITER");
})();

(function(){
  const sandbox = loadSandbox();
  const tx = sandbox.ruleParser("Rs.500 credited to A/c XX1234 via PAYTM. Ref 999888777666", "ATPAYTM");
  assertEqual(tx.bank, "PAYTM", "PAYTM sender now correctly gets a Bank value (was missing from ruleParser's bank list before, even though it was already a known sender)");
})();

// =======================================================================
// PART 3 -- UNCERTAIN rows are saved, flagged, and still show up in the
//           Sheet (not silently dropped)
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  sandbox.doPost(mkEvent("Your HDFC account statement is now ready to download.", "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__rows.length, 1, "an UNCERTAIN message is still saved as a row, not dropped");
  assert(sandbox.__rows[0][7].indexOf("NEEDS REVIEW:") === 0, "the saved row's Counterparty is prefixed 'NEEDS REVIEW:' so it's obvious in Pending");
  assertEqual(lastLogStatus(sandbox), "TRANSACTION SAVED", "the log still shows the row was saved");
  const uncertainLog = sandbox.__logged.filter(function(r){ return r[4] === "UNCERTAIN - NEEDS REVIEW"; });
  assertEqual(uncertainLog.length, 1, "a distinct 'UNCERTAIN - NEEDS REVIEW' log entry was written");
})();

(function(){
  const sandbox = loadSandbox();
  sandbox.doPost(mkEvent("Have a great day! No action needed.", "VK-RANDOM-T", 1787500000));

  assertEqual(sandbox.__rows.length, 0, "a true IGNORE message (no bank sender, no rupee amount) is still never saved");
})();

// =======================================================================
// PART 4 -- AI removed entirely
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  assertEqual(typeof sandbox.shouldUseAI, "undefined", "shouldUseAI no longer exists");
  assertEqual(typeof sandbox.verifyWithAI, "undefined", "verifyWithAI no longer exists");
  assertEqual(typeof sandbox.callGemini, "undefined", "callGemini no longer exists");
  const usedAiLog = function(sandbox){ return sandbox.__logged.filter(function(r){ return r[4] === "AI USED" || r[4] === "AI FAILED"; }); };

  const s2 = loadSandbox();
  s2.doPost(mkEvent("Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08", "AD-HDFCBK-S", 1787500000));
  assertEqual(usedAiLog(s2).length, 0, "no AI-related log entries appear for a normal transaction anymore");
})();

// =======================================================================
// PART 5 -- Duplicate detection, all three tiers, including the exact
//           failure modes that must NOT regress.
// =======================================================================

// --- Tier 1: real reference vs real reference -----------------------
(function(){
  const sandbox = loadSandbox();
  const sms1 = "Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08";
  sandbox.doPost(mkEvent(sms1, "AD-HDFCBK-S", 1787500000));
  sandbox.doPost(mkEvent(sms1, "AD-HDFCBK-S", 1787500000)); // exact resend

  assertEqual(sandbox.__rows.length, 1, "tier 1: the exact same SMS resent (same real reference) is correctly caught as a duplicate, not double-saved");
})();

// --- THE CRITICAL CASE: two DIFFERENT real transactions, same day, ---
// --- same amount, DIFFERENT real references -- must NOT be merged. ---
(function(){
  const sandbox = loadSandbox();
  const smsA = "Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128395408722 On 24-08";
  const smsB = "Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128372513732 On 24-08";
  sandbox.doPost(mkEvent(smsA, "AD-HDFCBK-S", 1787500000));
  sandbox.doPost(mkEvent(smsB, "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__rows.length, 2, "CRITICAL: two genuinely different real transactions (same day, same amount, different real references) must both be saved, never merged as duplicates -- this exact scenario happened for real (two Zomato orders)");
})();

// --- Tier 2: reference-less message type (wallet), exact resend ------
(function(){
  const sandbox = loadSandbox();
  const walletSms = "Rs.30 Deducted From PayZapp Wallet On 23-08-2026 13:52:38 Bal: Rs.172.24";
  sandbox.doPost(mkEvent(walletSms, "VD-PAYZAP-S", 1787500000));
  sandbox.doPost(mkEvent(walletSms, "VD-PAYZAP-S", 1787500000)); // e.g. resync overlapping the real-time listener

  assertEqual(sandbox.__rows.length, 1, "tier 2: the exact same reference-less wallet SMS resent is correctly caught as a duplicate via raw-text match");
})();

// --- The scenario tier 2 must NOT break: two DIFFERENT wallet ---------
// --- deductions, same day, same amount, no reference on either. ------
(function(){
  const sandbox = loadSandbox();
  const walletSmsMorning = "Rs.30 Deducted From PayZapp Wallet On 23-08-2026 09:15:02 Bal: Rs.500.00";
  const walletSmsEvening = "Rs.30 Deducted From PayZapp Wallet On 23-08-2026 18:42:19 Bal: Rs.220.00";
  sandbox.doPost(mkEvent(walletSmsMorning, "VD-PAYZAP-S", 1787500000));
  sandbox.doPost(mkEvent(walletSmsEvening, "VD-PAYZAP-S", 1787500000));

  assertEqual(sandbox.__rows.length, 2, "two genuinely different same-day, same-amount, reference-less wallet purchases must both be saved -- the old code already got this right (blank reference always skipped the check), the redesign must not regress it");
})();

// --- Tier 3: the ACTUAL bug from 2026-08-26 -- a statement-reconciled -
// --- row (NOREF_ placeholder) matched by a later real SMS resync. ----
(function(){
  // Seed a pre-existing row as if it came from CC-statement
  // reconciliation: Reference = "NOREF_12", RawSMS = "-" (reconciled
  // rows never have real SMS text), same shape insertReconciledTransactions
  // in the main backend actually writes.
  const seedRow = ["2026-08-23","00:00:00","HDFC","debit","card 8132","109.08","NOREF_12","ZOMATO","Import","Bank Statement","-","-"];
  const sandbox = loadSandbox([seedRow]);

  const realSms = "Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08";
  sandbox.doPost(mkEvent(realSms, "AD-HDFCBK-S", 1787500000)); // 1787500000 -> 2026-08-24 UTC

  assertEqual(sandbox.__rows.length, 1, "tier 3: a real SMS resync for a transaction already recovered via statement reconciliation (NOREF_ placeholder) is correctly recognized as the same transaction, not duplicated -- this is the exact bug that caused the 2026-08-26 incident");
  const dupLog = sandbox.__logged.filter(function(r){ return String(r[4]).indexOf("DUPLICATE IGNORED") === 0; });
  assertEqual(dupLog.length, 1, "a DUPLICATE IGNORED log entry was written for the tier-3 match");
})();

// --- Tier 3 must stay narrow: a genuinely different real transaction --
// --- on the same day/amount as an unrelated NOREF_ row must NOT match.
(function(){
  const seedRow = ["2026-08-23","00:00:00","HDFC","debit","card 8132","109.08","NOREF_12","SOME OTHER MERCHANT","Import","Bank Statement","-","-"];
  const sandbox = loadSandbox([seedRow]);

  // A different real transaction, same day, same amount, same type,
  // but a genuinely different purchase -- date+amount+type coincidence.
  const differentRealSms = "Txn Rs.109.08 On HDFC Bank Card 8132 At swiggy.instamart.payu@hd by UPI 999888777666 On 24-08";
  sandbox.doPost(mkEvent(differentRealSms, "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__rows.length, 2, "a coincidental date+amount+type match against an UNRELATED NOREF_ row (different merchant) must not suppress a genuinely different real transaction -- caught by this test, fixed with a counterparty check in tier 3");
})();

// --- THE BUG FOUND BY change-reviewer 2026-08-27: a real HDFC format --
// --- ("Info: UPI/DR/ref/MERCHANT") that used to extract NO ------------
// --- counterparty at all, which let tier 3 silently drop a genuinely --
// --- different real transaction against an unrelated NOREF_ row. ------
(function(){
  const seedRow = ["2026-08-23","00:00:00","HDFC","debit","card 8132","500.00","NOREF_99","SWIGGY","Import","Bank Statement","-","-"];
  const sandbox = loadSandbox([seedRow]);

  // A genuinely different real transaction: different merchant
  // (BIGBAZAAR, not SWIGGY), same day, same amount, same type as the
  // unrelated placeholder row above -- but this specific SMS format
  // has no "to"/"at"/"towards"/"for" wording.
  const differentRealSms = "Rs.500.00 debited from A/c XX1234 on 23-08-26. Info: UPI/DR/999888777666/BIGBAZAAR. Avl Bal Rs.10000.00";
  sandbox.doPost(mkEvent(differentRealSms, "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__rows.length, 2, "CRITICAL (found by change-reviewer): a real transaction in the 'Info: UPI/DR/ref/MERCHANT' format, coincidentally matching an unrelated NOREF_ placeholder row on date+amount+type, must still be saved -- must never be silently dropped just because no counterparty could be verified");
  assertEqual(sandbox.__rows[1][7], "bigbazaar", "the new counterparty-extraction fallback correctly pulls the merchant name out of the 'UPI/DR/ref/MERCHANT' format (lowercase, consistent with every other counterparty extraction in this file, which all operate on the lowercased text)");
})();

// --- The real tier-3 match still works once BOTH sides have a name ----
// --- extracted via the new 'Info: UPI/DR/ref/MERCHANT' fallback. ------
(function(){
  const seedRow = ["2026-08-23","00:00:00","HDFC","debit","card 8132","500.00","NOREF_99","SWIGGY","Import","Bank Statement","-","-"];
  const sandbox = loadSandbox([seedRow]);

  const realSms = "Rs.500.00 debited from A/c XX1234 on 23-08-26. Info: UPI/DR/128395408722/SWIGGY. Avl Bal Rs.10000.00";
  sandbox.doPost(mkEvent(realSms, "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__rows.length, 1, "a genuine tier-3 match (same merchant, extracted via the new fallback) still correctly recognizes the resynced SMS as the same transaction, not a duplicate");
})();

// =======================================================================
// PART 5b -- other fixes found by change-reviewer 2026-08-27
// =======================================================================

// Revised 2026-08-27, after change-reviewer flagged that letting
// spam+money combos through as confident TRANSACTION opens a
// different door (a fake promo using realistic wording gets trusted
// as real). Both directions of ambiguity now land in UNCERTAIN
// instead -- never silently dropped, never blindly trusted either.
(function(){
  const sandbox = loadSandbox();
  assertEqual(
    sandbox.classifySms("Rs.500.00 debited from A/c XX1234. You earned 5 reward points on this purchase. Info: UPI/DR/128395408722/AMAZON", "AD-HDFCBK-S"),
    "UNCERTAIN",
    "a real debit confirmation that also mentions 'reward points' as a footer is surfaced for review (not silently dropped as pure spam, not blindly auto-trusted either)"
  );
  assertEqual(
    sandbox.classifySms("Rs.50 cashback credited to your PayZapp wallet as a reward! Use code SAVE50 on your next purchase.", "VD-PAYZAP-S"),
    "UNCERTAIN",
    "the flip side change-reviewer found: a purely promotional message using realistic money wording ('credited') must NOT be confidently logged as a real transaction -- surfaced for review instead"
  );
  assertEqual(
    sandbox.classifySms("Earn 500 reward points on your next purchase! Redeem now.", "AD-HDFCBK-S"),
    "IGNORE",
    "a pure rewards-points promo (no money-movement word at all) is still correctly ignored outright"
  );
})();

// A reference number is compared numerically, tolerating a leading
// zero that Google Sheets may have silently dropped by auto-converting
// a numeric-looking cell into a real Number.
(function(){
  const seedRow = ["2026-08-23","00:00:00","HDFC","debit","card 8132","109.08","128446210518","ZOMATO","SMS","Tasker","some raw sms text","AD-HDFCBK-S"];
  // Simulate Sheets having stored the reference as an actual Number
  // (dropping a leading zero) rather than as text.
  seedRow[6] = 128446210518;
  const sandbox = loadSandbox([seedRow]);

  const sms = "Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 0128446210518 On 24-08";
  sandbox.doPost(mkEvent(sms, "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__rows.length, 1, "a reference match still works when Sheets stored the existing reference as a Number instead of text (numeric comparison, not strict text equality)");
})();

// =======================================================================
// PART 6 -- lock still wraps correctly (regression check against the
//           2026-08-26 race-condition fix -- must not have been lost)
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  sandbox.doPost(mkEvent("Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08", "AD-HDFCBK-S", 1787500000));

  assertEqual(sandbox.__lockEvents.join(","), "lock,unlock", "the lock is still acquired exactly once and released exactly once for a normal transaction");
})();

(function(){
  const sandbox = loadSandbox();

  const realSheet = sandbox.SpreadsheetApp.openById().getSheetByName("Transactions");
  const originalAppendRow = realSheet.appendRow;
  let callCount = 0;
  realSheet.appendRow = function(row){
    callCount++;
    if(callCount === 1) throw new Error("simulated Sheets failure");
    return originalAppendRow(row);
  };

  sandbox.doPost(mkEvent("Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08", "AD-HDFCBK-S", 1787500001));
  assertEqual(sandbox.__lockEvents.join(","), "lock,unlock", "the lock is still released even when saveTransaction throws (try/finally preserved)");

  sandbox.doPost(mkEvent("Txn Rs.200.00 On HDFC Bank Card 8132 At AMAZON by UPI 555444333222 On 24-08", "AD-HDFCBK-S", 1787500002));
  assertEqual(sandbox.__rows.length, 1, "a later unrelated transaction still saves normally -- the lock did not leak from the earlier error");
})();

// =======================================================================
// PART 7 -- real live bug found right after the first deploy, 2026-08-27
//           ("Get a Loan on your HDFC Bank Credit Card @ ZERO
//           Processing Fee... https://1.hdfc.bank.in/HDFCBK/s/V6JLK9Rx")
//           got saved as UNCERTAIN within minutes of going live.
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  // The exact real message reported (line breaks preserved).
  const realPromoSms = "Last chance! \nGet a Loan on your HDFC Bank Credit Card @ ZERO Processing Fee. Book online before it's gone: https://1.hdfc.bank.in/HDFCBK/s/V6JLK9Rx\nT";

  assertEqual(sandbox.classifySms(realPromoSms, "AD-HDFCBK-S"), "IGNORE", "the exact real loan-offer promo message (containing a URL, no money word) is now correctly ignored outright, not saved as UNCERTAIN");

  sandbox.doPost(mkEvent(realPromoSms, "AD-HDFCBK-S", 1787500000));
  assertEqual(sandbox.__rows.length, 0, "and confirmed end-to-end: doPost never saves a row for it");
})();

(function(){
  const sandbox = loadSandbox();
  assertEqual(sandbox.classifySms("Special offer! Check out our new Personal Loan scheme, apply now for instant approval.", "AD-HDFCBK-S"), "IGNORE", "a loan-offer promo with NO url at all is still caught (defense-in-depth via the 'loan' keyword, not just the url check)");
})();

(function(){
  const sandbox = loadSandbox();
  // A real transaction confirmation would never normally contain a
  // URL -- but if a money word happens to be present alongside a link
  // for some other real reason, don't confidently drop it OR trust it,
  // same ambiguous-signal handling as the reward/points case.
  assertEqual(sandbox.classifySms("Rs.500 debited from your account. Track your spend: https://bank.example.com/track", "AD-HDFCBK-S"), "UNCERTAIN", "a message combining a real money word with a URL is treated as ambiguous (UNCERTAIN), not confidently ignored or confidently trusted");
})();

(function(){
  const sandbox = loadSandbox();
  // Sanity check: none of the OTHER real confident-TRANSACTION
  // messages in this suite contain a URL, so this new check shouldn't
  // have disturbed any of them -- spot-check a few directly.
  assertEqual(sandbox.classifySms("Rs.30 Deducted From PayZapp Wallet On 23-08-2026 13:52:38 Bal: Rs.172.24", "VD-PAYZAP-S"), "TRANSACTION", "a normal wallet deduction (no URL) is still confidently recognized, unaffected by the new link check");
  assertEqual(sandbox.classifySms("Credit of Rs.45000.00 has been initiated to your A/c XX1234", "JX-ICICIO-S"), "TRANSACTION", "a normal salary credit (no URL) is still confidently recognized, unaffected by the new link check");
})();

// =======================================================================
// PART 8 -- second real live bug, found minutes after the loan/URL fix
//           deployed (2026-08-28): an RCS "rich card" promotional
//           message (a JSON payload, not plain SMS text) got saved
//           because its marketing copy said "...is credited directly
//           to your bank account" -- a real money word describing a
//           hypothetical loan payout, not an actual transaction.
// =======================================================================

(function(){
  const sandbox = loadSandbox();

  // The exact real RCS rich-card payload reported by the user.
  const realRichCardSms = '{\n  "message": {\n    "generalPurposeCard": {\n      "layout": {\n        "cardOrientation": "VERTICAL"\n      },\n      "content": {\n        "title": "ENDING TODAY - ZERO PROCESSING FEEon a Rs. 225000 Loan on your card",\n        "description": "Avail a Loan on your Credit Card xx1264 with no additional charges, valid till TODAY!\\n\\n Zero processing fee\\n Zero stamp duty\\n Zero Documentation\\n\\nThe full loan amount is credited directly to your bank account.\\n\\nT&C Apply",\n        "media": {\n          "mediaUrl": "https://rbm-ap.storage.googleapis.com/456340535902/mtcnu4l8Iwy0TO6y3LKxInX7",\n          "mediaContentType": "image/jpeg"\n        },\n        "suggestions": [{\n          "action": {\n            "displayText": "Check Offer",\n            "urlAction": {\n              "openUrl": {\n                "url": "https://applyonline.hdfc.bank.in/loan-against-assets/insta-jumbo-loan/insta-jumbo-form.html"\n              }\n            }\n          }\n        }]\n      }\n    }\n  }\n}';

  assertEqual(sandbox.classifySms(realRichCardSms, "AD-HDFCBK-S"), "IGNORE", "the exact real RCS rich-card promo (JSON payload, contains 'credited' describing a hypothetical loan payout) is now correctly ignored -- the URL/money-word checks alone were NOT enough to catch this, since it genuinely contains both a URL and a real money-movement word");

  sandbox.doPost(mkEvent(realRichCardSms, "AD-HDFCBK-S", 1787500000));
  assertEqual(sandbox.__rows.length, 0, "confirmed end-to-end: doPost never saves a row for it");
})();

(function(){
  const sandbox = loadSandbox();
  // Sanity check: a plain-text message that merely happens to contain a
  // literal "{" character somewhere in the middle (not at the start)
  // must NOT be affected by this new check -- only a message that IS
  // structurally a JSON object (starts with "{") is caught.
  assertEqual(sandbox.classifySms("Rs.500 debited from A/c XX1234 {ref: 128395408722} via UPI", "AD-HDFCBK-S"), "TRANSACTION", "a normal transaction SMS that happens to contain a '{' character mid-message (not at the very start) is still confidently recognized, unaffected by the new rich-card check");
})();

// =======================================================================
// PART 9 -- third real live bug, found 2026-08-28: a genuine, useful
//           bank notification (a low-balance alert) is not a
//           transaction at all -- no money moved.
// =======================================================================

(function(){
  const sandbox = loadSandbox();
  const realLowBalanceSms = "UPDATE:Bal in HDFC Bank A/c XX8774 has gone below minimum limit of INR 10,000.00.Yesterday's bal:INR xxxxxx .Chat on WhatsApp Banking:hdfcbk.io/k/DUvfE8hRogl";

  assertEqual(sandbox.classifySms(realLowBalanceSms, "AD-HDFCBK-S"), "IGNORE", "the exact real low-balance alert is now correctly ignored -- it's an account-status notification, not a transaction");

  sandbox.doPost(mkEvent(realLowBalanceSms, "AD-HDFCBK-S", 1787500000));
  assertEqual(sandbox.__rows.length, 0, "confirmed end-to-end: doPost never saves a row for it");
})();

(function(){
  const sandbox = loadSandbox();
  // A real transaction confirmation always states debited/credited/etc
  // -- a plain "Avl Bal Rs.X" trailer on a genuine transaction message
  // must NOT be affected by the new "minimum balance"/"minimum limit"
  // phrases, since those are specific enough to not match a routine
  // running-balance mention.
  assertEqual(sandbox.classifySms("Txn Rs.109.08 On HDFC Bank Card 8132 At zomato.eternaltsp.payu@hd by UPI 128446210518 On 24-08", "AD-HDFCBK-S"), "TRANSACTION", "a normal transaction with a routine balance trailer is unaffected -- 'minimum balance'/'minimum limit' are specific phrases, not a generic 'bal' match");
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
if(fail > 0) process.exit(1);
