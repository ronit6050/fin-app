# Quick-confirm notification button

**Status: built 2026-09-19. Backend `clasp push`ed to the editor draft
only (not `clasp deploy`ed). Frontend (`index.html`, `sw.js`) not yet
`git push`ed. Needs the user's go-ahead before either goes live — see
CLAUDE.md's standing rule on this.**

## What this is, in plain terms

The user's idea: when a new transaction notification arrives, be able
to reply to it the way you'd reply to a WhatsApp/Telegram message,
instead of opening the app to add a note.

A real technical limit ruled that out directly: Android's web-push
notifications don't support typing free text into the notification
itself (that's a native-app-only feature). What they DO support well
is a tap-able **button** on the notification. So this builds the
realistic version of the same idea: when the app is already confident
about what a transaction is, the notification shows a **"Confirm"**
button — tapping it saves the note/category right then, with the app
never opening at all.

## When the button shows up (the safety gate)

Deliberately conservative — a wrong auto-save on a real financial app
is worse than occasionally not offering the shortcut. The button only
appears when **all** of these are true for a new transaction:

1. It's a **debit** (spending), not money coming in.
2. `NoteMemory` already has a note used **2+ times** for this exact
   merchant + amount band (the same confidence bar the Pending screen's
   own note suggestion already uses — see
   [note-memory.md](note-memory.md)).
3. `SmartMemory`/pattern-matching produces *some* category for it
   (almost always true — `getSuggestedCategoryFast` falls back to
   "Other" rather than returning nothing).
4. It does **not** match a recognized Rent/EMI/Investment Financial
   Event (`suggestFinancialEvent`) — those need a follow-up question
   (which EMI? which fund?) that a single button tap can't ask.
5. It's **not** a wallet top-up (`isWalletTopUp`) — not real spending.

If any of those fail, the notification looks exactly like it always
has (no button) — no regression, just no shortcut for that one
transaction.

A credit-card-bill-payment check is deliberately left out of this gate
— it needs the whole `Transactions` sheet to compute the outstanding
bill total (`getOutstandingCCBillTotalsByCard`), too expensive to read
on every single trigger run just for this. Leaving it out is harmless:
`saveTransactionNote()` re-checks that from the real saved row
(mode/counterparty/note/amount) before touching any spend total or the
Need/Want/Saving column — completely independent of whatever
note/category this button happened to save.

The gating logic itself is `getQuickConfirmSuggestion()` in
`backend/PWA.js` (right after `getPendingTransactions`) — a small, pure
function, independently tested in
`backend/tests/quickConfirmNotification.test.js` rather than buried
inline in the trigger loop.

## How it actually saves — reuses `saveNote`, no new backend action

Tapping "Confirm" calls the exact same `saveNote` action Pending and
History already use, with the note/category/type that were already
shown on the notification. No new Apps Script action was needed —
`saveTransactionNote` already does everything correctly (writes the
row, teaches SmartMemory, records the type vote, etc.) as long as it's
never called for one of the special cases excluded above, which the
gate already guarantees.

## The real limitation: the sign-in token can go stale

The service worker can't ask you to sign in — it can only use whatever
Google sign-in proof (`idToken`) was last saved on the phone, which the
app's own existing comment already documents: **"A sign-in proof lasts
about an hour."** If you haven't opened the app in longer than that,
the token in storage is stale, and the Confirm tap will fail.

This is handled honestly, not silently:
- On success, a small "Saved" notification confirms it.
- On failure (stale token, no network, or nothing signed in yet on
  this device), a "Couldn't save automatically" notification tells you
  to open the app instead — exactly the same result as if the button
  had never existed, no worse off.

No refresh-token flow was built to work around this — that would need
a much bigger OAuth setup for a single-user hobby project, and the
honest fallback is a perfectly fine outcome for the case where it
doesn't apply.

## How the token reaches the service worker at all

A service worker can only read **IndexedDB**, never `localStorage` —
but `currentUser.idToken` (the real sign-in proof) is saved to
`localStorage` today. So `index.html` also copies it into a tiny
IndexedDB database (`finAppAuth`, store `tokens`, one row keyed
`"current"`) every time you sign in or a saved session is restored on
load (`syncAuthTokenForServiceWorker`), and clears that row on sign-out
or when a session is detected as expired (`clearAuthTokenForServiceWorker`).
`sw.js` reads it back with `getStoredIdToken()` only when a "Confirm"
tap actually needs it.

This is best-effort by design: if IndexedDB isn't available for some
reason, or the copy fails, the button in `sw.js` just falls back to
"open the app instead" — nothing else in the app depends on this
succeeding.

## Files touched

- `backend/PWA.js` — `getQuickConfirmSuggestion()` (new).
- `backend/transactions.js` — `processNewTransactions()` calls the
  function above and, when it returns a suggestion, adds a richer push
  body ("Tap Confirm to save as...") and passes the suggestion through
  to `sendPushNotification`'s new third argument.
- `backend/push.js` — `sendPushNotification(title, body, extraData)`
  gained an optional third argument. Every value in `extraData` is
  converted to a plain string before being sent — Firebase Cloud
  Messaging's "data" message format only accepts strings, and silently
  rejects the whole send otherwise (a real, easy mistake since `row`
  is naturally a number).
- `sw.js` — shows the "Confirm" action button when
  `payload.data.quickConfirm === "1"`; a new `notificationclick` branch
  for that action reads the stored token, calls `saveNote` directly via
  `fetch`, and shows a result notification either way. Never opens the
  app for this path.
- `index.html` — `syncAuthTokenForServiceWorker` /
  `clearAuthTokenForServiceWorker`, called wherever `currentUser` is
  set, restored, or cleared.

## Verified

`backend/tests/quickConfirmNotification.test.js` (16 checks): every
gate above tested individually (confident case shows the button;
one-time note withholds it; a recognized Rent payment withholds it even
with a confident note; a wallet top-up withholds it; a credit withholds
it; a confident Need/Want/Saving vote history is included), plus
`sendPushNotification`'s string-conversion (a real number survives as
a string, the existing 2-argument call sites are unaffected). Full
backend suite (18 files, 595 checks) still passes.

**Not yet verified**: an actual live device test (does the button
really appear on a real Android notification, does tapping it actually
save with no app-opening, does the fallback message actually show when
the token really is stale) — the same category of "owed to the user on
a real phone" verification flagged for other recent frontend changes in
this project, since this environment's browser preview can't render a
real Android push notification at all.
