# Splits with friends (started 2026-10-12)

## What it is, in plain words
Split a payment with a friend. Each friend has ONE running balance with you
("Vaidehi owes you Rs 800"). A split adds to it, a payment subtracts, overpaying
flips it ("you owe her Rs 100"), and any entry can be undone.

## Decisions made with the user (2026-10-12)
- Start a split from the **Pending card** (a "Split" button next to Save).
- Friends are saved with **name + mobile + email**. The email is the secure link:
  when she signs in with that Google email her account sees the data already there.
- Her side is filled in **automatically** (no accept step) - easy to add an approval
  step later for strangers.
- Equal split by default (odd paisa stays with whoever paid), editable amounts. Two
  people only; groups later.
- **One balance per person**, not per-split settlement. Payments reduce the balance;
  the list of splits is just the history behind it.
- Lives inside the **Debts** screen (a "people" list on top), no new tab - same
  question ("who owes whom"), one place to look.
- Version 1 leaves out: notes/photos on splits, groups, anything beyond equal/edit
  amount/record payment/remind.
- Cost: free tier only so far (Spark). Blaze approved with a Rs 300/month ceiling for
  the later backend move; not needed for this slice.

## Where the data lives (Firestore, NOT the Sheet)
```
users/{myEmail}/friends/{friendEmail}                    name, mobile, email, balancePaise, mirror
users/{myEmail}/friends/{friendEmail}/ledger/{entryId}   one split or payment
users/{myEmail}/splitMarkers/{transactionKey}            "this payment is already split"
```
- Money is whole **paise** (integers). Sign convention for whoever owns the folder:
  positive = friend owes me, negative = I owe the friend.
- Every entry is written twice: mine (+) and a MIRROR under the friend's email (-).
- Balance is a stored number kept with atomic "add" operations, and `getPerson`
  re-adds the history every time and quietly corrects the stored number if they differ.
- The marker is what stops one payment being split twice; undo removes it so the
  payment can be split again.
- Every change is ONE all-or-nothing batch (`fsCommit_`): entry + mirror + both
  balances + marker land together or not at all.

