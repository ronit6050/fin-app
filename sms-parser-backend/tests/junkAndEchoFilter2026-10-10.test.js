// sms-parser-backend/tests/junkAndEchoFilter2026-10-10.test.js
//
// Plain-English what this checks (all five fixes of 2026-10-10, "the app
// should only ask me about things only I know"):
//
//  1. WRONG MERCHANT "block": HDFC card alerts end with boilerplate
//     ("Not You? To Block+Reissue Call ... SMS BLOCK CC ..."). The merchant
//     must come from the text after "At" / "For", never from that footer.
//     Other message shapes must extract exactly as before.
//  2. FUTURE-DATED MANDATE NOTICES ("Rs.X will be deducted on ...") are
//     ignored; the REAL later debit ("UPI Mandate: Sent Rs.X ...") still
//     saves; a real past-tense debit is never swallowed.
//  3. SERVICE / SECURITY / RECEIPT messages with no money movement (login
//     alert, biometric/UPI setting change, request-to-link-card, biller
//     payment receipt) are ignored, logged with a clear reason, and a REAL
//     transaction that merely contains "login" or "receipt" is NOT ignored.
//  4. SCAM TEXT with a third-party link shortener is ignored; a bank's own
//     domain (1.hdfc.bank.in) is not affected.
//  5. DUPLICATE ECHO: the bank sends two texts for ONE card charge (AutoPay
//     success + "without OTP/PIN" card text). The second is dropped ONLY
//     under a narrow set of conditions; genuinely different purchases
//     (different time, card, amount, merchant) all still save.
//
// IMPORTANT: every merchant name, card/account number, reference and
// amount below is INVENTED (this repo is public). Only the bank's
// boilerplate wording is real.
//
// Run with: node sms-parser-backend/tests/junkAndEchoFilter2026-10-10.test.js

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

