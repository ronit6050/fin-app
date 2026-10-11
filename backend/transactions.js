/* ============================================
   TRANSACTIONS ENGINE
============================================ */

// The timer entry point (the trigger calls this name). It runs the real work
// FIRST, so a new-transaction notification is never delayed by anything else,
// and only AFTERWARDS refreshes the Home screen copy in Firestore if something
// changed or the copy is over 30 minutes old (viewPublisher.js, added
// 2026-10-11). The try/finally + try/catch are insurance, even against the
// publisher function being missing altogether: nothing about the publisher
// may ever stop a transaction being processed.
function processNewTransactions() {
  try{
    processNewTransactionsCore_();
  }finally{
    try{ publishViewsIfNeeded_(); }catch(ignore){}
  }
}

// A row with neither a date nor an amount is a blank/placeholder row, never a
// real transaction (see the comment in the loop below).
function isEmptyTransactionRow_(row){
  const hasDate = row[0] !== "" && row[0] !== null && row[0] !== undefined;
  const hasAmount = row[5] !== "" && row[5] !== null && row[5] !== undefined;
  return !hasDate && !hasAmount;
}

function processNewTransactionsCore_() {

  const {BOT_TOKEN, CHAT_ID} = getConfig();

  const sheet   = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Transactions");
  const lastRow = sheet.getLastRow();

  if(lastRow < 2) return; // No data rows at all

  // ── Only scan from last checked row onwards ──
  const props       = PropertiesService.getScriptProperties();
  const lastChecked = Number(props.getProperty("lastCheckedRow") || 1);

  // If sheet has shrunk somehow, reset
  const startRow = Math.min(lastChecked, lastRow);

  const numRows = lastRow - startRow;
  if(numRows < 1) return; // Nothing new to check

  // Read only the new rows — not the entire sheet
  const data = sheet.getRange(startRow + 1, 1, numRows, 17).getValues();

  // Lookup sheets for the "Confirm" notification button (added
  // 2026-09-19) — read once here, same reason getPendingTransactions()
  // reads them once outside its own loop. See
  // docs/features/quick-confirm-notification.md.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const smartMemorySheet = ss.getSheetByName("SmartMemory");
  const smartMemoryData  = smartMemorySheet ? smartMemorySheet.getDataRange().getValues() : [];
  const typeVotesSheet = ss.getSheetByName("TypeVotes");
  const typeVotesData  = typeVotesSheet ? typeVotesSheet.getDataRange().getValues() : [];
  const noteMemorySheet = ss.getSheetByName("NoteMemory");
  const noteMemoryData  = noteMemorySheet ? noteMemorySheet.getDataRange().getValues() : [];
  const financialEventsSheet = ss.getSheetByName("FinancialEvents");
  const financialEventsData  = financialEventsSheet ? financialEventsSheet.getDataRange().getValues() : [];

  // Shared holder for auto-settle's big sheet reads (autoSettle.js) -
  // filled in lazily, only if a new DEBIT row actually shows up this run.
  const autoSettleHolder = { ctx: null, tried: false };

  for(let i = 0; i < data.length; i++){

    const processed = data[i][15];

    // Skip rows that are NOT real new transactions (fixed 2026-10-11):
    // - "IGNORED" is the marker left by the "not a transaction" button (the
    //   row is cleared in place, never deleted). The old rule here was just
    //   "anything that isn't YES is new", so after a bank-statement
    //   reconcile re-sorted the sheet, those placeholder rows landed below
    //   this function's bookmark, were treated as new transactions, and had
    //   their IGNORED marker overwritten with YES - showing up in Pending as
    //   Rs.0 phantoms. 11 of them appeared on 2026-10-11.
    // - A completely empty row (no date, no amount) is never a transaction.
    if(processed !== "YES" && processed !== "IGNORED" && !isEmptyTransactionRow_(data[i])){

      const rowIndex = startRow + i + 1; // Actual row number in sheet

      // One bad row (a formatting quirk, a flaky network call, anything)
      // used to throw and abort this whole function BEFORE lastCheckedRow
      // got saved below — which silently blocked every transaction after
      // it too, forever, until someone noticed and fixed it by hand
      // (happened 2026-08-08). Catching per-row means one bad row just
      // gets skipped and logged, instead of jamming the whole pipeline.
      try{

        // ── Auto-settle the KNOWNS first (added 2026-10-10) ──
        // A credit card bill payment, a wallet top-up, or a recurring
        // Rent/EMI/SIP the app has already seen and confirmed before is
        // settled silently - no notification, nothing in Pending, and it
        // never teaches the learning systems. If it returns false (not a
        // known type, or anything went wrong - it never throws), the row
        // carries on down the normal path below exactly as before. See
        // autoSettle.js / docs/features/auto-settle-and-health.md.
        if(tryAutoSettleNewRow_(sheet, rowIndex, data[i], autoSettleHolder)){
          sheet.getRange(rowIndex, 15).setValue("");
          sheet.getRange(rowIndex, 16).setValue("YES");
          continue;
        }

        const date   = Utilities.formatDate(
          new Date(data[i][0]), Session.getScriptTimeZone(), "dd MMM yyyy"
        );
        const time   = Utilities.formatDate(
          new Date(data[i][1]), Session.getScriptTimeZone(), "HH:mm"
        );

        const bank        = data[i][2]  || "Unknown";
        const type        = data[i][3]  || "Unknown";
        const mode        = data[i][4]  || "Unknown";
        const amount      = data[i][5]  || 0;
        const reference   = data[i][6]  || "";
        const counterparty = data[i][7] || "";

        // ✅ Now shows merchant/counterparty name in the alert
        const merchantLine = counterparty
          ? `🏪 Merchant: ${counterparty}\n`
          : "";

        const refLine = reference
          ? `🔖 Ref: ${reference}\n`
          : "";

        const message =
`💳 New Transaction

💰 Amount: ₹${Number(amount).toLocaleString('en-IN')}
🏦 Bank: ${bank}
📤 Type: ${type}
💳 Mode: ${mode}
${merchantLine}${refLine}
📅 ${date}
⏰ ${time}

Reply to add a note for this transaction.`;

        let messageId = "";

        if(TELEGRAM_ENABLED){
          const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";

          const response = UrlFetchApp.fetch(url, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({
              chat_id: CHAT_ID,
              text: message
            })
          });

          const result = JSON.parse(response.getContentText());
          messageId = result.result.message_id;
        }

        // ── "Confirm" notification button (added 2026-09-19) ──
        // See getQuickConfirmSuggestion's own comment (PWA.js) for the
        // full reasoning on when this is offered.
        const quickConfirm = getQuickConfirmSuggestion(
          type, counterparty, amount, mode, reference,
          smartMemoryData, noteMemoryData, financialEventsData, typeVotesData
        );
        if(quickConfirm) quickConfirm.row = rowIndex;

        // ── Real push notification — the main alert now that Telegram is off ──
        const pushBody = "₹" + Number(amount).toLocaleString('en-IN') + " · " + bank +
          (counterparty ? " · " + counterparty : "") +
          (quickConfirm ? ("\nTap Confirm to save as \"" + quickConfirm.note + "\" (" + quickConfirm.category + ")") : "");

        sendPushNotification("💳 New Transaction", pushBody, quickConfirm ? {
          quickConfirm:  "1",
          row:           quickConfirm.row,
          note:          quickConfirm.note,
          category:      quickConfirm.category,
          counterparty:  counterparty,
          type:          quickConfirm.type
        } : null);

        // Save messageId (empty if Telegram is off) and mark as processed
        sheet.getRange(rowIndex, 15).setValue(messageId);
        sheet.getRange(rowIndex, 16).setValue("YES");

      }catch(err){
        logAI("PROCESS_TXN_ERROR", "Row " + rowIndex + ": " + err.toString());
      }
    }
  }

  // ── Remember how far we've checked ──
  props.setProperty("lastCheckedRow", String(lastRow));

  // New transactions were processed: publish the Home screen again now so
  // the copy includes them (force = skip the 15-second throttle; this runs
  // once per timer run). Added 2026-10-11, best-effort, never throws.
  try{ publishViewsBestEffort_("new-transactions", true); }catch(ignore){}
}

