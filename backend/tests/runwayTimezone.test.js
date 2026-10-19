// Regression (2026-10-19): the runway balance must not depend on the machine's time zone.
// The new server runs on UTC; a payment made after the morning balance update was ignored there.
const fs = require("fs"), vm = require("vm"), path = require("path");
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "runway.js"), "utf8"));
let fails = 0;
function check(name, got, want){ if(got !== want){ fails++; console.log("FAIL", name, "got", got, "want", want); } else console.log("ok  ", name); }
const ck = Date.parse("2026-10-19T09:00:00+05:30");                 // balance confirmed 09:00 IST
const day = new Date("2026-10-19T00:00:00+05:30");
const row = (t, amt, type) => [day, t, "x", type || "debit", "upi", amt];
check("before-update payment ignored, after-update counted",
  runwayRollForward_([[], row("08:30", 500), row("10:00", 100)], ck), -100);
check("credit after update counted", runwayRollForward_([[], row("11:15", 250, "credit")], ck), 250);
check("row time is the right instant", runwayRowTime_(row("10:00", 1)).getTime(), Date.parse("2026-10-19T10:00:00+05:30"));
check("no time cell keeps the date cell's own time", runwayRowTime_([new Date("2026-10-19T12:20:00+05:30"), "", "x", "debit", "upi", 1]).getTime(), Date.parse("2026-10-19T12:20:00+05:30"));
process.exit(fails ? 1 : 0);