// Same sandbox loader convention as the other test files in this folder
// (self-contained on purpose -- no shared helper module exists here).
function loadSandbox(seedRows){

  const rows = (seedRows || []).map(function(r){ return r.slice(); });
  const logged = [];
  let locked = false;

  const sandbox = {
    LockService: {
      getScriptLock: function(){
        return {
          waitLock: function(){
            if(locked) throw new Error("TEST FAILURE: lock acquired while already locked");
            locked = true;
          },
          releaseLock: function(){
            if(!locked) throw new Error("TEST FAILURE: released a lock never acquired");
            locked = false;
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
      // UTC-based stand-in: the tests build timestamps with the same
      // convention (see ts() below), so dates/times line up.
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
  return sandbox;
}

// epoch seconds for an (invented) moment, matching the UTC-based formatDate above
function ts(y, mo, d, h, mi, s){
  return String(Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000));
}

function mkEvent(sms, sender, timestamp){
  return { parameter: { sms: sms, sender: sender, timestamp: String(timestamp || ts(2026,10,1,10,0,0)) } };
}

// =======================================================================
// PART 1 -- merchant extraction
// =======================================================================

(function(){
  const sb = loadSandbox();

  // 1a. card "Spent" alert, merchant after "At"
  const a = "Spent Rs.2129 On HDFC Bank Card 1111 At FAKEMART On 2026-09-24:19:11:35.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 1111 to 7308080808";
  assertEqual(sb.ruleParser(a, "VM-HDFCBK-S").counterparty, "fakemart", "1a: card 'Spent ... At FAKEMART On <date>' -> merchant is FAKEMART, not 'block'");

  // 1b. contactless "without OTP/PIN" text, "Not U?" + "Block&Reissue" footer
  const b = "Rs.149 without OTP/PIN HDFC Bank Card x2222 At TESTSTREAMGOOGLE On 2026-09-11:11:35:34.Not U? Block&Reissue:Call 18002586161/SMS BLOCK CC 2222 to 7308080808";
  assertEqual(sb.ruleParser(b, "VM-HDFCBK-S").counterparty, "teststreamgoogle", "1b: 'without OTP/PIN ... At TESTSTREAMGOOGLE On <date>' -> merchant TESTSTREAMGOOGLE (was blank)");

  // 1c. AutoPay success: merchant is the word(s) after "For", before "Txn Amt"
  const c = "AutoPay (E-mandate) Success! For Teststream Txn Amt:INR149.00 Dt:11/09/2026 Via:HDFC Bank CC 2222 Mandate ID: AB1cD2eF3g Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 2222 to 7308080808";
  assertEqual(sb.ruleParser(c, "VM-HDFCBK-S").counterparty, "teststream", "1c: AutoPay success 'For Teststream Txn Amt' -> merchant Teststream, not 'block'");

  // a multi-word merchant and a debit-card variant ('From ... Card x3333')
  const d = "Spent Rs.2 From HDFC Bank Card x3333 At GADGET CLOUD On 2026-03-21:10:24:52 Bal Rs.9942.15 Not You? Call 18002586161/SMS BLOCK DC 3333 to 7308080808";
  assertEqual(sb.ruleParser(d, "VM-HDFCBK-S").counterparty, "gadget cloud", "multi-word merchant on the debit-card variant is read correctly");

  // A merchant whose name contains 'upi' must not be chopped (the older
  // cleaner truncates at 'upi'; the card-merchant path deliberately doesn't)
  const e = "Spent Rs.500 On HDFC Bank Card 1111 At JUPITERSHOP On 2026-09-24:19:11:35.Not You? To Block+Reissue Call 18002586161";
  assertEqual(sb.ruleParser(e, "VM-HDFCBK-S").counterparty, "jupitershop", "a merchant containing 'upi' inside its name is not truncated");

  // Unknown card-alert variant that still has the boilerplate: never 'block'
  const f = "Spent Rs.500 on card 1111 somewhere new. Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 1111 to 7308080808";
  const fcp = sb.ruleParser(f, "VM-HDFCBK-S").counterparty || "";
  assert(!/block|reissue/i.test(fcp), "boilerplate words are never taken as the merchant, even for a wording variant (got " + JSON.stringify(fcp) + ")");
  assert(sb.isBoilerplateCounterparty("block"), "'block' counts as boilerplate");
  assert(sb.isBoilerplateCounterparty("blockreissue call"), "'Block+Reissue' (symbols stripped) counts as boilerplate");
  assert(sb.isBoilerplateCounterparty("not you"), "'not you' counts as boilerplate");
  assert(!sb.isBoilerplateCounterparty("blockbuster video"), "a real merchant that merely starts with 'block' letters is NOT boilerplate");

  // --- other formats must extract exactly as before ---
  assertEqual(sb.ruleParser("Sent Rs.300.00 From HDFC Bank A/C *1111 To INVENTED SHOP On 13/03/26 Ref 132403723510 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808", "VM-HDFCBK-S").counterparty,
    "invented shop on", "UPI 'Sent ... To NAME On' format is unchanged (including its existing trailing 'on')");
  assertEqual(sb.ruleParser("Rs.500.00 debited from A/c XX1111 on 05-10-26. Info: UPI/DR/128395408722/FAKEMART. Avl bal Rs.100", "VM-HDFCBK-S").counterparty,
    "fakemart", "'UPI/DR/ref/MERCHANT' format is unchanged");
  assertEqual(sb.ruleParser("UPI Mandate: Sent Rs.2.00 from HDFC Bank A/c 1111 To Fake Cloud 21/03/26 Ref 608057963936 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808", "JM-HDFCBK-S").counterparty,
    "fake cloud", "'UPI Mandate: Sent ... To NAME' format is unchanged");
  assertEqual(sb.ruleParser("Rs 144.00 sent via UPI on 23-03-2026 at 20:57:52 to MADE UP ENTERP.Ref:472560273042.Not you? Call 18004251199/SMS BLOCKUPI to 98950 88888 -Federal Bank", "VM-FEDBNK-S").counterparty,
    "made up enterp", "Federal Bank 'sent via UPI ... to NAME.Ref:' format is unchanged");
  assertEqual(sb.ruleParser("Txn Rs.123.00 On HDFC Bank Card 1111 At fakeshop.1234@bank by UPI 023978123717 On 13-03 Not You? Call 18002586161/SMS BLOCK CC 1111 to 7308080808", "VM-HDFCBK-S").counterparty || "",
    "", "the 'Txn ... At <upi-handle> by UPI' format is deliberately left exactly as before (blank merchant, not a made-up one)");

  // everything else about the card alerts (amount/type/mode/reference) is untouched
  const pa = sb.ruleParser(a, "VM-HDFCBK-S");
  assertEqual(pa.amount, "2129", "card alert amount unchanged");
  assertEqual(pa.type, "debit", "card alert type unchanged");
  assertEqual(pa.mode, "card 1111", "card alert mode unchanged");
})();

// =======================================================================
// PART 2 -- future-dated mandate notices
// =======================================================================

(function(){
  const sb = loadSandbox();
  const notice = "E-Mandate! Rs.3000.00 will be deducted on 10/09/26, 00:00:00 For TESTFUND - Mutual Funds - Autopay mandate UMN abc123def4567890abc123def4567890@testbk Maintain Balance -HDFC Bank";
  assertEqual(sb.classifySms(notice, "JX-HDFCBK-S"), "IGNORE", "'will be deducted on <date>' advance notice is ignored");
  assertEqual(sb.classifyDetail(notice, "JX-HDFCBK-S").reason !== "", true, "the advance-notice skip carries a reason for the Logs sheet");

  const realDebit = "UPI Mandate: Sent Rs.3000.00 from HDFC Bank A/c 1111 To TESTFUND - Mutual Funds - 10/09/26 Ref 104023708059 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808";
  assertEqual(sb.classifySms(realDebit, "JX-HDFCBK-S"), "TRANSACTION", "the REAL debit that follows the notice is still a confident TRANSACTION");
  sb.doPost(mkEvent(realDebit, "JX-HDFCBK-S"));
  assertEqual(sb.__rows.length, 1, "the real mandate debit is saved end-to-end");

  // other future phrasings
  assertEqual(sb.classifySms("Your account will get debited Rs.500 tomorrow for SIP", "VM-HDFCBK-S"), "IGNORE", "'will get debited' is future-dated");
  assertEqual(sb.classifySms("Rs.99 is scheduled to be deducted on 05/10/26 for your plan", "VM-HDFCBK-S"), "IGNORE", "'scheduled to be deducted' is future-dated");
  assertEqual(sb.classifySms("Rs.99 will be auto-debited on 05/10/26 for your plan", "VM-HDFCBK-S"), "IGNORE", "'will be auto-debited' is future-dated");
  assertEqual(sb.classifySms("Rs.49 will be charged on 05/10/26", "VM-HDFCBK-S"), "IGNORE", "the original 'will be charged' rule still works");
  assertEqual(sb.classifySms("Rs.49 will be debited on 05/10/26", "VM-HDFCBK-S"), "IGNORE", "the original 'will be debited' rule still works");

  // guard: a real past-tense debit that merely mentions a future deduction is NOT swallowed
  const mixed = "Rs.500.00 has been debited from A/c XX1111 on 05-10-26. Any GST will be deducted separately. Info: UPI/DR/128395408722/FAKEMART";
  assertEqual(sb.classifySms(mixed, "VM-HDFCBK-S"), "TRANSACTION", "a real past-tense debit is not treated as a future notice just because it mentions 'will be deducted'");
  const mixed2 = "Rs.250 was deducted from your card 1111 at TESTSHOP. A fee of Rs.5 will be deducted next month.";
  assertEqual(sb.classifySms(mixed2, "VM-HDFCBK-S"), "TRANSACTION", "'was deducted' (past) beats a later 'will be deducted' mention");

  // widened guard (review fix): any past-tense money wording OUTSIDE the future phrase means it already happened
  assertEqual(sb.classifySms("Rs.5000 debited from A/c 1111 on 05-10-26 towards FAKEMART. GST will be deducted at month end.", "VM-HDFCBK-S"), "TRANSACTION", "debit that mentions 'GST will be deducted at month end' is NOT ignored");
  assertEqual(sb.classifySms("Rs.500 deducted from your account. Amount will be deducted again on 10th.", "VM-HDFCBK-S"), "TRANSACTION", "'deducted from your account ... will be deducted again' is NOT ignored");
  assertEqual(sb.classifySms("Sent Rs.500 from HDFC Bank A/c 1111 to FAKEMART via UPI. Remaining charges will be deducted next cycle.", "VM-HDFCBK-S"), "TRANSACTION", "'Sent Rs.500 ... remaining charges will be deducted' is NOT ignored");
  assertEqual(sb.classifySms("Rs.500 will be credited to your account on 10/10/26", "VM-HDFCBK-S"), "TRANSACTION", "'will be credited' wording is unaffected by the future-notice rule (same as before)");
  assertEqual(sb.classifySms("Your refund of Rs.500 will be refunded to your card in 5 days", "VM-HDFCBK-S"), "TRANSACTION", "'will be refunded' wording is unaffected (same as before)");
  // the real E-Mandate notice shape (invented fund name) is still ignored, with a different date/amount
  assertEqual(sb.classifySms("E-Mandate! Rs.4000.00 will be deducted on 12/08/26, 00:00:00 For TESTFUND - Mutual Funds - Autopay mandate UMN abc123def4567890abc123def4567890@testbk Maintain Balance -HDFC Bank", "VD-HDFCBN-S"), "IGNORE", "E-Mandate notice (other sender/date) still ignored");

  // plain past-tense debits unaffected
  assertEqual(sb.classifySms("Rs.1200 deducted from A/c XX1111 on 05-10-26", "VM-HDFCBK-S"), "TRANSACTION", "an ordinary 'deducted' debit is still a TRANSACTION");
})();

// =======================================================================
// PART 3 -- service / security / receipt messages
// =======================================================================

(function(){
  const sb = loadSandbox();

  const login = "Login Alert! We noticed that there was a login to your NetBanking. If it wasn't you, please call us immediately at 18002586161. Stay secure with HDFC Bank!";
  const bio = "UPI Biometric Authentication has been enabled on TestApp for A/c 1111. Use device biometrics for UPI payments. Not you? Contact 1800 258 6161 HDFC Bank";
  const link = "Update: We got a request to link your HDFC Bank Credit Card 2222 to UPI. Not you? Call 18002586161 or SMS BLOCK CC 2222 to 7308080808.";
  const receipt = "Hi Test User, we have received a payment of Rs. 488.82 for your One TestTel Plan ID 10101000000001. To download the payment receipt, click https://example.test/r/abc";

  assertEqual(sb.classifySms(login, "VM-HDFCBK-S"), "IGNORE", "login alert is ignored");
  assertEqual(sb.classifySms(bio, "VM-HDFCBK-S"), "IGNORE", "biometric/UPI setting notice is ignored");
  assertEqual(sb.classifySms(link, "VM-HDFCBK-S"), "IGNORE", "request-to-link-card notice is ignored");
  assertEqual(sb.classifySms(receipt, "AD-TESTBL-S"), "IGNORE", "biller payment receipt is ignored");

  // each skip is logged with a clear reason via doPost
  [[login,"VM-HDFCBK-S","login"],[bio,"VM-HDFCBK-S","biometric"],[link,"VM-HDFCBK-S","link"],[receipt,"AD-TESTBL-S","receipt"]].forEach(function(c){
    const before = sb.__logged.length;
    sb.doPost(mkEvent(c[0], c[1]));
    const statuses = sb.__logged.slice(before).map(function(r){ return r[4]; });
    assert(statuses.some(function(s){ return s.indexOf("NOT TRANSACTION (") === 0 && s.toLowerCase().indexOf(c[2]) !== -1; }), "the " + c[2] + " skip is logged with a plain-English reason (got " + JSON.stringify(statuses) + ")");
  });
  assertEqual(sb.__rows.length, 0, "none of the four service messages created a Transactions row");

  // --- GUARDS: real transactions that merely contain these words ---
  const g1 = "Rs.500.00 debited from A/c XX1111 on 05-10-26 towards TestStore. Info: UPI/DR/128395408722/LOGINSTORE. Login or app issue? Visit branch.";
  assertEqual(sb.classifySms(g1, "VM-HDFCBK-S"), "TRANSACTION", "GUARD: a real debit that contains the word 'login' is NOT ignored");

  const g2 = "Rs.2000 credited to A/c XX1111 on 05-10-26 by UPI. Receipt no 998877. Ref 123456789012";
  assertEqual(sb.classifySms(g2, "VM-HDFCBK-S"), "TRANSACTION", "GUARD: a real credit that contains the word 'receipt' is NOT ignored");

  const g3 = "Rs.300.00 debited from A/c XX1111 on 05-10-26. Payment receipt: we have received a payment of Rs.300 and it was debited from your account. Ref 123456789013";
  assertEqual(sb.classifySms(g3, "VM-HDFCBK-S"), "TRANSACTION", "GUARD: a message that says the user's own account was debited is never treated as a biller receipt");

  const g4 = "Rs.75 spent on HDFC Bank Card 1111 at BIOMETRIC LABS on 05-10-26";
  assertEqual(sb.classifySms(g4, "VM-HDFCBK-S"), "TRANSACTION", "GUARD: a real card spend at a merchant with 'biometric' in its name is NOT ignored");

  const g5 = "Rs.150 sent from HDFC Bank A/c 1111 to TEST LINK SERVICES via UPI. Ref 123456789014. Request to link? no";
  assertEqual(sb.classifySms(g5, "VM-HDFCBK-S"), "TRANSACTION", "GUARD: a real UPI payment is NOT ignored by the link-request rule (it has an amount)");

  // A bank's genuinely unrecognized wording must still be surfaced, not dropped
  assertEqual(sb.classifySms("Dear Customer, your account statement for September is ready.", "VM-HDFCBK-S"), "UNCERTAIN", "SAFETY: a known sender with unrecognized wording is still UNCERTAIN (never silently dropped)");
})();

// =======================================================================
// PART 4 -- scam text with a third-party link shortener
// =======================================================================

(function(){
  const sb = loadSandbox();

  const scam = "Dear Member,Important Notice: A/c: (1234567890) Credited: Rs.26083 Date: 20/09 09:20 Avail Bal: Rs.47602 View Now: bit.ly/AbCdEfG?7501 testbalancealert";
  assertEqual(sb.classifySms(scam, "JX-TESTSP-S"), "IGNORE", "scam text with a bit.ly link is ignored (unrecognized sender)");
  // A KNOWN bank sender is never silently dropped for odd wording: the
  // shortener only pushes it to UNCERTAIN (saved, flagged for review).
  assertEqual(sb.classifySms(scam, "VM-HDFCBK-S"), "UNCERTAIN", "from a RECOGNISED bank sender the same text is UNCERTAIN (saved for review), not silently ignored");
  const knownDebit = "Rs.500.00 debited from A/c XX1111 on 05-10-26. Info: UPI/DR/128395408722/FAKEMART. Details: bit.ly/AbC123";
  assertEqual(sb.classifySms(knownDebit, "VM-HDFCBK-S"), "UNCERTAIN", "a real-looking debit from a known bank sender ending with a bit.ly link is UNCERTAIN, never IGNORE");
  sb.doPost(mkEvent(knownDebit, "VM-HDFCBK-S"));
  assertEqual(sb.__rows.length, 1, "...and it is actually saved (flagged NEEDS REVIEW) end-to-end");
  assert(String(sb.__rows[0][7]).indexOf("NEEDS REVIEW") === 0, "...with the NEEDS REVIEW prefix");
  assertEqual(sb.classifySms("Flat 50% off today only! Shop now: bit.ly/AbC123", "VM-HDFCBK-S"), "UNCERTAIN", "a known-sender message with a shortener but no money words behaves as before (UNCERTAIN, not a new silent drop)");
  assertEqual(sb.classifySms("Flat 50% off today only! Shop now: bit.ly/AbC123", "VK-TESTAD-P"), "IGNORE", "an unknown-sender promo with a bit.ly link is ignored");

  ["tinyurl.com/abc123", "goo.gl/abc", "rb.gy/xyz1", "is.gd/abc", "cutt.ly/abc", "t.co/abc123"].forEach(function(l){
    assertEqual(sb.classifySms("Rs.500 credited to your account. Claim: " + l, "JX-TESTSP-S"), "IGNORE", "link shortener " + l + " from an unrecognised sender is ignored");
  });

  // look-alikes that are NOT shorteners
  assert(!sb.hasThirdPartyShortLink("visit ticket.co/abc"), "'ticket.co/...' is not t.co");
  assert(!sb.hasThirdPartyShortLink("see habit.ly/page"), "'habit.ly/...' is not bit.ly");
  assert(!sb.hasThirdPartyShortLink("t.com/shop"), "'t.com' is not t.co");

  // the bank's OWN domain is unaffected (this is existing behavior: URL + money word -> UNCERTAIN, not IGNORE)
  const ownLink = "Rs.1 Deducted From PayZapp Wallet On 12-03-2026 14:41:34 Bal: Rs.5271.24 Not you? Report: https://1.hdfc.bank.in/HDFCBK/s/AbCdEfGh or SMS BLOCKPZW to 5676712";
  assertEqual(sb.classifySms(ownLink, "AD-HDFCBN-S"), "UNCERTAIN", "a bank's own-domain link (1.hdfc.bank.in) is NOT treated as a scam shortener");

  // a normal bank transaction without any link
  assertEqual(sb.classifySms("Rs.500.00 debited from A/c XX1111 on 05-10-26. Info: UPI/DR/128395408722/FAKEMART", "VM-HDFCBK-S"), "TRANSACTION", "a plain real debit is unaffected");
})();

// =======================================================================
// PART 5 -- duplicate echo of one card charge
// =======================================================================

const AUTOPAY = "AutoPay (E-mandate) Success! For Teststream Txn Amt:INR149.00 Dt:11/09/2026 Via:HDFC Bank CC 2222 Mandate ID: AB1cD2eF3g Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 2222 to 7308080808";
const CARDTXT = "Rs.149 without OTP/PIN HDFC Bank Card x2222 At TESTSTREAMGOOGLE On 2026-09-11:11:35:34.Not U? Block&Reissue:Call 18002586161/SMS BLOCK CC 2222 to 7308080808";

// 5a. the real shape: AutoPay text first, card text one second later -> only ONE row
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,38)));
  sb.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb.__rows.length, 1, "echo: AutoPay text then card text 1s later -> one row, not two");
  assert(sb.__logged.some(function(r){ return String(r[4]).indexOf("DUPLICATE IGNORED (echo") === 0; }), "the echo skip is logged with its reason");
})();