/* ===============================
   TEST
=============================== */
function testTransaction(){
  processNewTransactions();
}

/* ===============================
   DIAGNOSTIC (added 2026-08-25)
   Run this by hand from the Apps Script
   editor (pick it from the function
   dropdown at the top, click Run, then
   View > Logs) whenever new transactions
   show up in the Sheet but not in the PWA's
   Pending screen. It checks the most likely
   cause in plain English, then tries the fix
   itself if that's what's wrong. Safe to run
   any time — it never touches a row that's
   already been processed.
=============================== */
function diagnosePendingTransactions(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  log("===== PENDING TRANSACTIONS DIAGNOSTIC =====");

  // 1) Is the automatic timer that's supposed to run
  //    processNewTransactions() every few minutes actually set up?
  const triggers = ScriptApp.getProjectTriggers();
  const hasTrigger = triggers.some(t => t.getHandlerFunction() === "processNewTransactions");
  log("");
  log("1) Automatic timer for processNewTransactions: " +
      (hasTrigger ? "FOUND — a timer is set up." : "MISSING — no timer is set up! This is very likely the problem — nothing is running processNewTransactions() automatically, so new rows never get marked ready to show in the app. Go to the clock icon (Triggers) on the left of the Apps Script editor and re-add a time-driven trigger for processNewTransactions, running every few minutes."));
  log("   (Total triggers found on this project: " + triggers.length + " — " +
      triggers.map(t => t.getHandlerFunction()).join(", ") + ")");

  // 2) How far behind is the "last checked row" bookmark?
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  const lastRow = sheet.getLastRow();
  const props   = PropertiesService.getScriptProperties();
  const lastChecked = Number(props.getProperty("lastCheckedRow") || 1);
  log("");
  log("2) Transactions sheet has data through row " + lastRow +
      ". Last row the app has checked: " + lastChecked + ".");
  if(lastRow > lastChecked){
    log("   -> There are " + (lastRow - lastChecked) + " row(s) newer than the last check. " +
        "These are the ones that should have been picked up.");
  } else {
    log("   -> Nothing new since the last check, according to this bookmark.");
  }

  // 3) Of the rows the app has already looked at, how many are actually
  //    marked ready (column P = YES) vs stuck blank? "IGNORED" is its
  //    own third bucket, not "stuck" — it means a user deliberately
  //    tombstoned that row via "Not a transaction" on Pending (see
  //    docs/features/spam-learning.md), not a real processing gap.
  //    Lumping it into "stuck" would misleadingly suggest a backlog that
  //    doesn't actually exist.
  const data = sheet.getDataRange().getValues();
  let readyCount = 0, ignoredCount = 0, stuckCount = 0, stuckRows = [];
  for(let i = 1; i < data.length; i++){
    const processed = (data[i][15] || "").toString().trim();
    if(processed === "YES") readyCount++;
    else if(processed === "IGNORED") ignoredCount++;
    else { stuckCount++; if(stuckRows.length < 10) stuckRows.push(i + 1); }
  }
  log("");
  log("3) Across the whole sheet: " + readyCount + " row(s) marked ready, " +
      ignoredCount + " row(s) deliberately marked \"not a transaction\" by the user, " +
      stuckCount + " row(s) NOT marked ready yet.");
  if(stuckCount > 0){
    log("   -> Row number(s) not marked ready (first 10 shown): " + stuckRows.join(", "));
  }

  // 4) Try actually running the processing step right now, safely.
  //    This is the same function the timer runs — if the only problem
  //    was the timer not firing, this fixes it immediately and you
  //    should get a push notification + see it in Pending right after.
  log("");
  log("4) Attempting to run the processing step right now...");
  try{
    processNewTransactions();
    log("   -> Ran without errors. Check your phone / the Pending tab now.");
  }catch(err){
    log("   -> IT FAILED with this error: " + err.toString());
    log("   -> This means there's a real bug, not just a missed timer. Share this error message.");
  }

  // 5) Any recent errors already logged from past attempts?
  const logsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AILogs");
  if(logsSheet){
    const logsData = logsSheet.getDataRange().getValues();
    const recentErrors = logsData
      .filter(r => (r[1] || "").toString().indexOf("PROCESS_TXN_ERROR") !== -1)
      .slice(-5);
    log("");
    log("5) Recent PROCESS_TXN_ERROR entries in AILogs (last 5): " +
        (recentErrors.length === 0 ? "none found." : ""));
    recentErrors.forEach(r => log("   - " + r[0] + ": " + r[2]));
  }

  log("");
  log("===== END DIAGNOSTIC — copy everything above and share it =====");

  return out.join("\n");
}

