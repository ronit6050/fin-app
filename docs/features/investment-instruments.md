# Investment Instruments — a fixed, named list replaces free-typed "Type"

**Status: backend built and pushed to the Apps Script editor
(`clasp push`, 2026-08-11) — NOT yet deployed to the live app** (needs
`clasp deploy`, which needs the user's go-ahead in-conversation — see
CLAUDE.md's deploy rule). **Frontend now wired up (`index.html`,
2026-08-11)** — see "Frontend — what actually shipped" below for the
real, built result (the old "Frontend contract"/"Frontend hide-toggle"
sections above stay as-is, since the frontend pass followed that brief
as written). The one-time migration function
(`migrateInvestmentsToNamedInstruments`) has also **not been run yet**
— needs the user to run it once from the Apps Script editor after
deploying.

## Frontend — what actually shipped (2026-08-11, `index.html` only)

Built by the `ui-ux-expert` subagent, following the "Frontend contract"
and "Frontend hide-toggle" briefs above almost exactly as written — no
real deviations from the backend contract were needed. One interactive
mockup (Investments tab cards + the two note-based chip shapes) was
shown via the visualize tool first, per this project's "show before
building" rule, then the real code followed it closely.

**1. Investments tab (More → Investments)** — the flat "Breakdown" list
is now grouped into up to 4 card sections, in the fixed SIP/One-time
Fund/Stock/Gold order, reusing the exact `.settings-group`/
`.settings-group-title` card style Settings already established
2026-08-11 (rather than inventing a new heading style) with
`.category-row`/`.category-bar-fill` rows inside each — same look
Analysis/Savings/CC Advisor already use. Each instrument's progress bar
is relative to the largest amount **within its own group**, not the
overall largest, so a small Stock holding doesn't look artificially
tiny next to a much bigger SIP total. An entry whose category doesn't
match any of the 4 (shouldn't normally happen) gets its own small
"Other" group instead of silently vanishing from the screen.

**2. "+ Log an Investment" form** — the free-typed "Type" text box is
gone; replaced with a dropdown (`<optgroup>` per category, in the same
fixed order) sourced from `getInvestmentInstruments`, plus a trailing
"+ Add new instrument..." option that reveals an inline name + category
mini-form, calls `addInvestmentInstrument`, and re-selects the new
instrument on success — no page reload, no navigating away.

**3. SIP naming (Financial Event flow)** — `buildFinancialEventHtml`'s
nameable-type branch (~line 2810) now special-cases `feType ===
"Investment"`: instead of the free-text box, it renders the same
instrument-picker dropdown as everywhere else. **EMI naming was left
completely untouched** — still free text, exactly as before, per the
brief's explicit scope. `setupFinancialEventField`'s confirm-button
handler now checks which of the two (`.fe-emi-name-input` text box vs
the instrument `<select>`) is actually present on the card, and reads
whichever one is there — never both, since only one of the two ever
renders for a given card.

**4. Note-based investment chip (Pending + History)** — two new
functions, `buildInvestmentChipHtml`/`setupInvestmentInstrumentField`,
deliberately kept separate from the Financial Event chip functions
(different trigger source — note text vs amount — per the backend doc
above). Confident match → a pre-selected Yes/No chip (mirrors a
confident Financial Event chip already starting pre-selected).
"Looks new" → the instrument picker + a confirm/no chip, never
pre-selected. In Pending this is almost always inert (empty note), and
becomes meaningful once the same transaction is visited in History —
exactly as the backend doc predicted.

**5. Toggle hide-wiring** — `wireLendingAwareToggle` gained the
documented 5th parameter, `isInvestmentInstrumentSelected`, OR'd into
the same `hide` expression. Both Pending's `buildPendingItem` and
History's `buildHistoryItem` now track the investment-instrument
selection the same way they already track the Financial Event
selection (`setupInvestmentInstrumentField(card, initialName,
onChange)`, called right after `setupFinancialEventField`, before
`wireLendingAwareToggle`), and pass a getter for it as the 5th
argument — never a second, parallel show/hide mechanism, per the
brief. `saveNote`'s payload in both screens now also sends
`investmentInstrument`.

**A real bug found and fixed during this pass, not flagged in the
original brief:** the investment chip's wrapper div was originally
given both the `field` and `fe-field` CSS classes (to reuse
`.fe-field`'s label styling) — but `setupFinancialEventField` finds its
own field with `card.querySelector(".fe-field")`, which only returns
the FIRST match. On a card with an investment-chip suggestion but NO
Financial Event suggestion (`feHtml === ""`), that query would have
silently grabbed the investment chip's div instead, double-wiring
`setupFinancialEventField`'s own click handlers onto the investment
chip's buttons alongside `setupInvestmentInstrumentField`'s real ones.
Traced through the actual values involved (the investment buttons only
carry a `data-inv` attribute, never `data-fe`) and confirmed this
particular collision would have stayed silently harmless rather than
visibly breaking anything — but it was still a fragile, easy-to-trip
landmine for the next change in this area, so it was removed at the
source: the investment chip's wrapper no longer carries the `fe-field`
class at all (`.field` plus the app's normal `label` styling already
looks identical — `.fe-field` added nothing visually beyond what those
two already provide).

**A second gap found by `change-reviewer` (not the original frontend
pass) and fixed the same day:** `saveTransactionNote`'s response already
honestly reports `investmentLogged: true/false` — at the time, `false`
meant `autoLogInvestment`'s duplicate-avoidance guard had decided a
confirmed investment looked like a near-duplicate of a row already in
`Investments` — but the first version of this frontend pass never read
that field, so both save handlers just said "Saved." either way,
silently hiding a real investment that never actually landed in the
Investments total. Fixed in both places it can happen, in the same
spirit as the existing `typeRequested`/`typeSaved` transparency pattern
this project already uses for other silent-skip risks:

**Superseded later the same day — see "Fixed 2026-08-11 — duplicate
check removed for note-matched confirms" further below.** The
underlying cause this messaging was built for (the duplicate guard
silently skipping a note-matched confirm) was removed at the backend
level once `change-reviewer` and `ui-ux-expert` both flagged it as the
wrong trust level for an explicit human confirm. The messaging below is
now believed to be practically unreachable for this specific path — not
deleted, kept as harmless defense-in-depth for now, see that section for
the full reasoning and the open call on whether to remove it.

- **History (`buildHistoryItem`)** — has a persistent per-card result
  line, so this was direct: if an `investmentInstrument` was sent and
  `investmentLogged === false` comes back, the message becomes "Saved,
  but this wasn't logged to Investments (looks like a duplicate of
  something already there) — check the Investments tab." instead of
  the generic "Saved."
- **Pending (`buildPendingItem`)** — harder, because Save here is
  optimistic (the card is already removed from the screen and the DOM
  the instant you tap Save, before the response comes back — see that
  handler's own comment). By the time `investmentLogged: false` arrives
  there's no card left to show a message on, and re-inserting it via
  the existing `restoreAfterFailedSave` path would be actively
  misleading (the note/category/type genuinely DID save — only the
  Investments-sheet write specifically didn't). No toast/banner
  mechanism existed anywhere in this app before this fix — added the
  smallest one that fit: a small dismissible banner
  (`#pendingInvestmentNotices`, `showPendingInvestmentNotice()`) above
  the Pending list, scoped to this one screen rather than a new
  app-wide notification system. Deliberately manual-dismiss only, no
  auto-hide timer — an auto-hide could expire before you've even
  switched back to the Pending tab to see it, which would defeat the
  entire point. Each call adds its own line (not a single slot that
  gets overwritten) so saving several duplicates back-to-back — rare,
  but possible — doesn't silently drop an earlier warning.

**Verification note:** this environment's browser preview pane could
render the app's full DOM (confirmed via the accessibility tree — the
new Investments picker, its "+ Add new instrument" mini-form, and every
other screen all present and correctly structured) and reported a clean
console in both a light and dark `prefers-color-scheme` emulation and
at a mobile viewport, but — as previously documented in CLAUDE.md — it
could not composite/screenshot in this session, so no pixel-level visual
confirmation happened. The syntax of both inline `<script>` blocks was
also directly checked with `node --check` (extracted from the real
file, not retyped), and the `<style>` block's braces were confirmed
balanced. The new Pending/History note-based chip specifically could
not be exercised with real signed-in data (would need real Google
sign-in, which this session correctly did not attempt) — real on-device
confirmation of that one piece specifically is still owed, same as any
other change flagged this way in this project's history.

## Plain-English summary

Before this: the Investments tab (More → Investments) let you type
anything you wanted as the "Type" of an investment — so the exact same
mutual fund could show up as "Nifty 50" one time and "Nifty 50 SIP"
another, and the app would treat those as two completely different
investments in the breakdown, splitting up money that's really all in
one place.

After this: you pick from a fixed list of your 15 real investments
(3 SIPs, 6 one-time funds, 5 stocks, 1 gold instrument) instead of
typing anything freehand. Every rupee logged against "HDFC Nifty 50
Index Fund" always uses that exact same name, so the totals are always
right. This mirrors the same fix already done for Savings (the `Goals`
sheet replacing free-typed wish-list items — see
[savings-v2.md](savings-v2.md)), applied here to Investments.

## New sheet: `InvestmentInstruments`

Auto-created (and seeded) the first time anything asks for it —
`getInvestmentInstrumentsSheet_()` in `backend/investmentInstruments.js`,
same "auto-create if missing" pattern as `getFinancialEventsSheet()`
(`financialEvents.js`). Unlike that sheet, this one also seeds the real
15-instrument list at creation time, since nothing in this feature
(matching, the manual-log picker, etc.) is useful without it.

| Column | Meaning |
|---|---|
| Name | The exact instrument name — e.g. "HDFC Nifty 50 Index Fund". Every write path (manual log, edit, auto-log from a note match) is validated against this list, so this is always the exact spelling used everywhere else, including the `Investments` sheet's own `Type` column. |
| Category | One of `"SIP"`, `"One-time Fund"`, `"Stock"`, `"Gold"`. |
| SipAmount | Only meaningful when Category is `"SIP"` — the recurring monthly amount. Blank for the other 13 instruments. |

### The 15 real instruments (confirmed by the user 2026-08-11, exact names — do not alter)

**SIP** (recurring, matched by amount — see "Why SIPs are handled
differently" below):
- HDFC Nifty 50 Index Fund — ₹3,000/month
- HDFC Mid Cap Fund — ₹4,000/month
- Bandhan Small Cap (Money2Mgt SIP) — ₹2,000/month

**One-time Fund:**
- Motilal Oswal Flexi Cap
- HDFC Gold ETF Fund
- Bandhan Small Cap
- ICICI Prudential
- HDFC Silver ETF
- Motilal Oswal Midcap

**Stock:**
- Tata Motors Commercial
- Tata Steel
- LIC
- HDFC Bank
- Tata Motors Passenger

**Gold:**
- Digital Gold

## Why SIPs are handled differently from the other 12

A SIP is a recurring, near-fixed-amount payment (the same ₹3,000 every
month, say) — so it's recognized **by amount**, reusing the exact same
mechanism Rent/EMI already use (`matchRecurringNamedEvent`,
`financialEvents.js`), via a row in `FinancialEvents`.

A one-time fund purchase, a stock buy, or a gold purchase has no fixed
amount — every purchase is a different, irregular figure. So those 12
are instead recognized **by note text** — the user typing a known name
(or "stock"/"shares") directly into the transaction's note. This is a
genuinely separate mechanism (`matchInvestmentInstrumentByNote`, see
below), deliberately **not** reusing amount-matching: mixing the two
would risk a real mistake, e.g. a ₹3,000 stock purchase accidentally
amount-matching the ₹3,000 Nifty 50 SIP and getting silently
mis-attributed to the wrong investment. Confirmed with the user
2026-08-11 as the reason this needed its own code path instead of a
generalization of the EMI/Investment amount matcher.

## Note-text matching — `matchInvestmentInstrumentByNote(note, instrumentsData)`

`backend/investmentInstruments.js`. Checks a transaction's note against
each of the 12 non-SIP instrument names — **whole-phrase, case-
insensitive, word-boundary matching**, not a plain substring check. This
matters: a short name like "LIC" as a bare substring would also match
inside "pUBLIc" or "poLICy" — same bug class already found and fixed
once for the word "lent" matching inside "excellent"/"silent"/"talent"
(see `needWantSaving.js`'s `isLendingTransfer`). Matching the FULL
instrument name (not just its first word) also means "Tata Steel" and
"Tata Motors Commercial" can never be confused with each other, even
though they share the word "Tata" — verified directly in the Node test.

Returns one of three shapes:
- `{ type:"Investment", name:"<exact name>", confident:true }` — a
  known instrument was recognized in the note.
- `{ type:"Investment", name:null, confident:false }` — the note
  contains a standalone "stock"/"shares" mention but no specific known
  name — "looks like a new one, but which?"
- `null` — nothing investment-related in the note at all.

This mirrors the existing `{type, name, confident}` shape
`suggestFinancialEvent` (`financialEvents.js`) already uses, for
frontend consistency — but it's a genuinely separate function, never
called from or consulted by `suggestFinancialEvent`.

## Frontend contract (for the next UI pass — `index.html` untouched so far)

### New/changed actions

| Action | Request fields | Response |
|---|---|---|
| `getInvestmentInstruments` | *(none, besides `idToken`)* | `{ ok:true, instruments:[{name, category, sipAmount}], grouped:[{category, instruments:[...]}] }` — `grouped` is in a fixed order: SIP, One-time Fund, Stock, Gold. |
| `addInvestmentInstrument` | `name`, `category` (must be one of `"SIP"`/`"One-time Fund"`/`"Stock"`/`"Gold"`) | `{ ok:true, name, category }` or `{ ok:false, error }` (blank name, invalid category, or already exists). |
| `logInvestment` | `amount`, **`instrumentName`** (renamed from the old free-typed `type` field) | `{ ok:true }` or `{ ok:false, error }` — rejects if `instrumentName` isn't in `InvestmentInstruments`. |
| `updateInvestment` | `row`, **`instrumentName`** (renamed from `type`), `amount` | `{ ok:true }` or `{ ok:false, error }` — same validation as above. |
| `getInvestments` | *(unchanged)* | `{ ok:true, investments: { total, breakdown:[{type, amount, **category**}], recent:[...] } }` — **new**: each `breakdown` entry now also carries `category` (looked up from `InvestmentInstruments`), so the frontend can group/label the breakdown into sections ("SIPs" / "One-time Funds" / "Stocks" / "Gold") without a second call. `null` if the name somehow isn't found in the instruments list (shouldn't normally happen once every write path is validated). |

### New fields on `getPending` / `getTransactionHistory`

Both now return, per transaction (mirroring the existing
`suggestedFinancialEvent`/`suggestedFinancialEventName`/
`financialEventConfident` fields, but for the separate note-match
mechanism above):

- `suggestedInvestmentInstrument` — the recognized instrument name, or
  `null`.
- `investmentInstrumentConfident` — `true` if a known name was
  recognized (safe for a one-tap confirm chip).
- `investmentInstrumentLooksNew` — `true` if the note mentions
  "stock"/"shares" but no specific known name (should show a "which
  one?" name-it prompt instead of a confirm chip).

**Why three fields instead of reusing the `name === null` convention
`suggestedFinancialEventName` uses:** for Financial Events, a `null`
name always means "this IS a recognized EMI/Investment, but doesn't
have a name yet" — there's always a real signal. Here, a `null` name is
genuinely ambiguous between "nothing investment-related at all" and "an
unnamed new stock/fund" — so `investmentInstrumentLooksNew` makes that
distinction explicit instead of overloading `null`.

In Pending, these will always be "nothing to show" (`note` is empty
there by definition — nothing typed yet) — same inherent limit
`isLendingTransfer`/`isSavingsNote`/`suggestFinancialEvent` already
have in Pending. They become meaningful in History, where a real note
already exists.

### New `saveNote` parameter: `investmentInstrument`

`saveTransactionNote(row, note, category, counterparty, type, amount,
financialEvent, financialEventName, debtPerson, investmentInstrument)`
— one new parameter, `investmentInstrument`. When present and it
validates against `InvestmentInstruments`, the transaction's own amount
and date get logged into the real `Investments` sheet (via the existing
`autoLogInvestment`). **Updated 2026-08-11 — see "Fixed 2026-08-11 —
duplicate check removed for note-matched confirms" below**: this call
passes `skipDuplicateCheck:true`, so — unlike the Financial Event
Investment path just above, which still uses the duplicate-avoidance
guard — a note-matched confirm always logs.

**Design decision, confirmed by the user 2026-08-11 (resolved — see
"Fixed 2026-08-11" below for the version of this decision that shipped
first and was corrected the same day):** this is deliberately
**separate** from the `financialEvent`/`financialEventName` parameters
and the `Transactions` sheet's `FinancialEvent` columns (R/S) — a
note-recognized stock/fund purchase (e.g. "Tata Steel shares") is
**still real spend** for Category and total-spend purposes (unlike
Rent/EMI/a SIP, it's not excluded from `Total Spend`, and Category is
still asked/saved normally). The only effect of `investmentInstrument`
on the `Transactions` row itself is that **Need/Want/Saving (column Q)
is skipped** — same reasoning already applied to Rent/EMI/Investment
Financial Events and to Lending: buying a stock/fund isn't a
Need-vs-Want-vs-Saving decision either. Separately, `investmentInstrument`
also causes a row to be appended to the `Investments` portfolio tracker,
so the same money shows up in both places: once as a real bank debit in
your spend history (with Category, but no Need/Want/Saving answer), and
once as a holding in your Investments dashboard.

## Fixed 2026-08-11 — Need/Want/Saving was still being asked (now skipped)

**What shipped first, same day:** the initial version of this feature
treated a note-matched investment as ordinary spend for BOTH Category
*and* Need/Want/Saving — so after confirming "yes, this is my Tata
Steel purchase," the app would still ask Need/Want/Saving for it, the
same way it would for a restaurant bill. Flagged explicitly as an open
judgment call in this doc at the time (not a bug — a genuine design
choice made without the user's input yet), specifically so it could be
revisited once seen in context.

**Resolved the same day:** the user decided Need/Want/Saving should be
skipped, matching every other non-spending-decision case already in the
app (Rent, EMI, a confirmed SIP Financial Event, and Lending). Category
and the spend total are UNCHANGED by this fix — only the Need/Want/
Saving question is newly skipped.

**Backend fix** (`PWA.js`, `saveTransactionNote`): a new local variable
`investmentInstrumentValid` is set to `true` only when
`investmentInstrument` was provided AND validated successfully against
`InvestmentInstruments` (via `validateInvestmentInstrumentName_`) —
deliberately NOT based on whether the row actually got logged
(`investmentLogged`), since `autoLogInvestment`'s duplicate-avoidance
guard can skip the actual sheet write while the transaction is still,
conceptually, a confirmed investment purchase (same "confirmed either
way" reasoning the Financial Event block already uses for
`effectiveFinancialEvent`). The column-Q write condition is now:

```js
if(type && !isLendingTransfer(counterparty, note) && !effectiveFinancialEvent && !isNonSpendTransfer && !investmentInstrumentValid){
  sheet.getRange(row, 17).setValue(type); // column Q
  typeSaved = true;
  ...
}
```

Same transparency pattern as every other silent-skip fix in this
project (see CLAUDE.md's 2026-08-10 "lent inside excellent" and
"wallet-mode counterparty" history) — the response's `typeSaved` field
tells the caller whether the answer was actually saved, separately from
`typeRequested` (whether one was sent). A caller that sends `type` along
with a valid `investmentInstrument` will get back `typeRequested:true,
typeSaved:false` — never a silent, unexplained drop.

**Frontend follow-up needed (not done here — `index.html` untouched, see
"Frontend hide-toggle" below for the exact brief).**

The response now also includes `investmentLogged: true/false`, same
transparency spirit as the existing `typeSaved`/`typeRequested` fields
(added after the 2026-08-10 silent-skip bugs) — never trust a save as
fully complete without checking the field that actually says so.

## Fixed 2026-08-11 — duplicate check removed for note-matched confirms

**Resolves the "Recommendation for a possible `backend-agent` follow-up"
item that used to sit under "Open items" below** — flagged 2026-08-11 by
`change-reviewer` during the frontend pass, and independently raised
again by `ui-ux-expert` for the same reason: `autoLogInvestment`'s
"likely duplicate" guard (`hasLikelyDuplicateInvestment` —
`financialEvents.js`, a similar amount within ±3 days silently skips the
write) was originally shared by BOTH call sites — the Financial
Event/SIP auto-log AND the note-matched `investmentInstrument` confirm.
That guard makes sense for the Financial Event/SIP path: a SIP is
detected automatically (by amount, no human confirming this SPECIFIC
transaction is really that SIP), so it genuinely could double-count
money already typed in by hand before this feature existed. It does
NOT make sense for the note-matched confirm: that's already an
explicit, one-tap HUMAN decision — the same trust level as the manual
"+ Log an Investment" form, which has no duplicate check at all.
Silently dropping a real, just-confirmed purchase (e.g. two genuine
top-ups of the same stock a couple of days apart, or — concretely, per
`change-reviewer`'s original note — a real ₹5,000 buy landing within 3
days of the migration's four ₹5,000 "Starting Balance" seed rows) did
more harm than good.

**Fix:** `autoLogInvestment(dateStr, name, amount, note,
skipDuplicateCheck)` (`financialEvents.js`) gained an optional 5th
parameter, default `false`/undefined — every EXISTING call is
unaffected. `saveTransactionNote`'s `investmentInstrument` block
(`PWA.js`) now passes `true`. The Financial Event/SIP call site
(same function, same file, a few lines above) was deliberately left
completely unchanged — still always checks for a duplicate.

**Is `investmentLogged: false` still reachable for the note-matched
path? Practically, no — checked carefully, not assumed.** With the
duplicate check skipped, `autoLogInvestment` has exactly one remaining
way to return `{logged:false}`: the `Investments` sheet itself doesn't
exist (`{logged:false, reason:"no sheet"}`). In this app, `Investments`
is a core, always-present sheet — it's never auto-created the way
`FinancialEvents`/`TypeVotes`/`InvestmentInstruments` are, and every
other function in this project already assumes it exists. So under any
realistic real-world condition, a validated `investmentInstrument` will
now always report `investmentLogged: true`. This means the frontend
messaging built for the `investmentLogged === false` case on THIS
specific path — History's "Saved, but this wasn't logged to Investments
(looks like a duplicate...)" message, and Pending's dismissible banner
(`showPendingInvestmentNotice`) — is now **effectively unreachable
dead code for this path specifically** (not for the app in general —
nothing else changed). Recommend leaving it in place as harmless
defense-in-depth (the "sheet somehow missing/renamed" edge case is
still real, if extremely unlikely, and the messaging costs nothing to
keep) rather than removing it purely for cleanliness — but this is a
product call, not a technical one, and the user may prefer it removed.
Not touched either way as part of this fix — flagged here for the
decision to be made deliberately, not by default.

Verified with `backend/tests/autoLogInvestmentDuplicateSkip.test.js` —
see "Verification" below, including a direct test proving "sheet
missing" really is the only remaining failure path.

## Frontend hide-toggle — the exact brief for the UI pass

**Backend-only so far.** The backend now correctly skips saving
Need/Want/Saving when a valid `investmentInstrument` is sent (see "Fixed
2026-08-11" above) — but nothing in `index.html` sends
`investmentInstrument` yet, and the Need/Want/Saving toggle itself
doesn't know to hide for this case yet either. Both are still open, for
the frontend pass.

**Reuse the existing shared mechanism — do not build a fourth,
separate show/hide system.** `index.html` already has ONE shared
function that decides whether to hide the Need/Want/Saving toggle,
`wireLendingAwareToggle(card, noteInput, onHide, isFinancialEventSelected)`
(near line 2750). Its internal `update()` currently computes:

```js
const hide = isLendingNote(noteInput.value)
  || isSavingsNote(noteInput.value)
  || !!(isFinancialEventSelected && isFinancialEventSelected());
```

Two checks run directly on the note text (lending, saving), and one is
an optional **getter callback** (`isFinancialEventSelected`) that the
caller (Pending/History's card-building code) passes in, so the toggle
also hides when a Rent/EMI/Investment Financial Event chip is currently
selected on that same card — not just from note text.

**What to add:** a second, matching optional getter callback —
e.g. `isInvestmentInstrumentSelected` — as a new 5th parameter, and OR
it into the same `hide` expression:

```js
function wireLendingAwareToggle(card, noteInput, onHide, isFinancialEventSelected, isInvestmentInstrumentSelected) {
  ...
  function update() {
    const hide = isLendingNote(noteInput.value)
      || isSavingsNote(noteInput.value)
      || !!(isFinancialEventSelected && isFinancialEventSelected())
      || !!(isInvestmentInstrumentSelected && isInvestmentInstrumentSelected());
    ...
  }
  ...
}
```

Then, in `buildPendingItem`/`buildHistoryItem` (wherever the
investment-instrument confirm chip/name-it prompt from
`suggestedInvestmentInstrument` ends up being built — see "New fields on
getPending/getTransactionHistory" above), track the current selection
in a small piece of per-card state (same pattern
`setupFinancialEventField` already uses for its own `{type, name}`
return value — read at save time, not cached), and pass a getter for it
as the new 5th argument at the `wireLendingAwareToggle(...)` call sites
in Pending/History (Reconciliation/Cash are out of scope — the note-
match suggestion is never computed for them, see "Open items" below).

**Re-run `update()` after the investment chip is tapped**, same as the
existing Financial Event chip already does — `wireLendingAwareToggle`
returns its internal `update` function specifically so a caller can
re-trigger it from a chip's own click handler (see the comment on
`wireLendingAwareToggle` itself: "a second, separate show/hide mechanism
would risk the two fighting each other"). Do not wire a second, parallel
show/hide call — always re-run the SAME `update` reference the initial
`wireLendingAwareToggle(...)` call returned.

**Net effect once wired up:** as soon as a note-matched investment
suggestion is showing (or has been confirmed) on a card, the
Need/Want/Saving toggle hides live — exactly the same felt behavior as
typing a lending/saving note or selecting a Rent/EMI/Investment
Financial Event chip already has today, just driven by a third input
into the one function that already owns this decision.

## Backend functions — `backend/investmentInstruments.js`

- `getInvestmentInstrumentsSheet_()` — auto-creates AND seeds the sheet
  on first use.
- `getInvestmentInstrumentsList()` — returns `{instruments, grouped}`
  for the frontend picker.
- `getInstrumentCategoryMap_()` — Name → Category lookup, used by
  `getInvestmentsData()` (`PWA.js`) to label each breakdown line.
- `validateInvestmentInstrumentName_(name)` — case-insensitive check
  against the real list; returns the sheet's own canonical spelling on
  a match (never trusts the caller's casing), or `{ok:false, error}`.
  Used by every write path (`logInvestmentFromApp`,
  `updateInvestmentEntry`, the `investmentInstrument` save-path in
  `saveTransactionNote`) — this is what guarantees `getInvestmentsData`'s
  exact-string grouping stays correct forever.
- `addInvestmentInstrument(name, category)` — adds a brand-new
  instrument; rejects a blank name, an invalid category, or a name that
  already exists (case-insensitive). Deliberately does not accept a
  `SipAmount` — see the function's own comment for why.
- `getNonSipInstrumentNames_(instrumentsData)` / `noteContainsInstrumentName_(name, noteTextLower)`
  — small helpers behind `matchInvestmentInstrumentByNote`.
- `matchInvestmentInstrumentByNote(note, instrumentsData)` — see "Note-
  text matching" above.
- `migrateInvestmentsToNamedInstruments()` — the one-time migration, see
  next section.

## Changes in `PWA.js`

- `getInvestmentsData()` — now also reads
  `getInstrumentCategoryMap_()` and attaches `category` to each
  breakdown entry. Grouping/summing logic itself is unchanged (still an
  exact-string match on the `Investments` sheet's `Type` column) — it
  only stays correct now because every write path is guaranteed
  consistent (see `validateInvestmentInstrumentName_` above).
- `logInvestmentFromApp(amount, instrumentName)` — was
  `logInvestmentFromApp(amount, type)` with no validation at all
  (whatever string was typed got written straight to the sheet — the
  exact cause of the fragmentation bug this feature fixes). Now
  validates `instrumentName` first.
- `updateInvestmentEntry(row, instrumentName, amount)` — same
  validation added, so editing a past entry can never reintroduce a
  stray free-typed spelling either.
- `getPendingTransactions` / `getTransactionHistory` — both now also
  read `InvestmentInstruments` once (same "read outside the loop"
  performance pattern as `SmartMemory`/`TypeVotes`/`FinancialEvents`)
  and attach the three `suggestedInvestmentInstrument`/
  `investmentInstrumentConfident`/`investmentInstrumentLooksNew` fields
  described above.
- `saveTransactionNote(...)` — one new parameter, `investmentInstrument`
  (see "Frontend contract" and "Fixed 2026-08-11" above for the full
  behavior: still ordinary Category/spend, but skips Need/Want/Saving).
- `auditInvestmentsSheet()` — left in place (harmless, still a useful
  read-only snapshot), though its original purpose (deciding how to
  migrate) is now done.

## The one-time migration — `migrateInvestmentsToNamedInstruments()`

**Not yet run.** Run once, manually, from the Apps Script editor
(select the function, Run, then View → Logs) — same pattern as
`migrateSavingsToV2()` (`savingsGoals.js`). Does two things:

1. **Replaces the Investments sheet's 5 old rows** (confirmed via the
   earlier `auditInvestmentsSheet()` run: generic "Mutual Funds"
   ₹40,498, "Gold" ₹5,615, "Stocks" ₹11,582, "Mutual Fund (Money2Mgt)"
   ₹54,000, "Mutual Funds SIP" ₹3,000 — dated 2026-05-11/2026-08-10)
   with **15 new rows**, one per real named instrument, dated today,
   each carrying its till-date invested total as a `"Starting Balance"`
   note. The 15 amounts were given directly by the user in chat
   (2026-08-11) — not calculated or estimated here:

   | Instrument | Amount |
   |---|---|
   | HDFC Nifty 50 Index Fund | ₹20,000 |
   | HDFC Mid Cap Fund | ₹11,000 |
   | Bandhan Small Cap (Money2Mgt SIP) | ₹58,000 |
   | Motilal Oswal Flexi Cap | ₹5,000 |
   | HDFC Gold ETF Fund | ₹5,500 |
   | Bandhan Small Cap | ₹5,000 |
   | ICICI Prudential | ₹5,000 |
   | HDFC Silver ETF | ₹5,000 |
   | Motilal Oswal Midcap | ₹1,000 |
   | Digital Gold | ₹5,615 |
   | Tata Motors Commercial | ₹566.94 |
   | Tata Steel | ₹157 |
   | LIC | ₹1,753.52 |
   | HDFC Bank | ₹7,851.82 |
   | Tata Motors Passenger | ₹1,253.06 |

2. **Registers the 3 real SIPs into `FinancialEvents`** — calls the
   existing `recordFinancialEvent("Investment", <sipAmount>, "",
   <name>)` for each, exactly what a live Pending/History confirm would
   do. This means these three amounts (₹3,000/₹4,000/₹2,000) are
   recognized by `matchRecurringNamedEvent` from day one — no need to
   re-confirm "what would you call this" the next time these exact SIP
   debits happen.

**Safe to run only once** — see the function's own comment in
`investmentInstruments.js` for what would go wrong on a second run
(harmless duplicate data, not a corruption risk, but still needless).

Verified with a Node test simulating a realistic pre-migration
Investments sheet (the exact 5 old rows from the real audit) before
shipping — see "Verification" below.

## Verification

`backend/tests/investmentInstruments.test.js` — 7 test groups, run with
`node backend/tests/investmentInstruments.test.js`:
1. Seeding — all 15 instruments, correct categories, correct SIP
   amounts, correct grouping.
2. Note matching recognizes known instruments, and never confuses two
   names that share a first word (Tata Steel vs Tata Motors Commercial).
3. No false-positive substring matches (the "LIC inside PUBLIC/POLICY"
   regression check — same bug class as the documented "lent inside
   excellent" bug).
4. An unnamed "stock"/"shares" mention is flagged as "looks new";
   unrelated or empty notes return nothing.
5. `validateInvestmentInstrumentName_` — case-insensitive, returns
   canonical spelling, rejects unknown/blank names.
6. `addInvestmentInstrument` — adds successfully, rejects a duplicate
   (case-insensitive) and an invalid category.
7. The one-time migration — removes the 5 old rows, writes the 15 new
   ones with the exact given amounts/note, registers the 3 SIPs into
   `FinancialEvents`, and confirms a future ₹3,000 debit is now actually
   recognized by `matchRecurringNamedEvent` (not just that a row got
   written — proves the migration plugs into the real matching
   mechanism end to end).

`backend/tests/investmentInstrumentSkipsNeedWantSaving.test.js` — 4 test
groups (added for the 2026-08-11 fix above), run with
`node backend/tests/investmentInstrumentSkipsNeedWantSaving.test.js`,
loading `saveTransactionNote` itself (`PWA.js`) alongside
`investmentInstruments.js`/`financialEvents.js`/`needWantSaving.js`:
1. A valid `investmentInstrument` skips column Q entirely (not written),
   and the response reports `typeSaved:false`/`typeRequested:true`.
2. The investment is still logged into `Investments` correctly — this
   fix didn't break the actual logging.
3. An ORDINARY transaction (no `investmentInstrument`) is unaffected —
   Need/Want/Saving still saves normally, proving the exclusion didn't
   widen to everything.
4. An INVALID/unknown `investmentInstrument` name does NOT skip
   Need/Want/Saving — only a name that actually validates does (never
   trust the frontend).

`backend/tests/autoLogInvestmentDuplicateSkip.test.js` — 5 test groups
(added for the 2026-08-11 duplicate-check fix above), run with
`node backend/tests/autoLogInvestmentDuplicateSkip.test.js`:
1. `autoLogInvestment`'s DEFAULT behavior (no 5th argument, or explicitly
   `false`) is unchanged — a nearby similar amount is still skipped.
2. `skipDuplicateCheck:true` logs the exact same "duplicate" amount
   successfully instead of dropping it.
3. Even with `skipDuplicateCheck:true`, the ONLY other way this can
   still report `logged:false` is a genuinely missing `Investments`
   sheet — proven directly, not assumed (this is what backs the "is the
   frontend's false-branch messaging now dead code?" answer above).
4. End-to-end through `saveTransactionNote`'s real `investmentInstrument`
   call site: logs successfully despite a nearby duplicate.
5. End-to-end through `saveTransactionNote`'s real `financialEvent:
   "Investment"` call site: still correctly SKIPPED — regression check
   proving this fix didn't leak into the wrong call site.

All 16 test groups (three files) pass. `PWA.js`/`financialEvents.js`/
`investmentInstruments.js` also checked with `node --check` for syntax
validity (Apps Script's runtime can't be run directly in Node, same
limitation as every other backend test in this project — sheet
reads/writes are simulated with a small fake `SpreadsheetApp`, real
sheet I/O can only be confirmed live).

## Open items / not yet done

- ~~Frontend (`index.html`) not wired up~~ — **done, 2026-08-11.** See
  "Frontend — what actually shipped" above for the real result.
- ~~Recommendation for a possible `backend-agent` follow-up: should the
  duplicate guard even apply to the note-matched confirm chip~~ — **done,
  2026-08-11.** See "Fixed 2026-08-11 — duplicate check removed for
  note-matched confirms" above: `autoLogInvestment` gained
  `skipDuplicateCheck`, the note-matched path now passes `true`, the
  Financial Event/SIP path is unchanged. Left open from that fix: the
  frontend's `investmentLogged === false` messaging for this specific
  path (History's message branch, Pending's dismissible banner) is now
  believed practically unreachable — flagged for the user to decide
  whether to remove it or keep it as harmless defense-in-depth, not
  decided here.
- **No column tracks "this investment-instrument suggestion was already
  confirmed for this transaction"** (unlike Financial Events, which
  writes to `Transactions` columns R/S so a confirmed one never gets
  re-suggested). This means re-visiting the same noted transaction in
  History could keep showing the same confirm chip indefinitely. Low
  risk in practice — `autoLogInvestment`'s existing duplicate-avoidance
  (a similar amount within 3 days is skipped) already prevents an
  accidental double-log most of the time — but flagged here rather than
  silently assumed away. If repeat-chip-fatigue turns out to be
  annoying in real use, the fix would be either a frontend-only
  "hide once tapped this session" behavior, or a small new tracking
  column — genuinely a UI-pass decision, not made here.
- **The one-time migration has not been run yet** — needs the user to
  run `migrateInvestmentsToNamedInstruments()` from the Apps Script
  editor. Until it's run, `Investments` still has its old 5 generic
  rows, and the 3 SIPs aren't yet registered for amount-matching.
- **Not yet deployed live** — `clasp push` only reached the editor
  draft; needs `clasp deploy` with the user's go-ahead, same as every
  other change in this project.
