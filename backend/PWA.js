/* ============================================
   PWA ENTRY POINT
   Handles requests from the personal finance PWA.
   Kept separate from Telegram's logic on purpose.
============================================ */

// Only this Google account is allowed in.
const PWA_ALLOWED_EMAIL = "ronitnadar9@gmail.com";

// Must match the Client ID used in the PWA's webpage.
const PWA_CLIENT_ID = "1090460874478-0mnc81l34b10hi7n0u6bl9bkv9a45862.apps.googleusercontent.com";

function handlePwaRequest(data){

  // Ask Google directly: is this sign-in proof real, and whose is it?
  const verified = verifyGoogleIdToken(data.idToken);

  if(!verified){
    return jsonResponse({ ok:false, error:"Not signed in properly." });
  }

  if(verified.email.toLowerCase() !== PWA_ALLOWED_EMAIL.toLowerCase()){
    return jsonResponse({ ok:false, error:"This account is not allowed." });
  }

  // For today, just prove the check works.
  if(data.action === "ping"){
    return jsonResponse({ ok:true, message:"Hello " + verified.name + ", you're verified!" });
  }

  if(data.action === "getPending"){
    return jsonResponse({ ok:true, transactions: getPendingTransactions() });
  }

  if(data.action === "saveNote"){
    return jsonResponse(saveTransactionNote(data.row, data.note, data.category, data.counterparty, data.type, data.amount));
  }

  if(data.action === "getTodaySummary"){
    return jsonResponse({ ok:true, summary: getTodaySummary() });
  }

  if(data.action === "getMonthlyAnalysis"){
    return jsonResponse({ ok:true, analysis: getMonthlyAnalysis(data.year, data.month) });
  }

  if(data.action === "getCCAdvisor"){
    return jsonResponse({ ok:true, cc: getCCAdvisorData() });
  }

  if(data.action === "getDebts"){
    return jsonResponse({ ok:true, debts: getDebtsData() });
  }

  if(data.action === "addDebt"){
    return jsonResponse(addDebtEntryFromApp(data.person, data.type, data.amount, data.note, data.dueDate));
  }

  if(data.action === "settleDebt"){
    return jsonResponse(settleDebtRow(data.row));
  }

  if(data.action === "getSavings"){
    return jsonResponse({ ok:true, savings: getSavingsData() });
  }

  if(data.action === "logSaving"){
    return jsonResponse(logSavingFromApp(data.amount, data.type, data.note));
  }

  if(data.action === "addWishlistItem"){
    return jsonResponse(addWishlistItemFromApp(data.item, data.price, data.priority));
  }

  if(data.action === "markWishlistPurchased"){
    return jsonResponse(markWishlistPurchasedFromApp(data.row, data.item, data.price));
  }

  if(data.action === "getInvestments"){
    return jsonResponse({ ok:true, investments: getInvestmentsData() });
  }

  if(data.action === "logInvestment"){
    return jsonResponse(logInvestmentFromApp(data.amount, data.type));
  }

  if(data.action === "getCash"){
    return jsonResponse({ ok:true, cash: getCashData() });
  }

  if(data.action === "addCashEntry"){
    return jsonResponse(addCashEntryFromApp(data.type, data.amount, data.note, data.category));
  }

  if(data.action === "registerPushToken"){
    return jsonResponse(registerPushToken(data.token));
  }

  if(data.action === "getDashboard"){
    return jsonResponse({ ok:true, dashboard: getDashboardData() });
  }

  if(data.action === "reconcileStatement"){
    return jsonResponse(reconcileStatementPreview(data.fileBase64, data.fileName));
  }

  if(data.action === "insertReconciledTransactions"){
    return jsonResponse(insertReconciledTransactions(data.transactions));
  }

  if(data.action === "getSettings"){
    return jsonResponse({ ok:true, settings: getSettings() });
  }

  if(data.action === "updateSettings"){
    return jsonResponse(updateSettings(data.settings));
  }

  if(data.action === "getTransactionHistory"){
    return jsonResponse({ ok:true, ...getTransactionHistory(data.offset, data.limit) });
  }

  return jsonResponse({ ok:false, error:"Unknown action." });
}

