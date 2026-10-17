# Admin panel (owner's web page) - phase 1: recording and the honest score

Started 2026-10-16. Owner's ask: a proper admin view (a web page, not just the phone's More > Access) showing which features people use,
what problems they hit, errors, when each person last used the app, and **how well the app is getting at understanding transactions,
with no flattering numbers and proper reasoning**.

**Status 2026-10-16: phase 1 (recording + scoring + owner-only data action) is LIVE (Apps Script `@366`, new server updated, app `2026-10-16-01`, commit `a1c750b`). Phase 2, the page `admin/index.html`, is LIVE at https://ronit6050.github.io/fin-app/admin/ (pushed 2026-10-17, commit `baa20f3`; checked with invented data in light/dark and for HTML-injection safety).**

**Later upgrades the owner approved in principle but asked to wait for real data (not built):** a History section from stored transactions (monthly share of payments the SMS missed, found by statement checks: about 25-35% in Mar-Apr 2026 down to about 6% in Sep-Oct; labelled as only known for months with an uploaded statement), per-bank maturity labels (Learning / Early / Established) with the headline on established banks and new banks shown beside it, a per-person reading row, and trend markers for "bank taught" / "person joined". Numbers start from the first SMS / app open after the deploy.

## Privacy rule (the owner's rule, enforced in code and tests)
The owner sees **usage and errors only**. No amount, note, payee, SMS text, reference or account digits is ever written to the new
collections. Error text is cleaned first (numbers, e-mail addresses and links removed). The e-mail appears in exactly one place: the
owner-only presence document `adminStats/p_<personKey>`. The collections `adminStats` and `adminErrors` are closed to every phone by
`firestore.rules` (the catch-all `deny`), only the backend robot reads or writes them.

## What is recorded (all whole-number counters, so two servers can write at once)
| Where | What |
|---|---|
| `adminStats/u_<week>` (everyone together, one per Monday-start India week) | per bank: `b_<BANK>__full / partial / unc / ign / dup / nopayee / rev / fix / unc_junk / conf_removed / restored`; global: `g__saves, cat_kept, cat_changed, cat_none, type_kept, type_changed, type_none, revised, auto, recon_added` |
| `adminStats/p_<person>` | email, `lastSeenMs`, `version`, `platform`, `lastSmsMs` |
| `adminStats/w<week>_<person>` | `s_<screen>` opens, `a_<action>` counts, `errs`, `sms_saved / sms_unc / sms_ign` |
| `adminErrors/<signature>` | cleaned message, kind (`app / network / server`), screen/action, `count`, per-day counts `d_<yyyymmdd>`, one `u_<person>` flag per person affected, `lastMs`, `resolvedAtMs` |

Recorded by: the SMS doors (`smsIn.js`, legacy `ingest.js`), `saveTransactionNote`, `markNotATransaction`, `restoreIgnoredTransaction`, auto-settle,
Reconcile (`insertReconciledTransactions`), the phone's own report (action `adminLog`, `adminSeen` in `index.html`) and the shared error net in `pwaDispatch_`.
Everything is **best-effort**: a failure to record never changes a save, a reply to the phone or a notification (tested by making the counters
throw). Switch: `ADMIN_STATS_ENABLED_` in `backend/adminStats.js` (false = nothing recorded). Cost: about 1 write per SMS, 1 per note save, 3 per phone report
(a few per person per day), and a dashboard load reads about 60 documents.

## The score - how it is computed and why it cannot flatter (backend/adminScores.js)
There is **no single blended "overall" number** (a blend can hide a weak area). Three separate scores, each with a status:
`collecting` (too little data: no score), `unverified` (shown only as a raw rate, no score), `verified` (a score, with the sum written out in words).

