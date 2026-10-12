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

## Not built yet (in order)
1. Pending card "Split" button + split sheet, and the Debts "people" list + person detail
   (`index.html`; mockup approved 2026-10-12).
2. **My spend should count only my share.** Today Analysis/Today/Home read the full
   amount from the Sheet. Plan: store the friend's share against the transaction (new
   Transactions column) and subtract it in the spend totals - touches several
   functions, needs its own careful pass and tests.
3. Suggest "count this incoming payment toward Vaidehi's balance?" from a matching bank SMS.
4. Vaidehi's own sign-in. Today every action still requires the owner's email
   (`PWA_ALLOWED_EMAIL`), so only you can create/record. Her phone can already READ her
   side directly once rules are published and the screens exist; letting her WRITE
   (her own payments, her own friends) needs the multi-user sign-in and per-person
   push token / settings work.
5. "Remind" button (WhatsApp / UPI link with the amount filled in).

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
