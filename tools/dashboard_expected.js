// tools/dashboard_expected.js
//
// PLAIN-ENGLISH WHAT THIS IS: runs the app's REAL Home-screen code locally on
// a snapshot of the live sheet (a folder of <tab>.json files) and prints the
// result as JSON. Read-only: it changes nothing anywhere.
//
// Usage: node tools/dashboard_expected.js <snapshot-folder>

const fs = require("fs");
const path = require("path");
const { makeWorld } = require(path.join(__dirname, "..", "backend", "tests", "_fakeSheetsKit"));

const dir = process.argv[2];
const files = fs.readdirSync(path.join(__dirname, "..", "backend"))
  .filter((f) => f.endsWith(".js") && f !== "telegram.js");
const w = makeWorld(files);
w.sb.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };

fs.readdirSync(dir).filter((f) => f.endsWith(".json")).forEach((f) => {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const width = Math.max(1, ...rows.map((r) => r.length));
  // Google Sheets hands the real app genuine date objects, but the snapshot
  // only has the text the sheet displays ("2026-05-26"). Turn date-looking
  // text back into dates so the code behaves like it does inside Apps Script.
  const DATE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/;
  const toDate = (v) => {
    const m = typeof v === "string" && DATE.exec(v);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : v;
  };
  w.addSheet(f.replace(/\.json$/, ""), rows.map((r) => { const c = r.map(toDate); while (c.length < width) c.push(""); return c; }));
});

console.log(JSON.stringify(w.sb.getDashboardData()));
