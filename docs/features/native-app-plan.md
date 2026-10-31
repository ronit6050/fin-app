# Real app plan: PWA now, app shell next, native screens only if needed (2026-10-19)

**Status: PLAN ONLY. Nothing built.** Needs the owner's OK on the phases before any code.

## Where we are (checked 2026-10-19)

- The Android app (`D:\Fin-app Application`, own git repo, ~1,400 lines of Kotlin) is a **shell around the PWA**: a WebView that shows the same screens, plus native pieces
  for the things a website cannot do: read SMS (`SmsReceiver`, `SmsForwardWorker`), push with note-guess buttons (`FinAppFirebaseMessagingService`, `ConfirmNoteWorker`),
  Google sign-in, background Home refresh. It already talks to the new Cloud Functions server first.
- Rough edges that matter for a "real app" that friends install:
  - App ID is still `com.example.expensetracker`, version 1.0 (placeholder, not shippable).
  - SMS permission is asked at launch with no explanation and no fallback (`ensureSmsPermissions`).
  - No in-app update path (friends would need a new APK by hand).
  - Onboarding tour only exists in the PWA's "New look (preview)".

## The idea: one front door, three layers

1. **PWA = the product.** Every screen and the onboarding live here once. Works for iPhone and website-only people too.
2. **Android app = a thin, polished shell.** Only does what the web cannot: SMS permission + reading, push buttons, install-as-app feel.
3. **Native screens = later, only where the web truly falls short** (e.g. instant-open widget, quick-add from the notification shade). Not a rewrite.

Why: a full native rewrite means every feature built and fixed twice, and the owner is a single person. The shell keeps one copy of the logic.

## Phases (each ends with the owner's go/no-go; nothing live changes without asking)

| # | Phase | Who tests | Rough size |
|---|---|---|---|
| A | **Onboarding in the PWA, as the normal first run** (not only New look): welcome, 3 questions, neutral defaults for new people (no 50,000 limit / 18th cycle), manual-mode fallback. Spec: `docs/features/onboarding-plan.md` | me in browser + owner | 2 sessions |
| B | **Shell gets the SMS step right:** explain-then-ask permission screen (shown from the PWA onboarding), "turn on later" in Settings, clear message if denied, re-ask on a new phone | owner's phone | 1 session |
| C | **Make it shippable:** real app ID + name + icon, version number shown, release signing key (stored OUTSIDE the repo), release build, in-app "new version available" check | owner builds in Android Studio | 1 session |
| D | **Pilot:** Vaidehi installs by APK, then 1-2 friends. Watch the Admin page for where people drop off | Vaidehi + friends | owner time |
| E | **Decide next** from what the pilot shows: Play Store (needs SMS-permission declaration and a privacy page), invite links, native widget / quick-add, iPhone path | owner decides | later |

## Decisions the owner must make before phase C (cannot be undone later)

1. **Final app ID** (e.g. `in.<something>.<appname>`). Changing it after friends install means they must uninstall and lose local setup, and Play Store locks it forever.
2. **App name and icon.**
3. **Signing key:** I generate it, you store a backup copy somewhere safe (cloud drive + USB). Lose it = no updates for installed copies, ever.
4. **Sideload (APK) first, Play Store later?** Recommended: yes. Play Store restricts reading SMS unless the app is the default SMS app, so it needs a special declaration and may be refused.

## Risks in plain words

- Real-phone behaviour (battery killing the SMS listener, permission screens on different brands) can only be proven on real phones. Each phase C-D needs a phone test.
- New people must never see the owner's numbers. That is phase A's first task (smallest change, biggest effect).
- Any change to SMS reading or sign-in is high risk: a bug means payments silently never arrive. Those get an independent review before they ship.

## Proposed next step

Phase A, first slice: neutral defaults for new users + the tour as the normal first run. Pure PWA/backend, testable here without a phone.