// 5b. other order: card text first, AutoPay second -> still one row
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,34)));
  sb.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,36,20)));
  assertEqual(sb.__rows.length, 1, "echo: card text then AutoPay text 46s later (reverse order) -> one row");
})();

// 5c. SAFETY: two genuinely different same-amount purchases at different times BOTH save
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,34)));
  sb.doPost(mkEvent(CARDTXT.replace("11:35:34", "15:10:00"), "VM-HDFCBK-S", ts(2026,9,11,15,10,0)));
  assertEqual(sb.__rows.length, 2, "SAFETY: two same-amount card purchases 3.5 hours apart both save");

  const sb2 = loadSandbox();
  sb2.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,38)));
  sb2.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,39,0)));
  assertEqual(sb2.__rows.length, 2, "SAFETY: the same pair but 3+ minutes apart (outside the 2-minute window) both save");

  const sb3 = loadSandbox();
  sb3.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,10,11,35,38)));
  sb3.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb3.__rows.length, 2, "SAFETY: same time of day on different DAYS both save");
})();

// 5d. SAFETY: different card, same moment
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,38)));
  sb.doPost(mkEvent(CARDTXT.replace(/2222/g, "3333"), "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb.__rows.length, 2, "SAFETY: same amount, 1s apart, but a DIFFERENT card -> both save");
})();

