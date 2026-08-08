/* ============================================
   TELEGRAM UI
============================================ */

// The on/off switch for Telegram. Set to false to stop sending there —
// every alert still fires as a push notification either way. Flip this
// back to true any time to instantly restore the old behavior.
const TELEGRAM_ENABLED = false;

/* ── Config ── */
function getConfig(){
  const props = PropertiesService.getScriptProperties();
  return {
    BOT_TOKEN: props.getProperty("BOT_TOKEN"),
    CHAT_ID:   props.getProperty("CHAT_ID"),
    GEMINI_KEY:props.getProperty("GEMINI_KEY")
  };
}

/* ── Generic request ── */
function telegramRequest(method, payload){
  const {BOT_TOKEN} = getConfig();
  return UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:"post",
    contentType:"application/json",
    payload:JSON.stringify(payload)
  });
}

/* ── Send message ── */
/* ── Send message ── */
/* ── Send message ── */
function sendMessage(text){
  if(TELEGRAM_ENABLED){
    const {CHAT_ID} = getConfig();
    telegramRequest("sendMessage",{ chat_id:CHAT_ID, text:text });
  }

  // ── Also send a push notification (Stage 9) ──
  const lines = text.split("\n").filter(function(l){ return l.trim() !== ""; });
  const title = lines[0] || "Fin App";
  const body  = lines.slice(1).join(" ").trim() || "Open the app for details.";
  sendPushNotification(title, body);
}

/* ── File download ── */
function getTelegramFile(fileId){
  const {BOT_TOKEN} = getConfig();
  const res      = UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = JSON.parse(res.getContentText()).result.file_path;
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
}

/* ===============================
   DASHBOARD
=============================== */
function sendDashboard(){
  const {CHAT_ID} = getConfig();
  telegramRequest("sendMessage",{
    chat_id: CHAT_ID,
    text: "📊 Finance Dashboard\n\nSelect an option",
    reply_markup:{ inline_keyboard: dashboardKeyboard() }
  });
}

function editDashboard(messageId){
  const {CHAT_ID} = getConfig();
  telegramRequest("editMessageText",{
    chat_id:    CHAT_ID,
    message_id: messageId,
    text: "📊 Finance Dashboard\n\nSelect an option",
    reply_markup:{ inline_keyboard: dashboardKeyboard() }
  });
}

/* Single source of truth for dashboard buttons */
function dashboardKeyboard(){
  return [
    [{text:"📊 Today's Summary",  callback_data:"today_summary"}],
    [{text:"📈 Analysis",         callback_data:"analysis"}],
    [{text:"💵 Cash Menu",        callback_data:"cashmenu"}],
    [{text:"💳 CC Advisor",       callback_data:"cc_advisor"}],
    [{text:"🎯 Savings & Goals", callback_data:"savings_menu"}],
    [{text:"💰 Debts",            callback_data:"debt_menu"}],
    [{text:"📥 Reconsolidate",    callback_data:"recon_start"}]
  ];
}

/* ===============================
   MONTH SELECTOR
=============================== */
function sendMonthSelector(messageId){
  const {CHAT_ID} = getConfig();
  const months    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const year      = new Date().getFullYear();
  let keyboard    = [];

  for(let i = 0; i < months.length; i += 3){
    keyboard.push([
      {text:months[i],   callback_data:`analysis_${year}_${i+1}`},
      {text:months[i+1], callback_data:`analysis_${year}_${i+2}`},
      {text:months[i+2], callback_data:`analysis_${year}_${i+3}`}
    ]);
  }
  keyboard.push([{text:"⬅ Back", callback_data:"dashboard"}]);

  telegramRequest("editMessageText",{
    chat_id:    CHAT_ID,
    message_id: messageId,
    text: "📊 Select Month for Analysis",
    reply_markup:{ inline_keyboard: keyboard }
  });
}

