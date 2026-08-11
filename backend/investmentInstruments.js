/* ============================================
   INVESTMENT INSTRUMENTS
   ============================================
   Replaces the old free-typed "Type" string on the Investments sheet
   (e.g. "Nifty 50" one time, "Nifty 50 SIP" another — same fund, but
   the exact-string grouping in getInvestmentsData() [PWA.js] treats
   them as two different lines) with a fixed, named list of the user's
   real investments — same idea as the Goals sheet already did for
   Savings (see savingsGoals.js / docs/features/savings-v2.md), applied
   to Investments.

   Plain-English summary: instead of typing "Nifty 50 SIP" by hand every
   time (and maybe spelling it slightly differently), you now pick from
   a fixed list of your real funds/stocks — so the app can always add up
   "how much have I put into HDFC Nifty 50 Index Fund total" correctly.

   Why SIPs are handled differently from the other 12 instruments:
   a SIP is a recurring, near-fixed-amount payment (e.g. the same ₹3000
   every month) — so it's recognized by AMOUNT, via the existing
   FinancialEvents amount-matching mechanism (financialEvents.js), the
   same way Rent/EMI already are. A one-time fund purchase, a stock buy,
   or a gold purchase has no fixed amount — so those 12 are instead
   recognized by NOTE TEXT (the user typing a known name), never by
   amount. Mixing the two would risk a real mistake: e.g. a ₹3000 stock
   purchase accidentally amount-matching the ₹3000 Nifty 50 SIP and
   getting silently logged as the wrong investment. Confirmed with the
   user 2026-08-11 as the reason this file's note-matching function
   (matchInvestmentInstrumentByNote) is a genuinely separate mechanism,
   not a generalization of matchRecurringNamedEvent.

   See docs/features/investment-instruments.md for the full design,
   schema, and the exact frontend contract (action names / fields).
============================================ */

const INVESTMENT_CATEGORY_SIP      = "SIP";
const INVESTMENT_CATEGORY_ONE_TIME = "One-time Fund";
const INVESTMENT_CATEGORY_STOCK    = "Stock";
const INVESTMENT_CATEGORY_GOLD     = "Gold";
const INVESTMENT_CATEGORIES = [
  INVESTMENT_CATEGORY_SIP,
  INVESTMENT_CATEGORY_ONE_TIME,
  INVESTMENT_CATEGORY_STOCK,
  INVESTMENT_CATEGORY_GOLD
];

// The user's real 15 investments, confirmed 2026-08-11 in chat — exact
// names, do not alter. SipAmount is only meaningful for Category "SIP"
// (the recurring monthly amount, used for amount-matching — see file
// header above).
const INVESTMENT_INSTRUMENTS_SEED = [
  { name: "HDFC Nifty 50 Index Fund",          category: INVESTMENT_CATEGORY_SIP,      sipAmount: 3000 },
  { name: "HDFC Mid Cap Fund",                 category: INVESTMENT_CATEGORY_SIP,      sipAmount: 4000 },
  { name: "Bandhan Small Cap (Money2Mgt SIP)", category: INVESTMENT_CATEGORY_SIP,      sipAmount: 2000 },
  { name: "Motilal Oswal Flexi Cap",           category: INVESTMENT_CATEGORY_ONE_TIME, sipAmount: null },
  { name: "HDFC Gold ETF Fund",                category: INVESTMENT_CATEGORY_ONE_TIME, sipAmount: null },
  { name: "Bandhan Small Cap",                 category: INVESTMENT_CATEGORY_ONE_TIME, sipAmount: null },
  { name: "ICICI Prudential",                  category: INVESTMENT_CATEGORY_ONE_TIME, sipAmount: null },
  { name: "HDFC Silver ETF",                   category: INVESTMENT_CATEGORY_ONE_TIME, sipAmount: null },
  { name: "Motilal Oswal Midcap",              category: INVESTMENT_CATEGORY_ONE_TIME, sipAmount: null },
  { name: "Digital Gold",                      category: INVESTMENT_CATEGORY_GOLD,     sipAmount: null },
  { name: "Tata Motors Commercial",            category: INVESTMENT_CATEGORY_STOCK,    sipAmount: null },
  { name: "Tata Steel",                        category: INVESTMENT_CATEGORY_STOCK,    sipAmount: null },
  { name: "LIC",                               category: INVESTMENT_CATEGORY_STOCK,    sipAmount: null },
  { name: "HDFC Bank",                         category: INVESTMENT_CATEGORY_STOCK,    sipAmount: null },
  { name: "Tata Motors Passenger",             category: INVESTMENT_CATEGORY_STOCK,    sipAmount: null }
];