// Pulls one number from each existing screen's data — reuses those
// functions directly rather than re-scanning the sheets from scratch.
function getDashboardData(){
  const now = new Date();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();

  // Read Transactions and Cash ONCE here and pass them into everything
  // below, instead of each function reading its own copy fresh — this
  // single call used to read Transactions up to 4 times and Cash twice.
  // Fixed 2026-08-08, same reasoning as the SmartMemory/TypeMemory
  // batching fix in getPendingTransactions.
  const txnData  = ss.getSheetByName("Transactions").getDataRange().getValues();
  const cashData = ss.getSheetByName("Cash").getDataRange().getValues();

  const today   = getTodaySummary(txnData, cashData);
  const month   = getMonthlyAnalysis(now.getFullYear(), now.getMonth() + 1, txnData, cashData);
  const cash    = getCashData(cashData);
  const cc      = getCCAdvisorData(txnData);
  const pending = getPendingTransactions(txnData);

  // Debts/Savings/Investments each read their own sheet(s) only once
  // already — no duplication to fix there, just reusing their results.
  const debts       = getDebtsData();
  const savings     = getSavingsData();
  const investments = getInvestmentsData();

  const recent = pending.slice(0, 3).map(function(t){
    return { label: t.counterparty || t.bank, amount: t.amount };
  });

  return {
    todaySpend:   today.total,
    monthSpend:   month.totalDebit,
    pendingCount: pending.length,
    cashBalance:  cash.balance,
    ccUsagePct:   cc.usagePct,
    debtsNet:     debts.netPosition,
    recent:       recent,

    // Full data for every tab, so the PWA can seed each tab's own cache
    // from this one call — opening any of them afterward is then instant,
    // no extra network round-trip needed. See index.html's loadDashboard.
    full: {
      today:       today,
      month:       month,
      cash:        cash,
      cc:          cc,
      debts:       debts,
      savings:     savings,
      investments: investments,
      pending:     pending
    }
  };
}

