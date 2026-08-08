/* ============================================
   MONTHLY ANALYSIS ENGINE
============================================ */

function generateMonthlyAnalysis(year, month){

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const txnSheet  = ss.getSheetByName("Transactions");
  const cashSheet = ss.getSheetByName("Cash");

  const txnData  = txnSheet.getDataRange().getValues();
  const cashData = cashSheet.getDataRange().getValues();

  let totalDebit  = 0;
  let totalCredit = 0;

  let categoryTotals = {};
  let modeTotals     = {};
  let dailyTotals    = {};

  let topTxn  = 0;
  let topNote = "";

  const ignoreCategories = ["Cash Exchange"];

  /* ===============================
     BANK TRANSACTIONS
  =============================== */
  for(let i = 1; i < txnData.length; i++){

    const rawDate = txnData[i][0];
    if(!rawDate) continue;

    const d = new Date(rawDate);

    if(d.getFullYear() === year && (d.getMonth()+1) === month){

      const type     = (txnData[i][3] || "").toLowerCase();
      const amount   = Number(txnData[i][5]) || 0;
      const mode     = txnData[i][4] || "Other";
      const category = txnData[i][13] || "Other";
      const note     = txnData[i][12] || "";
      const day      = d.getDate();

      if(type === "debit"){

        totalDebit += amount;

        if(!ignoreCategories.includes(category)){
          categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        }

        modeTotals[mode]   = (modeTotals[mode] || 0) + amount;
        dailyTotals[day]   = (dailyTotals[day] || 0) + amount;

        if(amount > topTxn){
          topTxn  = amount;
          topNote = note;
        }

      } else if(type === "credit"){
        totalCredit += amount;
      }
    }
  }

  /* ===============================
     CASH TRANSACTIONS
  =============================== */
  for(let i = 1; i < cashData.length; i++){

    const rawDate = cashData[i][1];
    if(!rawDate) continue;

    const d = new Date(rawDate);

    if(d.getFullYear() === year && (d.getMonth()+1) === month){

      const type     = (cashData[i][3] || "").toString().toLowerCase();
      const amount   = Number(cashData[i][4]) || 0;
      const category = cashData[i][6] || "Other";
      const day      = d.getDate();

      if(type === "debit"){

        totalDebit += amount;

        if(!ignoreCategories.includes(category)){
          categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        }

        dailyTotals[day] = (dailyTotals[day] || 0) + amount;

        if(amount > topTxn){
          topTxn  = amount;
          topNote = category || "Cash Spend";
        }

      } else if(type === "credit"){
        totalCredit += amount;
      }
    }
  }

  const savings = totalCredit - totalDebit;

  /* ===============================
     HELPER: Indian number format
  =============================== */
  const fmt = (n) => Math.round(n).toLocaleString('en-IN');

  /* ===============================
     CATEGORY (SORT + %)
  =============================== */
  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1]);

  let categoryText = "";
  let maxCategory  = "";
  let maxValue     = 0;

  sortedCategories.forEach(([cat, val], index) => {
    const percent = totalDebit > 0
      ? ((val / totalDebit) * 100).toFixed(1)
      : 0;
    categoryText += `\n• ${cat}: ₹${fmt(val)} (${percent}%)`;
    if(index === 0){
      maxCategory = cat;
      maxValue    = val;
    }
  });

  /* ===============================
     MODE (SORTED)
  =============================== */
  const sortedModes = Object.entries(modeTotals)
    .sort((a, b) => b[1] - a[1]);

  let modeText = "";
  sortedModes.forEach(([mode, val]) => {
    modeText += `\n• ${mode}: ₹${fmt(val)}`;
  });

  /* ===============================
     AVG DAILY
  =============================== */
  const days     = Object.keys(dailyTotals).length || 1;
  const avgDaily = Math.round(totalDebit / days);

  /* ===============================
     GENERATE CHART
  =============================== */
  const chartBlob = generateCategoryChart(categoryTotals);

  /* ===============================
     GEMINI INSIGHT
  =============================== */
  const insight = getMonthlyInsight(
    year, month, totalDebit, totalCredit,
    savings, avgDaily, maxCategory,
    maxValue, sortedCategories
  );

  /* ===============================
     FINAL MESSAGE
  =============================== */
  const monthName = new Date(year, month-1)
    .toLocaleString('default', {month:'long'});

  const message =
