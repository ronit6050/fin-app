# Self-learning spam filter

**Status: backend + PWA.js piece done, pushed to the Apps Script editor
draft, NOT yet `clasp deploy`ed live** (added 2026-09-18). Built across
three files by three different pieces of work sharing one exact
contract: `backend/PWA.js` (this file — the removal + learning
record-keeping), `sms-parser-backend/Code.js` (a *separate* Apps Script
project — the actual "does a new SMS match a learned pattern" check),
and `index.html` (the "this isn't a real transaction" button on
Pending). Check each project's own status before assuming this is fully
live end to end.

## What this does and why

Sometimes a promotional/spam SMS wrongly slips past the SMS parser
(`sms-parser-backend/Code.js`) and gets saved as an `UNCERTAIN`
transaction — shown in Pending with its Counterparty prefixed
`"NEEDS REVIEW: "`. `UNCERTAIN` exists on purpose (see that project's
own notes in `CLAUDE.md`, "a real, from-scratch rewrite" section) — it's
the safety net that means a genuinely real transaction in a format the
parser doesn't recognize never gets silently dropped. The cost of that
safety net is that a handful of ordinary promotional messages do slip
through and land in Pending needing a human glance.

Until now, cleaning that up meant the user noticing it themselves and
asking in chat to fix it by hand. This feature lets the user mark
"this isn't a real transaction" themselves, in one tap, right from
Pending — and that one tap does two things:
1. **Removes it** from Pending (and from `Transactions` generally) —
   archived, not deleted, so nothing about the original message is ever
   truly lost.
2. **Teaches the system** to recognize near-identical junk automatically
   next time, so the same spam SMS (or a close variant of it) never
   needs a second manual cleanup.

## The two new sheets

Both auto-created on first use, same "auto-create on first use"
pattern already used elsewhere in this codebase (e.g.
`investmentInstruments.js`'s `getInvestmentInstrumentsSheet_()`,
`Logger.js`'s `AILogs`) — no manual sheet setup required.

### `Transactions_Ignored`

An exact archive of every row a user has marked "not a real
transaction." Same header row as `Transactions` (copied over on
creation), same columns, one full row appended per removal. This is
deliberately an **archive, not a delete-and-forget** — if the learning
is ever wrong later (a real transaction accidentally marked as spam),
the original data is still sitting here, recoverable, not gone.

### `LearnedSpamPatterns`

| Column | Meaning |
|---|---|
| DateLearned | When this pattern was learned |
| Sender | The SMS sender ID (column L on the original row) |
| NormalizedTemplate | `normalizeForFingerprint(RawSMS)` — see below |
| ExampleRawSMS | The original, untouched raw SMS text, kept for the user's own future reference if they ever want to look at what got learned |

One row per marked-as-spam message that was specific enough to safely
generalize from (see the minimum-length guard below) — **not** one row
per every archived message; a too-generic message still gets archived
to `Transactions_Ignored` but does NOT get a row here.

## `markNotATransaction(row)` — what it actually does, step by step

New action, routed in `handlePwaRequest` alongside `saveNote`. Input:
`{ idToken, row }` (`row` = the `Transactions` sheet row number, same
meaning as `saveTransactionNote`'s `row`).

1. **Validates the row is still genuinely pending** — reads the row
   fresh from `Transactions` and checks column P (Processed) is `"YES"`
   and column M (Note) is blank, the exact same guard
   `getPendingTransactions()` already uses to decide what counts as
   pending. If the row doesn't look pending anymore (already noted by
   the time the tap landed, or the row number is out of range —
   defends against a stale row number if the Pending list changed
   underneath the user), returns `{ok:false, error:"..."}` with a plain
   -English message and changes nothing.
2. **Reads RawSMS (column K) and Sender (column L) fresh from the
   sheet** — never trusts the frontend to send these, same "always
   re-read what matters from the sheet itself" rule this codebase
   already follows everywhere else that counts (e.g.
   `saveTransactionNote` re-reads Mode/Reference itself rather than
   trusting the caller).
3. **Archives the full row** — appends every column, as-is, to
   `Transactions_Ignored` (auto-created if missing).
