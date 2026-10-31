/* ============================================
   LOGGER SYSTEM
============================================ */

function logAI(type, message){

  try{

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("AILogs");

    // Create sheet if not exists
    if(!sheet){
      sheet = ss.insertSheet("AILogs");
      sheet.appendRow(["Timestamp","Type","Message"]);
    }

    sheet.appendRow([
      new Date(),
      type,
      message
    ]);

  }catch(err){
    // Silent fail (never break main flow)
  }

}


/* ============================================
   SHEET STRUCTURE DIAGNOSTIC (added 2026-09-05)
   Run by hand from the Apps Script editor — read-only,
   changes nothing. Lists every real tab in this
   spreadsheet plus its headers/row count, and sorts each
   one into a plain-English bucket so it's obvious which
   tabs are safe to clean up before building the
   multi-user "template Sheet."
============================================ */
function diagnoseSheetStructure(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  // Tabs the current backend code still actually reads/writes.
  const ACTIVE = [
    "Transactions","Cash","Debts","Goals","Savings","Investments",
    "InvestmentInstruments","SmartMemory","TypeVotes","NoteMemory",
    "FinancialEvents","Budgets","AILogs","Credit_Card"
  ];

  // Tabs already known to be superseded/legacy from past cleanups —
  // real candidates for deletion, pending a final look at their data.
  const LEGACY = ["WishList","CategoryMemory","TypeMemory"];

  // Scratch tabs the old Telegram code creates and deletes within one
  // run — should not normally exist as a leftover, persisted tab.
  const SCRATCH = ["Recon_Temp","TEMP_CHART"];

  const isLegacyName = (name) =>
    LEGACY.indexOf(name) !== -1 || /_old/i.test(name);

  log("===== SHEET STRUCTURE DIAGNOSTIC =====");
  log("(Read-only — this changes nothing, just reports.)");
  log("");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();

  log("Found " + sheets.length + " tab(s) total in this spreadsheet.");
  log("");

  sheets.forEach((sheet) => {
    const name = sheet.getName();
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const headers = lastRow > 0 && lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
          .filter((h) => h !== "" && h !== null)
          .join(" | ")
      : "(empty — no header row)";
    const dataRowCount = Math.max(0, lastRow - 1);

    let bucket;
    if(ACTIVE.indexOf(name) !== -1){
      bucket = "ACTIVE — code still uses this tab.";
    } else if(isLegacyName(name)){
      bucket = "LEGACY — already known superseded, likely safe to remove once double-checked.";
    } else if(SCRATCH.indexOf(name) !== -1){
      bucket = "SCRATCH — shouldn't normally be sitting here persisted; worth a look.";
    } else {
      bucket = "UNKNOWN — not on any known list, worth a manual look before deciding.";
    }

    log("- \"" + name + "\" — " + dataRowCount + " data row(s). " + bucket);
    log("    Headers: " + headers);
  });

  log("");
  log("===== END DIAGNOSTIC — copy everything above and share it =====");

  return out.join("\n");
}


/* ============================================
   ARCHIVE OLD MANUAL TABS (one-time, added 2026-09-05)
   Run by hand from the Apps Script editor. Copies the
   confirmed-unused "old manual tracking" tabs (found via
   diagnoseSheetStructure above) into a brand-new, separate
   spreadsheet — does NOT touch or delete anything in the
   main spreadsheet. Safe to run more than once (each run
   makes its own new archive spreadsheet). Once you've
   opened the new spreadsheet and confirmed everything
   copied correctly, run deleteArchivedOldManualSheets()
   below to remove the originals from the main sheet.
============================================ */
function archiveOldManualSheets(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  const TABS_TO_ARCHIVE = [
    "Categories","Config","CategoryBudgets","Budget",
    "Track exp","60k account","Aug CC bill","Sep CC bil"
  ];

  log("===== ARCHIVING OLD MANUAL TABS =====");
  log("(This only COPIES data into a new spreadsheet — nothing in the main sheet is touched or deleted.)");
  log("");

  const mainSs  = SpreadsheetApp.getActiveSpreadsheet();
  const today   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const archive = SpreadsheetApp.create("Fin-App Archive — old manual tabs (" + today + ")");

  const copied  = [];
  const skipped = [];

  TABS_TO_ARCHIVE.forEach((name) => {
    const sheet = mainSs.getSheetByName(name);
    if(!sheet){
      skipped.push(name);
      return;
    }
    const copiedSheet = sheet.copyTo(archive);
    copiedSheet.setName(name);
    copied.push(name);
  });

  // Apps Script auto-creates a blank "Sheet1" in every new spreadsheet —
  // remove it now that real tabs exist, so the archive isn't confusing.
  const defaultSheet = archive.getSheetByName("Sheet1");
  if(defaultSheet && archive.getSheets().length > 1){
    archive.deleteSheet(defaultSheet);
  }

  log("Copied " + copied.length + " tab(s): " + copied.join(", "));
  if(skipped.length){
    log("Could not find " + skipped.length + " tab(s) (already gone?): " + skipped.join(", "));
  }
  log("");
  log("New archive spreadsheet: " + archive.getUrl());
  log("");
  log("Open that link and check everything looks right BEFORE running deleteArchivedOldManualSheets().");
  log("===== END =====");

  return out.join("\n");
}


