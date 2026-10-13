// sms-parser-backend/tests/personalKey2026-10-13.test.js
//
// Plain-English what this checks: a FRIEND's bank SMS (sent with a private key) is classified and parsed exactly like anyone's,
// but is handed to the main backend to be saved in THEIR OWN private space, never written to this project's Sheet, never matched
// against the owner's learned-spam list, and its text never written to the owner's Logs sheet. A message with NO key (the owner's
// phone, Tasker) behaves exactly as before. A wrong/switched-off key is not retried; a failed hand-off asks the phone to retry.
// Run with: node sms-parser-backend/tests/personalKey2026-10-13.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function assert(condition, message){
  if(!condition){ console.error("FAIL: " + message); fail++; process.exitCode = 1; }
  else { pass++; console.log("PASS: " + message); }
}

function loadSandbox(seedRows, fetchImpl){

  const rows = (seedRows || []).map(function(r){ return r.slice(); });
  const logged = [];
  const lockEvents = [];
  const fetches = [];
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
    UrlFetchApp: { fetch: function(url, opts){ fetches.push({ url: url, opts: opts }); return fetchImpl(url, opts); } },
    console: console
  };
  vm.createContext(sandbox);

  const src = fs.readFileSync(path.join(__dirname, "..", "Code.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "Code.js" });

  sandbox.__rows = rows;
  sandbox.__logged = logged;
  sandbox.__lockEvents = lockEvents;
  sandbox.__fetches = fetches;
  return sandbox;
}


function mkEvent(sms, sender, key){
  const p = { sms: sms, sender: sender, timestamp: "1787500000" };
  if(key) p.key = key;
  return { parameter: p, postData: { contents: "sms=" + sms + (key ? "&key=" + key : "") } };
}
const GOOD_SMS = "Rs.120 debited from HDFC Bank A/C *1234 to Cafe Q via UPI Ref 555000111. Not you? Call bank.";
const okReply = function(){ return { getContentText: function(){ return JSON.stringify({ ok: true, saved: true }); } }; };

console.log("--- 1. No key: exactly the old path ---");
{
  const sb = loadSandbox([], okReply);
  const r = sb.doPost(mkEvent(GOOD_SMS, "HDFCBK"));
  assert(sb.__rows.length === 1, "the transaction is saved to this project's Sheet as before");
  assert(sb.__fetches.length === 0, "nothing is sent to the main backend");
  assert(sb.__logged.some(function(l){ return String(l[2]).indexOf("Rs.120") !== -1; }), "the message text is logged as before");
}

console.log("\n--- 2. With a key: handed to the main backend, never saved here ---");
{
  const sb = loadSandbox([], okReply);
  const KEY = "k".repeat(64);
  const r = sb.doPost(mkEvent(GOOD_SMS, "HDFCBK", KEY));
  assert(r.text === "OK", "the phone is told OK");
  assert(sb.__rows.length === 0, "NOTHING was written to this project's Transactions sheet");
  assert(sb.__fetches.length === 1 && /script\.google\.com/.test(sb.__fetches[0].url), "one call went to the main backend");
  const sent = JSON.parse(sb.__fetches[0].opts.payload);
  assert(sent.action === "ingestSms" && sent.key === KEY && sent.sms === GOOD_SMS && Number(sent.tx.amount) === 120 && sent.tx.type === "debit", "it carried the key, the text and the parsed details (amount 120, debit)");
  const everyLog = JSON.stringify(sb.__logged);
  assert(everyLog.indexOf("Cafe Q") === -1 && everyLog.indexOf("555000111") === -1 && everyLog.indexOf(KEY) === -1, "the owner's Logs sheet holds no message text, reference or key");
  assert(sb.__logged.some(function(l){ return /PERSONAL OK/.test(String(l[4])); }), "it only records that a friend's message arrived");
}

console.log("\n--- 3. Failures: retry only when retrying can help ---");
{
  const rejected = loadSandbox([], function(){ return { getContentText: function(){ return JSON.stringify({ ok: false, error: "Unknown key." }); } }; });
  assert(rejected.doPost(mkEvent(GOOD_SMS, "HDFCBK", "k".repeat(64))).text === "REJECTED", "a wrong or switched-off key is REJECTED (the phone must not retry forever)");
  const down = loadSandbox([], function(){ throw new Error("network"); });
  assert(down.doPost(mkEvent(GOOD_SMS, "HDFCBK", "k".repeat(64))).text === "RETRY", "if the main backend cannot be reached, the phone is told to RETRY");
  const busy = loadSandbox([], function(){ return { getContentText: function(){ return JSON.stringify({ ok: false, error: "Couldn't save. Try again." }); } }; });
  assert(busy.doPost(mkEvent(GOOD_SMS, "HDFCBK", "k".repeat(64))).text === "RETRY", "a temporary save problem is RETRY too");
  assert(down.__rows.length === 0 && busy.__rows.length === 0, "and none of them ever write to this project's Sheet");
}

console.log("\n--- 4. Junk from a friend is still junk; the owner's spam list is not used on them ---");
{
  const sb = loadSandbox([], okReply);
  sb.doPost(mkEvent("Get a Loan on your Credit Card! Click https://x.example/abc now", "HDFCBK", "k".repeat(64)));
  assert(sb.__fetches.length === 0 && sb.__rows.length === 0, "an obvious promotion is ignored before anything is sent");
  const sb2 = loadSandbox([], okReply);
  sb2.getLearnedSpamPatternsSheet = function(){ throw new Error("the owner's spam list must not be read for a friend"); };
  sb2.doPost(mkEvent("HDFC Bank: your statement is ready to view", "HDFCBK", "k".repeat(64)));
  assert(sb2.__logged.every(function(l){ return !/ERROR/.test(String(l[4])); }), "a friend's message never touches the owner's learned-spam list");
}

console.log("\n" + pass + " passed, " + fail + " failed");
