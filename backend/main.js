/* ============================================
   MAIN ENTRY FILE

   This is the starting point of the system.

   Functions:
   - checkNewTransactions() → Trigger to process new transactions
   - doPost(e) → Receives Telegram updates (webhook)

   ⚠️ Do NOT modify this file unless:
   - Bot is not responding
   - Webhook/trigger issues

   All logic is handled in other files.
============================================ */

function checkNewTransactions(){
  processNewTransactions();
}

function doPost(e){
  const data = JSON.parse(e.postData.contents);

  // ── Requests from the PWA always include an "action" field; Telegram's never do ──
  if (data.action) {
    return handlePwaRequest(data);
  }

  handleTelegramUpdate(e);
}