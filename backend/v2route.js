// v2route.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: the switchboard that decides, for each person, whether a request runs on the Google Sheet
// (today, and for everyone by default) or on that person's own private Firestore-backed spreadsheet (v2db.js).
// Nothing changes for anyone until they are switched on. See docs/features/v2db.md and docs/v2-firestore-native.md.
//
// HOW A PERSON IS SWITCHED ON (global Script Properties, owner-controlled, instantly reversible):
//   V2DB_OWNER = "on"           the owner's own app runs on the virtual spreadsheet (only after his tabs are imported!)
//   V2DB_USERS = ["a@x.com"]    friends who get the FULL app (not only Splits) on their own private data
// From the Apps Script editor: v2dbEnableUser("a@x.com"), v2dbDisableUser("a@x.com"), v2dbEnableOwner(), v2dbDisableOwner().
// A person who is switched on is still checked exactly like before (the owner, or a friend the owner added), and a friend
// may only use the actions in V2_FRIEND_FULL_ACTIONS_ (never anything that touches the owner's Drive or Sheet).
//
// WHAT HAPPENS TO A SWITCHED-ON REQUEST
//   - a brand-new person gets empty template tabs (headers only) the first time, never anyone else's data;
//   - the tabs the action needs are fetched in ONE request;
//   - saving actions take a lock (one at a time), and a request refused because someone else changed the same data at the same
//     moment is retried once;
//   - the whole request is all-or-nothing (v2dbRun_): an error or an {ok:false} answer saves nothing.

// Actions a switched-on FRIEND may use: Splits plus the personal-tracker screens. Deliberately NOT here: refreshViews and
// moveDebtToFriend (owner's Sheet), the statement-upload actions (the owner's Google Drive), anything not listed.
var V2_FRIEND_FULL_ACTIONS_ = [
  "ping", "getMyAccess", "getMyIngestKey", "getPeople", "getPerson", "addFriend", "createSplit", "recordSplitPayment", "undoSplitEntry",
  "getPending", "saveNote", "markNotATransaction", "getTodaySummary", "getMonthlyAnalysis", "getCCAdvisor",
  "getDebts", "addDebt", "settleDebt", "recordDebtPayment",
  "getSavingsGoals", "previewSavingsSplit", "saveSavingsAuto", "saveSavingsManual", "withdrawSavings", "updateSavingsEntry",
  "deleteSavingsEntry", "addSavingsGoal", "setPrioritySavingsGoal", "markSavingsGoalDone", "purchaseSavingsGoal",
  "getInvestments", "getInvestmentInstruments", "addInvestmentInstrument", "logInvestment", "updateInvestment",
  "getCash", "addCashEntry", "addManualTransaction", "updateCashEntry", "registerPushToken", "getDashboard", "getSettings", "updateSettings",
  "getTransactionHistory", "getPlannerData", "saveBudgets"
];

