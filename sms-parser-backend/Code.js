const SHEET_ID = "1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw";

// Bound to the same spreadsheet the main PWA backend reads/writes.
const TRANSACTION_SHEET = "Transactions";
const LOG_SHEET = "Logs";

// Self-learning spam filter (added 2026-09-18). Plain-English: when a
// promotional/spam SMS slips past classifySms() and gets saved as
// UNCERTAIN ("NEEDS REVIEW: ..." in Pending), the PWA now has a button
// letting the user say "this isn't a real transaction" -- that write
// goes to this same sheet (LearnedSpamPatterns) from the OTHER Apps
// Script project (backend/PWA.js), and this script only ever READS it,
// to recognize the same junk automatically next time.
//
// THE NON-NEGOTIABLE SAFETY RULE: this check may ONLY ever downgrade a
// message classifySms() already decided is "UNCERTAIN" into "IGNORE".
// It must NEVER be checked against, or able to affect, a message
// classifySms() decided is a confident "TRANSACTION" -- see doPost()
// below, where this is only ever called inside the UNCERTAIN branch.
// That's what guarantees the learning system can never cause a real,
// confidently-detected transaction to be silently dropped -- worst case
// if the learning is ever wrong, a junk message just goes back to
// showing up once more in Pending for a human to check, never the
// reverse.
const LEARNED_SPAM_SHEET = "LearnedSpamPatterns";
const MIN_FINGERPRINT_LENGTH = 20; // backstop against a degenerate, too-generic fingerprint (e.g. "rs <NUM> credited") coincidentally matching an unrelated future message

