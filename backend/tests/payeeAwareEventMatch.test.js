// backend/tests/payeeAwareEventMatch.test.js
//
// Plain-English what this checks: the app used to offer "Is this HDFC
// Mid Cap Fund?" for a Rs.4,000 payment to the user's dad (a laptop EMI)
// purely because the Mid Cap SIP is ALSO Rs.4,000 — it matched on amount
// alone and never looked at who the money went to. Found 2026-10-06 from
// the user's real data. Fix (financialEvents.js): an amount match for a
// named EMI/Investment is now only accepted if the payee also shares at
// least one meaningful word with a payee already recorded for that event.
//
// What this proves (all synthetic data — never put real transactions in
// a committed test, this repo is public):
//   1. The exact bug: Rs.4,000 to an unrelated person is NO LONGER
//      suggested as the Rs.4,000 SIP.
//   2. No regression: the real SIP payee written several different ways
//      ("ICCL - Mutual Funds", "mutual funds iccl on", ...) still matches.
//   3. Two SIPs with different amounts still resolve to the right one.
//   4. A payment with no payee at all (e.g. wallet) keeps the old
//      behavior — nothing to compare, so it isn't ruled out.
//   5. An event with no payee recorded anywhere (seeded) can't be judged,
//      so it keeps the old behavior too.
//   6. The user's own note ("Laptop emi") still matches an EMI no matter
//      who the payee is — the note is never payee-checked.
//   7. Once the dad payment is recorded as the Laptop EMI at Rs.4,000,
//      the next Rs.4,000 to dad is suggested as that EMI, not the SIP.
//   8. The old 4-argument call shape still works unchanged.
//
// Run with: node backend/tests/payeeAwareEventMatch.test.js

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

function loadBackend(){
  const sandbox = { console: console };
  vm.createContext(sandbox);
  ["financialEvents.js", "needWantSaving.js"].forEach(function(file){
    const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(code, sandbox, { filename: file });
  });
  return sandbox;
}

const sb = loadBackend();

const HEADER = ["Type", "Amount", "Counterparty", "Confirmed", "Name"];

// Rows: [Type, Amount, Counterparty, Confirmed, Name]
const feData = [
  HEADER,
  ["Investment", 4000, "",                     "", "HDFC Mid Cap Fund"],   // seeded, blank payee
  ["Investment", 4000, "iccl mutual funds",    "", "HDFC Mid Cap Fund"],   // a later real confirmation
  ["Investment", 3000, "",                     "", "Mutual Funds SIP"],
  ["Investment", 3000, "mutual funds iccl on", "", "Mutual Funds SIP"],
  ["Investment", 2000, "NSECLEARINGLIMITED",   "", "Bandhan Small Cap"],
  ["Investment", 5000, "",                     "", "Brand New Fund"],      // seeded only, no payee anywhere
  ["EMI",        1427, "RAMESH KUMAR SHAH",    "", "Laptop EMI"]
];

console.log("\n--- 1. The exact bug ---");
{
  const s = sb.suggestFinancialEvent("somebody else entirely on", 4000, feData, "");
  assert(!(s && s.type === "Investment"),
    "Rs.4000 to an unrelated payee is NOT suggested as the Rs.4000 SIP (got " + JSON.stringify(s) + ")");
}

console.log("\n--- 2. The real SIP payee, written several ways, still matches ---");
["ICCL - Mutual Funds", "mutual funds iccl on", "MUTUAL FUNDS ICCL",
 "iccl mutual funds autopay mandate umn bf main"].forEach(function(cp){
  const s = sb.suggestFinancialEvent(cp, 4000, feData, "");
  assert(s && s.type === "Investment" && s.name === "HDFC Mid Cap Fund" && s.confident === true,
    "payee \"" + cp + "\" at 4000 -> HDFC Mid Cap Fund, confident (got " + JSON.stringify(s) + ")");
});

console.log("\n--- 3. Different SIPs still resolve by amount + payee ---");
{
  const s = sb.suggestFinancialEvent("iccl mutual funds", 3000, feData, "");
  assert(s && s.name === "Mutual Funds SIP", "3000 via ICCL -> Mutual Funds SIP (got " + JSON.stringify(s) + ")");
  const t = sb.suggestFinancialEvent("NSECLEARINGLIMITED", 2000, feData, "");
  assert(t && t.name === "Bandhan Small Cap", "2000 via NSECLEARINGLIMITED -> Bandhan Small Cap (got " + JSON.stringify(t) + ")");
}

console.log("\n--- 3b. Same payee, glued vs split into words ---");
{
  const s = sb.suggestFinancialEvent("NSE Clearing Limited", 2000, feData, "");
  assert(s && s.name === "Bandhan Small Cap",
    "\"NSE Clearing Limited\" at 2000 still matches \"NSECLEARINGLIMITED\" (got " + JSON.stringify(s) + ")");
  const t = sb.suggestFinancialEvent("nse", 2000, feData, "");
  assert(!(t && t.name === "Bandhan Small Cap"),
    "a short unrelated fragment does not match by accident (got " + JSON.stringify(t) + ")");
}

console.log("\n--- 4. No payee on the payment: old behavior kept ---");
{
  const s = sb.suggestFinancialEvent("", 4000, feData, "");
  assert(s && s.name === "HDFC Mid Cap Fund", "blank payee at 4000 still matches by amount, as before (got " + JSON.stringify(s) + ")");
}

console.log("\n--- 5. Event with no payee recorded anywhere: can't judge, old behavior kept ---");
{
  const s = sb.suggestFinancialEvent("a random person", 5000, feData, "");
  assert(s && s.name === "Brand New Fund", "5000 matches the seeded-only fund, as before (got " + JSON.stringify(s) + ")");
}

console.log("\n--- 6. The note is never payee-checked ---");
{
  const s = sb.suggestFinancialEvent("somebody else entirely on", 4000, feData, "Laptop emi for the month");
  assert(s && s.type === "EMI" && s.name === "Laptop EMI",
    "note \"Laptop emi...\" -> Laptop EMI even though the amount and payee both differ (got " + JSON.stringify(s) + ")");
}

console.log("\n--- 7. After the dad payment is recorded as the Laptop EMI at 4000 ---");
{
  const data2 = feData.concat([["EMI", 4000, "RAMESH KUMAR SHAH", "", "Laptop EMI"]]);
  const s = sb.suggestFinancialEvent("ramesh kumar shah on", 4000, data2, "");
  assert(s && s.type === "EMI" && s.name === "Laptop EMI" && s.confident === true,
    "4000 to the same payee -> Laptop EMI, not the SIP (got " + JSON.stringify(s) + ")");
  const sip = sb.suggestFinancialEvent("iccl mutual funds", 4000, data2, "");
  assert(sip && sip.type === "Investment" && sip.name === "HDFC Mid Cap Fund",
    "the real SIP at 4000 is still the SIP (got " + JSON.stringify(sip) + ")");
}

console.log("\n--- 8. Old 4-argument call shape unchanged ---");
{
  const m = sb.matchRecurringNamedEvent("Investment", 3000, "", feData);
  assert(m && m.name === "Mutual Funds SIP", "4-arg call still matches by amount alone (got " + JSON.stringify(m) + ")");
}

console.log("\nDone.");
