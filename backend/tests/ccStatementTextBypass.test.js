// backend/tests/ccStatementTextBypass.test.js
//
// Plain-English what this checks: reconcileCreditCardStatementPreview()
// was rebuilt 2026-08-25 (same day it first shipped) to prefer text
// already extracted client-side (by pdf.js, in the browser, before
// upload — see index.html's extractPdfTextClientSide) over the old
// server-side Drive OCR path. The OCR path turned out unreliable on the
// user's real statement (only found 8 of 16 real transaction lines) and
// tripped both a Drive API rate limit and a missing Google Docs
// permission on its very first live use — all sidestepped entirely when
// statementText is already provided, since Drive/DriveApp are never
// touched at all in that case.
//
// This test proves:
//   1. When statementText is provided, DriveApp.createFile is NEVER
//      called — proves the OCR/Drive path is genuinely skipped, not
//      just unused by coincidence.
//   2. The statementText path still runs through parseCreditCardStatementText
//      + previewReconciliation and returns correct, real results.
//   3. When statementText is NOT provided and the file is a .pdf, it
//      still falls back to the OCR path (extractTextFromStatementPdf) —
//      this is a real, load-bearing fallback for a genuinely scanned/
//      image-only PDF or an older cached frontend, not dead code.
//   4. An .xls file is completely unaffected either way — same
//      Sheet-conversion path as before, statementText never even checked.
//
// Run with: node backend/tests/ccStatementTextBypass.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(condition, message){
  if(!condition){
    console.error("FAIL: " + message);
    process.exitCode = 1;
  } else {
    console.log("PASS: " + message);
  }
}

function assertEqual(actual, expected, message){
  assert(actual === expected, message + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

function loadSandbox(){
  const calls = { driveAppCreateFile: 0, driveFilesCopy: 0, documentAppOpenById: 0 };

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function(){
        return {
          getSheetByName: function(name){
            if(name === "Transactions"){
              return { getDataRange: function(){ return { getValues: function(){ return [["Date","Time","Bank","Type","Mode","Amount","Reference","Counterparty","I","J","K","L","Note","Category","O","Processed","NeedWantSaving"]]; } }; } };
            }
            return null;
          }
        };
      },
      openById: function(){ return { getSheets: function(){ return [{ getDataRange: function(){ return { getValues: function(){ return [["Date","Description","Amount"],["19/07/2026","Test Merchant","100.00"]]; } }; } }]; } }; }
    },
    DriveApp: {
      createFile: function(){ calls.driveAppCreateFile++; return { getId: function(){ return "fake-drive-id"; } }; },
      getFileById: function(){ return { setTrashed: function(){} }; }
    },
    Drive: {
      Files: {
        copy: function(resource){
          calls.driveFilesCopy++;
          // Distinguish the OCR call (mimeType GOOGLE_DOCS) from the
          // xls-to-sheets conversion call (mimeType GOOGLE_SHEETS).
          return { id: "fake-copy-id", mimeType: resource.mimeType };
        }
      }
    },
    DocumentApp: {
      openById: function(){
        calls.documentAppOpenById++;
        return { getBody: function(){ return { getText: function(){
          return "23/07/2026| 21:25 UPI-OCR FALLBACK MERCHANT C 999.00 l";
        } }; } };
      }
    },
    Utilities: {
      newBlob: function(){ return {}; },
      base64Decode: function(){ return []; },
      sleep: function(){},
      formatDate: function(date){
        const d = new Date(date);
        return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
      }
    },
    MimeType: { PDF: "application/pdf", MICROSOFT_EXCEL: "application/vnd.ms-excel", GOOGLE_SHEETS: "application/vnd.google-apps.spreadsheet", GOOGLE_DOCS: "application/vnd.google-apps.document" },
    Session: { getScriptTimeZone: function(){ return "UTC"; } },
    Logger: { log: function(){} },
    logAI: function(){}, // Logger.js's real helper — mocked directly so a real error's message isn't masked by "logAI is not defined"
    console: console
  };
  vm.createContext(sandbox);

  ["category.js", "needWantSaving.js", "Credit Card.js", "PWA.js", "Recon.js"].forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  sandbox.__calls = calls;
  return sandbox;
}

// ---------------------------------------------------------------------
// 1 & 2. statementText provided — Drive/Docs never touched, real result.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  const realStatementText = "23/07/2026| 21:25 UPI-HI TECH AUTO SERVICE C 523.59 l\n27/07/2026| 06:38 UPI-AIRTEL PAYMENTS BANK LIMI C 488.82 l";

  const result = sandbox.reconcileCreditCardStatementPreview(null, "statement.pdf", realStatementText);

  assertEqual(sandbox.__calls.driveAppCreateFile, 0, "DriveApp.createFile was NEVER called — the OCR/Drive path is genuinely skipped when statementText is provided");
  assertEqual(sandbox.__calls.driveFilesCopy, 0, "Drive.Files.copy was NEVER called either");
  assertEqual(sandbox.__calls.documentAppOpenById, 0, "DocumentApp.openById was NEVER called");
  assertEqual(result.ok, true, "returns ok:true");
  assertEqual(result.total, 2, "correctly parsed both real transaction lines from statementText");
})();

// ---------------------------------------------------------------------
// 3. No statementText, .pdf file — falls back to the OCR path for real.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  const result = sandbox.reconcileCreditCardStatementPreview("ZmFrZQ==", "statement.pdf", null);

  assertEqual(sandbox.__calls.driveAppCreateFile, 1, "DriveApp.createFile WAS called — the OCR fallback path is real, not dead code");
  assertEqual(sandbox.__calls.documentAppOpenById, 1, "DocumentApp.openById WAS called as part of the OCR fallback");
  assertEqual(result.ok, true, "OCR fallback still returns ok:true");
  assertEqual(result.total, 1, "correctly parsed the OCR fallback's one transaction line");
})();

// ---------------------------------------------------------------------
// 4. .xls file — completely unaffected, statementText irrelevant.
// ---------------------------------------------------------------------
(function(){
  const sandbox = loadSandbox();
  const result = sandbox.reconcileCreditCardStatementPreview("ZmFrZQ==", "statement.xls", null);

  assertEqual(sandbox.__calls.documentAppOpenById, 0, "DocumentApp/OCR was never touched for an .xls file");
  assertEqual(sandbox.__calls.driveFilesCopy, 1, "Drive.Files.copy WAS called once, for the xls-to-Sheets conversion (unchanged behavior)");
  assertEqual(result.ok, true, ".xls path still returns ok:true");
  assertEqual(result.total, 1, ".xls path still correctly parses its one test row");
})();

console.log("\nDone.");
