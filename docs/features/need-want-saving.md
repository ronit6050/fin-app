# Need / Want / Saving tagging (50/30/20 layer)

**Status: live.** Built, tested, wired into `getPending`/`saveNote` in `PWA.js`, and shown in the Pending screen — confirmed working on the real app 2026-08-08. Backend is now clasp-synced (`D:\fin-app\backend`, see CLAUDE.md), so `needWantSaving.js` is real, current code, not just this description.

Not yet built: anywhere that actually *shows* the Need/Want/Saving breakdown (a 50/30/20 summary view). Right now this feature only collects the tag and the votes — nothing reads them back yet.

## What this feature is

Every genuine spending transaction gets tagged **Need**, **Want**, or **Saving**, so the app can eventually show a 50/30/20-style budget breakdown. This sits on top of the existing category system (Food, Bills, etc.) but is a separate concept — category answers "what kind of thing was this," this answers "was this necessary, discretionary, or money set aside."

## Why it's NOT a fixed category -> type table

The first design attempt was a lookup table (e.g. "Transport = Need", "Food = Want"). Rejected — same category can genuinely be either depending on context:
- A cab ride can be a commute (Need) or a night out (Want).
- A grocery-delivery app order is usually Need, but an occasional ice-cream order from the same app is a Want.
- Financial category alone doesn't say if it's an EMI (Need) or a SIP (Saving).

No category is ever hardcoded to a type. Instead, the system learns per merchant from your own corrections, the same self-learning philosophy already used for category suggestions (see `SmartMemory`).

## Rules, in order

