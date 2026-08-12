// backend/tests/verifyGoogleIdTokenCache.test.js
//
// Plain-English what this checks: every single tap in the app used to
// make Apps Script ask Google's servers "is this really Ronit signed
// in?" over the internet, every single time — a big chunk of the delay
// felt when switching tabs/months. Fixed 2026-08-12: verifyGoogleIdToken
// now remembers a verified token's result for 5 minutes using Apps
// Script's own fast built-in memory (CacheService), so the same token
// doesn't trigger a fresh round trip to Google on every tap.
//
// This test loads the REAL verifyGoogleIdToken function from PWA.js into
// a small fake Google Apps Script environment (fake CacheService /
// UrlFetchApp / Utilities — no real Google account or network needed)
// and proves:
//   1. The same token, checked twice, only calls out to Google once —
//      the second call is answered from the cache.
//   2. A different token still gets its own fresh check (the cache is
//      keyed per-token, not shared across different people/sessions).
//   3. A FAILED check (bad token, or a token issued for a different app)
//      is never cached — every bad attempt still gets a fresh check, so
//      a real problem can never look permanently "cached as broken."
//   4. The remembered result is saved for 300 seconds (5 minutes), not
//      forever — Google's own token expiry still matters.
//
// Run with: node backend/tests/verifyGoogleIdTokenCache.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

function assert(condition, message){
  if(!condition){
    console.error("FAIL: " + message);
    process.exitCode = 1;
  } else {
    console.log("PASS: " + message);
  }
}

// ---------------------------------------------------------------------
// A tiny fake Apps Script environment — just enough for
// verifyGoogleIdToken (CacheService / UrlFetchApp / Utilities).
// ---------------------------------------------------------------------
function makeFakeEnv(){
  const cacheStore = {};
  const putCalls = [];

  const CacheService = {
    getScriptCache: function(){
      return {
        get: function(key){
          return Object.prototype.hasOwnProperty.call(cacheStore, key) ? cacheStore[key] : null;
        },
        put: function(key, value, ttlSeconds){
          cacheStore[key] = value;
          putCalls.push({ key: key, ttlSeconds: ttlSeconds });
        }
      };
    }
  };

  const Utilities = {
    computeDigest: function(algorithm, text){
      return Array.from(crypto.createHash("sha256").update(text).digest());
    },
    DigestAlgorithm: { SHA_256: "SHA_256" },
    base64EncodeWebSafe: function(bytes){
      return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
  };

  // Filled in after PWA.js loads, so the fake Google responses can use
  // the real PWA_CLIENT_ID the code under test actually checks against.
  let realClientId = null;

  let fetchCallCount = 0;
  const tokenBehaviors = {
    "good-token-1": function(){ return { code: 200, body: { aud: realClientId, email: "ronitnadar9@gmail.com", name: "Ronit" } }; },
    "good-token-2": function(){ return { code: 200, body: { aud: realClientId, email: "ronitnadar9@gmail.com", name: "Ronit" } }; },
    "wrong-app-token": function(){ return { code: 200, body: { aud: "someone-elses-app-id", email: "ronitnadar9@gmail.com", name: "Ronit" } }; },
    "bad-token": function(){ return { code: 400, body: {} }; }
  };

  const UrlFetchApp = {
    fetch: function(url){
      fetchCallCount++;
      const match = url.match(/id_token=([^&]+)/);
      const token = match ? decodeURIComponent(match[1]) : "";
      const behavior = tokenBehaviors[token] || function(){ return { code: 400, body: {} }; };
      const resp = behavior();
      return {
        getResponseCode: function(){ return resp.code; },
        getContentText: function(){ return JSON.stringify(resp.body); }
      };
    }
  };

  return {
    CacheService: CacheService,
    Utilities: Utilities,
    UrlFetchApp: UrlFetchApp,
    setRealClientId: function(id){ realClientId = id; },
    getFetchCallCount: function(){ return fetchCallCount; },
    getPutCalls: function(){ return putCalls; }
  };
}

function loadSandbox(){
  const env = makeFakeEnv();

  const sandbox = {
    CacheService: env.CacheService,
    Utilities: env.Utilities,
    UrlFetchApp: env.UrlFetchApp,
    console: console
  };
  vm.createContext(sandbox);

  const pwaSrc = fs.readFileSync(path.join(__dirname, "..", "PWA.js"), "utf8");
  vm.runInContext(pwaSrc, sandbox, { filename: "PWA.js" });

  // PWA_CLIENT_ID is declared with `const`, and Node's vm module (unlike
  // Apps Script's real global scope) doesn't expose top-level const/let
  // bindings as properties on the sandbox object — only functions and
  // `var` show up that way. verifyGoogleIdToken itself still sees the
  // real value fine (same file, same lexical scope) — this is only
  // needed so the fake Google response below can be built to match it.
  const clientIdMatch = pwaSrc.match(/const\s+PWA_CLIENT_ID\s*=\s*"([^"]+)"/);
  if(!clientIdMatch) throw new Error("Could not find PWA_CLIENT_ID in PWA.js — has it moved/renamed?");
  env.setRealClientId(clientIdMatch[1]);

  return { sandbox: sandbox, env: env };
}

