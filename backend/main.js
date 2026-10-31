/* ============================================
   MAIN ENTRY FILE

   Apps Script is RETIRED (2026-10-31). The app, the Android app and the
   admin page talk only to the new server (Firebase Cloud Functions, which
   runs this same backend code). This file is what Apps Script itself would
   run, so it now only answers "retired" and never touches the Google Sheet:
   anything written there would never be seen by the app.

   - doPost(e) -> always says "retired" (a phone treats this as "not saved",
     keeps the message and retries on the new server).
   - checkNewTransactions() -> old Sheet timer entry; does nothing now.
============================================ */

function checkNewTransactions(){
  // Retired: the new server's own timer (fnTimer.js) does this work.
}

function doPost(e){
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, retired: true, error: "This address is retired. Update the app." }))
    .setMimeType(ContentService.MimeType.JSON);
}
