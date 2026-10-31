/* ============================================
   CREDIT CARD PROCESSOR (FINAL CLEAN VERSION)
   - NO DRIVE CONVERSION
   - HANDLES HTML + CSV
============================================ */

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