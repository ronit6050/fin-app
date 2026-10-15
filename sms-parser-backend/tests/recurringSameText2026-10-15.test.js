// sms-parser-backend/tests/recurringSameText2026-10-15.test.js
//
// Plain-English what this checks: a bank message that repeats WORD FOR WORD every month (a SIP / e-mandate debit such as
// "PAYMENT ALERT! INR 2000.00 deducted from HDFC Bank A/C No 0000 towards NSE Clearing Limited UMRN: ...": no date, time or balance in it) is a NEW
// transaction each month, not a duplicate of last month's. The old rule "the exact same text was already saved = duplicate" threw every month after
// the first away (found live 2026-10-15: the 15 Oct SIP debit was dropped because the 15 Mar one had identical text).
// New rule: identical text counts as a duplicate ONLY when the earlier row is from the SAME DAY (a retry or resync always carries the original
// message time, so it still lands on the same day). Also checked: the real wording is a transaction, a reference match still wins on any day,
// and an unreadable earlier date keeps the old cautious behaviour. All data here is invented.
//
// Run with: node sms-parser-backend/tests/recurringSameText2026-10-15.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function assert(condition, message){
  if(!condition){ console.error("FAIL: " + message); fail++; process.exitCode = 1; }
  else { pass++; console.log("PASS: " + message); }
}

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

const SIP = "PAYMENT ALERT! \nINR 2000.00 deducted from HDFC Bank A/C No 0000 towards NSE Clearing Limited UMRN: HDFC0000000000000001";
const SENDER = "VM-HDFCBK-S";
const secs = function(iso){ return Math.floor(new Date(iso).getTime() / 1000); };
// [Date, Time, Bank, Type, Mode, Amount, Reference, Counterparty, Channel, Source, RawSMS, Sender]
const row = function(date, sms, ref){ return [date, "16:06:26", "HDFC", "debit", "other", 2000, ref || "", "nse clearing limited umrn", "SMS", "Tasker", sms, SENDER]; };

console.log("\n--- 1. The real wording is a transaction ---");
{
  const sb = loadSandbox();
  assert(sb.classifySms(SIP, SENDER) === "TRANSACTION", "the mandate-debit text is classified as a TRANSACTION");
  const tx = sb.ruleParser(SIP, SENDER);
  assert(tx.type === "debit" && tx.amount === "2000.00" && tx.bank === "HDFC", "it is read as a Rs 2,000 HDFC debit");
}

console.log("\n--- 2. The same text a month later is a NEW transaction ---");
{
  const sb = loadSandbox([row("2026-03-15", SIP)]);
  const tx = sb.ruleParser(SIP, SENDER);
  assert(sb.isDuplicate(tx, SIP, secs("2026-10-15T05:38:00Z")).duplicate === false, "last March's identical text does NOT make October's a duplicate");
  const r = sb.doPost(mkEvent(SIP, SENDER, secs("2026-10-15T05:38:00Z")));
  assert(sb.__rows.length === 2, "so doPost saves it as a second row (rows: " + sb.__rows.length + ")");
  const again = sb.doPost(mkEvent(SIP, SENDER, secs("2026-10-15T05:38:00Z")));
  assert(sb.__rows.length === 2, "and the very same message arriving AGAIN (a retry, same time) is still caught as a duplicate (rows: " + sb.__rows.length + ")");
}

console.log("\n--- 3. The same day: still a duplicate (retries and resyncs are caught) ---");
{
  const sb = loadSandbox([row("2026-10-15", SIP)]);
  const tx = sb.ruleParser(SIP, SENDER);
  const d = sb.isDuplicate(tx, SIP, secs("2026-10-15T09:00:00Z"));
  assert(d.duplicate === true && d.reason === "exact SMS text match", "identical text on the same day is a duplicate (reason: " + d.reason + ")");
  const weekly = loadSandbox([row("2026-10-08", SIP)]);
  assert(weekly.isDuplicate(tx, SIP, secs("2026-10-08T09:00:00Z")).duplicate === true, "a resync of an old message carries ITS original time, so it matches its own day's row");
}

console.log("\n--- 4. Earlier row's date as a real Date object, or unreadable ---");
{
  const old = loadSandbox([row(new Date(Date.UTC(2026, 2, 15, 10, 36, 26)), SIP)]);
  const tx = old.ruleParser(SIP, SENDER);
  assert(old.isDuplicate(tx, SIP, secs("2026-10-15T05:38:00Z")).duplicate === false, "a Date-object date from March: not a duplicate of October");
  const same = loadSandbox([row(new Date(Date.UTC(2026, 9, 15, 4, 0, 0)), SIP)]);
  assert(same.isDuplicate(tx, SIP, secs("2026-10-15T05:38:00Z")).duplicate === true, "a Date-object date on the same day: a duplicate");
  const odd = loadSandbox([row("n/a", SIP)]);
  assert(odd.isDuplicate(tx, SIP, secs("2026-10-15T05:38:00Z")).duplicate === true, "an unreadable earlier date keeps the old, cautious behaviour (treated as the same message)");
}

console.log("\n--- 5. No message time supplied: 'now' is used ---");
{
  const todayStr = new Date().toISOString().slice(0, 10);
  const sb = loadSandbox([row(todayStr, SIP)]);
  assert(sb.isDuplicate(sb.ruleParser(SIP, SENDER), SIP, 0).duplicate === true, "no time given and the same text saved today: a duplicate");
  const old = loadSandbox([row("2026-03-15", SIP)]);
  assert(old.isDuplicate(old.ruleParser(SIP, SENDER), SIP, 0).duplicate === false, "no time given and the same text only from March: not a duplicate");
}

console.log("\n--- 6. A real reference still wins on any day (unchanged) ---");
{
  const REF = "Rs.250.00 debited from A/c XX1234 on 27-08-26. UPI Ref No 128395408722. Avl Bal Rs.10000.00";
  const sb = loadSandbox([["2026-03-15", "10:00:00", "HDFC", "debit", "upi", 250, "128395408722", "swiggy", "SMS", "Tasker", "an older, differently worded text", SENDER]]);
  const tx = sb.ruleParser(REF, SENDER);
  assert(sb.isDuplicate(tx, REF, secs("2026-10-15T05:38:00Z")).duplicate === true, "the same real reference and amount is a duplicate whatever the day (that rule is unchanged)");
}

console.log("\n--- 7. Two genuinely different same-day purchases are both saved (unchanged) ---");
{
  const A = "Sent Rs.250.00 From HDFC Bank A/C x1234 To Zomato On 15/10/26 Ref 700000000001 Not You? Call 18002586161";
  const B = "Sent Rs.250.00 From HDFC Bank A/C x1234 To Zomato On 15/10/26 Ref 700000000002 Not You? Call 18002586161";
  const sb = loadSandbox();
  sb.doPost(mkEvent(A, SENDER, secs("2026-10-15T05:00:00Z")));
  sb.doPost(mkEvent(B, SENDER, secs("2026-10-15T06:00:00Z")));
  assert(sb.__rows.length === 2, "two orders, same day, same amount, different references: both saved (rows: " + sb.__rows.length + ")");
}

console.log("\n" + pass + " passed, " + fail + " failed");
