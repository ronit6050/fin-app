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

/* ===== EXTRACT NOTE (2026-08-08) =====
   UPI narrations put the note typed while paying in the LAST dash-
   separated segment — but only when a note was actually typed. When it
   wasn't, that slot just says "UPI", or holds boilerplate the payment
   app inserted itself. This filters those out so only genuine-looking
   notes get suggested — always still reviewed/editable by the user
   before anything is saved. See docs/features/reconciliation.md. */
function extractNoteFromNarration(narration){
  try{
    if(!narration) return "";

    const parts = narration.toString().split("-");
    if(parts.length < 2) return "";

    const last = parts[parts.length - 1].trim();
    if(!last) return "";

    const lastUpper = last.toUpperCase();
    if(lastUpper === "UPI") return "";

    const boilerplatePrefixes = ["SENT VIA", "PAID VIA", "PAY VIA", "PAYMENT FOR", "PAYMENT TO"];
    for(let i = 0; i < boilerplatePrefixes.length; i++){
      if(lastUpper.indexOf(boilerplatePrefixes[i]) === 0) return "";
    }

    return last;
  }catch(e){
    return "";
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
    const note     = extractNoteFromNarration(narration);

    txns.push({
      date: parsedDate,
      amount,
      type,
      ref:  cleanRef || ("NOREF_" + i),
      name,
      mode,
      note
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

/* ===============================
   PWA RECONCILIATION (2026-08-08)
   Preview-then-approve flow — see docs/features/reconciliation.md.
   Kept separate from the Telegram-era functions above (which wrote
   straight to Recon_Temp) since this returns JSON directly instead.
=============================== */

// Matches parsed bank transactions against Transactions and returns two
// separate opportunities — nothing is written here, this is preview-only:
//   missing    — transactions Tasker never caught at all
//   notesFound — transactions Tasker DID catch, but with no note yet,
//                where the statement has a recoverable note. This is
//                usually the bigger of the two, since SMS text never
//                carries the UPI note — only the statement does.
// smartMemoryData/typeMemoryData are read once here and reused for every
// transaction, same fix applied to getPendingTransactions on 2026-08-08
// (see needWantSaving.js) — avoids re-reading those sheets per row.
function previewReconciliation(bankTxns){

  const sheetData = getSheetData();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const smartMemorySheet = ss.getSheetByName("SmartMemory");
  const smartMemoryData  = smartMemorySheet ? smartMemorySheet.getDataRange().getValues() : [];
  const typeVotesSheet   = ss.getSheetByName("TypeVotes");
  const typeVotesData    = typeVotesSheet ? typeVotesSheet.getDataRange().getValues() : [];

  let matched = 0;
  const missing = [];
  const notesFound = [];

  bankTxns.forEach(function(txn){

    let bestScore = 0;
    let bestRowIndex = -1;
    for(let i = 1; i < sheetData.length; i++){
      const score = calculateScore(txn, sheetData[i]);
      if(score > bestScore){ bestScore = score; bestRowIndex = i; }
      if(score === 100) break;
    }

    if(bestScore >= 90){
      matched++;

      const sheetRow         = sheetData[bestRowIndex];
      const existingNote     = (sheetRow[12] || "").toString().trim(); // column M
      const existingCategory = (sheetRow[13] || "").toString().trim(); // column N

      // Already noted — nothing to recover, nothing to do.
      if(existingNote || !txn.note) return;

      const suggestedCategory = (!existingCategory || existingCategory === "Other")
        ? getSuggestedCategoryFast(txn.name, txn.amount, txn.mode, smartMemoryData)
        : existingCategory;

      notesFound.push({
        row:               bestRowIndex + 1, // sheet rows are 1-indexed
        date:              Utilities.formatDate(txn.date, Session.getScriptTimeZone(), "dd MMM yyyy"),
        amount:            Number(txn.amount),
        type:              txn.type,
        name:              sheetRow[7] || txn.name, // real Counterparty already on that row
        note:              txn.note,
        suggestedCategory: suggestedCategory,
        suggestedType:     getSuggestedType(txn.type, suggestedCategory, txn.name, txn.amount, typeVotesData)
      });

      return;
    }

    const suggestedCategory = getSuggestedCategoryFast(txn.name, txn.amount, txn.mode, smartMemoryData);

    missing.push({
      rawDate:           Utilities.formatDate(txn.date, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      date:              Utilities.formatDate(txn.date, Session.getScriptTimeZone(), "dd MMM yyyy"),
      amount:            Number(txn.amount),
      type:              txn.type,
      mode:              txn.mode,
      name:              txn.name,
      ref:               txn.ref,
      note:              txn.note || "",
      suggestedCategory: suggestedCategory,
      suggestedType:     getSuggestedType(txn.type, suggestedCategory, txn.name, txn.amount, typeMemoryData)
    });
  });

  return { total: bankTxns.length, matched: matched, missing: missing, notesFound: notesFound };
}

// Entry point for the PWA's reconcileStatement action. The browser can't
// send a raw file through the same JSON API everything else uses, so it
// sends the file as base64 instead — decoded here into a Blob, then
// converted to a Sheet via Drive the same way the old Telegram upload
// flow did (already enabled for this project). Cleans up both temporary
// Drive files afterward, whether this succeeds or fails.
function reconcileStatementPreview(fileBase64, fileName){

  let driveFile = null;
  let convertedFile = null;

  try{
    const blob = Utilities.newBlob(
      Utilities.base64Decode(fileBase64),
      MimeType.MICROSOFT_EXCEL,
      fileName || "statement.xls"
    );

    driveFile = DriveApp.createFile(blob);
    convertedFile = Drive.Files.copy({ mimeType: MimeType.GOOGLE_SHEETS }, driveFile.getId());

    const ss    = SpreadsheetApp.openById(convertedFile.id);
    const sheet = ss.getSheets()[0];

    const bankTxns = parseBankSheet(sheet);
    const result   = previewReconciliation(bankTxns);

    return { ok: true, total: result.total, matched: result.matched, missing: result.missing, notesFound: result.notesFound };

  }catch(err){
    logAI("RECON_ERROR", err.toString());
    return { ok: false, error: err.toString() };
  }finally{
    try{ if(driveFile) driveFile.setTrashed(true); }catch(e){}
    try{ if(convertedFile) DriveApp.getFileById(convertedFile.id).setTrashed(true); }catch(e){}
  }
}

// Writes the user-approved (and possibly edited) missing transactions
// into Transactions. Only ever called after the Reconcile screen has
// shown them to the user and they've confirmed — never automatic.
// Marks Processed = "YES" immediately, since these have already been
// reviewed here and shouldn't also show up in Pending asking again.
function insertReconciledTransactions(txns){

  try{
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
    const formattedTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss");

    let added = 0;

    txns.forEach(function(t){
      sheet.appendRow([
        t.date,             // Date
        formattedTime,      // Time
        "HDFC",             // Bank
        t.type,             // Type (debit/credit)
        t.mode,             // Mode
        t.amount,           // Amount
        t.ref,              // Reference
        t.name,             // Counterparty
        "Import",           // Channel
        "Bank Statement",   // Source
        "-",                // RawSMS
        "-",                // Sender
        t.note || "",       // Note
        t.category || "",   // Category
        "",                 // TelegramMsg
        "YES",               // Processed
        t.needWantSaving || "" // NeedWantSaving (column Q) — the actually-chosen type, same as saveTransactionNote now stores
      ]);
      added++;

      if(t.name && t.category){
        handleCategoryCorrection(t.name, t.category, "Other");
      }
      if(t.name && t.needWantSaving){
        recordTypeVote(t.name, Number(t.amount) || 0, t.needWantSaving);
      }
    });

    const lastRow = sheet.getLastRow();
    if(lastRow > 1){
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
        .sort([{column: 1, ascending: true}]);
    }

    return { ok: true, added: added };

  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// One-off test against real narration samples from an actual HDFC
// statement (2026-08-08) — safe to delete once confirmed working.
function testExtractNoteFromNarration(){
  Logger.log("Genuine note 'MILK', expect MILK: " +
    extractNoteFromNarration("UPI-NEELADRI VEGETABLE A-PAYTM.S26HQVN@PTY-YESB0MCHUPI-618368197341-MILK"));

  Logger.log("No note given, expect empty: " +
    extractNoteFromNarration("UPI-ABDUL AYAN BASHA-7090065269@PTYES-PUNB0477400-125760253171-UPI"));

  Logger.log("App boilerplate 'SENT VIA...', expect empty: " +
    extractNoteFromNarration("UPI-APSPL-JUPITERFPPI@ICICI-ICIC0DC0099-918494441876-SENT VIA JUPITER"));

  Logger.log("Genuine note w/ spaces, expect HAPPY BIRTHDAY RON: " +
    extractNoteFromNarration("UPI-NADAR SHALINI MUKESH-9426144524@PTYES-JSFB0003071-310029630196-HAPPY BIRTHDAY RON"));

  Logger.log("Genuine note (truncated), expect LUNCH ME AND VAIDE: " +
    extractNoteFromNarration("UPI-SMILEY SCOOPS AMUL-Q711211452@YBL-YESB0YBLUPI-619279408486-LUNCH ME AND VAIDE"));

  Logger.log("App boilerplate 'PAYMENT FOR...', expect empty: " +
    extractNoteFromNarration("UPI-RATNADEEP SUPERMARKE-RATNADEEPSUPERMARKETSARJAPURA@YBL-YESB0YBLUPI-619646958656-PAYMENT FOR 182870"));

  Logger.log("Non-UPI narration (known messy case, acceptable since reviewed): " +
    extractNoteFromNarration("DEBIT CARD ANNUAL FEE-JUL-2026-EPR2719626958892"));
}