/* ============================================
   DEBT ADVISOR — FINAL VERSION
   - Reads Savings sheet (not Transactions)
   - Due date awareness
   - Overdue alerts
   - Partial settlements
   - Weekly nudge
============================================ */

function sendDebtDashboard() {

  try {
    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const debtSheet = ss.getSheetByName("Debts");

    if(!debtSheet){
      sendMessage("❌ Debts sheet not found.");
      return;
    }

    const data  = debtSheet.getDataRange().getValues();
    const today = new Date();
    today.setHours(0,0,0,0);
    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    let youOwe  = [];
    let theyOwe = [];

    for(let i = 1; i < data.length; i++){

      const person  = (data[i][1] || "").toString().trim();
      const type    = (data[i][2] || "").toString().trim().toUpperCase();
      const amount  = Number(data[i][3]) || 0;
      const note    = (data[i][4] || "").toString().trim();
      const dueDate = data[i][5];
      const status  = (data[i][6] || "Pending").toString().trim();
      const date    = data[i][0];

      if(!person || !amount || status === "Settled") continue;

      const daysSince = date
        ? Math.floor((new Date() - new Date(date)) / 86400000)
        : 0;

      // ── Due date logic ──
      let daysUntilDue = null;
      let isOverdue    = false;
      let dueSoon      = false;

      if(dueDate){
        const due = new Date(dueDate);
        due.setHours(0,0,0,0);
        daysUntilDue = Math.ceil((due - today) / 86400000);
        isOverdue    = daysUntilDue < 0;
        dueSoon      = daysUntilDue >= 0 && daysUntilDue <= 7;
      }

      const entry = {
        person, amount, note, daysSince,
        dueDate, daysUntilDue, isOverdue, dueSoon,
        row: i + 1
      };

      if(type === "BORROWED")                    youOwe.push(entry);
      else if(type === "LENT" || type === "SPLIT") theyOwe.push(entry);
    }

    const totalYouOwe  = youOwe.reduce((s, e) => s + e.amount, 0);
    const totalTheyOwe = theyOwe.reduce((s, e) => s + e.amount, 0);
    const netPosition  = totalTheyOwe - totalYouOwe;

    // ── Format entry line with due date ──
    const formatEntry = (e) => {
      let line = `\n• ${e.person}: ₹${fmt(e.amount)}`;
      if(e.note) line += ` (${e.note})`;
      if(e.isOverdue){
        line += ` — 🚨 OVERDUE by ${Math.abs(e.daysUntilDue)}d`;
      } else if(e.dueSoon){
        line += ` — ⚠️ Due in ${e.daysUntilDue}d`;
      } else if(e.daysUntilDue !== null){
        line += ` — Due in ${e.daysUntilDue}d`;
      } else {
        line += ` — ${e.daysSince}d ago`;
      }
      return line;
    };

    const youOweText  = youOwe.map(formatEntry).join("")  || "\nNone — you're clean!";
    const theyOweText = theyOwe.map(formatEntry).join("") || "\nNone";

    const netLine = netPosition >= 0
      ? `✅ Net: You are ₹${fmt(netPosition)} ahead`
      : `⚠️ Net: You are ₹${fmt(Math.abs(netPosition))} in the red`;

    sendMessage(
`💰 Debt Dashboard

🔴 You owe:${youOweText}

🟢 They owe you:${theyOweText}

${netLine}
Total you owe: ₹${fmt(totalYouOwe)}
Total owed to you: ₹${fmt(totalTheyOwe)}`
    );

    if(youOwe.length > 0){
      sendRepaymentPlan(youOwe, totalYouOwe);
    }

  } catch(err){
    logAI("DEBT_DASHBOARD_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   AI REPAYMENT PLAN
   Reads Savings sheet — fast and accurate
======================================= */
function sendRepaymentPlan(youOwe, totalYouOwe){

  try{

    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const fmt = (n) => Math.round(Math.abs(n)).toLocaleString('en-IN');

    // ── Read Savings sheet — fast, only a few rows ──
    const savSheet = ss.getSheetByName("Savings");
    const savData  = savSheet ? savSheet.getDataRange().getValues() : [];

    const today     = new Date();
    const thisMonth = today.getMonth();
    const thisYear  = today.getFullYear();

    let monthlySavings = 0;
    let totalSavings   = 0;

    for(let i = 1; i < savData.length; i++){
      const rawDate = savData[i][0];
      const amount  = Number(savData[i][1]) || 0;
      if(!rawDate) continue;
      const d = new Date(rawDate);
      totalSavings += amount;
      if(d.getFullYear() === thisYear && d.getMonth() === thisMonth){
        monthlySavings += amount;
      }
    }

    const debtList = youOwe
      .map(e => `- ${e.person}: ₹${fmt(e.amount)} (${e.note || "no note"}, ${e.daysSince}d pending)`)
      .join("\n");

    const prompt =
`Personal finance advisor for Indian user.

Savings this month: ₹${fmt(monthlySavings)}
Total savings: ₹${fmt(totalSavings)}
Total debt owed: ₹${fmt(totalYouOwe)}

Debts:
${debtList}

Write 4-5 lines: which debt to pay first and why, how much this month, multi-month plan if needed. Use real names and ₹ amounts. End with one motivating line. No preamble.`;

    const {GEMINI_KEY} = getConfig();
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {maxOutputTokens: 300}
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    const plan = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if(plan && plan.trim()){
      sendMessage("💡 AI Repayment Plan\n\n" + plan.trim());
    }

  }catch(err){
    logAI("REPAYMENT_PLAN_ERROR", err.toString());
  }
}


/* =======================================
   ADD A NEW DEBT ENTRY
======================================= */
function addDebtEntry(text, type){

  try{

    const {GEMINI_KEY} = getConfig();

    const prompt =
`Extract debt info from: "${text}"
Type: ${type}

Return ONLY JSON:
{"person":"first name capitalised","amount":number,"note":"max 5 words"}

If amount not found return amount:0. No explanation.`;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({contents:[{parts:[{text:prompt}]}]}),
      muteHttpExceptions: true
    });

    const json    = JSON.parse(response.getContentText());
    let rawText   = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    rawText       = rawText.replace(/```json|```/g,"").trim();

    let parsed;
    try{
      parsed = JSON.parse(rawText);
    }catch(e){
      sendMessage("❌ Couldn't parse that.\n\nTry: 'Raj 500 dinner' or 'Priya 2000 rent'");
      return;
    }

    if(!parsed.person || !parsed.amount){
      sendMessage("❌ Couldn't parse that.\n\nTry: 'Raj 500 dinner' or 'Priya 2000 rent'");
      return;
    }

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const debtSheet = ss.getSheetByName("Debts");

    if(!debtSheet){ sendMessage("❌ Debts sheet not found."); return; }

    const today = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    debtSheet.appendRow([
      today,
      parsed.person,
      type,
      parsed.amount,
      parsed.note || "",
      "",
      "Pending",
      ""
    ]);

    const fmt       = (n) => Math.round(n).toLocaleString('en-IN');
    const typeLabel = type === "BORROWED"
      ? `You borrowed ₹${fmt(parsed.amount)} from ${parsed.person}`
      : `You lent ₹${fmt(parsed.amount)} to ${parsed.person}`;

    sendMessage(
`✅ Recorded

${typeLabel}
📝 ${parsed.note || "No note"}

💡 Add a due date in column F of Debts sheet for reminders.`
    );

  }catch(err){
    logAI("ADD_DEBT_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   SETTLE LIST
======================================= */
function sendSettleList(){
  try{
    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const debtSheet = ss.getSheetByName("Debts");
    const data      = debtSheet.getDataRange().getValues();
    const fmt       = (n) => Math.round(n).toLocaleString('en-IN');

    let list    = "";
    let pending = [];

    for(let i = 1; i < data.length; i++){
      const person = (data[i][1] || "").toString().trim();
      const type   = (data[i][2] || "").toString().trim().toUpperCase();
      const amount = Number(data[i][3]) || 0;
      const note   = (data[i][4] || "").toString().trim();
      const status = (data[i][6] || "Pending").toString().trim();

      if(!person || status === "Settled") continue;

      const label = type === "BORROWED" ? "you owe" : "owes you";
      pending.push({row: i+1, person, amount, note, type});
      list += `\n${pending.length}. ${person} ${label} ₹${fmt(amount)}${note ? " — "+note : ""}`;
    }

    if(!pending.length){
      sendMessage("✅ No pending debts. You're all clear!");
      return;
    }

    PropertiesService.getScriptProperties()
      .setProperty("pendingDebtList", JSON.stringify(pending));

    sendMessage(
`📋 Pending debts:${list}

Full settlement → just the number
Example: 2

Partial payment → number:amount
Example: 2:500`
    );

  }catch(err){
    logAI("SETTLE_LIST_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   PROCESS SETTLEMENT
======================================= */
function processSettlement(text){
  try{

    const raw = PropertiesService.getScriptProperties()
      .getProperty("pendingDebtList");
    if(!raw){ sendMessage("❌ Session expired. Open Debts menu again."); return; }

    const pending    = JSON.parse(raw);
    const parts      = text.trim().split(":");
    const index      = parseInt(parts[0]) - 1;
    const partialAmt = parts.length > 1 ? Number(parts[1]) : null;
    const fmt        = (n) => Math.round(n).toLocaleString('en-IN');

    if(isNaN(index) || index < 0){
      sendMessage("❌ Invalid format. Try: 2 for full, or 2:500 for partial.");
      return;
    }

    const entry = pending[index];
    if(!entry){ sendMessage("❌ Invalid number. Try again."); return; }

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const debtSheet = ss.getSheetByName("Debts");
    const today     = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    PropertiesService.getScriptProperties().deleteProperty("pendingDebtList");

    // ── Full settlement ──
    if(partialAmt === null){
      debtSheet.getRange(entry.row, 7).setValue("Settled");
      debtSheet.getRange(entry.row, 8).setValue(today);
      sendMessage(
`✅ Fully settled!

${entry.person} — ₹${fmt(entry.amount)}
📅 Settled on ${today}`
      );
      return;
    }

    // ── Partial settlement ──
    if(partialAmt <= 0 || partialAmt >= entry.amount){
      sendMessage(`❌ Must be between ₹1 and ₹${fmt(entry.amount - 1)}`);
      return;
    }

    const remaining    = entry.amount - partialAmt;
    const existingNote = debtSheet.getRange(entry.row, 5).getValue().toString().trim();
    const updatedNote  = existingNote
      ? `${existingNote} | Paid ₹${partialAmt} on ${today}`
      : `Paid ₹${partialAmt} on ${today}`;

    debtSheet.getRange(entry.row, 4).setValue(remaining);
    debtSheet.getRange(entry.row, 5).setValue(updatedNote);
    debtSheet.getRange(entry.row, 7).setValue("Pending");

    sendMessage(
`✅ Partial payment recorded

${entry.person}
💸 Paid: ₹${fmt(partialAmt)}
⏳ Remaining: ₹${fmt(remaining)}
📝 History saved`
    );

  }catch(err){
    logAI("SETTLEMENT_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   DAILY OVERDUE + DUE SOON CHECK
   Run every morning via trigger
======================================= */
function checkDebtDueDates(){

  try{

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const debtSheet = ss.getSheetByName("Debts");
    if(!debtSheet) return;

    const data  = debtSheet.getDataRange().getValues();
    const today = new Date();
    today.setHours(0,0,0,0);
    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    let overdueList = [];
    let dueSoonList = [];

    for(let i = 1; i < data.length; i++){

      const person  = (data[i][1] || "").toString().trim();
      const type    = (data[i][2] || "").toString().trim().toUpperCase();
      const amount  = Number(data[i][3]) || 0;
      const note    = (data[i][4] || "").toString().trim();
      const dueDate = data[i][5];
      const status  = (data[i][6] || "Pending").toString().trim();

      if(!person || !amount || status === "Settled" || !dueDate) continue;

      const due = new Date(dueDate);
      due.setHours(0,0,0,0);
      const daysUntilDue = Math.ceil((due - today) / 86400000);

      if(type === "BORROWED"){
        if(daysUntilDue < 0){
          overdueList.push(`• ${person}: ₹${fmt(amount)} — overdue by ${Math.abs(daysUntilDue)} days`);
        } else if(daysUntilDue <= 7){
          dueSoonList.push(`• ${person}: ₹${fmt(amount)} — due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`);
        }
      }
    }

    if(overdueList.length > 0){
      sendMessage(
`🚨 Overdue Debt Alert!

${overdueList.join("\n")}

Tap Debts → Dashboard to see your repayment plan.`
      );
    }

    if(dueSoonList.length > 0){
      sendMessage(
`⚠️ Debt Due Soon

${dueSoonList.join("\n")}

Tap Debts → Dashboard to plan payments.`
      );
    }

  }catch(err){
    logAI("DEBT_DUEDATE_ERROR", err.toString());
  }
}


/* =======================================
   TEST FUNCTION
======================================= */
function testRepaymentPlan(){
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const debtSheet = ss.getSheetByName("Debts");
  const data      = debtSheet.getDataRange().getValues();
  const today     = new Date();
  today.setHours(0,0,0,0);

  let youOwe      = [];
  let totalYouOwe = 0;

  for(let i = 1; i < data.length; i++){
    const person  = (data[i][1] || "").toString().trim();
    const type    = (data[i][2] || "").toString().trim().toUpperCase();
    const amount  = Number(data[i][3]) || 0;
    const dueDate = data[i][5];
    const status  = (data[i][6] || "Pending").toString().trim();

    if(!person || !amount || status === "Settled") continue;

    let daysUntilDue = null;
    let isOverdue    = false;
    let dueSoon      = false;

    if(dueDate){
      const due = new Date(dueDate);
      due.setHours(0,0,0,0);
      daysUntilDue = Math.ceil((due - today) / 86400000);
      isOverdue    = daysUntilDue < 0;
      dueSoon      = daysUntilDue >= 0 && daysUntilDue <= 7;
    }

    if(type === "BORROWED"){
      youOwe.push({
        person, amount,
        note: data[i][4] || "",
        daysSince: 0,
        daysUntilDue, isOverdue, dueSoon
      });
      totalYouOwe += amount;
    }
  }

  Logger.log("Entries: " + youOwe.length + " Total: " + totalYouOwe);
  sendRepaymentPlan(youOwe, totalYouOwe);
}

/* =======================================
   DEBT PAYOFF / COLLECTION TRAJECTORY (added 2026-09-21)
   Plain-English: instead of just "you owe ₹10,000," this works out
   "at the rate you've actually been paying it down, you'll be
   debt-free by around March 2027" — and the mirror version for money
   owed TO you ("on pace to collect it all by ~<date>"). Pushed only
   right after a real payment/settlement changes something (see
   applyDebtPayment/settleDebtRow in PWA.js, which call
   pushDebtPaymentUpdate below) — never on a schedule, since there's
   nothing new to say until something actually changes.
======================================= */

// A running log of every real debt payment ever made/received — added
// 2026-09-21 because, until now, the Debts sheet only ever stored the
// CURRENT outstanding amount (reduced in place by applyDebtPayment),
// with no record of past payments to compute a real "pace" from. One
// row per payment, auto-created the same way every other sheet in this
// app self-creates on first use (see e.g. getFinancialEventsSheet in
// financialEvents.js).
function getDebtPaymentsSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("DebtPayments");
  if(!sheet){
    sheet = ss.insertSheet("DebtPayments");
    sheet.appendRow(["Date", "Row", "Person", "Type", "AmountPaid"]);
  }
  return sheet;
}

// Records one real payment (a partial payment OR a full settlement —
// both count as "money that actually moved just now"). "Row" is the
// Debts sheet row this payment was against — kept for traceability,
// not used by the pace math itself (which only cares about date/type/
// amount).
function logDebtPayment_(row, person, type, amountPaid){
  var sheet = getDebtPaymentsSheet_();
  sheet.appendRow([new Date(), row, person || "", type, Number(amountPaid) || 0]);
}

// The actual trajectory math for one direction. direction must be
// "BORROWED" (what you owe) or "LENT" (what's owed to you) — matches
// the Debts sheet's own Type values exactly.
//
// outstanding: total still Pending for this direction, read straight
//   from Debts (a SPLIT-type row, a rare legacy value, is counted
//   alongside LENT here — same grouping getDebtsData already uses for
//   "totalTheyOwe", so this number always agrees with what the Debts
//   screen itself shows).
// monthlyPace: real ₹ actually paid/collected in the last ~90 days,
//   averaged to a per-month rate (÷3). Deliberately NOT an all-time
//   average — a pace from 2 years ago says nothing about whether
//   you're keeping it up now.
// projectedDate: today + (outstanding ÷ monthlyPace) months, using an
//   average month length (30.44 days) — a rough "by ~Month Year"
//   estimate, not a precise day-level countdown, which is honest about
//   what this number actually is.
// If there's nothing outstanding, or no real repayment/collection
// activity in the last 90 days, this deliberately does NOT invent a
// fake date — see hasProjection/message below.
function getDebtTrajectory(direction){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var debtSheet = ss.getSheetByName("Debts");
  var debtsData = debtSheet ? debtSheet.getDataRange().getValues() : [];

  var outstanding = 0;
  var count = 0;
  for(var i = 1; i < debtsData.length; i++){
    var type = (debtsData[i][2] || "").toString().trim().toUpperCase();
    var amount = Number(debtsData[i][3]) || 0;
    var status = (debtsData[i][6] || "Pending").toString().trim();
    if(status === "Settled" || !amount) continue;
    var matchesDirection = (type === direction) || (direction === "LENT" && type === "SPLIT");
    if(!matchesDirection) continue;
    outstanding += amount;
    count++;
  }

  var paymentsSheet = ss.getSheetByName("DebtPayments");
  var paymentsData = paymentsSheet ? paymentsSheet.getDataRange().getValues() : [];

  var since = new Date();
  since.setDate(since.getDate() - 90);

  var recentPaid = 0;
  for(var j = 1; j < paymentsData.length; j++){
    var pDateRaw = paymentsData[j][0];
    var pType = (paymentsData[j][3] || "").toString().trim().toUpperCase();
    if(!pDateRaw || pType !== direction) continue;
    var pDate = new Date(pDateRaw);
    if(pDate < since) continue;
    recentPaid += Number(paymentsData[j][4]) || 0;
  }

  var monthlyPace = recentPaid / 3; // ~90 days of real activity, turned into a monthly rate

  var result = {
    direction: direction,
    outstanding: outstanding,
    count: count,
    recentPaid90d: recentPaid,
    monthlyPace: monthlyPace,
    hasProjection: false,
    projectedDate: null,
    projectedLabel: null,
    message: null
  };

  if(outstanding <= 0){
    result.message = direction === "BORROWED" ? "You're debt-free!" : "Fully collected — nothing left owed to you.";
    return result;
  }

  if(monthlyPace <= 0){
    result.message = "no " + (direction === "BORROWED" ? "repayments" : "collections") + " in the last 3 months, can't project a date yet";
    return result;
  }

  var monthsNeeded = outstanding / monthlyPace;
  var projected = new Date();
  projected.setDate(projected.getDate() + Math.round(monthsNeeded * 30.44));

  result.hasProjection = true;
  result.projectedDate = projected;
  result.projectedLabel = Utilities.formatDate(projected, Session.getScriptTimeZone(), "MMMM yyyy");

  return result;
}

// Builds and sends the actual push, right after a real payment/
// settlement is saved (called from applyDebtPayment/settleDebtRow in
// PWA.js). Only ever pushes the ONE side that actually just changed —
// the caller passes the exact direction of the debt that was just
// paid/settled, so a BORROWED payment can never accidentally push the
// LENT ("owed to you") trajectory or vice versa.
function pushDebtPaymentUpdate(direction, personLabel, amountPaid){
  try{
    var trajectory = getDebtTrajectory(direction);
    var fmt = function(n){ return Math.round(n).toLocaleString('en-IN'); };

    var headline = direction === "BORROWED"
      ? "✅ ₹" + fmt(amountPaid) + " repaid to " + personLabel
      : "✅ ₹" + fmt(amountPaid) + " collected from " + personLabel;

    var body;
    if(trajectory.outstanding <= 0){
      body = trajectory.message;
    } else {
      var countLabel = trajectory.count === 1 ? "1 debt" : (trajectory.count + " debts");
      var totalLabel = direction === "BORROWED"
        ? "₹" + fmt(trajectory.outstanding) + " left across " + countLabel
        : "₹" + fmt(trajectory.outstanding) + " still owed to you across " + countLabel;

      if(trajectory.hasProjection){
        var actionWord = direction === "BORROWED" ? "debt-free" : "fully collected";
        body = totalLabel + " — on pace to be " + actionWord + " by ~" + trajectory.projectedLabel + ".";
      } else {
        body = totalLabel + " — " + trajectory.message + ".";
      }
    }

    sendMessage(headline + "\n\n" + body);
  }catch(err){
    logAI("DEBT_TRAJECTORY_PUSH_ERROR", err.toString());
  }
}

function debugRepaymentPlan(){
  try{
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const savSheet = ss.getSheetByName("Savings");

    if(!savSheet){
      Logger.log("ERROR: Savings sheet not found");
      sendMessage("DEBUG: Savings sheet not found");
      return;
    }

    Logger.log("Savings sheet found");

    const savData = savSheet.getDataRange().getValues();
    Logger.log("Savings rows: " + savData.length);

    const {GEMINI_KEY} = getConfig();
    Logger.log("Gemini key exists: " + (GEMINI_KEY ? "YES" : "NO"));

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{parts: [{text: "Say hello in one word"}]}],
        generationConfig: {maxOutputTokens: 10}
      }),
      muteHttpExceptions: true
    });

    const responseText = response.getContentText();
    Logger.log("Gemini response: " + responseText);

    const json = JSON.parse(responseText);
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    Logger.log("Extracted text: " + text);

    sendMessage("DEBUG: Gemini says — " + (text || "EMPTY RESPONSE"));

  }catch(err){
    Logger.log("ERROR: " + err.toString());
    sendMessage("DEBUG ERROR: " + err.toString());
  }
}