## Security (`firestore.rules`, repo root)
A phone may READ only `users/{its own verified email}/...` and the owner-only
`views/*`; it can never write. The backend robot writes (rules don't apply to it).
**Rules are not deployed by git: paste `firestore.rules` into Firebase console ->
Firestore -> Rules -> Publish.** (Needed before Vaidehi's phone can read her side;
the app's own `views` rule is unchanged.)

## Backend
- `backend/firestore.js`: new `fsPathUrl_`, `fsGetPathMeta_`, `fsListPath_`, `fsCommit_`
  (set / merge+adds / add / del, with "only if new" and "only if unchanged" checks).
- `backend/splits.js`: `splitsHandle_(action, data, verified)` front door, called from
  `PWA.js`. Actions: `getPeople`, `getPerson`, `addFriend`, `createSplit`,
  `recordSplitPayment`, `undoSplitEntry`. Amounts in/out are rupees; stored as paise.
- Errors never throw past the front door: Firestore trouble returns
  `{ok:false, error:"... Nothing was saved ..."}` and a `SPLITS_ERROR` line in AILogs.
- Split actions are NOT in `V2_WRITE_ACTIONS_`, so they don't rebuild the Home copy.

## Action contracts (for the screens)
- `addFriend {name, mobile, email}` -> `{ok, friend}`
- `createSplit {friendEmail, totalAmount, friendShare?, description, txRow, txFp, requestId}`
  -> `{ok, entryId, friendShare, myShare, balance}` or `{ok:false, duplicate:true}`.
  `requestId` should be made once per card and reused on retry.
- `recordSplitPayment {friendEmail, amount, direction: "received"|"sent", method, note, requestId}`
- `undoSplitEntry {friendEmail, entryId}`
- `getPeople` -> `{people:[{name,email,mobile,balance}], owedToMe, iOwe}`
- `getPerson {friendEmail}` -> `{person, entries:[...], healed}`

## Screens (index.html, built 2026-10-12, NOT yet pushed to GitHub Pages)
Search `SPLITS WITH FRIENDS` in `index.html`.
- **Pending card:** "Split with a friend..." link (only for real spending: not credits, wallet/card-bill transfers).
  Opens a panel: friend dropdown (+ "Add a new friend" inline), their share (half by default, editable),
  and a live "You keep X, Vaidehi owes you Y". Save becomes "Save and split". The split is recorded FIRST,
  then the note; if the split fails nothing else is saved and the card returns; a retry reuses the same
  request id so it can never split twice. A bad share is caught before the card disappears.
- **Debts screen:** a "People you split with" list on top (balance per person, tap to open) and
  "+ Add friend" (name, mobile, email). The blue header total now includes friends. The list refreshes
  EVERY time Debts opens (not only the first time).
- **Person page:** balance, Record payment (who paid, amount prefilled with the full balance and editable,
  UPI/Cash; balance updates instantly), Remind (opens WhatsApp with the message ready), and the full
  history with a tap-twice Undo.
- **Demo Mode:** works with pretend friends (Vaidehi, Raj) so it can be tried safely.
- Checked in a real browser in Demo Mode: list, person page, payment, undo, split from Pending, bad share,
  server failure (card returns, note not saved), inline add friend. No console errors.
- Colours: only existing tokens, so light and dark both work (dark checked visually; light not).

## Not built yet (in order)
1. **My spend should count only my share.** Today Analysis/Today/Home still count the full amount from the
   Sheet. Plan: store the friend's share against the transaction (new Transactions column) and subtract it in
   the spend totals - touches several functions, needs its own careful pass and tests. Until then the Home
   "Debts net" tile (computed by the backend) also ignores friends; only the Debts screen header includes them.
2. Suggest "count this incoming payment toward Vaidehi's balance?" from a matching bank SMS.
3. Vaidehi's own sign-in. Today every action still requires the owner's email (`PWA_ALLOWED_EMAIL`),
   so only you can create/record. Her phone can already READ her side directly from Firestore (rules published
   2026-10-12) once a screen reads it; letting her WRITE needs the multi-user sign-in and per-person
   push token / settings work.
4. Notification "Split" button, groups, notes/photos on splits, UPI link on Remind.

## Tests
`backend/tests/splits.test.js` (122 checks, mutation-tested): balances, the user's own
Rs 1,000 / Rs 200 / Rs 800 example, overpay, duplicate protection, undo, all-or-nothing
failure, Firestore-down, privacy of paths, and the rules file.

## Independent review (2026-10-12): safe to ship
Reviewer found no money or existing-behaviour risks. Fixed same day: the balance self-heal now ADDS the
difference on each side separately (never overwrites, skipped if history hit the 2,000-entry cap), and every
action validates the friend email. Accepted for now: a genuine retry after a timeout shows "already split"
(balance is right); Firestore contention (also HTTP 409) could be mislabelled "already split" (very rare);
`addFriend` can create a folder for any email you type (harmless while only the owner can call it).
Deploy order: publish `firestore.rules` in the console, then `clasp push` + `clasp deploy`.

## Screens: independent review (2026-10-12), fixed before pushing
Reviewer found no regression to Pending Save without a split and no unescaped text. Fixed: Demo Mode could show
real friends (now cleared on entry); a retried split's notice could name the wrong amount (now says "already split
earlier"); the person page could get stuck/layered (Debts always reopens at the list, a background refresh never
draws the list on top); the saved friends copy is removed with the in-memory one so balances can't flash stale;
default half-share computed in whole paise. Accepted: sign-out doesn't clear the friends cache (same as every other
cache; only the owner can sign in); a payment retried after a dropped connection gets a new request id (the page
reloads and shows the history first).

## Friend mode: friends sign in themselves, splits only (built 2026-10-12)
**What it is:** anyone the OWNER has added as a friend can sign in with their own Google account and gets a
splits-only screen ("Splits": people list, person page, add friend, record payment, undo). No Home, Pending, Analysis
or any Sheet-based screen. Their data lives in their own Firestore folder (`users/<their email>/...`).

**Who is allowed (backend, `backend/PWA.js` + `splits.js`):** a non-owner passes only if (a) the action is one of
`SPLITS_FRIEND_ACTIONS_` (ping, getPeople, getPerson, addFriend, createSplit, recordSplitPayment, undoSplitEntry)
AND (b) `users/<owner>/friends/<their email>` exists and is NOT a mirror entry (the owner added them by hand).
Adding someone IS the permission; there is no separate list. Remembered 10 min for yes / 1 min for no; fails closed
if Firestore can't be read. Every other action (anything touching the owner's Sheet, push token, settings) is refused
before the action runs, with the same message for "not a friend" and "action not allowed". `verifyGoogleIdToken` now
also requires `email_verified == "true"`.

