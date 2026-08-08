/* ============================================
   CREDIT CARD PROCESSOR (FINAL CLEAN VERSION)
   - NO DRIVE CONVERSION
   - HANDLES HTML + CSV
============================================ */

/* ========= ENTRY POINT ========= */
function processCreditCardStatement(blob){

  Logger.log("🔥 NEW PARSER RUNNING");

  try{

    const content = blob.getDataAsString();

    // Detect HTML (fake Excel)
    if(content.includes("<table")){
      return processHTMLExcel(content);
    }

    // Detect CSV
    if(content.includes(",")){
      return processCSV(content);
    }

    throw new Error("Unsupported file format");

  }catch(err){

    logAI("CC_PROCESS_ERROR", err.toString());
    return "❌ Failed: " + err.message;

  }

}


/* ========= HTML PARSER ========= */
function processHTMLExcel(html){

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi);

  if(!rows) throw new Error("No table found");

  const data = rows.map(row => {
    const cols = row.match(/<t[dh][\s\S]*?>(.*?)<\/t[dh]>/gi);
    return cols ? cols.map(c => c.replace(/<.*?>/g,"").trim()) : [];
  });

  return processParsedRows(data);
}


/* ========= CSV PARSER ========= */
function processCSV(csv){

  const rows = csv.split("\n").map(r => r.split(","));

  return processParsedRows(rows);
}


/* ========= CORE PROCESSOR ========= */
function processParsedRows(data){

  const headerIndex = findHeaderRow(data);
  const header = data[headerIndex];
  const colMap = mapColumns(header);

  const output = [];

  for(let i = headerIndex + 1; i < data.length; i++){

    const row = data[i];

    const rawDate = row[colMap.date];
    const description = row[colMap.desc];

    if(!rawDate || !description) continue;

    let amount = 0;
    let type = "Debit";

    if(colMap.amount !== undefined){
      amount = parseFloat(row[colMap.amount]) || 0;
    }else{
      const debit = parseFloat(row[colMap.debit]) || 0;
      const credit = parseFloat(row[colMap.credit]) || 0;

      if(debit > 0){
        amount = debit;
        type = "Debit";
      }else if(credit > 0){
        amount = credit;
        type = "Credit";
      }
    }

    if(amount === 0) continue;

    output.push({
      date: formatDate(rawDate),
      time: "",
      description: description,
      amount: amount,
      type: type,
      source: "HDFC_CC"
    });

  }

  saveCreditCardTransactions(output);

  return `✅ ${output.length} transactions processed`;

}


/* ========= HEADER DETECTION ========= */
function findHeaderRow(data){

  for(let i = 0; i < data.length; i++){

    const row = data[i].join(" ").toLowerCase();

    if(
      row.includes("date") &&
      (row.includes("description") || row.includes("narration")) &&
      (row.includes("amount") || row.includes("debit") || row.includes("credit"))
    ){
      return i;
    }
  }

  throw new Error("Header row not found");
}


/* ========= COLUMN MAP ========= */
function mapColumns(header){

  const map = {};

  header.forEach((col, i) => {

    const name = col.toString().toLowerCase();

    if(name.includes("date")) map.date = i;
    else if(name.includes("time")) map.time = i;
    else if(name.includes("description") || name.includes("narration")) map.desc = i;
    else if(name.includes("amount")) map.amount = i;
    else if(name.includes("debit")) map.debit = i;
    else if(name.includes("credit")) map.credit = i;

  });

  return map;
}


/* ========= SAVE ========= */
function saveCreditCardTransactions(data){

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Credit_Card");

  if(!sheet) throw new Error("Credit_Card sheet missing");

  if(!data.length) return;

  const existing = sheet.getDataRange().getValues();

  const existingSet = new Set(
    existing.map(r => `${r[0]}_${r[3]}_${r[2]}`)
  );

  const newRows = [];

  data.forEach(t => {

    const key = `${t.date}_${t.amount}_${t.description}`;

    if(!existingSet.has(key)){
      newRows.push([
        t.date,
        "",
        t.description,
        t.amount,
        t.type,
        t.source
      ]);
    }

  });

  if(!newRows.length) return;

  sheet.getRange(sheet.getLastRow()+1,1,newRows.length,newRows[0].length)
    .setValues(newRows);
}


/* ========= DATE FORMAT ========= */
function formatDate(dateVal){

  try{

    if(Object.prototype.toString.call(dateVal) === "[object Date]"){
      return Utilities.formatDate(dateVal, "IST", "yyyy-MM-dd");
    }

    if(typeof dateVal === "number"){
      const excelEpoch = new Date(1899, 11, 30);
      const realDate = new Date(excelEpoch.getTime() + dateVal * 86400000);
      return Utilities.formatDate(realDate, "IST", "yyyy-MM-dd");
    }

    if(typeof dateVal === "string"){

      const parts = dateVal.split(/[\/\-]/);

      if(parts.length === 3){
        let [d,m,y] = parts;
        if(d.length === 2 && m.length === 2){
          return `${y}-${m}-${d}`;
        }
      }
    }

    return dateVal;

  }catch(err){
    return dateVal;
  }

}