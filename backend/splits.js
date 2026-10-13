// splits.js (added 2026-10-12)
//
// PLAIN-ENGLISH WHAT THIS IS: the "split a payment with a friend" brain.
// You keep a short list of friends (name, mobile, email). Each friend has ONE
// running balance with you ("Vaidehi owes you Rs 800"). A split ADDS to that
// balance, a payment REDUCES it, and any entry can be undone. Overpaying just
// flips the balance ("you owe her Rs 100"); nothing is lost.
//
// WHERE THE DATA LIVES (Firestore, not the Google Sheet - see CLAUDE.md, the
// "going public" plan). Everything for one person sits under their own email:
//   users/{myEmail}/friends/{friendEmail}                   name, mobile, balancePaise
//   users/{myEmail}/friends/{friendEmail}/ledger/{entryId}  one split or payment
//   users/{myEmail}/splitMarkers/{transaction}              "this payment is already split"
// The friend gets a MIRROR of every entry under THEIR email with the sign
// flipped, so it shows up in their app automatically. Security rules
// (firestore.rules) let a person read only the data under their own email.
//
// RULES THIS FILE FOLLOWS:
// - Money is stored as whole PAISE (Rs 1 = 100 paise), never decimals, so
//   Rs 420.10 + Rs 0.20 can never come out as Rs 420.29999.
// - Sign convention, from the point of view of whoever owns the data:
//   positive = the friend owes me, negative = I owe the friend.
// - Every change (my entry + the mirror + both balances + the marker) is ONE
//   all-or-nothing batch, so a failure can never leave half a split behind.
// - Nothing here touches the Google Sheet. A Firestore problem returns a clear
//   {ok:false} message; it never throws past splitsHandle_.

var SPLITS_LEDGER_CAP_ = 2000;       // most history entries read for one person
var SPLITS_MAX_PAISE_ = 100000000;   // Rs 10,00,000 - a sanity ceiling, not a feature

function splitsKey_(email){ return String(email || "").trim().toLowerCase(); }

function splitsValidEmail_(e){ return /^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(e); }