**Frontend (`index.html`, search `friendMode` / `startFriendMode`):** `body.friend-mode` hides everything marked
`owner-only`; no dashboard/pending/push/fast-views/15 s polling in friend mode; "not added yet" screen if the backend
says no. The real enforcement is the backend, the hiding is only tidiness.

**Security review fixes (2026-10-12):** (1) adding the owner back no longer flips his real entry to a mirror and locks
her out; adding someone always writes `mirror:false` on MY entry so re-adding repairs it; (2) a friend's copy of a
split no longer carries the owner's row number / fingerprint / transaction key; (3) undo by either side frees the
creator's "already split" marker.

**Known and accepted:** a friend can write a "you owe me" split into the OWNER's ledger for that friend with no consent
step (visible on his Splits screen, undoable, never touches Debts or the Sheet); a friend shares the owner's free
quotas; if a friend's Google email differs from what the owner typed (case is fine; dots/aliases are not) they see
"not added yet". Not built: the owner approving a friend-created split, deleting a friend, per-friend push.

**Needs:** Google OAuth consent screen must either be "In production" or list the friend as a Test user.

## My spend counts only my share (built 2026-10-12)
Transactions column U `FriendShare` holds the rupees a friend owes on a split payment (see SHEET_SCHEMA.md).
`txnFriendShare_` / `txnMyAmount_` (PWA.js) turn a row into "your amount"; with column U empty they return the
amount UNCHANGED (no rounding). Used by: `getMonthlyAnalysis` (this includes the Bank/Card/Wallet buckets), `getTodaySummary`
(feeds Home), and two planner.js loops. Deliberately NOT changed (still the full amount, because the bank/card
charged the full amount): card-bill matching, CC Advisor card totals, average card bill, ATM rows, Pending/History
amounts, Recon. `getTransactionHistory` returns `friendShare` and History shows "Rs X of this was a friend's share".
- Written by `createSplit` (owner's payments only) and cleared by undo (by either side) via `splitsApplyShareToSheet_`:
  needs the fingerprint (`txFp`; never writes by row number alone), finds the row BY FINGERPRINT if a Reconcile has
  re-sorted the sheet, and refuses when several rows look identical.
- A retry that hits "already split" re-applies the share, so a failed Sheet write heals when you tap Save again.
- Daily self-repair: `checkAppHealth` calls `splitsAutoRepairShares_` (logs `SPLITS_SHARE_REPAIRED` only when it fixes
  something). By hand: `splitsCheckShares()` (looks) / `splitsFixShares()` (repairs). Ambiguous rows are reported, never touched.
- Known edge cases: editing a split payment's amount to less than the share makes the share be ignored; "Not a
  transaction" on an already-split payment leaves the split in Firestore with no Sheet row.
- Review (2026-10-12): safe; nothing in existing numbers changes when column U is empty.

## Move an old debt into a friend's balance (built 2026-10-12)
Owner-only action `moveDebtToFriend {row, friendEmail, expectedPerson, expectedType}` (`splitsMoveDebt_`). Turns one open row
of the Debts sheet into a `carryover` ledger entry ("Earlier balance: <person>") on a friend's page (LENT/SPLIT = they owe you, BORROWED
= you owe them) and marks the Debts row Settled. Guards (from the independent review): the card must send the person and type it
showed and the row must still match (else "That debt changed..."); a per-debt marker `users/<owner>/debtMoves/<id>` means a retry that
picks a DIFFERENT friend can never credit one debt twice (it closes the debt and says where it went); the Firestore entry is written first
with a deterministic id so a half-finished try is safe to repeat. Carry-overs can NOT be undone (record a payment to adjust). It skips the
DebtPayments log and the "repaid" push on purpose (this is not a repayment). The UI needs a second tap ("Move it (can not be undone)").
The Home "Debts" tile and the Debts header now include friends' balances, so moving a debt never changes the headline number.

## Daily Firestore safety limit (2026-10-12)
`fsGuard_` in `firestore.js` refuses Firestore calls at 45,000 reads / 18,000 writes a day (90% of the free allowance); see
`docs/going-public-ops.md`. The meter counts only Apps Script's own calls (a phone's direct read of the Home copy is not counted).
