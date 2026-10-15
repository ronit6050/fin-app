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

## Step 4: the ALERT TIMER on the new server (built 2026-10-14/15; NOT deployed, switch OFF)

**What moves:** the 5-minute Apps Script timer (`processNewTransactions`: alert new transactions with the quick-confirm buttons, auto-settle the known
ones, rebuild the Home copy). A Cloud Scheduler job (created by `exports.tick`, `functions/index.js`, "every 5 minutes", India time, 1 instance, no retries)
calls the new server. **One job = inside Cloud Scheduler's free allowance.** The other Apps Script timers (daily cash check-in, debt due dates, upcoming
Rent/EMI reminders, app health, the backup export) are NOT moved yet (next sub-steps).

**Why a tick is cheap:** reading the owner's whole database every 5 minutes would use the free Firestore reads (45,000 a day safe limit). A tick first reads ONE tiny
document (`_system/timer`: `dirtyAtMs`, `doneAtMs`, `fullAtMs`) and only runs the real work when (a) something marked "changed" since the last real run, or (b) 30 minutes
passed since the last full look (safety net, also keeps the Home copy fresh). Measured on the real database: a quiet tick = **1 read**. Who marks "changed": the owner's SMS
door (`smsIn.js`, after it saves his row) and the Apps Script inbox step (after it copies rows the OLD door wrote into the Sheet). `backend/fnTimer.js`: `timerMarkDirty_`, `timerTick_`.

**Switch (instant, reversible):** Script Property `V2_FN_TIMER` (`v2dbEnableFunctionTimer` / `v2dbDisableFunctionTimer`; the disable one throws if it could not tell the new
server). It also needs saving on the new server on. While it is ON: the new server's tick does the alerts; the Apps Script `processNewTransactions` STEPS ASIDE (only
`v2OwnerInboxOnly_`: copies old-door rows from the Sheet into his private copy when the Sheet's row count changed; zero Firestore reads otherwise) so nothing is ever announced
twice. If the owner is not on the private copy, Apps Script keeps doing everything. OFF (default): nothing changes.

**Still on Apps Script on purpose:** the inbox copy (the OLD SMS doors, door 2 / Tasker-era, still write the Google Sheet; the new server has no Sheet). It goes away when door 2 is retired.

**Push must work from the new server first:** new owner-only action `pushTest` + Settings > Speed > "Send a test notification (new server)" (app `2026-10-15-01`). It sends ONE
notification to your phone from the new server and shows what Google's push service answered. If it says it could not send (permission), grant the function's service account
(`921605499750-compute@developer.gserviceaccount.com`) the role "Firebase Cloud Messaging API Admin" and retry. Do NOT switch the timer on before this passes.
`sendPushToToken_` now returns `{sent, code, detail}` (callers that ignore it are unaffected).

**Also fixed for the new server:** the retired Telegram file is not loaded there, so `TELEGRAM_ENABLED`, `getConfig` and `sendMessage` (a message becomes a push, first line = title)
are provided by the shim; `v2OwnerTakeOver_` skips the Sheet-only inbox/stamp/heal steps there.

**Tests:** `backend/tests/fnTimer.test.js` (28 checks, proven to fail when the step-aside is broken), `functions/tests/writes.test.js` 4c (schedule options, crash safety, pushTest),
`functions/tests/live_scratch.js` 1c on the REAL database (first tick alerts the waiting rows, quiet tick = 1 read, a new SMS is alerted exactly once, then quiet again).

**Turn on (each step reversible):** (1) deploy function (creates the scheduler job; it does nothing while the switch is off) + `clasp push`/`clasp deploy` + `git push`; (2) in the app press
"Send a test notification (new server)" and confirm it arrives; (3) run `v2dbEnableFunctionTimer` in the Apps Script editor; (4) send a test SMS: the notification should arrive within ~5 minutes
(function logs show `TICK ran:true`), exactly once; (5) watch Today's Firestore use on the Access screen for a day. **Roll back:** `v2dbDisableFunctionTimer` (Apps Script alerts again at once).

