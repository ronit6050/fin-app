# Note-word auto-fill, "Not sure", and "Mark as..." (2026-10-11)

## What it does, in plain words
On a Pending card, the **Need / Want / Saving** choice now fills in by itself when the
words in the note have a clear track record in YOUR own history. Example: you have
tagged "tea" as Want 63 of 64 times, so a note of "Tea" shows **Want** selected and a
one-line reason ("Filled in Want because you've tagged "tea" that way 63 of 64 times.
Tap another to change it."). Two more controls on the same card:
- **Not sure**: saves the payment with no Need/Want tag and teaches the app nothing
  (so a guess can never pollute its memory). For genuinely mixed words like "lunch".
- **Mark as EMI, Rent, SIP or Saving...**: a manual way to set the same Financial
  Event the confirm chips set when the app guesses. EMI asks for a name (e.g. "Laptop
  EMI"), SIP picks from the instrument list, Rent and Saving are one tap. Undo available.
  Credits and wallet/card-bill transfers do not get this link.

## How it works
- `backend/noteWordModel.js` (pure logic): `buildNoteTypeModel_(txnData)` builds
  `{ word: { Need: n, Want: n, Saving: n } }` from rows YOU tagged (column Q) with a note,
  debits only, only from 2026-08-11 (`NOTE_TYPE_MODEL_SINCE_`, when tagging became
  reliable), only words used 3+ times. Investment tags are not learned (the card does not
  offer that choice any more). `explainNoteWordPrediction_` returns `confident` / `mixed` / null.
- Rules (same as the category word model): a word votes only with 3+ uses AND 90%+
  agreement; the answer with most votes wins; a tie is no answer; mixed words are
  reported with their counts.
- The table travels with `getPending` (`noteWordModel`) and the dashboard
  (`full.noteWordModel`, so the Fast screens have it). The PHONE does the lookup live as
  you type (`predictNoteType` in `index.html`); `backend/tests/noteTypeModel.test.js`
  extracts that code and proves it gives the same answer as the server's version.
- Priority on the card: your own tap > a confident note-word answer > the older per-shop
  guess (`suggestedType`) > nothing. The app never overrides a tap or a Not sure.
  A mixed word leaves the older per-shop guess alone and just shows the counts.
- The notification's Confirm button uses the same table for its Need/Want
  (`getQuickConfirmSuggestion`, last parameter); a mixed word changes nothing there.

## Learning rules (unchanged principle)
It learns only from payments where YOU pressed Save with a note and a tag. An auto-filled
tag you accept by pressing Save counts as your confirmation (you saw it and kept it);
if you change it, your correction is what counts. Not sure writes no tag, so it teaches
nothing. Old rows before 2026-08-11 teach nothing.

## Known limits / ideas
- A lazily accepted wrong auto-fill can reinforce itself a little; the 90% bar and the
  "mixed" detection limit this. A recency window could be added later if it shows up.
- The table is rebuilt from the whole sheet on each `getPending` (cheap, ~1k rows).
- Demo Mode has no table, so the feature is simply inactive there.
- Planned next: answer from the notification with the top two guesses; a native-app
  widget / inline-reply notification (see CLAUDE.md "automation pipeline").
