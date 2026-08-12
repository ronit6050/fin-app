/* ============================================
   SMART CATEGORY ENGINE v3
   4-layer matching with confidence scoring
   Full context sent to Gemini
   Correction loop — learns from fixes
============================================ */

/* ===============================
   CATEGORIES + SUBCATEGORIES
=============================== */
const SMART_CATEGORIES = {
  "Food":        ["Delivery","Restaurant","Groceries","Snacks","Other"],
  "Transport":   ["Ride","Fuel","Train","Flight","Bus","Other"],
  "Bills":       ["Rent","Electricity","Mobile","Internet","Gas","Other"],
  "Shopping":    ["Online","Offline","Clothing","Electronics","Other"],
  "Lifestyle":   ["Subscription","Entertainment","Fitness","Personal","Other"],
  "Financial":   ["Lending","Borrowing","Investment","EMI","Credit Card","Other"],
  "Income":      ["Salary","Freelance","Transfer","Other"],
  "Education":   ["Fees","Books","Course","Other"],
  "Health":      ["Medicine","Hospital","Fitness","Other"],
  "Other":       ["Other"]
};

const CONFIDENCE_THRESHOLD = 80; // Ask user if below this


/* ===============================
   MAIN ENTRY POINT
   Called from handlers.js
=============================== */
function getSmartCategory(note, counterparty, amount, mode, rowIndex){

  try{

    if(!note && !counterparty) return { category:"Other", confidence:0 };

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const smartMemory = ss.getSheetByName("SmartMemory");

    if(!smartMemory){
      // Fallback to old system if SmartMemory not created yet
      const oldMemory = ss.getSheetByName("CategoryMemory");
      return { category: getCategory(note, oldMemory), confidence: 50 };
    }

    const memData = smartMemory.getDataRange().getValues();

    const cleanNote        = normalizeText(note);
    const cleanCounterparty = normalizeText(counterparty || "");
    const searchText       = cleanCounterparty || cleanNote;

    /* ===========================
       LAYER 1: Exact merchant match
       Highest confidence — instant
    =========================== */
    const exactMatch = findMerchantMatch(searchText, memData, true);
    if(exactMatch && exactMatch.confidence >= CONFIDENCE_THRESHOLD){
      updateMemoryUsage(smartMemory, exactMatch.row);
      return {
        category:    exactMatch.category,
        subcategory: exactMatch.subcategory,
        confidence:  exactMatch.confidence,
        source:      "memory_exact"
      };
    }

    /* ===========================
       LAYER 2: Fuzzy keyword match
       Good confidence — fast
    =========================== */
    const fuzzyMatch = findMerchantMatch(searchText, memData, false);
    if(fuzzyMatch && fuzzyMatch.confidence >= CONFIDENCE_THRESHOLD){
      updateMemoryUsage(smartMemory, fuzzyMatch.row);
      return {
        category:    fuzzyMatch.category,
        subcategory: fuzzyMatch.subcategory,
        confidence:  fuzzyMatch.confidence,
        source:      "memory_fuzzy"
      };
    }

    /* ===========================
       LAYER 3: Smart pattern rules
       No AI needed — rule based
    =========================== */
    const patternMatch = matchByPattern(cleanNote, cleanCounterparty, amount, mode);
    if(patternMatch && patternMatch.confidence >= CONFIDENCE_THRESHOLD){
      return {
        category:    patternMatch.category,
        subcategory: patternMatch.subcategory,
        confidence:  patternMatch.confidence,
        source:      "pattern"
      };
    }

    /* ===========================
       LAYER 4: Gemini with context
       Only when truly unknown
    =========================== */
    const recentPatterns = getRecentPatterns(memData);
    const geminiResult   = askGeminiWithContext(
      note, counterparty, amount, mode, recentPatterns
    );

    if(geminiResult){
      // Save to SmartMemory with medium confidence
      saveToSmartMemory(
        smartMemory, counterparty || note,
        geminiResult.category, geminiResult.subcategory, 60
      );

      return {
        category:    geminiResult.category,
        subcategory: geminiResult.subcategory,
        confidence:  60,
        source:      "gemini"
      };
    }

    return { category:"Other", confidence:0, source:"fallback" };

  }catch(err){
    logAI("SMART_CATEGORY_ERROR", err.toString());
    return { category:"Other", confidence:0 };
  }
}


