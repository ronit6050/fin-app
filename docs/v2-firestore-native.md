# v2: Firestore as the only database, one private folder per person (plan, 2026-10-12)

**Status: Phase 1 (shadow copy) DONE and verified 2026-10-12. Phases 2 to 5 not started; each needs the owner's go-ahead.**
Decided by the owner on 2026-10-12: before Vaidehi (or anyone) records transactions, ALL data, including the owner's
own, must live in Firestore as the real record, each person's data fully separate from everyone else's. Billing: Blaze is
on; the owner has set the Google Cloud budget alerts at Rs 300 (alerts only email; the code-level daily limit in
`backend/firestore.js` is the part that actually stops usage, and will need re-tuning for this design, see Read budget).

## Why this is a big change (and why it is safe if done in this order)
Today the whole "brain" (about 214 places in `backend/*.js`) reads and writes the Google Sheet directly, and it reads WHOLE tabs
all the time (the Pending screen alone reads about 1,650 rows; a timer runs every few minutes). The Sheet is the system of record
for the owner. Firestore currently holds: splits/friends (new), and a read-only copy of the Home screen.
Moving the record to Firestore means rewriting every read and write, and redesigning reads so they fetch only what a screen
needs (otherwise reads, which cost money past the free allowance, explode). The owner's real data is small
(986 transactions, about 800 rows in all the other tabs), so the DATA move is easy; the CODE move is the work.

## Target data model (all under the person's own email; nothing shared between people)
```
users/{email}/profile                      one doc: settings (CC limit etc.), createdAt, ingest key HASH
users/{email}/transactions/{txId}          one bank/UPI/card transaction (txId = fingerprint, so a duplicate SMS overwrites itself)
users/{email}/transactionsIgnored/{id}     junk SMS removed by the user (kept, never deleted)
users/{email}/cash/{id}, debts/{id}, debtPayments/{id}, savings/{id}, goals/{id}, investments/{id},
        instruments/{id}, financialEvents/{id}, budgets/{month_category}
users/{email}/memory/*                     smartMemory (merchant -> category), typeVotes, noteMemory (their own learning)
users/{email}/summaries/{yyyy-MM}          running totals per month (by category / type / mode), updated in the SAME all-or-nothing
                                           write as the transaction, so Analysis reads 1 document, not 150
users/{email}/friends/...                  splits (already built)
users/{email}/views/*                      precomputed screens for instant loading (already partly built)
```
Money is stored as whole paise. Dates as real timestamps. Every write is a batch (all-or-nothing).

## Privacy and security
- Rules (extend `firestore.rules`): a phone may read only `users/<its own verified email>/...`; it can never write. Only the backend
  writes (service account). Verified in tests with two fake users.
- SMS ingestion per person: each person gets a random ingest key (stored only as a hash). Their phone sends SMS with that key; the
  backend writes ONLY into that person's folder. One person's key can never write to another's.
- Honest limit: the backend runs on the owner's Google account, so the owner (and any admin of the project) can technically read
  everyone's data. This must be disclosed to users (privacy policy, deletion on request, India's DPDP Act) before a public launch.
- Backups: turn on Firestore scheduled backups / point-in-time recovery now that Blaze is active (console setting, owner does it once).
  Plus a full export before every migration step (the `tools/` scripts already back up the Sheet to `local-data/`).

## Read budget (why the design matters)
Free: 50,000 reads / 20,000 writes a day. Past that Blaze charges per read (a few US cents per 100,000; check current pricing).
Designed screens: Pending = a query for unprocessed rows (about 5 to 20 reads); Today = that day's rows; Analysis = 1 summary doc;
History = 20 rows a page; CC Advisor = the current billing cycle's card rows. Writes per SMS: 1 transaction + 1 summary + learning
docs, about 3 to 5. The daily safety limit is raised only after the real numbers are measured.

## Phases (each ends with a check you can see, and can be rolled back)
1. **Shadow copy (read-only, zero risk to the live app).** A migration tool copies every Sheet tab into the new Firestore layout,
   idempotently, then prints a reconciliation report: row counts and rupee totals per month, per category, per tab must match the
   Sheet to the paisa. Runs again any time. Nothing live reads it yet.
2. **Keep it in step.** The live writers (SMS parser, Pending saves, Cash, Debts...) also write to Firestore; a daily compare job
   reports any difference. Still no behaviour change.
3. **New engine, screen by screen.** A data layer (`db.js`) reads Firestore with the queries above. Each screen's numbers are
   computed BOTH ways for a while and compared; a Settings switch flips a screen to the new engine with instant rollback.
4. **SMS straight into Firestore.** The SMS parser (separate Apps Script project) writes to the person's folder via their ingest key.
   Vaidehi's SMS goes only into her folder from day one. The owner's Tasker flow moves over once proven.
