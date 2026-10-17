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
  const ss = dbSs_();
  let sheet = ss.getSheetByName("InvestmentInstruments");
  if(!sheet){
    sheet = ss.insertSheet("InvestmentInstruments");
    sheet.appendRow(["Name", "Category", "SipAmount", "SipDay", "SipActive"]);
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
      sipAmount: data[i][2] ? Number(data[i][2]) : null,
      // SIP plan details (added 2026-10-17, see investmentsOverview.js): the usual day of the month, and
      // whether the SIP is running. A blank SipActive on a row with an amount means running (older rows).
      sipDay: data[i][3] ? Number(data[i][3]) : null,
      sipActive: (data[i][4] || "").toString().trim().toLowerCase() !== "no"
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
  const ss = dbSs_();
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

/* ============================================
   INVESTMENTS OVERVIEW + SIP PLANS (2026-10-17, Investments tab makeover)
   ============================================
   Plain English: the redesigned Investments tab needs numbers the old screen never had:
   what you have put in so far, this month against your goal, a tracker for each monthly
   SIP (paid / coming / overdue), where the money sits (SIP funds, one-time funds, stocks,
   gold), a share-of-total for each holding and the last 6 months. All of it is worked out
   here from two tabs only: Investments (the money that went in) and InvestmentInstruments
   (your named holdings and their SIP plans). Nothing is guessed.

   Investments tab, columns: Date, Name, Amount, Note, Kind
     Kind says what a row is:
       opening  = what you had already put in when you started tracking (or typed in setup).
                  Counts in "put in so far" but NOT in this month / the monthly bars.
       payment  = money the app saw leave your bank (a SIP or a confirmed payment note).
       manual   = money you added by hand with "Add money".
       sale     = money you took out (negative amount).
     Old rows with no Kind are read like this: the note "Starting Balance" = opening,
     a negative amount = sale, anything else = payment.

   InvestmentInstruments tab, columns: Name, Category, SipAmount, SipDay, SipActive
     SipAmount + SipDay + SipActive describe a monthly SIP plan. SipActive "no" = paused.
     A blank SipActive on a row that has an amount means active (older rows).

   Paused SIPs: the app recognises a SIP payment by remembering its amount in the
   FinancialEvents tab. A paused SIP must stop being recognised, so pausing adds a marker
   row (Type "InvestmentPaused", Name = the SIP). The matching code in financialEvents.js
   skips any name that has such a marker. Resuming removes the marker.

   All month maths is done in INDIA time: the Cloud Functions server
   runs in UTC, so reading a date with getMonth() would put the 1st into the month before.
============================================ */

const INV_KIND_OPENING_ = "opening";
const INV_KIND_PAYMENT_ = "payment";
const INV_KIND_MANUAL_  = "manual";
const INV_KIND_SALE_    = "sale";
const INV_PAUSED_TYPE_  = "InvestmentPaused";
const INV_OVERDUE_AFTER_DAYS_ = 2;       // a SIP is "overdue" once today is this many days past its due day

const INV_TZ_ = "Asia/Kolkata";

// Date helpers (own copies, so this part has no dependence on the Savings file).
function invIstParts_(date){
  const p = Utilities.formatDate(date, INV_TZ_, "yyyy-MM-dd").split("-");
  return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
}
function invMonthIndex_(date){ const p = invIstParts_(date); return p.y * 12 + (p.m - 1); }
// A cell that holds a date (a real Date or text like "2026-10-01") -> a Date, or null.
function invEntryDate_(v){
  if(v === "" || v === null || v === undefined) return null;
  const d = Object.prototype.toString.call(v) === "[object Date]" ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
// "yyyy-MM-dd" -> {y, m, d}, or null when it is not a real calendar date.
function invParseIso_(s){
  if(typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const p = s.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if(dt.getUTCFullYear() !== p[0] || dt.getUTCMonth() !== p[1] - 1 || dt.getUTCDate() !== p[2]) return null;
  return { y: p[0], m: p[1], d: p[2] };
}

// What kind a row of the Investments tab is (see the header note for the rules).
function invKind_(row){
  const k = (row[4] || "").toString().trim().toLowerCase();
  if(k === INV_KIND_OPENING_ || k === INV_KIND_PAYMENT_ || k === INV_KIND_MANUAL_ || k === INV_KIND_SALE_) return k;
  if((row[3] || "").toString().trim().toLowerCase() === "starting balance") return INV_KIND_OPENING_;
  return (Number(row[2]) || 0) < 0 ? INV_KIND_SALE_ : INV_KIND_PAYMENT_;
}

function invIsoOf_(date){ return Utilities.formatDate(date, INV_TZ_, "yyyy-MM-dd"); }

// Money that went IN from your pocket (payments and hand-added); what "this month" and the bars count.
function invIsAddedMoney_(kind, amount){
  return (kind === INV_KIND_PAYMENT_ || kind === INV_KIND_MANUAL_) && amount > 0;
}

// Pure. rows = Investments data rows WITHOUT the header (sheet row = index + 2).
// instruments = [{name, category, sipAmount, sipDay, sipActive}]. now can be injected for tests.
function computeInvestmentsOverview_(rows, instruments, monthlyGoal, now){
  monthlyGoal = Number(monthlyGoal) || 0;
  now = now || new Date();
  const nowIdx = invMonthIndex_(now);
  const today = invIstParts_(now);

  const byName = {};                       // name -> {putIn, last, entries:[], paymentMonths:{idx:true}}
  const monthAdded = {};                   // month index -> money added
  let totalPutIn = 0, addedSinceStart = 0;

  rows.forEach(function(r, i){
    const name = (r[1] || "").toString().trim();
    const amount = Number(r[2]) || 0;
    const d = invEntryDate_(r[0]);
    if(!name || !amount) return;
    const kind = invKind_(r);
    const h = byName[name] || (byName[name] = { putIn: 0, last: null, entries: [], paymentMonths: {} });
    h.putIn += amount;
    totalPutIn += amount;
    if(kind !== INV_KIND_OPENING_) addedSinceStart += amount;
    if(d && (h.last === null || d.getTime() > h.last.getTime())) h.last = d;
    h.entries.push({ row: i + 2, date: d ? invIsoOf_(d) : "", amount: amount, kind: kind, note: (r[3] || "").toString() });
    if(d && invIsAddedMoney_(kind, amount)){
      const idx = invMonthIndex_(d);
      monthAdded[idx] = (monthAdded[idx] || 0) + amount;
      h.paymentMonths[idx] = d;
    }
  });

  const monthly = [];
  for(let k = 5; k >= 0; k--){
    const idx = nowIdx - k;
    monthly.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1, amount: monthAdded[idx] || 0 });
  }

  // ---- SIP tracker
  const sips = [];
  let paidTracked = 0, monthsTracked = 0;
  instruments.forEach(function(inst){
    if(!(Number(inst.sipAmount) > 0)) return;
    const h = byName[inst.name];
    let day = Number(inst.sipDay) >= 1 && Number(inst.sipDay) <= 31 ? Math.floor(Number(inst.sipDay)) : null;
    // a SIP due on the 31st is due on the last day of a shorter month
    if(day !== null) day = Math.min(day, new Date(Date.UTC(today.y, today.m, 0)).getUTCDate());
    const active = inst.sipActive !== false;
    const months = h ? Object.keys(h.paymentMonths).map(Number).sort(function(a, b){ return a - b; }) : [];
    const paidNow = h && h.paymentMonths[nowIdx] ? h.paymentMonths[nowIdx] : null;
    let status = "upcoming", daysLate = 0, daysUntil = null;
    if(!active) status = "paused";
    else if(paidNow) status = "paid";
    else if(day !== null && today.d - day >= INV_OVERDUE_AFTER_DAYS_){ status = "overdue"; daysLate = today.d - day; }
    else if(day !== null) daysUntil = Math.max(day - today.d, 0);
    // how many COMPLETED months since its first payment had a payment (never counts a month before the first one)
    let tracked = 0, paid = 0;
    if(months.length){
      for(let idx = months[0]; idx < nowIdx; idx++){
        tracked++;
        if(h.paymentMonths[idx]) paid++;
      }
    }
    if(active){ paidTracked += paid; monthsTracked += tracked; }
    sips.push({
      name: inst.name, amount: Number(inst.sipAmount), day: day, active: active, status: status,
      paidOn: paidNow ? invIsoOf_(paidNow) : "", daysLate: daysLate, daysUntil: daysUntil,
      paidMonths: paid, trackedMonths: tracked
    });
  });
  const activeSips = sips.filter(function(s){ return s.active; });

  // ---- holdings + allocation
  const known = {};
  instruments.forEach(function(inst){ known[inst.name] = inst; });
  const holdings = [];
  const catTotals = {};
  Object.keys(byName).forEach(function(name){
    const h = byName[name];
    const inst = known[name] || { name: name, category: "", sipAmount: null, sipDay: null, sipActive: true };
    holdings.push({
      name: name, category: inst.category || "", putIn: Math.round(h.putIn * 100) / 100,
      hasSip: Number(inst.sipAmount) > 0, sipActive: inst.sipActive !== false,
      lastDate: h.last ? invIsoOf_(h.last) : "",
      entries: h.entries.slice(-12).reverse()
    });
    if(h.putIn > 0) catTotals[inst.category || "Other"] = (catTotals[inst.category || "Other"] || 0) + h.putIn;
  });
  // holdings with a SIP plan but nothing put in yet still get a card
  instruments.forEach(function(inst){
    if(Number(inst.sipAmount) > 0 && !byName[inst.name]){
      holdings.push({ name: inst.name, category: inst.category || "", putIn: 0, hasSip: true, sipActive: inst.sipActive !== false, lastDate: "", entries: [] });
    }
  });
  const positiveTotal = holdings.reduce(function(a, h){ return a + Math.max(h.putIn, 0); }, 0);
  holdings.forEach(function(h){ h.share = positiveTotal > 0 ? Math.round(Math.max(h.putIn, 0) / positiveTotal * 1000) / 10 : 0; });
  holdings.sort(function(a, b){ return b.putIn - a.putIn; });
  const allocation = Object.keys(catTotals).map(function(c){
    return { category: c, amount: Math.round(catTotals[c] * 100) / 100, pct: positiveTotal > 0 ? Math.round(catTotals[c] / positiveTotal * 1000) / 10 : 0 };
  }).sort(function(a, b){ return b.amount - a.amount; });

  return {
    totalPutIn: Math.round(totalPutIn * 100) / 100,
    addedSinceStart: Math.round(addedSinceStart * 100) / 100,
    thisMonth: monthAdded[nowIdx] || 0,
    monthlyGoal: monthlyGoal,
    monthly: monthly,
    sips: sips,
    sipCommitment: activeSips.reduce(function(a, s){ return a + s.amount; }, 0),
    sipsActive: activeSips.length,
    sipsPaid: activeSips.filter(function(s){ return s.status === "paid"; }).length,
    sipsOverdue: activeSips.filter(function(s){ return s.status === "overdue"; }).length,
    onTime: { paid: paidTracked, of: monthsTracked },
    holdings: holdings,
    allocation: allocation,
    instruments: instruments.map(function(i){
      return { name: i.name, category: i.category, sipAmount: i.sipAmount || null, sipDay: i.sipDay || null, sipActive: i.sipActive !== false };
    }),
    hasData: rows.length > 0
  };
}

// Reads the two tabs and the monthly goal, then calls the pure function above.
function getInvestmentsOverview_(){
  const invSheet = dbSs_().getSheetByName("Investments");
  const data = invSheet ? invSheet.getDataRange().getValues() : [];
  const rows = data.slice(1).filter(function(r){ return r.some(function(c){ return c !== "" && c !== null && c !== undefined; }); });
  const list = getInvestmentInstrumentsList().instruments;
  const goal = (typeof getSettings === "function") ? (getSettings().monthlyInvestmentGoal || 0) : 0;
  return computeInvestmentsOverview_(rows, list, goal, new Date());
}

/* ============================================
   WRITING
============================================ */

function invTodayIso_(){ return Utilities.formatDate(new Date(), INV_TZ_, "yyyy-MM-dd"); }

// "yyyy-MM-dd" that is a real date and not in the future (India time) -> the same string, else null.
function invValidPastDate_(s){
  if(s === undefined || s === null || s === "") return invTodayIso_();
  if(typeof s !== "string" || !invParseIso_(s)) return null;
  return s <= invTodayIso_() ? s : null;
}

function invDayNumber_(iso){ const p = invParseIso_(iso); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000); }

