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
    if(splitsIsAlreadyThere_(e)) return { ok: false, duplicate: true, error: "This payment is already split. Undo the earlier split first if you want to change it." };
    throw e;
  }
  return {
    ok: true, entryId: id, friendShare: splitsRupees_(share), myShare: splitsRupees_(total - share),
    balance: splitsRupees_((friend.fields.balancePaise || 0) + share)
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
  var txKey = mine.fields.txKey || "";
  if(!txKey && creator !== me){
    var theirCopy = fsGetPathMeta_(splitsLedgerPath_(creator, me, id));
    txKey = theirCopy ? (theirCopy.fields.txKey || "") : "";
  }
  if(txKey) ops.push({ del: { path: splitsMarkerPath_(creator, txKey) } });
  try{
    fsCommit_(ops);
  }catch(e){
    if(splitsIsChangedMeanwhile_(e)) return splitsFail_("That entry just changed. Refresh and try again.");
    throw e;
  }
  return { ok: true };
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
