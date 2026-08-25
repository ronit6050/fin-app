// backend/tests/ccStatementRateLimitRetry.test.js
//
// Plain-English what this checks: uploading the real PDF statement
// through the live app hit a real Google error on the very first try —
// "GoogleJsonResponseException: ...drive.files.copy failed... User rate
// limit exceeded" — a short-lived per-user Drive API limit that an OCR
// conversion can trip even on a single request. Fixed with
// withRateLimitRetry_() (backend/Recon.js): retries a few times with a
// growing pause (1s, 2s, 4s) before giving up, but ONLY when the error
// actually looks like a rate limit — a genuinely broken file or a real
// permissions error should still fail immediately, not waste time
// retrying something that will never succeed.
//
// This test proves:
//   1. A call that fails twice with a rate-limit-shaped error, then
//      succeeds on the 3rd try, returns the real result (not an error) —
//      the actual scenario that happened live.
//   2. A call that keeps failing with a rate-limit error for every
//      attempt eventually gives up and throws — doesn't retry forever.
//   3. A call that fails with a DIFFERENT kind of error (not a rate
//      limit) fails immediately, on the very first attempt — no wasted
//      retries on an error retrying can never fix.
//   4. A call that succeeds on the very first try never sleeps/retries
//      at all — the common case stays fast.
//
// Run with: node backend/tests/ccStatementRateLimitRetry.test.js

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

function loadSandbox(){
  const sleeps = [];
  const sandbox = {
    Utilities: {
      sleep: function(ms){ sleeps.push(ms); } // instant in tests — real delay only matters live
    },
    console: console
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "Recon.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "Recon.js" });
  sandbox.__sleeps = sleeps;
  return sandbox;
}

// ---------------------------------------------------------------------
// 1. Fails twice with the exact real error text, succeeds on attempt 3.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  let calls = 0;
  const result = sandbox.withRateLimitRetry_(function(){
    calls++;
    if(calls < 3) throw new Error("GoogleJsonResponseException: API call to drive.files.copy failed with error: User rate limit exceeded");
    return { id: "real-doc-id" };
  });
  assertEqual(calls, 3, "the function was called 3 times (2 real failures + 1 success)");
  assertEqual(result.id, "real-doc-id", "the real result from the successful 3rd attempt is returned, not an error");
  assertEqual(sandbox.__sleeps.length, 2, "slept exactly twice, once after each failed attempt");
  assert(sandbox.__sleeps[1] > sandbox.__sleeps[0], "the pause grows between retries (backoff), not a fixed delay");
})();

// ---------------------------------------------------------------------
// 2. Keeps failing with a rate-limit error every time — gives up.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  let calls = 0;
  let threw = null;
  try{
    sandbox.withRateLimitRetry_(function(){
      calls++;
      throw new Error("User Rate Limit Exceeded");
    }, 4);
  }catch(err){
    threw = err;
  }
  assert(!!threw, "eventually throws instead of retrying forever");
  assertEqual(calls, 4, "stopped after exactly the max attempts (4), not more");
})();

// ---------------------------------------------------------------------
// 3. A non-rate-limit error fails immediately, no retry wasted.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  let calls = 0;
  let threw = null;
  try{
    sandbox.withRateLimitRetry_(function(){
      calls++;
      throw new Error("Invalid argument: fileId");
    });
  }catch(err){
    threw = err;
  }
  assert(!!threw, "a genuinely different error still throws");
  assertEqual(calls, 1, "a non-rate-limit error is NOT retried — fails on the very first attempt");
  assertEqual(sandbox.__sleeps.length, 0, "never slept, since it never retried");
})();

// ---------------------------------------------------------------------
// 4. Success on the first try — no retry overhead in the common case.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  let calls = 0;
  const result = sandbox.withRateLimitRetry_(function(){
    calls++;
    return { id: "instant-success" };
  });
  assertEqual(calls, 1, "called exactly once when it succeeds immediately");
  assertEqual(result.id, "instant-success", "the real result is returned");
  assertEqual(sandbox.__sleeps.length, 0, "no sleep at all on an immediate success");
})();

console.log("\nDone.");
