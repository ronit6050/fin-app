/* ============================================
   AI ADVISOR — LAYER 1
   Smart reaction after every transaction note
============================================ */

function generateSmartReaction(note, category, amount, bank, mode) {

  try {

    // ── Skip tiny transactions — not worth a Gemini call ──
    if(Number(amount) < 200) return;

    // ── Skip generic notes that give no context ──
    const genericNotes = ["test","na","n/a","-","misc","other","unknown"];
    if(genericNotes.includes(note.toLowerCase().trim())) return;

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transactions");
    const data  = sheet.getDataRange().getValues();

    const today      = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const rollingStart = new Date();
    rollingStart.setDate(today.getDate() - 30);

    // ── Current month accumulators ──
    let categoryTotal    = 0;
    let categoryCount    = 0;
    let totalSpendMonth  = 0;
    let totalIncomeMonth = 0;
    let merchantCount    = {};

    // ── Rolling 30-day for avg daily ──
    let dailySpend30 = {};

    for(let i = 1; i < data.length; i++){

      const rawDate = data[i][0];
      if(!rawDate) continue;

      const d         = new Date(rawDate);
      const rowType   = (data[i][3] || "").toLowerCase();
      const rowAmount = Number(data[i][5]) || 0;
      const rowCat    = (data[i][13] || "Other").toString().trim();
      const rowNote   = (data[i][12] || "").trim();
      const dayKey    = d.toDateString();

      // Current month
      if(d >= monthStart && d <= today){

        if(rowType === "debit"){
          totalSpendMonth += rowAmount;

          if(rowCat.toLowerCase() === category.toLowerCase()){
            categoryTotal += rowAmount;
            categoryCount++;
          }

          if(rowNote){
            merchantCount[rowNote] = (merchantCount[rowNote] || 0) + 1;
          }

        } else if(rowType === "credit"){
          totalIncomeMonth += rowAmount;
        }
      }

      // Rolling 30 days for avg daily
      if(d >= rollingStart && d <= today && rowType === "debit"){
        dailySpend30[dayKey] = (dailySpend30[dayKey] || 0) + rowAmount;
      }
    }

    const daysElapsed = today.getDate();

    const projectedMonthlySpend = daysElapsed > 4
      ? Math.round((totalSpendMonth / daysElapsed) * 30)
      : null; // Too early in month — skip projection

    const activeDays30 = Object.keys(dailySpend30).length || 1;
    const avgDaily30   = Math.round(
      Object.values(dailySpend30).reduce((a, b) => a + b, 0) / activeDays30
    );

    const thisMerchantCount = merchantCount[note.trim()] || 1;
    const savingsMonth      = totalIncomeMonth - totalSpendMonth;
    const monthName         = today.toLocaleString("default", {month:"long"});

    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    const projectionLine = projectedMonthlySpend
      ? `- Projected full month spend: ₹${fmt(projectedMonthlySpend)}`
      : `- Too early in month for reliable projection`;

    const context = `
You are a friendly, sharp personal finance advisor for an Indian user.

Transaction just recorded:
- Amount: ₹${fmt(amount)}
- Category: ${category}
- Merchant: ${note}
- Payment: ${mode} via ${bank}

Their ${monthName} so far (day ${daysElapsed}):
- Total spent: ₹${fmt(totalSpendMonth)}
- Total income: ₹${fmt(totalIncomeMonth)}
- Net savings: ₹${fmt(savingsMonth)}
- Spent on "${category}": ₹${fmt(categoryTotal)} across ${categoryCount} transaction(s)
- "${note}" appeared ${thisMerchantCount} time(s) this month
- Avg daily spend (last 30 days): ₹${fmt(avgDaily30)}
${projectionLine}

Write ONE reaction. Rules:
- Max 2 sentences
- Direct and friendly — like a smart friend
- Use real numbers from above
- Only mention projection if genuinely high (above ₹40,000)
- If merchant appears 3+ times this month, mention the habit
- No generic advice like "consider saving more"
- No fluff openers like "Great!" or "Sure!"
- Use ₹ and Indian number formatting
- End with one relevant emoji

Write only the reaction. No labels, no preamble.
`;

    const {GEMINI_KEY} = getConfig();

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="
      + GEMINI_KEY;

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{ parts: [{ text: context }] }]
      }),
      muteHttpExceptions: true
    });

    const json     = JSON.parse(response.getContentText());
    const reaction = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if(reaction && reaction.trim().length > 0){
      sendMessage("💡 " + reaction.trim());
    }

  } catch(err) {
    logAI("ADVISOR_ERROR", err.toString());
  }
}