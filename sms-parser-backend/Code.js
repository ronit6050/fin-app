const SHEET_ID = "1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw";

// Bound to the same spreadsheet the main PWA backend reads/writes.
const TRANSACTION_SHEET = "Transactions";
const LOG_SHEET = "Logs";

// Redesigned from scratch 2026-08-27. What changed and why (plain
// English, so this stays understandable without re-reading old chat
// history):
//
// 1. AI (Gemini) verification was REMOVED from this path entirely.
//    This script decided by itself, deterministically, whether to save
//    money -- adding a probabilistic AI call into that decision was
//    never a good trade. Every rule below is a plain, readable
//    condition anyone can check by eye.
//
// 2. A message no longer only gets "save it" or "ignore it" -- there's
//    now a third outcome, UNCERTAIN: "this looks like it might be
//    real money, but doesn't match anything we recognize." Instead of
//    silently dropping it (the old behavior for anything unmatched),
//    it still gets saved to Transactions -- so it shows up in the
//    Pending screen for a human to look at -- with its Counterparty
//    field prefixed "NEEDS REVIEW:" so it's obvious at a glance. This
//    is what makes the whole system self-adapting to a new bank, a new
//    wallet app, or a wording change, without needing a code patch
//    every single time.
//
// 3. Duplicate detection was rebuilt to fix a real bug found live on
//    2026-08-26 (the Tasker weekly resync inserted transactions that
//    were already in the Sheet). The old check only ever compared
//    reference numbers -- but a transaction recovered via credit-card
//    statement reconciliation is saved with a placeholder reference
//    like "NOREF_47" (real reference unknown from a statement alone),
//    so when the REAL SMS for that same transaction later arrived via
//    resync, it never matched and got inserted as a second row.
//    See isDuplicate() below for the full three-tier fix -- it's
//    deliberately narrow, because a blunter "same day + same amount"
//    fallback would cause a DIFFERENT bug: two separate real purchases
//    on the same day for the same amount (this happens for real, e.g.
//    two Zomato orders) would wrongly look like duplicates of each
//    other.

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

    const classification = classifySms(sms,sender);

    if(classification === "IGNORE"){

      logWebhook(sender,sms,raw,"NOT TRANSACTION");
      return ContentService.createTextOutput("IGNORED");

    }

    let tx = ruleParser(sms,sender);

    if(classification === "UNCERTAIN"){

      // Don't guess, don't drop it -- surface it. The raw SMS text is
      // still preserved in full in the Transactions row itself (the
      // RawSMS column), so nothing about the original message is lost,
      // even if amount/type/counterparty extraction below turns out
      // incomplete for this one.
      tx.uncertain = true;
      tx.counterparty = "NEEDS REVIEW: " + (tx.counterparty || "unrecognized message");
      logWebhook(sender,sms,raw,"UNCERTAIN - NEEDS REVIEW");

    }
    else{

      logWebhook(sender,sms,raw,"RULE PARSED");

    }

    // Added 2026-08-26 -- real bug found live: the weekly resync job
    // (Tasker resending a batch of past SMS to catch anything the
    // real-time listener missed) sends many requests close together.
    // Without a lock, two executions can both check isDuplicate() at
    // the same moment, both see "nothing matches yet," and both call
    // saveTransaction() -- Google Sheets' appendRow() isn't safe against
    // that race on its own, and one of the two rows can silently
    // disappear even though this function logged "TRANSACTION SAVED"
    // for it. A script lock makes every execution wait its turn for
    // this specific check-then-write step, so that can't happen anymore.
    const lock = LockService.getScriptLock();
    lock.waitLock(25000); // comfortably under Apps Script's own execution limit -- a genuinely stuck lock fails loudly into the catch below instead of hanging

    try{

      const dup = isDuplicate(tx, sms, timestamp);

      if(!dup.duplicate){

        saveTransaction(tx,sms,sender,timestamp);
        logWebhook(sender,sms,raw,"TRANSACTION SAVED");

      }
      else{

        logWebhook(sender,sms,raw,"DUPLICATE IGNORED (" + dup.reason + ")");

      }

    }finally{
      lock.releaseLock();
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

// Known bank/wallet sender IDs. "PAYZAP" (PayZapp wallet) and "ONJPTR"
// (Jupiter) added 2026-08-27 -- both were real senders found in the
// user's actual message history that this list didn't recognize before,
// so their SMS never even reached the parsing logic. Jupiter is
// expected to be temporary (user is planning to stop using that app),
// kept simple on purpose rather than given its own special handling.
const KNOWN_SENDERS = ["HDFC","FED","SBI","ICICI","AXIS","KOTAK","YES","PAYTM","PAYZAP","ONJPTR"];

function isKnownSender(sender){
  const s = sender.toUpperCase();
  return KNOWN_SENDERS.some(function(b){ return s.includes(b); });
}

function hasRupeeAmount(text){
  return /rs\.?\s?\d/i.test(text) || /inr\.?\s?\d/i.test(text) || /₹\s?\d/i.test(text);
}

// Every wording this project has confirmed (or reasonably expects) to
// mean "money actually moved," in one place -- both classifySms() and
// the EMI-offer safety check below share this, so a new wording only
// ever needs to be added once.
function hasMoneyMovementSignal(text){

  const words = [
    "debited","spent","deducted","withdrawn","sent","paid", // debit-shaped
    "credited","received","refund","deposited"               // credit-shaped
  ];

  for(let i=0;i<words.length;i++){
    if(text.includes(words[i])) return true;
  }

  if(text.includes("credit of")) return true; // e.g. "Credit of Rs.45000 has been initiated" (salary-style ICICI wording)
  if(text.includes("txn") && (text.includes("card") || text.includes("upi") || text.includes("atm"))) return true; // e.g. HDFC's "Txn Rs.109.08 On HDFC Bank Card..."
  if(text.includes("autopay") && text.includes("success")) return true; // e.g. "AutoPay (E-mandate) Success for Rs.199"
  if(text.includes("without otp")) return true; // e.g. "Rs.89 without OTP/PIN HDFC Bank Card x1264 At..."

  return false;

}

// Decides what to do with a message: "IGNORE" (definitely not a real
// transaction), "TRANSACTION" (confident, save it as-is), or
// "UNCERTAIN" (might be real money, doesn't match anything we
// recognize -- save it flagged for review rather than guess or drop
// it).
function classifySms(sms,sender){

  const text = sms.toLowerCase();
  const knownSender = isKnownSender(sender);

  // Found live 2026-08-28: a real HDFC "RCS rich card" promotional
  // message (Google's rich business-messaging format -- an image, a
  // button, a whole JSON payload, not plain text) got saved because its
  // marketing copy literally said "the loan amount IS credited directly
  // to your bank account" -- a real money-movement word describing what
  // a loan offer WOULD do, not something that actually happened. Rather
  // than try to keyword-guess "is credited" (real event) apart from
  // "would be credited" (marketing copy) -- a genuinely hard wording
  // problem -- this checks the message's SHAPE instead: a real bank
  // transaction alert is always a short, plain-English sentence, never
  // a JSON object. If Tasker ever forwards one of these rich-card
  // payloads again (or any other structured, non-SMS content), it's
  // recognized and ignored here before any wording logic even runs.
  if(text.trim().charAt(0) === "{"){
    return "IGNORE";
  }

  // --- Step 1: hard blocks, checked regardless of sender ---------------
  // None of these are ever a real transaction confirmation.
  // "otp" is checked separately (not in the loop below) because a real
  // card-charge confirmation can legitimately contain the phrase
  // "without OTP/PIN" (e.g. a small contactless tap) -- that's a
  // completed transaction, not an OTP code being sent, so it must not
  // be blocked here.
  if(text.includes("otp") && !text.includes("without otp")) return "IGNORE";

  // A real transaction confirmation can legitimately mention "reward
  // points" as a footer (some banks append "earn X reward points on
  // this purchase" to an otherwise real debit SMS) -- so these words
  // alone can't mean "always ignore" the way they used to (that
  // silently swallowed genuine transactions -- flagged by
  // change-reviewer 2026-08-27). But letting a spam word through
  // completely whenever ANY money word is present opens a different
  // door: a purely promotional message using realistic-sounding
  // wording ("Rs.50 cashback CREDITED to your wallet as a reward!")
  // would then get confidently logged as if it were real (also caught
  // by change-reviewer, on the same review pass). Neither guess is
  // safe -- a message combining a spam word with a money word is
  // genuinely ambiguous, so it's remembered here and forced into
  // UNCERTAIN below instead of being confidently trusted either way.
  // Added 2026-08-27, same day as deploy -- a real promotional "Get a
  // Loan on your HDFC Bank Credit Card" message got saved (as
  // UNCERTAIN) within minutes of this going live, because it used none
  // of the spam words below and no money-movement word either, so it
  // fell into "known sender, unrecognized wording -- might be new,
  // don't drop it." It's obviously an ad, not a transaction -- and it
  // gave away a strong, cheap, general signal this design was missing:
  // it contains a clickable link. A real transaction confirmation
  // essentially never includes a URL (that's a marketing/phishing
  // hallmark, not a bank-alert one) -- so a link is treated exactly
  // like a spam word from here on: blocks outright if no money word is
  // also present, otherwise forces UNCERTAIN rather than confident
  // TRANSACTION (same ambiguous-signal handling already used below).
  const spamWords = ["reward","points","cashback","offer"];
  const hasSpamWord = spamWords.some(function(w){ return text.includes(w); }) || /https?:\/\//i.test(text);

  if(hasSpamWord && !hasMoneyMovementSignal(text)) return "IGNORE"; // a pure promo, no money wording at all

  // A future-tense alert ("will be debited on the 15th") means money
  // hasn't moved YET -- must be checked before the debit-word check
  // below, since "debited" is a substring of "will be debited" and
  // would otherwise match first (this exact check existed before but
  // was unreachable dead code for that reason -- fixed here).
  if(text.includes("will be debited") || text.includes("will be charged") || text.includes("scheduled to be debited")){
    return "IGNORE";
  }

  // "emi"/"loan" almost always show up in a loan/EMI *offer* ("Get
  // instant EMI on your next purchase!", "Get a Loan on your Credit
  // Card @ Zero Processing Fee") -- not a real charge. "loan" added
  // 2026-08-27 as defense-in-depth alongside the link check above,
  // for a promotional message that happens to have no URL in it.
  // Blocked UNLESS a real money-movement word is also present, so a
  // genuine future EMI-debit confirmation (not seen in real data yet,
  // but possible) isn't silently dropped just for containing the word.
  if((text.includes("emi") || text.includes("loan")) && !hasMoneyMovementSignal(text)){
    return "IGNORE";
  }

  // A "credit card payment received" confirmation just echoes a bill
  // payment that's already tracked via the real bank-side debit --
  // showing it too would double-count it.
  if(text.includes("credit card") && text.includes("payment") && text.includes("received")){
    return "IGNORE";
  }

  // --- Step 2: confident match ------------------------------------------
  if(knownSender && hasMoneyMovementSignal(text)){
    // A message that mixes a spam-style word with real money wording is
    // ambiguous -- could be a real transaction with a promotional
    // footer, or a promotional message dressed up in realistic-sounding
    // wording. Don't confidently guess either way -- surface it for a
    // quick human glance instead (never silently dropped either way).
    if(hasSpamWord) return "UNCERTAIN";
    return "TRANSACTION";
  }

  // --- Step 3: uncertain, needs a human's eyes ---------------------------
  // A known bank/wallet sent something that doesn't match any wording
  // we recognize -- could be a new message format. Don't guess, surface
  // it for review instead of silently dropping it.
  if(knownSender){
    return "UNCERTAIN";
  }

  // An unrecognized sender, but the message contains a real rupee
  // amount and wasn't caught by the spam filters above -- could be a
  // new bank/wallet/app not in the known-sender list yet. Surface for
  // review rather than silently ignoring it -- this is what makes the
  // system self-adapting instead of needing a code change every time
  // something new shows up.
  if(hasRupeeAmount(text)){
    return "UNCERTAIN";
  }

  return "IGNORE";

}

function ruleParser(sms,sender){

  const text = sms.toLowerCase();

  let obj = {};

  // AMOUNT DETECTION (handles Rs./INR./₹, with or without a space)
  let amt =
    text.match(/rs\.?\s?([\d,]+\.?\d*)/i) ||
    text.match(/inr\.?\s?([\d,]+\.?\d*)/i) ||
    text.match(/₹\s?([\d,]+\.?\d*)/i);

  if(amt){
    obj.amount = amt[1].replace(/,/g,"");
  }

  // TYPE DETECTION (debit vs credit)
  //
  // "withdrawn" added 2026-08-27 -- found while rewriting this: the old
  // classifier (isTransactionSMS) recognized "withdrawn" as proof of a
  // real transaction, but this function's own type-detection never
  // checked for it, so an ATM withdrawal SMS would get saved with a
  // blank Type. "paid" added as a new real debit wording found in the
  // user's actual message history.
  if(
    text.includes("debited") ||
    text.includes("spent") ||
    text.includes("deducted") ||
    text.includes("withdrawn") ||
    text.includes("sent") ||
    text.includes("paid") ||
    text.includes("txn") ||
    (text.includes("autopay") && text.includes("success")) ||
    text.includes("without otp")
  )
      obj.type = "debit";

  // "credit of" added 2026-08-27 -- real ICICI salary wording ("Credit
  // of Rs.45000 has been initiated") doesn't contain any of the other
  // credit words. "deposited" was already in the classifier's own list
  // but missing here -- added for consistency.
  if(
    text.includes("credited") ||
    text.includes("received") ||
    text.includes("refund") ||
    text.includes("deposited") ||
    text.includes("credit of")
  )
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


  // BANK DETECTION -- kept in sync with KNOWN_SENDERS above (was
  // missing KOTAK/YES/PAYTM before, even though the old classifier
  // already recognized those senders -- fixed here so a transaction
  // from any recognized sender always gets a real Bank value, not a
  // blank one).

  const s = sender.toUpperCase();

  if(s.includes("HDFC")) obj.bank = "HDFC";
  if(s.includes("FED")) obj.bank = "FEDERAL";
  if(s.includes("SBI")) obj.bank = "SBI";
  if(s.includes("ICICI")) obj.bank = "ICICI";
  if(s.includes("AXIS")) obj.bank = "AXIS";
  if(s.includes("KOTAK")) obj.bank = "KOTAK";
  if(s.includes("YES")) obj.bank = "YES";
  if(s.includes("PAYTM")) obj.bank = "PAYTM";
  if(s.includes("PAYZAP")) obj.bank = "PAYZAPP";
  if(s.includes("ONJPTR")) obj.bank = "JUPITER";


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
    name = text.match(/for\s([a-z0-9\s\.@_-]+)/i);
  }

  // Added 2026-08-27, found during change-reviewer's check of the
  // duplicate-detection redesign: a very common real HDFC format
  // ("Info: UPI/DR/128395408722/SWIGGY") doesn't use "to"/"at"/
  // "towards"/"for" wording at all, so it was extracting NO
  // counterparty -- which also meant isDuplicate()'s tier 3 name-match
  // safety check above could never run for these messages. The
  // merchant name sits right after the reference number in this
  // format, so pull it from there directly as a last fallback.
  if(!name){
    name = text.match(/upi\/(?:dr|cr)\/\d+\/([a-z0-9]+)/i);
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

// Three-tier duplicate check. Returns {duplicate:true, reason:"..."} or
// {duplicate:false}. See the file-header comment above for the full
// "why" -- short version: tier 1 is the strongest signal (a real
// reference number matching another real reference number); tier 2
// safely handles reference-less message types (like wallet deductions)
// by comparing the exact raw text instead, which two genuinely
// different transactions almost never share; tier 3 is deliberately
// narrow, only ever comparing against a statement-reconciliation
// placeholder row (identified by its "NOREF_" reference prefix), never
// against an ordinary blank-reference SMS row.
function isDuplicate(tx, sms, timestamp){

  const sheet = getSheet(TRANSACTION_SHEET);
  const lastRow = sheet.getLastRow();

  if(lastRow < 2) return {duplicate:false};

  // Columns A-K: Date,Time,Bank,Type,Mode,Amount,Reference,Counterparty,Channel,Source,RawSMS
  const rows = sheet.getRange(2,1,lastRow-1,11).getValues();

  const ref = tx.reference ? String(tx.reference) : "";

  // Tier 1 -- exact reference match, but only against an existing row
  // that has a REAL reference of its own. Compared as NUMBERS, not
  // text -- flagged by change-reviewer 2026-08-27: Google Sheets can
  // silently store a purely-numeric cell as an actual Number (dropping
  // a leading zero in the process), and a strict text comparison would
  // then never match even though it's the same reference. Comparing
  // as numbers tolerates that regardless of which side lost the zero.
  // Reference numbers are always pure digits by design (extracted via
  // a \d{6,} pattern), so this is always safe here.
  if(ref){
    for(let i=0;i<rows.length;i++){
      const existingRef = String(rows[i][6] || "");
      if(existingRef && existingRef.indexOf("NOREF_") !== 0 && Number(existingRef) === Number(ref)){
        return {duplicate:true, reason:"reference match"};
      }
    }
  }

  // Tier 2 -- the exact same raw SMS text was already saved.
  if(sms){
    for(let i=0;i<rows.length;i++){
      const existingSms = String(rows[i][10] || "");
      if(existingSms && existingSms !== "-" && existingSms === sms){
        return {duplicate:true, reason:"exact SMS text match"};
      }
    }
  }

  // Tier 3 -- same date + amount + type, but ONLY against a row whose
  // reference is a statement-reconciliation placeholder.
  if(tx.amount && tx.type && timestamp){

    const msgDate = new Date(Number(timestamp)*1000);
    const msgDateStr = Utilities.formatDate(msgDate, "Asia/Kolkata", "yyyy-MM-dd");

    for(let i=0;i<rows.length;i++){

      const existingRef = String(rows[i][6] || "");
      if(existingRef.indexOf("NOREF_") !== 0) continue;

      // Extra safety, on top of the NOREF_ narrowing above: also
      // require a loose counterparty match (either name containing the
      // other, case-insensitive) -- and require BOTH sides to actually
      // have a name to compare. Found by change-reviewer 2026-08-27: an
      // earlier version of this check only compared names when both
      // happened to be present, and otherwise fell back to
      // date+amount+type alone -- but a very common real HDFC format
      // ("Rs.500 debited... Info: UPI/DR/128395408722/SWIGGY") extracts
      // no counterparty at all, so that fallback could silently match a
      // genuinely different real transaction against an unrelated
      // placeholder row and DROP it entirely -- the exact failure mode
      // this whole rewrite exists to prevent, just inverted (losing a
      // transaction instead of duplicating one). Fixed by requiring a
      // real name on both sides before tier 3 can match at all -- if a
      // name can't be verified, this tier now stays silent (the
      // transaction still saves as a new row) rather than guessing. The
      // cost is a placeholder row occasionally not getting auto-matched
      // in this specific case -- a visible, recoverable extra row -- which
      // is a far safer failure than silently losing money with no trace.
      const existingCounterparty = String(rows[i][7] || "").toLowerCase();
      const txCounterparty = String(tx.counterparty || "").toLowerCase();
      if(!existingCounterparty || !txCounterparty) continue;
      const namesLikelyMatch = existingCounterparty.indexOf(txCounterparty) !== -1 || txCounterparty.indexOf(existingCounterparty) !== -1;
      if(!namesLikelyMatch) continue;

      const rowDateRaw = rows[i][0];
      const rowDateStr = (rowDateRaw instanceof Date) ? Utilities.formatDate(rowDateRaw, "Asia/Kolkata", "yyyy-MM-dd") : String(rowDateRaw);
      const rowAmount = Number(rows[i][5]);
      const rowType = String(rows[i][3] || "").toLowerCase();

      if(rowDateStr === msgDateStr && Math.abs(rowAmount - Number(tx.amount)) < 0.01 && rowType === String(tx.type).toLowerCase()){
        return {duplicate:true, reason:"matches a statement-reconciled placeholder row"};
      }

    }

  }

  return {duplicate:false};

}

function saveTransaction(data,sms,sender,timestamp){

  const sheet = getSheet(TRANSACTION_SHEET);

  let date;

  if(timestamp)
    date = new Date(Number(timestamp)*1000);
  else
    date = new Date();

  sheet.appendRow([

    // "Asia/Kolkata" instead of the old "IST" label -- "IST" is
    // ambiguous (a few other regions also use it for their own time
    // zone); this also keeps saveTransaction's own date consistent
    // with the timezone isDuplicate() now compares against above.
    Utilities.formatDate(date,"Asia/Kolkata","yyyy-MM-dd"),
    Utilities.formatDate(date,"Asia/Kolkata","HH:mm:ss"),

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
