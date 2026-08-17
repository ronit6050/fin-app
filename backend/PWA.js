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
    return jsonResponse({ ok:true, transactions: getPendingTransactions(), knownDebtPeople: getKnownDebtPeople() });
  }

  if(data.action === "saveNote"){
    return jsonResponse(saveTransactionNote(data.row, data.note, data.category, data.counterparty, data.type, data.amount, data.financialEvent, data.financialEventName, data.debtPerson, data.investmentInstrument));
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

  if(data.action === "recordDebtPayment"){
    return jsonResponse(applyDebtPayment(data.row, data.amount));
  }

  // ── Savings v2 (Goals-based engine, backend/savingsGoals.js) ──
  // The old 4-pot actions (getSavings/logSaving/logCCBuffer/
  // addWishlistItem/markWishlistPurchased) were removed 2026-08-12 —
  // index.html only ever called these new actions, confirmed by
  // checking every "action:" string the frontend sends. See CLAUDE.md's
  // backend cleanup entry and docs/features/savings-v2.md.
  // See docs/features/savings-v2.md.

  if(data.action === "getSavingsGoals"){
    return jsonResponse({ ok:true, savings: getSavingsBreakdown() });
  }

  if(data.action === "previewSavingsSplit"){
    return jsonResponse(previewAutoSplit(data.amount));
  }

  if(data.action === "saveSavingsAuto"){
    return jsonResponse(saveAutoSplit(data.amount, data.note));
  }

  if(data.action === "saveSavingsManual"){
    return jsonResponse(saveManualSplit(data.amount, data.rows, data.note));
  }

  if(data.action === "withdrawSavings"){
    return jsonResponse(withdrawSaving(data.bucket, data.amount, data.note));
  }

  if(data.action === "updateSavingsEntry"){
    return jsonResponse(updateSavingsEntry(data.row, data.amount, data.note, data.destination));
  }

  if(data.action === "deleteSavingsEntry"){
    return jsonResponse(deleteSavingsEntry(data.row));
  }

  if(data.action === "addSavingsGoal"){
    return jsonResponse(addGoal(data.name, data.type, data.target));
  }

  if(data.action === "setPrioritySavingsGoal"){
    return jsonResponse(setPriorityGoal(data.row));
  }

  if(data.action === "markSavingsGoalDone"){
    return jsonResponse(markGoalDone(data.row));
  }

  if(data.action === "purchaseSavingsGoal"){
    return jsonResponse(purchaseGoal(data.row, data.name, data.amount));
  }

  if(data.action === "getInvestments"){
    return jsonResponse({ ok:true, investments: getInvestmentsData() });
  }

  // ── Investment Instruments (added 2026-08-11, backend/investmentInstruments.js) ──
  // A fixed, named list of the user's real investments — replaces the
  // old free-typed "Type" string, see that file's header comment.

  if(data.action === "getInvestmentInstruments"){
    return jsonResponse({ ok:true, ...getInvestmentInstrumentsList() });
  }

  if(data.action === "addInvestmentInstrument"){
    return jsonResponse(addInvestmentInstrument(data.name, data.category));
  }

  if(data.action === "logInvestment"){
    return jsonResponse(logInvestmentFromApp(data.amount, data.instrumentName));
  }

  if(data.action === "updateInvestment"){
    return jsonResponse(updateInvestmentEntry(data.row, data.instrumentName, data.amount));
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
    return jsonResponse({ ok:true, ...getTransactionHistory(data.offset, data.limit), knownDebtPeople: getKnownDebtPeople() });
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

  // Debts/Investments each read their own sheet(s) only once already —
  // no duplication to fix there, just reusing their results. (The old
  // 4-pot getSavingsData() used to be read here too — removed
  // 2026-08-12, its result was never actually shown by index.html,
  // which only ever reads full.savingsGoals below. Savings computed
  // before CC Advisor now, since CC Advisor's affordability check needs
  // the CC Buffer pot's balance, see docs/features/cc-advisor.md.)
  const debts       = getDebtsData();
  const investments = getInvestmentsData();

  // CC Buffer now lives in the new Goals-based Savings engine (see
  // savingsGoals.js / docs/features/savings-v2.md) — read once here and
  // reused both for CC Advisor's affordability check and to seed the new
  // Savings tab's own cache below (full.savingsGoals), same "read each
  // sheet once" rule the rest of this function already follows.
  const savingsGoalsData = getSavingsBreakdown();
  const ccBufferGoal     = savingsGoalsData.ccBufferGoal;
  const cc      = getCCAdvisorData(txnData, cashData, month, ccBufferGoal ? ccBufferGoal.saved : 0);
  const pending = getPendingTransactions(txnData);

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
      savingsGoals: savingsGoalsData,
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
//
// Groups by exact string match on column B (Type) — this only stays
// correct now because EVERY write path (logInvestmentFromApp,
// updateInvestmentEntry, the note-match auto-log via autoLogInvestment)
// validates its instrument name against InvestmentInstruments first
// (see investmentInstruments.js), so the same fund can never end up
// split across two slightly-different spellings again.
function getInvestmentsData(){
  const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
  const data = investSheet.getDataRange().getValues();

  // Name -> Category (SIP / One-time Fund / Stock / Gold), so the
  // frontend can group/label the breakdown into sections without a
  // second round trip. Small, natural addition now that every Type
  // string is guaranteed to be a real InvestmentInstruments name.
  const instrumentCategories = getInstrumentCategoryMap_();

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
    .map(function(e){ return { type: e[0], amount: e[1], category: instrumentCategories[e[0]] || null }; });

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

// Manual "+ Log an Investment" path. instrumentName must be an exact (or
// case-insensitive) match to a name already in InvestmentInstruments —
// validated server-side (never trust the frontend), same defensive
// pattern as updateInvestmentEntry's row-number check below. Rewritten
// 2026-08-11: used to take a free-typed "type" string directly (the
// fragmentation bug this whole feature fixes — see
// investmentInstruments.js's file header).
function logInvestmentFromApp(amount, instrumentName){
  try{
    const validation = validateInvestmentInstrumentName_(instrumentName);
    if(!validation.ok) return validation;
    if(!amount || Number(amount) <= 0) return { ok:false, error:"Enter a valid amount." };

    const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    investSheet.appendRow([today, validation.name, Number(amount), ""]);

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Fixes a past investment entry's instrument/amount — added 2026-08-10,
// updated 2026-08-11 to validate instrumentName against
// InvestmentInstruments the same way logInvestmentFromApp does, so an
// edit can never reintroduce a stray free-typed spelling.
function updateInvestmentEntry(row, instrumentName, amount){
  try{
    const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");

    if(!Number.isInteger(row) || row < 2 || row > investSheet.getLastRow()){
      return { ok:false, error:"Invalid row." };
    }
    if(!amount || Number(amount) <= 0){
      return { ok:false, error:"Enter a valid amount." };
    }
    const validation = validateInvestmentInstrumentName_(instrumentName);
    if(!validation.ok) return validation;

    investSheet.getRange(row, 2).setValue(validation.name);  // column B
    investSheet.getRange(row, 3).setValue(Number(amount));   // column C

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// ONE-TIME MANUAL UTILITY (2026-08-11) — no longer needed for its
// original purpose (deciding how to migrate — that's done, see
// migrateInvestmentsToNamedInstruments() in investmentInstruments.js),
// but left in place since it's still a harmless, useful read-only
// snapshot of whatever is currently in the Investments sheet. Run by
// hand from the Apps Script editor (select this function, Run, then
// View > Logs).
function auditInvestmentsSheet(){
  const investSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Investments");
  const data = investSheet.getDataRange().getValues();

  Logger.log("Investments sheet — " + (data.length - 1) + " row(s):");
  for(let i = 1; i < data.length; i++){
    const row = data[i];
    Logger.log(
      "Row " + (i + 1) + ": " +
      "date=" + row[0] + " | type=\"" + row[1] + "\" | amount=" + row[2] +
      " | note=\"" + (row[3] || "") + "\""
    );
  }
}

// READ-ONLY DIAGNOSTIC (added 2026-08-17) — checks whether ATM
// withdrawals are being double-counted in Total Spent. Nothing in
// getTodaySummary/getMonthlyAnalysis currently excludes Mode="atm"
// debits, unlike credit-card-bill-payments and wallet-top-ups (both
// excluded, see isCreditCardBillPayment/isWalletTopUp below) — so if
// you withdraw cash at an ATM AND later log spending that same cash
// under the Cash tab, it's counted twice. Whether that's worth fixing
// depends on how reliably Cash spend actually gets logged after a
// withdrawal — this function doesn't change anything, it just prints
// the real numbers so that can be judged from actual data instead of a
// guess. Run by hand from the Apps Script editor (select this
// function, Run, then View > Logs / Executions).
function auditAtmWithdrawals(){
  const txnData  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions").getDataRange().getValues();
  const cashData = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cash").getDataRange().getValues();

  const atmRows = [];
  for(let i = 1; i < txnData.length; i++){
    const rawDate = txnData[i][0];
    if(!rawDate) continue;
    const type = (txnData[i][3] || "").toString().toLowerCase();
    const mode = (txnData[i][4] || "").toString().toLowerCase();
    if(type === "debit" && mode === "atm"){
      atmRows.push({ date: new Date(rawDate), amount: Number(txnData[i][5]) || 0 });
    }
  }

  Logger.log("=== ATM withdrawals found: " + atmRows.length + " ===");
  atmRows
    .sort(function(a, b){ return a.date - b.date; })
    .forEach(function(r){
      Logger.log(Utilities.formatDate(r.date, Session.getScriptTimeZone(), "yyyy-MM-dd") + "  ₹" + r.amount);
    });

  // Month-by-month comparison: total ATM withdrawn vs. total Cash debit
  // logged, same month. If Cash spend tracks close to (or above) ATM
  // withdrawals, cash is being logged reliably — excluding ATM
  // withdrawals from spend would be safe. If Cash spend is much lower,
  // a lot of cash spend is going untracked — excluding the withdrawal
  // would make that money vanish from Total Spent instead of just
  // double-counting it.
  const atmByMonth  = {};
  const cashByMonth = {};

  atmRows.forEach(function(r){
    const key = r.date.getFullYear() + "-" + (r.date.getMonth() + 1);
    atmByMonth[key] = (atmByMonth[key] || 0) + r.amount;
  });

  for(let i = 1; i < cashData.length; i++){
    const rawDate = cashData[i][1];
    if(!rawDate) continue;
    const type = (cashData[i][3] || "").toString().toLowerCase();
    if(type !== "debit") continue;
    const d = new Date(rawDate);
    const key = d.getFullYear() + "-" + (d.getMonth() + 1);
    cashByMonth[key] = (cashByMonth[key] || 0) + (Number(cashData[i][4]) || 0);
  }

  const allMonths = Array.from(new Set(Object.keys(atmByMonth).concat(Object.keys(cashByMonth)))).sort();
  Logger.log("=== Month-by-month: ATM withdrawn vs. Cash spend logged ===");
  allMonths.forEach(function(key){
    const atm  = atmByMonth[key]  || 0;
    const cash = cashByMonth[key] || 0;
    Logger.log(key + "  ATM withdrawn: ₹" + atm + "   Cash logged: ₹" + cash);
  });
}

// The old 4-pot Savings functions that used to live here — getSavingsData(),
// logSavingFromApp(), logCCBufferSaving(), addWishlistItemFromApp(),
// markWishlistPurchasedFromApp() — were removed 2026-08-12. They were
// superseded by the Goals-based Savings engine (backend/savingsGoals.js)
// on 2026-08-11; confirmed (by checking every "action:" string index.html
// sends, and by checking getDashboardData() below, which also used to call
// getSavingsData() but never actually used its result) that nothing live
// called them anymore. Full detail: CLAUDE.md's backend cleanup entry and
// docs/features/savings-v2.md. The Telegram-era equivalents these reused
// (getSavingsTotals/getSplitRule/getStageLabel in SavingsAdvisor.js) were
// deliberately left alone — they're still used by the old Telegram bot
// code, which is currently switched off but kept working on purpose in
// case it's ever turned back on.

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

// Records a payment against a debt — added 2026-08-10, after the user
// pointed out "Mark as Settled" only ever closes a debt fully, with no
// way to record "I only paid part of it." Reduces the debt's stored
// Amount by whatever was paid; if that would take it to zero or below
// (a full payoff, or a slight overpay), settles it instead of leaving a
// zero/negative amount sitting there. Shared by both this manual action
// AND Debts auto-linking's repayment matching (handleDebtAutoLink in
// financialEvents.js) — one function, so a partial repayment behaves
// identically whether you typed it in here or it was recognized from a
// transaction note.
function applyDebtPayment(row, amount){
  try{
    const debtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Debts");

    if(!Number.isInteger(row) || row < 2 || row > debtSheet.getLastRow()){
      return { ok:false, error:"Invalid row." };
    }
    const paid = Number(amount);
    if(!paid || paid <= 0){
      return { ok:false, error:"Enter a valid amount." };
    }

    const currentAmount = Number(debtSheet.getRange(row, 4).getValue()) || 0; // column D
    const remaining = currentAmount - paid;
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    if(remaining <= 0){
      debtSheet.getRange(row, 7).setValue("Settled"); // column G
      debtSheet.getRange(row, 8).setValue(today);      // column H
      return { ok: true, settled: true, remaining: 0 };
    }

    debtSheet.getRange(row, 4).setValue(remaining); // reduce in place, stays Pending
    return { ok: true, settled: false, remaining: remaining };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Same billing-cycle math as sendCCAdvisorReport() in CCAdvisor.js, but
// returns plain data instead of sending a Telegram message, and reads
// the limit/warn/alert values from getSettings() (settings.js) instead
// of CCAdvisor.js's hardcoded constants, so the Settings screen actually
// affects this.
//
// Rebuilt 2026-08-10 — the old version only ever tracked ONE cycle,
// whichever one "today" happens to fall inside, and called that cycle's
// close-plus-3-weeks date "Payment due." That's wrong for most of the
// month: once a cycle closes (past the 18th), the bill that's ACTUALLY
// about to be due is the one that just closed — not the brand new cycle
// that just started, whose own due date is two months away. Found while
// tracing through the date math after the user asked to double-check it
// was sound. Now tracks the "outstanding" bill (most recently closed
// cycle, checked against isCreditCardBillPayment to see if it's already
// been paid) separately from the "current," still-accumulating cycle.
// See docs/features/cc-advisor.md.
//
// txnData/cashData/monthTotals are optional — same batching reasoning
// as getCashData's comment. monthTotals ({fixedObligations, invested},
// from getMonthlyAnalysis) is passed in by getDashboardData, which
// already computes both — recomputed here only when called standalone
// (the "getCCAdvisor" action). ccBufferAmount (added 2026-08-10, the
// user's own sinking-fund idea for this exact bill) is the CC Buffer
// Savings pot's balance — real money genuinely set aside for the card,
// so it counts as "available" money in the affordability check, closing
// the blind spot where the app couldn't see money you'd already
// reserved. Also optional, same fallback pattern.
function getCCAdvisorData(txnData, cashData, monthTotals, ccBufferAmount){

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfMonth = today.getDate();

  // The most recent bill-close date (18th) that is <= today.
  const mostRecentClose = new Date(today.getFullYear(), today.getMonth() - (dayOfMonth < 18 ? 1 : 0), 18);

  // The bill that closed on mostRecentClose — the one that's actually
  // due soon (or already overdue), not a hypothetical future one.
  const outstandingCycleStart = new Date(mostRecentClose.getFullYear(), mostRecentClose.getMonth() - 1, 19);
  const outstandingCycleEnd   = mostRecentClose;
  const outstandingDueDate    = new Date(mostRecentClose.getFullYear(), mostRecentClose.getMonth() + 1, 9);

  // The cycle that's currently running, right after the one above.
  const currentCycleStart = new Date(mostRecentClose.getFullYear(), mostRecentClose.getMonth(), 19);
  const currentCycleEnd   = new Date(mostRecentClose.getFullYear(), mostRecentClose.getMonth() + 1, 18);

  const data = txnData || SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions").getDataRange().getValues();

  const settings   = getSettings();
  const ccLimit    = settings.ccLimit;
  const ccWarnAmt  = ccLimit * settings.ccWarnPct;
  const ccAlertAmt = ccLimit * settings.ccAlertPct;

  const fmtDate = function(d){
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM yyyy");
  };

  // Sums card spend within [startDate, endDate] (inclusive), plus the
  // category/card breakdowns and per-category transaction lists needed
  // for the tap-to-expand view. Shared by both the outstanding bill and
  // the current cycle so the two can never compute this differently.
  function summarizeCardSpend(startDate, endDate){
    let total = 0, txnCount = 0;
    const categoryTotals = {};
    const categoryTxns   = {};
    const cardTotals     = {};
    const allTxns        = [];

    for(let i = 1; i < data.length; i++){
      const rawDate = data[i][0];
      if(!rawDate) continue;
      const d = new Date(rawDate);
      if(d < startDate || d > endDate) continue;

      const type   = (data[i][3] || "").toString().toLowerCase();
      const mode   = (data[i][4] || "").toString().toLowerCase();
      const amount = Number(data[i][5]) || 0;
      const cat    = (data[i][13] || "Other").toString().trim();

      if(type === "debit" && mode.startsWith("card") && amount > 0){
        total += amount;
        txnCount++;
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
        cardTotals[mode]    = (cardTotals[mode] || 0) + amount;

        const note = (data[i][12] || "").toString().trim();
        const counterparty = (data[i][7] || "").toString().trim();
        const txn = { date: d, counterparty: counterparty, note: note, amount: amount };

        if(!categoryTxns[cat]) categoryTxns[cat] = [];
        categoryTxns[cat].push({ note: note || counterparty || "", amount: amount, date: fmtDate(d) });

        allTxns.push(txn);
      }
    }

    const cardBreakdown = Object.entries(cardTotals)
      .sort(function(a, b){ return b[1] - a[1]; })
      .map(function(e){ return { card: e[0].toUpperCase(), amount: e[1] }; });

    const topCategories = Object.entries(categoryTotals)
      .sort(function(a, b){ return b[1] - a[1]; })
      .slice(0, 6)
      .map(function(e){
        const topTxns = (categoryTxns[e[0]] || []).sort(function(a, b){ return b.amount - a.amount; }).slice(0, 5);
        return { category: e[0], amount: e[1], topTransactions: topTxns };
      });

    const recentTxns = allTxns
      .sort(function(a, b){ return b.date - a.date; })
      .slice(0, 5)
      .map(function(t){ return { date: fmtDate(t.date), counterparty: t.counterparty, note: t.note, amount: t.amount }; });

    return { total: total, txnCount: txnCount, cardBreakdown: cardBreakdown, topCategories: topCategories, recentTxns: recentTxns };
  }

  const outstandingSummary = summarizeCardSpend(outstandingCycleStart, outstandingCycleEnd);
  const currentSummary     = summarizeCardSpend(currentCycleStart, today);

  // Has the outstanding bill already been paid? Look for a real
  // credit-card-bill-payment transaction (same detector used to keep
  // Analysis from double-counting it) any time after the bill closed.
  let outstandingPaid = false;
  if(outstandingSummary.total > 0){
    for(let i = 1; i < data.length; i++){
      const rawDate = data[i][0];
      if(!rawDate) continue;
      const d = new Date(rawDate);
      if(d <= outstandingCycleEnd) continue;
      const type = (data[i][3] || "").toString().toLowerCase();
      if(type !== "debit") continue;
      const mode = (data[i][4] || "").toString();
      const counterparty = (data[i][7] || "").toString();
      const note = (data[i][12] || "").toString();
      if(isCreditCardBillPayment(mode, counterparty, note)){
        outstandingPaid = true;
        break;
      }
    }
  }

  const daysUntilDue = Math.ceil((outstandingDueDate - today) / 86400000);
  const isOverdue = !outstandingPaid && outstandingSummary.total > 0 && daysUntilDue < 0;

  // Shared numbers for every "can I afford this?" check below — your
  // Cash balance, recent Income-tagged credits (no new setting needed),
  // and this month's Rent+EMI (already tracked via Financial Events).
  // Computed once, unconditionally, since both the outstanding bill
  // AND the still-open current cycle need to be checked against them.
  const cash = getCashData(cashData);
  const cashBalance = cash.balance;

  const since = new Date(today);
  since.setDate(since.getDate() - 35); // a bit over one pay cycle, covers a salary date that shifts slightly
  let recentIncome = 0;
  for(let i = 1; i < data.length; i++){
    const rawDate = data[i][0];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(d < since || d > today) continue;
    const type = (data[i][3] || "").toString().toLowerCase();
    const cat  = (data[i][13] || "").toString().trim();
    if(type === "credit" && cat === "Income"){
      recentIncome += Number(data[i][5]) || 0;
    }
  }

  let fixedObl = monthTotals ? monthTotals.fixedObligations : null;
  let investedActual = monthTotals ? monthTotals.invested : null;
  if(fixedObl === undefined || fixedObl === null){
    const now = new Date();
    const m = getMonthlyAnalysis(now.getFullYear(), now.getMonth() + 1, data, cashData);
    fixedObl = m.fixedObligations;
    investedActual = m.invested;
  }

  // CC Buffer now lives in the new Goals-based Savings engine — see
  // note at the getDashboardData() call site above.
  const ccBuffer = (ccBufferAmount === undefined || ccBufferAmount === null)
    ? (function(){ const g = getSavingsBreakdown().ccBufferGoal; return g ? g.saved : 0; })()
    : ccBufferAmount;

  // Added 2026-08-10 — user's real example: invested ₹3,000 so far this
  // month, but their fixed monthly commitment is ₹9,000 (the rest comes
  // later in the month). Using only the REAL amount-so-far understated
  // what's actually committed, making the affordability check look
  // rosier than reality early in the month. Fixed by treating whichever
  // is bigger — the fixed target, or the real amount if it ever runs
  // ahead of the target (a genuine extra top-up should never be
  // undercounted either) — as "committed" for the needed-money math.
  const investedTarget = settings.monthlyInvestmentGoal;
  const investedCommitted = Math.max(investedActual, investedTarget);

  // "Can you actually pay this without it eating into next month?" —
  // same question, asked against whichever amount is passed in. Used
  // three times below: the bill that's already closed (if unpaid), what
  // the CURRENT cycle has cost so far, and what it's on track to cost
  // by the time it closes — so the warning shows up while the cycle is
  // still open, not only after the bill has already landed.
  //
  // Savings goal and Invested this month are kept as two separate lines
  // (not combined) — user flagged 2026-08-10 that they're different
  // things to them, same distinction the Savings/Investments tabs
  // already keep.
  function computeAffordability(billAmount){
    const available = cashBalance + recentIncome + ccBuffer;
    const needed = billAmount + settings.monthlyExpenses + fixedObl + investedCommitted + settings.monthlySaveGoal;
    const net = available - needed;
    return {
      cashBalance: cashBalance,
      recentIncome: recentIncome,
      ccBuffer: ccBuffer,
      available: available,
      billAmount: billAmount,
      monthlyExpenses: settings.monthlyExpenses,
      fixedObligations: fixedObl,
      invested: investedCommitted,
      investedActual: investedActual,
      investedTarget: investedTarget,
      savingsGoal: settings.monthlySaveGoal,
      needed: needed,
      net: net,
      canAfford: net >= 0
    };
  }

  const affordability = (outstandingSummary.total > 0 && !outstandingPaid)
    ? computeAffordability(outstandingSummary.total)
    : null;

  // Current, still-accumulating cycle — projection math unchanged from
  // before, just now clearly scoped to "not due yet" instead of being
  // confused with the outstanding bill.
  const daysLeft    = Math.ceil((currentCycleEnd - today) / 86400000);
  const daysInCycle = Math.ceil((currentCycleEnd - currentCycleStart) / 86400000);
  const daysElapsed = daysInCycle - daysLeft;
  const dailyAvg     = daysElapsed > 0 ? currentSummary.total / daysElapsed : 0;
  const projected    = Math.round(dailyAvg * daysInCycle);
  const projectedPct = Math.round((projected / ccLimit) * 100);

  const usagePct  = Math.round((currentSummary.total / ccLimit) * 100);
  let status = "healthy";
  if(currentSummary.total >= ccAlertAmt) status = "alert";
  else if(currentSummary.total >= ccWarnAmt) status = "warning";

  return {
    limit: ccLimit,

    outstanding: {
      amount: outstandingSummary.total,
      cycleStart: fmtDate(outstandingCycleStart),
      cycleEnd:   fmtDate(outstandingCycleEnd),
      dueDate:    fmtDate(outstandingDueDate),
      daysUntilDue: daysUntilDue,
      isOverdue: isOverdue,
      isPaid: outstandingPaid,
      cardBreakdown: outstandingSummary.cardBreakdown,
      topCategories: outstandingSummary.topCategories
    },

    affordability: affordability,

    current: {
      cycleStart: fmtDate(currentCycleStart),
      cycleEnd:   fmtDate(currentCycleEnd),
      spend: currentSummary.total,
      projected: projected,
      projectedPct: projectedPct,
      daysLeft: daysLeft,
      usagePct: usagePct,
      status: status,
      // "If this cycle ended today" vs "at this pace, by close" — both
      // checked against the same cash/income/expenses math as the
      // outstanding bill, so a risky month shows up early instead of
      // only after the bill has already landed. See computeAffordability above.
      affordabilityNow: computeAffordability(currentSummary.total),
      affordabilityProjected: computeAffordability(projected)
    },

    // Kept at the top level, same shape as before, so the Home
    // dashboard widget (which only ever cared about "this cycle,"
    // never the due-bill distinction) keeps working unchanged.
    cycleStart: fmtDate(currentCycleStart),
    cycleEnd:   fmtDate(currentCycleEnd),
    cycleSpend: currentSummary.total,
    usagePct:   usagePct,
    status:     status,
    txnCount:   currentSummary.txnCount,
    cardBreakdown: currentSummary.cardBreakdown,
    topCategories: currentSummary.topCategories,
    recentCardTxns: currentSummary.recentTxns
  };
}

// Works out which payment-mode bucket a Transactions row's Mode value
// falls into, for the Analysis screen's All/Bank/Card/Wallet toggle
// (added 2026-08-17). Same "card" test already used by
// isCreditCardBillPayment/CCAdvisor.js. "Bank" is everything left over
// (upi, neft, atm, other, or blank) — deliberately not its own explicit
// list, so a new Mode value the SMS parser starts sending later still
// lands somewhere sensible instead of vanishing from every bucket.
function bucketKeyForMode(mode){
  const m = (mode || "").toString().trim().toLowerCase();
  if(m.startsWith("card")) return "card";
  if(m === "wallet") return "wallet";
  return "bank";
}

// One of these per payment-mode bucket (bank/card/wallet) — same fields
// as the "all" totals above, kept as a plain object instead of separate
// variables so the accumulation code below can update whichever bucket
// a row belongs to without a second pass over the sheet.
function freshModeBucket(){
  return {
    totalDebit: 0,
    totalCredit: 0,
    categoryTotals: {},
    categoryTxns: {},
    dailyTotals: {},
    topAmount: 0,
    topNote: "",
    typeTotals: { Need: 0, Want: 0, Saving: 0, Investment: 0 },
    untaggedTotal: 0,
    untaggedCount: 0,
    fixedObligations: 0,
    invested: 0
  };
}

// Turns one bucket's raw accumulators into the same response shape
// getMonthlyAnalysis already returns at the top level (categories,
// needWantSaving, etc.) — used for bank/card/wallet in `byMode` below.
function finalizeModeBucket(bucket){
  const savings = bucket.totalCredit - bucket.totalDebit;
  const days = Object.keys(bucket.dailyTotals).length || 1;
  const avgDaily = Math.round(bucket.totalDebit / days);
  const categories = Object.entries(bucket.categoryTotals)
    .sort(function(a, b){ return b[1] - a[1]; })
    .map(function(entry){
      const topTransactions = (bucket.categoryTxns[entry[0]] || [])
        .sort(function(a, b){ return b.amount - a.amount; })
        .slice(0, 5);
      return { category: entry[0], amount: entry[1], topTransactions: topTransactions };
    });
  const taggedTotal = bucket.typeTotals.Need + bucket.typeTotals.Want + bucket.typeTotals.Saving + bucket.typeTotals.Investment;
  return {
    totalDebit:  bucket.totalDebit,
    totalCredit: bucket.totalCredit,
    savings:     savings,
    avgDaily:    avgDaily,
    topAmount:   bucket.topAmount,
    topNote:     bucket.topNote,
    categories:  categories,
    fixedObligations: bucket.fixedObligations,
    invested:         bucket.invested,
    needWantSaving: {
      need:           bucket.typeTotals.Need,
      want:           bucket.typeTotals.Want,
      saving:         bucket.typeTotals.Saving,
      investment:     bucket.typeTotals.Investment,
      untagged:       bucket.untaggedTotal,
      untaggedCount:  bucket.untaggedCount,
      taggedTotal:    taggedTotal
    }
  };
}

// Full breakdown for one month: total spend, income, savings, top expense,
// and spending by category — combining bank/UPI and cash. Also returns
// `byMode` (added 2026-08-17): the exact same breakdown, computed three
// more times from ONLY the Transactions rows in the Bank/Card/Wallet
// payment-mode bucket — never Cash, which has no payment mode — for the
// Analysis screen's All/Bank/Card/Wallet toggle. Everything above this
// note (the "all" numbers) is completely unchanged.
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

  // Bank/Card/Wallet buckets — Transactions rows only, Cash never
  // contributes (see function comment above).
  const modeBuckets = { bank: freshModeBucket(), card: freshModeBucket(), wallet: freshModeBucket() };

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

      // Which Bank/Card/Wallet bucket this specific row belongs to —
      // computed once per row, used below for both debit and credit.
      const modeBucket = modeBuckets[bucketKeyForMode(mode)];

      if(type === "debit" && isCreditCardBillPayment(mode, counterparty, note)) continue; // settling spend already counted, not new spend
      if(type === "debit" && isWalletTopUp(counterparty, reference)) continue; // money moved into your own wallet, not spent yet — the real spend gets counted separately, below, as each wallet purchase happens
      // A loan/repayment isn't spending either — you expect the money back.
      // Skipped Need/Want/Saving already, but was never actually excluded
      // from the spend total itself until now (gap flagged during the
      // Financial Events design discussion, closed 2026-08-10).
      if(type === "debit" && isLendingTransfer(counterparty, note)) continue;

      if(type === "debit" && financialEvent){
        if(financialEvent === "Rent" || financialEvent === "EMI"){
          fixedObligations += amount;
          modeBucket.fixedObligations += amount;
        } else if(financialEvent === "Investment"){
          invested += amount;
          modeBucket.invested += amount;
          // Also counts toward the Need/Want/Saving/Investment snapshot's
          // "Investment" slice — fixed 2026-08-11. Before this, a confirmed
          // SIP/Investment Financial Event was `continue`d past entirely,
          // so it added to `invested` (the separate CC Advisor/Analysis
          // "Invested this month" figure) but never to `typeTotals`, which
          // is what the Home/Analysis Need/Want/Saving bar actually reads.
          // Real example that caught this: a ₹3,000 SIP confirmed this
          // month, "Invested" correctly showed ₹3,000 elsewhere, but the
          // snapshot bar still showed Saving+Invest 0%.
          typeTotals.Investment += amount;
          modeBucket.typeTotals.Investment += amount;
        }
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

        // Mirror the same row into its Bank/Card/Wallet bucket.
        modeBucket.totalDebit += amount;
        modeBucket.categoryTotals[category] = (modeBucket.categoryTotals[category] || 0) + amount;
        modeBucket.dailyTotals[day] = (modeBucket.dailyTotals[day] || 0) + amount;
        if(amount > modeBucket.topAmount){ modeBucket.topAmount = amount; modeBucket.topNote = note; }

        if(!modeBucket.categoryTxns[category]) modeBucket.categoryTxns[category] = [];
        modeBucket.categoryTxns[category].push({
          note:   note || counterparty || "",
          amount: amount,
          date:   Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM")
        });

        if(modeBucket.typeTotals.hasOwnProperty(savedType)){
          modeBucket.typeTotals[savedType] += amount;
        } else {
          modeBucket.untaggedTotal += amount;
          modeBucket.untaggedCount++;
        }
      } else if(type === "credit"){
        totalCredit += amount;
        modeBucket.totalCredit += amount;
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
    },

    // All/Bank/Card/Wallet toggle (added 2026-08-17) — same shape as
    // everything above, computed separately per payment-mode bucket.
    // Cash never appears here (see bucketKeyForMode's comment).
    byMode: {
      bank:   finalizeModeBucket(modeBuckets.bank),
      card:   finalizeModeBucket(modeBuckets.card),
      wallet: finalizeModeBucket(modeBuckets.wallet)
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

  // Same "read once, outside the loop" pattern as the sheets above — see
  // investmentInstruments.js for what this is used for.
  const investInstrumentsData = getInvestmentInstrumentsSheet_().getDataRange().getValues();

  for(let i = 1; i < data.length; i++){
    const processed = (data[i][15] || "").toString().trim(); // column P
    const note       = (data[i][12] || "").toString().trim(); // column M

    if(processed !== "YES") continue; // hasn't even been alerted yet
    if(note) continue;                // already has a note

    const bank        = data[i][2] || "";
    const txnType     = data[i][3] || ""; // "debit" or "credit"
    const mode        = data[i][4] || "";
    const amount      = Number(data[i][5]) || 0;
    const reference   = data[i][6] || "";
    const counterparty = data[i][7] || "";

    const suggestedCategory = getSuggestedCategoryFast(counterparty, amount, mode, smartMemoryData);

    // Rent/Investment suggestion — see financialEvents.js. Only makes
    // sense for a debit; a credit is never a Rent/Investment payment.
    // note is always empty here (Pending = unnoted transactions) — passed
    // through anyway for correctness, same reasoning as suggestedType above.
    const feSuggestion = txnType === "debit"
      ? suggestFinancialEvent(counterparty, amount, financialEventsData, note)
      : null;

    // Investment-instrument note match — see investmentInstruments.js.
    // note is always empty here (Pending = unnoted transactions), so
    // this can never actually fire yet in Pending — same inherent limit
    // isLendingTransfer/isSavingsNote already have there. Passed through
    // anyway for correctness/consistency, and so History (which always
    // has a note) gets the exact same code path "for free."
    const investSuggestion = txnType === "debit"
      ? matchInvestmentInstrumentByNote(note, investInstrumentsData)
      : null;

    // A credit card bill payment or wallet top-up isn't spending — same
    // reasoning as Lending/Financial Events, but these two are already
    // trusted enough to silently skip the spend total (see
    // isCreditCardBillPayment/isWalletTopUp), so there's no real safety
    // benefit to still asking Need/Want/Saving about them: if the
    // detection is wrong, the row is ALREADY hidden from every total
    // regardless of what gets answered here. Decided with the user
    // 2026-08-10 after this exact reasoning was double-checked against
    // the actual code together.
    const isNonSpendTransfer = txnType === "debit" &&
      (isCreditCardBillPayment(mode, counterparty, note) || isWalletTopUp(counterparty, reference));

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
      suggestedType:     isNonSpendTransfer ? null : getSuggestedType(txnType, suggestedCategory, counterparty, amount, typeVotesData, note),
      // See isNonSpendTransfer comment above — the frontend uses this to
      // skip rendering the Need/Want/Saving toggle entirely for a CC
      // bill payment or wallet top-up, same as it already does for a
      // credit-type row.
      isNonSpendTransfer: isNonSpendTransfer,
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
      financialEventConfident:     feSuggestion ? feSuggestion.confident : false,
      // Investment-instrument note match — see investmentInstruments.js.
      // Three distinct states, since (unlike financialEventName) a null
      // name is genuinely ambiguous between "no signal at all" and "an
      // unnamed new stock/fund" — investmentInstrumentLooksNew tells
      // those two apart explicitly instead of overloading null:
      //   suggestedInvestmentInstrument = "<name>", confident = true   -> one-tap confirm
      //   suggestedInvestmentInstrument = null, looksNew = true        -> "which one?" name-it prompt
      //   suggestedInvestmentInstrument = null, looksNew = false       -> nothing to show
      suggestedInvestmentInstrument: investSuggestion ? investSuggestion.name : null,
      investmentInstrumentConfident: investSuggestion ? investSuggestion.confident : false,
      investmentInstrumentLooksNew:  !!(investSuggestion && investSuggestion.confident === false)
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

  // Same "read once, outside the loop" pattern as above — see
  // investmentInstruments.js for what this is used for.
  const investInstrumentsData = getInvestmentInstrumentsSheet_().getDataRange().getValues();

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
      reference:    data[i][6] || "",
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

    // Investment-instrument note match — see investmentInstruments.js and
    // the matching comment in getPendingTransactions for the 3-state
    // shape. t.note always has real content in History (unlike Pending),
    // so this is where a stock/fund note ("Tata Steel shares") actually
    // gets caught in practice.
    const investSuggestion = t.type === "debit"
      ? matchInvestmentInstrumentByNote(t.note, investInstrumentsData)
      : null;
    t.suggestedInvestmentInstrument = investSuggestion ? investSuggestion.name : null;
    t.investmentInstrumentConfident = investSuggestion ? investSuggestion.confident : false;
    t.investmentInstrumentLooksNew  = !!(investSuggestion && investSuggestion.confident === false);

    // See the matching comment in getPendingTransactions — a CC bill
    // payment or wallet top-up never needs asking, so hide the toggle
    // here too, even for an older row that has an old saved answer
    // sitting in column Q from before this decision (harmless either
    // way, since Analysis already ignores these rows entirely).
    t.isNonSpendTransfer = t.type === "debit" &&
      (isCreditCardBillPayment(t.mode, t.counterparty, t.note) || isWalletTopUp(t.counterparty, t.reference));
    if(t.isNonSpendTransfer) t.suggestedType = null;
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
function saveTransactionNote(row, note, category, counterparty, type, amount, financialEvent, financialEventName, debtPerson, investmentInstrument){
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

    // Rent/EMI/Investment/Saving — see financialEvents.js. Written on
    // the row itself (so it's remembered exactly, never re-guessed
    // later, same reasoning as column Q below).
    //
    // Saving (added 2026-08-10) is different from the other three: it's
    // detected purely from the note ("saving"/"savings" — isSavingsNote)
    // rather than a confirm-chip, same trust-what-you-typed reasoning as
    // Lending — so it can apply even though the frontend never sent a
    // financialEvent for it. An explicit chip selection always wins if
    // one was actually sent.
    const effectiveFinancialEvent = financialEvent || (isSavingsNote(note) ? "Saving" : "");
    const effectiveFinancialEventName = financialEvent ? financialEventName : null;

    if(effectiveFinancialEvent){
      sheet.getRange(row, 18).setValue(effectiveFinancialEvent); // column R
      // financialEventName (column S) only means something for EMI/
      // Investment — more than one of each can exist, so each needs its
      // own name (e.g. "Laptop EMI", "Mutual Fund") to stay distinct.
      if((effectiveFinancialEvent === "EMI" || effectiveFinancialEvent === "Investment") && effectiveFinancialEventName){
        sheet.getRange(row, 19).setValue(effectiveFinancialEventName); // column S
      }
      const feAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F, reflects the edit above if any

      // Only Rent/EMI/Investment use the amount/note-matching memory —
      // Saving is re-detected fresh from the note every time, no memory
      // needed (same as Lending).
      if(effectiveFinancialEvent === "Rent" || effectiveFinancialEvent === "EMI" || effectiveFinancialEvent === "Investment"){
        recordFinancialEvent(effectiveFinancialEvent, feAmount, counterparty, effectiveFinancialEventName);
      }

      // Auto-log into the real Investments/Savings tab (added
      // 2026-08-10) — so a recognized investment or a note-detected
      // saving doesn't ALSO need typing in by hand a second time.
      // Skipped if a likely-duplicate manual entry already exists
      // nearby in time — see hasLikelyDuplicateInvestment/
      // hasLikelyDuplicateSaving in financialEvents.js.
      const txnDateRaw = sheet.getRange(row, 1).getValue(); // column A
      const txnDateStr = Utilities.formatDate(new Date(txnDateRaw), Session.getScriptTimeZone(), "yyyy-MM-dd");

      if(effectiveFinancialEvent === "Investment"){
        autoLogInvestment(txnDateStr, effectiveFinancialEventName, feAmount, note);
      } else if(effectiveFinancialEvent === "Saving"){
        autoLogSaving(txnDateStr, feAmount, note);
      }
    }

    // Debts auto-linking (added 2026-08-10) — a lending-flavored note
    // ("lent to Raj", "Raj paid back") with a confirmed person creates
    // or settles a real entry in the Debts tab. Separate from the
    // Financial Event block above — Lending isn't a Financial Event in
    // that schema sense (see docs/features/financial-events.md's
    // "Lending" section), it's handled entirely through
    // isLendingTransfer/classifyDebtDirection instead. debtPerson only
    // arrives when the frontend recognized (or the user confirmed) a
    // specific person live as the note was typed — direction itself is
    // always recomputed here server-side from the row's own Type and
    // note, never trusted from the frontend.
    if(debtPerson){
      const savedTxnType = (sheet.getRange(row, 4).getValue() || "").toString().toLowerCase(); // column D
      const debtAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F
      handleDebtAutoLink(savedTxnType, note, debtPerson, debtAmount);
    }

    // Investment-instrument note match (added 2026-08-11) — see
    // investmentInstruments.js's file header for why this is deliberately
    // SEPARATE from the Financial Event block above (it doesn't touch
    // columns R/S, doesn't use the FinancialEvents amount-matching
    // memory, and doesn't exclude anything from spend totals — a
    // note-recognized stock/fund purchase, e.g. "Tata Steel shares", is
    // still real, ordinary day-to-day spend from the bank's point of
    // view, unlike a Rent/EMI/SIP obligation). This ONLY adds a matching
    // row to the Investments portfolio tracker (via autoLogInvestment).
    //
    // skipDuplicateCheck=true (added 2026-08-11, same day, after
    // change-reviewer + ui-ux-expert both flagged this as worth
    // reconsidering) — this path does NOT use autoLogInvestment's
    // "likely duplicate" guard, unlike the Financial Event/SIP call
    // above. Reasoning: a note-matched confirm is already an explicit,
    // one-tap HUMAN decision — the same trust level as the manual
    // "+ Log an Investment" form, which has no duplicate check at all.
    // Silently dropping a real, just-confirmed purchase because it
    // happens to land near a similar amount within 3 days (e.g. two
    // separate top-ups of the same stock) would do more harm than good.
    // See autoLogInvestment's own comment (financialEvents.js) for the
    // full reasoning — the Financial Event/SIP call site keeps the
    // duplicate check exactly as it was, unaffected by this.
    //
    // Need/Want/Saving IS still skipped for it, though — decided with
    // the user 2026-08-11: buying a stock/fund isn't a spending decision
    // in the Need/Want/Saving sense either, same reasoning already
    // applied to Rent/EMI/Investment Financial Events and to Lending.
    // See `investmentInstrumentValid` below, used in the column-Q gate.
    // instrumentInstrument is validated against InvestmentInstruments
    // here too — never trust a name from the frontend without checking
    // it server-side, same defense-in-depth pattern as everything else
    // in this function.
    let investmentLogged = false;
    let investmentInstrumentValid = false;
    if(investmentInstrument){
      const instrumentCheck = validateInvestmentInstrumentName_(investmentInstrument);
      if(instrumentCheck.ok){
        investmentInstrumentValid = true;
        const invTxnDateRaw = sheet.getRange(row, 1).getValue(); // column A
        const invTxnDateStr = Utilities.formatDate(new Date(invTxnDateRaw), Session.getScriptTimeZone(), "yyyy-MM-dd");
        const invAmount = Number(sheet.getRange(row, 6).getValue()) || 0; // column F, reflects the edit above if any
        const logResult = autoLogInvestment(invTxnDateStr, instrumentCheck.name, invAmount, note, true); // skipDuplicateCheck
        investmentLogged = !!logResult.logged;
      }
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
    //
    // Also skipped when investmentInstrumentValid is true (added
    // 2026-08-11) — a note-matched stock/one-time-fund purchase (see
    // the block above) isn't a Need/Want/Saving decision either, same
    // reasoning as Rent/EMI/Investment Financial Events, confirmed with
    // the user. Uses investmentInstrumentValid (whether the NAME
    // validated), not investmentLogged (whether the row actually got
    // written) — a likely-duplicate skip inside autoLogInvestment still
    // means this transaction IS a confirmed investment purchase, so the
    // question should stay skipped either way.
    //
    // Also skipped for a credit card bill payment or wallet top-up
    // (checked here, server-side, from the row's own stored Mode/
    // Reference rather than anything the frontend sends — same defense-
    // in-depth reasoning as everything else in this function). Decided
    // with the user 2026-08-10: unlike Rent/EMI/Investment, these two
    // are already trusted enough to silently skip the spend total, so
    // there's no real safety benefit to still asking about them — a
    // wrong detection already hides the row from every total either way.
    const savedMode = (sheet.getRange(row, 5).getValue() || "").toString(); // column E
    const savedReference = (sheet.getRange(row, 7).getValue() || "").toString(); // column G
    const isNonSpendTransfer = isCreditCardBillPayment(savedMode, counterparty, note) || isWalletTopUp(counterparty, savedReference);

    let typeSaved = false;
    if(type && !isLendingTransfer(counterparty, note) && !effectiveFinancialEvent && !isNonSpendTransfer && !investmentInstrumentValid){
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

    return { ok:true, typeRequested: !!type, typeSaved: typeSaved, investmentLogged: investmentLogged };
  }catch(err){
    return { ok:false, error: err.toString() };
  }
}

function verifyGoogleIdToken(idToken){
  try{
    if(!idToken) return null;

    // Every action (every tap in the app) used to call Google's own
    // servers here, EVERY single time, just to re-confirm "yes, this is
    // really Ronit" — that round trip over the internet was a big chunk
    // of the delay felt when switching tabs/months. Fixed 2026-08-12:
    // remember a verified token's result for a few minutes using Apps
    // Script's own fast built-in memory (CacheService), keyed by a hash
    // of the token itself (never the raw token — same reasoning as not
    // logging secrets). Same token string = same person, so re-asking
    // Google within that window is pure wasted time, not a real check.
    // Google's own token still expires on its own (about an hour), so
    // this only ever shortcuts repeat checks of a token that's already
    // been freshly verified.
    const cache = CacheService.getScriptCache();
    const cacheKey = "idtok_" + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)
    );
    const cached = cache.get(cacheKey);
    if(cached) return JSON.parse(cached);

    const response = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );

    if(response.getResponseCode() !== 200) return null;

    const info = JSON.parse(response.getContentText());

    // Make sure the proof was issued for OUR app specifically
    if(info.aud !== PWA_CLIENT_ID) return null;

    const verified = { email: info.email, name: info.name || info.email };
    cache.put(cacheKey, JSON.stringify(verified), 300); // remember for 5 minutes
    return verified;

  }catch(err){
    return null;
  }
}

function jsonResponse(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}