/* ===============================
   LAYER 1+2: MERCHANT MATCHING
=============================== */
function findMerchantMatch(searchText, memData, exactOnly){

  let bestMatch  = null;
  let bestScore  = 0;

  for(let i = 1; i < memData.length; i++){

    const merchant   = normalizeText(memData[i][0] || "");
    const category   = memData[i][1] || "Other";
    const subcategory = memData[i][2] || "Other";
    const confidence = Number(memData[i][3]) || 50;

    if(!merchant) continue;

    let score = 0;

    if(exactOnly){
      // Exact match only
      if(searchText === merchant || searchText.includes(merchant)){
        score = confidence;
      }
    } else {
      // Fuzzy — check if any word in merchant appears in search
      const merchantWords = merchant.split(" ");
      const matchedWords  = merchantWords.filter(w =>
        w.length > 3 && searchText.includes(w)
      );
      if(matchedWords.length > 0){
        score = Math.round(confidence * (matchedWords.length / merchantWords.length));
      }
    }

    if(score > bestScore){
      bestScore = score;
      bestMatch = { category, subcategory, confidence: score, row: i + 1 };
    }
  }

  return bestMatch;
}


/* ===============================
   LAYER 3: PATTERN MATCHING
   No AI — rule based
=============================== */
function matchByPattern(note, counterparty, amount, mode){

  const text = (counterparty + " " + note).toLowerCase();

  // ── Indian merchant patterns ──
  const patterns = [

    // Grocery delivery (a Need — distinct from restaurant food delivery below)
    { keywords:["zepto","blinkit","bigbasket","grofers","jiomart","instamart"],
      category:"Food", subcategory:"Groceries", confidence:95 },

    // Restaurant / food delivery (a Want)
    { keywords:["swiggy","zomato","dunzo"],
      category:"Food", subcategory:"Delivery", confidence:95 },

    // Restaurants
    { keywords:["restaurant","cafe","hotel","dhaba","biryani","pizza","burger","mcdonalds","kfc","dominos","subway"],
      category:"Food", subcategory:"Restaurant", confidence:90 },

    // Ride services
    { keywords:["ola","uber","rapido","auto","cab","taxi","namma"],
      category:"Transport", subcategory:"Ride", confidence:95 },

    // Fuel
    { keywords:["petrol","diesel","hp","iocl","bpcl","fuel","pump"],
      category:"Transport", subcategory:"Fuel", confidence:95 },

    // Train/flight
    { keywords:["irctc","railway","train","indigo","airindia","spicejet","goair","flight","airlines"],
      category:"Transport", subcategory:"Train", confidence:95 },

    // Recharge/bills
    { keywords:["airtel","jio","vodafone","vi","bsnl","recharge","topup"],
      category:"Bills", subcategory:"Mobile", confidence:95 },

    // Electricity
    { keywords:["electricity","bescom","msedcl","tata power","adani","electric","current bill","light bill"],
      category:"Bills", subcategory:"Electricity", confidence:95 },

    // Rent
    { keywords:["rent","landlord","owner","flat","house rent","pg"],
      category:"Bills", subcategory:"Rent", confidence:90 },

    // Shopping online
    { keywords:["amazon","flipkart","myntra","meesho","nykaa","ajio","snapdeal"],
      category:"Shopping", subcategory:"Online", confidence:95 },

    // Shopping offline
    { keywords:["dmart","reliance","more","spencer","big bazaar","walmart","mart","supermarket"],
      category:"Shopping", subcategory:"Offline", confidence:90 },

    // Subscriptions
    { keywords:["netflix","hotstar","spotify","youtube","prime","apple","claude","openai","subscription","chatgpt"],
      category:"Lifestyle", subcategory:"Subscription", confidence:95 },

    // Medical
    { keywords:["pharmacy","medical","hospital","clinic","doctor","medicine","apollo","medplus","1mg"],
      category:"Health", subcategory:"Medicine", confidence:90 },

    // Education
    { keywords:["school","college","university","fees","tuition","course","udemy","coursera","mba"],
      category:"Education", subcategory:"Fees", confidence:90 },

    // Financial (real investment instruments only — EMI/loan/insurance
    // removed 2026-08-10: those are a different kind of thing, not
    // investing, and were getting mislabeled here. Bank names
    // hdfc/icici/axis/sbi also removed 2026-08-10 — they used to sit in
    // this same list, which meant ANY payment whose UPI ID happened to
    // mention the receiver's bank, e.g. "someone@okhdfcbank", got
    // wrongly stamped "Investment" — found during a full categorization
    // review, unrelated to any specific bug report.)
    { keywords:["mutual fund","sip","nps","ppf","fd","rd","investment","stock","zerodha","groww"],
      category:"Financial", subcategory:"Investment", confidence:85 },

    // Salary/income
    { keywords:["salary","stipend","payroll","income","ctc"],
      category:"Income", subcategory:"Salary", confidence:95 },
  ];

  for(const pattern of patterns){
    for(const keyword of pattern.keywords){
      if(text.includes(keyword)){
        return {
          category:    pattern.category,
          subcategory: pattern.subcategory,
          confidence:  pattern.confidence
        };
      }
    }
  }

  // Lending — kept separate from the array above and matched with whole
  // words, not substrings. "sent to"/"transfer to" removed 2026-08-10:
  // too generic, would have matched huge numbers of ordinary notes
  // ("sent to office for lunch money"). The remaining words used to be
  // plain substrings too, which is the exact bug class already found
  // and fixed once in isLendingTransfer (needWantSaving.js) — "lent" as
  // a bare substring also matches inside "excellent", "silent",
  // "talent". Reusing whole-word matching here closes the same gap in
  // this file, which never got the same fix.
  const LENDING_WORD_PATTERNS = [/\blent\b/, /\bborrowed\b/, /\breturned\b/, /\bgave\b/, /\bpaid back\b/];
  for(const p of LENDING_WORD_PATTERNS){
    if(p.test(text)){
      return { category:"Financial", subcategory:"Lending", confidence:75 };
    }
  }

  // ── Amount-based patterns ──
  if(amount >= 10000 && mode && mode.includes("neft")){
    return { category:"Financial", subcategory:"Transfer", confidence:70 };
  }

  if(amount <= 100 && (text.includes("tea") || text.includes("coffee") || text.includes("chai"))){
    return { category:"Food", subcategory:"Snacks", confidence:95 };
  }

  return null;
}