// What a holding has right now (net of sales), from the Investments tab.
function invHoldingTotal_(name){
  const sheet = dbSs_().getSheetByName("Investments");
  if(!sheet) return 0;
  const data = sheet.getDataRange().getValues();
  let total = 0;
  for(let i = 1; i < data.length; i++){
    if((data[i][1] || "").toString().trim() === name) total += Number(data[i][2]) || 0;
  }
  return Math.round(total * 100) / 100;
}

// Make sure the Investments tab's header names its 5th column "Kind" (older tabs only had 4).
function invEnsureKindHeader_(sheet){
  const cell = sheet.getRange(1, 5);
  const cur = (cell.getValue() || "").toString().trim();
  if(cur === ""){ cell.setValue("Kind"); return true; }
  return cur === "Kind";
}

// Add money by hand ("Add money" sheet). date optional (default today, never in the future).
// A same-amount entry for the SAME holding within 5 days is flagged as a likely repeat and NOT saved,
// unless the caller sends force:true (the person said "add it anyway").
function logInvestmentFromApp(amount, instrumentName, opts){
  try{
    opts = opts || {};
    const validation = validateInvestmentInstrumentName_(instrumentName);
    if(!validation.ok) return validation;
    const amt = Number(amount);
    if(!amt || amt <= 0 || !isFinite(amt)) return { ok:false, error:"Enter a valid amount." };
    const date = invValidPastDate_(opts.date);
    if(date === null) return { ok:false, error:"Choose today or an earlier date." };
    const note = (opts.note || "").toString().trim().slice(0, 120);

    const investSheet = dbSs_().getSheetByName("Investments");
    if(!invEnsureKindHeader_(investSheet)) return { ok:false, error:"The Investments tab's fifth column is in use. Ask for help." };

    if(!opts.force){
      const data = investSheet.getDataRange().getValues();
      const want = invDayNumber_(date);
      for(let i = 1; i < data.length; i++){
        if((data[i][1] || "").toString().trim() !== validation.name) continue;
        const d = invEntryDate_(data[i][0]);
        if(!d) continue;
        const got = invDayNumber_(invIsoOf_(d));
        if(Math.abs(got - want) <= 5 && Math.abs((Number(data[i][2]) || 0) - amt) < 1){
          return { ok:false, duplicate:true, error: validation.name + " already has " + (Number(data[i][2]) || 0) + " on " + invIsoOf_(d) + ". Add it anyway?" };
        }
      }
    }

    investSheet.appendRow([date, validation.name, amt, note, INV_KIND_MANUAL_]);
    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Money taken out of a holding (sold or withdrawn). Never more than what is in it.
function recordInvestmentSale(name, amount, date, note){
  try{
    const validation = validateInvestmentInstrumentName_(name);
    if(!validation.ok) return validation;
    const amt = Number(amount);
    if(!amt || amt <= 0 || !isFinite(amt)) return { ok:false, error:"Enter a valid amount." };
    const d = invValidPastDate_(date);
    if(d === null) return { ok:false, error:"Choose today or an earlier date." };
    const have = invHoldingTotal_(validation.name);
    if(amt > have + 0.005) return { ok:false, error:"That is more than the " + have + " put into " + validation.name + "." };
    const sheet = dbSs_().getSheetByName("Investments");
    if(!invEnsureKindHeader_(sheet)) return { ok:false, error:"The Investments tab's fifth column is in use. Ask for help." };
    sheet.appendRow([d, validation.name, -amt, (note || "Sale").toString().trim().slice(0, 120), INV_KIND_SALE_]);
    return { ok:true };
  }catch(err){
    return { ok:false, error:err.toString() };
  }
}

// Removes one entry. The phone sends what it saw (name + amount) so a changed sheet can never delete the wrong row.
function deleteInvestmentEntry(row, expectName, expectAmount){
  try{
    const sheet = dbSs_().getSheetByName("Investments");
    if(!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) return { ok:false, error:"Invalid row." };
    const r = sheet.getRange(row, 1, 1, 5).getValues()[0];
    if((r[1] || "").toString().trim() !== (expectName || "").toString().trim() || Math.abs((Number(r[2]) || 0) - Number(expectAmount)) > 0.005){
      return { ok:false, stale:true, error:"That entry changed. Reopen the holding and try again." };
    }
    sheet.deleteRow(row);
    return { ok:true };
  }catch(err){
    return { ok:false, error:err.toString() };
  }
}

// ---- SIP plans <-> FinancialEvents (how a bank payment gets recognised as this SIP)

function invFeRows_(){
  const sheet = getFinancialEventsSheet();
  return { sheet: sheet, data: sheet.getDataRange().getValues() };
}

// Make FinancialEvents agree with the plan: ONE remembered amount for this SIP, its payee kept,
// and a "paused" marker present exactly when the plan is paused.
function invSyncSipEvents_(name, amount, active){
  const fe = invFeRows_();
  const data = fe.data;
  let payee = "";
  for(let i = data.length - 1; i >= 1; i--){
    if(data[i][0] === "Investment" && (data[i][4] || "").toString() === name && (data[i][2] || "").toString().trim()){ payee = data[i][2]; break; }
  }
  let haveExact = false;
  for(let i = data.length - 1; i >= 1; i--){
    if(data[i][0] === "Investment" && (data[i][4] || "").toString() === name){
      if(Number(data[i][1]) === Number(amount)) haveExact = true;
      else fe.sheet.deleteRow(i + 1);                      // an older amount of this SIP (it was stepped up or down)
    }
  }
  if(!haveExact) recordFinancialEvent("Investment", amount, payee, name);

  const after = fe.sheet.getDataRange().getValues();
  let markerRow = 0;
  for(let i = after.length - 1; i >= 1; i--){
    if(after[i][0] === INV_PAUSED_TYPE_ && (after[i][4] || "").toString() === name){
      if(markerRow || active) fe.sheet.deleteRow(i + 1);   // resumed, or a duplicate marker
      else markerRow = i + 1;
    }
  }
  if(!active && !markerRow) fe.sheet.appendRow([INV_PAUSED_TYPE_, 0, "", new Date(), name]);
}

// Turn a SIP plan fully off (no plan any more): forget its amounts and any paused marker.
function invRemoveSipEvents_(name){
  const data = invFeRows_();
  for(let i = data.data.length - 1; i >= 1; i--){
    const t = data.data[i][0];
    if((t === "Investment" || t === INV_PAUSED_TYPE_) && (data.data[i][4] || "").toString() === name){
      if(t === INV_PAUSED_TYPE_) data.sheet.deleteRow(i + 1);
      // The remembered amount rows of a removed plan are kept on purpose: they still teach the payee for a one-off buy of the same fund.
    }
  }
}

// The one place a holding is created or changed.
//   p.name (required), p.category (one of the 4; ignored when a SIP plan is on: that makes it "SIP")
//   p.putInSoFar (optional, >= 0): the holding's total so far; the difference is stored as an "opening" row
//   p.sipOn: true = plan on (needs sipAmount, sipDay 1-31; sipActive default true), false = no plan, undefined = leave the plan alone
//   p.paidThisMonth (with sipOn true): also record this month's SIP payment as already made (see below)
function saveInvestmentHolding(p){
  try{
    p = p || {};
    const cleanName = (p.name || "").toString().trim();
    if(!cleanName) return { ok:false, error:"Enter a name." };
    if(cleanName.length > 60) return { ok:false, error:"That name is too long." };

    let sipAmount = null, sipDay = null, sipActive = true;
    if(p.sipOn === true){
      sipAmount = Number(p.sipAmount);
      sipDay = Number(p.sipDay);
      if(!(sipAmount > 0) || !isFinite(sipAmount)) return { ok:false, error:"Enter the SIP amount." };
      if(!Number.isInteger(sipDay) || sipDay < 1 || sipDay > 31) return { ok:false, error:"Enter the day of the month, 1 to 31." };
      sipActive = p.sipActive !== false;
    }
    let putIn = null;
    if(p.putInSoFar !== undefined && p.putInSoFar !== null && p.putInSoFar !== ""){
      putIn = Number(p.putInSoFar);
      if(!isFinite(putIn) || putIn < 0) return { ok:false, error:"Put in so far must be zero or more." };
    }

    const sheet = getInvestmentInstrumentsSheet_();
    if((sheet.getRange(1, 4).getValue() || "") === "") sheet.getRange(1, 4).setValue("SipDay");
    if((sheet.getRange(1, 5).getValue() || "") === "") sheet.getRange(1, 5).setValue("SipActive");
    let data = sheet.getDataRange().getValues();
    let row = 0, existing = null;
    for(let i = 1; i < data.length; i++){
      if((data[i][0] || "").toString().trim().toLowerCase() === cleanName.toLowerCase()){ row = i + 1; existing = data[i]; break; }
    }
    const storedName = existing ? (existing[0] || "").toString().trim() : cleanName;
    let category = (p.category || (existing ? existing[1] : "") || "").toString().trim();
    if(p.sipOn === true) category = INVESTMENT_CATEGORY_SIP;
    else if(p.sipOn === false && category === INVESTMENT_CATEGORY_SIP && !(p.category && p.category !== INVESTMENT_CATEGORY_SIP)) category = INVESTMENT_CATEGORY_ONE_TIME;
    if(INVESTMENT_CATEGORIES.indexOf(category) === -1) return { ok:false, error:"Choose what kind of holding this is." };

    if(!existing){
      sheet.appendRow([storedName, category, "", "", ""]);
      row = sheet.getLastRow();
    }
    sheet.getRange(row, 2).setValue(category);
    if(p.sipOn === true){
      sheet.getRange(row, 3).setValue(sipAmount);
      sheet.getRange(row, 4).setValue(sipDay);
      sheet.getRange(row, 5).setValue(sipActive ? "yes" : "no");
    }else if(p.sipOn === false){
      sheet.getRange(row, 3).setValue("");
      sheet.getRange(row, 4).setValue("");
      sheet.getRange(row, 5).setValue("");
    }

    // "Already paid this month" (set up / edit sheet): records this month's SIP payment now, so a SIP paid before it was
    // set up does not show as overdue. Dated on the due day (or today if the due day is still ahead). Skipped when a payment
    // for this holding already exists this month. It is added BEFORE the put-in-so-far difference below, so the total the
    // person typed stays exactly what they typed (this payment is part of it).
    if(p.sipOn === true && p.paidThisMonth === true && sipActive){
      const inv0 = dbSs_().getSheetByName("Investments");
      if(!invEnsureKindHeader_(inv0)) return { ok:false, error:"The Investments tab's fifth column is in use. Ask for help." };
      const nowIdx = invMonthIndex_(new Date());
      const rows0 = inv0.getDataRange().getValues();
      let already = false;
      for(let i = 1; i < rows0.length; i++){
        const d0 = invEntryDate_(rows0[i][0]);
        if((rows0[i][1] || "").toString().trim() === storedName && d0 && invMonthIndex_(d0) === nowIdx && invIsAddedMoney_(invKind_(rows0[i]), Number(rows0[i][2]) || 0)){ already = true; break; }
      }
      if(!already){
        const t = invIstParts_(new Date());
        const day = Math.min(sipDay, t.d);
        const iso = t.y + "-" + (t.m < 10 ? "0" : "") + t.m + "-" + (day < 10 ? "0" : "") + day;
        inv0.appendRow([iso, storedName, sipAmount, "SIP paid this month", INV_KIND_PAYMENT_]);
      }
    }

    if(putIn !== null){
      const have = invHoldingTotal_(storedName);
      const delta = Math.round((putIn - have) * 100) / 100;
      if(delta !== 0){
        const inv = dbSs_().getSheetByName("Investments");
        if(!invEnsureKindHeader_(inv)) return { ok:false, error:"The Investments tab's fifth column is in use. Ask for help." };
        inv.appendRow([invTodayIso_(), storedName, delta, "Set up", INV_KIND_OPENING_]);
      }
    }

    if(p.sipOn === true) invSyncSipEvents_(storedName, sipAmount, sipActive);
    else if(p.sipOn === false) invRemoveSipEvents_(storedName);

    return { ok:true, name: storedName, category: category };
  }catch(err){
    return { ok:false, error:err.toString() };
  }
}

// ONE-TIME "start fresh" for the Investments tab. Copies every current entry into the Investments_Archive tab
// (nothing is lost), empties the Investments tab, and tidies the SIP-recognition memory:
//   - remembered SIP payments filed under a name that is not one of your holdings (an old free-typed name)
//     are moved onto the ONE SIP holding with the same amount, when there is exactly one such holding;
//   - every SIP with a plan gets its amount remembered again.
// The caller must send confirm === "FRESH". Running it twice is harmless (the second time archives nothing).
function startInvestmentsFresh(confirm){
  try{
    if(confirm !== "FRESH") return { ok:false, error:"Not confirmed." };
    const ss = dbSs_();
    const inv = ss.getSheetByName("Investments");
    if(!inv) return { ok:false, error:"No Investments tab." };
    const data = inv.getDataRange().getValues();
    const rows = data.slice(1).filter(function(r){ return r.some(function(c){ return c !== "" && c !== null && c !== undefined; }); });

    if(rows.length){
      let arch = ss.getSheetByName("Investments_Archive");
      if(!arch){
        arch = ss.insertSheet("Investments_Archive");
        arch.appendRow(["Date", "Name", "Amount", "Note", "Kind", "ArchivedOn"]);
      }
      const stamp = invTodayIso_();
      rows.forEach(function(r){ arch.appendRow([r[0], r[1], r[2], r[3] || "", r[4] || "", stamp]); });
    }
    if(inv.getLastRow() > 1) inv.deleteRows(2, inv.getLastRow() - 1);
    invEnsureKindHeader_(inv);

    // relabel orphan SIP memories
    const instruments = getInvestmentInstrumentsList().instruments;
    const feSheet = getFinancialEventsSheet();
    const fe = feSheet.getDataRange().getValues();
    const knownNames = {};
    instruments.forEach(function(i){ knownNames[i.name] = true; });
    let relabelled = 0;
    for(let i = 1; i < fe.length; i++){
      if(fe[i][0] !== "Investment") continue;
      const nm = (fe[i][4] || "").toString();
      if(!nm || knownNames[nm]) continue;
      const same = instruments.filter(function(x){ return Number(x.sipAmount) > 0 && Number(x.sipAmount) === Number(fe[i][1]); });
      if(same.length === 1){ feSheet.getRange(i + 1, 5).setValue(same[0].name); relabelled++; }
    }
    instruments.forEach(function(inst){
      if(Number(inst.sipAmount) > 0) invSyncSipEvents_(inst.name, Number(inst.sipAmount), inst.sipActive !== false);
    });
    return { ok:true, archived: rows.length, relabelled: relabelled };
  }catch(err){
    return { ok:false, error:err.toString() };
  }
}
