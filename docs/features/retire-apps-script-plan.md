# Retiring Apps Script (plan, written 2026-10-22, nothing deployed)

## Why now
2026-10-22: the Apps Script alert/copy timer (`processNewTransactions`) had failed silently since 18 Oct and a Rs 40 payment never alerted. Re-approving
the project failed: Google says "The OAuth client was deleted" (Error 401 deleted_client), so Apps Script can no longer be authorised. Root cause on the
phone: Samsung was blocking the app's internet in the background, so the app's direct send to the new server failed and it fell back to the old route
(old SMS reader -> Google Sheet -> the broken copy timer). Fixed by setting the app's battery to Unrestricted; a real SMS then went straight to the
new server ("direct (new server) ... SAVED").

## Steps (each one separate, each needs the owner's "ship it")
1. **Android app (done in the working copy, NOT built into an APK, not committed):** `SmsForwardWorker.kt` now sends only to the new server and retries
   (30 s, doubling, up to 40 tries) instead of falling back to Apps Script / the old SMS reader. The Kotlin compiles. Owner installs the new APK; Vaidehi too.
2. **Android app, second part (DONE in the working copy 2026-10-22, not built/committed):** `BackendClient.kt` now asks only the new server (no fallback). Compiles.
3. **Web app (DONE in the working copy 2026-10-22, NOT pushed):** `index.html` sends every read and save to the new server only (a failed save shows 'nothing was saved' and is never repeated; a failed read shows an error/Retry); `APPS_SCRIPT_URL`, `callAppsScriptDirect` and the Settings 'New server' picker are gone; `sw.js` (notification Confirm button) and `admin/index.html` use the new server; APP_VERSION `2026-10-22-01`. Tests updated: `newServerClient.test.js`, `fastViewsClient.test.js` pass (the three `*Frontend` tests fail only on an old hard-coded APP_VERSION check, as they already did before this change). Deploy order: nothing on the backend changes, so just `git push` (web) and a new APK.
4. **Switch off the old SMS reader** (`sms-parser-backend`, separate Apps Script project): stop it receiving; its Tasker-era pinned deployment can be archived.
   Owner confirmed there is no Tasker on his phone (2026-10-22 check), so nothing else posts there.
5. **Remove the Sheet-copy timer** (`processNewTransactions` trigger, plus the four daily Apps Script triggers) and the inbox-copy code (`v2owner.js`
   `v2InboxSync_` etc.).
6. **Remove the old fallback code** in `backend/` after an independent `change-reviewer` pass; keep the Google Sheet as a read-only archive.
7. **Raw statement files** (scanned PDF OCR / phone cannot read the spreadsheet) still use Apps Script's Drive path: needs a new-server replacement
   (or accept "upload a normal bank statement" only) before Apps Script is fully off.

## Risks and how each is covered
- The new server becomes the only path: a long outage means SMS wait on the phone (retries for well over a day), they are not lost.
- A phone with no saved key now retries instead of using the old route: the app saves the key when the owner/friend signs in; open the app once after updating.
- Battery/background limits must stay Unrestricted on every phone that reads SMS (add this to the onboarding text).
- Rollback for step 1: reinstall the previous APK (`local-data/apk/`).
