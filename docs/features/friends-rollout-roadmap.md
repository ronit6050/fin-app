# Rolling the app out to friends: roadmap (2026-10-26)

**Status: PLAN ONLY. Nothing built.** Owner decision (2026-10-26): **automatic SMS reading stays with the owner and Vaidehi only for now.**
New friends get the app WITHOUT SMS reading. Revisit SMS for others only when the "Gate" at the end is met.

## The idea in one line
Friends use the app for what does not need their messages: **splits with you, manual payments, statement upload, budgets/planner, savings, debts.**
Splits are the hook (a friend only needs to sign in), so the first friends are useful on day one with zero setup.

## What a friend can do WITHOUT SMS (all exist today unless marked NEW)
- Sign in with Google, see splits with you (friend mode, exists).
- "Full app" switch from More > Access (exists): Home, Pending, Analysis, Planner, Debts, Savings, Cash.
- "+ Add a transaction" by hand (exists). Needs to become the big, obvious main button for these people (NEW, small).
- **Upload a bank or card statement** under More > Reconcile (exists, built for finding missing payments). Could become the friend's "bring my month in" path: upload once a month, review, approve (NEEDS CHECKING: it matches against existing rows, so confirm it also works when the person has zero rows).
- Notes, categories, Need/Want/Saving learning all work from their own confirmations (exists).

## Phases (each ends with your go/no-go)

### Phase A: make "no SMS" a proper mode (small, do first)
1. **Neutral defaults** for non-owner people: no card limit 50,000, no expenses 30,000, no 18th cycle. Show "not set" and hide cards that need them.
2. **A per-person "SMS: off" state.** Friend mode never asks for SMS permission and never shows "NEEDS REVIEW" or SMS wording anywhere. The Android app must not ask for SMS permission for these accounts.
3. **Add payment becomes the main button** (Pending/Home), with a one-line honest note: "You add payments yourself; it takes a few seconds each."
4. Empty states that make sense with no data yet (nothing says "waiting for a message").

### Phase B: first-run welcome (the onboarding plan, trimmed)
Make the welcome tour the normal first run (today it only exists in "New look"). Short: what the app does and that it is private; do you have a credit card (limit, bill date); salary day (optional); then straight to adding the first payment. No bank question, no SMS explainer needed in this mode. Questions flip screen switches on that phone only (the tour already does this).
Detail and scenarios: `docs/features/onboarding-plan.md`.

### Phase C: pilot with 2 to 3 friends
- Pick friends who will actually tell you what confused them. Add them by hand (Access screen), switch on full app.
- Watch for one week: Access screen use, errors, who stopped and where. Ask each person 3 questions: what did you try first, where did you get stuck, would you use it again next week.
- Keep Rs 300 limit alerts on; each friend adds small Firestore use.
- Fix only what the pilot shows. Do not add features in this phase.

### Phase D: make joining low-effort for you
Only after the pilot works: invite link or code instead of adding emails by hand; the Admin panel showing per-person last seen and how far each got (added a payment? noted one?); a "delete my data" button (also a privacy must-have).

### Phase E: the monthly statement habit (if friends like the app but hate typing)
Turn statement upload into a first-class "Bring in my month" flow with a monthly reminder push. This is the SMS-free way to get volume without any phone permission.

### Phase F (later, only if wanted): public and SMS for others
Needs the Gate below.

## The Gate before SMS reading is offered to anyone else
All of these true:
1. The no-SMS pilot (Phase C) went well, so the base app is liked.
2. Android SMS permission has a plain explanation screen and a graceful "no" path.
3. Unknown banks reach you without you hunting (one-tap "send sample messages"), or teaching a bank is quick enough to stay manageable.
4. Native app tested on at least Samsung, Xiaomi/Redmi and Oppo/Realme (background-kill behaviour), with the weekly resync proven on each.
5. Several cards or accounts for one person checked.
6. Play Store / DPDP privacy homework done if the app will ever be listed publicly (READ_SMS is restricted; sideloaded APK is the only route until then).

## Not doing now
Open sign-up, Play Store listing, charging money, asking people to list investments/EMIs/rent up front, iPhone-specific work (it is manual-entry anyway).

## Risks to keep in mind
- A manual-entry app is much less sticky than an automatic one. The pilot must answer: will people keep typing? Splits and statement upload are the mitigations.
- Statement upload on an empty account is unverified (see above).
- Each friend adds Firestore reads/writes; a handful is fine within the Rs 300 ceiling, 50 is not tested.
- Friends' data is never hand-edited by the owner (standing rule); let them fix it in the app.
