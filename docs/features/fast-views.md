# Fast views (Phase 3 of the Firestore plan) - added 2026-10-11

## What it is, in plain words
The brain (Apps Script) already works out every screen. Since Phase 1 it also
stores a finished copy of the Home screen in Firestore (`views/dashboard`; that
one document also carries the data for Pending, Today, Analysis, CC Advisor,
Debts, Savings, Investments and Cash). Phase 3 makes the phone READ that copy
directly: about half a second instead of 3-10 seconds waiting for Apps Script
to wake up and read the sheet.

Saving still goes to Apps Script exactly as before. This only changes reading.

## One-time setup done in the Firebase console (not in git)
- Authentication: Google sign-in enabled (support email = the owner).
- The app's Google client ID (`1090460874478-...`, belongs to a DIFFERENT Google
  project than Firebase's `921605499750`) added to "Safelist client IDs from
  external projects" - without this Firebase rejects the app's Google token.
- Firestore rules published (only the owner's verified email may READ `views/*`;
  no client writes; everything else denied):
  `match /views/{doc} { allow read: if request.auth != null && request.auth.token.email == 'ronitnadar9@gmail.com' && request.auth.token.email_verified == true; allow write: if false; }`
  plus `match /{document=**} { allow read, write: if false; }`.
  The backend robot (service account) bypasses rules, so publishing is unaffected.
- Verified: an anonymous read returns 403 / `permission-denied`.

## Backend (`backend/viewPublisher.js`, `backend/PWA.js`)
- The published document now has `builtAt` (ms, server clock, taken BEFORE the
  sheet is read) and `version: 2`.
- New action `refreshViews`: forces a rebuild now (ignores the 15 s throttle) and
  returns `{ok, published, builtAt}`. It runs after the normal sign-in/allowed-email
  check. If Firestore is down it returns `published:false` (no crash).

## App (`index.html`, search "FAST VIEWS")
- Signs in to Firebase quietly: `signInWithCredential(GoogleAuthProvider.credential(idToken))`;
  Firebase then remembers its own session, so an expired Google proof does not stop
  the copy loading. Listens with `onSnapshot` and renders through the same functions
  as before (`applyDashboardData`).
- Fallbacks to the old way (Apps Script `getDashboard`): no copy within 4 s, any
  Firebase/Firestore error, a copy older than 40 minutes, Settings -> Speed ->
  Fast loading = Off, Demo Mode, or a rebuild the server could not do.
- Expired-sign-in check: the fast path makes one cheap `ping` at startup so an
  expired Google sign-in still sends you to the login screen.
- OLD COPY MUST NEVER UNDO YOUR SAVE: while a data-changing action is running (and a
  1.5 s debounce + the `refreshViews` call), incoming copies are held back; after the
  rebuild only copies with `builtAt >= the rebuilt one` are accepted. A burst of saves
  causes one rebuild. If the app is closed before the rebuild is confirmed, a `fastDirty`
  marker in localStorage makes the next open ask Apps Script directly once and rebuild.
- Pending from a copy is ADD-ONLY (never removes/replaces a card); removals still come
  from the direct 15 s `getPending` check, which is unchanged.
- The first copy of a visit never pops an in-app "new transaction" alert; later ones can.
- `seedTabsFromDashboard` seeds Analysis only when the browsed month is the real
  current month (the copy always holds the current month).

## Known limits (accepted)
- A save made from the notification's Confirm button (service worker) does not set the
  `fastDirty` marker; the copy catches up within ~5 minutes (timer) so Home numbers can
  be briefly old on reopen. The 15 s Pending check still removes the card.
- A hung (never answering) Apps Script save keeps copies held until it errors out; the
  15 s poll keeps working meanwhile.
- A slow timer publish that started before a `refreshViews` could land after it and leave
  the stored copy older until the next publish; the app ignores it by `builtAt`.
- Real Google sign-in into Firebase (web and the Android WebView) can only be proven on a
  real device. If the native app's token is for a different OAuth client than the safelisted
  one, it falls back to Apps Script silently (Fast loading simply off there).

## Tests
- `backend/tests/fastViewsClient.test.js` runs the REAL code extracted from `index.html`
  against a fake Firebase and fake clock (48 checks, mutation-tested).
- `backend/tests/firestoreClient.test.js` section 12 covers `refreshViews`.

## Deploy order
Backend first (`clasp push` + `clasp deploy`), THEN `git push` of `index.html`; otherwise
the page would call an action the backend does not know yet.
