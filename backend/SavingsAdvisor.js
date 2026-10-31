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
// monthlyExpenses/emergencyTarget are optional overrides — the PWA passes
// the user's live Settings values here; everything else (dormant
// Telegram code) keeps calling this with 1 arg and gets the original
// hardcoded defaults, unchanged.
function getSplitRule(emergencyTotal, monthlyExpenses, emergencyTarget){
  monthlyExpenses = monthlyExpenses || MONTHLY_EXPENSES;
  emergencyTarget = emergencyTarget || EMERGENCY_TARGET;

  if(emergencyTotal < monthlyExpenses){
    // Stage 1: less than 1 month — build emergency fast
    return { emergency: 0.70, wishlist: 0.20, free: 0.10 };
  } else if(emergencyTotal < emergencyTarget){
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

    const ss       = dbSs_();
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
   INVESTMENT DASHBOARD
======================================= */
function sendInvestmentDashboard(){

  try{

    const ss          = dbSs_();
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

    const ss          = dbSs_();
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
   CHECK WISH LIST AFFORDABILITY
======================================= */
function checkWishListAffordability(wishlistTotal){

  try{

    const ss        = dbSs_();
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
   HELPER: Get savings totals by pot
======================================= */
function getSavingsTotals(savSheet){

  const data     = savSheet.getDataRange().getValues();
  let emergency  = 0;
  let wishlist   = 0;
  let free       = 0;
  // CC Buffer — added 2026-08-10, a 4th pot separate from the other
  // three. Unlike them, it's never auto-split into by logSavingFromApp;
  // it's only ever added to directly, via its own "Add to CC Buffer"
  // action (kept deliberate/manual per the user's own call, so growing
  // it stays a conscious habit while it's still new). See
  // docs/features/cc-advisor.md.
  let ccBuffer   = 0;

  for(let i = 1; i < data.length; i++){
    const amount = Number(data[i][1]) || 0;
    const pot    = (data[i][4] || "FreeSavings").toString().trim();

    if(pot === "Emergency")     emergency += amount;
    else if(pot === "WishList") wishlist  += amount;
    else if(pot === "CCBuffer") ccBuffer  += amount;
    else                        free      += amount;
  }

  return { emergency, wishlist, free, ccBuffer, total: emergency + wishlist + free + ccBuffer };
}


/* =======================================
   HELPER: Stage label
======================================= */
// monthlyExpenses/emergencyTarget are optional overrides — same reasoning
// as getSplitRule above.
function getStageLabel(emergencyTotal, monthlyExpenses, emergencyTarget){
  monthlyExpenses = monthlyExpenses || MONTHLY_EXPENSES;
  emergencyTarget = emergencyTarget || EMERGENCY_TARGET;

  if(emergencyTotal >= emergencyTarget){
    return "Stage 3 — Emergency fund complete 🎉";
  } else if(emergencyTotal >= monthlyExpenses){
    return "Stage 2 — Building emergency fund (1-3 months)";
  } else {
    return "Stage 1 — Building foundation (< 1 month)";
  }
}