/* ============================================
   SHEET ACCESS
============================================ */

// Auto-creates AND seeds the InvestmentInstruments sheet the first time
// anything asks for it — same "auto-create if missing" pattern as
// getFinancialEventsSheet() (financialEvents.js), but this one also
// seeds the fixed real-instrument list at creation time, since nothing
// in this feature is useful without it (matching, the manual-log
// dropdown, etc. all read this sheet). Seeding only ever happens the
// one time the sheet doesn't exist yet — every call after that just
// returns the existing sheet, untouched.
function getInvestmentInstrumentsSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("InvestmentInstruments");
  if(!sheet){
    sheet = ss.insertSheet("InvestmentInstruments");
    sheet.appendRow(["Name", "Category", "SipAmount"]);
    INVESTMENT_INSTRUMENTS_SEED.forEach(function(inst){
      sheet.appendRow([inst.name, inst.category, inst.sipAmount || ""]);
    });
  }
  return sheet;
}

// Returns the full instrument list, both flat and grouped by Category —
// the frontend's "+ Log an Investment" picker can use whichever shape
// is more convenient (grouped for section headers like "SIPs"/"Stocks",
// flat for a plain dropdown/search).
function getInvestmentInstrumentsList(){
  const sheet = getInvestmentInstrumentsSheet_();
  const data = sheet.getDataRange().getValues();

  const instruments = [];
  for(let i = 1; i < data.length; i++){
    const name = (data[i][0] || "").toString().trim();
    if(!name) continue;
    instruments.push({
      name: name,
      category: (data[i][1] || "").toString().trim(),
      sipAmount: data[i][2] ? Number(data[i][2]) : null
    });
  }

  const grouped = INVESTMENT_CATEGORIES.map(function(cat){
    return {
      category: cat,
      instruments: instruments.filter(function(inst){ return inst.category === cat; })
    };
  });

  return { instruments: instruments, grouped: grouped };
}

// Name -> Category lookup, used by getInvestmentsData() (PWA.js) to
// label each breakdown line without changing how it groups/sums (still
// an exact-string match on the Investments sheet's own Type column).
function getInstrumentCategoryMap_(){
  const sheet = getInvestmentInstrumentsSheet_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  for(let i = 1; i < data.length; i++){
    const name = (data[i][0] || "").toString().trim();
    if(name) map[name] = (data[i][1] || "").toString().trim();
  }
  return map;
}

// Confirms a name really exists in InvestmentInstruments before it's
// ever written anywhere — never trust a value from the frontend without
// checking it server-side (same defensive pattern as
// updateInvestmentEntry's row-number check elsewhere in this project).
// On a match, returns the sheet's OWN stored spelling/casing — not
// whatever the caller passed in — so every write path stays byte-for-
// byte consistent. That consistency is what keeps getInvestmentsData()'s
// exact-string grouping correct.
function validateInvestmentInstrumentName_(name){
  const clean = (name || "").toString().trim();
  if(!clean) return { ok:false, error:"Choose an investment." };

  const sheet = getInvestmentInstrumentsSheet_();
  const data = sheet.getDataRange().getValues();
  for(let i = 1; i < data.length; i++){
    const rowName = (data[i][0] || "").toString().trim();
    if(rowName.toLowerCase() === clean.toLowerCase()){
      return { ok:true, name: rowName };
    }
  }
  return { ok:false, error:"Unknown investment — add it first." };
}