// ---------------------------------------------------------------------
// Test 1 — same token twice: only one real check against Google.
// ---------------------------------------------------------------------
(function testSameTokenIsCached(){
  const { sandbox, env } = loadSandbox();

  const first = sandbox.verifyGoogleIdToken("good-token-1");
  assert(first && first.email === "ronitnadar9@gmail.com", "first check of a good token succeeds");
  assert(env.getFetchCallCount() === 1, "first check made exactly one real call to Google");

  const second = sandbox.verifyGoogleIdToken("good-token-1");
  assert(second && second.email === "ronitnadar9@gmail.com", "second check of the SAME token still succeeds");
  assert(env.getFetchCallCount() === 1, "second check of the same token was answered from cache — no new call to Google");

  const putCalls = env.getPutCalls();
  assert(putCalls.length === 1, "the result was cached exactly once (not re-cached on the cache hit)");
  assert(putCalls[0].ttlSeconds === 300, "the cached result is remembered for 300 seconds (5 minutes), not forever");
})();

// ---------------------------------------------------------------------
// Test 2 — a different token always gets its own fresh check.
// ---------------------------------------------------------------------
(function testDifferentTokenIsNotCached(){
  const { sandbox, env } = loadSandbox();

  sandbox.verifyGoogleIdToken("good-token-1");
  assert(env.getFetchCallCount() === 1, "sanity check: one call after the first token");

  const result = sandbox.verifyGoogleIdToken("good-token-2");
  assert(result && result.email === "ronitnadar9@gmail.com", "a second, different token still verifies correctly");
  assert(env.getFetchCallCount() === 2, "a different token is never answered from another token's cache entry");
})();

// ---------------------------------------------------------------------
// Test 3 — failed checks are never cached, so a real problem can't get
// permanently masked as "cached as broken" for 5 minutes.
// ---------------------------------------------------------------------
(function testFailuresAreNotCached(){
  const { sandbox, env } = loadSandbox();

  const first = sandbox.verifyGoogleIdToken("bad-token");
  assert(first === null, "a bad token correctly fails verification");
  assert(env.getFetchCallCount() === 1, "checking the bad token made one real call to Google");

  const second = sandbox.verifyGoogleIdToken("bad-token");
  assert(second === null, "checking the same bad token again still fails");
  assert(env.getFetchCallCount() === 2, "the failure was NOT cached — it made a fresh check again, not reused a cached failure");

  assert(env.getPutCalls().length === 0, "nothing was ever written to the cache for a failed check");
})();

// ---------------------------------------------------------------------
// Test 4 — a token issued for a different app is rejected and not
// cached either (same reasoning as test 3 — never cache a rejection).
// ---------------------------------------------------------------------
(function testWrongAppTokenIsRejectedAndNotCached(){
  const { sandbox, env } = loadSandbox();

  const result = sandbox.verifyGoogleIdToken("wrong-app-token");
  assert(result === null, "a token issued for a different app is rejected");
  assert(env.getPutCalls().length === 0, "a rejected (wrong-app) token is never cached as verified");
})();