1. **Reading** (per bank and for everyone). *Read rate* = messages understood fully (amount AND spent-or-received found) / real messages. Real messages = full + partial + "needs review" minus the "needs review" ones a person marked as junk (junk is not a transaction). Payments found later by a **statement check** (Reconcile) that the SMS never delivered are added to the denominator (everyone together only). *Accuracy* = 1 - wrong / checked, where **checked** = payments a person saved from an SMS + confidently-read payments they removed as "not a transaction" and did not put back, and **wrong** = amounts the person had to correct + those removals. **Score = read rate x accuracy.** Needs >= 20 real messages (else `collecting`) and >= 10 checks AND checks on at least a quarter of the messages (else `unverified`: the raw read rate is shown but NO score, because unchecked readings are not assumed right). "Strong" is only said with >= 60 checks; a high score on fewer is "promising (small sample)". The words say "needed no correction", never "was right".
2. **Guessing** = (guesses kept - guesses corrected later in History) / guesses shown, counting category and Need/Want guesses on first-time Pending saves. "Other" (the app's fallback) and notification replies are not counted as guesses. Needs >= 30 guesses. A kept guess is not proof it was right; later corrections are subtracted.
3. **Done for you** = payments the app settled itself (Rent / EMI / SIP recognised) / (those + payments a person noted). Needs >= 30 payments. It is allowed to be low.

The headline looks at the latest 4 weeks; a per-week trend (8 weeks) shows a week only when it has enough data of its own.
**Blind spots** are listed on the dashboard in plain words: messages wrongly ignored are invisible (only statement checks reveal them); unopened messages are never assumed
correct; payee names are not checked; a kept guess is not proof; numbers start the day recording went live.
Verdict words: >= 90% strong, >= 75% fair, otherwise needs work (never shown without a score).

### Same payments on both sides (added after the independent review, 2026-10-16)
Checks and message counts must be about the same payments, so a payment counts for the checks only if it was read by a recorded door (Transactions Source `Phone`: the new SMS door and the friends' door; the old Tasker reader writes `Tasker` and is counted on neither side) and it arrived on or after the day recording started (`adminStats/meta.sinceMs`, created once). Reconcile's bulk "save found notes" (`noCount`) counts nothing. An amount corrected later in History (or on a repeat save) counts as a wrong reading. Putting back a "needs review" message that had been removed as junk makes it a real message again (`unc_restored`). Ignored and duplicate messages share one key (`b_ALL__`), a digits-only sender is never used as a name, and problems not seen for 30 days are deleted when the dashboard loads.

## Owner-only actions (backend/admin.js, listed for the new server in functions/index.js)
- `adminLog` - any allowed signed-in person (also Splits-only friends): the phone's report (known screen names only, capped at 80 reports and 30 errors per person per day).
- `getAdminDashboard` - owner only. One answer: tiles (people, active today, errors today, SMS this week, database use, timer health), people (last seen, version, platform, last SMS, flags such as "No SMS for 5 days" or "Invited, not started"), features used, grouped problems, and the `understanding` block above.
- `resolveAdminProblem` - owner only. A resolved problem leaves the list and comes back by itself if it happens again afterwards.

## Known limits (honest list)
- Only mistakes a person FIXES are seen. A wrong amount (e.g. the balance read as the amount) or a wrong spent/received that nobody edits counts as fine. Pending cannot edit a read amount; History can. This is stated on the dashboard as a blind spot.
- Per-bank rows do not include statement-check misses (they cannot be assigned to a bank); they carry a note saying so.
- Counters for one week all live in one document; a very large burst could lose a count under write contention (nothing records that).
- Error text is stripped of digits, e-mails and links but not of words; the app's own error messages carry no personal words today, but a thrown message that did would be kept (160 characters).
- The Android app does not yet report whether SMS permission is on (its bridge has no such method); for now "last SMS received" is the evidence. Reporting the permission needs a small native-app change.
- Statement-check misses can only be attributed to everyone together, not to a bank (the import writes a fixed bank).
- Numbers start when recording goes live; no history is backfilled.
- The page signs in with the same Google client as the app; it works only for the owner's account (the server refuses anyone else). It calls the new server and falls back to Apps Script.

## Files and tests
`backend/adminStats.js`, `backend/adminScores.js`, hooks listed above, `backend/tests/adminStats.test.js` (counters, score arithmetic by hand, privacy, caps, dashboard, phone-side reporter).
