// backend/tests/eventAmountOnlyIsStrict.test.js
//
// Plain English: a remembered "Internet Bill" (EMI, about Rs.490) and "wallet top up" (Investment, about Rs.100) were being
// suggested on every ordinary payment of a similar size (food Rs.464, fuel Rs.453, a Rs.76 snack...), because the amount rule
// allows Rs.50 / 5% of slack and those events had no payee recorded. Fix (financialEvents.js): when the payee gives no clue,
// the amount must be within Rs.2 / 1%. All data is synthetic.
// Run: node backend/tests/eventAmountOnlyIsStrict.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
function assert(c, m){ if(!c){ console.error("FAIL: " + m); process.exitCode = 1; } else console.log("PASS: " + m); }
const sb = { console: console };
sb.dbSs_ = function(){ return sb.SpreadsheetApp.getActiveSpreadsheet(); };
sb.dbProps_ = function(){ return sb.PropertiesService.getScriptProperties(); };
vm.createContext(sb);
["financialEvents.js", "needWantSaving.js"].forEach(function(f){ vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sb, { filename: f }); });

const data = [
  ["Type", "Amount", "Counterparty", "Confirmed", "Name"],
  ["EMI", 489, "", "", "Internet Bill"],               // no payee recorded
  ["Investment", 100, "", "", "Wallet Top Up"],         // no payee recorded
  ["Investment", 4000, "iccl mutual funds", "", "Fund SIP"]
];
const s = function(cp, amt, note){ return sb.suggestFinancialEvent(cp, amt, data, note || ""); };

[464.86, 479, 461, 500, 453.7, 449].forEach(function(a){ assert(s("zomato on", a) === null, "a Rs." + a + " food/fuel payment is not suggested as the Internet Bill"); });
[76, 80, 90, 120, 60, 135, 150].forEach(function(a){ assert(s("", a) === null, "a Rs." + a + " payment with no payee is not suggested as the wallet top-up"); });
assert(s("airtel broadband", 489) && s("airtel broadband", 489).name === "Internet Bill", "the real Internet Bill (same amount) is still recognised");
assert(s("", 489.5) && s("", 489.5).name === "Internet Bill", "a payment within Rs.2 of the remembered amount still matches");
assert(s("", 100) && s("", 100).name === "Wallet Top Up", "an exact wallet top-up amount still matches");
assert(s("mutual funds iccl on", 4100) && s("mutual funds iccl on", 4100).name === "Fund SIP", "a SIP with a recorded payee keeps the loose amount rule (payee agrees)");
assert(s("someone else", 4000) === null, "same SIP amount but a different payee is still refused");
assert(s("zomato on", 464.86, "Internet bill paid") && s("zomato on", 464.86, "Internet bill paid").name === "Internet Bill", "the note still matches by its own words");
