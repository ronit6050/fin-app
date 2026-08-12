// backend/tests/categoryWordBoundary.test.js
//
// Plain-English what this checks: the category guesser used to match
// merchant/keyword names as a bare substring, not a whole word — so a
// merchant memory entry named "tea" (or similar) could wrongly match
// inside an unrelated word like "team", and the built-in tea/coffee/chai
// "Snacks" rule could do the same thing. This is the exact same bug
// class already fixed once before for the word "lent" matching inside
// "excellent"/"silent"/"talent" (see needWantSaving.js and the comment
// directly above the fix in category.js). Fixed 2026-08-12 — see
// CLAUDE.md and docs/AGENT_BACKLOG.md for the full writeup.
//
// This test loads the REAL backend/category.js source into a small
// sandbox (no real Apps Script/Google account needed — findMerchantMatch
// and matchByPattern are both plain functions that don't touch
// SpreadsheetApp) and proves:
//   1. A merchant named "tea" no longer matches inside "team meeting".
//   2. A merchant named "tea" still correctly matches a real "tea" note.
//   3. The built-in tea/coffee/chai Snacks rule no longer fires for
//      "team lunch" but still fires for a real "chai" purchase.
//   4. A multi-word merchant name (e.g. "swiggy instamart") still
//      matches correctly — the word-boundary fix must not break
//      merchants with spaces in them.
//
// Run with: node backend/tests/categoryWordBoundary.test.js

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

const sandbox = { console };
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(__dirname, "..", "category.js"), "utf8");
vm.runInContext(src + "\nthis.findMerchantMatch = findMerchantMatch; this.matchByPattern = matchByPattern; this.normalizeText = normalizeText;", sandbox);

const { findMerchantMatch, matchByPattern, normalizeText } = sandbox;

// --- findMerchantMatch: exact-match word-boundary check ---
// memData row shape: [merchant, category, subcategory, confidence]
const memData = [
  ["header", "", "", ""],
  ["tea", "Food", "Snacks", 90],
  ["swiggy instamart", "Food", "Delivery", 95]
];

const teamResult = findMerchantMatch(normalizeText("team meeting expense"), memData, true);
assert(teamResult === null, "merchant 'tea' does NOT match inside 'team meeting' anymore");

const realTeaResult = findMerchantMatch(normalizeText("evening tea stall"), memData, true);
assert(realTeaResult !== null && realTeaResult.category === "Food", "merchant 'tea' still matches a real 'tea' note");

const multiWordResult = findMerchantMatch(normalizeText("payment to swiggy instamart"), memData, true);
assert(multiWordResult !== null && multiWordResult.subcategory === "Delivery", "multi-word merchant 'swiggy instamart' still matches correctly");

// --- matchByPattern: tea/coffee/chai Snacks rule word-boundary check ---
const teamPattern = matchByPattern("team lunch split", "", 50, "upi");
assert(!(teamPattern && teamPattern.subcategory === "Snacks"), "'team lunch' no longer wrongly triggers the tea/coffee/chai Snacks rule");

const realChaiPattern = matchByPattern("chai at stall", "", 20, "cash");
assert(realChaiPattern !== null && realChaiPattern.subcategory === "Snacks", "a real 'chai' purchase still triggers the Snacks rule");

console.log("\nDone.");