// KEEP THIS EXACTLY IN SYNC with the identically-named copy of this
// function in the main backend's PWA.js (a separate Apps Script
// project) -- both projects read/write the same LearnedSpamPatterns
// sheet in the same spreadsheet, so their output must be byte-identical
// for the same input text, or a learned pattern written by one project
// could silently never match here. If this ever needs to change, change
// both copies together.
function normalizeForFingerprint(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<URL>")
    .replace(/\d+/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
}

// Reads the LearnedSpamPatterns sheet defensively -- returns null if it
// doesn't exist yet (nobody has used the "not a real transaction" button
// yet) or can't be opened for any reason, never throws. This script
// only ever READS this sheet -- the main PWA backend (a separate Apps
// Script project) is the one that creates it and writes new learned
// patterns to it.
function getLearnedSpamPatternsSheet(){
  try{
    return getSheet(LEARNED_SPAM_SHEET);
  }catch(err){
    return null;
  }
}

// See the safety-rule comment above LEARNED_SPAM_SHEET -- only ever
// call this for a message already classified "UNCERTAIN".
function matchesLearnedSpamPattern(sender, sms){

  const sheet = getLearnedSpamPatternsSheet();
  if(!sheet) return false;

  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return false;

  const normalizedIncoming = normalizeForFingerprint(sms);

  // Same minimum-specificity backstop the writer applies before ever
  // learning a pattern -- repeated here (defense in depth) in case that
  // guard is ever missing or wrong in the other project.
  if(normalizedIncoming.length < MIN_FINGERPRINT_LENGTH) return false;

  // Columns A-D: DateLearned, Sender, NormalizedTemplate, ExampleRawSMS
  const rows = sheet.getRange(2,1,lastRow-1,4).getValues();

  for(let i=0;i<rows.length;i++){

    const rowSender = String(rows[i][1] || "");
    const rowTemplate = String(rows[i][2] || "");

    if(rowTemplate.length < MIN_FINGERPRINT_LENGTH) continue; // same backstop, applied to the stored row too

    if(rowSender === sender && rowTemplate === normalizedIncoming){
      return true;
    }

  }

  return false;

}

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

    // classifyDetail() is the same decision as classifySms(), plus a short
    // plain-English reason when one of the newer, narrow IGNORE rules
    // (2026-10-10: junk / service notices / scam links / future-dated
    // notices) is what blocked the message -- so the Logs sheet can show
    // WHY something was skipped, not just that it was.
    const detail = classifyDetail(sms,sender);
    const classification = detail.result;

    if(classification === "IGNORE"){

      logWebhook(sender,sms,raw, detail.reason ? ("NOT TRANSACTION (" + detail.reason + ")") : "NOT TRANSACTION");
      return ContentService.createTextOutput("IGNORED");

    }

    // Self-learning spam filter (added 2026-09-18) -- ONLY ever checked
    // when classification is "UNCERTAIN", never "TRANSACTION". See the
    // safety-rule comment above LEARNED_SPAM_SHEET for why this order is
    // non-negotiable. Checked before ruleParser() even runs, since a
    // matched message is ignored outright, same as a plain IGNORE.
    if(classification === "UNCERTAIN" && matchesLearnedSpamPattern(sender, sms)){

      logWebhook(sender,sms,raw,"IGNORED (LEARNED PATTERN)");
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

// Found live 2026-09-07: a broker balance report ("...reported your
// Fund bal Rs.0.000 & Securities bal 0.000...") from an unrecognized
// sender (GROWWINVESTTECHPRIVATELIMITED) got saved as UNCERTAIN,
// because hasRupeeAmount() above just checks "is there a digit after
// Rs.", and "0" is a digit. A genuine transaction is never for Rs.0,
// so this checks the actual number found for at least one non-zero
// digit -- deliberately narrow: a genuine (if unusual) tiny real
// amount like "Rs.0.50" still has a non-zero digit ("5") and still
// counts as real money here; only an amount that's ALL zeros
// ("Rs.0", "Rs.0.00", "Rs.0.000") is treated as "no real amount."
function hasNonZeroRupeeAmount(text){

  const match =
    text.match(/rs\.?\s?([\d,]+\.?\d*)/i) ||
    text.match(/inr\.?\s?([\d,]+\.?\d*)/i) ||
    text.match(/₹\s?([\d,]+\.?\d*)/i);

  if(!match) return false;

  const digitsOnly = match[1].replace(/[^\d]/g,"");
  return /[1-9]/.test(digitsOnly);

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
  if(text.includes("without otp")) return true; // e.g. "Rs.89 without OTP/PIN HDFC Bank Card x5555 At..."

  return false;

}

// Decides what to do with a message: "IGNORE" (definitely not a real
// transaction), "TRANSACTION" (confident, save it as-is), or
// "UNCERTAIN" (might be real money, doesn't match anything we
// recognize -- save it flagged for review rather than guess or drop
// it).
function classifySms(sms,sender){
  return classifyDetail(sms,sender).result;
}

// ---------------------------------------------------------------------
// Junk-filter helpers added 2026-10-10 ("the app should only ask me about
// things only I know"). Each one is deliberately NARROW -- see the
// comment above each for exactly what it catches and why it can't
// swallow a real transaction.
// ---------------------------------------------------------------------

// Third-party link shorteners. A real bank / wallet alert never carries a
// link from one of these -- banks use their OWN domains (e.g.
// 1.hdfc.bank.in, hdfcbk.io), which are NOT in this list and are
// unaffected. A shortener inside a message that ALSO talks about money
// ("Credited: Rs.26083 ... View Now: bit.ly/xyz") is the classic
// phishing/scam shape: it borrows bank-looking wording to get you to tap
// a link. So unlike the ordinary URL check (which only forces UNCERTAIN
// when money words are present), a shortener link is IGNORED outright
// even with money words. The domain must be followed by "/" and must not
// be glued onto a longer word (so "ticket.co/..." or "habit.ly" don't
// trip it).
function hasThirdPartyShortLink(text){
  return /(?:^|[^a-z0-9.@-])(?:bit\.ly|tinyurl\.com|goo\.gl|rb\.gy|is\.gd|cutt\.ly|t\.co|ow\.ly|shorturl\.at|tiny\.cc|rebrand\.ly|buff\.ly)\/\S/i.test(text);
}

// Future-tense notices: money has NOT moved yet. The original three
// phrases are always treated as future-dated. The newer "deducted" /
// "auto-debited" family (found live 2026-09-10: HDFC's "E-Mandate!
// Rs.3000.00 will be deducted on 10/09/26 ... Maintain Balance") is
// treated as future-dated UNLESS the same message also states something
// already happened in the past tense ("has been debited", "was
// deducted", "successfully debited") -- that guard exists so a real
// debit that merely MENTIONS a future charge (e.g. a fee note) can never
// be swallowed by this rule. The REAL debit for such a mandate arrives
// later as a separate "UPI Mandate: Sent Rs.X ..." SMS, which contains
// none of these phrases and is untouched.
function isFutureDatedNotice(text){

  if(text.includes("will be debited") || text.includes("will be charged") || text.includes("scheduled to be debited")){
    return true;
  }

  const futureWillRe = /(?<![a-z0-9])will\s+(?:be|get)\s+(?:auto[\s-]?)?(?:debited|deducted|charged)(?![a-z0-9])/g;
  const futureDueRe = /(?<![a-z0-9])(?:scheduled|due)\s+to\s+be\s+(?:auto[\s-]?)?(?:debited|deducted|charged)(?![a-z0-9])/g;

  const futureNew = futureWillRe.test(text) || futureDueRe.test(text);

  if(!futureNew) return false;

  // GUARD (widened after review, 2026-10-10): a real transaction can
  // MENTION a future charge ("Rs.5000 debited from A/c ... GST will be
  // deducted at month end"). So, with the future phrase itself cut out,
  // if the REST of the message still contains any past-tense money word
  // (debited, deducted, charged, spent, withdrawn, paid, credited,
  // deposited, sent), the message describes something that already
  // happened -> do NOT ignore it. The genuine advance notice ("E-Mandate!
  // Rs.3000 will be deducted on <date> For <fund> - Autopay mandate ...
  // Maintain Balance") has none of those words once its own "will be
  // deducted" is removed, so it is still ignored.
  const withoutFuturePhrase = text.replace(futureWillRe, " ").replace(futureDueRe, " ");
  const alreadyHappened =
    /(?<![a-z0-9])(?:debited|deducted|charged|spent|withdrawn|paid|credited|deposited|sent)(?![a-z0-9])/.test(withoutFuturePhrase);

  return !alreadyHappened;

}

// Service / security / receipt messages that describe NO movement of the
// user's money. Returns a short reason string if the message is one of
// these, otherwise "". Each rule below only fires when the message has NO
// rupee amount at all (login / biometric / link-request notices never
// carry one), so a real transaction -- which always has an amount -- can
// not be caught just because it happens to contain the word "login" or
// "receipt" somewhere. The one rule that DOES involve an amount (the
// payment receipt) is tied to very specific receipt wording instead.
function serviceNoticeReason(text){

  const hasAmount = hasRupeeAmount(text);

  if(!hasAmount){

    // "Login Alert! We noticed that there was a login to your NetBanking..."
    if(/(?<![a-z0-9])login alert(?![a-z0-9])/.test(text) || /(?<![a-z0-9])login to your (?:net ?banking|mobile ?banking|internet banking|account|app)(?![a-z0-9])/.test(text)){
      return "login/security alert, no money moved";
    }

    // "UPI Biometric Authentication has been enabled on <app> for A/c ..."
    if(/(?<![a-z0-9])biometric(?![a-z0-9])/.test(text) && /(?<![a-z0-9])(?:enabled|disabled|activated|deactivated|registered)(?![a-z0-9])/.test(text)){
      return "biometric/UPI setting change notice, no money moved";
    }

    // "Update: We got a request to link your ... Credit Card 4444 to UPI. Not you? Call..."
    if(/(?<![a-z0-9])request to (?:link|add|register|enable|set ?up)(?![a-z0-9])/.test(text) && /(?<![a-z0-9])upi(?![a-z0-9])/.test(text)){
      return "request-to-link-card/UPI notice, no money moved";
    }

  }

  // Payment RECEIPT from a biller for money the user themselves SENT,
  // e.g. "Hi <name>, we have received a payment of Rs. 488.82 for your
  // One Airtel Plan ... To download the payment receipt, click ...".
  // The real debit was already logged from the user's bank SMS, and
  // "received" here would wrongly read as money coming IN. Requires BOTH
  // the biller's "we have received a payment" phrasing AND the
  // "payment receipt" wording, and is skipped if the message also says
  // the user's own account was credited/debited.
  if(/(?<![a-z0-9])we(?:'ve| have) received (?:a |your )?payment(?![a-z0-9])/.test(text) &&
     /(?<![a-z0-9])payment receipt(?![a-z0-9])/.test(text) &&
     !/(?<![a-z0-9])(?:credited to|debited from|credited in|debited in)(?![a-z0-9])/.test(text)){
    return "biller payment receipt (user's own payment, already logged from the bank SMS)";
  }

  return "";

}

// Returns {result, reason}. result is exactly what classifySms() has
// always returned ("IGNORE" / "TRANSACTION" / "UNCERTAIN"); reason is a
// short plain-English explanation, only set for the newer narrow IGNORE
// rules (so the Logs sheet shows why they fired).
function classifyDetail(sms,sender){

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
    return {result:"IGNORE", reason:""};
  }

  // --- Step 1: hard blocks, checked regardless of sender ---------------
  // None of these are ever a real transaction confirmation.
  // "otp" is checked separately (not in the loop below) because a real
  // card-charge confirmation can legitimately contain the phrase
  // "without OTP/PIN" (e.g. a small contactless tap) -- that's a
  // completed transaction, not an OTP code being sent, so it must not
  // be blocked here.
  if(text.includes("otp") && !text.includes("without otp")) return {result:"IGNORE", reason:""};

  // Scam / phishing text (added 2026-10-10): a third-party link shortener
  // anywhere in the message -> ignore, even if it uses bank-sounding money
  // words. See hasThirdPartyShortLink() for the full reasoning. Real
  // example shape: "Dear Member, Important Notice: A/c ... Credited:
  // Rs.26083 ... View Now: bit.ly/xxxx" from a non-bank sender.
  //
  // ONLY for senders that are NOT a recognised bank/wallet (changed after
  // review, 2026-10-10): a known bank sender must never have a message
  // silently dropped just for odd wording -- the file's own "known
  // sender + unusual wording -> never silently drop" rule. For a known
  // sender, a shortener link instead pushes a money-wording message to
  // UNCERTAIN (saved, flagged NEEDS REVIEW, see Step 2 below), and any
  // other known-sender message is handled exactly as before.
  const knownSenderShortLink = knownSender && hasThirdPartyShortLink(text);

  if(!knownSender && hasThirdPartyShortLink(text)){
    return {result:"IGNORE", reason:"third-party short link from an unrecognised sender (likely scam/promo)"};
  }

  // Service / security / receipt notices with no money movement (added
  // 2026-10-10) -- login alerts, biometric/UPI setting changes, a
  // request-to-link-card notice, a biller's payment receipt. See
  // serviceNoticeReason() for why each is narrow and cannot catch a real
  // transaction.
  const serviceReason = serviceNoticeReason(text);
  if(serviceReason){
    return {result:"IGNORE", reason:serviceReason};
  }

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
  // "minimumbalancealert" phrases added 2026-08-28 -- a real HDFC
  // low-balance notification ("Bal in HDFC Bank A/c XX6666 has gone
  // below minimum limit... Chat on WhatsApp Banking: hdfcbk.io/k/...")
  // got saved as UNCERTAIN. This is a genuine, useful bank message, but
  // it's an account-STATUS check, not a transaction -- no money moved.
  // It also revealed the URL check above only catches an explicit
  // "http://"/"https://" prefix, not a bare shortlink like
  // "hdfcbk.io/k/..." -- not widened generally (a bare-domain check
  // risks false-matching real merchant text, e.g. UPI handles like
  // "zomato.eternaltsp.payu@hd" already seen in genuine transactions),
  // but this specific, well-scoped phrase closes today's actual case.
  const nonTransactionWords = ["reward","points","cashback","offer","minimum balance","minimum limit","min bal"];
  const hasNonTransactionSignal = nonTransactionWords.some(function(w){ return text.includes(w); }) || /https?:\/\//i.test(text);

  if(hasNonTransactionSignal && !hasMoneyMovementSignal(text)) return {result:"IGNORE", reason:""}; // a pure promo/notification, no money wording at all

  // A future-tense alert ("will be debited on the 15th") means money
  // hasn't moved YET -- must be checked before the debit-word check
  // below, since "debited" is a substring of "will be debited" and
  // would otherwise match first (this exact check existed before but
  // was unreachable dead code for that reason -- fixed here).
  if(isFutureDatedNotice(text)){
    return {result:"IGNORE", reason:"future-dated notice, money has not moved yet"};
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
    return {result:"IGNORE", reason:""};
  }

  // A "credit card payment received" confirmation just echoes a bill
  // payment that's already tracked via the real bank-side debit --
  // showing it too would double-count it.
  if(text.includes("credit card") && text.includes("payment") && text.includes("received")){
    return {result:"IGNORE", reason:""};
  }

  // "Credited to your card" is ambiguous by itself -- found live
  // 2026-09-07: "HDFC Bank Cardmember, Online Payment of Rs.149 vide
  // Ref# ... was credited to your card ending 5555" got saved as a
  // spurious ₹149 credit. This wording means the SAME thing as the
  // "credit card ... payment ... received" block just above (a bill
  // payment landing back on the card, already logged via the real
  // bank-side debit -- counting it again would double-count it), just
  // phrased differently ("credited to your card" instead of "payment
  // ... received"). But this phrase alone can't be blocked outright:
  // a genuine merchant refund can also read "Rs.X credited to your
  // card ending 5555" (real money -- this project has no stance yet on
  // whether refunds should be tracked, not decided here). The message
  // text itself gives a real signal to tell these two apart: a refund
  // SMS says "refund"/"refunded"/"reversed"; a bill-payment echo says
  // "payment" and never uses refund wording. Where neither word is
  // present, this genuinely can't be told apart from the text alone --
  // surfaced as UNCERTAIN rather than guessed either way, same pattern
  // as hasNonTransactionSignal above.
  if(/credited to (your )?card/.test(text)){
    if(text.includes("refund") || text.includes("refunded") || text.includes("reversed")){
      // looks like a genuine refund, not a bill-payment echo -- don't
      // block it, let normal classification below decide (Step 2/3).
    }
    else if(text.includes("payment")){
      return {result:"IGNORE", reason:""}; // a bill-payment echo, already counted via the real bank-side debit
    }
    else{
      return {result:"UNCERTAIN", reason:""}; // can't tell payment-echo from refund from the wording alone
    }
  }

  // --- Step 2: confident match ------------------------------------------
  if(knownSender && hasMoneyMovementSignal(text)){
    // A message that mixes a spam/notification-style word with real
    // money wording is ambiguous -- could be a real transaction with a
    // promotional footer, or a promotional/notification message dressed
    // up in realistic-sounding wording. Don't confidently guess either
    // way -- surface it for a quick human glance instead (never
    // silently dropped either way).
    if(hasNonTransactionSignal || knownSenderShortLink) return {result:"UNCERTAIN", reason:""};
    return {result:"TRANSACTION", reason:""};
  }

  // --- Step 3: uncertain, needs a human's eyes ---------------------------
  // A known bank/wallet sent something that doesn't match any wording
  // we recognize -- could be a new message format. Don't guess, surface
  // it for review instead of silently dropping it.
  if(knownSender){
    return {result:"UNCERTAIN", reason:""};
  }

  // An unrecognized sender, but the message contains a real (non-zero)
  // rupee amount and wasn't caught by the spam filters above -- could
  // be a new bank/wallet/app not in the known-sender list yet. Surface
  // for review rather than silently ignoring it -- this is what makes
  // the system self-adapting instead of needing a code change every
  // time something new shows up. Uses hasNonZeroRupeeAmount, not the
  // plain hasRupeeAmount, so a Rs.0 report (e.g. a broker balance
  // report) doesn't get treated as a possible transaction -- see that
  // function's own comment for why.
  if(hasNonZeroRupeeAmount(text)){
    return {result:"UNCERTAIN", reason:""};
  }

  return {result:"IGNORE", reason:""};

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


  // COUNTERPARTY DETECTION (rewritten into extractCounterparty() below,
  // 2026-10-10 -- see its comment for the "Block" bug it fixes)
  const cp = extractCounterparty(text);
  if(cp) obj.counterparty = cp;

  return obj;

}

// Words that are bank boilerplate ("Not You? To Block+Reissue Call ... /
// SMS BLOCK CC 4444 to ..."), never a merchant. Found 2026-10-10: the
// generic "to <name>" pattern below grabs the first "to " it sees, and on
// HDFC card alerts the first one is the footer's "To Block+Reissue
// Call", so the merchant was being saved as "block" / "block reissue
// call". Matched against the cleaned (letters/digits only) name, so
// "Block+Reissue" arrives here as "blockreissue ...".
function isBoilerplateCounterparty(name){
  return /^(?:block(?:reissue)?|reissue|not\s*you|not\s*u)(?:\s|$)/i.test(name || "");
}

// The text before the "Not You? ..." footer that every HDFC alert ends
// with (the footer holds only helpline numbers and "SMS BLOCK ..." words,
// never a merchant). If there is no footer, the text comes back unchanged.
function stripNotYouFooter(text){
  const m = text.match(/not\s*(?:you|u)\s*\?/i);
  return m ? text.slice(0, m.index) : text;
}

// Merchant name on the three HDFC CARD alert shapes that were being
// mis-parsed (all use invented merchant names in the tests):
//   a. "Spent Rs.2129 On HDFC Bank Card 4444 At SAMPLESHOP On 2026-09-24:19:11:35.Not You? ..."
//   b. "Rs.149 without OTP/PIN HDFC Bank Card x5555 At DEMOSTREAMING On 2026-09-11:11:35:34..."
//      (same "At <merchant> On <yyyy-mm-dd>" shape as a)
//   c. "AutoPay (E-mandate) Success! For DemoStream Txn Amt:INR149.00 Dt:..."
// Each pattern is anchored on a very specific neighbour ("On" followed by
// an ISO date; "Txn Amt") so it cannot grab anything from the other,
// differently-shaped alerts (UPI "To NAME On dd/mm/yy", "UPI/DR/ref/NAME",
// Federal "to NAME.Ref:", "At <vpa>@bank by UPI" ...) -- those still go
// through the original generic patterns, unchanged.
function extractCardMerchant(text){
  const m =
    text.match(/(?<![a-z0-9])at\s+([a-z0-9][a-z0-9 .&'_-]*?)\s+on\s+\d{4}-\d{2}-\d{2}/i) ||
    text.match(/(?<![a-z0-9])for\s+([a-z0-9][a-z0-9 .&'_-]*?)\s+txn\s+amt(?![a-z0-9])/i);
  if(!m) return "";
  // Light clean only: keep letters/digits/spaces (the heavier
  // cleanCounterparty would cut a merchant like "Jupiter" at "upi").
  return m[1].replace(/[^a-zA-Z0-9\s]/g,"").replace(/\s+/g," ").trim();
}

// The original generic extraction, byte-for-byte what ruleParser did
// before 2026-10-10 (first match of "to ", else "at ", "towards ", "for
// ", else the UPI/DR/ref/NAME form). Kept unchanged so every
// non-card-alert format extracts exactly as before.
function genericCounterparty(text){

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

  return name ? cleanCounterparty(name[1]) : "";

}

// Picks the merchant/person for a message. Order: (1) the three specific
// card-alert shapes; (2) the original generic extraction; (3) if (2)
// came back as bank boilerplate ("block ..."), try again on the text with
// the "Not You?" footer removed; if that is still boilerplate, return
// nothing rather than a wrong merchant ("never take Block as a
// merchant").
function extractCounterparty(text){

  const card = extractCardMerchant(text);
  if(card && !isBoilerplateCounterparty(card)) return card;

  const generic = genericCounterparty(text);
  if(!isBoilerplateCounterparty(generic)) return generic;

  const retry = genericCounterparty(stripNotYouFooter(text));
  return isBoilerplateCounterparty(retry) ? "" : retry;

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

  // Tier 4 -- the "bank sent two texts for ONE card charge" echo
  // (added 2026-10-10). See isCardEchoDuplicate() for the full rule and
  // the reasoning for how narrow it is.
  for(let i=0;i<rows.length;i++){
    if(isCardEchoDuplicate(tx, sms, timestamp, rows[i])){
      return {duplicate:true, reason:"echo of the same card charge (two bank texts for one purchase)"};
    }
  }

  return {duplicate:false};

}

// The last 4 digits of the card named in a message ("Card 4444",
// "Card x5555", "Bank CC 5555", "card ending 5555"), or "".
function extractCardLast4(text){
  const m = String(text || "").toLowerCase().match(/(?:card|cc)\s*(?:ending\s*)?x*(\d{4})(?![0-9])/);
  return m ? m[1] : "";
}

// The two kinds of card text the bank is known to send TOGETHER for ONE
// charge (found live 2026-09-11: one subscription charge produced both,
// one second apart, with no reference number on either, so both were
// saved as separate Rs.149 rows):
//   * "autopay" kind  -- an AutoPay / e-mandate SUCCESS text;
//   * "no-otp" kind   -- a "Rs.X without OTP/PIN ... Card ..." text.
// They are mutually exclusive here: a text is one kind, the other, or
// neither.
function isAutoPaySuccessText(text){
  const t = String(text || "").toLowerCase();
  return /autopay|e-?mandate/.test(t) && t.includes("success") && !t.includes("without otp");
}

function isWithoutOtpCardText(text){
  return String(text || "").toLowerCase().includes("without otp");
}

// True ONLY for the one pairing the bank really sends as an echo: exactly
// one text is the AutoPay-success kind and the other is the
// "without OTP/PIN" kind. Two texts of the SAME kind (two metro taps, two
// coffee buys), or a plain "Spent ..." text next to a "without OTP" one,
// are NOT a pair -- they are separate purchases and must both save
// (tightened after review, 2026-10-10).
function isAutoPayAndNoOtpPair(smsA, smsB){
  return (isAutoPaySuccessText(smsA) && isWithoutOtpCardText(smsB)) ||
         (isWithoutOtpCardText(smsA) && isAutoPaySuccessText(smsB));
}

// "HH:mm:ss" (or "HH:mm") text -> seconds since midnight, or null.
function clockToSeconds(str){
  const m = String(str || "").match(/^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
  if(!m) return null;
  return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3] || 0);
}

// A sheet "Time" cell comes back from Google Sheets either as text or --
// because the cell is time-formatted -- as a Date object. Both are
// turned into seconds since midnight, India time. Anything unreadable
// returns null, and a null makes the echo rule stay silent (the safe
// direction: keeping an extra row is recoverable, dropping a real
// transaction is not). Date detection uses toString rather than
// instanceof so it works regardless of which JS realm built the Date.
function timeCellToSeconds(cell){
  if(Object.prototype.toString.call(cell) === "[object Date]"){
    if(isNaN(cell.getTime())) return null;
    return clockToSeconds(Utilities.formatDate(cell, "Asia/Kolkata", "HH:mm:ss"));
  }
  return clockToSeconds(cell);
}

// Loose "do these two merchant names plausibly mean the same place?":
// one contains the other, or they start with the same word (>=4 letters),
// e.g. "DemoStream" vs "DEMOSTREAMING". Used only to make the echo rule
// MORE careful, never less.
function counterpartyNamesLikelyMatch(a, b){
  const x = String(a || "").toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
  const y = String(b || "").toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
  if(!x || !y) return true; // a missing name can't contradict -- the other checks carry the decision
  if(x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return true;
  const fx = x.split(" ")[0], fy = y.split(" ")[0];
  return fx.length >= 4 && fx === fy;
}

// Is the incoming message just the second text of a card charge already
// saved in `row`? ALL of these must hold, otherwise the answer is "no,
// keep it":
//   * both are debits for the same amount;
//   * neither has a real reference number (anything with a reference is
//     handled by tier 1 and is too trustworthy to second-guess here);
//   * both texts name the same card (last 4 digits);
//   * same calendar date, and the two texts arrived within 2 minutes of
//     each other;
//   * exactly one text is an AutoPay/e-mandate-success text and the other
//     is a "without OTP/PIN" text -- the only pairing the bank is known
//     to send;
//   * if both texts name a merchant, the names plausibly match.
// WHY SO STRICT: wrongly treating a real purchase as an echo makes it
// vanish with no trace; wrongly keeping an echo costs one tap to remove
// in the app. So every doubt resolves to "keep it". Two genuinely
// different same-amount purchases hours apart, or on different cards,
// or minutes apart on different shapes, all still save.
function isCardEchoDuplicate(tx, sms, timestamp, row){

  if(!tx.amount || String(tx.type).toLowerCase() !== "debit" || tx.reference || !timestamp) return false;

  if(String(row[3] || "").toLowerCase() !== "debit") return false;
  if(Math.abs(Number(row[5]) - Number(tx.amount)) >= 0.01) return false;

  const existingRef = String(row[6] || "").trim();
  if(existingRef) return false; // has any reference (real or NOREF_ placeholder) -> not an echo candidate

  const existingSms = String(row[10] || "");
  if(!existingSms || existingSms === "-") return false;

  const newLast4 = extractCardLast4(sms);
  const oldLast4 = extractCardLast4(existingSms);
  if(!newLast4 || newLast4 !== oldLast4) return false;

  if(!isAutoPayAndNoOtpPair(sms, existingSms)) return false;

  if(!counterpartyNamesLikelyMatch(tx.counterparty, row[7])) return false;

  // Same date...
  const msgDate = new Date(Number(timestamp)*1000);
  const msgDateStr = Utilities.formatDate(msgDate, "Asia/Kolkata", "yyyy-MM-dd");
  const rowDateRaw = row[0];
  const rowDateStr = (Object.prototype.toString.call(rowDateRaw) === "[object Date]") ? Utilities.formatDate(rowDateRaw, "Asia/Kolkata", "yyyy-MM-dd") : String(rowDateRaw);
  if(rowDateStr !== msgDateStr) return false;

  // ...and within 2 minutes.
  const msgSecs = clockToSeconds(Utilities.formatDate(msgDate, "Asia/Kolkata", "HH:mm:ss"));
  const rowSecs = timeCellToSeconds(row[1]);
  if(msgSecs === null || rowSecs === null) return false;
  if(Math.abs(msgSecs - rowSecs) > 120) return false;

  return true;

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