// The empty tabs a new person starts with (names and headers exactly as docs/SHEET_SCHEMA.md). InvestmentInstruments is created EMPTY on
// purpose: left to itself the app fills it with the OWNER's own fund names.
var V2_TEMPLATE_TABS_ = {
  "Transactions": ["Date", "Time", "Bank", "Type", "Mode", "Amount", "Reference", "Counterparty", "Channel", "Source", "RawSMS", "Sender", "Note", "Category",
                   "TelegramMsgID", "Processed", "NeedWantSaving", "FinancialEvent", "FinancialEventName", "AutoSettled", "FriendShare"],
  "Transactions_Ignored": ["Date", "Time", "Bank", "Type", "Mode", "Amount", "Reference", "Counterparty", "Channel", "Source", "RawSMS", "Sender", "Note", "Category",
                           "TelegramMsgID", "Processed", "NeedWantSaving", "FinancialEvent", "FinancialEventName"],
  "Cash": ["ID", "Date", "Time", "Type", "Amount", "Note", "Category", "Source", "TelegramMsgID", "CreatedAt", "NeedWantSaving"],
  "Debts": ["Date", "Person", "Type", "Amount", "Note", "DueDate", "Status", "SettledDate"],
  "Savings": ["Date", "Amount", "Type", "Note", "Destination"],
  "Goals": ["Name", "Type", "Target", "Status", "Priority", "DateAdded"],
  "Investments": ["Date", "Name", "Amount", "Note"],
  "InvestmentInstruments": ["Name", "Category", "SipAmount"],
  "FinancialEvents": ["Type", "Amount", "Counterparty", "Confirmed", "Name"],
  "Budgets": ["Month", "Category", "Type", "Target"],
  "SmartMemory": ["Merchant", "Category", "Subcategory", "Confidence", "TimesUsed", "LastUsed"],
  "NoteMemory": ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
  "TypeVotes": ["Merchant", "AmountBand", "Type", "Timestamp"],
  "LearnedSpamPatterns": null,                     // this tab has no header row
  "_Props": null                                   // per-person settings (dbProps_)
};

// Tabs worth fetching together up front, per action. ONLY a speed-up: a tab that is not listed is still opened when the code asks for it.
var V2_PREFETCH_ALL_ = ["Transactions", "Cash", "Debts", "Savings", "Goals", "Investments", "InvestmentInstruments", "FinancialEvents", "Budgets",
                        "SmartMemory", "NoteMemory", "TypeVotes", "LearnedSpamPatterns", "_Props"];
var V2_PREFETCH_BY_ACTION_ = {
  "ping": [], "getPeople": [], "getPerson": [], "addFriend": [], "createSplit": ["Transactions"], "recordSplitPayment": [], "undoSplitEntry": ["Transactions"],
  "registerPushToken": ["_Props"], "getSettings": ["_Props"], "updateSettings": ["_Props"],
  "getDebts": ["Debts", "DebtPayments"], "getCash": ["Cash"], "getInvestments": ["Investments", "InvestmentInstruments"],
  "getInvestmentInstruments": ["InvestmentInstruments", "Investments"]
};

var V2_NO_RETRY_ACTIONS_ = ["addFriend", "createSplit", "recordSplitPayment", "undoSplitEntry"];

function v2dbPrefetchFor_(action){
  return Object.prototype.hasOwnProperty.call(V2_PREFETCH_BY_ACTION_, action) ? V2_PREFETCH_BY_ACTION_[action] : V2_PREFETCH_ALL_;
}

// ---------------------------------------------------------------- who is switched on
function v2dbUsersOn_(){
  try{ var list = JSON.parse(PropertiesService.getScriptProperties().getProperty("V2DB_USERS") || "[]"); return Array.isArray(list) ? list : []; }
  catch(e){ return []; }
}

// "v2db" or "sheet". Reads the GLOBAL Script Properties (never the per-person ones).
function v2EngineFor_(email){
  var e = String(email || "").trim().toLowerCase();
  if(!e) return "sheet";
  if(e === String(PWA_ALLOWED_EMAIL).toLowerCase()) return PropertiesService.getScriptProperties().getProperty("V2DB_OWNER") === "on" ? "v2db" : "sheet";
  return v2dbUsersOn_().indexOf(e) !== -1 ? "v2db" : "sheet";
}