// Adds a brand-new instrument to the fixed list. Used by two flows:
// (1) the manual "+ Log an Investment" form's "+ Add new instrument"
//     option, and
// (2) confirming a brand-new, unnamed stock/fund spotted by
//     matchInvestmentInstrumentByNote below ("looks like a new stock —
//     what's it called?").
// Deliberately does NOT accept a SipAmount — a brand-new SIP mandate
// isn't something either of those two flows creates (see file header);
// if a genuinely new SIP is ever added for real, its SipAmount can be
// set directly on the sheet, same rare one-time-exception spirit as any
// other manual Sheets edit already allowed in this project.
function addInvestmentInstrument(name, category){
  const cleanName = (name || "").toString().trim();
  const cleanCategory = (category || "").toString().trim();

  if(!cleanName) return { ok:false, error:"Enter an instrument name." };
  if(INVESTMENT_CATEGORIES.indexOf(cleanCategory) === -1){
    return { ok:false, error:"Choose a valid category." };
  }

  const sheet = getInvestmentInstrumentsSheet_();
  const data = sheet.getDataRange().getValues();
  const alreadyExists = data.slice(1).some(function(r){
    return (r[0] || "").toString().trim().toLowerCase() === cleanName.toLowerCase();
  });
  if(alreadyExists) return { ok:false, error:"That investment already exists." };

  sheet.appendRow([cleanName, cleanCategory, ""]);
  return { ok:true, name: cleanName, category: cleanCategory };
}

/* ============================================
   NOTE-TEXT MATCHING — the 12 non-SIP instruments
   ============================================
   Deliberately SEPARATE from suggestFinancialEvent/
   matchRecurringNamedEvent (financialEvents.js) and NEVER consults
   amount-matching — see the "Why SIPs are handled differently" note at
   the top of this file for why. Same trust-the-user's-own-wording
   spirit as isLendingTransfer/isSavingsNote (needWantSaving.js /
   financialEvents.js) — recognizes a known instrument name (or a
   generic "stock"/"shares" mention) directly from what was typed in
   the note, nothing else.
============================================ */

// Every non-SIP instrument name — SIPs are excluded here on purpose,
// since they're already covered by amount-matching (registered into
// FinancialEvents by the one-time migration function further down).
function getNonSipInstrumentNames_(instrumentsData){
  const names = [];
  for(let i = 1; i < instrumentsData.length; i++){
    const name = (instrumentsData[i][0] || "").toString().trim();
    const category = (instrumentsData[i][1] || "").toString().trim();
    if(name && category !== INVESTMENT_CATEGORY_SIP) names.push(name);
  }
  return names;
}

// Whole-phrase, case-insensitive match with word boundaries at both
// ends of the FULL name — NOT a plain substring check. Same lesson as
// the "lent" bug (see needWantSaving.js's isLendingTransfer comment): a
// short name like "LIC" as a bare substring would also match inside
// "PUBLIC", "POLICY", etc. Matching the full phrase (not just its first
// word) also means "Tata Steel" and "Tata Motors Commercial" can never
// be confused with each other, even though they share a first word.
function noteContainsInstrumentName_(name, noteTextLower){
  const escaped = name.toString().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("\\b" + escaped + "\\b", "i");
  return pattern.test(noteTextLower);
}

// Returns one of three shapes:
//   { type:"Investment", name:"<exact name>", confident:true }
//     — a known instrument was recognized in the note (one-tap confirm).
//   { type:"Investment", name:null, confident:false }
//     — looks like a NEW stock/fund ("stock"/"shares" mentioned), but no
//       name to suggest yet — the UI should ask "which one?" (mirrors
//       the existing "brand-new EMI, no name yet" shape from
//       suggestFinancialEvent, for consistency — but this is a genuinely
//       separate code path, see file header).
//   null
//     — nothing investment-related found in the note at all.
//
// instrumentsData is the InvestmentInstruments sheet's raw values
// (getDataRange().getValues()) — passed in, not read here, so
// getPendingTransactions/getTransactionHistory (PWA.js) can read the
// sheet once and reuse it across every row, same "read outside the
// loop" pattern already used for SmartMemory/TypeVotes/FinancialEvents.
function matchInvestmentInstrumentByNote(note, instrumentsData){
  const noteText = (note || "").toString().toLowerCase().trim();
  if(!noteText) return null;

  const names = getNonSipInstrumentNames_(instrumentsData);
  for(let i = 0; i < names.length; i++){
    if(noteContainsInstrumentName_(names[i], noteText)){
      return { type: "Investment", name: names[i], confident: true };
    }
  }

  // No exact instrument name in the note, but the wording itself
  // suggests a stock/fund purchase — flagged so the UI can still ask
  // "which one?" instead of silently missing it entirely. Whole-word,
  // same reasoning as everywhere else in this file.
  if(/\bstocks?\b/.test(noteText) || /\bshares?\b/.test(noteText)){
    return { type: "Investment", name: null, confident: false };
  }

  return null;
}