/* ===============================
   PENDING NOTES CATCH-UP
   /pending → sends one unprocessed
   transaction at a time
=============================== */
function sendNextPendingTransaction(){

  try{

    const {BOT_TOKEN, CHAT_ID} = getConfig();

    const sheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName("Transactions");
    const data  = sheet.getDataRange().getValues();

    // Find the first row that is processed (YES)
    // but has no note in column M (index 12)
    for(let i = 1; i < data.length; i++){

      const processed = (data[i][15] || "").toString().trim();
      const note      = (data[i][12] || "").toString().trim();
      const msgId     = data[i][14];

      // Skip if already has a note
      if(note) continue;

      // Skip if not processed yet
      // (these will be handled by normal trigger)
      if(processed !== "YES") continue;

      const date   = Utilities.formatDate(
        new Date(data[i][0]), Session.getScriptTimeZone(), "dd MMM yyyy"
      );
      const time   = Utilities.formatDate(
        new Date(data[i][1]), Session.getScriptTimeZone(), "HH:mm"
      );
      const bank        = data[i][2]  || "Unknown";
      const type        = data[i][3]  || "Unknown";
      const mode        = data[i][4]  || "Unknown";
      const amount      = Number(data[i][5]) || 0;
      const counterparty = data[i][7] || "";

      const merchantLine = counterparty
        ? `🏪 Merchant: ${counterparty}\n`
        : "";

      const message =
`📝 Pending Note (${i} of ${data.length})

💰 Amount: ₹${Number(amount).toLocaleString('en-IN')}
🏦 Bank: ${bank}
📤 Type: ${type}
💳 Mode: ${mode}
${merchantLine}
📅 ${date} ⏰ ${time}

Reply to this message with what this was for.
Type /pending for the next one after replying.`;

      const url = "https://api.telegram.org/bot"+BOT_TOKEN+"/sendMessage";

      const response = UrlFetchApp.fetch(url,{
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          chat_id: CHAT_ID,
          text: message
        })
      });

      const result    = JSON.parse(response.getContentText());
      const newMsgId  = result.result.message_id;

      // Update the messageId so reply tracking works
      sheet.getRange(i+1, 15).setValue(newMsgId);

      return; // Send only ONE and stop
    }

    // If we get here — all transactions have notes
    sendMessage("✅ All caught up! No pending notes.");

  }catch(err){
    logAI("PENDING_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}