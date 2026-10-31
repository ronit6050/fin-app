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
