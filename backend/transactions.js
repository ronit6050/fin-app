/* ============================================
   TRANSACTIONS ENGINE
============================================ */

function processNewTransactions() {

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

  for(let i = 0; i < data.length; i++){

    const processed = data[i][15];

    if(processed !== "YES"){

      const rowIndex = startRow + i + 1; // Actual row number in sheet

      // One bad row (a formatting quirk, a flaky network call, anything)
      // used to throw and abort this whole function BEFORE lastCheckedRow
      // got saved below — which silently blocked every transaction after
      // it too, forever, until someone noticed and fixed it by hand
      // (happened 2026-08-08). Catching per-row means one bad row just
      // gets skipped and logged, instead of jamming the whole pipeline.
      try{

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

        // ── Real push notification — the main alert now that Telegram is off ──
        const pushBody = "₹" + Number(amount).toLocaleString('en-IN') + " · " + bank +
          (counterparty ? " · " + counterparty : "");
        sendPushNotification("💳 New Transaction", pushBody);

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
}

/* ===============================
   TEST
=============================== */
function testTransaction(){
  processNewTransactions();
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