/* ============================================
   ONE-TIME MIGRATION — 2026-08-11
   ============================================
   Run once, MANUALLY, from the Apps Script editor (select
   migrateInvestmentsToNamedInstruments, Run, then View > Logs) — this
   is NOT called by the PWA and does NOT run automatically. Same spirit
   as migrateSavingsToV2() (savingsGoals.js) and auditInvestmentsSheet()
   (PWA.js), which this replaces the "what should the migration actually
   do" answer for.

   What it does:
   1. Clears the Investments sheet's 5 old, generically-typed rows
      ("Mutual Funds", "Gold", "Stocks", "Mutual Fund (Money2Mgt)",
      "Mutual Funds SIP" — confirmed via auditInvestmentsSheet()) and
      replaces them with 15 new rows, one per real named instrument,
      each carrying its till-date invested total as a "Starting
      Balance" row (see docs/features/investment-instruments.md for
      exactly where these numbers came from — they were given directly
      by the user, not calculated here).
   2. Registers the 3 real SIPs into FinancialEvents (via the existing
      recordFinancialEvent(), the exact same call a live Pending/
      History confirm would make) so they're recognized BY AMOUNT from
      day one — no need to re-ask "what would you call this" the next
      time these exact SIP amounts recur.

   Safe to run only ONCE. Running it again would re-delete/re-add the
   15 rows (harmless data-wise, but the "Starting Balance" date would
   silently move to whatever day it was re-run) AND double-register the
   3 SIPs into FinancialEvents (harmless for matching itself — it only
   ever needs ONE matching row — but still needless duplicate data). If
   this ever genuinely needs re-running, clear the relevant rows first.
============================================ */
function migrateInvestmentsToNamedInstruments(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const investSheet = ss.getSheetByName("Investments");
  if(!investSheet){
    Logger.log("No Investments sheet found — nothing to migrate.");
    return;
  }

  // Make sure InvestmentInstruments exists (and is seeded) first — the
  // rows appended below rely on its exact Name spellings matching.
  getInvestmentInstrumentsSheet_();

  const lastRow = investSheet.getLastRow();
  const removedCount = Math.max(lastRow - 1, 0);
  if(lastRow > 1){
    investSheet.deleteRows(2, lastRow - 1); // keep header (row 1), clear every old data row
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  // [instrument name, till-date invested total] — exact figures given by
  // the user 2026-08-11 in chat. Do not round or alter.
  const startingBalances = [
    ["HDFC Nifty 50 Index Fund", 20000],
    ["HDFC Mid Cap Fund", 11000],
    ["Bandhan Small Cap (Money2Mgt SIP)", 58000],
    ["Motilal Oswal Flexi Cap", 5000],
    ["HDFC Gold ETF Fund", 5500],
    ["Bandhan Small Cap", 5000],
    ["ICICI Prudential", 5000],
    ["HDFC Silver ETF", 5000],
    ["Motilal Oswal Midcap", 1000],
    ["Digital Gold", 5615],
    ["Tata Motors Commercial", 566.94],
    ["Tata Steel", 157],
    ["LIC", 1753.52],
    ["HDFC Bank", 7851.82],
    ["Tata Motors Passenger", 1253.06]
  ];

  startingBalances.forEach(function(entry){
    investSheet.appendRow([today, entry[0], entry[1], "Starting Balance"]);
  });

  // Register the 3 real SIPs so they're recognized by amount right away
  // — same call a live confirm would make (recordFinancialEvent, in
  // financialEvents.js).
  recordFinancialEvent("Investment", 3000, "", "HDFC Nifty 50 Index Fund");
  recordFinancialEvent("Investment", 4000, "", "HDFC Mid Cap Fund");
  recordFinancialEvent("Investment", 2000, "", "Bandhan Small Cap (Money2Mgt SIP)");

  Logger.log(
    "Investments sheet migrated: removed " + removedCount + " old row(s), added " +
    startingBalances.length + " new named-instrument rows.\n" +
    "Registered 3 SIPs into FinancialEvents for amount-matching: " +
    "HDFC Nifty 50 Index Fund (Rs.3000), HDFC Mid Cap Fund (Rs.4000), " +
    "Bandhan Small Cap (Money2Mgt SIP) (Rs.2000)."
  );
}