4. **Tries to learn a spam pattern** — only if RawSMS and Sender are
   both non-empty AND the normalized template is at least 20 characters
   long (see the guard below). If so, appends a row to
   `LearnedSpamPatterns`.
5. **Clears the row's cells in `Transactions` — in place, not deleted.**
   The data now lives in `Transactions_Ignored`; this row's cells go
   blank so it's permanently invisible to Pending/History, but its row
   number never changes and nothing below it moves. One cell is the
   exception: column P (Processed) is set to `"IGNORED"` — never blank,
   never `"YES"` — instead of being cleared like everything else. See
   "Why clear in place, and why the Processed tombstone" below for
   exactly why both of those choices matter; they were each found the
   hard way, by `change-reviewer`, before this shipped.
6. Returns `{ok:true, patternLearned: true|false}` — `patternLearned` is
   `false` when the text was too short/generic to safely learn from (see
   the minimum-length guard below), so the frontend can show an honest
   message instead of always promising "won't happen again."

## Why clear in place, and why the Processed tombstone

**Round 1 — don't delete the row.** The first version used
`sheet.deleteRow(row)`. `change-reviewer` caught this before ship: every
row number this whole app hands out (Pending's `row` field, History's
`row` field) is just "this transaction's current position in the
sheet" — deleting a row shifts every row below it up by one, so any
*other* Pending card or History entry already on screen, whose row
number was below the one just deleted, would silently start pointing at
the **wrong transaction**. A later Save on one of those could attach a
note/category/tag to a completely unrelated real transaction, with no
error shown. Fixed by clearing the row's cells in place instead
(`getRange(...).setValues(...)`) — same row number, nothing below it
moves.

