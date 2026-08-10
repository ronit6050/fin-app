const SHEET_ID = "1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw";

const TRANSACTION_SHEET = "Transactions";
const LOG_SHEET = "Logs";

// The Gemini key used to live here as plain text — anyone who could see
// this file (e.g. on GitHub) could read it and use it. Moved to "Script
// Properties" instead (Project Settings -> Script Properties in the Apps
// Script editor), a private settings area that never gets committed to
// git — same place the main backend already keeps its own Gemini key.
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY") || "";

function doPost(e){

  let sms = "";
  let sender = "";
  let timestamp = "";
  let raw = "";

  try{

    raw = e.postData ? e.postData.contents : "";

    sms = e.parameter?.sms || "";
    sender = e.parameter?.sender || "";
    timestamp = e.parameter?.timestamp || "";

    logWebhook(sender,sms,raw,"RECEIVED");

    if(!isTransactionSMS(sms,sender)){

      logWebhook(sender,sms,raw,"NOT TRANSACTION");
      return ContentService.createTextOutput("IGNORED");

    }

    let tx = ruleParser(sms,sender);

    logWebhook(sender,sms,raw,"RULE PARSED");

    if(shouldUseAI(tx)){

      const aiResult = verifyWithAI(sms,tx);

      if(aiResult){
        tx = {...tx,...aiResult};
        logWebhook(sender,sms,raw,"AI USED");
      }
      else{
        logWebhook(sender,sms,raw,"AI FAILED");
      }

    }

    if(!isDuplicate(tx.reference)){

      saveTransaction(tx,sms,sender,timestamp);
      logWebhook(sender,sms,raw,"TRANSACTION SAVED");

    }
    else{

      logWebhook(sender,sms,raw,"DUPLICATE IGNORED");

    }

  }
  catch(err){

    logWebhook(sender,sms,raw,"ERROR: "+err);

  }

  return ContentService.createTextOutput("OK");

}

