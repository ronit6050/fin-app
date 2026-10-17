# Project status: what we have, what is done, what is next (plain words)

**Last updated: 2026-10-15 (evening, India time).** Read this first in any new chat. `CLAUDE.md` is the long history; THIS file is the short, current picture.
If this file and `CLAUDE.md` disagree, this file is newer.

---

## 1. What the app is now (one paragraph)

A personal expense tracker (installable web app + an Android app that reads bank SMS). It started as just for the owner (Ronit,
`ronitnadar9@gmail.com`). Since 2026-10-12 it is being turned into something friends can use too, each with their **own private data**.
First friend: **Vaidehi** (signs in with her own Google account; bank: Bank of Baroda). The owner's long-term idea: maybe make it public and earn from it
(a Splitwise-like "split a bank payment with a friend in one tap"). **Cost ceiling: Rs 300 per month** until the app earns (alerts are set in
Google Cloud; the app also stops using Firestore at 90% of the free daily limit). **No outside companies** (only Google/Firebase). **Privacy first.**

## 2. Where things live (the map)

| Piece | What it is | Where |
|---|---|---|
| The app screens | One web page, hosted free on GitHub Pages | `index.html` -> https://ronit6050.github.io/fin-app/ (push to `main` = live) |
| The "brain" (two copies of the SAME code) | **New server: Firebase Cloud Functions** (`api` + scheduled `tick`, Mumbai) AND the old Google Apps Script web app, code in `backend/*.js` | function URL `https://asia-south1-fin-app-76c40.cloudfunctions.net/api`; Apps Script pinned deployment `AKfycbz3Hzmi_XNM_...` (currently **@363**) |
| The SMS reader (old way) | Separate Apps Script project | `sms-parser-backend/Code.js`, deployment `AKfycbxCwph4...` (**@20**) |
| The data | **Firestore** (Mumbai, `asia-south1`, project `fin-app-76c40`, Blaze plan) | one private folder per person: `users/<email>/...` |
| The old data | Google Sheet | still gets rows from the old SMS path + a backup; no longer what the app reads |
| Android app | WebView + native SMS reading + push | separate repo `D:\Fin-app Application` |
| New server code | runs the SAME `backend` code through a small "pretend Apps Script" layer | `functions/` (details: `docs/features/cloud-functions.md`) |
| Private test data (never commit) | owner's exports, APKs | `local-data/` (git-ignored) |

Who is switched on: the owner is on the Firestore copy (since 2026-10-13 ~09:30) and his SMS land **directly** in Firestore (since ~23:15 that day).
Vaidehi has the **full app** (since 2026-10-13 10:41) on her own private data.

## 3. What has been DONE (newest first, one line each)

