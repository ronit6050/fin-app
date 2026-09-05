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
   ADD MISSING HEADER ROWS (one-time, added 2026-09-05)
   Run by hand from the Apps Script editor. TypeVotes,
   NoteMemory and FinancialEvents were each found to be
   missing their header row on the live sheet — every
   function that reads these sheets always skips row 1
   assuming it's a header, so on these 3 sheets the real
   first data row has been silently invisible to the app.
   This inserts the correct header row at the very top of
   each (shifting existing data down by one row, nothing
   is deleted or changed) so that first row becomes
   visible again. Safe to run more than once — a sheet
   that already has the right header is left alone.
============================================ */
function addMissingHeaderRows(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  const EXPECTED = {
    "TypeVotes":       ["Merchant", "AmountBand", "Type", "Timestamp"],
    "NoteMemory":      ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    "FinancialEvents": ["Type", "Amount", "Counterparty", "Confirmed", "Name"]
  };

  log("===== ADDING MISSING HEADER ROWS =====");
  log("");

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(EXPECTED).forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if(!sheet){
      log("- \"" + name + "\": tab not found, skipped.");
      return;
    }

    const headerRow = EXPECTED[name];
    const firstCell = sheet.getRange(1, 1).getValue();

    if(firstCell === headerRow[0]){
      log("- \"" + name + "\": already has the right header, left alone.");
      return;
    }

    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    log("- \"" + name + "\": header row added. The row that used to be row 1 is now row 2, and will be read correctly from now on.");
  });

  log("");
  log("===== END =====");

  return out.join("\n");
}


/* ============================================
   ADD MISSING TRANSACTIONS COLUMN LABELS (one-time,
   added 2026-09-05). Run by hand from the Apps Script
   editor. The Transactions sheet has a real, correct
   header row already (unlike the 3 sheets above) — but
   columns Q, R, S were never given a label even though
   the code has been writing real data into them
   (NeedWantSaving, FinancialEvent, FinancialEventName).
   This is NOT a functional bug — the code always reads
   these by fixed column position, never by header name —
   just a documentation gap. Safe to run more than once;
   only fills in a cell that's currently blank.
============================================ */
function addMissingTransactionColumnHeaders(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  log("===== ADDING MISSING TRANSACTIONS COLUMN LABELS =====");
  log("");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  if(!sheet){
    log("Transactions tab not found — nothing to do.");
    log("===== END =====");
    return out.join("\n");
  }

  // column (1-based), expected label
  const EXPECTED = [
    [17, "NeedWantSaving"],
    [18, "FinancialEvent"],
    [19, "FinancialEventName"]
  ];

  EXPECTED.forEach(([col, label]) => {
    const cell = sheet.getRange(1, col);
    if((cell.getValue() || "").toString().trim() !== ""){
      log("- Column " + col + ": already has a label (\"" + cell.getValue() + "\"), left alone.");
      return;
    }
    cell.setValue(label);
    log("- Column " + col + ": labeled \"" + label + "\".");
  });

  log("");
  log("===== END =====");

  return out.join("\n");
}