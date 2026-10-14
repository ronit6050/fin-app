# Project status: what we have, what is done, what is next (plain words)

**Last updated: 2026-10-14.** Read this first in any new chat. `CLAUDE.md` is the long history; THIS file is the short, current picture.
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
| The "brain" (today) | Google Apps Script web app, code in `backend/*.js` | pinned deployment `AKfycbz3Hzmi_XNM_...` (currently **@350**) |
| The SMS reader (old way) | Separate Apps Script project | `sms-parser-backend/Code.js`, deployment `AKfycbxCwph4...` (**@20**) |
| The data | **Firestore** (Mumbai, `asia-south1`, project `fin-app-76c40`, Blaze plan) | one private folder per person: `users/<email>/...` |
| The old data | Google Sheet | still gets rows from the old SMS path + a backup; no longer what the app reads |
| Android app | WebView + native SMS reading + push | separate repo `D:\Fin-app Application` |
| New server (not live yet) | Firebase Cloud Functions running the SAME `backend` code | `functions/` (see section 5) |
| Private test data (never commit) | owner's exports, APKs | `local-data/` (git-ignored) |

Who is switched on: the owner is on the Firestore copy (since 2026-10-13 ~09:30) and his SMS land **directly** in Firestore (since ~23:15 that day).
Vaidehi has the **full app** (since 2026-10-13 10:41) on her own private data.

## 3. What has been DONE (newest first, one line each)

**2026-10-14**
- **Per-friend screen switches (built, NOT deployed).** More > Access: under each friend with the full app, a "Screens she can see" list of on/off switches (Today, Cash, History, Investments, CC Advisor, Debts/Splits, Savings, Planner, Reconcile). Off = the More button (and the matching Home card for Cash/CC/Debts) disappears on her phone next time she opens the app. Stored as `hiddenScreens` on the friend's record in the owner's folder; new owner-only action `setFriendScreen`; `getMyAccess` returns `hidden`. For clutter, not privacy. Default = nothing hidden. Next step (not built): ask a new user questions ("do you have a credit card?") that flip the same switches. Tests: `backend/tests/admin.test.js` section 4. APP_VERSION `2026-10-14-04`.
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

**Tests:** 55 test files, about 1,970 checks, all passing (`node backend/tests/<name>.test.js`, same for `sms-parser-backend/tests` and `functions/tests`).
Two special ones need `local-data/` (real messages): `smsReplay.test.js`, and the real-message part of `smsPipelineCore.test.js`.

## 4. How we work (the owner's rules)

- Explain in **plain, simple English with short examples**; say what the problem was, why it mattered, what we did.
- **Show or describe a UI change before building it.** Decide small things myself; ask only where only the owner can act.
- **Never deploy without the owner's "ship it"** (clasp deploy, git push, firebase deploy). A `clasp push` alone is ALSO live for the background timers.
- **An independent review (`change-reviewer` agent) before anything live-bound**, especially SMS and the timer. Tests are saved in the repo, not thrown away.
- Real data (owner's or friends') is **never committed**, never pasted into docs/tests; invented examples only. Do not hand-edit a friend's data: let them fix it in the app.
- Free tier only / Rs 300 cap. No third-party companies.

## 5. IN PROGRESS and BLOCKED

**The new server (Cloud Functions) cannot be deployed yet.** Google says: *"Your identity verification is in progress. Please allow a few days."* on the
billing account (so any billed upload returns HTTP 403 "check billing account"). Nothing is wrong in our code or project. Firestore and everything else work.
- **Ready to go:** `functions/` (runs the same `backend/*.js` via a small "pretend Apps Script" layer, read-only screens first), `firebase.json`, the beta switch in the app
  (Settings > Speed > "New server (beta)", off by default, falls back to Apps Script automatically), the `_system/props` copy of the on/off switches (seeded).
- **To finish once Google verifies:** from `D:\fin-app` run `firebase deploy --only functions` (Firebase CLI is installed on the owner's PC and logged in as the owner; in PowerShell add
  `$env:Path += ";$env:APPDATA\npm"`). Then check the function URL answers, turn the beta on in Settings, compare speed. See `docs/features/cloud-functions.md`.