1. **`Transactions.Type = credit`** -> no tag at all. Money coming in (salary, a friend repaying you, a refund) is never "spending."
2. **`Category = Lent`** (or any other debt-settlement-linked category) -> no tag. It's a transfer you expect back, not consumption.
3. **`Category = Other`** (the category engine itself couldn't recognize the counterparty — likely an unrecognized personal UPI transfer) -> no confident default shown. Just ask, every time. Guessing here would train distrust of the suggestion everywhere else.
4. **Everything else** (a genuine, recognized spend) -> look up `Counterparty + AmountBand` in the new `TypeMemory` sheet and suggest whichever of Need/Want/Saving has the most recorded votes for that combination.

## Why "merchant + amount band," not just merchant

A merchant alone is too coarse — e.g. BigBasket is *usually* a Need (grocery run) but *occasionally* a Want (a treat). Splitting by amount range lets the same merchant hold two independently-learned patterns: its typical large-order range and its rare small-order range each vote separately, without any hardcoded split.

Amount bands (fixed, simple, no per-merchant statistics needed):
- Small: < ₹200
- Medium: ₹200–999
- Large: ₹1000–4999
- XLarge: ₹5000+

## Why vote-counting, not a single "confidence score"

The existing `SmartMemory` category memory stores one value + one confidence number per merchant. That design is what let a single bad or unusual entry silently overwrite or pollute the learned answer (see the 2026-08-08 SmartMemory cleanup in CLAUDE.md). `TypeMemory` avoids that: it keeps a running count for **each** of Need/Want/Saving per merchant+band. Every confirm/correction adds one vote; nothing is ever overwritten. One odd ice-cream order from BigBasket just becomes `Want: 1` sitting next to `Need: 18` — it doesn't flip the suggestion, and it's still recorded truthfully.

## Cold start (a merchant+band combo seen for the first time, zero votes)

Defaults to **Need** — a single neutral fallback, not category-based, so no category-to-type assumption sneaks back in through the back door. This only matters for the first transaction in that merchant+band bucket; after you confirm or correct it once, real votes take over.

## `TypeMemory` sheet schema

New sheet, independent of `SmartMemory` (no shared columns, no risk to existing category logic):

| Column | Meaning |
|---|---|
| Merchant | Counterparty name, same key `SmartMemory` uses |
| AmountBand | Small / Medium / Large / XLarge (see above) |
| NeedCount | Votes for Need |
| WantCount | Votes for Want |
| SavingCount | Votes for Saving |
| TimesUsed | Sum of the three counts, for quick reference |
| LastUsed | Timestamp of the last vote |

## Functions

New Apps Script file `needWantSaving.js`, written 2026-08-08, **not yet wired into `pwa.gs`** — exists standalone so the logic can be tested in the Apps Script editor before anything user-facing depends on it.

```javascript
// needWantSaving.js
// Self-learning Need/Want/Saving suggestion engine. See
// docs/features/need-want-saving.md in the PWA repo for the full design
// and reasoning — this file only has short comments, that doc is the
// source of truth.

// Buckets an amount into one of four fixed ranges. Used as part of the
// TypeMemory lookup key, so the same merchant can have separately-learned
// patterns for its usual purchase size vs an unusual one.
function getAmountBand(amount) {
  amount = Number(amount) || 0;
  if (amount < 200) return "Small";
  if (amount < 1000) return "Medium";
  if (amount < 5000) return "Large";
  return "XLarge";
}

// Returns "Need" / "Want" / "Saving", or null if this transaction
// shouldn't be tagged at all (not a real spend, or too ambiguous to guess).
function getSuggestedType(txnType, category, counterparty, amount) {
  // Rule 1: money coming IN is never a spend.
  if (txnType === "credit") return null;

  // Rule 2: money lent out (or other debt-settlement categories) isn't
  // spending either — it's a transfer you expect back.
  var excludedCategories = ["Lent"];
  if (excludedCategories.indexOf(category) !== -1) return null;

  // Rule 3: the category engine itself couldn't recognize this
  // counterparty — likely an unrecognized personal transfer. Don't guess.
  if (category === "Other") return null;

  // Rule 4: look up how this merchant+amount-band has voted before.
  var band = getAmountBand(amount);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("TypeMemory");
  var data = sheet.getDataRange().getValues();
  // Columns: Merchant(0) AmountBand(1) NeedCount(2) WantCount(3) SavingCount(4) TimesUsed(5) LastUsed(6)
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === counterparty && data[i][1] === band) {
      var counts = { Need: data[i][2], Want: data[i][3], Saving: data[i][4] };
      var best = "Need"; // tie-break / all-zero default
      if (counts.Want > counts[best]) best = "Want";
      if (counts.Saving > counts[best]) best = "Saving";
      return best;
    }
  }

  // Never seen this merchant+band combo before — neutral cold-start
  // default. Deliberately NOT based on category, so no category-to-type
  // assumption sneaks back in. Gets replaced by real votes after one use.
  return "Need";
}

// Records one vote for chosenType against this merchant+band combo.
// Called after the user confirms or corrects the tag in Pending.
function recordTypeVote(counterparty, amount, chosenType) {
  var band = getAmountBand(amount);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("TypeMemory");
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === counterparty && data[i][1] === band) {
      var rowNum = i + 1; // sheet rows are 1-indexed; row 1 is the header
      var colIndex = { Need: 3, Want: 4, Saving: 5 }[chosenType]; // C/D/E
      var currentCount = sheet.getRange(rowNum, colIndex).getValue();
      sheet.getRange(rowNum, colIndex).setValue(currentCount + 1);

      var timesUsed = data[i][2] + data[i][3] + data[i][4] + 1;
      sheet.getRange(rowNum, 6).setValue(timesUsed); // TimesUsed
      sheet.getRange(rowNum, 7).setValue(new Date()); // LastUsed
      return;
    }
  }

  // First time seeing this merchant+band combo — add a new row.
  var newRow = [counterparty, band, 0, 0, 0, 1, new Date()];
  var typeColIndex = { Need: 2, Want: 3, Saving: 4 }[chosenType]; // 0-indexed
  newRow[typeColIndex] = 1;
  sheet.appendRow(newRow);
}
```

## Open items / not yet decided

- Whether `Category = Other` should ever get a type once the user manually assigns a real category in the same Pending action (order-of-operations question, revisit once UI is wired up).
- Whether more categories besides `Lent` should be treated as debt-settlement-excluded — revisit once real usage surfaces examples.