/* ===============================
   CASH MENU
=============================== */
function editCashMenu(messageId){
  const {CHAT_ID} = getConfig();
  telegramRequest("editMessageText",{
    chat_id:    CHAT_ID,
    message_id: messageId,
    text: "💵 Cash Menu",
    reply_markup:{
      inline_keyboard:[
        [{text:"💸 Spend Cash", callback_data:"cash_spend"},{text:"💰 Cash Received", callback_data:"cash_receive"}],
        [{text:"📊 Cash Balance",callback_data:"cash_balance"},{text:"📅 Today's Cash",  callback_data:"cash_today"}],
        [{text:"⬅ Back",        callback_data:"dashboard"}]
      ]
    }
  });
}

/* ===============================
   DEBT MENU
=============================== */
function sendDebtMenu(messageId){
  const {CHAT_ID} = getConfig();
  telegramRequest("editMessageText",{
    chat_id:    CHAT_ID,
    message_id: messageId,
    text: "💰 Debt Manager",
    reply_markup:{
      inline_keyboard:[
        [{text:"📊 Dashboard + AI Plan",  callback_data:"debt_dashboard"}],
        [{text:"💸 I lent money",         callback_data:"debt_add_lent"},
         {text:"🤝 I borrowed",           callback_data:"debt_add_borrowed"}],
        [{text:"✅ Mark as settled",      callback_data:"debt_settle"}],
        [{text:"⬅ Back",                 callback_data:"dashboard"}]
      ]
    }
  });
}

/* ===============================
   PERSISTENT MENU BUTTON
   Run this ONE TIME manually from
   Apps Script to set it permanently
=============================== */
function setupBotMenu(){
  const {BOT_TOKEN} = getConfig();
  UrlFetchApp.fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`,{
    method:"post",
    contentType:"application/json",
    payload:JSON.stringify({
      commands:[
        {command:"menu",        description:"Open Finance Dashboard"},
        {command:"cc",          description:"Credit Card Advisor"},
        {command:"debts",       description:"Debt Manager"},
        {command:"start",       description:"Start / restart bot"}
      ]
    })
  });
  Logger.log("✅ Bot menu set successfully");
}

/* ===============================
   MENU BUTTON (run once manually)
   Sets the persistent menu button
   next to the text input field
=============================== */
function setupMenuButton(){
  const {BOT_TOKEN, CHAT_ID} = getConfig();

  UrlFetchApp.fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,{
      method:"post",
      contentType:"application/json",
      payload:JSON.stringify({
        chat_id: CHAT_ID,
        menu_button:{ type:"commands" }
      })
    }
  );

  UrlFetchApp.fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`,{
      method:"post",
      contentType:"application/json",
      payload:JSON.stringify({
        commands:[
          {command:"menu",    description:"📊 Open Finance Dashboard"},
          {command:"pending", description:"📝 Fill pending notes"},
          {command:"save",    description:"💵 Log a saving quickly"},
          {command:"cc",      description:"💳 Credit Card Advisor"}
        ]
      })
    }
  );

  Logger.log("✅ Menu updated");
}

/* ── Test ── */
function testDashboard(){ sendDashboard(); }

function sendSavingsMenu(messageId){
  const {CHAT_ID} = getConfig();
  telegramRequest("editMessageText",{
    chat_id:    CHAT_ID,
    message_id: messageId,
    text: "🎯 Savings & Goals",
    reply_markup:{
      inline_keyboard:[
        [{text:"💰 Savings Dashboard",  callback_data:"savings_dashboard"}],
        [{text:"📈 Investments",        callback_data:"invest_dashboard"}],
        [{text:"💵 Log a Saving",       callback_data:"savings_add"},
         {text:"📊 Log Investment",     callback_data:"invest_add"}],
        [{text:"🎯 Add to Wish List",    callback_data:"wishlist_add"}],
        [{text:"✅ Mark as Purchased",   callback_data:"wishlist_purchased"}],
        [{text:"⬅ Back",               callback_data:"dashboard"}]
      ]
    }
  });
}