// 5e. SAFETY: different amount
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,38)));
  sb.doPost(mkEvent(CARDTXT.replace("Rs.149", "Rs.150"), "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb.__rows.length, 2, "SAFETY: different amount -> both save");
})();

// 5f. SAFETY: neither text is an AutoPay / 'without OTP' shape (two ordinary card spends back to back)
(function(){
  const sb = loadSandbox();
  const spend = "Spent Rs.149 On HDFC Bank Card 2222 At FAKEMART On 2026-09-11:11:35:34.Not You? To Block+Reissue Call 18002586161";
  sb.doPost(mkEvent(spend, "VM-HDFCBK-S", ts(2026,9,11,11,35,34)));
  sb.doPost(mkEvent(spend.replace("11:35:34", "11:35:50"), "VM-HDFCBK-S", ts(2026,9,11,11,35,50)));
  assertEqual(sb.__rows.length, 2, "SAFETY: two ordinary 'Spent' card alerts 16s apart (not the known echo shapes) both save");
})();

// 5f2. SAFETY (review fix): two texts of the SAME kind, or Spent + 'without OTP', are separate purchases
(function(){
  const cafe = "Rs.50 without OTP/PIN HDFC Bank Card x2222 At SAMPLECAFE On 2026-09-11:08:00:00.Not U? Block&Reissue:Call 18002586161";
  const sb = loadSandbox();
  sb.doPost(mkEvent(cafe, "VM-HDFCBK-S", ts(2026,9,11,8,0,0)));
  sb.doPost(mkEvent(cafe.replace("08:00:00", "08:01:00"), "VM-HDFCBK-S", ts(2026,9,11,8,1,0)));
  assertEqual(sb.__rows.length, 2, "SAFETY: two 'without OTP/PIN' purchases at the same place 60s apart both save (two taps / two coffees)");

  const sb2 = loadSandbox();
  sb2.doPost(mkEvent("Spent Rs.50 On HDFC Bank Card 2222 At SAMPLECAFE On 2026-09-11:08:00:00.Not You? To Block+Reissue Call 18002586161", "VM-HDFCBK-S", ts(2026,9,11,8,0,0)));
  sb2.doPost(mkEvent(cafe.replace("08:00:00", "08:01:00"), "VM-HDFCBK-S", ts(2026,9,11,8,1,0)));
  assertEqual(sb2.__rows.length, 2, "SAFETY: 'Spent' then 'without OTP' for the same amount/place 60s apart both save");

  const sb3 = loadSandbox();
  sb3.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,38)));
  sb3.doPost(mkEvent(AUTOPAY.replace("AB1cD2eF3g", "ZZ9yY8xX7w"), "VM-HDFCBK-S", ts(2026,9,11,11,36,38)));
  assertEqual(sb3.__rows.length, 2, "SAFETY: two AutoPay-success texts 60s apart (same kind) both save");

  const sb4 = loadSandbox();
  sb4.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,34)));
  sb4.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,35)));
  assertEqual(sb4.__rows.length, 1, "the real AutoPay + 'without OTP' pair (either order) is still caught as one");
})();

