# Going public: running costs and safety (started 2026-10-12)

## Ceiling
The owner's ceiling is **Rs 300 a month** until the app earns money (decided 2026-10-12). Plan: Firebase **Blaze**
(pay-as-you-go, active since 2026-10-12). Expected real cost: Rs 0 (everything used so far fits the free allowance).

## What protects the ceiling
1. **Built-in daily limit (in the code, `backend/firestore.js`).** The app stops using Firestore at 45,000 reads or
   18,000 writes a day (90% of the free 50,000 / 20,000). Above that, Firestore calls are refused until the next day
   and screens fall back to the slower direct way, so Firestore itself can never pass the free allowance.
   `checkAppHealth` already warns when usage reaches 80%.
2. **Google Cloud budget alerts (the owner sets these by hand, one time).** Alerts only email; they do not stop spending.
   Steps: Google Cloud console -> project `fin-app-76c40` -> **Billing** -> **Budgets & alerts** -> **Create budget**:
   - Name: `fin-app monthly`; scope: this project only; amount: **Rs 300** per month.
   - Alert thresholds: **17%** (about Rs 50), **33%** (Rs 100), **67%** (Rs 200), **100%** (Rs 300), all by email to
     an address the owner reads.
3. **Not built, and why:** an automatic "switch billing off at Rs 300" Cloud Function. It needs the Firebase / Google
   Cloud command-line tools signed in as the owner, which are not available in the working environment. With (1) in place the
   only paid usage left is something new that has not been built yet. Build it before adding anything that bills by
   use (Cloud Functions, storage, AI calls).

## Things that would cost money if added later (check before building)
Cloud Functions beyond the free calls, Cloud Storage (statement uploads), any AI/Gemini calls per user, SMS/email
sending, a custom domain (about Rs 800 a year), Google Play developer account (about USD 25 once, only for a Play Store listing).

## Where the data is, and who can read it
Everyone's splits data lives in Firestore under `users/<their email>/...`. Security rules (`firestore.rules`) let a phone
read only its own folder and never write. The backend runs as the owner's Google account, so the owner can technically
read everything; this must be disclosed to users before a public launch (privacy policy, data deletion, India's DPDP Act).
