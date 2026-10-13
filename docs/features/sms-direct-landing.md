# Bank SMS landing directly in Firebase (built 2026-10-14)

**Before:** phone -> separate SMS-reader project -> writes the **Google Sheet** -> a timer copies new Sheet rows into the person's private
Firestore copy (v2owner.js inbox) -> the timer alerts it. The Sheet was in the middle of every message.

**Now (opt-in):** phone -> main backend action `smsIn` -> the SMS reader's own decisions run on the person's **private copy** -> saved there.
No Sheet in the path. Works for the owner (needs his switch) and for any full-app friend (their key, their space).

## How it fits together
- `backend/smsPipelineCore.js` is a **generated, word-for-word copy** of the SMS reader's decision code (`sms-parser-backend/Code.js`
  between the `SMS-PIPELINE-CORE` markers), made by `python tools/build_sms_pipeline.py`. One source of truth; a test fails if the copy is
  stale. It reads past rows (for duplicate checks) from the person's private Transactions tab.
- `backend/smsIn.js` (`smsInHandle_`): key -> person (ingest.js) -> classify -> learned-junk check (the person's OWN `LearnedSpamPatterns`
  tab, UNCERTAIN messages only) -> parse -> duplicate rules (same reference, same text, statement placeholder, double card text) -> save.
  Owner: row left un-alerted so the usual timer sends the usual rich notification. Friend: already alerted + plain push.
  Limits: 400 saved messages a day per person; formulas neutralised; lock + one retry on a clash; fails with "Try again" and saves nothing.
- Keys: `ingest.js`. The owner's key starts with `own` and is handed out ONLY while the owner's switch is on.
- **Owner's switch:** `v2dbEnableOwnerDirect()` / `v2dbDisableOwnerDirect()` (Script Property `V2DB_OWNER_DIRECT`, run by hand in the
  Apps Script editor; the owner must already be on the private copy). Off = the owner's phone uses the old way, instantly.
- **Phone (Android `SmsForwardWorker`):** with a key, try `smsIn` first; ONLY `{"ok":true}` counts as done; ANY other result (network,
  HTTP error, "Use the old path", "Unknown key", "Try again") runs the OLD path exactly as before (the owner's `own` key is never sent
  to the old reader). So no message can be lost.
- **If both paths ever run for one message** (direct saved but the reply was lost, then the old path wrote the Sheet): the inbox copy step
  (`v2InboxSync_`) stamps that Sheet row handled but does NOT copy it again when its real reference or identical text is already in the
  private copy.
- The owner's "not a transaction" button now also teaches his private `LearnedSpamPatterns` tab (and still the Sheet's, for the old reader).

## Proof before shipping
- `backend/tests/smsPipelineCore.test.js`: the copy is current; old reader and copy give IDENTICAL answers on **2,197 messages (2,185 real)**
  and on the duplicate rules.
- `backend/tests/smsReplay.test.js` (needs `local-data/sms_replay.json`, never committed): **2,685 real SMS events replayed in order** through the
  old reader and through `smsIn`: both saved **824** transactions, the same ones in the same order; 249 duplicates caught identically.
- `backend/tests/smsIn.test.js` (36 checks): switch/keys, save + timer alert, duplicates vs two real same-amount purchases, junk/uncertain/learned,
  failures and fallbacks, Sheet+direct double arrival, friend isolation, formulas and the daily cap.

## Turning it on (owner), in this order
1. Deploy the main backend (`clasp deploy`), push the web app, install the new Android app on the phone.
2. Open the app once on that phone (it fetches nothing yet: the switch is off).
3. In the Apps Script editor run `v2dbEnableOwnerDirect`. Open the app again (it now fetches and stores the key).
4. Send a real SMS. Check: Pending shows it within about a minute; the Sheet did NOT get a new row.
5. Roll back any time: run `v2dbDisableOwnerDirect` (the phone drops the key on the next app open; until then a refused message falls back).

## Not done / limits
- The old SMS-reader project stays deployed as the fallback and for Tasker. The Sheet is no longer needed for new owner messages, but is not retired yet.
- The owner's alert still comes from the timer (about a minute), as before; an immediate alert would need the processing run inline.
- Sender names / a new bank (e.g. Bank of Baroda) are learned the same way as before (see the shared pattern library, docs/features/v2db.md).

## Fixes after the independent review (2026-10-14)
Wrong keys on `smsIn` are throttled like `ingestSms` (30 a minute, refused without reading the database); the server waits 20 s for the lock and the phone 30 s (so a slow save cannot outlive the phone and cause an extra row); `v2dbEnableOwnerDirect` first copies any junk patterns taught since the import from the Sheet's tab into his private tab; a friend's "not a transaction" now teaches HER OWN private junk tab (never the owner's Sheet).

## First real test, 2026-10-13 23:16: the direct path fell back safely and exposed a lock jam
The phone tried `smsIn`, it failed with "Lock timeout: another process was holding the lock for too long", and the phone used the old way (the Sheet got the row: nothing lost). `registerPushToken` timed out the same way. Cause: the owner's timer (`processNewTransactions`) ran EVERYTHING inside the shared script lock, including rebuilding the Home screen copy (`publishViews...`, a heavy calculation plus a write), so the lock was held for 70+ seconds. Fix: only the real work runs under the lock now; the Home copy is rebuilt AFTER it is released, without the lock (`v2OwnerReadOnly_`, reads only). `V2DB_LAST_TIMING_` records where a run's time goes (reading, work, writing) and a job that holds the lock for more than 8 s writes `V2_JOB_SLOW` to AILogs with that breakdown. Tests: `backend/tests/v2owner.test.js` section 11.
