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

  // Every action below this point is wrapped in one shared safety net.
  // The "write" actions (saveNote, addDebt, etc.) already had their own
  // try/catch inside them, so this was mostly redundant for those — but
  // the "read" actions that load a screen (getPending, getTodaySummary,
  // getMonthlyAnalysis, getCCAdvisor, getDebts, getSavings, getInvestments,
  // getCash, getDashboard, getTransactionHistory) had NONE. If any of
  // those hit something unexpected, the error used to escape all the way
  // up past doPost, returning Apps Script's own raw error page instead of
  // this app's clean {ok:false, error} shape. Found during a full-app
  // review 2026-08-10 — wrapping the whole dispatch here (once, centrally)
  // instead of adding try/catch to ten separate functions means any
  // action added later gets this protection automatically too.
  try{

  // For today, just prove the check works.
  if(data.action === "ping"){
    return jsonResponse({ ok:true, message:"Hello " + verified.name + ", you're verified!" });
  }

  if(data.action === "getPending"){
    return jsonResponse({ ok:true, transactions: getPendingTransactions() });
  }

  if(data.action === "saveNote"){
    return jsonResponse(saveTransactionNote(data.row, data.note, data.category, data.counterparty, data.type, data.amount, data.financialEvent, data.financialEventName));
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

  if(data.action === "updateInvestment"){
    return jsonResponse(updateInvestmentEntry(data.row, data.type, data.amount));
  }

  if(data.action === "getCash"){
    return jsonResponse({ ok:true, cash: getCashData() });
  }

  if(data.action === "addCashEntry"){
    return jsonResponse(addCashEntryFromApp(data.type, data.amount, data.note, data.category, data.needWantSaving));
  }

  if(data.action === "updateCashEntry"){
    return jsonResponse(updateCashEntry(data.row, data.type, data.amount, data.note, data.category, data.needWantSaving));
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

  }catch(err){
    logAI("PWA_REQUEST_ERROR", (data.action || "unknown") + ": " + err.toString());
    return jsonResponse({ ok:false, error: "Something went wrong loading this — try again in a moment. (" + err.toString() + ")" });
  }
}

// Pulls one number from each existing screen's data — reuses those
// functions directly rather than re-scanning the sheets from scratch.
function getDashboardData(){
  const now = new Date();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();

  // Read Transactions and Cash ONCE here and pass them into everything
  // below, instead of each function reading its own copy fresh — this
  // single call used to read Transactions up to 4 times and Cash twice.
  // Fixed 2026-08-08, same reasoning as the SmartMemory/TypeVotes
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
    const category = (data[i][6] || "").toString().trim();
    const rawDate  = data[i][1];
    const needWantSaving = (data[i][10] || "").toString().trim() || null; // column K

    if(type === "debit")  balance -= amount;
    if(type === "credit") balance += amount;

    if(rawDate){
      const d = Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd");
      if(d === today && type === "debit") todaySpend += amount;
    }

    recent.push({
      row:            i + 1,
      date:           rawDate ? Utilities.formatDate(new Date(rawDate), Session.getScriptTimeZone(), "dd MMM") : "",
      type:           type,
      amount:         amount,
      note:           note,
      category:       category,
      needWantSaving: needWantSaving
    });
  }

  recent = recent.reverse().slice(0, 10); // newest first, last 10 only

  return { balance: balance, todaySpend: todaySpend, recent: recent };
}

