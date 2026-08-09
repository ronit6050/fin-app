# Note Memory (remembered note suggestions)

**Status: live**, shipped 2026-08-09.

## What this is

The note field on a Pending transaction used to just start pre-filled
with the merchant's raw name (e.g. "SWIGGY INSTAMART") — better than
empty, but not an actual suggestion. Note Memory learns the notes you
actually type per merchant + amount, so a returning merchant can
suggest the note itself (e.g. "dinner"), not just its own name.

## Why it needed to handle two very different cases

The user pointed out notes behave differently depending on who the
counterparty is:
- **A recurring shop/restaurant** — the note is usually consistent
  ("lunch", "dinner") across many visits.
- **A person** (e.g. sending a friend money) — the reason is often
  different every time, except when it genuinely repeats (a monthly
  rent split, a recurring subscription split, etc.).

Rather than special-casing "is this a business or a person" (fragile —
would need name-pattern guessing), this is solved with a single rule:
**only suggest a note once you've used the exact same note for this
merchant + amount band at least twice.** A restaurant note clears that
bar fast since it repeats often. A one-off note to a friend never
clears it and nothing gets suggested (falls back to showing the
merchant/person's name, same as before) — but a genuinely recurring
reason to the same person (paid the same way, same amount range, more
than once) correctly does get suggested, which is the right behavior.

## Why merchant + amount band, not just merchant

Reuses the same `AmountBand` concept `TypeMemory` already established
(see `docs/features/need-want-saving.md`) via the existing
`getAmountBand()` in `needWantSaving.js` — Apps Script shares one global
scope, so no need to duplicate it. The same merchant can have
genuinely different notes at different amounts (e.g. paying a friend
₹500 for "movie" vs ₹5000 for "rent") — splitting by band keeps those
independently learned instead of one overwriting the other.

## Why "no AI call" — deliberately

Like `getSuggestedCategoryFast` (bulk category guesses in Pending),
this never calls Gemini. It only reads what you've actually typed
before. Guessing a plausible-sounding note with AI would be slower and
cost more per item — bad with a large Pending backlog — and less
trustworthy than something built entirely from your own real history.

## `NoteMemory` sheet schema

New sheet, auto-created by the code the first time it's needed (same
pattern `AILogs` already uses in `Logger.js`) — no manual sheet setup
required.

| Column | Meaning |
|---|---|
| Merchant | Counterparty name, same key `SmartMemory`/`TypeMemory` use |
| AmountBand | Small / Medium / Large / XLarge |
| Note | The note text, as originally typed |
| TimesUsed | How many times this exact merchant+band+note combo has been saved |
| LastUsed | Timestamp of the last time it was saved |

One row per distinct **(merchant, band, note)** combination — unlike
`SmartMemory`/`TypeMemory`, which key on merchant(+band) alone, this
needs to track several different note variants per merchant so the
most-used one can be picked, not just the most recent.

## Functions

New file `noteMemory.js`:
- `getNoteMemorySheet()` — returns the sheet, creating it with headers
  if it doesn't exist yet.
- `getSuggestedNote(counterparty, amount, noteMemoryData)` — returns the
  most-used note for that merchant+band if it's been used at least
  `NOTE_CONFIDENCE_MIN_USES` (2) times, else `""`. `noteMemoryData` is
  optional — pass an already-read sheet range when checking many
  transactions in a row (same batching reasoning as `getSuggestedType`).
- `recordNoteUsage(counterparty, amount, note)` — increments the count
  for that merchant+band+note combo, or adds a new row the first time.

Wired into `PWA.js`:
- `getPendingTransactions` now reads `NoteMemory` once (same
  batch-read pattern as `SmartMemory`/`TypeMemory`) and adds a
  `suggestedNote` field to each pending item.
- `saveTransactionNote` calls `recordNoteUsage()` whenever a real note
  and counterparty are both present — fires on every save, whether from
  Pending or a History edit, same as category/type learning already do.

## UI

`buildPendingItem` in `index.html` now prefers `txn.suggestedNote` for
the note field's starting value, falling back to `txn.counterparty`
(the old behavior) when there's no confident suggestion yet. History's
note field is untouched — it already shows the real saved note, not a
suggestion.