**Fixes after the independent review (2026-10-15; the first version was "safe with the switch off, NOT safe to switch on"):**
(1) **Dead-man protection.** Every tick (even a quiet one) writes a heartbeat (`tickAtMs`). Apps Script steps aside ONLY while that heartbeat is under 12 minutes old; if the new server stops
ticking (scheduler job paused, function down, a switch that did not arrive) Apps Script takes the whole job back by itself and logs `FN_TIMER_STALE`. `v2dbEnableFunctionTimer` now refuses unless
new-server saving is on and the new server was really told (otherwise it leaves the switch off). A quiet tick is now 1 read + 1 write. (2) **No endless repeat announcements.** A run that fails is not marked
done and is retried, but after 3 failed runs in a row it waits for the next full look (`failCount`, logged `TIMER_RUN_FAILED`); the function's time limit is 300 s. (3) **Home copy stays fresh.** Every successful
app save marks "changed" (`publishAfterAction_`, only while the timer switch is on), and a marked tick makes the new server rebuild the Home copy. (Also: "done" is stamped 5 s before the run started, to
tolerate a small difference between the Apps Script and Cloud Run clocks; a mark made in that window is looked at once more, harmlessly.)
Tests: `backend/tests/fnTimer.test.js` (44 checks), and the real-database `live_scratch.js` section 1c.

**Known limits:** an alert can be up to 5 minutes late (same as the Apps Script timer); a push that Google refuses still marks the row alerted (same as before; the test button is the proof); the Home copy is rebuilt by the new server only when a run happens (marked change or every 30 min); the
in-memory "Home copy due" flags are per instance, so a cold instance may rebuild it one extra time.

## Step 5: the four daily jobs on the new server (built 2026-10-15)

The once-a-day jobs (upcoming Rent/EMI reminder **8:30**, debt due dates **9:00**, app health **9:30**, evening cash check-in **20:00**, India time) now run from the SAME 5-minute tick
(`backend/fnTimer.js`: `TIMER_DAILY_JOBS_`, `timerTick_`): no extra scheduler job, no extra cost. Each job stores the date it last ran (`daily_obligations`, `daily_debts`, `daily_health`, `daily_cash`)
in `_system/timer` (the document the tick already reads), and runs once a day at the first tick after its time. If the new server was down, the first tick after it comes back catches up all
missed jobs of that day. A failing job is logged (`DAILY_JOB_FAILED`) and still counts as today's run (it cannot repeat every 5 minutes); the other jobs still run. They only run while the timer switch
(`V2_FN_TIMER`) is on.

**The Apps Script versions** (`sendDailyCashCheckin`, `checkDebtDueDates`, `checkUpcomingObligations`, `checkAppHealth`) call `timerDailySkip_` first: while the switch is on they skip if today's run is already
recorded OR the new server's heartbeat is fresh (it will run the job at its time); if the new server is not ticking they run as before AND record the day, so it never repeats. Switch off = exactly as
before. **After the new timer has run for a day you can delete the four Apps Script triggers** (they become harmless no-ops while the new server is alive, but are not needed).

**Health check on the new server:** it no longer inspects Apps Script timers there (it would raise a false "timer missing" alarm every day); errors of the new server are in Cloud Logging, not the AILogs tab,
so the health check's "logged errors" part only sees Apps Script-side errors. The new timer is watched by its heartbeat instead.

**Tests:** `backend/tests/fnTimer.test.js` sections 10-12 (68 checks): each job once a day at its time, catch-up after downtime, one failing job does not stop the others, Apps Script steps aside only while alive,
health-check timers; real database: `functions/tests/live_scratch.js` section 1d runs all four jobs with the real code and no stand-ins (no errors, evening notification produced, second tick runs none).
**Backups:** Firestore point-in-time recovery (7 days) was switched on 2026-10-15 (`pointInTimeRecoveryEnablement`), cost well under Re 1 a month at this size.

## Step 6: Reconcile (statement upload) on the new server (built 2026-10-15)

