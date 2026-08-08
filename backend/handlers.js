/* ============================================
   HANDLERS
============================================ */

function handleTelegramUpdate(e){
  try{
    const data = JSON.parse(e.postData.contents);

    // ── SECURITY: reject anyone who isn't you ──
    const incomingChatId = String(
      data?.message?.chat?.id ||
      data?.callback_query?.message?.chat?.id ||
      ""
    );
    const {CHAT_ID} = getConfig();
    if(incomingChatId !== String(CHAT_ID)) return;

    if(data.callback_query){ handleButtons(data); return; }
    if(!data.message) return;
    handleMessages(data);

  }catch(err){
    logAI("doPost Error", err.toString());
  }
}

/* ===============================
   BUTTON HANDLER
=============================== */
function handleButtons(data){

  const action    = data.callback_query.data;
  const messageId = data.callback_query.message.message_id;

  if(action == "dashboard"){
    editDashboard(messageId);
  }

  else if(action == "today_summary"){
    sendTodaySummary();
  }

  else if(action == "analysis"){
    sendMonthSelector(messageId);
  }

  else if(action.startsWith("analysis_")){
    const parts = action.split("_");
    const year  = Number(parts[1]);
    const month = Number(parts[2]);
    sendMessage("⏳ Generating analysis...");
    generateMonthlyAnalysis(year, month);
  }

  else if(action == "cashmenu"){
    editCashMenu(messageId);
  }

  else if(action == "cash_spend"){
    PropertiesService.getScriptProperties().setProperty("cashMode","spend");
    sendMessage(`💸 Enter cash expenses\n\nFormat:\nAmount Note\n\nExample:\n50 tea\n120 auto`);
  }

  else if(action == "cash_receive"){
    PropertiesService.getScriptProperties().setProperty("cashMode","receive");
    sendMessage(`💰 Enter received cash\n\nExample:\n500 Rahul returned`);
  }

  else if(action == "cash_balance"){
    sendCashBalance();
  }

  else if(action == "cash_today"){
    sendTodayCash();
  }

  else if(action == "cc_advisor"){
    sendCCAdvisorReport();
  }

  /* ── SAVINGS MENU ── */
  else if(action == "savings_menu"){
    sendSavingsMenu(messageId);
  }

  else if(action == "savings_dashboard"){
    sendSavingsDashboard();
  }

  else if(action == "invest_dashboard"){
    sendInvestmentDashboard();
  }

  else if(action == "savings_add"){
    PropertiesService.getScriptProperties().setProperty("savingsMode","save");
    sendMessage(
`💵 Log a Saving

Format: Amount Type Note

Examples:
1000 bank monthly goal
500 mutual fund SIP
200 cash leftover from weekend`
    );
  }

  else if(action == "invest_add"){
    PropertiesService.getScriptProperties().setProperty("savingsMode","invest");
    sendMessage("📈 Log an investment\n\nType: Amount Type\nExample:\n500 Mutual Fund\n200 Gold\n1000 Stocks");
  }

  else if(action == "wishlist_purchased"){
  PropertiesService.getScriptProperties().setProperty("savingsMode","wishlist_purchase");
  markWishListPurchased();
  }
  
  else if(action == "wishlist_add"){
    PropertiesService.getScriptProperties().setProperty("savingsMode","wishlist");
    sendMessage(
`🎯 Add to Wish List

Type the item name, price, and priority:

Examples:
Body Massager 2000 high
iPhone 16 80000
Goa trip 25000 medium
New shoes 3000 low

Priority is optional — defaults to Medium.`
    );
  }

  /* ── DEBT MENU ── */
  else if(action == "debt_menu"){
    sendDebtMenu(messageId);
  }

  else if(action == "debt_dashboard"){
    sendDebtDashboard();
  }

  else if(action == "debt_add_lent"){
    PropertiesService.getScriptProperties().setProperty("debtMode","LENT");
    sendMessage("💸 Who did you lend money to?\n\nType: Name Amount Reason\nExample: Raj 500 dinner");
  }

  else if(action == "debt_add_borrowed"){
    PropertiesService.getScriptProperties().setProperty("debtMode","BORROWED");
    sendMessage("🤝 Who did you borrow from?\n\nType: Name Amount Reason\nExample: Priya 2000 rent");
  }

  else if(action == "debt_settle"){
    PropertiesService.getScriptProperties().setProperty("debtMode","SETTLE");
    sendSettleList();
  }

  /* ── CATEGORY CORRECTION ── */
  else if(action == "cat_confirm"){
    const raw = PropertiesService.getScriptProperties().getProperty("pendingCorrection");
    if(raw){
      const pending = JSON.parse(raw);
      handleCategoryCorrection(pending.merchant, pending.category, "Other");
      PropertiesService.getScriptProperties().deleteProperty("pendingCorrection");
      sendMessage("✅ Got it — remembered for next time!");
    }
  }

  else if(action == "cat_correct"){
    PropertiesService.getScriptProperties().setProperty("categoryFixMode","YES");
    const categories = Object.keys(SMART_CATEGORIES).join(", ");
    sendMessage(`What category should this be?\n\nOptions:\n${categories}\n\nReply with category name.\nExample: Lifestyle`);
  }

  /* ── RECON ── */
  else if(action == "recon_start"){
    const {BOT_TOKEN, CHAT_ID} = getConfig();
    UrlFetchApp.fetch("https://api.telegram.org/bot"+BOT_TOKEN+"/sendMessage",{
      method:"post",
      contentType:"application/json",
      payload:JSON.stringify({
        chat_id: CHAT_ID,
        text: "📥 Select statement type",
        reply_markup:{
          inline_keyboard:[
            [{text:"🏦 Bank Statement",       callback_data:"upload_bank"}],
            [{text:"💳 Credit Card Statement", callback_data:"upload_cc"}]
          ]
        }
      })
    });
  }

  else if(action == "upload_bank"){
    PropertiesService.getScriptProperties().setProperty("uploadMode","bank");
    sendMessage("📤 Upload Bank Statement (Excel)");
  }

  else if(action == "upload_cc"){
    PropertiesService.getScriptProperties().setProperty("uploadMode","cc");
    sendMessage("📤 Upload Credit Card Statement (Excel)");
  }

  else if(action == "confirm_recon"){
    const added = insertConfirmed();
    sendMessage(`✅ ${added} transactions added & sorted`);
  }
}

