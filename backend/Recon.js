/* ============================================
   RECONCILIATION ENGINE (FINAL FIXED VERSION)
============================================ */

/* ===== NORMALIZE REF ===== */
function normalizeRef(ref){
  if(!ref) return "";
  return String(ref)
    .replace(/[^0-9]/g,"")
    .replace(/^0+/,"")
    .trim();
}

/* ===== SAFE DATE PARSER ===== */
function parseIndianDate(dateVal){
  if(dateVal instanceof Date) return dateVal;
  try{
    const parts = dateVal.toString().split("/");
    if(parts.length === 3){
      const day   = parseInt(parts[0],10);
      const month = parseInt(parts[1],10) - 1;
      const year  = 2000 + parseInt(parts[2],10);
      return new Date(year, month, day);
    }
  }catch(e){}
  return null;
}

/* ===== DETECT MODE ===== */
function detectMode(narration){
  narration = narration.toString().toUpperCase();
  if(narration.includes("UPI"))  return "upi";
  if(narration.includes("NEFT")) return "neft";
  if(narration.includes("IMPS")) return "imps";
  if(narration.includes("ATM"))  return "atm";
  if(narration.includes("CARD")) return "card";
  return "other";
}

/* ===== EXTRACT NAME ===== */
function extractName(narration){
  try{
    const parts = narration.split("-");
    return parts.length > 1 ? parts[1].trim() : narration;
  }catch(e){
    return narration;
  }
}

/* ===== GET SHEET DATA ===== */
function getSheetData(){
  return SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Transactions")
    .getDataRange()
    .getValues();
}

/* ===== PARSE BANK FILE ===== */
function parseBankSheet(sheet){

  const data = sheet.getDataRange().getValues();
  const txns = [];

  for(let i=22;i<data.length;i++){

    const row        = data[i];
    const rawDate    = row[0];
    const narration  = row[1];
    const ref        = row[2];
    const withdrawal = row[4];
    const deposit    = row[5];

    if(!rawDate || !narration) continue;

    const parsedDate = parseIndianDate(rawDate);
    if(!parsedDate) continue;

    const text = narration.toString().toUpperCase().trim();

    if(text === "" || text.replace(/\*/g,"") === "") continue;

    if(
      text.includes("OPENING")   ||
      text.includes("CLOSING")   ||
      text.includes("STATEMENT") ||
      text.includes("SUMMARY")   ||
      text.includes("GENERATED") ||
      text.includes("BRANCH")
    ) continue;

    if(!withdrawal && !deposit) continue;

    const amount = withdrawal || deposit;
    if(!amount || Number(amount) === 0) continue;

    const type     = withdrawal ? "debit" : "credit";
    const cleanRef = normalizeRef(ref);
    const mode     = detectMode(narration);
    const name     = extractName(narration);

    txns.push({
      date: parsedDate,
      amount,
      type,
      ref:  cleanRef || ("NOREF_" + i),
      name,
      mode
    });
  }

  return txns;
}

/* ===== SCORING FUNCTION ===== */
function calculateScore(txn, sheetRow){

  const sheetDate = parseIndianDate(sheetRow[0]);
  const bankDate  = txn.date;

  if(!sheetDate) return 0;

  const sameDate =
    sheetDate.getFullYear() === bankDate.getFullYear() &&
    sheetDate.getMonth()    === bankDate.getMonth()    &&
    sheetDate.getDate()     === bankDate.getDate();

  const sheetAmount = Number(sheetRow[5]);
  const bankAmount  = Number(txn.amount);

  const sheetType = (sheetRow[3] || "").toString().toLowerCase();
  const bankType  = (txn.type   || "").toString().toLowerCase();

  const refMatch = normalizeRef(sheetRow[6]) === txn.ref;

  if(refMatch)                                              return 100;
  if(sameDate && sheetAmount === bankAmount && sheetType === bankType) return 95;
  if(sameDate && sheetAmount === bankAmount)                return 90;

  return 0;
}

/* ===== RECON LOGIC ===== */
function runReconciliation(sheet){

  const bankTxns  = parseBankSheet(sheet);
  const sheetData = getSheetData();

  const tempSheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Recon_Temp");

  tempSheet.clear();
  tempSheet.appendRow(["Date","Amount","Type","Reference","Name","Mode","Score","Status"]);

  let matched = 0;
  let missing = 0;

  bankTxns.forEach(txn => {

    let bestScore = 0;

    for(let i=1;i<sheetData.length;i++){
      const score = calculateScore(txn, sheetData[i]);
      if(score > bestScore) bestScore = score;
      if(score === 100) break;
    }

    if(bestScore >= 90){
      matched++;
      tempSheet.appendRow([
        txn.date, txn.amount, txn.type,
        txn.ref, txn.name, txn.mode,
        bestScore, "MATCHED"
      ]);
    } else {
      missing++;
      tempSheet.appendRow([
        txn.date, txn.amount, txn.type,
        txn.ref, txn.name, txn.mode,
        bestScore, "MISSING"
      ]);
    }
  });

  return { total: bankTxns.length, matched, missing };
}

/* ===== INSERT CONFIRMED ===== */
function insertConfirmed(){

  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const temp = ss.getSheetByName("Recon_Temp");
  const main = ss.getSheetByName("Transactions");
  const data = temp.getDataRange().getValues();

  let added = 0;
  const now = new Date();

  for(let i=1;i<data.length;i++){

    if(data[i][7] !== "MISSING") continue;

    const txnDate = data[i][0];

    const formattedDate = Utilities.formatDate(
      txnDate, Session.getScriptTimeZone(), "yyyy-MM-dd"
    );
    const formattedTime = Utilities.formatDate(
      now, Session.getScriptTimeZone(), "HH:mm:ss"
    );

    main.appendRow([
      formattedDate, formattedTime,
      "HDFC",
      data[i][2], data[i][5], data[i][1],
      data[i][3], data[i][4],
      "Import", "Bank",
      "-", "-",
      "", "", "", "", ""
    ]);

    added++;
  }

  const lastRow = main.getLastRow();

  if(lastRow > 1){
    main.getRange(2, 1, lastRow-1, main.getLastColumn())
        .sort([{column:1, ascending:true}]);
  }

  return added;
}