// Keeps the NEW server (Firebase Cloud Functions, functions/) in step with the on/off switches kept here in Script Properties: it
// reads them from the Firestore document _system/props. Called whenever a switch changes; best-effort (a failure never blocks the
// switch itself). Run exportFlagsToFunctions() by hand once to seed it.
function exportFlagsToFunctions(){
  try{
    var p = PropertiesService.getScriptProperties();
    var fields = { V2DB_USERS: JSON.stringify(v2dbUsersOn_()), updatedAtMs: Date.now() };
    if(p.getProperty("V2DB_OWNER") === "on") fields.V2DB_OWNER = "on";
    if(p.getProperty("V2_FN_WRITES") === "on") fields.V2_FN_WRITES = "on";      // the new server may SAVE (sharedLock.js)
    if(p.getProperty("V2DB_OWNER_DIRECT") === "on") fields.V2DB_OWNER_DIRECT = "on";   // the owner's SMS may land directly (smsIn.js)
    if(p.getProperty("V2_FN_TIMER") === "on") fields.V2_FN_TIMER = "on";              // the new server runs the alert timer
    if(p.getProperty("V2_FN_SMS") === "on") fields.V2_FN_SMS = "on";                  // the new server may take bank SMS (the SMS door)
    fsCommit_([{ set: { path: "_system/props", fields: fields } }]);
    return true;
  }catch(err){
    try{ logAI("FLAGS_EXPORT_ERROR", String(err && err.message).slice(0, 200)); }catch(ignore){}
    return false;
  }
}

// Switching something OFF must never look done when the new server did not hear about it (it keeps the old setting until the copy works).
function flagsExportOrThrow_(what){
  if(!exportFlagsToFunctions()) throw new Error(what + " is switched off HERE, but copying that to the new server FAILED, so the new server may still be using it. Run exportFlagsToFunctions() again until it says true (check AILogs for FLAGS_EXPORT_ERROR).");
}

function v2dbEnableUser(email){
  var e = String(email || "").trim().toLowerCase();
  if(!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(e)) throw new Error("Give a real email address.");
  var list = v2dbUsersOn_();
  if(list.indexOf(e) === -1) list.push(e);
  PropertiesService.getScriptProperties().setProperty("V2DB_USERS", JSON.stringify(list));
  exportFlagsToFunctions();
  return list;
}
function v2dbDisableUser(email){
  var e = String(email || "").trim().toLowerCase();
  var list = v2dbUsersOn_().filter(function(x){ return x !== e; });
  PropertiesService.getScriptProperties().setProperty("V2DB_USERS", JSON.stringify(list));
  exportFlagsToFunctions();
  return list;
}
function v2dbEnableOwner(){ PropertiesService.getScriptProperties().setProperty("V2DB_OWNER", "on"); exportFlagsToFunctions(); return "owner is now on the Firestore-backed spreadsheet"; }
function v2dbDisableOwner(){ PropertiesService.getScriptProperties().deleteProperty("V2DB_OWNER"); exportFlagsToFunctions(); return "owner is back on the Google Sheet"; }

// Lets the NEW server (Cloud Functions) save too, and makes Apps Script's saves/SMS/timer also take the shared lease so the two never
// write at once. Turn ON only after the new server's save support is deployed. Turn off to go back to Apps Script alone (instant).
// The app still decides per phone (Settings > Speed) whether to send saves to the new server.
function v2dbEnableFunctionWrites(){ PropertiesService.getScriptProperties().setProperty("V2_FN_WRITES", "on"); exportFlagsToFunctions(); return "the new server may now save"; }
function v2dbDisableFunctionWrites(){ PropertiesService.getScriptProperties().deleteProperty("V2_FN_WRITES"); flagsExportOrThrow_("New-server saving"); return "saving is back on Apps Script only"; }