function getSheet(name){
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function isTransactionSMS(sms,sender){

  const text = sms.toLowerCase();
  const s = sender.toUpperCase();

  const banks = ["HDFC","FED","SBI","ICICI","AXIS","KOTAK","YES","PAYTM"];

  let bankFound = false;

  for(let i=0;i<banks.length;i++){
    if(s.includes(banks[i])){
      bankFound = true;
      break;
    }
  }

  if(!bankFound) return false;

  // ❌ BLOCK NON-TRANSACTION PATTERNS
  if(text.includes("otp")) return false;
  if(text.includes("reward")) return false;
  if(text.includes("points")) return false;
  if(text.includes("cashback")) return false;
  if(text.includes("emi")) return false;
  if(text.includes("offer")) return false;

  // ❌ BLOCK CREDIT CARD PAYMENT CONFIRMATIONS
  if(
    text.includes("credit card") &&
    text.includes("payment") &&
    text.includes("received")
  ){
    return false;
  }

  const debitWords = [
    "debited",
    "spent",
    "deducted",
    "withdrawn",
    "sent"
  ];

  const creditWords = [
    "credited",
    "received",
    "refund",
    "deposited"
  ];

  // ✅ REAL DEBIT TRANSACTIONS
  for(let i=0;i<debitWords.length;i++){
    if(text.includes(debitWords[i])){
      return true;
    }
  }

  // ✅ REAL CREDIT TRANSACTIONS
  for(let i=0;i<creditWords.length;i++){
    if(text.includes(creditWords[i])){
      return true;
    }
  }

  // ✅ HDFC style: "Txn Rs..."
  if(
    text.includes("txn") &&
    (text.includes("card") || text.includes("upi") || text.includes("atm"))
  ){
    return true;
  }

  // ❌ BLOCK FUTURE ALERTS (like "will be debited")
  if(text.includes("will be debited")){
    return false;
  }

  return false;

}

function ruleParser(sms,sender){

  const text = sms.toLowerCase();

  let obj = {};

  // ✅ IMPROVED AMOUNT DETECTION (handles INR.89.00)
  let amt =
    text.match(/rs\.?\s?([\d,]+\.?\d*)/i) ||
    text.match(/inr\.?\s?([\d,]+\.?\d*)/i) ||  // <-- FIX HERE
    text.match(/₹\s?([\d,]+\.?\d*)/i);

  if(amt){
    obj.amount = amt[1].replace(/,/g,"");
  }

  if(text.includes("debited") || text.includes("spent") || text.includes("deducted") || text.includes("sent") || text.includes("txn"))
      obj.type = "debit";

  if(text.includes("credited") || text.includes("received") || text.includes("refund"))
      obj.type = "credit";


  // MODE DETECTION (CARD PRIORITY)

  let cardMatch = text.match(/card\s*(\d{4})/i);

  if(cardMatch){

    obj.mode = "card " + cardMatch[1];

  }

  else if(text.includes("wallet") || text.includes("payzapp")){

    obj.mode = "wallet";

  }

  else if(text.includes("upi") || text.includes("vpa")){

    obj.mode = "upi";

  }

  else if(text.includes("atm")){

    obj.mode = "atm";

  }

  else if(text.includes("neft")){

    obj.mode = "neft";

  }

  else{

    obj.mode = "other";

  }


  // BANK DETECTION

  const s = sender.toUpperCase();

  if(s.includes("HDFC"))
      obj.bank = "HDFC";

  if(s.includes("FED"))
      obj.bank = "FEDERAL";

  if(s.includes("SBI"))
      obj.bank = "SBI";

  if(s.includes("ICICI"))
      obj.bank = "ICICI";

  if(s.includes("AXIS"))
      obj.bank = "AXIS";


  // REFERENCE DETECTION

  let ref = text.match(/ref[:\s]?(\d{6,})/i);

  if(!ref) ref = text.match(/upi\s(\d{6,})/i);
  if(!ref) ref = text.match(/utr[:\s]?(\d{6,})/i);
  if(!ref) ref = text.match(/txn\s?id[:\s]?(\d{6,})/i);

  if(ref)
      obj.reference = ref[1];


  // COUNTERPARTY DETECTION

  let name = text.match(/to\s([a-z0-9\s\.@_-]+)/i);

  if(!name){
    name = text.match(/at\s([a-z0-9\s\.@_-]+)/i);
  }

  if(!name){
    name = text.match(/towards\s([a-z0-9\s\.@_-]+)/i);
  }

  if(!name){
    name = text.match(/for\s([a-z0-9\s\.@_-]+)/i); // <-- NEW (handles "for youtube")
  }

  if(name)
      obj.counterparty = cleanCounterparty(name[1]);

  return obj;

}

function cleanCounterparty(name){

  name = name.replace(/ref.*/i,"");
  name = name.replace(/upi.*/i,"");
  name = name.replace(/@.*/i,"");
  name = name.replace(/\d+.*/i,"");
  name = name.replace(/[^a-zA-Z0-9\s]/g,"");

  return name.trim();

}

function shouldUseAI(tx){

  if(!tx.counterparty) return true;
  if(tx.counterparty.includes("@")) return true;
  if(tx.counterparty.length > 25) return true;
  if(!tx.reference) return true;

  return false;

}

function verifyWithAI(sms,tx){

  if(GEMINI_API_KEY)
    return callGemini(sms,tx);

  if(OPENAI_API_KEY)
    return callChatGPT(sms,tx);

  return null;

}

function callGemini(sms,tx){

  try{

    const prompt = `
SMS:
${sms}

Parser result:
${JSON.stringify(tx)}

Return corrected JSON only:

{
"counterparty":"",
"reference":""
}
`;

    const payload = {
      contents:[{
        parts:[{text:prompt}]
      }]
    };

    const options = {
      method:"post",
      contentType:"application/json",
      payload:JSON.stringify(payload)
    };

    const response = UrlFetchApp.fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+GEMINI_API_KEY,
      options
    );

    const res = JSON.parse(response.getContentText());

    let text = res.candidates[0].content.parts[0].text;

    text = text.replace(/```json/g,'').replace(/```/g,'');

    const json = text.match(/\{[\s\S]*\}/);

    if(json)
      return JSON.parse(json[0]);

  }catch(e){}

  return null;

}

function isDuplicate(reference){

  if(!reference) return false;

  const sheet = getSheet(TRANSACTION_SHEET);

  const lastRow = sheet.getLastRow();

  if(lastRow < 2) return false;

  const refs = sheet.getRange(2,7,lastRow-1,1).getValues();

  for(let i=0;i<refs.length;i++){

    if(refs[i][0] == reference)
      return true;

  }

  return false;

}

function saveTransaction(data,sms,sender,timestamp){

  const sheet = getSheet(TRANSACTION_SHEET);

  let date;

  if(timestamp)
    date = new Date(Number(timestamp)*1000);
  else
    date = new Date();

  sheet.appendRow([

    Utilities.formatDate(date,"IST","yyyy-MM-dd"),
    Utilities.formatDate(date,"IST","HH:mm:ss"),

    data.bank || "",
    data.type || "",
    data.mode || "",
    data.amount || "",
    data.reference || "",
    data.counterparty || "",

    "SMS",
    "Tasker",
    sms,
    sender

  ]);

}

function logWebhook(sender,sms,raw,status){

  const sheet = getSheet(LOG_SHEET);

  sheet.appendRow([
    new Date(),
    sender,
    sms,
    raw,
    status
  ]);

}