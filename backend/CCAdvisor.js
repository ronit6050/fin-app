/* ============================================
   CC ADVISOR
   Reads from Transactions sheet
   Filters mode = "card XXXX"
   Combined limit: ₹50,000
   Warning at 25% (₹12,500)
   Alert at 30% (₹15,000)
   Bill date: 18th | Payment due: 9th
============================================ */

const CC_LIMIT     = 50000;
const CC_WARN_PCT  = 0.25;
const CC_ALERT_PCT = 0.30;
const CC_WARN_AMT  = CC_LIMIT * CC_WARN_PCT;   // ₹12,500
const CC_ALERT_AMT = CC_LIMIT * CC_ALERT_PCT;  // ₹15,000

function sendCCAdvisorReport() {

  try {
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const sheet  = ss.getSheetByName("Transactions");

    if(!sheet){ sendMessage("❌ Transactions sheet not found"); return; }

    const today      = new Date();
    const dayOfMonth = today.getDate();
    const thisMonth  = today.getMonth();
    const thisYear   = today.getFullYear();

    // ── Billing cycle ──
    // 19th last month → 18th this month
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

    const daysLeft     = Math.ceil((cycleEnd - today) / (1000 * 60 * 60 * 24));
    const daysInCycle  = Math.ceil((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24));
    const daysElapsed  = daysInCycle - daysLeft;
    const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

    // ── Read CC transactions from Transactions sheet ──
    const data = sheet.getDataRange().getValues();

    let cycleSpend     = 0;
    let categoryTotals = {};
    let cardTotals     = {};  // per card breakdown
    let txnCount       = 0;

    for(let i = 1; i < data.length; i++){

      const rawDate = data[i][0];
      if(!rawDate) continue;

      const d = new Date(rawDate);
      if(d < cycleStart || d > today) continue;

      const type   = (data[i][3] || "").toString().toLowerCase();
      const mode   = (data[i][4] || "").toString().toLowerCase();
      const amount = Number(data[i][5]) || 0;
      const cat    = (data[i][13] || "Other").toString().trim();

      // ── Only card transactions ──
      if(type === "debit" && mode.startsWith("card") && amount > 0){

        cycleSpend += amount;
        txnCount++;

        // Category breakdown
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;

        // Per card breakdown (e.g. "card 8132")
        cardTotals[mode] = (cardTotals[mode] || 0) + amount;
      }
    }

    // ── Calculations ──
    const fmt          = (n) => Math.round(n).toLocaleString('en-IN');
    const usagePct     = Math.round((cycleSpend / CC_LIMIT) * 100);
    const remaining    = CC_LIMIT - cycleSpend;
    const dailyAvg     = daysElapsed > 0 ? cycleSpend / daysElapsed : 0;
    const projected    = Math.round(dailyAvg * daysInCycle);
    const projectedPct = Math.round((projected / CC_LIMIT) * 100);
    const safeDaily    = daysLeft > 0 && cycleSpend < CC_ALERT_AMT
      ? Math.round((CC_ALERT_AMT - cycleSpend) / daysLeft)
      : 0;

    // ── Usage status ──
    let statusLine = "";
    if(cycleSpend >= CC_ALERT_AMT){
      statusLine = `🚨 ALERT: Hit 30% of combined credit limit!`;
    } else if(cycleSpend >= CC_WARN_AMT){
      statusLine = `⚠️ WARNING: Crossed 25% of combined credit limit`;
    } else {
      statusLine = `✅ Usage healthy — within safe limits`;
    }

    // ── Progress bar ──
    const bar = buildProgressBar(usagePct);

    // ── Safe to spend line ──
    let safeLine = "";
    if(cycleSpend < CC_ALERT_AMT){
      safeLine = safeDaily > 0
        ? `\n✅ Safe to spend: ₹${fmt(safeDaily)}/day to stay under 30%`
        : `\n🚨 Stop CC spending to stay under 30%`;
    } else {
      safeLine = `\n🚨 At/above 30% — avoid further CC spending`;
    }

    // ── Top categories ──
    const topCats = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([cat, amt]) => `• ${cat}: ₹${fmt(amt)}`)
      .join("\n");

    // ── Per card breakdown ──
    const cardBreakdown = Object.entries(cardTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([card, amt]) => `• ${card.toUpperCase()}: ₹${fmt(amt)}`)
      .join("\n");

    // ── Format dates ──
    const fmtDate = (d) => d.toLocaleDateString('en-IN', {
      day:'numeric', month:'short', year:'numeric'
    });

    // ── Summary message ──
    const summary =
`💳 Credit Card Advisor

📅 Cycle: ${fmtDate(cycleStart)} → ${fmtDate(cycleEnd)}
⏳ ${daysLeft} days left | Due: ${fmtDate(dueDate)} (${daysUntilDue} days)

💸 Total CC spend: ₹${fmt(cycleSpend)}
🏦 Combined limit: ₹${fmt(CC_LIMIT)}
📊 Usage: ${bar}
${statusLine}
💰 Remaining limit: ₹${fmt(remaining)}
📈 Projected: ₹${fmt(projected)} (${projectedPct}%)
🔢 Transactions: ${txnCount}
${safeLine}

💳 Per card:
${cardBreakdown || "• No card transactions yet"}

🏷️ Top categories:
${topCats || "• No data yet"}`;

    sendMessage(summary);

    // ── Gemini tip ──
    sendCCGeminiTip(
      cycleSpend, projected, usagePct,
      projectedPct, daysLeft, daysUntilDue,
      topCats, safeDaily
    );

  } catch(err){
    logAI("CC_ADVISOR_ERROR", err.toString());
    sendMessage("❌ CC Advisor error: " + err.message);
  }
}


