// functions/tests/shim.test.js
//
// Plain-English what this checks: the "pretend Apps Script" that lets the backend code run on Firebase (runtime/shim.js):
// dates are formatted and read exactly like Apps Script does (in India time), digests/uuids/base64 behave the same, the backend files
// all load, there is deliberately no real Google Sheet, a person who is not on the new server gets a "fall back to Apps Script"
// answer, logs go to the log function, and the local sign-in shortcut can never run on Firebase.
// No network is needed. Run with: node functions/tests/shim.test.js

const { createRuntime, formatDate, parseDate } = require("../runtime/shim");

let failures = 0;
function assert(cond, msg){
  if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

const noFlags = function(){ return {}; };

console.log("\n--- 1. Dates, exactly like Apps Script (India time) ---");
{
  const d = new Date(Date.UTC(2026, 9, 13, 18, 45, 5));            // 13 Oct 2026 18:45:05 UTC = 14 Oct 00:15:05 IST
  assert(formatDate(d, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss") === "2026-10-14 00:15:05", "yyyy-MM-dd HH:mm:ss crosses midnight into the next day in India");
  assert(formatDate(d, "Asia/Kolkata", "dd MMM yyyy") === "14 Oct 2026", "dd MMM yyyy");
  assert(formatDate(d, "Asia/Kolkata", "HH:mm") === "00:15", "HH:mm");
  assert(formatDate(d, "UTC", "yyyy-MM-dd'T'HH:mm:ss") === "2026-10-13T18:45:05", "quoted text and another time zone");
  assert(formatDate(new Date(Date.UTC(2026, 0, 5, 3, 0, 0)), "Asia/Kolkata", "EEE, d MMMM h:mm a") === "Mon, 5 January 8:30 AM", "weekday, month name, 12-hour clock");
  assert(formatDate(d, "Asia/Kolkata", "Z") === "+0530", "time-zone offset");
  const rt = createRuntime({ sharedProps: noFlags });
  const crossRealm = rt.sandbox.Utilities.formatDate(vmDate(rt, 2026, 9, 13, 18, 45, 5), "Asia/Kolkata", "dd MMM yyyy");
  assert(crossRealm === "14 Oct 2026", "a date made inside the backend's own world is read correctly");
  const parsed = parseDate("2026-10-14 00:15:05", "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss", Date);
  assert(parsed.getTime() === d.getTime(), "parseDate reads India time back to the exact same moment");
  assert(parseDate("2026-10-14", "Asia/Kolkata", "yyyy-MM-dd", Date).getTime() === Date.UTC(2026, 9, 13, 18, 30, 0), "a plain date is midnight in India");
}

function vmDate(rt, y, mo, dd, h, mi, s){
  return require("node:vm").runInContext("new Date(Date.UTC(" + [y, mo, dd, h, mi, s].join(",") + "))", rt.sandbox);
}

console.log("\n--- 2. The small utilities ---");
{
  const rt = createRuntime({ sharedProps: noFlags });
  const U = rt.sandbox.Utilities;
  const sha = U.computeDigest(U.DigestAlgorithm.SHA_256, "abc").map(function(b){ return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
  assert(sha === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 of 'abc' is right (bytes are signed like Apps Script, and & 0xff restores them)");
  assert(U.computeDigest("sha256", "abc").some(function(b){ return b < 0; }), "digest bytes can be negative, like Apps Script");
  assert(/^[0-9a-f-]{36}$/.test(U.getUuid()) && U.getUuid() !== U.getUuid(), "uuids look right and differ");
  assert(U.base64EncodeWebSafe("a??>b") === "YT8_PmI=", "web-safe base64 swaps + and /");
  const t = Date.now(); U.sleep(40); assert(Date.now() - t >= 35, "sleep really waits");
  assert(rt.sandbox.Session.getScriptTimeZone() === "Asia/Kolkata", "the script time zone is India");
}

console.log("\n--- 3. The backend code all loads; there is no real Sheet ---");
{
  const rt = createRuntime({ sharedProps: noFlags });
  assert(rt.filesLoaded.length >= 25 && rt.filesLoaded.indexOf("PWA.js") !== -1 && rt.filesLoaded.indexOf("v2db.js") !== -1, "the backend files loaded (" + rt.filesLoaded.length + ")");
  assert(rt.filesLoaded.indexOf("telegram.js") === -1 && rt.filesLoaded.indexOf("Recon.js") === -1 && rt.filesLoaded.indexOf("main.js") === -1, "the retired bot and the Drive/statement files are not loaded");
  let threw = false;
  try{ rt.sandbox.SpreadsheetApp.getActiveSpreadsheet().insertSheet("x"); }catch(e){ threw = /no Google Sheet/.test(e.message); }
  assert(threw, "trying to create a real Sheet tab fails loudly");
  assert(rt.sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions") === null, "there is no 'Transactions' Sheet tab on this server");
}

console.log("\n--- 4. A person who is not on the new server is told to use Apps Script ---");
{
  const rt = createRuntime({ localEmail: "ronitnadar9@gmail.com", sharedProps: noFlags });     // owner NOT switched on
  const r = rt.call({ action: "getPending", idToken: "local" });
  assert(r.ok === false && r.fallback === true, "owner not switched on -> fallback (the app asks Apps Script instead)");
  const friend = createRuntime({ localEmail: "someone@example.com", sharedProps: noFlags });
  const f = friend.call({ action: "getPending", idToken: "local" });
  assert(f.ok === false, "a stranger is refused");
  const noToken = createRuntime({ localEmail: "ronitnadar9@gmail.com", sharedProps: noFlags }).call({ action: "getPending", idToken: "not-local" });
  assert(noToken.ok === false && /not signed in/i.test(noToken.error || ""), "a wrong sign-in proof is refused (the local shortcut only accepts its own word)");
}

console.log("\n--- 5. Logs and safety ---");
{
  const lines = [];
  const rt = createRuntime({ sharedProps: noFlags, log: function(l){ lines.push(l); } });
  rt.sandbox.logAI("SOME_ERROR", "boom");
  rt.sandbox.logAI("INFO_THING", "fine");
  assert(lines.length === 2 && JSON.parse(lines[0]).severity === "ERROR" && JSON.parse(lines[1]).severity === "INFO", "logAI goes to the log function, errors marked ERROR");
  process.env.K_SERVICE = "api";
  let refused = false;
  try{ createRuntime({ localEmail: "ronitnadar9@gmail.com", sharedProps: noFlags }); }catch(e){ refused = /never run on Firebase/.test(e.message); }
  delete process.env.K_SERVICE;
  assert(refused, "the local sign-in shortcut refuses to exist on Firebase");
  const out = rt.sandbox.ContentService.createTextOutput("hi").setMimeType(rt.sandbox.ContentService.MimeType.JSON);
  assert(out.getContent() === "hi", "ContentService answers carry their text");
}

console.log("\n--- 6. The shared switches are read, and a removed switch disappears ---");
{
  let flags = { V2DB_OWNER: "on", V2DB_USERS: JSON.stringify(["a@x.com"]) };
  const rt = createRuntime({ localEmail: "ronitnadar9@gmail.com", sharedProps: function(){ return flags; } });
  rt.refreshProps();
  assert(rt.sandbox.v2EngineFor_("ronitnadar9@gmail.com") === "v2db" && rt.sandbox.v2EngineFor_("a@x.com") === "v2db" && rt.sandbox.v2EngineFor_("b@x.com") === "sheet", "owner and listed friend are on the new copy, others are not");
  flags = { V2DB_USERS: "[]" };
  rt.props.__x = "force-reload";
  // force a reload by moving the clock forward
  const realNow = Date.now; Date.now = function(){ return realNow() + 60000; };
  rt.refreshProps();
  Date.now = realNow;
  assert(rt.sandbox.v2EngineFor_("ronitnadar9@gmail.com") === "sheet" && rt.sandbox.v2EngineFor_("a@x.com") === "sheet", "after the switches are turned off in Apps Script, they are off here too");
}

console.log(failures === 0 ? "\nALL OK" : "\n" + failures + " FAILED");