/* ===============================
   LAYER 4: GEMINI WITH CONTEXT
=============================== */
function askGeminiWithContext(note, counterparty, amount, mode, recentPatterns){

  try{

    const {GEMINI_KEY} = getConfig();

    const categoryList = Object.keys(SMART_CATEGORIES).join(", ");

    const prompt =
`You are a financial categorisation system for an Indian user.

Transaction details:
- Merchant/Counterparty: ${counterparty || "unknown"}
- Note: ${note || "none"}
- Amount: ₹${amount || "unknown"}
- Payment mode: ${mode || "unknown"}

This user's recent spending patterns:
${recentPatterns || "not enough data yet"}

Categories available: ${categoryList}

Return ONLY a JSON object:
{"category":"chosen category","subcategory":"specific type"}

Rules:
- Pick the most specific category based on merchant name first
- Use amount and mode as secondary signals
- If merchant is a person's name, use Financial/Lending
- If truly unclear, return Other/Other
- Return ONLY JSON. No explanation.`;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {maxOutputTokens: 50}
      }),
      muteHttpExceptions: true
    });

    const json    = JSON.parse(response.getContentText());
    let rawText   = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    rawText       = rawText.replace(/```json|```/g,"").trim();

    const parsed  = JSON.parse(rawText);

    if(parsed.category && Object.keys(SMART_CATEGORIES).includes(parsed.category)){
      return {
        category:    parsed.category,
        subcategory: parsed.subcategory || "Other"
      };
    }

    return null;

  }catch(err){
    return null;
  }
}


/* ===============================
   GET RECENT PATTERNS
   Sends Gemini context about user
=============================== */
function getRecentPatterns(memData){

  const topMerchants = memData.slice(1)
    .filter(r => r[0] && r[1])
    .sort((a, b) => Number(b[4]) - Number(a[4]))
    .slice(0, 5)
    .map(r => `${r[0]} → ${r[1]}`)
    .join(", ");

  return topMerchants || "no patterns yet";
}