// The SMS door on the new server (added 2026-10-14): the Android app tries the new server FIRST for each bank SMS (action smsIn, same code and
// same rules as Apps Script's smsIn). Anything but {ok:true} makes the phone carry on with its old chain (Apps Script smsIn, then the old reader),
// so no message is lost. Needs saving on the new server switched on too (v2dbEnableFunctionWrites). Off = the new server answers "use the old path".
function v2dbEnableFunctionSms(){ PropertiesService.getScriptProperties().setProperty("V2_FN_SMS", "on"); exportFlagsToFunctions(); return "the new server now takes bank SMS (phones that know about it)"; }
// The ALERT TIMER on the new server (added 2026-10-14): a Cloud Scheduler job calls the new server every 5 minutes; it alerts new transactions
// (push with the quick-confirm buttons), settles the known ones, and rebuilds the Home copy. While this is ON the Apps Script timer only copies rows
// that the old SMS doors wrote into the Google Sheet (so nothing is announced twice). Needs saving on the new server too, and push proven there
// (Settings > Speed > "Send a test notification"). Off = Apps Script does everything again, instantly.
function v2dbEnableFunctionTimer(){ PropertiesService.getScriptProperties().setProperty("V2_FN_TIMER", "on"); exportFlagsToFunctions(); return "the new server now runs the alert timer; Apps Script only copies old-door rows"; }
function v2dbDisableFunctionTimer(){ PropertiesService.getScriptProperties().deleteProperty("V2_FN_TIMER"); flagsExportOrThrow_("The new-server timer"); return "Apps Script runs the whole timer again"; }

function v2dbDisableFunctionSms(){ PropertiesService.getScriptProperties().deleteProperty("V2_FN_SMS"); flagsExportOrThrow_("New-server bank SMS"); return "bank SMS no longer go to the new server"; }

// ---------------------------------------------------------------- new people
// Creates any template tab the person doesn't have yet (empty, headers only). Cheap when the tabs already exist: one check.
function v2dbEnsureTemplate_(db){
  if(db.getSheetByName("Transactions")) return false;
  Object.keys(V2_TEMPLATE_TABS_).forEach(function(name){
    if(db.getSheetByName(name)) return;
    var sheet = db.insertSheet(name);
    if(V2_TEMPLATE_TABS_[name]) sheet.appendRow(V2_TEMPLATE_TABS_[name]);
  });
  return true;
}

// ---------------------------------------------------------------- the switchboard
function v2IsSavingAction_(action){
  return V2_WRITE_ACTIONS_.indexOf(action) !== -1 || ["registerPushToken", "createSplit", "recordSplitPayment", "undoSplitEntry", "addFriend"].indexOf(action) !== -1;
}

function v2RouteAndDispatch_(data, verified){
  if(v2EngineFor_(verified.email) !== "v2db") return pwaDispatch_(data, verified);

  var lock = null;
  try{
    if(v2IsSavingAction_(data.action)){
      lock = sharedLock_();                       // Apps Script's lock (+ the shared lease once the new server also saves): sharedLock.js
      lock.waitLock(25000);                       // one saving request at a time
    }
    var attempt = function(){
      V2_AFTER_SAVE_ = [];
      var result = v2dbRun_(verified.email, function(db){
        v2dbEnsureTemplate_(db);
        return pwaDispatch_(data, verified);
      }, { prefetch: v2dbPrefetchFor_(data.action) });
      if(typeof v2FinishSave_ === "function") v2FinishSave_(result);   // e.g. Reconcile's copies for the SMS reader, only after the save worked
      return result;
    };
    try{
      return attempt();
    }catch(e){
      // Someone changed the same data at the same instant: look again once. NEVER for the Splits actions: they also write to
      // Firestore directly (outside the all-or-nothing spreadsheet part), so repeating one could apply a payment twice.
      if(e && e.v2dbConflict && V2_NO_RETRY_ACTIONS_.indexOf(data.action) === -1) return attempt();
      throw e;
    }
  }catch(err){
    try{ logAI("V2DB_REQUEST_ERROR", String(data && data.action) + ": " + String(err && err.message).slice(0, 250)); }catch(ignore){}
    return jsonResponse({ ok: false, error: err && err.v2dbConflict ? "That was changed at the same moment elsewhere, so nothing was saved. Please try again." : "Couldn't complete that. Nothing was saved; try again in a moment." });
  }finally{
    V2_AFTER_SAVE_ = [];
    try{ if(lock) lock.releaseLock(); }catch(ignore){}
  }
}