// 5g. SAFETY: both echo-shaped, same card/amount/time, but clearly different merchants
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent(AUTOPAY, "VM-HDFCBK-S", ts(2026,9,11,11,35,38)));
  sb.doPost(mkEvent("Rs.149 without OTP/PIN HDFC Bank Card x2222 At CORNERCAFE On 2026-09-11:11:35:34.Not U? Block&Reissue:Call 18002586161", "VM-HDFCBK-S", ts(2026,9,11,11,35,40)));
  assertEqual(sb.__rows.length, 2, "SAFETY: same card/amount/seconds apart but a clearly different merchant -> both save");
})();

// 5h. SAFETY: an earlier row that has a real reference number is never treated as an echo candidate
(function(){
  const seed = [["2026-09-11","11:35:38","HDFC","debit","other","149","123456789012","Teststream","SMS","Tasker", AUTOPAY, "VM-HDFCBK-S"]];
  const sb = loadSandbox(seed);
  sb.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb.__rows.length, 2, "SAFETY: an existing row with a real reference is not an echo candidate");
})();

// 5i. real sheet shape: Time cell comes back as a Date object, Date cell too
(function(){
  const seed = [[new Date(Date.UTC(2026,8,11,0,0,0)), new Date(Date.UTC(1899,11,30,11,35,38)), "HDFC","debit","other","149","","teststream","SMS","Tasker", AUTOPAY, "VM-HDFCBK-S"]];
  const sb = loadSandbox(seed);
  sb.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb.__rows.length, 1, "echo is recognized when the sheet hands back Date objects for the Date and Time cells");
})();

