// tools/backfill_preview.js
//
// PLAIN-ENGLISH WHAT THIS IS: runs the app's REAL category-guessing code
// (the same previewMissingCategories used inside the app) against a snapshot
// of the live Transactions + SmartMemory tabs, and prints what it would fill
// in as JSON. It only reads the snapshot file you give it and changes nothing.
//
// Usage: node tools/backfill_preview.js <snapshot.json>
//   snapshot.json = { "Transactions": [[...rows...]], "SmartMemory": [[...]] }

const fs = require("fs");
const path = require("path");
const { makeWorld } = require(path.join(__dirname, "..", "backend", "tests", "_fakeSheetsKit"));

const snap = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const WIDTH = 19; // Transactions has columns A..S in use
const pad = (rows) => rows.map((r) => { const c = r.slice(); while (c.length < WIDTH) c.push(""); return c; });

const w = makeWorld(["category.js", "noteWordModel.js", "noteMemory.js", "needWantSaving.js",
  "financialEvents.js", "investmentInstruments.js", "savingsGoals.js", "PWA.js", "Logger.js"]);
w.addSheet("Transactions", pad(snap.Transactions));
w.addSheet("SmartMemory", snap.SmartMemory || []);

const text = w.sb.previewMissingCategories();
const re = /- Row (\d+): "([^"]*)" \(([\s\S]*?), Rs\.(\d+(?:\.\d+)?)\) -> (\w+)/g;
const out = [];
let m;
while ((m = re.exec(text))) {
  out.push({ row: +m[1], note: m[2], counterparty: m[3].replace(/\s+/g, " ").trim(), amount: +m[4], category: m[5] });
}
console.log(JSON.stringify(out));
