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


/* ============================================
   DATA HEALTH CHECK (read-only, added 2026-09-05)
   Run by hand from the Apps Script editor. Scans the
   WHOLE dataset in every active sheet for the kind of
   thing that causes "something feels off" — inconsistent
   spellings/casing in a column that should only ever hold
   a few fixed values, a number accidentally saved as text
   (which can silently break math elsewhere), a date saved
   as text, a Reference number that shows up on more than
   one Transactions row (a possible double-logged
   transaction), and blank fields that should never be
   blank. Reports counts and a few example row numbers —
   never dumps full rows — so it's safe to copy/paste back
   even though this touches real financial data. Changes
   nothing.
============================================ */
function checkDataHealth(){

  const out = [];
  const log = (s) => { out.push(s); Logger.log(s); };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetDataCache = {};
  function getData(name){
    if(!(name in sheetDataCache)){
      const sheet = ss.getSheetByName(name);
      sheetDataCache[name] = sheet ? sheet.getDataRange().getValues() : null;
    }
    return sheetDataCache[name];
  }

  log("===== DATA HEALTH CHECK =====");
  log("(Read-only — this changes nothing, just reports.)");
  log("");

  log("--- 1) Value consistency (columns that should only ever hold a few fixed values) ---");
  const ENUM_CHECKS = [
    { sheet: "Transactions", col: 4,  label: "Type",           expected: ["debit","credit"] },
    { sheet: "Transactions", col: 16, label: "Processed",      expected: ["YES",""] },
    { sheet: "Transactions", col: 17, label: "NeedWantSaving", expected: ["Need","Want","Saving","Investment",""] },
    { sheet: "Transactions", col: 18, label: "FinancialEvent", expected: ["Rent","EMI","Investment",""] },
    { sheet: "Cash",         col: 4,  label: "Type",           expected: ["debit","credit"] },
    { sheet: "Debts",        col: 3,  label: "Type",           expected: ["LENT","BORROWED"] },
    { sheet: "Debts",        col: 7,  label: "Status",         expected: ["Pending","Settled"] },
    { sheet: "Goals",        col: 2,  label: "Type",           expected: ["OneTime","Recurring"] },
    { sheet: "Goals",        col: 4,  label: "Status",         expected: ["Active","Done"] },
    { sheet: "Savings",      col: 3,  label: "Type",           expected: ["auto","manual","withdraw"] },
    { sheet: "InvestmentInstruments", col: 2, label: "Category", expected: ["SIP","One-time Fund","Stock","Gold"] },
    { sheet: "Budgets",      col: 3,  label: "Type",           expected: ["","Need","Want"] }
  ];

  ENUM_CHECKS.forEach((check) => {
    const data = getData(check.sheet);
    if(!data){ log("- " + check.sheet + "." + check.label + ": tab not found, skipped."); return; }
    const tally = {};
    for(let i = 1; i < data.length; i++){
      const raw = data[i][check.col - 1];
      const val = (raw === null || raw === undefined) ? "" : raw.toString().trim();
      tally[val] = (tally[val] || 0) + 1;
    }
    const values = Object.keys(tally);
    const unexpected = values.filter((v) => check.expected.indexOf(v) === -1);
    if(unexpected.length === 0){
      log("- " + check.sheet + "." + check.label + ": OK — only expected values found (" +
        values.map((v) => (v === "" ? "blank" : v) + ":" + tally[v]).join(", ") + ").");
    } else {
      log("- " + check.sheet + "." + check.label + ": UNEXPECTED VALUE(S) FOUND — " +
        unexpected.map((v) => "\"" + v + "\" (" + tally[v] + " row(s))").join(", ") +
        " — expected only: " + check.expected.map((v) => v === "" ? "blank" : v).join(" / "));
    }
  });

  log("");
  log("--- 1b) Transactions.Mode (no fixed list — just showing what's actually there) ---");
  {
    const data = getData("Transactions");
    if(data){
      const tally = {};
      for(let i = 1; i < data.length; i++){
        const val = (data[i][4] || "").toString().trim();
        tally[val] = (tally[val] || 0) + 1;
      }
      const sorted = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
      log("  " + sorted.map((v) => (v === "" ? "blank" : v) + ":" + tally[v]).join(", "));
    }
  }

  log("");
  log("--- 2) Numbers accidentally stored as text (can silently break totals/math) ---");
  const NUMBER_CHECKS = [
    { sheet: "Transactions", col: 6, label: "Amount" },
    { sheet: "Cash", col: 5, label: "Amount" },
    { sheet: "Debts", col: 4, label: "Amount" },
    { sheet: "Savings", col: 2, label: "Amount" },
    { sheet: "Investments", col: 3, label: "Amount" },
    { sheet: "Budgets", col: 4, label: "Target" },
    { sheet: "FinancialEvents", col: 2, label: "Amount" }
  ];
  NUMBER_CHECKS.forEach((check) => {
    const data = getData(check.sheet);
    if(!data){ log("- " + check.sheet + "." + check.label + ": tab not found, skipped."); return; }
    const badRows = [];
    for(let i = 1; i < data.length; i++){
      const raw = data[i][check.col - 1];
      if(raw === "" || raw === null || raw === undefined) continue;
      if(typeof raw !== "number" && badRows.length < 10) badRows.push(i + 1);
    }
    log("- " + check.sheet + "." + check.label + ": " +
      (badRows.length === 0 ? "OK, all real numbers." :
        badRows.length + " row(s) stored as TEXT instead of a number — e.g. row(s) " + badRows.join(", ") + "."));
  });

  log("");
  log("--- 3) Dates accidentally stored as text ---");
  const DATE_CHECKS = [
    { sheet: "Transactions", col: 1, label: "Date" },
    { sheet: "Cash", col: 2, label: "Date" },
    { sheet: "Debts", col: 1, label: "Date" },
    { sheet: "Savings", col: 1, label: "Date" },
    { sheet: "Investments", col: 1, label: "Date" },
    { sheet: "FinancialEvents", col: 4, label: "Confirmed" },
    { sheet: "TypeVotes", col: 4, label: "Timestamp" },
    { sheet: "NoteMemory", col: 5, label: "LastUsed" },
    { sheet: "SmartMemory", col: 6, label: "LastUsed" },
    { sheet: "AILogs", col: 1, label: "Timestamp" }
  ];
  DATE_CHECKS.forEach((check) => {
    const data = getData(check.sheet);
    if(!data){ log("- " + check.sheet + "." + check.label + ": tab not found, skipped."); return; }
    const badRows = [];
    for(let i = 1; i < data.length; i++){
      const raw = data[i][check.col - 1];
      if(raw === "" || raw === null || raw === undefined) continue;
      if(!(raw instanceof Date) && badRows.length < 10) badRows.push(i + 1);
    }
    log("- " + check.sheet + "." + check.label + ": " +
      (badRows.length === 0 ? "OK, all real dates." :
        badRows.length + " row(s) stored as TEXT instead of a real date — e.g. row(s) " + badRows.join(", ") + "."));
  });

  log("");
  log("--- 4) Duplicate Reference numbers on Transactions (possible double-logged transaction) ---");
  {
    const data = getData("Transactions");
    if(data){
      const seen = {};
      for(let i = 1; i < data.length; i++){
        const ref = (data[i][6] || "").toString().trim();
        if(!ref || ref.indexOf("NOREF_") === 0) continue;
        if(!seen[ref]) seen[ref] = [];
        seen[ref].push(i + 1);
      }
      const dupes = Object.keys(seen).filter((ref) => seen[ref].length > 1);
      if(dupes.length === 0){
        log("- OK, no real Reference number appears on more than one row.");
      } else {
        log("- FOUND " + dupes.length + " Reference number(s) appearing on more than one row:");
        dupes.slice(0, 10).forEach((ref) => {
          log("    Reference " + ref + " -> row(s) " + seen[ref].join(", "));
        });
      }
    }
  }

  log("");
  log("--- 5) Blank fields that shouldn't be blank ---");
  {
    const data = getData("Transactions");
    if(data){
      const blankAmount = [], blankType = [];
      for(let i = 1; i < data.length; i++){
        const amount = data[i][5];
        const type = (data[i][3] || "").toString().trim();
        if((amount === "" || amount === null || amount === undefined || Number(amount) === 0) && blankAmount.length < 10) blankAmount.push(i + 1);
        if(!type && blankType.length < 10) blankType.push(i + 1);
      }
      log("- Transactions with a blank/zero Amount: " + blankAmount.length +
        (blankAmount.length ? " — e.g. row(s) " + blankAmount.join(", ") : ""));
      log("- Transactions with a blank Type (debit/credit): " + blankType.length +
        (blankType.length ? " — e.g. row(s) " + blankType.join(", ") : ""));
    }
  }

  log("");
  log("===== END DATA HEALTH CHECK — copy everything above and share it =====");

  return out.join("\n");
}