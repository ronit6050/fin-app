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
        suggestedType:     getSuggestedType(txn.type, suggestedCategory, txn.name, txn.amount, typeVotesData, txn.note)
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
      suggestedType:     getSuggestedType(txn.type, suggestedCategory, txn.name, txn.amount, typeVotesData, txn.note)
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
// source (added 2026-08-25) labels column J so a credit-card-statement
// recovery reads "Credit Card Statement" instead of the bank flow's
// "Bank Statement" — optional, defaults to the original bank wording so
// every existing call site is unaffected.
function insertReconciledTransactions(txns, source){

  try{
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
    const formattedTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss");

    let added = 0;

    txns.forEach(function(t){
      // Same server-side safety net saveTransactionNote has — never
      // record a Need/Want/Saving/Investment type for a recognized
      // loan/repayment, even if one somehow came through.
      const isLending = isLendingTransfer(t.name, t.note);
      const typeToSave = isLending ? "" : (t.needWantSaving || "");

      sheet.appendRow([
        t.date,             // Date
        formattedTime,      // Time
        "HDFC",             // Bank
        t.type,             // Type (debit/credit)
        t.mode,             // Mode
        t.amount,           // Amount
        t.ref,              // Reference
        t.name,             // Counterparty
        "Import",              // Channel
        source || "Bank Statement", // Source
        "-",                // RawSMS
        "-",                // Sender
        t.note || "",       // Note
        t.category || "",   // Category
        "",                 // TelegramMsg
        "YES",               // Processed
        typeToSave           // NeedWantSaving (column Q) — the actually-chosen type, same as saveTransactionNote now stores
      ]);
      added++;

      if(t.name && t.category){
        handleCategoryCorrection(t.name, t.category, "Other");
      }
      if(t.name && typeToSave){
        recordTypeVote(t.name, Number(t.amount) || 0, typeToSave);
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

/* ===============================
   PWA CREDIT CARD STATEMENT RECONCILIATION (2026-08-25)
   Same "upload -> review -> approve" idea as the bank statement
   reconciliation above, but for a credit card statement — added after
   a real bill payment turned out to be short by a real amount the app
   never tracked (a card swipe the SMS parser silently never caught).

   Reuses findHeaderRow()/mapColumns() from Credit Card.js (already
   generic, no changes made there) to read whatever column layout the
   real statement uses — a card statement doesn't follow the bank
   statement's fixed row-22 layout, so parseBankSheet() doesn't apply
   here. Once parsed into the same { date, amount, type, ref, name, mode,
   note } shape parseBankSheet() produces, this hands off to the exact
   same previewReconciliation()/calculateScore() used above, unchanged —
   the matching logic doesn't need to know or care where a transaction
   came from. See docs/features/reconciliation.md.
=============================== */

// Turns a Drive-converted credit card statement Sheet into txns.
function parseCreditCardSheet(sheet){

  const data = sheet.getDataRange().getValues();
  const headerIndex = findHeaderRow(data);
  const header = data[headerIndex];
  const colMap = mapColumns(header);

  const txns = [];

  for(let i = headerIndex + 1; i < data.length; i++){

    const row = data[i];
    const rawDate = row[colMap.date];
    const description = colMap.desc !== undefined ? row[colMap.desc] : "";

    if(!rawDate || !description) continue;

    const parsedDate = parseFlexibleDate(rawDate);
    if(!parsedDate) continue;

    let amount = 0;
    let type = "debit";

    if(colMap.amount !== undefined){
      const cellText = (row[colMap.amount] || "").toString().toUpperCase();
      const numeric   = parseFloat(row[colMap.amount]) || 0;
      amount = Math.abs(numeric);
      // Some statements mark a credit (refund/reversal) with a minus
      // sign or a trailing "CR" in the same cell — best-effort, always
      // reviewable before anything is saved either way.
      type = (cellText.indexOf("CR") !== -1 || numeric < 0) ? "credit" : "debit";
    } else {
      const debit  = parseFloat(row[colMap.debit])  || 0;
      const credit = parseFloat(row[colMap.credit]) || 0;
      if(debit > 0){ amount = debit; type = "debit"; }
      else if(credit > 0){ amount = credit; type = "credit"; }
    }

    if(!amount) continue;

    txns.push({
      date: parsedDate,
      amount: amount,
      type: type,
      ref: "NOREF_" + i, // a card statement doesn't carry a UPI-style reference number — matching falls back to date+amount+type (see calculateScore)
      name: description.toString().trim(),
      mode: "card",
      note: "" // no personal-note concept on a card statement, unlike UPI narration's last dash segment
    });
  }

  return txns;
}

// Handles a real Date object, an Excel serial number, or a dd/mm/yy(yy)
// string — the three shapes a converted statement Sheet can hand back.
function parseFlexibleDate(dateVal){
  if(dateVal instanceof Date) return dateVal;

  if(typeof dateVal === "number"){
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + dateVal * 86400000);
  }

  if(typeof dateVal === "string"){
    const parts = dateVal.trim().split(/[\/\-]/);
    if(parts.length === 3){
      const day   = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year    = parseInt(parts[2], 10);
      if(year < 100) year += 2000;
      const d = new Date(year, month, day);
      if(!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

// Turns extracted statement TEXT (from a real PDF, via OCR — see
// reconcileCreditCardStatementPreview below) into the same txn shape
// parseCreditCardSheet()/parseBankSheet() produce. Built and verified
// 2026-08-25 against the user's own real HDFC UPI RuPay statement, whose
// transaction lines look like:
//   23/07/2026| 21:25 UPI-HI TECH AUTO SERVICE  <rewards>  ₹523.59  <PI dot>
//   06/08/2026| 08:55 BPPY CC PAYMENT ... (Ref# ...)  +  ₹9,800.00  <PI dot>
// Deliberately does NOT depend on recognizing the ₹ symbol itself —
// OCR engines render currency glyphs inconsistently (the PDF-reading
// tool used to inspect the real statement rendered it as a stray "C";
// Google's own Drive OCR, used live, may render it differently again).
// Instead: find the date+time at the start of a line, then treat the
// LAST amount-shaped number (digits with a 2-decimal-place ending) on
// that line as the transaction amount — the statement's own column
// order always puts the ₹ amount last, after the description and any
// rewards figure. A "+" immediately before that amount marks a credit
// (a payment/refund), matching the real statement's own convention.
function parseCreditCardStatementText(text){

  const lines = text.split("\n");
  const lineStartRe = /^(\d{2}\/\d{2}\/\d{4})\D+?(\d{2}:\d{2})\s+(.+)$/;
  const amountRe = /[\d,]+\.\d{2}/g;

  const txns = [];

  for(let li = 0; li < lines.length; li++){
    const line = lines[li].trim();
    const m = lineStartRe.exec(line);
    if(!m) continue;

    const dateStr = m[1];
    const rest    = m[3];

    const amountMatches = rest.match(amountRe);
    if(!amountMatches || !amountMatches.length) continue;

    const amountStr   = amountMatches[amountMatches.length - 1];
    const amount       = parseFloat(amountStr.replace(/,/g, ""));
    if(!amount) continue;

    const amountIndex  = rest.lastIndexOf(amountStr);
    const beforeAmount = rest.slice(0, amountIndex);
    const isCredit     = /\+\s*[^\d]{0,6}$/.test(beforeAmount);

    let description = beforeAmount
      .replace(/\+\s*[^\d]{0,6}$/, "")   // the "+" credit marker and any stray currency glyph before it
      .replace(/[^\d]{0,6}$/, "")        // a stray currency glyph on a plain (debit) line too
      .trim();

    const parsedDate = parseFlexibleDate(dateStr);
    if(!parsedDate || !description) continue;

    txns.push({
      date: parsedDate,
      amount: amount,
      type: isCredit ? "credit" : "debit",
      ref: "NOREF_" + li, // no UPI-style reference captured from the statement text
      name: description,
      mode: "card",
      note: ""
    });
  }

  return txns;
}

// Google's Drive API enforces a short-lived per-user rate limit that an
// OCR conversion can trip even on a single request (found 2026-08-25 on
// the very first real upload — real error: "GoogleJsonResponseException:
// ...drive.files.copy failed... User rate limit exceeded"). This is
// normally transient (clears within seconds), so retry a few times with
// a growing pause instead of failing on the first hiccup. Only retries
// an error that actually looks like a rate limit — any other error
// (a genuinely broken file, a permissions problem) fails immediately,
// same as before, rather than uselessly retrying something that will
// never succeed.
function withRateLimitRetry_(fn, maxAttempts){
  maxAttempts = maxAttempts || 4;
  let lastErr;
  for(let attempt = 1; attempt <= maxAttempts; attempt++){
    try{
      return fn();
    }catch(err){
      lastErr = err;
      const looksLikeRateLimit = /rate limit|quota|User Rate Limit Exceeded/i.test(err.toString());
      if(!looksLikeRateLimit || attempt === maxAttempts) throw err;
      Utilities.sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s
    }
  }
  throw lastErr;
}

// Uploads a PDF and gets real text back out of it via Google Drive's own
// OCR (Drive API v2, already enabled for this project — see
// appsscript.json).
function extractTextFromStatementPdf(fileBase64, fileName){
  let driveFile = null;
  let ocrDoc = null;

  try{
    const blob = Utilities.newBlob(
      Utilities.base64Decode(fileBase64),
      MimeType.PDF,
      fileName || "cc-statement.pdf"
    );

    driveFile = DriveApp.createFile(blob);
    ocrDoc = withRateLimitRetry_(function(){
      return Drive.Files.copy(
        { title: (fileName || "cc-statement") + " (OCR)", mimeType: MimeType.GOOGLE_DOCS },
        driveFile.getId(),
        { ocr: true, ocrLanguage: "en" }
      );
    });

    return DocumentApp.openById(ocrDoc.id).getBody().getText();

  }finally{
    try{ if(driveFile) driveFile.setTrashed(true); }catch(e){}
    try{ if(ocrDoc) DriveApp.getFileById(ocrDoc.id).setTrashed(true); }catch(e){}
  }
}

// Entry point for the PWA's reconcileCreditCardStatement action.
// Branches on the uploaded file's extension — a real HDFC UPI RuPay
// statement turned out to be a PDF (found 2026-08-25, checking the
// user's own real statement), not the .xls the bank statement flow
// uses, so this needs its own path via OCR text extraction +
// parseCreditCardStatementText() above. Kept .xls/.xlsx support too
// (parseCreditCardSheet(), the original Sheet-conversion path) in case
// a different card issuer or export option ever provides one — same
// idea as the bank flow, unchanged. Either path lands on the exact same
// previewReconciliation() used everywhere else. A missing entry's mode
// always comes back "card" (see parseCreditCardSheet /
// parseCreditCardStatementText), so an approved entry correctly counts
// as card spend everywhere Mode is checked (CC Advisor,
// isCreditCardBillPayment, Analysis's Card bucket).
function reconcileCreditCardStatementPreview(fileBase64, fileName){

  const isPdf = /\.pdf$/i.test(fileName || "");

  let driveFile = null;
  let convertedFile = null;

  try{
    let ccTxns;

    if(isPdf){
      const text = extractTextFromStatementPdf(fileBase64, fileName);
      ccTxns = parseCreditCardStatementText(text);
    } else {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(fileBase64),
        MimeType.MICROSOFT_EXCEL,
        fileName || "cc-statement.xls"
      );

      driveFile = DriveApp.createFile(blob);
      convertedFile = Drive.Files.copy({ mimeType: MimeType.GOOGLE_SHEETS }, driveFile.getId());

      const ss    = SpreadsheetApp.openById(convertedFile.id);
      const sheet = ss.getSheets()[0];

      ccTxns = parseCreditCardSheet(sheet);
    }

    const result = previewReconciliation(ccTxns);

    return { ok: true, total: result.total, matched: result.matched, missing: result.missing, notesFound: result.notesFound };

  }catch(err){
    logAI("CC_RECON_ERROR", err.toString());
    return { ok: false, error: err.toString() };
  }finally{
    try{ if(driveFile) driveFile.setTrashed(true); }catch(e){}
    try{ if(convertedFile) DriveApp.getFileById(convertedFile.id).setTrashed(true); }catch(e){}
  }
}