// Writes one cash entry directly (structured fields, not free-text parsing
// like Telegram's processCashEntry — same reasoning as the other forms).
// Source is "PWA" instead of "Telegram" so entries are still traceable.
//
// needWantSaving (added 2026-08-10): cash has no bank-parsed counterparty
// to key merchant learning on, unlike Transactions — so the cash NOTE
// itself stands in for "counterparty" wherever TypeVotes needs a key
// (e.g. writing "auto" every time for cash rickshaw rides behaves like a
// recurring merchant would). This reuses isLendingTransfer/recordTypeVote
// as-is, no parallel system needed. Column K (index 10) stores the
// actual chosen type for this specific entry, same role Transactions'
// column Q plays — never gated behind counterparty existing (see
// docs/features/need-want-saving.md for why that was a real bug there).
function addCashEntryFromApp(type, amount, note, category, needWantSaving){
  try{
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cash");
    const now = new Date();
    const cleanNote = note || "";

    const typeToSave = (needWantSaving && !isLendingTransfer(cleanNote, cleanNote)) ? needWantSaving : "";

    sheet.appendRow([
      "",
      now,
      now,
      type,
      amount,
      cleanNote,
      category || "",
      "PWA",
      "",
      now,
      typeToSave
    ]);

    if(typeToSave && cleanNote){
      recordTypeVote(cleanNote, Number(amount) || 0, typeToSave);
    }

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Fixes a past cash entry — added 2026-08-10. Cash previously had no way
// to correct a mistake (wrong amount, category, or type) short of
// editing the Sheet directly, unlike Transactions (which has History).
// Deliberately does NOT call handleCategoryCorrection — Cash has never
// fed SmartMemory (category is always picked manually there, same rule
// that already applies to first-time cash entries; see CLAUDE.md's
// SmartMemory pollution incident for why that boundary matters).
function updateCashEntry(row, type, amount, note, category, needWantSaving){
  try{
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cash");

    if(!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()){
      return { ok:false, error:"Invalid row." };
    }
    if(!amount || Number(amount) <= 0){
      return { ok:false, error:"Enter a valid amount." };
    }

    const cleanNote = note || "";
    const typeToSave = (needWantSaving && !isLendingTransfer(cleanNote, cleanNote)) ? needWantSaving : "";

    sheet.getRange(row, 4).setValue(type);              // column D
    sheet.getRange(row, 5).setValue(Number(amount));    // column E
    sheet.getRange(row, 6).setValue(cleanNote);          // column F
    sheet.getRange(row, 7).setValue(category || "");     // column G
    sheet.getRange(row, 11).setValue(typeToSave);         // column K

    if(typeToSave && cleanNote){
      recordTypeVote(cleanNote, Number(amount) || 0, typeToSave);
    }

    return { ok: true, typeRequested: !!needWantSaving, typeSaved: !!typeToSave };
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

  // row is tracked from the ORIGINAL sheet position, before the sort
  // below reorders everything by date — without this, editing an entry
  // later would have no reliable way to know which sheet row it came
  // from. Found missing during a full-app review 2026-08-10.
  const recent = data
    .map(function(r, idx){ return { row: idx + 1, rawDate: r[0], type: r[1], amount: Number(r[2]) || 0 }; })
    .slice(1)
    .filter(function(r){ return r.rawDate && r.amount; })
    .sort(function(a, b){ return new Date(b.rawDate) - new Date(a.rawDate); })
    .slice(0, 5)
    .map(function(r){
      return {
        row:    r.row,
        date:   Utilities.formatDate(new Date(r.rawDate), Session.getScriptTimeZone(), "dd MMM"),
        type:   r.type,
        amount: r.amount
      };
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

// Fixes a past investment entry's type/amount — added 2026-08-10.
// Investments previously had no way to correct a mistake short of
// editing the Sheet directly, unlike Transactions (which has History).
function updateInvestmentEntry(row, type, amount){
  try{
    const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");

    if(!Number.isInteger(row) || row < 2 || row > investSheet.getLastRow()){
      return { ok:false, error:"Invalid row." };
    }
    if(!amount || Number(amount) <= 0){
      return { ok:false, error:"Enter a valid amount." };
    }

    investSheet.getRange(row, 2).setValue(type);          // column B
    investSheet.getRange(row, 3).setValue(Number(amount)); // column C

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
  let categoryTxns   = {}; // category -> list of {note, amount, date}, so tapping a category on Analysis can show its actual top transactions
  let dailyTotals    = {};
  let topAmount = 0;
  let topNote   = "";

  // Need/Want/Saving/Investment breakdown — combines Transactions' column Q
  // and Cash's column K, both written the same way (see
  // docs/features/need-want-saving.md). "Untagged" covers debit entries
  // with nothing saved there yet (credit, Other-category, an unrecognized
  // merchant, a loan/repayment, or simply not answered yet) — tracked
  // openly rather than silently dropped, so the chart never overstates
  // how much of the month is actually accounted for.
  let typeTotals = { Need: 0, Want: 0, Saving: 0, Investment: 0 };
  let untaggedTotal = 0;
  let untaggedCount = 0;

  // Rent + confirmed EMIs vs real Investments — see financialEvents.js /
  // docs/features/financial-events.md. Kept apart from your day-to-day
  // spend total entirely, not just re-labeled.
  let fixedObligations = 0;
  let invested = 0;

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
      const mode     = txnData[i][4] || "";
      const reference = txnData[i][6] || "";
      const counterparty = txnData[i][7] || "";
      const financialEvent = (txnData[i][17] || "").toString().trim(); // column R

      if(type === "debit" && isCreditCardBillPayment(mode, counterparty, note)) continue; // settling spend already counted, not new spend
      if(type === "debit" && isWalletTopUp(counterparty, reference)) continue; // money moved into your own wallet, not spent yet — the real spend gets counted separately, below, as each wallet purchase happens
      // A loan/repayment isn't spending either — you expect the money back.
      // Skipped Need/Want/Saving already, but was never actually excluded
      // from the spend total itself until now (gap flagged during the
      // Financial Events design discussion, closed 2026-08-10).
      if(type === "debit" && isLendingTransfer(counterparty, note)) continue;

      if(type === "debit" && financialEvent){
        if(financialEvent === "Rent" || financialEvent === "EMI") fixedObligations += amount;
        else if(financialEvent === "Investment") invested += amount;
        continue; // not day-to-day spend — tracked as its own line, not blended into spend/category totals
      }

      if(type === "debit"){
        totalDebit += amount;
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        dailyTotals[day] = (dailyTotals[day] || 0) + amount;
        if(amount > topAmount){ topAmount = amount; topNote = note; }

        if(!categoryTxns[category]) categoryTxns[category] = [];
        categoryTxns[category].push({
          note:   note || counterparty || "",
          amount: amount,
          date:   Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM")
        });

        const savedType = (txnData[i][16] || "").toString().trim(); // column Q
        if(typeTotals.hasOwnProperty(savedType)){
          typeTotals[savedType] += amount;
        } else {
          untaggedTotal += amount;
          untaggedCount++;
        }
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

        const cashNote = (cashData[i][5] || "").toString().trim();
        if(!categoryTxns[category]) categoryTxns[category] = [];
        categoryTxns[category].push({
          note:   cashNote || "Cash Spend",
          amount: amount,
          date:   Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM")
        });

        const savedType = (cashData[i][10] || "").toString().trim(); // column K
        if(typeTotals.hasOwnProperty(savedType)){
          typeTotals[savedType] += amount;
        } else {
          untaggedTotal += amount;
          untaggedCount++;
        }
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
    .map(function(entry){
      const topTransactions = (categoryTxns[entry[0]] || [])
        .sort(function(a, b){ return b.amount - a.amount; })
        .slice(0, 5);
      return { category: entry[0], amount: entry[1], topTransactions: topTransactions };
    });

  const taggedTotal = typeTotals.Need + typeTotals.Want + typeTotals.Saving + typeTotals.Investment;

  return {
    totalDebit:  totalDebit,
    totalCredit: totalCredit,
    savings:     savings,
    avgDaily:    avgDaily,
    topAmount:   topAmount,
    topNote:     topNote,
    categories:  categories,
    fixedObligations: fixedObligations,
    invested:         invested,
    needWantSaving: {
      need:           typeTotals.Need,
      want:           typeTotals.Want,
      saving:         typeTotals.Saving,
      investment:     typeTotals.Investment,
      untagged:       untaggedTotal,
      untaggedCount:  untaggedCount,
      taggedTotal:    taggedTotal
    }
  };
}

// Recognizes a transaction that's actually a CREDIT CARD BILL PAYMENT —
// money settling card swipes already counted as spend when they
// happened, not new spending. Found during a full-app review 2026-08-10:
// nothing anywhere excluded these, so every card swipe was silently
// being counted twice in "Total Spend" — once at swipe time (mode
// starts with "card"), once again when the bill got paid off (a
// separate debit row, usually via UPI/NEFT to the card issuer).
// CC Advisor itself was never affected (it only ever counted
// mode-starts-with-"card" rows), just Today/Analysis's headline totals.
//
// This is a best-effort keyword match on the bank's own narration text
// — genuinely can't be fully certain without seeing real statement
// wording, so this needs a real-world check: watch your next card bill
// payment and confirm it's excluded from Total Spend as expected (and
// tell me if it isn't, or if it wrongly excludes something that wasn't
// actually a card payment).
function isCreditCardBillPayment(mode, counterparty, note){
  const m = (mode || "").toString().toLowerCase();
  if(m.startsWith("card")) return false; // an actual swipe, not a bill payment — never exclude these
  const text = ((counterparty || "") + " " + (note || "")).toLowerCase();
  return /\bcredit card\b/.test(text) || /\bcc bill\b/.test(text) || /\bcard bill\b/.test(text) || /\bcard payment\b/.test(text);
}

// Recognizes a transaction that's actually TOPPING UP a digital wallet
// (e.g. PayZapp) — money moving from your bank account into a wallet
// you already own, not being spent yet. Found 2026-08-10: nothing
// excluded these, so every wallet top-up was counted as spend once when
// the money moved in, then counted AGAIN as each small purchase was
// later made from that same wallet balance.
//
// First version of this check used Mode ("wallet" vs "upi"), but real
// data proved that wrong: an actual top-up row (recovered via a bank
// statement import) had Mode "upi", not "wallet", and a genuine small
// real purchase had its Counterparty filled in as "PayZapp Wallet" too
// (by the AI clean-up step) — so neither Mode nor Counterparty alone
// can tell them apart.
//
// What's actually reliable across every real row checked: a top-up is
// a full bank-to-wallet transfer, so it always carries a real UPI
// Reference number. Every genuine small in-wallet purchase (₹49, ₹42,
// ₹40, ₹404, ₹120, and a ₹1 test) had a BLANK Reference — the wallet
// just deducts from its own balance, no separate transfer reference is
// generated. So: mentions the wallet by name AND has a reference number
// = a top-up. Mentions the wallet but has no reference = a real spend.
function isWalletTopUp(counterparty, reference){
  const cp = (counterparty || "").toString().trim().toLowerCase();
  if(!(cp.includes("wallet") || cp.includes("payzapp"))) return false; // not about a wallet at all
  return (reference || "").toString().trim().length > 0;
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
      const mode = txnData[i][4] || "";
      const reference = txnData[i][6] || "";
      const counterparty = txnData[i][7] || "";
      const note = txnData[i][12] || "";
      const financialEvent = (txnData[i][17] || "").toString().trim(); // column R
      if(isCreditCardBillPayment(mode, counterparty, note)) continue; // settling spend already counted, not new spend
      if(isWalletTopUp(counterparty, reference)) continue; // money moved into your own wallet, not spent yet
      if(isLendingTransfer(counterparty, note)) continue; // a loan/repayment isn't spending — see the matching comment in getMonthlyAnalysis
      if(financialEvent) continue; // Rent/EMI/Investment — not day-to-day spend, see financialEvents.js

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

  const typeVotesSheet = ss.getSheetByName("TypeVotes");
  const typeVotesData  = typeVotesSheet ? typeVotesSheet.getDataRange().getValues() : [];

  const noteMemorySheet = ss.getSheetByName("NoteMemory");
  const noteMemoryData  = noteMemorySheet ? noteMemorySheet.getDataRange().getValues() : [];

  const financialEventsSheet = ss.getSheetByName("FinancialEvents");
  const financialEventsData  = financialEventsSheet ? financialEventsSheet.getDataRange().getValues() : [];

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

    // Rent/Investment suggestion — see financialEvents.js. Only makes
    // sense for a debit; a credit is never a Rent/Investment payment.
    // note is always empty here (Pending = unnoted transactions) — passed
    // through anyway for correctness, same reasoning as suggestedType above.
    const feSuggestion = txnType === "debit"
      ? suggestFinancialEvent(counterparty, amount, financialEventsData, note)
      : null;

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
      // note is always empty here (Pending = unnoted transactions), so
      // this can never catch a lending transfer before you've written a
      // note — that's an inherent limit of asking before you've said
      // anything, not a regression. Passed through anyway for correctness.
      suggestedType:     getSuggestedType(txnType, suggestedCategory, counterparty, amount, typeVotesData, note),
      // Remembered note for this merchant+amount — empty string means
      // "nothing confident enough yet," and the PWA falls back to showing
      // the merchant name instead. See docs/features/note-memory.md.
      suggestedNote:     getSuggestedNote(counterparty, amount, noteMemoryData),
      // Rent/EMI/Investment suggestion — see docs/features/financial-events.md.
      // confident=true means "matched a remembered amount or note, safe
      // for a single-tap confirm"; confident=false means "just a soft
      // keyword hint, needs a full manual confirm." suggestedFinancialEventName
      // is only meaningful for EMI — null there means "looks like SOME
      // EMI, but not one recognized yet — needs to be named."
      financialEvent:              null, // never set yet — Pending is always unconfirmed by definition
      financialEventName:          null,
      suggestedFinancialEvent:     feSuggestion ? feSuggestion.type : null,
      suggestedFinancialEventName: feSuggestion ? (feSuggestion.name || null) : null,
      financialEventConfident:     feSuggestion ? feSuggestion.confident : false
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

  const financialEventsSheet = ss.getSheetByName("FinancialEvents");
  const financialEventsData  = financialEventsSheet ? financialEventsSheet.getDataRange().getValues() : [];

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
      category:     data[i][13] || "Other",
      savedType:    (data[i][16] || "").toString().trim() || null, // column Q — what was actually chosen, if anything
      financialEvent:     (data[i][17] || "").toString().trim() || null, // column R — already-confirmed Rent/EMI/Investment, if any
      financialEventName: (data[i][18] || "").toString().trim() || null  // column S — only meaningful when financialEvent is "EMI"
    });
  }

  noted.reverse(); // newest first
  const page = noted.slice(offset, offset + limit);

  page.forEach(function(t){
    // Show what was ACTUALLY chosen for this specific transaction, not a
    // fresh re-guess — a guess here would silently drift as you answer
    // more transactions for the same merchant later (found 2026-08-09:
    // an old "Want" answer was showing as "Need" once later answers for
    // that merchant tipped the vote). Transactions saved before this
    // column existed have nothing stored (null) — deliberately left
    // blank rather than guessed, since a wrong-looking guess here would
    // be worse than no suggestion at all.
    t.suggestedType = t.savedType;
    delete t.savedType;

    // Rent/Investment suggestion — only relevant if this row hasn't
    // already been confirmed one way or the other. Lets an older
    // transaction (noted before this feature existed) still get caught
    // and offered a one-time confirm when you browse History. Passing
    // t.note matters a lot more here than in Pending — a real bank
    // Counterparty rarely says "rent," but the user's own note often
    // does (fixed 2026-08-10, see docs/features/financial-events.md).
    const feSuggestion = (!t.financialEvent && t.type === "debit")
      ? suggestFinancialEvent(t.counterparty, t.amount, financialEventsData, t.note)
      : null;
    t.suggestedFinancialEvent = feSuggestion ? feSuggestion.type : null;
    t.suggestedFinancialEventName = feSuggestion ? (feSuggestion.name || null) : null;
    t.financialEventConfident = feSuggestion ? feSuggestion.confident : false;
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
// teach SmartMemory/TypeVotes exactly like a first-time correction does
// (confirmed with the user 2026-08-08) — reusing this function is what
// gets that for free instead of writing a second, parallel code path.
function saveTransactionNote(row, note, category, counterparty, type, amount, financialEvent, financialEventName){
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

    // Rent/EMI/Investment — see financialEvents.js. Written on the row
    // itself (so it's remembered exactly, never re-guessed later, same
    // reasoning as column Q below) and also recorded in the
    // FinancialEvents memory sheet, so a future payment gets recognized
    // with a one-tap confirm instead of starting from scratch.
    // financialEventName (column S) only means something for EMI — more
    // than one can exist, so each needs its own name (e.g. "Laptop
    // EMI") to stay distinct from the others.
    if(financialEvent){
      sheet.getRange(row, 18).setValue(financialEvent); // column R
      if(financialEvent === "EMI" && financialEventName){
        sheet.getRange(row, 19).setValue(financialEventName); // column S
      }
      const feAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F, reflects the edit above if any
      recordFinancialEvent(financialEvent, feAmount, counterparty, financialEventName);
    }

    // Save the actual chosen type ON this transaction (column Q) whenever
    // one was sent and it isn't a recognized loan/repayment. This is
    // separate from the vote below (which only feeds FUTURE suggestions
    // for a merchant) — column Q is per-TRANSACTION, so it never needs a
    // counterparty to exist. Found and fixed 2026-08-10: this used to be
    // wrongly gated behind `counterparty` being present, which meant
    // "wallet"-mode transactions (no merchant identity — common for
    // wallet-balance debits, unlike UPI-to-merchant payments) could never
    // save a type at all, and the error message wrongly blamed "looks
    // like a loan/repayment" when the real reason was completely
    // unrelated. Column Q's write no longer depends on counterparty;
    // only the per-merchant vote below still does, since a vote without
    // a merchant to attribute it to wouldn't mean anything.
    //
    // typeSaved is reported back below — a silent skip here once looked
    // identical to success from the caller's side (found 2026-08-10: a
    // false-positive bug in isLendingTransfer meant real Need/Want/Saving
    // choices were being silently dropped on ordinary transactions, while
    // note/category still saved fine and the response still said "ok").
    // Never trust a save as fully complete without checking this again.
    //
    // Also skipped when financialEvent is set — a confirmed Rent/
    // Investment payment isn't spending at all, so Need/Want/Saving
    // isn't a meaningful question for it (confirmed with the user
    // 2026-08-10, as part of the wider Category/Financial Event design).
    let typeSaved = false;
    if(type && !isLendingTransfer(counterparty, note) && !financialEvent){
      sheet.getRange(row, 17).setValue(type); // column Q
      typeSaved = true;

      // The per-merchant learning pool genuinely needs a merchant name to
      // attribute the vote to — skip it (but still keep the column Q
      // save above) when there isn't one.
      if(counterparty){
        const voteAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F, reflects the edit above if any
        recordTypeVote(counterparty, voteAmount, type);
      }
    }

    // Remember this note against the merchant (+ amount band) so it can be
    // suggested again later — see noteMemory.js / docs/features/note-memory.md.
    if(counterparty && note){
      const noteAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F, reflects the edit above if any
      recordNoteUsage(counterparty, noteAmount, note);
    }

    return { ok:true, typeRequested: !!type, typeSaved: typeSaved };
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