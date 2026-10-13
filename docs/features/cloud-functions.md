# New server: the backend on Firebase Cloud Functions (started 2026-10-14)

**Why:** every tap used to wait for Google Apps Script (slow wake-ups, far from the database). Firebase Cloud Functions runs in
Mumbai (asia-south1), next to Firestore, and the Blaze plan allows it.

**How (no rewrite):** the SAME backend files (`backend/*.js`) run inside Node on Cloud Functions. `functions/runtime/shim.js` builds a
small "pretend Apps Script" around them (`Utilities`, `Session`, `PropertiesService`, `CacheService`, `LockService`, `UrlFetchApp`,
`ContentService`, `ScriptApp`) so no backend file had to change. Network calls are made to *wait* (`runtime/syncfetch.js`, a helper
thread + `Atomics.wait`) exactly like `UrlFetchApp.fetch`, so the function runs one request per instance (`concurrency: 1`).
There is deliberately **no pretend Google Sheet**: the new server only serves people who are on the Firestore copy (`v2db.js`). If
code tries to use a real Sheet it fails loudly and the app falls back to Apps Script.

**Step 1 (this step): read-only.** `functions/index.js` answers only these actions: ping, getMyAccess, getPending, getDashboard,
getTodaySummary, getMonthlyAnalysis, getCCAdvisor, getDebts, getCash, getInvestments, getInvestmentInstruments, getSavingsGoals,
getTransactionHistory, getPlannerData, getSettings, getPeople, getPerson. Everything else (all saves, notifications, SMS, statements,
Access, the timers) stays on Apps Script and gets `{ok:false, fallback:true}` here.

**The app (index.html):** Settings > Speed > "New server (beta)", default OFF, per phone. When ON, a read action is sent to the new
server first (15 s timeout); any problem (network, timeout, `fallback:true`, error answer) quietly repeats the request on Apps Script.
So it cannot break a screen. Settings shows the last request's server and time. `NEW_SERVER_URL` is
`https://asia-south1-fin-app-76c40.cloudfunctions.net/api`.

**Shared state:** the on/off switches (`V2DB_OWNER`, `V2DB_USERS`) stay in Apps Script Script Properties and are copied to the
Firestore document `_system/props` by `exportFlagsToFunctions()` (called by `v2dbEnableUser/DisableUser/EnableOwner/DisableOwner`;
closed to every phone, tested in `tools/rules_privacy_test.py`). The function re-reads them every 20 s. Firestore sign-in uses the
function's own identity (no key stored); logs go to Cloud Logging.

**Check done before shipping:** all 15 read screens ran on the owner's real data through the shim; the Home screen matched the copy
Apps Script had published except for Rs 40 that was explained by splits made after that copy was built (the new answer was right).
`functions/tests/shim.test.js` (no network) and `backend/tests/v2route.test.js` section 8 cover the rest.

**Known limits of step 1:** Firestore usage counters are per server instance (not summed with Apps Script's); there is no write
locking here (reads only); minInstances is 0, so the first request after a quiet spell is slower (cold start).

**Deploy:** `firebase login` once, then `firebase deploy --only functions` from the repo root (the predeploy step copies
`backend/*.js` into `functions/backend/`, which is git-ignored). Roll back by turning the Settings switch Off (or deleting the function).

**Next steps:** compare latency on a phone; then writes (needs a real lock and a rule that only ONE server writes a given person at a
time), then SMS landing in Firestore, then retire the Apps Script parts.
