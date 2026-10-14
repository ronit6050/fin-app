// functions/runtime/tokens.js
//
// PLAIN-ENGLISH WHAT THIS IS: gets the short-lived "permission slips" the server needs.
//   - Firestore (the database), and Firebase Cloud Messaging (push notifications, added 2026-10-14 for saves that notify someone).
//   - On Firebase (Cloud Functions): the server's own identity, from Google's metadata service. No key file, no secret to store.
//   - On your computer (local testing only): signs one with the robot key file named in FIN_LOCAL_KEY (never inside the repo).
// Each kind is cached for ~50 minutes.

const crypto = require("node:crypto");
const fs = require("node:fs");
const { syncFetch } = require("./syncfetch");

const FS_SCOPE = "https://www.googleapis.com/auth/datastore";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const caches = {};                                   // scope -> { token, until }

function b64url(buf){ return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }

function fromMetadata(scope){
  const r = syncFetch({
    url: "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=" + encodeURIComponent(scope),
    method: "GET", headers: { "Metadata-Flavor": "Google" }, timeoutMs: 8000
  });
  const body = JSON.parse(r.text);
  if(!body.access_token) throw new Error("Sign-in (metadata) failed.");
  return { token: body.access_token, secs: Number(body.expires_in) || 3000 };
}

function fromLocalKey(path, scope){
  const sa = JSON.parse(fs.readFileSync(path, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const input = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: sa.client_email, scope: scope, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now }));
  const signature = b64url(crypto.sign("RSA-SHA256", Buffer.from(input), sa.private_key));
  const r = syncFetch({
    url: "https://oauth2.googleapis.com/token", method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(input + "." + signature)
  });
  const body = JSON.parse(r.text);
  if(!body.access_token) throw new Error("Sign-in (local key) failed: " + String(body.error_description || body.error || "").slice(0, 120));
  return { token: body.access_token, secs: 3000 };
}

function getToken(scope){
  const c = caches[scope];
  if(c && c.token && Date.now() < c.until) return c.token;
  const got = process.env.K_SERVICE ? fromMetadata(scope) : (process.env.FIN_LOCAL_KEY ? fromLocalKey(process.env.FIN_LOCAL_KEY, scope) : null);
  if(!got) throw new Error("No way to sign in (not on Firebase, and FIN_LOCAL_KEY is not set).");
  caches[scope] = { token: got.token, until: Date.now() + Math.min(got.secs, 3000) * 1000 - 60000 };
  return caches[scope].token;
}

function getFirestoreToken(){ return getToken(FS_SCOPE); }
function getMessagingToken(){ return getToken(FCM_SCOPE); }

module.exports = { getFirestoreToken, getMessagingToken };