/* ===============================
   SAVE TO SMART MEMORY
=============================== */
function saveToSmartMemory(sheet, merchant, category, subcategory, confidence){

  if(!merchant || !category) return;

  const cleanMerchant = normalizeText(merchant);
  const data          = sheet.getDataRange().getValues();

  // Check if merchant already exists — update instead of duplicate
  for(let i = 1; i < data.length; i++){
    if(normalizeText(data[i][0]) === cleanMerchant){
      // Update existing
      sheet.getRange(i+1, 2).setValue(category);
      sheet.getRange(i+1, 3).setValue(subcategory);
      sheet.getRange(i+1, 4).setValue(confidence);
      sheet.getRange(i+1, 6).setValue(new Date());
      return;
    }
  }

  // Add new entry
  sheet.appendRow([
    merchant,
    category,
    subcategory,
    confidence,
    1,
    new Date()
  ]);
}


/* ===============================
   UPDATE USAGE STATS
=============================== */
function updateMemoryUsage(sheet, rowNumber){
  try{
    const timesUsed = Number(sheet.getRange(rowNumber, 5).getValue()) || 0;
    sheet.getRange(rowNumber, 5).setValue(timesUsed + 1);
    sheet.getRange(rowNumber, 6).setValue(new Date());
  }catch(e){}
}


/* ===============================
   CORRECTION HANDLER
   Called when user fixes a category
=============================== */
function handleCategoryCorrection(merchant, correctCategory, correctSubcategory){

  try{

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const smartMemory = ss.getSheetByName("SmartMemory");

    if(!smartMemory) return;

    // Save with high confidence — user confirmed
    saveToSmartMemory(
      smartMemory,
      merchant,
      correctCategory,
      correctSubcategory || "Other",
      100  // User confirmed = max confidence
    );

    logAI("CATEGORY_CORRECTED", `${merchant} → ${correctCategory}`);

  }catch(err){
    logAI("CORRECTION_ERROR", err.toString());
  }
}


// migrateToSmartMemory() — the one-time "copy old CategoryMemory sheet
// into the new SmartMemory sheet" migration — was removed 2026-08-12.
// It already did its one job (see CLAUDE.md's Automation-phase notes,
// 2026-08-08: SmartMemory was rebuilt clean and the migration already
// ran), nothing called it anymore, and CategoryMemory itself is already
// documented as a superseded legacy sheet nothing else reads.

/* ===============================
   NORMALIZE TEXT
=============================== */
function normalizeText(text){
  return text
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g," ")
    .replace(/\s+/g," ")
    .trim();
}


/* ===============================
   KEEP OLD FUNCTION
   getCategory() is still a real fallback path inside getSmartCategory()
   above (used when there's no counterparty match) — kept. Its old
   siblings normalize()/extractKeyword()/askAI() were plain unused
   wrappers around it (nothing anywhere called them) and were removed
   2026-08-12.
=============================== */
function getCategory(note, memory){
  // Redirect to new smart system
  const result = getSmartCategory(note, "", 0, "", null);
  return result.category;
}


/* ===============================
   TEST
=============================== */
function testSmartCategory(){
  const tests = [
    {note:"swiggy order", counterparty:"SWIGGY INSTAMART", amount:340, mode:"upi"},
    {note:"monthly rent", counterparty:"NADAR RONIT", amount:11000, mode:"upi"},
    {note:"recharge", counterparty:"AIRTEL PAYMENTS", amount:299, mode:"upi"},
    {note:"lent money", counterparty:"RAJ KUMAR", amount:500, mode:"upi"},
    {note:"netflix subscription", counterparty:"NETFLIX", amount:649, mode:"card"}
  ];

  let results = "🧪 Smart Category Test\n\n";

  tests.forEach(t => {
    const r = getSmartCategory(t.note, t.counterparty, t.amount, t.mode, null);
    results += `• ${t.counterparty}: ${r.category}/${r.subcategory} (${r.confidence}% via ${r.source})\n`;
  });

  sendMessage(results);
}