/* ===============================
   MESSAGE HANDLER
=============================== */
function handleMessages(data){

  const message = data.message;
  const text    = (message.text || "").trim();

  /* ── Commands ── */
  if(text == "/start" || text == "/menu"){
    sendDashboard();
    return;
  }

  if(text == "/cc"){
    sendCCAdvisorReport();
    return;
  }

  if(text == "/pending"){
    sendNextPendingTransaction();
    return;
  }

  if(text == "/savings"){
    sendSavingsDashboard();
    return;
  }

  if(text == "/invest"){
    sendInvestmentDashboard();
    return;
  }

  if(text.startsWith("/save ")){
    logSaving(text.replace("/save ","").trim());
    return;
  }

  if(text === "/save"){
    PropertiesService.getScriptProperties().setProperty("savingsMode","save");
    sendMessage(
`💵 Log a Saving

Format: Amount Type Note

Examples:
1000 bank monthly goal
500 mutual fund SIP
200 cash leftover from weekend`
    );
    return;
  }

  if(text.startsWith("/addinvest ")){
    logInvestment(text.replace("/addinvest ","").trim());
    return;
  }

  if(text.startsWith("/wishlist ")){
    addWishListItem(text.replace("/wishlist ","").trim());
    return;
  }

  if(text == "/debts"){
    sendDebtDashboard();
    return;
  }

  /* ── Category correction mode ── */
  const categoryFixMode = PropertiesService.getScriptProperties()
    .getProperty("categoryFixMode");

  if(categoryFixMode){
    PropertiesService.getScriptProperties().deleteProperty("categoryFixMode");

    const raw = PropertiesService.getScriptProperties().getProperty("pendingCorrection");
    if(raw){
      const pending  = JSON.parse(raw);
      const newCat   = text.trim();
      const validCat = Object.keys(SMART_CATEGORIES).includes(newCat);

      PropertiesService.getScriptProperties().deleteProperty("pendingCorrection");

      if(validCat){
        const sheet = SpreadsheetApp.getActiveSpreadsheet()
          .getSheetByName("Transactions");
        sheet.getRange(pending.rowIndex, 14).setValue(newCat);
        handleCategoryCorrection(pending.merchant, newCat, "Other");
        sendMessage(`✅ Updated to ${newCat} — remembered permanently!`);
      } else {
        sendMessage(`❌ "${newCat}" is not valid.\n\nValid options:\n${Object.keys(SMART_CATEGORIES).join(", ")}`);
      }
    }
    return;
  }

  /* ── Cash mode ── */
  const cashMode = PropertiesService.getScriptProperties().getProperty("cashMode");
  if(cashMode){
    processCashEntry(text, message.message_id, cashMode);
    PropertiesService.getScriptProperties().deleteProperty("cashMode");
    return;
  }

  /* ── Cash check-in reply ── */
  const checkinMode = PropertiesService.getScriptProperties()
    .getProperty("cashCheckinMode");
  if(checkinMode){
    PropertiesService.getScriptProperties().deleteProperty("cashCheckinMode");
    if(text.toLowerCase() === "no"){
      sendMessage("✅ Got it — cash balance stays as is. Good night! 🌙");
    } else {
      processCashEntry(text, message.message_id, "spend");
    }
    return;
  }

  /* ── Savings mode ── */
  const savingsMode = PropertiesService.getScriptProperties().getProperty("savingsMode");
  if(savingsMode === "save"){
    logSaving(text);
    PropertiesService.getScriptProperties().deleteProperty("savingsMode");
    return;
  }
  if(savingsMode === "invest"){
    logInvestment(text);
    PropertiesService.getScriptProperties().deleteProperty("savingsMode");
    return;
  }
  if(savingsMode === "wishlist"){
    addWishListItem(text);
    PropertiesService.getScriptProperties().deleteProperty("savingsMode");
    return;
  }

  if(savingsMode === "wishlist_purchase"){
  processWishListPurchase(text);
  PropertiesService.getScriptProperties().deleteProperty("savingsMode");
  return;
  }

  /* ── Debt mode ── */
  const debtMode = PropertiesService.getScriptProperties().getProperty("debtMode");

  if(debtMode === "LENT" || debtMode === "BORROWED"){
    addDebtEntry(text, debtMode);
    PropertiesService.getScriptProperties().deleteProperty("debtMode");
    return;
  }

  if(debtMode === "SETTLE"){
    processSettlement(text);
    PropertiesService.getScriptProperties().deleteProperty("debtMode");
    return;
  }

  /* ── File upload ── */
  if(message.document){
    try{
      const uploadMode = PropertiesService.getScriptProperties()
        .getProperty("uploadMode");

      if(!uploadMode){
        sendMessage("❌ Please select statement type first");
        return;
      }

      sendMessage("⏳ Processing file...");

      const fileId   = message.document.file_id;
      const fileName = (message.document.file_name || "").toLowerCase();
      const fileUrl  = getTelegramFile(fileId);
      const blob     = UrlFetchApp.fetch(fileUrl).getBlob();

      if(
        fileName.endsWith(".xls")  ||
        fileName.endsWith(".xlsx") ||
        fileName.endsWith(".csv")
      ){
        const file      = DriveApp.createFile(blob);
        const converted = Drive.Files.copy(
          {mimeType: MimeType.GOOGLE_SHEETS},
          file.getId()
        );
        const ss    = SpreadsheetApp.openById(converted.id);
        const sheet = ss.getSheets()[0];

        PropertiesService.getScriptProperties().deleteProperty("uploadMode");

        if(uploadMode === "cc"){
          sendMessage(processCreditCardStatement(blob));
        } else if(uploadMode === "bank"){
          sendReconResult(runReconciliation(sheet));
        }

      } else {
        sendMessage("❌ Please upload Excel file only");
      }

    }catch(err){
      sendMessage("❌ ERROR: " + err.toString());
      logAI("FILE_PROCESS_ERROR", err.toString());
    }
    return;
  }

  /* ── Reply to transaction alert → add note ── */
  if(message.reply_to_message){

    const replyId  = message.reply_to_message.message_id;
    const userText = message.text;

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transactions");
    const rows  = sheet.getDataRange().getValues();

    for(let i = 1; i < rows.length; i++){
      if(String(rows[i][14]) === String(replyId)){

        sheet.getRange(i+1, 13).setValue(userText);

        // ── Smart category with confidence ──
        const counterparty = rows[i][7] || "";
        const amount       = rows[i][5];
        const bank         = rows[i][2];
        const mode         = rows[i][4];

        const catResult = getSmartCategory(userText, counterparty, amount, mode, i+1);
        sheet.getRange(i+1, 14).setValue(catResult.category);

        sendMessage(`✅ Note & Category updated → ${catResult.category}`);

        // ── Ask for correction only if low confidence ──
        if(catResult.confidence < 80){
          PropertiesService.getScriptProperties().setProperty(
            "pendingCorrection",
            JSON.stringify({
              rowIndex: i+1,
              merchant: counterparty || userText,
              category: catResult.category
            })
          );

          const {BOT_TOKEN, CHAT_ID} = getConfig();
          UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({
              chat_id: CHAT_ID,
              text: `🤔 Not 100% sure about "${catResult.category}" for this.\n\nIs this correct?`,
              reply_markup:{
                inline_keyboard:[
                  [{text:"✅ Yes, correct",  callback_data:"cat_confirm"}],
                  [{text:"❌ No, change it", callback_data:"cat_correct"}]
                ]
              }
            })
          });
        }

        generateSmartReaction(userText, catResult.category, amount, bank, mode);
        return;
      }
    }
    sendMessage("❌ Transaction not found");
  }
}

/* ===============================
   RECON RESULT
=============================== */
function sendReconResult(result){
  const {BOT_TOKEN, CHAT_ID} = getConfig();
  UrlFetchApp.fetch("https://api.telegram.org/bot"+BOT_TOKEN+"/sendMessage",{
    method:"post",
    contentType:"application/json",
    payload:JSON.stringify({
      chat_id: CHAT_ID,
      text:
`✅ Recon Complete

Total: ${result.total}
Matched: ${result.matched}
Missing: ${result.missing}

Click below to add missing transactions`,
      reply_markup:{
        inline_keyboard:[[
          {text:"➕ Add Missing Transactions", callback_data:"confirm_recon"}
        ]]
      }
    })
  });
}