`📊 ${monthName} ${year} Analysis

💸 Total Spend: ₹${fmt(totalDebit)}
💰 Income: ₹${fmt(totalCredit)}
💵 Savings: ₹${fmt(savings)}

📅 Avg Daily Spend: ₹${fmt(avgDaily)}

📂 Category Breakdown:${categoryText || "\nNone"}

💳 Mode Breakdown:${modeText || "\nNone"}

🏆 Top Spend: ₹${fmt(topTxn)} (${topNote || "No Note"})

📌 Top Category: ${maxCategory} (₹${fmt(maxValue)})

💡 Insight:
${insight}`;

  /* ===============================
     SEND OUTPUT
  =============================== */
  sendPhoto(chartBlob);
  sendMessage(message);
}


/* ============================================
   GEMINI MONTHLY INSIGHT
============================================ */
function getMonthlyInsight(
  year, month, totalDebit, totalCredit,
  savings, avgDaily, maxCategory,
  maxValue, sortedCategories
){
  try{

    const {GEMINI_KEY} = getConfig();

    const monthName = new Date(year, month-1)
      .toLocaleString('default', {month:'long'});

    const fmt = (n) => Math.round(n).toLocaleString('en-IN');

    const categoryList = sortedCategories
      .slice(0, 5)
      .map(([cat, val]) => `${cat}: ₹${fmt(val)}`)
      .join(", ");

    const savingsRate = totalCredit > 0
      ? ((savings / totalCredit) * 100).toFixed(1)
      : 0;

    const prompt = `
You are a personal finance advisor for an Indian user.

Their ${monthName} ${year} financial summary:
- Total spent: ₹${fmt(totalDebit)}
- Total income: ₹${fmt(totalCredit)}
- Net savings: ₹${fmt(savings)}
- Savings rate: ${savingsRate}%
- Average daily spend: ₹${fmt(avgDaily)}
- Top spending category: ${maxCategory} (₹${fmt(maxValue)})
- Top 5 categories: ${categoryList}

Write 2-3 sentences of specific, honest financial insight for this month.
- Reference actual numbers and category names
- If savings are negative, be direct about it
- If one category dominates, call it out
- End with one concrete suggestion for next month
- Use ₹ and Indian number formatting
- No generic advice, no fluff
- Write ONLY the insight. No labels, no preamble.
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

    const json    = JSON.parse(response.getContentText());
    const insight = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if(insight && insight.trim()){
      return insight.trim();
    }

    return "✅ Analysis complete.";

  }catch(err){
    logAI("INSIGHT_ERROR", err.toString());
    return "✅ Analysis complete.";
  }
}


/* ============================================
   CHART GENERATOR
============================================ */
function generateCategoryChart(categoryTotals){

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let tempSheet = ss.getSheetByName("TEMP_CHART");
  if(tempSheet) ss.deleteSheet(tempSheet);

  tempSheet = ss.insertSheet("TEMP_CHART");

  tempSheet.getRange(1,1).setValue("Category");
  tempSheet.getRange(1,2).setValue("Amount");

  let row = 2;
  for(let c in categoryTotals){
    tempSheet.getRange(row, 1).setValue(c);
    tempSheet.getRange(row, 2).setValue(categoryTotals[c]);
    row++;
  }

  const chart = tempSheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(tempSheet.getRange(1, 1, row-1, 2))
    .setPosition(1, 3, 0, 0)
    .build();

  tempSheet.insertChart(chart);

  const blob = tempSheet.getCharts()[0].getAs("image/png");

  ss.deleteSheet(tempSheet);

  return blob;
}


/* ============================================
   TELEGRAM PHOTO SENDER
============================================ */
function sendPhoto(blob){

  const {BOT_TOKEN, CHAT_ID} = getConfig();

  UrlFetchApp.fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,{
      method: "post",
      payload: {
        chat_id: CHAT_ID,
        photo:   blob
      }
    }
  );
}