**Round 2 — don't leave the row fully blank either.** `change-reviewer`
re-checked the fix and caught a second, more severe gap: Google Sheets'
`getLastRow()` reports "the last row that has ANY content" — if the
row being cleared happens to be the sheet's actual trailing row (nothing
below it), leaving every cell blank genuinely makes `getLastRow()` drop
by one. The separate `sms-parser-backend` project's `saveTransaction()`
always writes new transactions via plain `appendRow()`, which targets
"current last row + 1" — so a brand-new, completely real transaction
arriving right after could land on that exact same, just-recycled row
number. Since the cleared row already had `Processed = "YES"` (required
by this function's own pending-guard), `processNewTransactions()`'s own
row bookmark (`lastCheckedRow`, in `backend/transactions.js`) had
already moved past that row number — so the new transaction landing
there would never be scanned again: never marked Processed, never
pushed, never shown anywhere. Silent, total loss of a real transaction
— worse than the round-1 bug, and exactly the one failure mode this
whole SMS-ingestion subsystem exists to prevent.

Fixed by never letting the row go **fully** blank: column P is set to
the literal string `"IGNORED"` instead of being cleared too. That alone
guarantees the row always has content, so `getLastRow()` can never
shrink past it — while `"IGNORED"` still fails every existing
`processed !== "YES"` / `=== "YES"` check in this codebase exactly like
blank did, so visibility to Pending/History/Today/Analysis is completely
unaffected. It also doubles as a self-documenting trace for anyone
looking at the raw Sheet later, instead of an unexplained empty row.

`backend/tests/markNotATransaction.test.js`'s fake Sheets environment
was rebuilt to actually model this real `getLastRow()`/`appendRow()`
behavior (a naive "just count array length" fake could never have caught
round 2 — the bug is specifically about Sheets' real trailing-content
semantics). Test 8 proves the fix directly: marks the sheet's actual
last row as spam, confirms `getLastRow()` doesn't shrink, then simulates
a real `appendRow()` (mirroring `saveTransaction()`) and confirms the new
transaction lands in a fresh row, never recycled into the tombstoned one.

## `normalizeForFingerprint(text)` — the shared contract

```js
function normalizeForFingerprint(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<URL>")
    .replace(/\d+/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
}
```

Turns a raw SMS into a generalized "template" — strips the parts that
differ between two otherwise-identical messages (a link, a changing
number like an amount or a promo code) so two copies of essentially the
same promotional SMS, sent with two different amounts/links, still
normalize to the exact same template.

**This exact function exists independently in TWO places** —
`backend/PWA.js` (this project) and `sms-parser-backend/Code.js` (the
separate project that does the actual future-message matching). The two
Apps Script projects can't share code directly, so it's duplicated —
but both read/write the same shared `LearnedSpamPatterns` sheet on the
same spreadsheet, so **the two copies must produce byte-identical
output for the same input**. If they ever drift apart (someone tweaks
one copy's regex without the other), a pattern learned here could fail
to match the exact same message when the other project checks it later,
or vice versa. Any future edit to this function must be mirrored in
both files.

Note: `.toLowerCase()` runs *before* the URL/number replacements, so
the literal replacement text `<URL>`/`<NUM>` itself stays uppercase in
the output (e.g. `"Visit https://x.com now"` → `"visit <URL> now"`) —
this is the correct, intended contract, not a bug; the test file
verifies it explicitly so it's never "fixed" into a mismatch with the
other project's copy by accident.

## The minimum-length guard — why 20 characters

A normalized template that's too short/generic (e.g. a message that's
almost entirely digits/a link, leaving something like `"<NUM>"` or
`"click <URL>"` after normalizing) could coincidentally match a
completely unrelated future message — a real transaction confirmation
that happens to share that same short leftover text. Rather than risk
that, a template under 20 characters is skipped: the row is still
archived and removed from Pending either way (the user's immediate "get
this out of my way" result never depends on whether a safe learning
rule could be built from it), it just doesn't create an auto-ignore
rule for something too vague to trust.

## The safety invariant this whole feature depends on

**This is implemented entirely in the OTHER project
(`sms-parser-backend/Code.js`), not here — documented here too since
it's the core design guarantee the whole feature rests on.**

A learned pattern may **only ever affect a message the SMS parser has
already classified as `UNCERTAIN`** — it can never override a
confidently-detected real transaction (`TRANSACTION`) or a
confidently-detected non-transaction (`IGNORE`). In plain terms: even
if a learned pattern is ever wrong (too broad, matches something it
shouldn't), the worst case is a message that would have needed a human
glance anyway (`UNCERTAIN`) gets silently ignored instead — it can
never cause a real bank transaction to vanish. This is what makes it
safe to let the matching logic get more aggressive over time as more
patterns are learned, without that risk ever growing to touch real
money-tracking data.

## What's NOT built by this piece (see the other two projects' own status)

- The actual "does a new SMS match a learned pattern, so should it be
  silently ignored" check — lives in `sms-parser-backend/Code.js`,
  built separately (check that project's own notes/`CLAUDE.md` entry
  for its status).
- The "this isn't a real transaction" button itself — lives in
  `index.html`, built separately by `ui-ux-expert` (check its own
  status).

## Testing

`backend/tests/markNotATransaction.test.js` — loads the real
`backend/PWA.js` into a fake Google Sheets environment (same pattern as
`backend/tests/autoLogSaving.test.js`, but rebuilt to realistically model
`getLastRow()`/`appendRow()` — see "Why clear in place" above for why
that matters) and covers: the row is cleared/tombstoned in place in
`Transactions` and archived byte-identical in `Transactions_Ignored`;
other rows never shift position or change (Test 7 — the round-1
regression test); the sheet's `getLastRow()` never shrinks and a
subsequent real `appendRow()` never gets recycled into the tombstoned
row (Test 8 — the round-2 regression test, verified to actually fail
against the round-1-only fix before being trusted); `patternLearned`
is reported accurately; `LearnedSpamPatterns` gets a correctly
-normalized row when the text is long enough; `LearnedSpamPatterns` is
NOT written (but the row is still archived/tombstoned) when the
normalized text is under 20 characters; a row that already has a note is
rejected with a clear error and nothing changes; an out-of-range/
non-integer/missing row is rejected cleanly; `normalizeForFingerprint`'s
exact contract (lowercase-then-replace ordering, URL/number stripping,
whitespace collapsing, null/undefined safety). Full existing backend
suite (19 files) still passes.
