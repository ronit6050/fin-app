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

**DEPLOYED 2026-10-14** (function `api`, asia-south1, `https://asia-south1-fin-app-76c40.cloudfunctions.net/api`; billing had to be "open" first;
on this PC the deploy needs `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"`; an image cleanup rule deletes build images older than 1 day:
`firebase functions:artifacts:setpolicy --location asia-south1`). Real phone test of the read screens: all answers 200, no errors, 0.1-1.1 s.

## Step 2: SAVING on the new server (built 2026-10-14; NOT live until the owner says so)

**The rule:** only ONE server saves at a time, however many there are. Apps Script always had one lock; the new server (up to 3 instances)
plus Apps Script need a shared one: `backend/sharedLock.js`, a "lease" in the Firestore document `_system/lock_global` (who holds it + when it
runs out, 45 s so a crashed holder never blocks saving for ever; taken with "only if new" / "only if unchanged since" so two servers
grabbing it at the same instant cannot both win; given back with the same check so a late holder cannot free someone else's lease).
Underneath it the older safety net still applies: every saved tab refuses to overwrite a same-instant change by someone else (`v2db.js`).

**Switch (global, owner, instant):** Script Property `V2_FN_WRITES`. `v2dbEnableFunctionWrites()` / `v2dbDisableFunctionWrites()` in the Apps Script
editor (they also copy the switch to `_system/props`, which the function re-reads every 20 s). OFF (default): Apps Script behaves exactly as
before (its own lock, zero extra Firestore calls) and the function refuses every save with `fallback:true`. ON: Apps Script saves, the bank-SMS
landing (`ingest.js`, `smsIn.js`) and the owner's timer job (`v2owner.js`) also take the lease. Those background paths are **fail-open** (if the lease
cannot be had in time they carry on with just the Apps Script lock and log `SHARED_LOCK_SKIPPED`: a bank SMS must never be dropped); a save the
person taps is **fail-closed** ("try again", everything given back).

**What the function accepts** (`WRITE_ACTIONS` in `functions/index.js`): saveNote, markNotATransaction, debts (add/settle/payment), savings (all),
investments (add instrument/log/update), cash (add/update), addManualTransaction, updateSettings, saveBudgets, registerPushToken, the Splits actions
(addFriend, createSplit, recordSplitPayment, undoSplitEntry) and refreshViews (rebuilds the Home copy; owner only). **Always stays on Apps Script**:
Reconcile/statement actions (they use the owner's Drive), Access/admin, the SMS doors, the timers.

**Push from the new server:** `sendPushToToken_` is replaced in the shim by a version that signs in with the function's own identity (scope
`firebase.messaging`) instead of the key in Script Properties. NOT yet proven live (needs a real device token): check the function logs for
`PUSH_SENT` vs `PUSH_ERROR` after the first split/notification; if it is a permission error, grant the function's service account
(`921605499750-compute@developer.gserviceaccount.com`) the "Firebase Cloud Messaging API Admin" role.

**The app (Settings > Speed > New server):** now 3 choices: Off / Reads only / **Reads and saves**. A save is sent to the new server first. Only an
explicit `fallback:true` ("I did nothing") makes the app ask Apps Script to do it. NO answer (network drop, 70 s timeout, unreadable reply) is NOT
retried anywhere (it might already be saved; retrying could save it twice): the screen's normal "couldn't save" handling shows. After a save, the
"rebuild the Home copy" step (`refreshViews`) also goes to the new server first and falls back to Apps Script (safe to repeat).

**Tests:** `backend/tests/sharedLock.test.js` (the lease: free/busy/expired/same-instant/fail-open/fail-closed), `functions/tests/writes.test.js` (the
front door: refused while off, allow-list, a failed save is never a fallback), `functions/tests/shim.test.js` section 7, `backend/tests/newServerClient.test.js`
(the app's routing rules, run on the REAL code from index.html), `backend/tests/fastViewsClient.test.js` 7b. **Real-database proof:**
`functions/tests/live_scratch.js` (needs `FIN_LOCAL_KEY`; a made-up owner `qa-fnwrites@example.com`, its own lock document, cleans up after itself): saves,
Pending, saveNote, and TWO servers saving 6 times each at once -> 12/12 saved, balance exact, lock released, nothing left behind.

**Turn on, in this order (each step reversible):** (1) deploy the function (`firebase deploy --only functions`, with the timeout variable above) and
`clasp push` + `clasp deploy` the backend (the lock code is inert while the switch is off); (2) `git push` the app; (3) run `v2dbEnableFunctionWrites`
in the Apps Script editor; (4) on ONE phone pick "Reads and saves", save a note, add a cash entry, check the function logs; (5) widen. **Roll back:**
`v2dbDisableFunctionWrites` (instant, for everyone) or pick "Reads only"/"Off" on the phone.

**Reviewer notes (2026-10-14, independent review: safe to ship while the switch is OFF):** the phone's wait for a save is 70 s, deliberately longer than the function's 60 s limit (a shorter wait could give up on a save that then completes, and the person would save it twice). The function re-reads the switch every 20 s, so turning saving off can take up to 20 s to reach it (the per-tab check covers the gap). The "Home copy needs a rebuild" flag lives in each server's own memory: a second phone may see old Home numbers for up to 30 minutes after a save made through the function (the saving phone rebuilds it at once). With the switch on there is NO automatic fallback if the function is down at the platform level: use the dropdown or `v2dbDisableFunctionWrites`.

**Known limits:** the lease is one global lock for everyone (fine for a handful of people; make it per person before there are many); a save that
takes longer than 45 s could lose the lease (the per-tab "unchanged since" check still protects the data); the Home copy rebuilt by the function and
the V2_DIRTY flag kept in Apps Script's memory are separate (the app asks for the rebuild itself after each save, and the timer still rebuilds every 30
minutes); Firestore usage counters are per server (a save now costs about 1 read + 2 writes more for the lock while the switch is on).

**Next steps:** the SMS door (Android app / Tasker posting straight to the function), then the timers (Cloud Scheduler), then retire the Apps Script parts.