5. **Retire the Sheet** to a read-only archive. Remove dead code.
Order for people: build the engine once, move the OWNER's data onto it first (real data is the best test), then onboard Vaidehi's
transactions on the same engine. Until then she keeps the splits screens.

## Phase 6 (added 2026-10-12 at the owner's request): move the code from Apps Script to Firebase Cloud Functions
Why: Cloud Functions need the Blaze plan (active). Not started. It comes AFTER phases 2 to 4, because most of today's slowness is
re-reading whole Sheet tabs; moving code that still reads the Sheet would gain little. Needs the owner to install/sign in the
Firebase CLI once (`npm i -g firebase-tools`, `firebase login`; Node is already installed); I cannot sign in for them. Expect a 1 to 3
second wake-up on the first call after idle, then fast. Keep Apps Script only for what must stay there (the Tasker/SMS endpoint until
the native app replaces it). Re-check the Rs 300 ceiling and budget alerts before turning anything on, since functions bill by use.

## What stays as it is
Splits, friend mode, the Home fast-copy, push notifications and the SMS parser keep working throughout. No phase changes what the
owner sees until its screen is flipped on purpose.

## Phase 1 result (2026-10-12)
- Tool: `tools/v2_migrate.py` (dry run by default; `--apply` writes; `--verify` re-checks). Unit tests: `python tools/test_v2_migrate.py`.
  It prints counts and totals only, writes ONLY the 14 collections listed in `COLLECTIONS`, and is safe to re-run (fixed document ids).
- Copied into `users/ronitnadar9@gmail.com/`: transactions 994 (of 1,003 sheet rows; the 9 skipped are empty IGNORED placeholders),
  transactionsIgnored 23, cash 11, debts 13, savings 5, goals 5, investments 22, instruments 15, financialEvents 16, budgets 37,
  smartMemory 187, noteMemory 277, typeVotes 210, learnedSpamPatterns 21. NOT copied: AILogs, Logs (operational logs), Credit_Card (empty).
- Verified against the Sheet: every document identical to what the Sheet implies (0 missing / 0 extra / 0 different), and totals worked out a
  second, independent way agree to the paisa: money out Rs 610,970.41; money in Rs 530,992.74; every month (8); every category (21); cash total.
- Transaction ids = first 24 characters of SHA-1 of `date|time|type|bank|reference|counterparty|amountPaise` (a second identical-looking row gets
  `-2`, `-3`). Editing a note/category does not change the id. The live writers must compute the SAME id when they start writing here (phase 2).
- Settings kept in Script Properties (CC limit, savings goals ...) are NOT in the Sheet and are not copied yet (goes to `profile` in phase 2/3).
- Privacy verified live with `tools/rules_privacy_test.py` (signs in two made-up identities against the real published rules): the owner reads only
  their own folders; a friend, a stranger, nobody-signed-in and an unverified email are all refused (HTTP 403) on every collection;
  nobody can write from a phone; the friend reads only their own (empty) folder; a friend cannot list all users.
  Unsigned requests are also refused (HTTP 403) by direct REST.

## Phase 2 (keep Firestore in step) built 2026-10-12: `backend/v2Sync.js`
- Runs at the END of the existing background timer (`transactions.js`), at most every 10 minutes (backs off to 30 minutes by itself if a run
  ever takes over a minute, to protect the daily trigger-runtime allowance). One run at a time (script lock). Switch: `V2SYNC_ENABLED_`.
- Builds the same documents as `tools/v2_migrate.py` (proved identical on 1,836 real documents by `backend/tests/v2Sync.test.js`), remembers a
  fingerprint per document in the hidden `_V2Sync` tab, writes only changed documents, deletes documents whose row vanished (never more than 25
  at once; a sudden 50% drop in rows abandons the run).
- FIRST RUN adopts what Firestore already has (the verified Python copy) instead of rewriting; if the ids disagree wholesale it writes and deletes
  NOTHING and logs why (so a time-zone/time-cell misreading can never create duplicates).
- Daily: `checkAppHealth` calls `v2VerifyShadowIfDue_` (compares every document, logs `V2SYNC_MISMATCH`, repairs). `V2SYNC_ERROR` and `V2SYNC_MISMATCH`
  are watched by the health check. Manual: `v2SyncNow()` in the editor; independent check: `python tools/v2_migrate.py --verify`.
- Independent review (2026-10-12) found it safe once the first run was made non-destructive; its other findings (lock leak, once-an-hour logging, runtime
  quota, 20% delete allowance) are fixed.
- Still true: the Sheet is the record; nothing reads the Firestore copy yet. Next: phase 3 (screens read Firestore).