- **What is live and what is not:** the app's beta switch IS already live (harmless while off). The function itself is NOT deployed, so turning the switch on today would only fall back to Apps Script.

## 6. NEXT (in order) and ideas not started

1. **When Google verifies billing:** deploy the function (above), measure real speed vs Apps Script.
2. **Move saving to the new server** (needs a proper lock / "only one server writes a person at a time" rule), then the SMS door, then the timers (Cloud Scheduler).
3. **Retire the Google Sheet and old SMS-reader project** (Sheet becomes a plain backup; Tasker already off). Phase 5/6 of `docs/v2-firestore-native.md`.
4. Vaidehi: install the new Android app (`local-data/apk/FinApp-2026-10-14-direct-sms.apk`), fix her two wrong rows in History, add more friends later (each needs the full-app switch + their key).
5. Money plan: the Rs 300 **hard stop** is only alerts today (budget alerts set by the owner); a real automatic cut-off function is not built.

**Ideas (not built, not promised):** treat unclear messages from promotional senders ending in `-P` as junk; a "card last 4 digits" box for manual card entries; a Split button on the
notification itself (Android allows only 3 buttons); suggest "settle" from a matching SMS; owner approval for splits friends create; delete a friend; owner's one leftover Vi promo row in his
`LearnedSpamPatterns` (decision pending: delete it?); Play Store / privacy-law homework before going public (READ_SMS policy, India's DPDP Act).

## 7. Owner's own chores (only he can do)

- Add a daily timer for `v2dbBackupOwner` (Apps Script > Triggers) so his private data is also exported as a normal Google Sheet.
- Turn on Firestore backups / point-in-time recovery in the Firebase console.
- Keep an eye on the Google billing verification email/page; tell me when it says verified.

## 8. Switches and rollbacks (run in the Apps Script editor; pick the file's function, press Run)

| Want | Run |
|---|---|
| Owner back on the Google Sheet (instant) | `v2dbDisableOwner` (turn on: `v2dbEnableOwner`; import fresh copy first: `v2dbImportOwner`, refuses when on) |
| Owner's SMS back to the old way | `v2dbDisableOwnerDirect` (turn on: `v2dbEnableOwnerDirect`) |
| Give/remove a friend's full app | the Access screen, or `v2dbEnableUser("email")` / `v2dbDisableUser("email")` |
| Re-copy the on/off switches for the new server | `exportFlagsToFunctions` |
| New server off | Settings > Speed > New server (beta) = Off |

Deploy commands: backend `cd backend; clasp push -f; clasp deploy -i <id> -d "..."`; SMS reader the same in `sms-parser-backend/`; web app `git push`; Android: `JAVA_HOME` = Android Studio's `jbr`,
`gradlew assembleDebug --offline`, install with `adb install -r` (adb: `C:\Users\ronit\AppData\Local\Android\Sdk\platform-tools\adb.exe`).

## 9. Things that bit us (so they do not again)

- **"Access denied" from the Apps Script address for everyone** = the owner must open the `/exec` address while signed in and approve (it is not a code bug; do not roll back). Memory note: `reference_apps_script_reauthorize`.
- **Timers run the newest pushed code at once**; a slow job inside the shared lock makes saves time out. Watch `V2_JOB_SLOW` in the AILogs tab.
- Moving to Firestore: measure real Apps Script time first (one sync run took 148 s and was switched off).
- When writing files from the command line, backslashes get mangled: use the Write/Edit tools for anything with `\`.
- The SMS reader is the riskiest file in the app: keep its tests, run the real-message comparison (`smsPipelineCore.test.js`, `smsReplay.test.js`) before any change.

## 10. Where to read more

`CLAUDE.md` (full history) | `docs/v2-firestore-native.md` (the Firestore plan + phases) | `docs/features/v2db.md` (the private-copy engine, owner switch-over, Access, friend SMS, library, notifications) |
`docs/features/sms-direct-landing.md` | `docs/features/sms-parsing-banks.md` | `docs/features/cloud-functions.md` | `docs/features/splits.md` | `docs/going-public-ops.md` | `docs/SHEET_SCHEMA.md` | `docs/AGENT_BACKLOG.md`.
