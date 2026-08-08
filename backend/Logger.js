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