// 5j. SAFETY: an unreadable stored time never causes a drop
(function(){
  const seed = [["2026-09-11","not a time","HDFC","debit","other","149","","teststream","SMS","Tasker", AUTOPAY, "VM-HDFCBK-S"]];
  const sb = loadSandbox(seed);
  sb.doPost(mkEvent(CARDTXT, "VM-HDFCBK-S", ts(2026,9,11,11,35,39)));
  assertEqual(sb.__rows.length, 2, "SAFETY: if the stored time can't be read, the new transaction is kept");
})();

// 5k. the existing duplicate tiers still behave
(function(){
  const sb = loadSandbox();
  sb.doPost(mkEvent("Rs.500.00 debited from A/c XX1111 on 05-10-26. Info: UPI/DR/128395408722/FAKEMART Ref 128395408722", "VM-HDFCBK-S", ts(2026,10,5,10,0,0)));
  sb.doPost(mkEvent("Rs.500.00 debited from A/c XX1111 on 05-10-26. Info: UPI/DR/128395408722/FAKEMART Ref 128395408722", "VM-HDFCBK-S", ts(2026,10,5,10,0,5)));
  assertEqual(sb.__rows.length, 1, "existing tier 1/2 duplicate detection still works");
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
if(fail > 0) process.exit(1);