**Before:** the bank/card statement file was uploaded to Apps Script, which used YOUR Google Drive to convert it into a Sheet. The new server has no Drive.
**Now:** a spreadsheet statement (`.xls` / `.xlsx`) is read ON THE PHONE (index.html: `loadSheetJs`, `sheetRowsFromWorkbook`, `extractSheetRowsClientSide`; SheetJS 0.18.5 from cdnjs, loaded
only when such a file is picked, open-source, runs on the phone; the same idea as pdf.js for card PDFs). The phone sends the rows (first sheet, counted from the very first row, max 5,000 rows x 30 columns)
instead of the file. `Recon.js` wraps the rows like a Sheet (`reconSheetFromRows_`) so the existing parsers and the existing matching are unchanged. Both servers accept `rows` (so it works on Apps Script too);
a PDF card statement still sends its text (pdf.js). If the phone cannot read the file at all it sends the raw file as before (Apps Script's Drive path, until Apps Script is retired); the new server answers
`fallback:true` for a raw file with no rows/text.
**On the new server:** `reconcileStatement` and `reconcileCreditCardStatement` are accepted only with rows/text; `insertReconciledTransactions` and `fixCreditCardTransactionMode` (the saves) need new-server saving on.
`Recon.js` and `Credit Card.js` are now loaded there (their Drive helpers are never called). The "shadow copy of a reconciled row into the old Google Sheet" (for the OLD SMS reader's duplicate check) is skipped on the
new server (no Sheet): harmless while the owner's SMS go through the new door; it matters only for a message that falls all the way back to the old reader. Request body limit raised to 1 MB for statement rows.
**Number dates:** `parseIndianDate` now also reads a spreadsheet date number (days since 1899-12-30).
**Tests:** `backend/tests/reconcileRows.test.js` (30 checks: text/number/date-object dates, card statement, bad input, save with no Sheet, re-upload adds nothing), `backend/tests/reconcileXlsEndToEnd.test.js`
(a genuine binary .xls made with SheetJS, read by the real index.html code, then previewed; skipped unless SheetJS is installed: `XLSX_DIR`), `functions/tests/writes.test.js` 4d, `backend/tests/newServerClient.test.js`,
and `functions/tests/live_sweep.js` (real database: preview, save, second upload finds nothing).
**NOT yet verified:** a real statement file from the bank (none was available): the layout assumptions (data from sheet row 23; columns date, narration, reference, value date, withdrawal, deposit) are the ones the
old Drive-based code already used, and the end-to-end test reproduces them with a real .xls. First real use: upload a recent statement from More > Reconcile and check the counts look right.
**Access screen:** deliberately NOT moved yet. Its "give/remove a friend's full app" switch lives in Apps Script's own settings (Script Properties); moving it means moving all the global switches into Firestore, which is
planned together with retiring Apps Script (after the 3 clean days).

## Step 7: the on/off switches live in the database (built 2026-10-15)

**Before:** the global switches (`V2DB_OWNER`, `V2DB_USERS`, `V2DB_OWNER_DIRECT`, `V2_FN_WRITES`, `V2_FN_SMS`, `V2_FN_TIMER`) were kept in Apps Script's Script Properties and COPIED to the Firestore document
`_system/props` for the new server, which could read them but never change them. **Now** `_system/props` IS the switch store (`backend/flags.js`): both servers read it and either can change it.
- **Reading** (`flagGet_`, `flagOn_`, `flagsAll_`): the new server reads its own copy (the shim loads the document every 20 s, unchanged); Apps Script reads the document and remembers it 30 s (one read a busy minute),
  falls back to the last copy seen (6 h), then to the old Script Properties. **Emergency brake:** run `v2dbFlagsLegacyOn` (Script Property `FLAGS_LEGACY=on`): Apps Script ignores the database and reads only its own
  Script Properties again (`v2dbFlagsLegacyOff` undoes it).
- **Changing** (`flagsSet_`): changes only the named switches, safely when two writers collide (the second looks again; "only if unchanged since"), keeps Apps Script's old Script Properties in step (so the fallback is right),
  updates this server's memory at once, and throws a plain "NOTHING was changed" message if the database refused. All `v2dbEnable.../v2dbDisable...` functions (`v2route.js`) and `v2dbEnableOwnerDirect` use it. A secret or any other
  setting can never be written here (only the six names are accepted).
- `exportFlagsToFunctions()` now only seeds a MISSING document from the old settings (never overwrites). Before this went live the real document was checked: it held all six switches (owner on, one friend, all new-server switches on).
- **Why:** the new server can now change switches itself, which is one of the two things that kept the Access screen (give/remove a friend's full app) on Apps Script. The other is the **Firestore usage meter** (below).
**Still on Apps Script on purpose after this step:** the Access screen's actions. Its "today's Firestore use" numbers come from a per-server counter kept in Script Properties (`FS_USAGE_*`, `fsFlushUsage_`, also the daily safety limit
that protects the free allowance): the new server's own usage is not in it (a known limit since step 1), so moving the screen now would show wrong numbers. NEXT: make the usage meter a shared Firestore counter, then move the Access
actions (setFriendFullApp, setFriendScreen, teachBank, forgetBank, getAdminOverview, getSmsFormats, getMyIngestKey) to the new server.
**Tests:** `backend/tests/flags.test.js` (reads, 30 s memory, outage fallbacks, emergency brake, create/keep/remove, two writers at once, failed save changes nothing, new-server mode, seeding; the race check is proven to fail without
the protection), the existing owner/route/timer/lock tests now set switches through `flagsSet_`, and the real-database `functions/tests/live_flags.js` (own test document `_system/props_qa`: change seen by another server, three servers
changing three different switches at the same instant over 4 rounds, all landed).
