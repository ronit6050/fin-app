# Onboarding new users: analysis and proposed plan (2026-10-19)

**Status: IDEA ONLY. Nothing built, nothing changed in the app.** Written down so the owner can think about it. No decision has been made.
Next step the owner can pick: (a) turn this into a full plan with mockups before any code, or (b) start with the small blocker first (neutral defaults for new users).

## What exists today (checked in the code on 2026-10-19)

- **Nobody can sign up alone.** The owner adds a person's email as a friend (splits only). More > Access "full app" switch gives the whole app. Any other Google account sees "not allowed". (`backend/splits.js` `splitsIsOwnersFriend_`, `backend/admin.js` `getMyAccess`.)
- **A welcome tour exists but only in "New look (preview)"** (`index.html`, `finOnb*`): welcome, how a payment arrives, why SMS, supported banks, yes/no questions (credit card, lend/borrow, splits, invest/save, cash) that hide screens on that phone only. Friends get a shorter splits tour. Not shown in Demo Mode.
- **Android app asks for SMS permission right at launch with no explanation and no follow-up if denied** (`MainActivity.kt` `ensureSmsPermissions`).
- **New people inherit the owner's numbers:** CC limit 50,000, monthly expenses 30,000, savings goal 1,000 (`backend/settings.js`), and the card bill cycle is hardcoded to the 18th (`backend/CCAdvisor.js`).
- **Only the owner can teach a new bank** (More > Access). Unknown bank = messages show as "NEEDS REVIEW".
- Manual "+ Add a transaction" exists for people with no SMS. Friends' SMS go in through a private per-friend key.

## Real-life scenarios and what each needs

| Scenario | What should happen |
|---|---|
| Allows SMS, known bank | Works by itself. The path to protect. |
| Allows SMS, bank not known | Shows "needs review". Add a one-tap "send sample messages to the app owner" instead of waiting for the owner to notice. |
| Denies SMS / iPhone / website only | App still useful: "Add payment" is the main button, "Turn on SMS later" in Settings, honest line that they will type each payment. |
| No credit card | Hide CC Advisor and the Home CC tile (the tour questions do this today, but only in New look). |
| Has a credit card | Ask last 4 digits, bill date, limit (today 18th and 50,000 are baked in). |
| Several cards / bank accounts | Add each (bank + last 4). Mark the salary account and the card. NOT yet checked how the code handles several for one person: verify before promising. |
| UPI-linked credit card | Plain explanation needed (it once showed as "UPI" and was missed by CC Advisor). |
| Uses cash a lot | Show Cash, ask a starting balance. |
| Salaried vs irregular income | Ask salary day and rough amount; skip salary-day features if irregular. |
| Existing investments, EMIs, rent | Do not ask for a full list; the app learns from the first month. Offer "add holdings" later. |
| Splits with friends | Their friends are probably not on the app: invite link/message (also a growth hook). |
| Shared phone / no internet / new phone | Remember sign-in, friendly empty states; on a new phone the SMS permission and key must be granted again and the app should say so. |
| Privacy-worried | One clear screen: what is read, what is skipped (OTP, spam), nothing sold or shared, how to delete everything. Play Store will also require this. |

## Proposed flow (ask little, show value fast, never block)

0. **Getting in:** keep adding people by hand for now; next an invite link/code; open sign-up only after the Play Store / privacy homework.
1. **Welcome** (10 seconds): what it does, that it is private.
2. **Three quick questions:** which bank(s); credit card? (last 4, bill date, limit); salary day.
3. **SMS permission explained first**, then the phone's box. If "no": manual mode with a "turn on later" button.
4. **First real payment is the finish line:** checklist "messages connected, first payment arrived, first note added"; a tiny example payment so Pending is not empty.
5. **Small prompts over the first 2 weeks** (salary day when "money left" appears, rent when a big fixed payment appears) instead of one long form.
6. **Behind the scenes:** new people start with blank/neutral settings ("not set", never the owner's numbers); the Admin page counts how many finish each step.

## Blockers, most important first

1. New users get the owner's defaults (limit, expenses, 18th cycle) = wrong advice. Smallest fix, biggest effect.
2. The tour only appears in New look; it must become the normal first run.
3. SMS permission has no explanation and no fallback.
4. Unknown banks need the owner.
5. Multi-account handling unclear.
6. Access is manual.

## Related

`docs/PROJECT_STATUS.md` section 6 ("Agreed order after the cutover": admin panel, then UI/UX pass including first-run onboarding, then a real native app). A mockup of the onboarding cards was shown earlier (2026-10-16/17).
