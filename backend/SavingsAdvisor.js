/* ============================================
   SAVINGS ADVISOR — REDESIGNED
   3-pot system: Emergency / WishList / FreeSavings
   Smart split based on emergency fund stage
   AI decides which wish list item to fund
   Monthly expenses: ₹30,000
   Emergency fund target: ₹90,000 (3 months)
============================================ */

const MONTHLY_EXPENSES    = 30000;
const EMERGENCY_TARGET    = MONTHLY_EXPENSES * 3;  // ₹90,000
const MONTHLY_SAVE_GOAL   = 1000;

// ── Split rules based on emergency fund stage ──
function getSplitRule(emergencyTotal){
  if(emergencyTotal < MONTHLY_EXPENSES){
    // Stage 1: less than 1 month — build emergency fast
    return { emergency: 0.70, wishlist: 0.20, free: 0.10 };
  } else if(emergencyTotal < EMERGENCY_TARGET){
    // Stage 2: 1-3 months — balanced split
    return { emergency: 0.50, wishlist: 0.40, free: 0.10 };
  } else {
    // Stage 3: emergency fund complete — focus on wants
    return { emergency: 0.00, wishlist: 0.90, free: 0.10 };
  }
}


/* =======================================
   LOG A SAVING — auto splits into 3 pots
======================================= */
function logSaving(text){

  try{

    const parts  = text.trim().split(" ");
    const amount = Number(parts[0]);

    if(!amount || amount <= 0){
      sendMessage(
`❌ Invalid format.

Correct format:
Amount Type Note

Examples:
1000 bank monthly saving
2000 jupiter bonus
500 cash leftover`
      );
      return;
    }

    const type = parts[1] || "bank";
    const note = parts.slice(2).join(" ") || "saving";

    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const savSheet = ss.getSheetByName("Savings");

    if(!savSheet){ sendMessage("❌ Savings sheet not found"); return; }

    // ── Get current emergency fund total ──
    const totals        = getSavingsTotals(savSheet);
    const emergencyTotal = totals.emergency;

    // ── Get split rule based on stage ──
    const split = getSplitRule(emergencyTotal);

    // ── Calculate amounts ──
    const emergencyAmt = Math.round(amount * split.emergency);
    const wishlistAmt  = Math.round(amount * split.wishlist);
    const freeAmt      = amount - emergencyAmt - wishlistAmt;

    const today = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    // ── Write 3 rows ──
    if(emergencyAmt > 0){
      savSheet.appendRow([today, emergencyAmt, type, note, "Emergency"]);
    }
    if(wishlistAmt > 0){
      savSheet.appendRow([today, wishlistAmt, type, note, "WishList"]);
    }
    if(freeAmt > 0){
      savSheet.appendRow([today, freeAmt, type, note, "FreeSavings"]);
    }

    // ── New totals after saving ──
    const newTotals = getSavingsTotals(savSheet);

    // ── Stage label ──
    const stageLabel = getStageLabel(newTotals.emergency);

    // ── Check wish list affordability ──
    checkWishListAffordability(newTotals.wishlist);

    sendMessage(
`✅ ₹${fmt(amount)} saved and split!

🛡️ Emergency Fund: +₹${fmt(emergencyAmt)} → ₹${fmt(newTotals.emergency)} of ₹${fmt(EMERGENCY_TARGET)}
🎯 Wish List pot: +₹${fmt(wishlistAmt)} → ₹${fmt(newTotals.wishlist)}
💰 Free Savings: +₹${fmt(freeAmt)} → ₹${fmt(newTotals.free)}

📊 Stage: ${stageLabel}`
    );

  }catch(err){
    logAI("LOG_SAVING_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   SAVINGS DASHBOARD
======================================= */
function sendSavingsDashboard(){

  try{

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const savSheet  = ss.getSheetByName("Savings");
    const wishSheet = ss.getSheetByName("WishList");

    if(!savSheet)  { sendMessage("❌ Savings sheet not found");  return; }
    if(!wishSheet) { sendMessage("❌ WishList sheet not found"); return; }

    const totals = getSavingsTotals(savSheet);
    const fmt    = (n) => Math.round(n).toLocaleString('en-IN');

    // ── Emergency fund progress ──
    const emergencyPct = Math.min(
      Math.round((totals.emergency / EMERGENCY_TARGET) * 100), 100
    );
    const emergencyBar  = buildSavingsBar(emergencyPct);
    const stageLabel    = getStageLabel(totals.emergency);
    const monthsToEmerg = totals.emergency >= EMERGENCY_TARGET ? 0
      : Math.ceil((EMERGENCY_TARGET - totals.emergency) / (MONTHLY_SAVE_GOAL * getSplitRule(totals.emergency).emergency));

    // ── Split rule for this month ──
    const split       = getSplitRule(totals.emergency);
    const thisMonthEM = Math.round(MONTHLY_SAVE_GOAL * split.emergency);
    const thisMonthWL = Math.round(MONTHLY_SAVE_GOAL * split.wishlist);
    const thisMonthFR = MONTHLY_SAVE_GOAL - thisMonthEM - thisMonthWL;

    // ── Wish list progress ──
    const wishData   = wishSheet.getDataRange().getValues();
    let wishText     = "";
    let activeItems  = 0;

    for(let i = 1; i < wishData.length; i++){
      const item     = (wishData[i][0] || "").toString().trim();
      const price    = Number(wishData[i][1]) || 0;
      const priority = (wishData[i][2] || "Medium").toString().trim();
      const status   = (wishData[i][3] || "Active").toString().trim();

      if(!item || status !== "Active") continue;
      activeItems++;

      const monthlyWL    = Math.round(MONTHLY_SAVE_GOAL * split.wishlist);
      const remaining    = Math.max(price - totals.wishlist, 0);
      const monthsNeeded = monthlyWL > 0
        ? Math.ceil(remaining / monthlyWL)
        : "∞";

      const canAfford = totals.wishlist >= price;

      let line = `\n• ${item} — ₹${fmt(price)} [${priority}]`;
      if(canAfford){
        line += `\n  ✅ Ready to buy!`;
      } else {
        line += `\n  Saved: ₹${fmt(totals.wishlist)} | Need: ₹${fmt(remaining)} more`;
        line += `\n  At current pace: ${monthsNeeded} months away`;
      }

      wishText += line;
      if(activeItems === 1) break; // Show only next goal
    }

    // ── This month's split breakdown ──
    const splitText =
`This month's ₹${fmt(MONTHLY_SAVE_GOAL)} split:
- 🛡️ Emergency: ₹${fmt(thisMonthEM)} (${Math.round(split.emergency*100)}%)
- 🎯 Wish List: ₹${fmt(thisMonthWL)} (${Math.round(split.wishlist*100)}%)
- 💰 Free: ₹${fmt(thisMonthFR)} (${Math.round(split.free*100)}%)`;

    const message =
`💰 Savings Dashboard

🛡️ Emergency Fund
${emergencyBar}
₹${fmt(totals.emergency)} of ₹${fmt(EMERGENCY_TARGET)}
Stage: ${stageLabel}
${totals.emergency < EMERGENCY_TARGET
  ? `${monthsToEmerg > 0 ? monthsToEmerg + " months to complete at current pace" : "Almost there!"}`
  : "✅ Emergency fund complete!"}

🎯 Wish List Pot: ₹${fmt(totals.wishlist)}
${wishText || "\nNo active wish list items\nAdd one with /wishlist item price"}

💰 Free Savings: ₹${fmt(totals.free)}

📊 ${splitText}`;

    sendMessage(message);

    // ── AI tip ──
    sendSavingsAITip(totals, wishData, split);

  }catch(err){
    logAI("SAVINGS_DASHBOARD_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   INVESTMENT DASHBOARD
======================================= */
function sendInvestmentDashboard(){

  try{

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const investSheet = ss.getSheetByName("Investments");

    if(!investSheet){ sendMessage("❌ Investments sheet not found"); return; }

    const data = investSheet.getDataRange().getValues();
    const fmt  = (n) => Math.round(n).toLocaleString('en-IN');

    let typeTotals = {};
    let total      = 0;

    for(let i = 1; i < data.length; i++){
      const type   = (data[i][1] || "Other").toString().trim();
      const amount = Number(data[i][2]) || 0;
      if(!amount) continue;
      typeTotals[type] = (typeTotals[type] || 0) + amount;
      total += amount;
    }

    let breakdown = "";
    Object.entries(typeTotals)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, amt]) => {
        const pct = total > 0 ? ((amt/total)*100).toFixed(1) : 0;
        breakdown += `\n• ${type}: ₹${fmt(amt)} (${pct}%)`;
      });

    const recent = data.slice(1)
      .filter(r => r[0] && r[2])
      .sort((a,b) => new Date(b[0]) - new Date(a[0]))
      .slice(0, 3)
      .map(r => {
        const d    = new Date(r[0]);
        const date = `${d.getDate()} ${d.toLocaleString('default',{month:'short'})}`;
        return `• ${date} — ${r[1]}: ₹${fmt(Number(r[2]))}`;
      }).join("\n");

    sendMessage(
`📈 Investment Dashboard

💰 Total invested: ₹${fmt(total)}

📊 Breakdown:${breakdown || "\nNo investments yet"}

🕐 Recent:
${recent || "None yet"}

⚠️ Note: Investments are separate from savings.
They are NOT counted toward your emergency fund.`
    );

  }catch(err){
    logAI("INVEST_DASHBOARD_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   LOG AN INVESTMENT
======================================= */
function logInvestment(text){

  try{

    const parts  = text.trim().split(" ");
    const amount = Number(parts[0]);

    if(!amount || amount <= 0){
      sendMessage("❌ Format: Amount Type\nExample: 500 Mutual Fund");
      return;
    }

    const type = parts.slice(1).join(" ") || "General";

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const investSheet = ss.getSheetByName("Investments");

    if(!investSheet){ sendMessage("❌ Investments sheet not found"); return; }

    const today = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    investSheet.appendRow([today, type, amount, ""]);

    const fmt  = (n) => Math.round(n).toLocaleString('en-IN');
    const data = investSheet.getDataRange().getValues();

    let typeTotal  = 0;
    let grandTotal = 0;

    for(let i = 1; i < data.length; i++){
      const rowType = (data[i][1] || "").toString().trim().toLowerCase();
      const rowAmt  = Number(data[i][2]) || 0;
      grandTotal   += rowAmt;
      if(rowType === type.toLowerCase()) typeTotal += rowAmt;
    }

    sendMessage(
`✅ Investment logged!

📈 Type: ${type}
💵 Added: ₹${fmt(amount)}
📊 Total in ${type}: ₹${fmt(typeTotal)}
💰 Total invested: ₹${fmt(grandTotal)}

⚠️ Remember: investments are not emergency fund money.`
    );

  }catch(err){
    logAI("LOG_INVEST_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   ADD TO WISH LIST
======================================= */
function addWishListItem(text){

  try{

    const {GEMINI_KEY} = getConfig();

    const prompt =
`Extract wish list item from: "${text}"

Return ONLY JSON:
{"item":"full item name","price":number,"priority":"High or Medium or Low"}

Rules:
- item: full product name, can be multiple words
- price: number only
- priority: High if expensive/important, Medium default, Low if casual
- Return ONLY JSON.`;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url,{
      method:"post",
      contentType:"application/json",
      payload: JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{maxOutputTokens:80}
      }),
      muteHttpExceptions:true
    });

    const json    = JSON.parse(response.getContentText());
    let rawText   = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    rawText       = rawText.replace(/```json|```/g,"").trim();

    let parsed;
    try{ parsed = JSON.parse(rawText); }
    catch(e){
      sendMessage("❌ Couldn't parse.\n\nTry: iPhone 16 80000 high");
      return;
    }

    if(!parsed.item || !parsed.price){
      sendMessage("❌ Need item name and price.\n\nTry: Body Massager 2000 high");
      return;
    }

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const wishSheet = ss.getSheetByName("WishList");
    if(!wishSheet){ sendMessage("❌ WishList sheet not found"); return; }

    const today = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    wishSheet.appendRow([parsed.item, parsed.price, parsed.priority, "Active", today]);

    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    // ── Calculate months to afford ──
    const savTotals  = getSavingsTotals(ss.getSheetByName("Savings"));
    const split      = getSplitRule(savTotals.emergency);
    const monthlyWL  = Math.round(MONTHLY_SAVE_GOAL * split.wishlist);
    const remaining  = Math.max(parsed.price - savTotals.wishlist, 0);
    const months     = monthlyWL > 0 ? Math.ceil(remaining / monthlyWL) : "∞";

    sendMessage(
`✅ Added to Wish List!

🎯 ${parsed.item}
💰 Price: ₹${fmt(parsed.price)}
⭐ Priority: ${parsed.priority}
⏳ At current pace: ${months} months away

Check Savings Dashboard for full progress.`
    );

  }catch(err){
    logAI("WISHLIST_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   MARK WISH LIST ITEM AS PURCHASED
======================================= */
function markWishListPurchased(text){

  try{

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const wishSheet = ss.getSheetByName("WishList");
    const savSheet  = ss.getSheetByName("Savings");

    const data = wishSheet.getDataRange().getValues();
    const fmt  = (n) => Math.round(n).toLocaleString('en-IN');

    let list    = "";
    let pending = [];

    for(let i = 1; i < data.length; i++){
      const item   = (data[i][0] || "").toString().trim();
      const price  = Number(data[i][1]) || 0;
      const status = (data[i][3] || "Active").toString().trim();
      if(!item || status !== "Active") continue;
      pending.push({row: i+1, item, price});
      list += `\n${pending.length}. ${item} — ₹${fmt(price)}`;
    }

    if(!pending.length){
      sendMessage("✅ No active wish list items.");
      return;
    }

    PropertiesService.getScriptProperties()
      .setProperty("wishlistPurchaseList", JSON.stringify(pending));

    sendMessage(
`🛍️ Which item did you purchase?

${list}

Reply with the number.
Example: 1`
    );

  }catch(err){
    logAI("WISHLIST_PURCHASE_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


function processWishListPurchase(text){

  try{

    const raw = PropertiesService.getScriptProperties()
      .getProperty("wishlistPurchaseList");
    if(!raw){ sendMessage("❌ Session expired. Try again."); return; }

    const pending = JSON.parse(raw);
    const index   = parseInt(text.trim()) - 1;

    if(isNaN(index) || !pending[index]){
      sendMessage("❌ Invalid number. Try again.");
      return;
    }

    const entry = pending[index];
    PropertiesService.getScriptProperties().deleteProperty("wishlistPurchaseList");

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const wishSheet = ss.getSheetByName("WishList");
    const savSheet  = ss.getSheetByName("Savings");
    const fmt       = (n) => Math.round(n).toLocaleString('en-IN');

    // ── Mark as purchased in WishList sheet ──
    const today = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );
    wishSheet.getRange(entry.row, 4).setValue("Purchased");

    // ── Deduct from WishList pot in Savings sheet ──
    savSheet.appendRow([
      today,
      -entry.price,  // negative = deduction
      "purchase",
      `Purchased: ${entry.item}`,
      "WishList"
    ]);

    const newTotals = getSavingsTotals(savSheet);

    sendMessage(
`🎉 Congratulations!

✅ ${entry.item} marked as purchased
💸 ₹${fmt(entry.price)} deducted from Wish List pot
🎯 Wish List pot remaining: ₹${fmt(Math.max(newTotals.wishlist, 0))}

Your emergency fund is untouched. 🛡️
Keep saving for the next goal!`
    );

  }catch(err){
    logAI("WISHLIST_PURCHASE_PROCESS_ERROR", err.toString());
    sendMessage("❌ Error: " + err.message);
  }
}


/* =======================================
   CHECK WISH LIST AFFORDABILITY
======================================= */
function checkWishListAffordability(wishlistTotal){

  try{

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const wishSheet = ss.getSheetByName("WishList");
    if(!wishSheet) return;

    const data = wishSheet.getDataRange().getValues();
    const fmt  = (n) => Math.round(n).toLocaleString('en-IN');

    for(let i = 1; i < data.length; i++){
      const item   = (data[i][0] || "").toString().trim();
      const price  = Number(data[i][1]) || 0;
      const status = (data[i][3] || "Active").toString().trim();

      if(!item || status !== "Active") continue;

      if(wishlistTotal >= price){
        sendMessage(
`🎉 Wish List Goal Reached!

✅ Your wish list pot has enough for: ${item}
💰 Price: ₹${fmt(price)}
🎯 Pot balance: ₹${fmt(wishlistTotal)}

Ready to buy? Tap Savings → Mark as Purchased
Your emergency fund stays untouched! 🛡️`
        );
        break; // Alert for first affordable item only
      }
    }

  }catch(err){
    logAI("WISHLIST_AFFORD_ERROR", err.toString());
  }
}


/* =======================================
   GEMINI SAVINGS TIP
   Honest, stage-aware advice
======================================= */
function sendSavingsAITip(totals, wishData, split){

  try{

    const {GEMINI_KEY} = getConfig();
    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    const wishSummary = wishData.slice(1)
      .filter(r => r[0] && r[3] === "Active")
      .map(r => `${r[0]}: ₹${fmt(Number(r[1]))} [${r[2]}]`)
      .join(", ") || "No items yet";

    const emergencyPct = Math.round((totals.emergency / EMERGENCY_TARGET) * 100);
    const stageLabel   = getStageLabel(totals.emergency);

    const prompt =
`You are a careful, honest personal finance advisor for an Indian user.

Their savings situation:
- Monthly essential expenses: ₹${fmt(MONTHLY_EXPENSES)}
- Emergency fund target: ₹${fmt(EMERGENCY_TARGET)} (3 months expenses)
- Emergency fund current: ₹${fmt(totals.emergency)} (${emergencyPct}% complete)
- Stage: ${stageLabel}
- Wish list pot: ₹${fmt(totals.wishlist)}
- Free savings: ₹${fmt(totals.free)}
- Monthly saving goal: ₹${fmt(MONTHLY_SAVE_GOAL)}
- Current split: ${Math.round(split.emergency*100)}% emergency / ${Math.round(split.wishlist*100)}% wishlist / ${Math.round(split.free*100)}% free
- Wish list items: ${wishSummary}

STRICT RULES:
1. NEVER suggest buying a wish list item unless wish list pot >= item price
2. NEVER suggest touching emergency fund for purchases
3. If emergency fund is below 1 month (₹${fmt(MONTHLY_EXPENSES)}), make this the priority
4. Be honest about timelines — if it takes 2 years, say so
5. Suggest extra savings if their monthly goal seems low

Write 3 sentences:
- Sentence 1: Honest assessment of their current stage
- Sentence 2: Which wish list item to focus on and realistic timeline
- Sentence 3: One specific suggestion to reach goals faster
- Use ₹ and Indian formatting
- No false encouragement
- No fluff openers
- Write ONLY the advice.`;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url,{
      method:"post",
      contentType:"application/json",
      payload: JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{maxOutputTokens:200}
      }),
      muteHttpExceptions:true
    });

    const json = JSON.parse(response.getContentText());
    const tip  = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if(tip && tip.trim()){
      sendMessage("💡 " + tip.trim());
    }

  }catch(err){
    logAI("SAVINGS_TIP_ERROR", err.toString());
  }
}


/* =======================================
   SUNDAY SAVINGS REMINDER
======================================= */
function sendSundaySavingsReminder(){

  try{

    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const savSheet = ss.getSheetByName("Savings");
    if(!savSheet) return;

    const totals    = getSavingsTotals(savSheet);
    const fmt       = (n) => Math.round(n).toLocaleString('en-IN');
    const today     = new Date();
    const thisMonth = today.getMonth();
    const thisYear  = today.getFullYear();

    // ── This month's savings ──
    const data         = savSheet.getDataRange().getValues();
    let thisMonthTotal = 0;

    for(let i = 1; i < data.length; i++){
      const rawDate = data[i][0];
      const amount  = Number(data[i][1]) || 0;
      if(!rawDate || amount <= 0) continue;
      const d = new Date(rawDate);
      if(d.getFullYear() === thisYear && d.getMonth() === thisMonth){
        thisMonthTotal += amount;
      }
    }

    const onTrack   = thisMonthTotal >= MONTHLY_SAVE_GOAL;
    const remaining = Math.max(MONTHLY_SAVE_GOAL - thisMonthTotal, 0);
    const split     = getSplitRule(totals.emergency);
    const stageLabel = getStageLabel(totals.emergency);

    let msg = `💰 Weekly Savings Check-in\n\n`;

    msg += `🛡️ Emergency Fund: ₹${fmt(totals.emergency)} of ₹${fmt(EMERGENCY_TARGET)}\n`;
    msg += `Stage: ${stageLabel}\n\n`;

    if(onTrack){
      msg += `✅ Monthly goal hit! ₹${fmt(thisMonthTotal)} saved this month.\n`;
      msg += `Any extra to add? Use /save amount type`;
    } else {
      msg += `📊 This month: ₹${fmt(thisMonthTotal)} of ₹${fmt(MONTHLY_SAVE_GOAL)} goal\n`;
      msg += `⏳ Still need: ₹${fmt(remaining)} to hit goal\n\n`;
      msg += `Log with: /save ${remaining} bank monthly saving`;
    }

    sendMessage(msg);

  }catch(err){
    logAI("SUNDAY_REMINDER_ERROR", err.toString());
  }
}


/* =======================================
   HELPER: Get savings totals by pot
======================================= */
function getSavingsTotals(savSheet){

  const data     = savSheet.getDataRange().getValues();
  let emergency  = 0;
  let wishlist   = 0;
  let free       = 0;

  for(let i = 1; i < data.length; i++){
    const amount = Number(data[i][1]) || 0;
    const pot    = (data[i][4] || "FreeSavings").toString().trim();

    if(pot === "Emergency")   emergency += amount;
    else if(pot === "WishList") wishlist += amount;
    else                       free     += amount;
  }

  return { emergency, wishlist, free, total: emergency + wishlist + free };
}


/* =======================================
   HELPER: Stage label
======================================= */
function getStageLabel(emergencyTotal){
  if(emergencyTotal >= EMERGENCY_TARGET){
    return "Stage 3 — Emergency fund complete 🎉";
  } else if(emergencyTotal >= MONTHLY_EXPENSES){
    return "Stage 2 — Building emergency fund (1-3 months)";
  } else {
    return "Stage 1 — Building foundation (< 1 month)";
  }
}


/* =======================================
   PROGRESS BAR
======================================= */
function buildSavingsBar(pct){
  const filled = Math.min(Math.round(pct / 10), 10);
  const empty  = 10 - filled;
  return "▓".repeat(filled) + "░".repeat(empty) + ` ${pct}%`;
}