// Remembers your phone's push "address" so Apps Script knows where to
// send notifications later (Stage 8d). Single-user app, so one saved
// value is enough — same place BOT_TOKEN/CHAT_ID already live.
function registerPushToken(token){
  try{
    PropertiesService.getScriptProperties().setProperty("PWA_PUSH_TOKEN", token);
    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Same balance/today-spend logic as sendCashBalance() and sendTodayCash()
// in cash.js, combined into one call, plus a short recent-entries list.
// cashData is optional — pass an already-read Cash sheet's values to skip
// re-reading it (see getDashboardData, which reads Cash once and reuses
// it here and in getTodaySummary/getMonthlyAnalysis instead of each of
// them reading it fresh).
function getCashData(cashData){
  const data = cashData || SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cash").getDataRange().getValues();

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  let balance    = 0;
  let todaySpend = 0;
  let recent     = [];

  for(let i = 1; i < data.length; i++){
    const type     = (data[i][3] || "").toString().toLowerCase();
    const amount   = Number(data[i][4]) || 0;
    const note     = (data[i][5] || "").toString().trim();
    const rawDate  = data[i][1];

    if(type === "debit")  balance -= amount;
    if(type === "credit") balance += amount;

    if(rawDate){
      const d = Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd");
      if(d === today && type === "debit") todaySpend += amount;
    }

    recent.push({
      date:   rawDate ? Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "dd MMM") : "",
      type:   type,
      amount: amount,
      note:   note
    });
  }

  recent = recent.reverse().slice(0, 10); // newest first, last 10 only

  return { balance: balance, todaySpend: todaySpend, recent: recent };
}

// Writes one cash entry directly (structured fields, not free-text parsing
// like Telegram's processCashEntry — same reasoning as the other forms).
// Source is "PWA" instead of "Telegram" so entries are still traceable.
function addCashEntryFromApp(type, amount, note, category){
  try{
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cash");
    const now = new Date();

    sheet.appendRow([
      "",
      now,
      now,
      type,
      amount,
      note || "",
      category || "",
      "PWA",
      "",
      now
    ]);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Same data as sendInvestmentDashboard() in SavingsAdvisor.js, returned
// as plain data instead of a Telegram message.
function getInvestmentsData(){
  const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
  const data = investSheet.getDataRange().getValues();

  let typeTotals = {};
  let total = 0;

  for(let i = 1; i < data.length; i++){
    const type   = (data[i][1] || "Other").toString().trim();
    const amount = Number(data[i][2]) || 0;
    if(!amount) continue;
    typeTotals[type] = (typeTotals[type] || 0) + amount;
    total += amount;
  }

  const breakdown = Object.entries(typeTotals)
    .sort(function(a, b){ return b[1] - a[1]; })
    .map(function(e){ return { type: e[0], amount: e[1] }; });

  const recent = data.slice(1)
    .filter(function(r){ return r[0] && r[2]; })
    .sort(function(a, b){ return new Date(b[0]) - new Date(a[0]); })
    .slice(0, 5)
    .map(function(r){
      const dateLabel = Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "dd MMM");
      return { date: dateLabel, type: r[1], amount: Number(r[2]) || 0 };
    });

  return { total: total, breakdown: breakdown, recent: recent };
}

// Same as logInvestment() in SavingsAdvisor.js, minus the Telegram message
function logInvestmentFromApp(amount, type){
  try{
    const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    investSheet.appendRow([today, type, amount, ""]);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Reuses getSavingsTotals(), getSplitRule(), getStageLabel() from
// SavingsAdvisor.js, but passes the live Settings values into the two
// functions that accept overrides, instead of their hardcoded defaults
// — see settings.js for why those two specifically were changed and the
// rest of SavingsAdvisor.js wasn't.
function getSavingsData(){
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const savSheet  = ss.getSheetByName("Savings");
  const wishSheet = ss.getSheetByName("WishList");

  const settings = getSettings();
  const emergencyTarget = settings.monthlyExpenses * 3;

  const totals     = getSavingsTotals(savSheet);
  const split      = getSplitRule(totals.emergency, settings.monthlyExpenses, emergencyTarget);
  const stageLabel = getStageLabel(totals.emergency, settings.monthlyExpenses, emergencyTarget);

  const wishData = wishSheet.getDataRange().getValues();
  let wishItems = [];

  for(let i = 1; i < wishData.length; i++){
    const item     = (wishData[i][0] || "").toString().trim();
    const price    = Number(wishData[i][1]) || 0;
    const priority = (wishData[i][2] || "Medium").toString().trim();
    const status   = (wishData[i][3] || "Active").toString().trim();

    if(!item || status !== "Active") continue;

    wishItems.push({
      row: i + 1,
      item: item,
      price: price,
      priority: priority,
      canAfford: totals.wishlist >= price,
      remaining: Math.max(price - totals.wishlist, 0)
    });
  }

  return {
    emergency: totals.emergency,
    emergencyTarget: emergencyTarget,
    wishlist: totals.wishlist,
    free: totals.free,
    stageLabel: stageLabel,
    splitPct: {
      emergency: Math.round(split.emergency * 100),
      wishlist:  Math.round(split.wishlist * 100),
      free:      Math.round(split.free * 100)
    },
    monthlyGoal: settings.monthlySaveGoal,
    wishItems: wishItems
  };
}

// Same split-and-write logic as logSaving() in SavingsAdvisor.js, but
// skips the Telegram message — the PWA shows the result on screen instead.
function logSavingFromApp(amount, type, note){
  try{
    const savSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Savings");

    const settings = getSettings();
    const totals = getSavingsTotals(savSheet);
    const split  = getSplitRule(totals.emergency, settings.monthlyExpenses, settings.monthlyExpenses * 3);

    const emergencyAmt = Math.round(amount * split.emergency);
    const wishlistAmt  = Math.round(amount * split.wishlist);
    const freeAmt      = amount - emergencyAmt - wishlistAmt;

    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    if(emergencyAmt > 0) savSheet.appendRow([today, emergencyAmt, type, note, "Emergency"]);
    if(wishlistAmt  > 0) savSheet.appendRow([today, wishlistAmt, type, note, "WishList"]);
    if(freeAmt      > 0) savSheet.appendRow([today, freeAmt, type, note, "FreeSavings"]);

    return { ok: true, emergencyAmt: emergencyAmt, wishlistAmt: wishlistAmt, freeAmt: freeAmt };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Plain-fields version of addWishListItem() — no AI parsing
function addWishlistItemFromApp(item, price, priority){
  try{
    const wishSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WishList");
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    wishSheet.appendRow([item, price, priority || "Medium", "Active", today]);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Marks a wish list item purchased and deducts its price from the pot
function markWishlistPurchasedFromApp(row, item, price){
  try{
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const wishSheet = ss.getSheetByName("WishList");
    const savSheet  = ss.getSheetByName("Savings");

    if(!Number.isInteger(row) || row < 2 || row > wishSheet.getLastRow()){
      return { ok: false, error: "Invalid row." };
    }

    const today     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    wishSheet.getRange(row, 4).setValue("Purchased");
    savSheet.appendRow([today, -price, "purchase", "Purchased: " + item, "WishList"]);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Same logic as sendDebtDashboard() in DebtAdvisor.js, but returns plain
// data instead of a Telegram message.
function getDebtsData(){
  const debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");
  const data  = debtSheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let debts = [];
  let totalYouOwe  = 0;
  let totalTheyOwe = 0;

  for(let i = 1; i < data.length; i++){
    const person  = (data[i][1] || "").toString().trim();
    const type    = (data[i][2] || "").toString().trim().toUpperCase();
    const amount  = Number(data[i][3]) || 0;
    const note    = (data[i][4] || "").toString().trim();
    const dueDate = data[i][5];
    const status  = (data[i][6] || "Pending").toString().trim();

    if(!person || !amount || status === "Settled") continue;

    let daysUntilDue = null;
    let isOverdue    = false;
    let dueSoon      = false;

    if(dueDate){
      const due = new Date(dueDate);
      due.setHours(0, 0, 0, 0);
      daysUntilDue = Math.ceil((due - today) / 86400000);
      isOverdue    = daysUntilDue < 0;
      dueSoon      = daysUntilDue >= 0 && daysUntilDue <= 7;
    }

    debts.push({
      row: i + 1,
      person: person,
      type: type,
      amount: amount,
      note: note,
      dueDate: dueDate ? Utilities.formatDate(new Date(dueDate), Session.getScriptTimeZone(), "dd MMM yyyy") : "",
      daysUntilDue: daysUntilDue,
      isOverdue: isOverdue,
      dueSoon: dueSoon
    });

    if(type === "BORROWED") totalYouOwe += amount;
    else if(type === "LENT" || type === "SPLIT") totalTheyOwe += amount;
  }

  return {
    debts: debts,
    totalYouOwe:  totalYouOwe,
    totalTheyOwe: totalTheyOwe,
    netPosition:  totalTheyOwe - totalYouOwe
  };
}

// Adds a new debt entry from the PWA's form (no AI parsing — plain fields)
function addDebtEntryFromApp(person, type, amount, note, dueDate){
  try{
    const debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    debtSheet.appendRow([
      today,
      person,
      type,
      amount,
      note || "",
      dueDate || "",
      "Pending",
      ""
    ]);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Marks one debt row as fully settled
function settleDebtRow(row){
  try{
    const debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");

    if(!Number.isInteger(row) || row < 2 || row > debtSheet.getLastRow()){
      return { ok:false, error:"Invalid row." };
    }

    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    debtSheet.getRange(row, 7).setValue("Settled");
    debtSheet.getRange(row, 8).setValue(today);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Same billing-cycle math as sendCCAdvisorReport() in CCAdvisor.js, but
// returns plain data instead of sending a Telegram message, and reads
// the limit/warn/alert values from getSettings() (settings.js) instead
// of CCAdvisor.js's hardcoded constants, so the Settings screen actually
// affects this.
// txnData is optional — see getCashData's comment, same reasoning.
function getCCAdvisorData(txnData){

  const today      = new Date();
  const dayOfMonth = today.getDate();
  const thisMonth  = today.getMonth();
  const thisYear   = today.getFullYear();

  let cycleStart, cycleEnd, dueDate;
  if(dayOfMonth <= 18){
    cycleStart = new Date(thisYear, thisMonth - 1, 19);
    cycleEnd   = new Date(thisYear, thisMonth, 18);
    dueDate    = new Date(thisYear, thisMonth + 1, 9);
  } else {
    cycleStart = new Date(thisYear, thisMonth, 19);
    cycleEnd   = new Date(thisYear, thisMonth + 1, 18);
    dueDate    = new Date(thisYear, thisMonth + 2, 9);
  }

  const daysLeft     = Math.ceil((cycleEnd - today) / 86400000);
  const daysInCycle  = Math.ceil((cycleEnd - cycleStart) / 86400000);
  const daysElapsed  = daysInCycle - daysLeft;
  const daysUntilDue = Math.ceil((dueDate - today) / 86400000);

  const data = txnData || SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions").getDataRange().getValues();

  const settings  = getSettings();
  const ccLimit   = settings.ccLimit;
  const ccWarnAmt = ccLimit * settings.ccWarnPct;
  const ccAlertAmt = ccLimit * settings.ccAlertPct;

  let cycleSpend = 0;
  let txnCount   = 0;
  let categoryTotals = {};
  let cardTotals     = {};
  let recentCardTxns = []; // for the Home screen's "tap the CC widget" view — filled in below, formatted after the loop

  for(let i = 1; i < data.length; i++){
    const rawDate = data[i][0];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(d < cycleStart || d > today) continue;

    const type   = (data[i][3] || "").toString().toLowerCase();
    const mode   = (data[i][4] || "").toString().toLowerCase();
    const amount = Number(data[i][5]) || 0;
    const cat    = (data[i][13] || "Other").toString().trim();

    if(type === "debit" && mode.startsWith("card") && amount > 0){
      cycleSpend += amount;
      txnCount++;
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
      cardTotals[mode]    = (cardTotals[mode] || 0) + amount;
      recentCardTxns.push({
        date: d,
        counterparty: (data[i][7] || "").toString().trim(),
        note: (data[i][12] || "").toString().trim(), // column M — what you actually wrote, shown instead of the raw UPI ID when present
        amount: amount
      });
    }
  }

  const usagePct  = Math.round((cycleSpend / ccLimit) * 100);
  const remaining = ccLimit - cycleSpend;
  const dailyAvg  = daysElapsed > 0 ? cycleSpend / daysElapsed : 0;
  const projected = Math.round(dailyAvg * daysInCycle);
  const projectedPct = Math.round((projected / ccLimit) * 100);
  const safeDaily = (daysLeft > 0 && cycleSpend < ccAlertAmt)
    ? Math.round((ccAlertAmt - cycleSpend) / daysLeft)
    : 0;

  let status = "healthy";
  if(cycleSpend >= ccAlertAmt) status = "alert";
  else if(cycleSpend >= ccWarnAmt) status = "warning";

  const cardBreakdown = Object.entries(cardTotals)
    .sort(function(a, b){ return b[1] - a[1]; })
    .map(function(e){ return { card: e[0].toUpperCase(), amount: e[1] }; });

  const topCategories = Object.entries(categoryTotals)
    .sort(function(a, b){ return b[1] - a[1]; })
    .slice(0, 4)
    .map(function(e){ return { category: e[0], amount: e[1] }; });

  const fmtDate = function(d){
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM yyyy");
  };

  // Newest first, last 5 only — enough for a quick glance on Home.
  const recentCardTxnsFormatted = recentCardTxns
    .sort(function(a, b){ return b.date - a.date; })
    .slice(0, 5)
    .map(function(t){ return { date: fmtDate(t.date), counterparty: t.counterparty, note: t.note, amount: t.amount }; });

  return {
    cycleStart: fmtDate(cycleStart),
    cycleEnd:   fmtDate(cycleEnd),
    dueDate:    fmtDate(dueDate),
    daysLeft: daysLeft,
    daysUntilDue: daysUntilDue,
    cycleSpend: cycleSpend,
    limit: ccLimit,
    usagePct: usagePct,
    remaining: remaining,
    projected: projected,
    projectedPct: projectedPct,
    safeDaily: safeDaily,
    status: status,
    txnCount: txnCount,
    cardBreakdown: cardBreakdown,
    topCategories: topCategories,
    recentCardTxns: recentCardTxnsFormatted
  };
}

// Full breakdown for one month: total spend, income, savings, top expense,
// and spending by category — combining bank/UPI and cash.
// txnData/cashData are optional — see getCashData's comment, same reasoning.
function getMonthlyAnalysis(year, month, txnData, cashData){
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  txnData  = txnData  || ss.getSheetByName("Transactions").getDataRange().getValues();
  cashData = cashData || ss.getSheetByName("Cash").getDataRange().getValues();

  let totalDebit  = 0;
  let totalCredit = 0;
  let categoryTotals = {};
  let dailyTotals    = {};
  let topAmount = 0;
  let topNote   = "";

  for(let i = 1; i < txnData.length; i++){
    const rawDate = txnData[i][0];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(d.getFullYear() === year && (d.getMonth() + 1) === month){
      const type     = (txnData[i][3] || "").toString().toLowerCase();
      const amount   = Number(txnData[i][5]) || 0;
      const category = txnData[i][13] || "Other";
      const note     = txnData[i][12] || "";
      const day      = d.getDate();

      if(type === "debit"){
        totalDebit += amount;
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        dailyTotals[day] = (dailyTotals[day] || 0) + amount;
        if(amount > topAmount){ topAmount = amount; topNote = note; }
      } else if(type === "credit"){
        totalCredit += amount;
      }
    }
  }

  for(let i = 1; i < cashData.length; i++){
    const rawDate = cashData[i][1];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(d.getFullYear() === year && (d.getMonth() + 1) === month){
      const type     = (cashData[i][3] || "").toString().toLowerCase();
      const amount   = Number(cashData[i][4]) || 0;
      const category = cashData[i][6] || "Other";
      const day      = d.getDate();

      if(type === "debit"){
        totalDebit += amount;
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        dailyTotals[day] = (dailyTotals[day] || 0) + amount;
        if(amount > topAmount){ topAmount = amount; topNote = category || "Cash Spend"; }
      } else if(type === "credit"){
        totalCredit += amount;
      }
    }
  }

  const savings = totalCredit - totalDebit;
  const days    = Object.keys(dailyTotals).length || 1;
  const avgDaily = Math.round(totalDebit / days);

  const categories = Object.entries(categoryTotals)
    .sort(function(a, b){ return b[1] - a[1]; })
    .map(function(entry){ return { category: entry[0], amount: entry[1] }; });

  return {
    totalDebit:  totalDebit,
    totalCredit: totalCredit,
    savings:     savings,
    avgDaily:    avgDaily,
    topAmount:   topAmount,
    topNote:     topNote,
    categories:  categories
  };
}

// Adds up everything spent today, from both bank/UPI and cash, by category.
// txnData/cashData are optional — see getCashData's comment, same reasoning.
function getTodaySummary(txnData, cashData){
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  txnData  = txnData  || ss.getSheetByName("Transactions").getDataRange().getValues();
  cashData = cashData || ss.getSheetByName("Cash").getDataRange().getValues();

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  let bankSpend = 0;
  let cashSpend = 0;
  let totalTxn  = 0;
  let categoryTotals = {};

  for(let i = 1; i < txnData.length; i++){
    const rawDate = txnData[i][0];
    if(!rawDate) continue;
    const d = Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd");
    if(d === today && (txnData[i][3] || "").toString().toLowerCase() === "debit"){
      const amount   = Number(txnData[i][5]) || 0;
      const category = txnData[i][13] || "Other";
      bankSpend += amount;
      totalTxn++;
      categoryTotals[category] = (categoryTotals[category] || 0) + amount;
    }
  }

  for(let i = 1; i < cashData.length; i++){
    const rawDate = cashData[i][1];
    if(!rawDate) continue;
    const d    = Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const type = (cashData[i][3] || "").toString().toLowerCase();
    if(d === today && type === "debit"){
      const amount   = Number(cashData[i][4]) || 0;
      const category = cashData[i][6] || "Other";
      cashSpend += amount;
      categoryTotals[category] = (categoryTotals[category] || 0) + amount;
    }
  }

  const categories = Object.entries(categoryTotals)
    .sort(function(a, b){ return b[1] - a[1]; })
    .map(function(entry){ return { category: entry[0], amount: entry[1] }; });

  return {
    bankSpend: bankSpend,
    cashSpend: cashSpend,
    total: bankSpend + cashSpend,
    transactionCount: totalTxn,
    categories: categories
  };
}

// Finds bank transactions that were already alerted but still have no note —
// same definition Telegram's /pending command already uses.
// txnData is optional — see getCashData's comment, same reasoning.
function getPendingTransactions(txnData){
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const data  = txnData || ss.getSheetByName("Transactions").getDataRange().getValues();
  const pending = [];

  // Read these two lookup sheets ONCE, outside the loop below, and reuse
  // them for every pending transaction. Re-reading them fresh per
  // transaction (the old approach) is what made this take 60-90+ seconds
  // once there was a real backlog and real learned data — see
  // docs/features/need-want-saving.md.
  const smartMemorySheet = ss.getSheetByName("SmartMemory");
  const smartMemoryData  = smartMemorySheet ? smartMemorySheet.getDataRange().getValues() : [];

  const typeMemorySheet = ss.getSheetByName("TypeMemory");
  const typeMemoryData  = typeMemorySheet ? typeMemorySheet.getDataRange().getValues() : [];

  for(let i = 1; i < data.length; i++){
    const processed = (data[i][15] || "").toString().trim(); // column P
    const note       = (data[i][12] || "").toString().trim(); // column M

    if(processed !== "YES") continue; // hasn't even been alerted yet
    if(note) continue;                // already has a note

    const bank        = data[i][2] || "";
    const txnType     = data[i][3] || ""; // "debit" or "credit"
    const mode        = data[i][4] || "";
    const amount      = Number(data[i][5]) || 0;
    const counterparty = data[i][7] || "";

    const suggestedCategory = getSuggestedCategoryFast(counterparty, amount, mode, smartMemoryData);

    pending.push({
      row:               i + 1,
      date:              Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "dd MMM yyyy"),
      time:              Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), "HH:mm"),
      bank:              bank,
      type:              txnType,
      mode:              mode,
      amount:            amount,
      counterparty:      counterparty,
      suggestedCategory: suggestedCategory,
      // Need/Want/Saving guess — null means "don't show a default" (credit,
      // a debt-settlement category, or an unrecognized merchant). See
      // docs/features/need-want-saving.md.
      suggestedType:     getSuggestedType(txnType, suggestedCategory, counterparty, amount, typeMemoryData)
    });
  }

  return pending.reverse(); // newest first
}

// Already-noted transactions (the opposite filter from
// getPendingTransactions) for the History screen's browse-and-edit flow.
// offset/limit paginate, newest first — defaults to the first 20.
// See docs/features/history.md.
function getTransactionHistory(offset, limit){
  offset = Number(offset) || 0;
  limit  = Number(limit) || 20;

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Transactions");
  const data  = sheet.getDataRange().getValues();

  const noted = [];

  for(let i = 1; i < data.length; i++){
    const processed = (data[i][15] || "").toString().trim();
    const note       = (data[i][12] || "").toString().trim();

    if(processed !== "YES") continue;
    if(!note) continue;

    noted.push({
      row:          i + 1,
      date:         Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "dd MMM yyyy"),
      time:         Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), "HH:mm"),
      bank:         data[i][2] || "",
      type:         data[i][3] || "",
      mode:         data[i][4] || "",
      amount:       Number(data[i][5]) || 0,
      counterparty: data[i][7] || "",
      note:         note,
      category:     data[i][13] || "Other"
    });
  }

  noted.reverse(); // newest first
  const page = noted.slice(offset, offset + limit);

  // Only compute Need/Want/Saving guesses for the one page actually being
  // returned, not the whole history — and batch-read TypeMemory once for
  // that page instead of per row (same reasoning as getPendingTransactions).
  const typeMemorySheet = ss.getSheetByName("TypeMemory");
  const typeMemoryData  = typeMemorySheet ? typeMemorySheet.getDataRange().getValues() : [];

  page.forEach(function(t){
    // Uses the transaction's REAL stored category (not a fresh guess) —
    // it may have been deliberately chosen differently than the category
    // engine would suggest, and that choice should be respected here.
    t.suggestedType = getSuggestedType(t.type, t.category, t.counterparty, t.amount, typeMemoryData);
  });

  return {
    total:        noted.length,
    transactions: page
  };
}

// A fast, no-AI-call category guess — reuses the same merchant memory and
// keyword patterns as the full smart category engine in category.js, but
// skips the Gemini fallback layer so guessing 50+ pending items at once
// stays instant instead of making dozens of slow network calls.
// smartMemoryData is optional — see getSuggestedType's comment in
// needWantSaving.js for why (same pattern, same reason).
function getSuggestedCategoryFast(counterparty, amount, mode, smartMemoryData){
  try{
    if(!counterparty) return "Other";

    let memData = smartMemoryData;
    if(!memData){
      const smartMemory = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("SmartMemory");
      if(!smartMemory) return "Other";
      memData = smartMemory.getDataRange().getValues();
    }

    const cleanCounterparty = normalizeText(counterparty);

    const exactMatch = findMerchantMatch(cleanCounterparty, memData, true);
    if(exactMatch && exactMatch.confidence >= CONFIDENCE_THRESHOLD) return exactMatch.category;

    const fuzzyMatch = findMerchantMatch(cleanCounterparty, memData, false);
    if(fuzzyMatch && fuzzyMatch.confidence >= CONFIDENCE_THRESHOLD) return fuzzyMatch.category;

    const patternMatch = matchByPattern("", cleanCounterparty, amount, mode);
    if(patternMatch && patternMatch.confidence >= CONFIDENCE_THRESHOLD) return patternMatch.category;

    return "Other";
  }catch(err){
    return "Other";
  }
}

// Writes the note + category you typed back into the right row.
// Writes the note + category you typed back into the right row, and
// teaches the smart category engine this merchant -> category mapping
// (same as confirming a category correction on Telegram).
// amount is optional — only the History screen's edit flow sends it
// (Pending never does, since the parsed amount is trusted there). This
// same function backs both "add a note to a pending transaction" and
// "edit a past transaction," since editing a category/type later should
// teach SmartMemory/TypeMemory exactly like a first-time correction does
// (confirmed with the user 2026-08-08) — reusing this function is what
// gets that for free instead of writing a second, parallel code path.
function saveTransactionNote(row, note, category, counterparty, type, amount){
  try{
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");

    // The app sends which row to write to — make sure it's a real data
    // row (not the header, not something out of range) before touching
    // the sheet. Row 1 is headers, so the smallest valid row is 2.
    if(!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()){
      return { ok:false, error:"Invalid row." };
    }

    sheet.getRange(row, 13).setValue(note);     // column M
    sheet.getRange(row, 14).setValue(category); // column N

    if(amount !== undefined && amount !== null && amount !== ""){
      sheet.getRange(row, 6).setValue(Number(amount)); // column F
    }

    if(counterparty){
      handleCategoryCorrection(counterparty, category, "Other");
    }

    // Record a Need/Want/Saving vote too — only if a type was actually
    // confirmed/corrected. Some transactions never get a type suggestion
    // at all (credit, a debt-settlement category, unrecognized merchant),
    // so the PWA won't send one for those, and there's nothing to vote on.
    if(counterparty && type){
      const voteAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F, reflects the edit above if any
      recordTypeVote(counterparty, voteAmount, type);
    }

    return { ok:true };
  }catch(err){
    return { ok:false, error: err.toString() };
  }
}

function verifyGoogleIdToken(idToken){
  try{
    if(!idToken) return null;

    const response = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );

    if(response.getResponseCode() !== 200) return null;

    const info = JSON.parse(response.getContentText());

    // Make sure the proof was issued for OUR app specifically
    if(info.aud !== PWA_CLIENT_ID) return null;

    return { email: info.email, name: info.name || info.email };

  }catch(err){
    return null;
  }
}

function jsonResponse(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}