/* ============================================
   DELETE ARCHIVED OLD MANUAL TABS (one-time)
   Only run this AFTER opening the archive spreadsheet from
   archiveOldManualSheets() above and confirming everything
   copied correctly. This deletes those same tabs from the
   MAIN spreadsheet — the data lives on in the archive copy.
============================================ */
function deleteArchivedOldManualSheets(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  const TABS_TO_DELETE = [
    "Categories","Config","CategoryBudgets","Budget",
    "Track exp","60k account","Aug CC bill","Sep CC bil"
  ];

  log("===== DELETING OLD MANUAL TABS FROM THE MAIN SHEET =====");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const deleted = [];
  const skipped = [];

  TABS_TO_DELETE.forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if(!sheet){
      skipped.push(name);
      return;
    }
    ss.deleteSheet(sheet);
    deleted.push(name);
  });

  log("Deleted " + deleted.length + " tab(s): " + deleted.join(", "));
  if(skipped.length){
    log("Already gone / not found: " + skipped.join(", "));
  }
  log("===== END =====");

  return out.join("\n");
}


/* ============================================
   CATEGORY DROPDOWN VALIDATION FIX (added 2026-09-15)
   Real bug found 2026-09-15: the Transactions sheet's Category column
   (N) had a dropdown (Data Validation) whose list of allowed words came
   from the old "Categories" helper tab. That tab got archived (moved to
   a separate spreadsheet) on 2026-09-05 as part of the pre-multi-user
   cleanup — nothing in this app's own code ever reads that tab, so the
   cleanup correctly saw it as safe to move, but missed that the Sheet's
   own dropdown (a plain Google Sheets feature, invisible from any code
   file) was still quietly pointing at it. Once "Categories" left, the
   dropdown's list broke — since then, EVERY category the app tried to
   save into that column was silently rejected by Google Sheets' own
   strict validation (a red warning triangle, blank cell), even though
   the app's own save code (saveTransactionNote, PWA.js) was working
   correctly the whole time.

   Run by hand from the Apps Script editor, once. Re-creates the
   dropdown using a fixed, hardcoded list (the same 10 categories the
   app itself already offers in index.html's CATEGORY_OPTIONS) instead
   of a fragile reference to another sheet, so this can't break again
   just because an unrelated cleanup moves a tab around. Also sets
   "allow invalid data" (shows a warning triangle instead of silently
   blocking the write) as a safety net — so a future mismatch would be
   visible, not another silent data loss.
============================================ */
function fixCategoryColumnValidation(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  if(!sheet) return "Transactions tab not found — nothing to do.";

  const CATEGORY_LIST = [
    "Food", "Transport", "Bills", "Shopping", "Lifestyle",
    "Financial", "Income", "Education", "Health", "Other"
  ];

  const lastRow = Math.max(sheet.getLastRow(), 2);
  const range = sheet.getRange(2, 14, lastRow - 1, 1); // column N, every data row

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORY_LIST, true)
    .setAllowInvalid(true) // warn, never silently block a write again
    .build();

  range.setDataValidation(rule);

  return "Done — the Category column (N) now uses a fixed 10-item list " +
    "built into this script, no longer a link to another sheet. " +
    "Existing category values were not touched.";
}