**2026-10-17 (built and tested, NOT deployed)**
- **Debt notifications** (`debtNotifyFriend_` in `backend/splitNotify.js`, hooked in `PWA.js` for `addDebt`, `recordDebtPayment`, `settleDebt`): when a debt names a person who matches EXACTLY ONE of your friends (case/spaces ignored) and that friend has a phone token, they get a push like a split does ("Ronit recorded a debt with you: you owe Ronit Rs 300 ('tickets')."). No match, two matches, no token, failed action = nobody told; a push problem never changes the answer; same 10-per-10-minutes limit. Debts created automatically from a payment note ("Lent X for ...") do NOT notify yet. Test: `backend/tests/debtNotify.test.js`.
- **9pm "how much you spent today" notification** (`backend/dailySummary.js`; the new server's evening daily job moved from 20:00 to 21:00 and now runs this; app `2026-10-17-01` adds Settings > Notifications to switch it off). Every full-app person (the owner and each friend switched on) gets their OWN summary on their OWN phone, from their OWN data: total spent today (same rules as the Today screen: own share of splits, cash included; CC bill payments, wallet top-ups, loans, Rent/EMI/SIP left out), the biggest category, a comparison with the usual day this month (from the 4th), and how many payments still need a note. A day with no spending sends "No spending today". It replaces the owner-only 8pm cash check-in while the new server is ticking; the old Apps Script 8pm check-in is still the fallback when it is not. Test: `backend/tests/dailySummary.test.js`.

**2026-10-16 (built and tested, NOT deployed, waiting for the owner's "ship it")**
- **Admin panel, phase 1: the quiet recording and the honest "how well does the app understand transactions" score** (`backend/adminStats.js`, `backend/adminScores.js`, hooks in the SMS doors / note save / auto-settle / Reconcile, a small reporter in `index.html`, owner-only actions `getAdminDashboard` and `resolveAdminProblem`, anyone's `adminLog`). Counts only, never amounts, notes, payees or message text. The score has three separate parts (Reading per bank, Guessing, Done for you), shows "collecting" or "unverified" instead of a number when evidence is thin, never trusts messages nobody checked, and lists its blind spots. No blended "overall" number. Phase 2 (the web page at `/admin/`, mockup approved) is not built. Doc: `docs/features/admin-panel.md`; test: `backend/tests/adminStats.test.js`. When shipping: bump `APP_VERSION`, deploy backend + new server, then `git push`; the Android SMS-permission signal needs a small native-app change (not done).

**2026-10-15 (the big move to the new server)**
- **"Not a transaction" can be undone (2026-10-15, app `2026-10-15-04`, backend @363, new server updated).** A friend removed a REAL payment by mistake and there was no way back. Now: an **Undo** button on the confirmation, a **Removed items** list at the bottom of Pending (last 60 days) with **Put back**, a stronger warning when the card looks like a real payment, and the junk filter only learns from "NEEDS REVIEW" messages (never from a readable payment). Restoring never doubles a row and forgets the learned pattern. Docs: `docs/features/spam-learning.md`, tests in `backend/tests/markNotATransaction.test.js`.
- **A monthly SIP SMS was being dropped as a "copy" (2026-10-15, SMS reader @21, backend @362, new server).** A message that repeats word for word every month (e.g. the NSE e-mandate debit) was thrown away because last month's identical text existed. Identical text is now a duplicate only when the earlier row is from the SAME India day (retries and resyncs carry the original time, so they are still caught). Fixed in all three places that had the rule (SMS reader, friends' SMS door, Sheet-to-private-copy inbox). The missed Rs 2,000 SIP of 15 Oct was re-sent from the phone (debug hook) and saved. Docs: `docs/features/sms-junk-and-echo-filter.md` is unchanged; the rule lives in `sms-parser-backend/Code.js` (`sameMessageDay`), test `sms-parser-backend/tests/recurringSameText2026-10-15.test.js`.
- **The on/off switches live in the database now** (`backend/flags.js`, document `_system/props`): both servers read AND change them; a failed change changes nothing; emergency brake `v2dbFlagsLegacyOn` (Apps Script reads only its own old settings); Apps Script's old settings are refreshed after every successful read so the fallback stays current. Friend add/remove works from the freshest list (two servers cannot lose one). Docs: `docs/features/cloud-functions.md` Step 7.
- **ONE shared Firestore usage counter** (`_system/usage_<yyyymmdd>`): every server adds to it, so the daily safety limit (45,000 reads / 18,000 writes) and the Access screen's "today's use" now cover the new server too (before, the new server's use was not counted). The meter can never block real work (unreadable totals count as zero). Known: Apps Script runs that never call a flush are still not counted (same as before). Step 8.
- **The Access screen runs on the new server** (`getAdminOverview`, `getSmsFormats`, `setFriendFullApp`, `setFriendScreen`, `teachBank`, `forgetBank`, `getMyIngestKey`; app `2026-10-15-03`).
- **Reconcile confirmed on a REAL bank statement** by the owner (statement read on the phone, two missing transactions added, no errors).
- **The new server is LIVE for the owner** (Settings > Speed > New server = "Reads and saves" on his phone; app `2026-10-15-02`). Screens answer in about 0.2-1 s instead of 3-10 s. Everything below is in `docs/features/cloud-functions.md` (Steps 1-6) with tests, rollbacks and limits.
- **Saving** goes through the new server with one shared "only one server saves at a time" lock (`backend/sharedLock.js`, a Firestore lease). A save with no answer is never repeated by the app (it could double-save). Switch: `V2_FN_WRITES`.
- **Bank SMS** door: the phone tries the new server first, then Apps Script `smsIn`, then the old reader; only `{"ok":true}` stops the chain, duplicates are caught by the existing rules. Switch: `V2_FN_SMS`. New Android app: `local-data/apk/FinApp-2026-10-14-new-server-sms.apk` (installed on the owner's phone; the owner shares it with Vaidehi).
- **The 5-minute alert timer** runs on the new server (Cloud Scheduler job `tick`, free tier). A quiet tick reads ONE tiny document; real work only when something changed or every 30 min. Apps Script steps aside only while the new server's heartbeat is fresh (under 12 min), otherwise it takes the job back by itself. Switch: `V2_FN_TIMER`. **Switched ON by the owner 2026-10-15 ~09:10 India time; first tick verified (heartbeat written, no errors). Still to see: a real SMS alerted exactly once by the new timer.**
- **The four daily jobs** (Rent/EMI reminder 8:30, debt due dates 9:00, app health 9:30, evening cash check-in 20:00, India time) run from the same tick, once a day each, with catch-up after downtime. The Apps Script versions step aside while the new server is alive.
- **Reconcile** (statement upload): spreadsheet statements (.xls/.xlsx) are read ON THE PHONE (SheetJS, lazy-loaded) and the rows are sent, so Google Drive is no longer needed; card PDFs already worked that way. Also fixed a real name clash (`extractCardLast4` defined twice): the card-statement "fix payment mode" suggestion is now exactly "card 8132". **Not yet tried with a real bank file (none was available): first real upload should be eyeballed.**
- **Settings > Speed > "Send a test notification (new server)"**: proves push works from the new server (it does; the owner confirmed).
- **Backups:** Firestore point-in-time recovery (7 days) switched on 2026-10-15 (well under Re 1/month at this size).
- Independent reviews (`change-reviewer`) of every step: all "safe to ship"; their findings (dead-man protection, guarded switch-on, failure back-off, Home copy freshness, name clash, ...) were fixed before deploying.
- Tests: 63 files, all pass. Real-database proof scripts (never in the automatic suite; need the robot key): `functions/tests/live_scratch.js` (saves, two servers at once, SMS door, timer, daily jobs) and `functions/tests/live_sweep.js` (every save action + Reconcile). They use a made-up person and clean up after themselves.

**2026-10-14**
- **"Lent to ..." saved four debts, and Debts showed none (FIXED, LIVE: backend `@353`, app `2026-10-14-07`).** One Rs 94 payment noted "Lent vaidehi for idli" made FOUR identical debts: no error in the logs, but (1) the Debts screen loads once per session and never refreshed after a note save, so the owner tapped Save again, and (2) every Save re-created the debt. Now the payment remembers it already created its debt (Transactions **column W "DebtLinked"**, set only when the link really happened; also stops a "paid back" note applying twice) and the Debts list refreshes right after a Pending/History save. The 3 extra rows were removed from the owner's private data with a backed-up, read-back-verified one-off (backup in `local-data/backups/debt-cleanup-*`, audit line in `local-data/audit/changes.jsonl`), and the kept payment was marked linked. Test: `backend/tests/debtLinkOnce.test.js`; independent review: safe. Doc: `docs/features/financial-events.md`.
- **History: search, filters and short rows (LIVE: backend `@352`, app `2026-10-14-06`, commit `78a7905`).** History was one tall edit card per payment with no search. Now: a search box (note, payee, category, event name, amount), filter chips (All, Needs attention, Rent, EMI, Investment, Credits, Split, each with a count), a month picker, month headings, and one short row per payment with a tag (green = confirmed, e.g. "Laptop EMI"; yellow = "Looks like EMI, confirm?"). Tap a row to open the same edit card as before. The Rent / EMI / Investment chips show confirmed payments grouped by name with payments, total and last paid. **Needs attention** lists payments that look like Rent/EMI/Investment but are not confirmed, including ones still in Pending with no note ("Not noted yet": tapping goes to Pending). **"No, regular spend" is now remembered**: Transactions **column V "EventDeclined"** (`YES`, header added automatically; cleared if an event is confirmed later), so a declined payment stops being suggested and counted. Backend: `getTransactionHistory(offset, limit, {filter, query, month})` (filter runs before paging; old calls unchanged), `saveNote` takes `eventDeclined`. Demo Mode mirrors it. Tests: `backend/tests/historyFilters.test.js` (65 checks); two independent reviews: safe. Not yet seen by the owner on real data. Known limits: History has no "Mark as..." link to reopen a declined suggestion; a declined row stays in the open list until it reloads; first open on the real 1,000+ row sheet was not timed (look here if History feels slow). Doc: `docs/features/history.md`.
- **Per-friend screen switches (LIVE: backend `@351`, pushed).** More > Access: under each friend with the full app, a "Screens she can see" list of on/off switches (Today, Cash, History, Investments, CC Advisor, Debts/Splits, Savings, Planner, Reconcile). Off = the More button (and the matching Home card for Cash/CC/Debts) disappears on her phone next time she opens the app. Stored as `hiddenScreens` on the friend's record in the owner's folder; new owner-only action `setFriendScreen`; `getMyAccess` returns `hidden`. For clutter, not privacy. Default = nothing hidden. Next step (not built): ask a new user questions ("do you have a credit card?") that flip the same switches. Tests: `backend/tests/admin.test.js` section 4.
- **SMS reading for many banks.** Fixed: the app took the account BALANCE as the amount (Vaidehi's Rs 1 credit became Rs 2,974.93 and showed as "income");
  "Dr."/"Cr." wording was not understood (her debit had no direction, so "total spent" stayed 0). Now: balances are never the amount, Dr./Cr. work, more
  reference wordings, one central bank list (added Bank of Baroda, PNB, Canara, Union, IDBI, IndusInd, IDFC, Bandhan, RBL, UCO, Bank of India, KVB),
  **teach a new bank from More > Access** (no code), and a "spent or received?" box on cards the app cannot fully read. Proven on 2,185 real messages. `docs/features/sms-parsing-banks.md`.
- **New server (Cloud Functions) step 1 built and tested, NOT deployed** (blocked by Google, see section 5). `docs/features/cloud-functions.md`.
- **Bank SMS now land directly in Firestore** (no Sheet in the middle) for the owner and friends; the phone falls back to the old way if anything fails.
  First real test passed. Replay of 2,685 real SMS events: old and new path saved the identical 824 transactions. `docs/features/sms-direct-landing.md`.
- **Lock jam fixed**: the owner's timer held a shared lock 70+ s (rebuilding the Home screen inside it). Now only the real work holds it (about 15 s with new rows).
- Notifications: the other person is told when you split, record a payment, or undo (`splitNotify.js`).

**2026-10-13**
- Owner moved onto Firestore (import checked cell by cell, instant switch back kept). Per-person routing, per-person settings, backup export written.
- **Access panel** (More > Access, owner only): who has access, give/remove a friend's full app, today's Firestore use. Friend "full app" mode.
- **Friends' own SMS**: a private key per friend; their messages land only in their own space.
- **Add a transaction by hand** (Pending > + Add a transaction) for payments no SMS covers (Bank of Baroda sends none right now).
- **Shared anonymous bank-SMS pattern library** (names, numbers, links all removed) so a new bank can be learned from real examples. `tools/sms_formats_report.py`.
- **History > Split with a friend** (split a payment AFTER noting it, e.g. from the notification).
- Review fixes everywhere: wrong-key throttle, daily caps, formula-safe text, junk list per person, etc.

**2026-10-12 and earlier**
- **Splits** (running balance per friend, one number per person), friend sign-in (splits only), "my spend counts only my share", move old Debts into a friend's balance.
- Everything in the original roadmap (Telegram replacement, dashboard, CC advisor, debts, savings, investments, push, planner, dark mode, demo mode, SMS spam learning,
  auto-settle, health checks...) is **done**. `CLAUDE.md` has the details.

**Tests:** 56 test files, about 2,035 checks, all passing (`node backend/tests/<name>.test.js`, same for `sms-parser-backend/tests` and `functions/tests`).
Two special ones need `local-data/` (real messages): `smsReplay.test.js`, and the real-message part of `smsPipelineCore.test.js`.

## 4. How we work (the owner's rules)

- Explain in **plain, simple English with short examples**; say what the problem was, why it mattered, what we did.
- **Show or describe a UI change before building it.** Decide small things myself; ask only where only the owner can act.
- **Never deploy without the owner's "ship it"** (clasp deploy, git push, firebase deploy). A `clasp push` alone is ALSO live for the background timers.
- **An independent review (`change-reviewer` agent) before anything live-bound**, especially SMS and the timer. Tests are saved in the repo, not thrown away.
- Real data (owner's or friends') is **never committed**, never pasted into docs/tests; invented examples only. Do not hand-edit a friend's data: let them fix it in the app.
- Free tier only / Rs 300 cap. No third-party companies.

## 5. IN PROGRESS

**Nothing is blocked.** The billing problem is solved and the new server is deployed. What is running right now on the new server: reads, saves, bank SMS (door 0), the 5-minute alert timer, the four daily jobs, Reconcile.
**Still on Apps Script on purpose (and why):**
- The **inbox copy** (rows the OLD SMS doors wrote into the Google Sheet are copied into the private copy by the Apps Script timer, because the new server has no Google Sheet). Goes away when the old doors are switched off.
- The **old SMS reader** project and the **Google Sheet** (kept as fallback / archive).
- A **raw statement file** (a scanned PDF that needs OCR, or a phone that cannot read the spreadsheet) still falls back to Apps Script's Google Drive path.
- `v2dbBackupOwner` (exports the private data to a normal Google Sheet): replaced in practice by Firestore backups; can be retired.
- The switches, the usage counter and the Access screen are NO LONGER tied to Apps Script (done 2026-10-15).

## 6. NEXT (in order) and ideas not started

1. **See a real transaction alerted by the new timer** (owner: tell me when a real bank SMS notification arrives; I check the logs: exactly once, from the new server).
2. **Vaidehi** installs the new app (`FinApp-2026-10-14-new-server-sms.apk`); check her messages arrive through the new server.
3. **After 3 clean days (about 2026-10-18; owner approved)**: check the logs (errors, doubled or missing alerts, SMS all saved), then switch off the old SMS reader and stop the Sheet copy (the Sheet stays a read-only archive), then remove the old fallback code after a final review, then turn Apps Script off. Before that: delete the four Apps Script daily triggers (they are harmless no-ops while the new server is alive).
4. **Retire the last Apps Script pieces:** the inbox copy (needs the old doors off), the Drive fallback for a raw statement file, `v2dbBackupOwner`, and the editor-run functions (a small "switches" screen could replace them).
5. Cost: the Rs 300 limit stays **alerts only** (owner's decision). Watch Cloud Billing and the Access screen's usage for the first days (expect a few hundred extra writes a day from the counter and the tick).

**Agreed order after the cutover (owner, 2026-10-16):** (1) a proper **admin web panel** (usage, errors, last-seen per user; design is proposed and approved BEFORE building), (2) the **UI/UX pass including first-run onboarding** (welcome cards, bank choice, SMS-permission explainer, setup questions that flip the screen switches; a mockup was shown, build it with the UI/UX pass), (3) turn the PWA into a **complete real app**.

**Ideas (not built, not promised):** **shared app knowledge** across banks and users (see `docs/AGENT_BACKLOG.md`, needs discussion); a "Mark as..." link in History to reopen a declined Rent/EMI suggestion; treat unclear messages from promotional senders ending in `-P` as junk; a "card last 4 digits" box for manual card entries; a Split button on the
notification itself (Android allows only 3 buttons); suggest "settle" from a matching SMS; owner approval for splits friends create; delete a friend; Play Store / privacy-law homework before going public (READ_SMS policy, India's DPDP Act); warn when a statement has more than 5,000 rows (the phone reader stops there).

## 7. Owner's own chores (only he can do)

- Share the new app (`local-data/apk/FinApp-2026-10-14-new-server-sms.apk`) with Vaidehi and have her open it once.
- In the Apps Script editor > Triggers: after a day of the new timer, delete the four daily triggers (`sendDailyCashCheckin`, `checkDebtDueDates`, `checkUpcomingObligations`, `checkAppHealth`). Keep `processNewTransactions` (it only copies old-door rows now).
- Vaidehi: update the app, then Pending > bottom > "Removed items" > "Put back" on her Rs 160 payment (15 Oct, to q720611479@ybl). Also tap "Not a transaction" on the junk entry I created while re-sending the SIP SMS (counterparty "NEEDS REVIEW", no amount) in your Pending.
- If the old Tasker weekly resync is still running: check its HTTP Request sends a `timestamp` (SMS date divided by 1000). Without it an old repeating SMS with no reference could be saved a second time.
- Tell me when a real SMS notification arrives (to verify exactly-once), and after the first real Reconcile upload.

## 8. Switches and rollbacks (run in the Apps Script editor; pick the file's function, press Run; all instant)

| Want | Run |
|---|---|
| New server alert timer OFF (Apps Script alerts again) | `v2dbDisableFunctionTimer` (on: `v2dbEnableFunctionTimer`, needs saving on) |
| New server takes bank SMS OFF (phone uses Apps Script / old reader) | `v2dbDisableFunctionSms` (on: `v2dbEnableFunctionSms`) |
| New server saving OFF (saves fall back to Apps Script) | `v2dbDisableFunctionWrites` (on: `v2dbEnableFunctionWrites`) |
| One phone back to Apps Script only | Settings > Speed > New server = Off (or "Reads only") |
| Owner back on the Google Sheet (instant) | `v2dbDisableOwner` (turn on: `v2dbEnableOwner`; import fresh copy first: `v2dbImportOwner`, refuses when on) |
| Owner's SMS back to the old way | `v2dbDisableOwnerDirect` (turn on: `v2dbEnableOwnerDirect`) |
| Give/remove a friend's full app | the Access screen, or `v2dbEnableUser("email")` / `v2dbDisableUser("email")` |
| Re-copy the on/off switches to the new server | `exportFlagsToFunctions` |

The "disable" functions throw a plain message if the new server could not be told (so a rollback never silently half-works). Deploy commands: new server `cd D:\fin-app` then in PowerShell
`$env:Path += ";$env:APPDATA\npm"; $env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"; firebase deploy --only functions`; backend `cd backend; clasp push -f; clasp deploy -i <id> -d "..."`; SMS reader the same in `sms-parser-backend/`; web app `git push`;
Android: `JAVA_HOME` = Android Studio's `jbr`, `gradlew assembleDebug --offline`, install with `adb install -r` (adb: `C:\Users\ronit\AppData\Local\Android\Sdk\platform-tools\adb.exe`). Logs of the new server: Firebase console > Functions > Logs, or the Cloud Logging API.

## 9. Things that bit us (so they do not again)

- **"Access denied" from the Apps Script address for everyone** = the owner must open the `/exec` address while signed in and approve (it is not a code bug; do not roll back). Memory note: `reference_apps_script_reauthorize`.
- **Timers run the newest pushed code at once**; a slow job inside the shared lock makes saves time out. Watch `V2_JOB_SLOW` in the AILogs tab.
- Moving to Firestore: measure real Apps Script time first (one sync run took 148 s and was switched off).
- When writing files from the command line, backslashes get mangled: use the Write/Edit tools for anything with `\`.
- **Real-database test scripts must never touch real documents**: `live_scratch.js` once wrote the REAL `_system/timer` heartbeat (a fake "the new server is alive"). They now use their own test paths (`_system/timer_qa`, `_system/lock_qa`) and a made-up person.
- Scripts written into files with Python heredocs lose backslashes/newlines in this environment: use the editor tools for edits that contain `\n`.
- The SMS reader is the riskiest file in the app: keep its tests, run the real-message comparison (`smsPipelineCore.test.js`, `smsReplay.test.js`) before any change.

## 10. Where to read more

`CLAUDE.md` (full history) | `docs/v2-firestore-native.md` (the Firestore plan + phases) | `docs/features/v2db.md` (the private-copy engine, owner switch-over, Access, friend SMS, library, notifications) |
`docs/features/sms-direct-landing.md` | `docs/features/sms-parsing-banks.md` | `docs/features/cloud-functions.md` | `docs/features/splits.md` | `docs/going-public-ops.md` | `docs/SHEET_SCHEMA.md` | `docs/AGENT_BACKLOG.md`.
