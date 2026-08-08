/* ============================================
   CASH MANAGEMENT SYSTEM
============================================ */

/* ===============================
   PROCESS CASH ENTRY
=============================== */
function processCashEntry(text, msgId, mode){

  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName("Cash");
  const memory = ss.getSheetByName("CategoryMemory");

  const lines = text.split("\n");

  let total = 0;
  let count = 0;

  lines.forEach(line => {

    const parts  = line.trim().split(" ");
    const amount = Number(parts[0]);

    if(!amount) return;

    const note     = parts.slice(1).join(" ");
    const category = getCategory(note, memory);

    // ✅ FIXED: lowercase to match Analysis.js and Summary.js
    const type = (mode == "receive") ? "credit" : "debit";

    sheet.appendRow([
      "",
      new Date(),
      new Date(),
      type,
      amount,
      note,
      category,
      "Telegram",
      msgId,
      new Date()
    ]);

    total += amount;
    count++;
  });

  sendMessage(`✅ ${count} cash entries recorded\n\nTotal ₹${total}`);
}

/* ===============================
   CASH BALANCE
=============================== */
function sendCashBalance(){

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Cash");
  const data = sheet.getDataRange().getValues();

  let balance = 0;

  for(let i = 1; i < data.length; i++){

    const type   = (data[i][3] || "").toString().toLowerCase();
    const amount = Number(data[i][4]) || 0;

    // ✅ FIXED: using toLowerCase() so both old and new entries work
    if(type === "debit")  balance -= amount;
    if(type === "credit") balance += amount;
  }

  sendMessage("💰 Cash Balance: ₹" + balance.toLocaleString('en-IN'));
}

/* ===============================
   TODAY CASH
=============================== */
function sendTodayCash(){

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Cash");
  const data  = sheet.getDataRange().getValues();

  const today = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
  );

  let total = 0;

  for(let i = 1; i < data.length; i++){

    const rawDate = data[i][1];
    if(!rawDate) continue;

    const d    = Utilities.formatDate(
      new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );
    const type = (data[i][3] || "").toString().toLowerCase();

    // ✅ FIXED: toLowerCase() handles both old "Debit" and new "debit"
    if(d === today && type === "debit"){
      total += Number(data[i][4]) || 0;
    }
  }

  sendMessage("📅 Today's Cash Spend\n\n₹" + total.toLocaleString('en-IN'));
}

/* ===============================
   TEST
=============================== */
function testCash(){
  sendCashBalance();
}

/* ===============================
   DAILY CASH CHECK-IN
   Runs every day at 8pm
=============================== */
function sendDailyCashCheckin(){

  try{

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const cashSheet = ss.getSheetByName("Cash");
    const txnSheet  = ss.getSheetByName("Transactions");

    const today = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    /* ===============================
       CASH — today's spend + balance
    =============================== */
    const cashData = cashSheet ? cashSheet.getDataRange().getValues() : [];

    let todaySpend   = 0;
    let todayEntries = [];
    let cashBalance  = 0;

    for(let i = 1; i < cashData.length; i++){

      const rawDate = cashData[i][1];
      if(!rawDate) continue;

      const type   = (cashData[i][3] || "").toString().toLowerCase();
      const amount = Number(cashData[i][4]) || 0;
      const note   = (cashData[i][5] || "").toString().trim();

      if(type === "debit")  cashBalance -= amount;
      if(type === "credit") cashBalance += amount;

      const d = Utilities.formatDate(
        new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd"
      );

      if(d === today && type === "debit"){
        todaySpend += amount;
        todayEntries.push(`• ₹${fmt(amount)} — ${note || "no note"}`);
      }
    }

    /* ===============================
       CC — today's card transactions
    =============================== */
    const txnData = txnSheet ? txnSheet.getDataRange().getValues() : [];

    let ccTodaySpend   = 0;
    let ccTodayEntries = [];
    let ccCycleSpend   = 0;

    // Billing cycle start
    const now        = new Date();
    const dayOfMonth = now.getDate();
    const thisMonth  = now.getMonth();
    const thisYear   = now.getFullYear();

    const cycleStart = dayOfMonth <= 18
      ? new Date(thisYear, thisMonth - 1, 19)
      : new Date(thisYear, thisMonth, 19);

    const dueDate = dayOfMonth <= 18
      ? new Date(thisYear, thisMonth + 1, 9)
      : new Date(thisYear, thisMonth + 2, 9);

    const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    for(let i = 1; i < txnData.length; i++){

      const rawDate = txnData[i][0];
      if(!rawDate) continue;

      const d      = new Date(rawDate);
      const type   = (txnData[i][3] || "").toString().toLowerCase();
      const mode   = (txnData[i][4] || "").toString().toLowerCase();
      const amount = Number(txnData[i][5]) || 0;
      const cparty = (txnData[i][7] || "").toString().trim();

      if(type !== "debit" || !mode.startsWith("card") || amount <= 0) continue;

      // Cycle total
      if(d >= cycleStart) ccCycleSpend += amount;

      // Today's CC entries
      const dStr = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
      if(dStr === today){
        ccTodaySpend += amount;
        const label = cparty ? cparty.substring(0, 20) : "Card payment";
        ccTodayEntries.push(`• ${label}: ₹${fmt(amount)}`);
      }
    }

    /* ===============================
       BUILD MESSAGE
    =============================== */

    // If nothing happened today — stay silent
    if(todaySpend === 0 && ccTodaySpend === 0){
      sendMessage(
`📊 Evening Check-in

✅ No cash or CC spend today.
Great day for your wallet! 💰`
      );
      return;
    }

    let message = `📊 Evening Check-in\n`;

    // ── Cash section ──
    if(todaySpend > 0){
      message += `\n💵 Cash today:\n`;
      message += todayEntries.join("\n");
      message += `\nTotal: ₹${fmt(todaySpend)}`;
      message += `\nBalance: ₹${fmt(cashBalance)}`;
    } else {
      message += `\n💵 Cash today: None`;
    }

    // ── CC section ──
    if(ccTodaySpend > 0){
      message += `\n\n💳 Credit card today:\n`;
      message += ccTodayEntries.join("\n");
      message += `\nToday's CC total: ₹${fmt(ccTodaySpend)}`;
      message += `\nThis cycle so far: ₹${fmt(ccCycleSpend)}`;
      message += `\nBill due in ${daysUntilDue} days (9th)`;
      message += `\n\n💡 Transfer ₹${fmt(ccTodaySpend)} to your Jupiter pot now to cover today's CC spend.`;
    } else {
      message += `\n\n💳 CC today: None`;
    }

    // ── Ask about unlogged cash ──
    message += `\n\nAny unlogged cash spend today?`;
    message += `\nReply with amount and note or "no"`;
    message += `\nExample: 50 tea`;

    // Set cash check-in mode for reply handling
    PropertiesService.getScriptProperties()
      .setProperty("cashCheckinMode", "YES");

    sendMessage(message);

  }catch(err){
    logAI("CASH_CHECKIN_ERROR", err.toString());
  }
}