/* ============================================
   GEMINI TIP
============================================ */
function sendCCGeminiTip(
  cycleSpend, projected, usagePct,
  projectedPct, daysLeft, daysUntilDue,
  topCats, safeDaily
){
  try{

    const {GEMINI_KEY} = getConfig();
    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    const prompt = `
You are a sharp, friendly credit card advisor for an Indian user.

Their credit card details:
- Combined credit limit: ₹${fmt(CC_LIMIT)} (2 cards of ₹25,000 each)
- Spent this cycle: ₹${fmt(cycleSpend)} (${usagePct}% of limit)
- Projected spend: ₹${fmt(projected)} (${projectedPct}% of limit)
- Safe threshold: 30% = ₹${fmt(CC_ALERT_AMT)}
- Days left in cycle: ${daysLeft}
- Days until payment due: ${daysUntilDue}
- Safe daily spend to stay under 30%: ₹${fmt(safeDaily)}
- Top spending categories:
${topCats}

Write exactly 2 sentences:
- Sentence 1: react to usage vs the 30% limit
- Sentence 2: one specific actionable suggestion
- Use ₹ and Indian number formatting
- No fluff openers
- End with one relevant emoji
- Write ONLY the 2 sentences. No labels.
`;

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="
      + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    const tip  = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if(tip && tip.trim()){
      sendMessage("💡 " + tip.trim());
    }

  }catch(err){
    logAI("CC_GEMINI_TIP_ERROR", err.toString());
  }
}


/* ============================================
   PROGRESS BAR
============================================ */
function buildProgressBar(pct){
  const capped = Math.min(pct, 100);
  const filled = Math.min(Math.round(capped / 10), 10);
  const empty  = 10 - filled;
  let bar      = "▓".repeat(filled) + "░".repeat(empty);
  bar += pct < 30 ? ` ${pct}% (safe limit: 30%)` : ` ${pct}% ⚠️`;
  return bar;
}


/* ============================================
   AUTO ALERTS — runs on daily trigger
============================================ */
function checkCCAlerts(){

  try{

    const today      = new Date();
    const dayOfMonth = today.getDate();

    if(dayOfMonth === 18){
      sendMessage(
`🔔 CC bill generated today!

Tap CC Advisor for your full cycle summary.
Payment due on 9th of next month.`
      );
      sendCCAdvisorReport();
      return;
    }

    if(dayOfMonth === 6){
      sendMessage(
`⚠️ CC payment due in 3 days (9th)!

Make sure your account has enough balance.
Tap /cc to review.`
      );
      return;
    }

    if(dayOfMonth === 9){
      sendMessage(
`🚨 CC payment due TODAY (9th)!

Pay now to avoid interest charges.
Tap /cc to see the amount.`
      );
      return;
    }

    if(dayOfMonth === 4){
      sendCCAdvisorReport();
      return;
    }

    // Daily threshold check
    checkCCSpendingThreshold();

  }catch(err){
    logAI("CC_ALERT_ERROR", err.toString());
  }
}


/* ============================================
   SPENDING THRESHOLD CHECK
   Fires once per cycle at 25% and 30%
============================================ */
function checkCCSpendingThreshold(){

  try{

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transactions");
    if(!sheet) return;

    const today      = new Date();
    const thisMonth  = today.getMonth();
    const thisYear   = today.getFullYear();
    const dayOfMonth = today.getDate();

    let cycleStart;
    if(dayOfMonth <= 18){
      cycleStart = new Date(thisYear, thisMonth - 1, 19);
    } else {
      cycleStart = new Date(thisYear, thisMonth, 19);
    }

    const data     = sheet.getDataRange().getValues();
    const fmt      = (n) => Math.round(n).toLocaleString('en-IN');
    let cycleSpend = 0;

    for(let i = 1; i < data.length; i++){
      const rawDate = data[i][0];
      if(!rawDate) continue;
      const d    = new Date(rawDate);
      if(d < cycleStart || d > today) continue;
      const type   = (data[i][3] || "").toString().toLowerCase();
      const mode   = (data[i][4] || "").toString().toLowerCase();
      const amount = Number(data[i][5]) || 0;
      if(type === "debit" && mode.startsWith("card") && amount > 0){
        cycleSpend += amount;
      }
    }

    const props    = PropertiesService.getScriptProperties();
    const usagePct = (cycleSpend / CC_LIMIT) * 100;

    // Reset flags on 19th (new cycle starts)
    if(dayOfMonth === 19){
      props.deleteProperty("cc_warned_25");
      props.deleteProperty("cc_warned_30");
      return;
    }

    // 25% warning — once per cycle
    const warned25 = props.getProperty("cc_warned_25");
    if(usagePct >= 25 && usagePct < 30 && !warned25){
      props.setProperty("cc_warned_25", "YES");
      sendMessage(
`⚠️ CC Spending Warning

Combined CC spend: ₹${fmt(cycleSpend)} (${Math.round(usagePct)}% of ₹${fmt(CC_LIMIT)})
Approaching 30% safe threshold.

Remaining safe spend: ₹${fmt(CC_ALERT_AMT - cycleSpend)}
Tap /cc for full details.`
      );
      return;
    }

    // 30% alert — once per cycle
    const warned30 = props.getProperty("cc_warned_30");
    if(usagePct >= 30 && !warned30){
      props.setProperty("cc_warned_30", "YES");
      sendMessage(
`🚨 CC Limit Alert!

Combined CC spend: ₹${fmt(cycleSpend)} (${Math.round(usagePct)}% of ₹${fmt(CC_LIMIT)})
You've hit the 30% threshold.

Try to avoid further CC spending this cycle.
Tap /cc for full details.`
      );
      return;
    }

  }catch(err){
    logAI("CC_THRESHOLD_ERROR", err.toString());
  }
}