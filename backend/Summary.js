/* ============================================
   TODAY'S SUMMARY
============================================ */

function sendTodaySummary(){

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const txnSheet  = ss.getSheetByName("Transactions");
  const cashSheet = ss.getSheetByName("Cash");

  const txnData  = txnSheet.getDataRange().getValues();
  const cashData = cashSheet.getDataRange().getValues();

  const today = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
  );

  let bankSpend = 0;
  let cashSpend = 0;
  let totalTxn  = 0;

  let modeTotals     = {};
  let categoryTotals = {};

  const fmt = (n) => Math.round(n).toLocaleString('en-IN');

  /* ===============================
     BANK TRANSACTIONS
  =============================== */
  for(let i = 1; i < txnData.length; i++){

    const rawDate = txnData[i][0];
    if(!rawDate) continue;

    const d = Utilities.formatDate(
      new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    if(d === today && (txnData[i][3] || "").toLowerCase() === "debit"){

      const amount   = Number(txnData[i][5]) || 0;
      const mode     = txnData[i][4]  || "Other";
      const category = txnData[i][13] || "Other";

      bankSpend += amount;
      totalTxn++;

      modeTotals[mode]         = (modeTotals[mode] || 0) + amount;
      categoryTotals[category] = (categoryTotals[category] || 0) + amount;
    }
  }

  /* ===============================
     CASH TRANSACTIONS
  =============================== */
  for(let i = 1; i < cashData.length; i++){

    const rawDate = cashData[i][1];
    if(!rawDate) continue;

    const d = Utilities.formatDate(
      new Date(rawDate), Session.getScriptTimeZone(), "yyyy-MM-dd"
    );

    const type = (cashData[i][3] || "").toString().toLowerCase();

    if(d === today && type === "debit"){

      const amount   = Number(cashData[i][4]) || 0;
      const category = cashData[i][6] || "Other";

      cashSpend += amount;

      // ── Include cash in category totals too ──
      categoryTotals[category] = (categoryTotals[category] || 0) + amount;
    }
  }

  const total = bankSpend + cashSpend;

  /* ===============================
     MODE BREAKDOWN
  =============================== */
  let modeText = "";
  Object.entries(modeTotals)
    .sort((a, b) => b[1] - a[1])
    .forEach(([mode, val]) => {
      modeText += `\n• ${mode}: ₹${fmt(val)}`;
    });

  /* ===============================
     CATEGORY BREAKDOWN
  =============================== */
  let categoryText = "";
  Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      categoryText += `\n• ${cat}: ₹${fmt(val)}`;
    });

  /* ===============================
     NO SPEND TODAY
  =============================== */
  if(total === 0){
    sendMessage(
`📊 Today's Summary

✅ No spending recorded today.
Great day for your wallet! 💰`
    );
    return;
  }

  /* ===============================
     BUILD MESSAGE
  =============================== */
  const message =
`📊 Today's Summary

💳 Bank Spend: ₹${fmt(bankSpend)}
💵 Cash Spend: ₹${fmt(cashSpend)}

🧾 Total Spend: ₹${fmt(total)}
🔢 Transactions: ${totalTxn}

📂 Category Breakdown:${categoryText || "\nNone"}

💳 Mode Breakdown:${modeText || "\nNone"}`;

  sendMessage(message);
}