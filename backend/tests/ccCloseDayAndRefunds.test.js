// Test for the 2026-11-20 card-bill fix: (1) the statement closing day is a setting (card 8132 closes on the 19th, not the 18th),
// (2) refunds put back on a card lower that card's bill, like on the real statement. Run: node backend/tests/ccCloseDayAndRefunds.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");

function assert(cond, msg){ if(!cond){ console.error("FAIL: " + msg); process.exitCode = 1; } else console.log("PASS: " + msg); }

function load(closeDayProp){
  const sb = {
    SpreadsheetApp: { getActiveSpreadsheet: function(){ return { getSheetByName: function(){ return null; } }; } },
    PropertiesService: { getScriptProperties: function(){ return { getProperty: function(k){ return k === "SETTING_CC_CLOSE_DAY" ? closeDayProp : null; }, setProperty: function(){} }; } },
    Utilities: { formatDate: function(d){ return new Date(d).toISOString().slice(0, 10); } },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} }, console: console
  };
  sb.dbSs_ = function(){ return sb.SpreadsheetApp.getActiveSpreadsheet(); };
  sb.dbProps_ = function(){ return sb.PropertiesService.getScriptProperties(); };
  vm.createContext(sb);
  ["settings.js", "PWA.js"].forEach(function(f){ vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sb, { filename: f }); });
  return sb;
}
const H = ["Date","Time","Bank","Type","Mode","Amount"];
const row = function(d, type, mode, amt){ return [d, "10:00", "HDFC", type, mode, amt]; };

// default: nothing saved -> 18, the way the app always worked
let sb = load(null);
assert(sb.getCCCloseDay_() === 18, "no saved setting -> closing day 18");
assert(load("19").getCCCloseDay_() === 19, "saved 19 -> closing day 19");
assert(load("40").getCCCloseDay_() === 18 && load("abc").getCCCloseDay_() === 18, "out-of-range or junk value -> falls back to 18");

// with close day 19: window = (previous close + 1) .. close
sb = load("19");
const w = sb.getOutstandingCCCycleWindow_();
assert(w.end.getDate() === 19, "window ends on the 19th");
assert(w.start.getDate() === 20, "window starts on the 20th");
const iso = function(d){ return d; };
const day = function(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };

const rows = [H,
  row(iso(day(w.start, -1)), "debit", "card 8132", 488.82),   // the 19th of the previous month: belongs to the PREVIOUS statement
  row(iso(w.start), "debit", "card 8132", 1000),               // first day of the cycle
  row(iso(day(w.start, 5)), "debit", "card 8132", 500),
  row(iso(w.end), "debit", "card 8132", 200),                  // last day of the cycle
  row(iso(day(w.start, 6)), "credit", "card 8132", 212),       // a refund on the card
  row(iso(day(w.start, 7)), "debit", "card 1264", 149),        // the other card
  row(iso(day(w.end, 1)), "debit", "card 8132", 999)           // next cycle
];
let t = sb.getOutstandingCCBillTotalsByCard(rows);
assert(Math.abs(t["card 8132"] - (1000 + 500 + 200 - 212)) < 0.001, "card 8132 bill = charges in its cycle minus the refund (" + t["card 8132"] + ")");
assert(t["card 1264"] === 149, "the other card keeps its own separate total");

// a card whose refunds cancel everything has no bucket at all
t = sb.getOutstandingCCBillTotalsByCard([H, row(iso(w.start), "debit", "card 8132", 50), row(iso(w.start), "credit", "card 8132", 50)]);
assert(!("card 8132" in t), "fully refunded card shows no bill");

// a refund on a non-card mode (e.g. upi) never touches the card bill
t = sb.getOutstandingCCBillTotalsByCard([H, row(iso(w.start), "debit", "card 8132", 300), row(iso(w.start), "credit", "upi", 100)]);
assert(t["card 8132"] === 300, "a UPI credit does not reduce the card bill");

// the old default (18) still gives the old window
sb = load(null);
const w18 = sb.getOutstandingCCCycleWindow_();
assert(w18.end.getDate() === 18 && w18.start.getDate() === 19, "default window is still 19th..18th");