// Rupees typed by a person -> whole paise. NaN if it isn't a real number.
function splitsPaise_(rupees){
  if(rupees === "" || rupees === null || rupees === undefined) return NaN;
  var n = Number(rupees);
  if(!isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function splitsRupees_(paise){ return Math.round(Number(paise || 0)) / 100; }

// A safe Firestore document name made from free text.
function splitsSafeId_(raw, maxLen){
  var s = String(raw === null || raw === undefined ? "" : raw).replace(/[^A-Za-z0-9_\-]/g, "_");
  return s.slice(0, maxLen || 100);
}

function splitsNewId_(){
  return "e" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
}

function splitsFriendPath_(me, friend){ return "users/" + me + "/friends/" + friend; }
function splitsLedgerPath_(me, friend, id){ return splitsFriendPath_(me, friend) + "/ledger/" + id; }
function splitsMarkerPath_(me, key){ return "users/" + me + "/splitMarkers/" + key; }

// A plain, friendly failure that never leaks Firestore internals.
function splitsFail_(msg){ return { ok: false, error: msg }; }

// ---- "My spend counts only my share" (added 2026-10-12) -----------------------
// Transactions column U ("FriendShare", index 20) holds how many rupees of that
// payment a friend owes you because of a split. Every SPEND total (Today, Analysis,
// Planner, Home) subtracts it, so splitting Rs 840 with a friend shows Rs 420 as your
// spending. Things that are about what actually left the BANK or CARD (card limit, card
// bill matching, the transaction itself in Pending/History) keep the full amount.
var SPLITS_SHARE_COL_ = 21;          // column U (1-based)
var SPLITS_SHARE_HEADER_ = "FriendShare";

// Writes (or clears, with 0) the friend's share on one Transactions row, but ONLY if the
// row still is the transaction the split was made for (same stale-card fingerprint the
// Pending screen uses). Best-effort: a problem is logged, and the split itself stands.
// Returns true if the sheet now shows the intended value.
// Runs fn against the OWNER's own spreadsheet (the real Sheet, or his virtual one once he is switched on), even when the request
// in progress belongs to someone else (a friend undoing a split the owner made must still give the share back to the owner's spend).
function splitsOnOwnerSheet_(fn){
  var owner = splitsKey_(PWA_ALLOWED_EMAIL);
  if(!V2DB_REQ_ || V2DB_REQ_.user === owner) return fn();
  var saved = V2DB_REQ_;
  try{
    V2DB_REQ_ = null;                                         // back to the real Sheet ...
    if(v2EngineFor_(owner) === "v2db") return v2dbRun_(owner, fn, { prefetch: ["Transactions"] });   // ... or the owner's virtual one
    return fn();
  }finally{
    V2DB_REQ_ = saved;
  }
}

function splitsApplyShareToSheet_(txRow, txFp, shareRupees){
  try{
    if(!txFp) return false;       // never write by row number alone: a re-sorted sheet would put it on the wrong payment
    var sheet = dbSs_().getSheetByName("Transactions");
    if(!sheet) return false;
    var row = Math.floor(Number(txRow));
    // The stored row number is only a hint: a Reconcile can re-sort the sheet. If that row is
    // no longer this payment, look for the row that is (by fingerprint). Exactly one match
    // is used; none or several means "don't guess".
    if(!(row >= 2 && row <= sheet.getLastRow() && rowStillMatches_(sheet, row, txFp))){
      var rows = sheet.getDataRange().getValues();
      var found = [];
      for(var i = 1; i < rows.length; i++){
        if((rows[i][5] || rows[i][7]) && rowFingerprint_(rows[i]) === String(txFp)) found.push(i + 1);
      }
      if(found.length !== 1){
        try{ logAI("SPLITS_SHEET_SKIP", "fingerprint matched " + found.length + " rows; share not written"); }catch(ignore){}
        return false;
      }
      row = found[0];
    }
    var header = sheet.getRange(1, SPLITS_SHARE_COL_);
    if(String(header.getValue() || "").trim() === "") header.setValue(SPLITS_SHARE_HEADER_);
    sheet.getRange(row, SPLITS_SHARE_COL_).setValue(shareRupees > 0 ? shareRupees : "");
    return true;
  }catch(e){
    try{ logAI("SPLITS_SHEET_ERROR", String(e && e.message).slice(0, 200)); }catch(ignore){}
    return false;
  }
}

// Firestore says 409 when a "create only if new" document already exists.
function splitsIsAlreadyThere_(e){ return !!e && e.httpCode === 409; }
// ...and 400/412 when "only if unchanged" fails because someone else changed it first.
function splitsIsChangedMeanwhile_(e){ return !!e && (e.httpCode === 409 || e.httpCode === 400 || e.httpCode === 412); }

// ---- Friends ----------------------------------------------------------------
// input: { name, mobile, email }. Adding the same email again just updates the
// name/mobile and keeps the balance.
function splitsAddFriend_(me, myName, input){
  var fk = splitsKey_(input && input.email);
  if(!splitsValidEmail_(fk)) return splitsFail_("Enter your friend's email, like name@gmail.com.");
  if(fk === me) return splitsFail_("That's your own email. Add your friend's email instead.");
  var name = String((input && input.name) || "").trim();
  if(!name) return splitsFail_("Enter your friend's name.");
  if(name.length > 60) return splitsFail_("That name is too long. Keep it under 60 letters.");
  var mobile = String((input && input.mobile) || "").replace(/[^\d+]/g, "");
  var digits = mobile.replace(/\D/g, "");
  if(digits.length < 10 || digits.length > 15) return splitsFail_("Enter a valid mobile number (10 digits).");

  var now = Date.now();
  // Don't overwrite what the friend already calls you on their side.
  var theirSide = fsGetPathMeta_(splitsFriendPath_(fk, me));
  // Their entry for me is a mirror ONLY if they didn't add me themselves. If they did,
  // it is a real entry and must never be flipped to a mirror (that would, for example,
  // lock a friend out of signing in when she adds the owner back).
  var mirrorFields = {};
  if(!theirSide || theirSide.fields.mirror){
    mirrorFields.email = me;
    mirrorFields.mirror = true;
    if(!theirSide || !theirSide.fields.name) mirrorFields.name = String(myName || me).slice(0, 60);
  }

  fsCommit_([
    { merge: { path: splitsFriendPath_(me, fk), fields: { name: name, mobile: mobile, email: fk, mirror: false, updatedAtMs: now },
               adds: [{ field: "balancePaise", amountInt: 0 }] } },
    { merge: { path: splitsFriendPath_(fk, me), fields: mirrorFields,
               adds: [{ field: "balancePaise", amountInt: 0 }] } }
  ]);
  return { ok: true, friend: { name: name, email: fk, mobile: mobile } };
}

// ---- The all-or-nothing writer used by splits and payments --------------------
// signedPaise is from MY point of view (+ = friend owes me more).
function splitsWriteEntry_(me, myName, fk, entry, signedPaise, extraOps){
  var common = {
    id: entry.id, type: entry.type, description: entry.description || "", note: entry.note || "",
    method: entry.method || "", txRow: entry.txRow || 0, txKey: entry.txKey || "", txFp: entry.txFp || "",
    totalPaise: entry.totalPaise || 0, createdAtMs: entry.createdAtMs, undone: false, createdBy: me
  };
  var mine = {}, theirs = {};
  Object.keys(common).forEach(function(k){ mine[k] = common[k]; theirs[k] = common[k]; });
  // The friend's copy never carries which row/fingerprint of MY bank sheet this came from.
  theirs.txRow = 0; theirs.txKey = ""; theirs.txFp = "";
  mine.signedPaise = signedPaise;    mine.counterparty = fk;  mine.mirror = false;
  theirs.signedPaise = -signedPaise; theirs.counterparty = me; theirs.mirror = true;

  var ops = [
    { set: { path: splitsLedgerPath_(me, fk, entry.id), fields: mine, onlyIfNew: true } },
    { set: { path: splitsLedgerPath_(fk, me, entry.id), fields: theirs, onlyIfNew: true } },
    { merge: { path: splitsFriendPath_(me, fk), fields: {}, adds: [{ field: "balancePaise", amountInt: signedPaise }] } },
    { merge: { path: splitsFriendPath_(fk, me), fields: {}, adds: [{ field: "balancePaise", amountInt: -signedPaise }] } }
  ].concat(extraOps || []);
  fsCommit_(ops);
}

function splitsLoadFriend_(me, fk){
  return fsGetPathMeta_(splitsFriendPath_(me, fk));
}

// Every action that takes a friend's email checks it first, so an odd value
// (with a slash, say) can never be spliced into a database path.
function splitsBadFriend_(fk){
  return splitsValidEmail_(fk) ? null : splitsFail_("That friend's email doesn't look right.");
}

// ---- Splits -----------------------------------------------------------------
// input: { friendEmail, totalAmount (rupees), friendShare (rupees, optional -
// default is half), description, txRow, txFp, requestId }
function splitsCreate_(me, myName, input){
  var fk = splitsKey_(input && input.friendEmail);
  if(splitsBadFriend_(fk)) return splitsBadFriend_(fk);
  var total = splitsPaise_(input && input.totalAmount);
  if(!(total > 0)) return splitsFail_("Enter the amount to split.");
  if(total > SPLITS_MAX_PAISE_) return splitsFail_("That amount looks too large. Check it and try again.");
  var share;
  if(input.friendShare === undefined || input.friendShare === null || input.friendShare === ""){
    share = Math.floor(total / 2);            // equal split; any odd paisa stays with the person who paid
  } else {
    share = splitsPaise_(input.friendShare);
  }
  if(!(share >= 1) || share > total) return splitsFail_("Your friend's share must be between Rs 0.01 and the full amount.");

  var friend = splitsLoadFriend_(me, fk);
  if(!friend) return splitsFail_("Add this friend first (name, mobile, email), then split.");

  var id = splitsSafeId_(input.requestId, 80) || splitsNewId_();
  var txKey = splitsSafeId_(input.txFp, 100) || (Number(input.txRow) > 0 ? "row" + Math.floor(Number(input.txRow)) : "");
  var extra = [];
  if(txKey){
    extra.push({ set: { path: splitsMarkerPath_(me, txKey), fields: { entryId: id, friend: fk, createdAtMs: Date.now() }, onlyIfNew: true } });
  }
  var entry = {
    id: id, type: "split", description: String(input.description || "").slice(0, 80),
    txRow: Number(input.txRow) > 0 ? Math.floor(Number(input.txRow)) : 0, txKey: txKey,
    txFp: String(input.txFp || "").slice(0, 200), totalPaise: total, createdAtMs: Date.now()
  };
  try{
    splitsWriteEntry_(me, myName, fk, entry, share, extra);
  }catch(e){
    if(splitsIsAlreadyThere_(e)){
      // Maybe an earlier try recorded the split but the Sheet write didn't land: re-apply it (harmless if it did).
      var healed = false;
      try{
        if(me === splitsKey_(PWA_ALLOWED_EMAIL) && txKey){
          var marker = fsGetPathMeta_(splitsMarkerPath_(me, txKey));
          if(marker && marker.fields.entryId){
            var old = fsGetPathMeta_(splitsLedgerPath_(me, marker.fields.friend || fk, marker.fields.entryId));
            if(old && !old.fields.undone && old.fields.type === "split" && Number(old.fields.txRow) > 0){
              healed = splitsApplyShareToSheet_(old.fields.txRow, old.fields.txFp, splitsRupees_(old.fields.signedPaise));
            }
          }
        }
      }catch(ignore){}
      return { ok: false, duplicate: true, sheetUpdated: healed, error: "This payment is already split. Undo the earlier split first if you want to change it." };
    }
    throw e;
  }
  // Only the owner's own bank payments live in the Sheet; a friend's splits have no Sheet row.
  var sheetUpdated = false;
  if(me === splitsKey_(PWA_ALLOWED_EMAIL) && entry.txRow > 0){
    sheetUpdated = splitsApplyShareToSheet_(entry.txRow, entry.txFp, splitsRupees_(share));
  }
  return {
    ok: true, entryId: id, friendShare: splitsRupees_(share), myShare: splitsRupees_(total - share),
    balance: splitsRupees_((friend.fields.balancePaise || 0) + share), sheetUpdated: sheetUpdated
  };
}

// ---- Payments ---------------------------------------------------------------
// input: { friendEmail, amount (rupees), direction: "received" | "sent",
//          method: "upi" | "cash" | "other", note, requestId }
function splitsPayment_(me, myName, input){
  var fk = splitsKey_(input && input.friendEmail);
  if(splitsBadFriend_(fk)) return splitsBadFriend_(fk);
  var paise = splitsPaise_(input && input.amount);
  if(!(paise > 0)) return splitsFail_("Enter the amount paid.");
  if(paise > SPLITS_MAX_PAISE_) return splitsFail_("That amount looks too large. Check it and try again.");
  var direction = input.direction === "sent" ? "sent" : "received";
  var method = ["upi", "cash", "other"].indexOf(input.method) >= 0 ? input.method : "other";

  var friend = splitsLoadFriend_(me, fk);
  if(!friend) return splitsFail_("That friend isn't in your list.");

  // They paid me -> they owe me less (negative). I paid them -> they owe me more.
  var signed = direction === "received" ? -paise : paise;
  var id = splitsSafeId_(input.requestId, 80) || splitsNewId_();
  var entry = {
    id: id, type: "payment", method: method, note: String(input.note || "").slice(0, 80),
    description: direction === "received" ? "Payment received" : "Payment sent", createdAtMs: Date.now()
  };
  try{
    splitsWriteEntry_(me, myName, fk, entry, signed, []);
  }catch(e){
    if(splitsIsAlreadyThere_(e)) return { ok: false, duplicate: true, error: "That payment was already recorded." };
    throw e;
  }
  return { ok: true, entryId: id, balance: splitsRupees_((friend.fields.balancePaise || 0) + signed) };
}

// ---- Undo ---------------------------------------------------------------------
// input: { friendEmail, entryId }. Marks the entry (and its mirror) as undone,
// reverses the balance, and frees the transaction to be split again.
function splitsUndo_(me, input){
  var fk = splitsKey_(input && input.friendEmail);
  if(splitsBadFriend_(fk)) return splitsBadFriend_(fk);
  var id = splitsSafeId_(input && input.entryId, 80);
  if(!id) return splitsFail_("Pick an entry to undo.");
  var mine = fsGetPathMeta_(splitsLedgerPath_(me, fk, id));
  if(!mine) return splitsFail_("Couldn't find that entry.");
  if(mine.fields.undone) return splitsFail_("That entry is already undone.");
  if(mine.fields.type === "carryover") return splitsFail_("That came from an old debt, so it can't be undone here. Record a payment if the balance needs adjusting.");
  var signed = Number(mine.fields.signedPaise || 0);
  var now = Date.now();

  var ops = [
    { merge: { path: splitsLedgerPath_(me, fk, id), fields: { undone: true, undoneAtMs: now }, onlyIfUpdateTime: mine.updateTime } },
    { merge: { path: splitsLedgerPath_(fk, me, id), fields: { undone: true, undoneAtMs: now } } },
    { merge: { path: splitsFriendPath_(me, fk), fields: {}, adds: [{ field: "balancePaise", amountInt: -signed }] } },
    { merge: { path: splitsFriendPath_(fk, me), fields: {}, adds: [{ field: "balancePaise", amountInt: signed }] } }
  ];
  // The "already split" marker belongs to whoever CREATED the split. Undo by either side
  // frees it (only ever the creator's own marker for this exact pair's entry).
  var creator = String(mine.fields.createdBy || me);
  if(creator !== me && creator !== fk) creator = me;
  var creatorCopy = mine;
  if(creator !== me){
    var theirCopy = fsGetPathMeta_(splitsLedgerPath_(creator, me, id));
    creatorCopy = theirCopy || mine;
  }
  var txKey = creatorCopy.fields.txKey || "";
  if(txKey) ops.push({ del: { path: splitsMarkerPath_(creator, txKey) } });
  try{
    fsCommit_(ops);
  }catch(e){
    if(splitsIsChangedMeanwhile_(e)) return splitsFail_("That entry just changed. Refresh and try again.");
    throw e;
  }
  // If it was a split of the OWNER's bank payment, give the friend's share back to the owner's spend.
  var sheetUpdated = false;
  if(creator === splitsKey_(PWA_ALLOWED_EMAIL) && creatorCopy.fields.type === "split" && Number(creatorCopy.fields.txRow) > 0){
    sheetUpdated = splitsOnOwnerSheet_(function(){ return splitsApplyShareToSheet_(creatorCopy.fields.txRow, creatorCopy.fields.txFp, 0); });
  }
  return { ok: true, sheetUpdated: sheetUpdated };
}

// ---- Reading ------------------------------------------------------------------
function splitsEntryOut_(id, f){
  return {
    id: id, type: f.type, amount: splitsRupees_(Math.abs(f.signedPaise || 0)),
    direction: (f.signedPaise || 0) >= 0 ? "theyOweMore" : "theyOweLess",
    description: f.description || "", note: f.note || "", method: f.method || "",
    total: splitsRupees_(f.totalPaise || 0), txRow: f.txRow || 0,
    createdAtMs: f.createdAtMs || 0, undone: !!f.undone, mirror: !!f.mirror
  };
}

// The list of people with one balance each (the Debts screen's new top section).
function splitsPeople_(me){
  var docs = fsListPath_("users/" + me + "/friends", 500);
  var people = docs.map(function(d){
    return { name: d.fields.name || d.id, email: d.id, mobile: d.fields.mobile || "",
             balance: splitsRupees_(d.fields.balancePaise || 0), mirror: !!d.fields.mirror };
  });
  people.sort(function(a, b){ return Math.abs(b.balance) - Math.abs(a.balance) || String(a.name).localeCompare(String(b.name)); });
  var owedToMe = 0, iOwe = 0;
  people.forEach(function(p){ if(p.balance > 0) owedToMe += p.balance; else if(p.balance < 0) iOwe += -p.balance; });
  return { ok: true, people: people, owedToMe: Math.round(owedToMe * 100) / 100, iOwe: Math.round(iOwe * 100) / 100 };
}

// One person's balance + the full history behind it, newest first. The balance
// is re-added from the history every time; if the stored number ever disagrees
// it is quietly corrected, so a stray bug can never leave a wrong balance on screen.
function splitsPerson_(me, fe){
  var fk = splitsKey_(fe);
  if(splitsBadFriend_(fk)) return splitsBadFriend_(fk);
  var friend = fsGetPathMeta_(splitsFriendPath_(me, fk));
  if(!friend) return splitsFail_("That friend isn't in your list.");
  var docs = fsListPath_(splitsFriendPath_(me, fk) + "/ledger", SPLITS_LEDGER_CAP_);
  var sum = 0;
  docs.forEach(function(d){ if(!d.fields.undone) sum += Number(d.fields.signedPaise || 0); });
  var healed = false;
  var stored = Number(friend.fields.balancePaise || 0);
  // Fix a wrong stored balance by ADDING the difference (so a save that lands
  // at the same moment is not overwritten). Her side is checked on its own: it
  // should equal the opposite of the history. Never when the history was cut
  // short by the safety cap - the sum would be too small.
  if(docs.length < SPLITS_LEDGER_CAP_){
    try{
      var hers = fsGetPathMeta_(splitsFriendPath_(fk, me));
      var herStored = hers ? Number(hers.fields.balancePaise || 0) : 0;
      var fixes = [];
      if(sum !== stored) fixes.push({ merge: { path: splitsFriendPath_(me, fk), fields: {}, adds: [{ field: "balancePaise", amountInt: sum - stored }] } });
      if(hers && -sum !== herStored) fixes.push({ merge: { path: splitsFriendPath_(fk, me), fields: {}, adds: [{ field: "balancePaise", amountInt: -sum - herStored }] } });
      if(fixes.length){ fsCommit_(fixes); healed = true; }
    }catch(e){}
  }
  var entries = docs.map(function(d){ return splitsEntryOut_(d.id, d.fields); });
  entries.sort(function(a, b){ return b.createdAtMs - a.createdAtMs; });
  return {
    ok: true, healed: healed,
    person: { name: friend.fields.name || fk, email: fk, mobile: friend.fields.mobile || "", balance: splitsRupees_(sum) },
    entries: entries
  };
}

// ---- Front door used by PWA.js -------------------------------------------------
// verified = { email, name } from the Google sign-in check.
function splitsHandle_(action, data, verified){
  var me = splitsKey_(verified && verified.email);
  var myName = (verified && verified.name) || me;
  try{
    var out;
    if(action === "getPeople")              out = splitsPeople_(me);
    else if(action === "getPerson")         out = splitsPerson_(me, data.friendEmail);
    else if(action === "addFriend")         out = splitsAddFriend_(me, myName, data);
    else if(action === "createSplit")       out = splitsCreate_(me, myName, data);
    else if(action === "recordSplitPayment")out = splitsPayment_(me, myName, data);
    else if(action === "undoSplitEntry")    out = splitsUndo_(me, data);
    else out = splitsFail_("Unknown split action.");
    try{ fsFlushUsage_(); }catch(ignore){}
    return out;
  }catch(e){
    try{ logAI("SPLITS_ERROR", String(action) + ": " + String(e && e.message).slice(0, 300)); }catch(ignore){}
    try{ fsFlushUsage_(); }catch(ignore){}
    return splitsFail_("Couldn't reach the splits database. Nothing was saved; try again in a moment.");
  }
}

// ---- Friends signing in themselves (added 2026-10-12) -------------------------
// The actions a friend (anyone the owner has added) is allowed to use. Every
// other action stays owner-only, because it reads or writes the owner's Sheet
// (or, for push tokens, would take over the owner's notifications).
var SPLITS_FRIEND_ACTIONS_ = ["ping", "getPeople", "getPerson", "addFriend", "createSplit", "recordSplitPayment", "undoSplitEntry"];

function splitsFriendActionAllowed_(action){
  return SPLITS_FRIEND_ACTIONS_.indexOf(action) !== -1;
}

// True only if this signed-in email is a friend the OWNER added by hand.
// Adding someone IS the permission; there is no separate list to maintain.
// A "mirror" entry (made when somebody else added the owner) does not count.
// Remembered for 10 minutes (a "no" for 1 minute) so it is not a database read
// on every tap. If Firestore can't be reached the answer is "no" (fail closed).
function splitsIsOwnersFriend_(email){
  var key = splitsKey_(email);
  if(!splitsValidEmail_(key)) return false;
  var cache = null, cacheKey = "SPF_" + key;
  try{ cache = CacheService.getScriptCache(); var hit = cache.get(cacheKey); if(hit === "1") return true; if(hit === "0") return false; }catch(ignore){}
  var ok = false;
  try{
    var doc = fsGetPathMeta_(splitsFriendPath_(splitsKey_(PWA_ALLOWED_EMAIL), key));
    ok = !!(doc && !doc.fields.mirror);
    try{ if(cache) cache.put(cacheKey, ok ? "1" : "0", ok ? 600 : 60); }catch(ignore){}
  }catch(e){
    try{ logAI("SPLITS_ERROR", "friend check: " + String(e && e.message).slice(0, 200)); }catch(ignore){}
    ok = false;
  }
  try{ fsFlushUsage_(); }catch(ignore){}
  return ok;
}

// ---- Keeping the Sheet and the splits database in step (added 2026-10-12) -----
// Compares Transactions column U ("FriendShare") with the owner's ACTIVE splits in
// Firestore and reports (apply=false) or repairs (apply=true) any difference:
//   missing = an active split with no share on its row, orphan = a share on a row with
//   no active split, wrong = the two numbers disagree. Rows are matched by fingerprint,
//   never by row number, so a re-sorted sheet can't confuse it.
// Run by hand from the Apps Script editor: splitsCheckShares() to look, splitsFixShares()
// to repair. Both are safe to run any time; the check changes nothing.
function splitsShareAudit_(apply){
  var owner = splitsKey_(PWA_ALLOWED_EMAIL);
  var want = {};
  fsListPath_("users/" + owner + "/friends", 500).forEach(function(f){
    if(f.fields.mirror) return;
    fsListPath_(splitsFriendPath_(owner, f.id) + "/ledger", SPLITS_LEDGER_CAP_).forEach(function(e){
      var x = e.fields;
      if(x.type === "split" && !x.undone && !x.mirror && x.createdBy === owner && x.txFp){
        want[x.txFp] = Math.round(((want[x.txFp] || 0) + (Number(x.signedPaise) || 0) / 100) * 100) / 100;
      }
    });
  });
  var sheet = dbSs_().getSheetByName("Transactions");
  var rows = sheet.getDataRange().getValues();
  var report = { missing: [], orphan: [], wrong: [], ambiguous: [], fixed: 0 };
  var fpCount = {}, fps = [];
  for(var k = 1; k < rows.length; k++){
    fps[k] = (rows[k][5] || rows[k][7]) ? rowFingerprint_(rows[k]) : "";
    if(fps[k]) fpCount[fps[k]] = (fpCount[fps[k]] || 0) + 1;
  }
  for(var i = 1; i < rows.length; i++){
    if(!fps[i]) continue;
    var have = Number(rows[i][20]) || 0;
    var w = want[fps[i]] || 0;
    if(fpCount[fps[i]] > 1){ if(have > 0 || w > 0) report.ambiguous.push(i + 1); continue; }   // two rows look identical: never guess
    if(Math.abs(have - w) < 0.005) continue;
    (w > 0 && have === 0 ? report.missing : (have > 0 && w === 0 ? report.orphan : report.wrong)).push(i + 1);
    if(apply){
      if(String(sheet.getRange(1, SPLITS_SHARE_COL_).getValue() || "").trim() === "") sheet.getRange(1, SPLITS_SHARE_COL_).setValue(SPLITS_SHARE_HEADER_);
      sheet.getRange(i + 1, SPLITS_SHARE_COL_).setValue(w > 0 ? w : "");
      report.fixed++;
    }
  }
  try{ fsFlushUsage_(); }catch(ignore){}
  return report;
}

function splitsCheckShares(){ var r = splitsShareAudit_(false); Logger.log(JSON.stringify(r)); return r; }
function splitsFixShares(){ var r = splitsShareAudit_(true); Logger.log(JSON.stringify(r)); return r; }

// Quiet daily self-repair, called from checkAppHealth: puts the Sheet back in step with the
// splits database if a write ever failed. Logs only when it actually fixed something.
function splitsAutoRepairShares_(){
  try{
    var r = splitsShareAudit_(true);
    if(r.fixed > 0) logAI("SPLITS_SHARE_REPAIRED", JSON.stringify(r));
    return r;
  }catch(e){
    try{ logAI("SPLITS_SHARE_REPAIR_ERROR", String(e && e.message).slice(0, 200)); }catch(ignore){}
    return null;
  }
}

// ---- Moving an OLD debt into a friend's running balance (added 2026-10-12) ---------
// The Debts list (Sheet) predates friends. This turns one open debt into an "earlier balance"
// entry on a friend's page and closes the old debt, so there is one number per person.
// OWNER ONLY (it reads/writes the owner's Sheet). Order matters: the Firestore entry is
// written first with an id built from the debt row, so a retry after a half-finished try
// can't count it twice; then the old debt is marked Settled. LENT/SPLIT = they owe you (+),
// BORROWED = you owe them (-). Carry-overs can't be undone (the old debt would have to be
// re-opened); record a payment to adjust instead.
function splitsDebtKey_(person, type, amountPaise){
  var text = String(person) + "|" + type + "|" + amountPaise, h = 0x811c9dc5;
  for(var i = 0; i < text.length; i++){ h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

function splitsMoveDebt_(me, myName, input){
  if(me !== splitsKey_(PWA_ALLOWED_EMAIL)) return splitsFail_("Only the owner can move old debts.");
  var fk = splitsKey_(input && input.friendEmail);
  if(splitsBadFriend_(fk)) return splitsBadFriend_(fk);
  var row = Math.floor(Number(input && input.row));
  var friend = splitsLoadFriend_(me, fk);
  if(!friend || friend.fields.mirror) return splitsFail_("That friend isn't in your list.");

  var sheet = dbSs_().getSheetByName("Debts");
  if(!sheet || !(row >= 2 && row <= sheet.getLastRow())) return splitsFail_("Invalid row.");
  var v = sheet.getRange(row, 1, 1, 8).getValues()[0];
  var person = String(v[1] || "").trim(), type = String(v[2] || "").trim().toUpperCase();
  var amount = Number(v[3]) || 0, note = String(v[4] || "").trim();
  // The card must say who/what it showed, and the row must still be that debt (a row number alone
  // could point at someone else's debt if the list changed). The amount is not compared: a
  // partial payment legitimately lowers it.
  var expectedPerson = String((input && input.expectedPerson) || "").trim().toLowerCase();
  var expectedType = String((input && input.expectedType) || "").trim().toUpperCase();
  if(!expectedPerson || !expectedType) return splitsFail_("Refresh the app and try again.");
  if(expectedPerson !== person.toLowerCase() || expectedType !== type) return splitsFail_("That debt changed since this list loaded. Refresh Debts and try again.");
  if(String(v[6] || "").trim() === "Settled" || !(amount > 0)) return splitsFail_("That debt is already settled.");
  if(type !== "LENT" && type !== "BORROWED" && type !== "SPLIT") return splitsFail_("That kind of debt can't be moved.");

  var paise = Math.round(amount * 100);
  var signed = type === "BORROWED" ? -paise : paise;
  var entry = {
    id: "debt" + row + "_" + splitsDebtKey_(person, type, paise), type: "carryover",
    description: ("Earlier balance: " + person + (note ? " (" + note + ")" : "")).slice(0, 80),
    createdAtMs: Date.now()
  };
  // One "this debt has been moved" marker per debt, so a retry that picks a DIFFERENT friend can
  // never credit the same debt to two people.
  var markerId = "debt" + row + "_" + splitsDebtKey_(person, type, paise);
  var movedElsewhere = "";
  try{
    splitsWriteEntry_(me, myName, fk, entry, signed, [
      { set: { path: "users/" + me + "/debtMoves/" + markerId, fields: { friend: fk, entryId: entry.id, createdAtMs: Date.now() }, onlyIfNew: true } }
    ]);
  }catch(e){
    if(!splitsIsAlreadyThere_(e)) throw e;
    var mk = fsGetPathMeta_("users/" + me + "/debtMoves/" + markerId);
    if(mk && mk.fields.friend && mk.fields.friend !== fk) movedElsewhere = mk.fields.friend;   // an earlier try went to someone else
    // otherwise an earlier try for THIS friend already wrote it: carry on and close the old debt
  }
  sheet.getRange(row, 7).setValue("Settled");
  sheet.getRange(row, 8).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"));
  var f2 = fsGetPathMeta_(splitsFriendPath_(me, fk));
  var out = { ok: true, balance: splitsRupees_(f2 ? f2.fields.balancePaise : 0) };
  if(movedElsewhere) out.alreadyMovedTo = movedElsewhere;
  return out;
}

function splitsMoveDebtHandle_(data, verified){
  try{
    var me = splitsKey_(verified && verified.email);
    var out = splitsMoveDebt_(me, (verified && verified.name) || me, data);
    try{ fsFlushUsage_(); }catch(ignore){}
    return out;
  }catch(e){
    try{ logAI("SPLITS_ERROR", "moveDebtToFriend: " + String(e && e.message).slice(0, 300)); }catch(ignore){}
    try{ fsFlushUsage_(); }catch(ignore){}
    return splitsFail_("Couldn't move that debt. Nothing was lost; check Debts and try again.");
  }
}
