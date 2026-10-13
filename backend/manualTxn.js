// manualTxn.js (added 2026-10-13)
//
// PLAIN-ENGLISH WHAT THIS IS: "Add a transaction" by hand, for a bank/UPI/card payment that no SMS was sent for (for example a bank
// that sends no SMS, or a payment made while the phone was off). It adds one row to Transactions exactly like an SMS row would be,
// already "alerted" (Processed = YES), so it shows up in Pending where the note, category and Need/Want type are chosen the usual
// way (with the same suggestions and learning). Works for the owner and for friends with the full app, each on their own data.

var MANUAL_MODES_ = { upi: "upi", card: "card", netbanking: "neft", other: "other" };

function addManualTransaction_(data){
  try{
    var type = String(data.type || "").toLowerCase();
    if(type !== "debit" && type !== "credit") return { ok: false, error: "Choose Spent or Received." };

    var amount = Number(data.amount);
    if(!isFinite(amount) || amount <= 0 || amount > 100000000) return { ok: false, error: "Enter a valid amount." };
    amount = Math.round(amount * 100) / 100;

    var who = String(data.counterparty || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if(!who) return { ok: false, error: "Say who you paid or who paid you." };
    if(/^[=+\-@]/.test(who)) who = "'" + who;                           // never a spreadsheet formula

    var modeKey = String(data.mode || "other").toLowerCase();
    var mode = MANUAL_MODES_[modeKey];
    if(!mode) return { ok: false, error: "Choose how it was paid." };

    // The day it happened: today by default; not in the future, not absurdly old.
    var tz = "Asia/Kolkata";
    var now = new Date();
    var when = now;
    if(data.date){
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data.date));
      if(!m) return { ok: false, error: "That date doesn't look right." };
      when = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));      // noon UTC is the same calendar day in India
      var dayMs = 86400000;
      if(when.getTime() > now.getTime() + dayMs) return { ok: false, error: "That date is in the future." };
      if(when.getTime() < now.getTime() - 800 * dayMs) return { ok: false, error: "That date is too far back." };
    }

    var sheet = dbSs_().getSheetByName("Transactions");
    if(!sheet) return { ok: false, error: "Transactions not found." };

    // A unique reference so it can never be mistaken for (or merged with) another transaction.
    var reference = "MANUAL_" + Utilities.getUuid().replace(/-/g, "").slice(0, 10);

    sheet.appendRow([
      Utilities.formatDate(when, tz, "yyyy-MM-dd"),
      data.date ? "12:00:00" : Utilities.formatDate(now, tz, "HH:mm:ss"),
      "",                 // Bank
      type,
      mode,
      amount,
      reference,
      who,
      "Manual",           // Channel
      "App",              // Source
      "-",                // RawSMS
      "-",                // Sender
      "", "", "",         // Note, Category, TelegramMsgID (chosen later in Pending)
      "YES",              // Processed: counts as already alerted, so Pending lists it
      "", "", "", "", ""  // NeedWantSaving .. FriendShare
    ]);

    return { ok: true, reference: reference };
  }catch(err){
    return { ok: false, error: "Couldn't save. Try again." };
  }
}