/* ============================================
   MISSING CATEGORY BACKFILL (added 2026-09-15)
   Fixes the DATA left behind by the broken dropdown above — every
   transaction saved between 2026-09-05 and whenever
   fixCategoryColumnValidation() is run has a real Note (it went through
   Pending normally) but an empty Category, because the write was
   silently rejected. Run previewMissingCategories() FIRST (read-only,
   changes nothing) to see exactly what it would fill in; only run
   backfillMissingCategories() once that list looks right. Reuses the
   app's own real suggestion engine (getSuggestedCategoryFast, PWA.js) —
   the same guess Pending would have shown at the time — so this isn't a
   new, separate guess, it's the same logic already trusted elsewhere.
   Never touches a row that already has a Category. A confirmed Rent/
   EMI/Investment row gets "Financial" instead of a guessed spending
   category, matching what the app itself would have written (see
   updateCategoryVisibility in index.html).
============================================ */
function previewMissingCategories(){
  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Transactions");
  if(!sheet) return "Transactions tab not found.";

  const data = sheet.getDataRange().getValues();
  const smartMemorySheet = ss.getSheetByName("SmartMemory");
  const smartMemoryData = smartMemorySheet ? smartMemorySheet.getDataRange().getValues() : [];
  // Learned from YOUR own labelled notes (noteWordModel.js): "cab" -> Transport,
  // "milk" -> Food, etc. Only trusted for words with a clear track record in
  // the last ~4 months. Added 2026-10-11 after the shop-name guesser sent 24
  // of 59 obvious payments ("Lunch", "Cab", "Fruits") to "Other".
  const noteModel = buildNoteWordModel_(data, 13, NOTE_MODEL_CATEGORIES_, new Date(Date.now() - 120 * 86400000));

  log("===== CATEGORIES THIS WOULD FILL IN (nothing written yet) =====");
  log("");

  let count = 0;
  for(let i = 1; i < data.length; i++){
    const note      = (data[i][12] || "").toString().trim(); // column M
    const category  = (data[i][13] || "").toString().trim(); // column N
    if(!note || category) continue; // only rows with a note but no category

    const mode            = data[i][4]  || ""; // column E
    const txnType         = (data[i][3] || "").toString().trim().toLowerCase(); // column D: debit / credit
    const amount           = Number(data[i][5]) || 0; // column F
    const counterparty     = data[i][7]  || ""; // column H
    const financialEvent   = (data[i][17] || "").toString().trim(); // column R

    // A confirmed Rent/EMI/Investment row, OR a lending note ("lent"/
    // "borrowed"/"paid back") gets "Financial" — matches what the app
    // itself would write for either case (see updateCategoryVisibility,
    // index.html, added 2026-09-15 for lending), not a guessed spending
    // category that's never actually used for these anyway.
    // Added 2026-10-11: money COMING IN with "salary" in the note is Income.
    // Found when a Rs.45,000 salary row had its note but no category, which
    // made that whole month's income show as zero in the reports. The
    // spending-category guesser below is built for purchases and has no
    // idea what a salary is.
    const suggested = (financialEvent || isLendingTransfer(counterparty, note))
      ? "Financial"
      : (txnType === "credit" && /\bsalary\b/i.test(note))
        ? "Income"
        : (predictFromNoteWords_(noteModel, note) || getSuggestedCategoryFast(counterparty, amount, mode, smartMemoryData));
    count++;
    log("- Row " + (i + 1) + ": \"" + note + "\" (" + (counterparty || "no counterparty") + ", Rs." + amount + ") -> " + suggested);
  }

  log("");
  log(count === 0
    ? "Nothing to fix — every noted transaction already has a category."
    : count + " row(s) would be filled in. Review the list above, then run backfillMissingCategories() to actually write them.");

  return out.join("\n");
}

function backfillMissingCategories(){
  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Transactions");
  if(!sheet) return "Transactions tab not found.";

  const data = sheet.getDataRange().getValues();
  const smartMemorySheet = ss.getSheetByName("SmartMemory");
  const smartMemoryData = smartMemorySheet ? smartMemorySheet.getDataRange().getValues() : [];
  // Learned from YOUR own labelled notes (noteWordModel.js): "cab" -> Transport,
  // "milk" -> Food, etc. Only trusted for words with a clear track record in
  // the last ~4 months. Added 2026-10-11 after the shop-name guesser sent 24
  // of 59 obvious payments ("Lunch", "Cab", "Fruits") to "Other".
  const noteModel = buildNoteWordModel_(data, 13, NOTE_MODEL_CATEGORIES_, new Date(Date.now() - 120 * 86400000));

  let count = 0;
  for(let i = 1; i < data.length; i++){
    const note      = (data[i][12] || "").toString().trim(); // column M
    const category  = (data[i][13] || "").toString().trim(); // column N
    if(!note || category) continue; // only rows with a note but no category

    const mode            = data[i][4]  || ""; // column E
    const txnType         = (data[i][3] || "").toString().trim().toLowerCase(); // column D: debit / credit
    const amount           = Number(data[i][5]) || 0; // column F
    const counterparty     = data[i][7]  || ""; // column H
    const financialEvent   = (data[i][17] || "").toString().trim(); // column R

    // Added 2026-10-11: money COMING IN with "salary" in the note is Income.
    // Found when a Rs.45,000 salary row had its note but no category, which
    // made that whole month's income show as zero in the reports. The
    // spending-category guesser below is built for purchases and has no
    // idea what a salary is.
    const suggested = (financialEvent || isLendingTransfer(counterparty, note))
      ? "Financial"
      : (txnType === "credit" && /\bsalary\b/i.test(note))
        ? "Income"
        : (predictFromNoteWords_(noteModel, note) || getSuggestedCategoryFast(counterparty, amount, mode, smartMemoryData));

    sheet.getRange(i + 1, 14).setValue(suggested); // column N
    count++;
    log("- Row " + (i + 1) + ": \"" + note + "\" -> " + suggested);
  }

  log("");
  log(count + " row(s) filled in. Spot-check a few in the app's History screen — anything wrong is a one-tap fix there.");

  return out.join("\n");
}