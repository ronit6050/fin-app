// functions/index.js
//
// PLAIN-ENGLISH WHAT THIS IS: the front door of the NEW server (Firebase Cloud Functions). The app sends the same requests it sends to
// Apps Script; this runs the SAME backend code (backend/*.js, copied in at deploy time) next to the database. For now it only answers
// the READ-ONLY screens. Anything else, or any problem, gets a "fallback" answer and the app asks Apps Script instead, so nothing can
// break. See docs/features/cloud-functions.md.

const { onRequest } = require("firebase-functions/v2/https");
const path = require("node:path");
const fs = require("node:fs");
const { createRuntime } = require("./runtime/shim");

const ALLOWED_ORIGINS = ["https://ronit6050.github.io"];
// The only actions this server answers (all read-only). Everything else is refused with fallback:true.
const READ_ACTIONS = ["ping", "getMyAccess", "getPending", "getDashboard", "getTodaySummary", "getMonthlyAnalysis", "getCCAdvisor",
  "getDebts", "getCash", "getInvestments", "getInvestmentInstruments", "getSavingsGoals", "getTransactionHistory", "getPlannerData",
  "getSettings", "getPeople", "getPerson"];
const MAX_BODY_BYTES = 200000;

let runtime = null;     // built once per server instance (the backend code is loaded then, not on every request)

function getRuntime(){
  if(!runtime){
    const copied = path.join(__dirname, "backend");                       // put here by scripts/copy-backend.js at deploy time
    runtime = createRuntime({ backendDir: fs.existsSync(copied) ? copied : path.join(__dirname, "..", "backend") });
  }
  return runtime;
}

function setCors(req, res){
  const origin = req.get("origin");
  if(origin && ALLOWED_ORIGINS.indexOf(origin) !== -1){
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

exports.api = onRequest({
  region: "asia-south1",          // next to the Firestore database (Mumbai)
  memory: "512MiB",
  timeoutSeconds: 60,
  concurrency: 1,                 // the backend code waits for each network call, so one request at a time per instance
  maxInstances: 3,
  minInstances: 0,                // 0 = free when idle; the first request after a quiet spell is a little slower
  cors: false                     // handled by hand above (only the app's own web address)
}, function(req, res){
  setCors(req, res);
  if(req.method === "OPTIONS"){ res.status(204).send(""); return; }
  if(req.method !== "POST"){ res.status(405).json({ ok: false, error: "POST only." }); return; }

  let data;
  try{
    const raw = req.rawBody ? req.rawBody.toString("utf8") : (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));
    if(raw.length > MAX_BODY_BYTES){ res.status(413).json({ ok: false, fallback: true, error: "Too large." }); return; }
    data = JSON.parse(raw);
  }catch(e){
    res.status(200).json({ ok: false, fallback: true, error: "Unreadable request." });
    return;
  }

  if(!data || READ_ACTIONS.indexOf(String(data.action)) === -1){
    res.status(200).json({ ok: false, fallback: true, error: "Not available on the new server yet." });
    return;
  }

  try{
    res.status(200).json(getRuntime().call(data));
  }catch(err){
    console.error(JSON.stringify({ severity: "ERROR", type: "FUNCTION_ERROR", action: data.action, message: String(err && err.message).slice(0, 300) }));
    res.status(200).json({ ok: false, fallback: true, error: "The new server hit a problem." });
  }
});
