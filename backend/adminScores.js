// adminScores.js (added 2026-10-16)
//
// PLAIN-ENGLISH WHAT THIS IS: the HONEST scoring of "how well does the app understand transactions", plus the owner's admin
// dashboard summary. It only ever reads the counters adminStats.js wrote. It never reads a transaction.
//
// THE OWNER'S RULE (2026-10-16): the score must never say the app is doing great when it is not, and every number must come with
// its reasoning. So:
//   * A score is shown ONLY when there is enough evidence behind it. With less, the answer is "collecting" or "unverified" and
//     the reason is spelled out. No score is invented for a bank with few messages.
//   * Messages nobody has checked are NOT assumed to be right. "Read completely" is a claim by the app; the score also needs people's
//     checks (saved without changing the amount, not removed as junk) before it counts as verified.
//   * Things that could make the score look better than reality are listed as "blind spots" on the dashboard, in plain words.
//   * There is deliberately NO single blended "overall" number: a blend can hide one weak area behind two strong ones.
//
// THE THREE SCORES
//   Reading   Of the bank messages that were real transactions, how many did the reader understand fully (amount AND spent-or-
//             received), multiplied by how many of the ones people checked were right. Messages that never arrived at all but
//             were found later by a statement check (Reconcile) count against it. Per bank.
//   Guessing  Of the category and Need/Want guesses shown to people, how many were kept unchanged; guesses corrected later in
//             History are subtracted.
//   Done for you  Share of payments the app settled by itself (Rent / EMI / SIP recognised) versus payments a person had to note.

var ADMIN_SCORE_MIN_MESSAGES_ = 20;     // fewer real messages than this for a bank: "collecting data", no score
var ADMIN_SCORE_MIN_CHECKED_ = 10;      // fewer people-checked readings than this: "unverified" (the raw read rate is shown, but no score)
var ADMIN_SCORE_MIN_SHARE_ = 0.25;      // and at least this share of the real messages must have been checked, or the checks say too little about the rest
var ADMIN_SCORE_MIN_DECISIONS_ = 30;    // guesses / payments needed before the Guessing and Done-for-you scores are shown
var ADMIN_SCORE_WINDOW_WEEKS_ = 4;      // the headline looks at the latest four weeks (this week included)
var ADMIN_TREND_WEEKS_ = 8;

function adminNum_(v){ var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

// weeks: [{ weekIdx, fields }] (any order). Returns per-bank counters and the global counters for just those weeks.
function adminSumWeeks_(weeks){
  var banks = {}, g = { saves: 0, cat_kept: 0, cat_changed: 0, cat_none: 0, type_kept: 0, type_changed: 0, type_none: 0, revised: 0, auto: 0, recon_added: 0 };
  weeks.forEach(function(w){
    var f = w.fields || {};
    Object.keys(f).forEach(function(k){
      var m = /^b_(.+)__(full|partial|unc|ign|dup|nopayee|rev|fix|unc_junk|unc_restored|conf_removed|restored)$/.exec(k);
      if(m){
        var b = banks[m[1]] || (banks[m[1]] = { bank: m[1], full: 0, partial: 0, unc: 0, ign: 0, dup: 0, nopayee: 0, rev: 0, fix: 0, unc_junk: 0, unc_restored: 0, conf_removed: 0, restored: 0 });
        b[m[2]] += adminNum_(f[k]);
        return;
      }
      var gm = /^g__(.+)$/.exec(k);
      if(gm && Object.prototype.hasOwnProperty.call(g, gm[1])) g[gm[1]] += adminNum_(f[k]);
    });
  });
  return { banks: banks, g: g };
}

// The Reading score for one set of counters. extraMissed = payments found later by statement checks (only known for everyone together).
function adminReadingFor_(c, extraMissed){
  var junkNet = Math.max(0, c.unc_junk - c.unc_restored);                        // flagged-by-the-reader messages removed as junk and NOT put back
  var money = Math.max(0, c.full + c.partial + c.unc - junkNet);             // real transactions that reached the server (junk the reader flagged is not one)
  var removedNet = Math.max(0, c.conf_removed - c.restored);                    // confident readings someone removed and did NOT put back
  var checked = c.rev + removedNet;                                              // readings a person looked at (saved, or removed)
  var wrong = c.fix + removedNet;                                                // amount had to be corrected, or the "transaction" was removed
  var denom = money + (extraMissed || 0);
  var complete = denom > 0 ? Math.min(1, c.full / denom) : null;
  var accuracy = checked > 0 ? Math.max(0, 1 - wrong / checked) : null;
  var out = { messages: money, full: c.full, partial: c.partial, uncertain: c.unc, junkCaught: junkNet, ignored: c.ign, missedFound: extraMissed || 0,
    checked: checked, wrong: wrong, readRate: complete, accuracy: accuracy, score: null, status: "collecting", why: "" };
  if(denom < ADMIN_SCORE_MIN_MESSAGES_){
    out.status = "collecting";
    out.why = "Only " + denom + " real message" + (denom === 1 ? "" : "s") + " so far. A score needs at least " + ADMIN_SCORE_MIN_MESSAGES_ + ".";
  }else if(checked < ADMIN_SCORE_MIN_CHECKED_ || checked < ADMIN_SCORE_MIN_SHARE_ * denom){
    out.status = "unverified";
    out.why = "The reader understood " + Math.round(complete * 100) + "% completely, but only " + checked + " of " + denom + " " + (denom === 1 ? "has" : "have") + " been checked by a person (needs at least " + ADMIN_SCORE_MIN_CHECKED_ + " and a quarter of all messages). Not scored yet.";
  }else{
    out.status = "verified";
    out.score = complete * accuracy;
    out.why = Math.round(complete * 100) + "% read completely, and " + (checked - wrong) + " of " + checked + " checked ones needed no correction (" + Math.round(accuracy * 100) + "%). Score = " + Math.round(complete * 100) + "% x " + Math.round(accuracy * 100) + "% = " + Math.round(out.score * 100) + "%.";
  }
  return out;
}

function adminGuessFor_(g){
  var kept = g.cat_kept + g.type_kept, changed = g.cat_changed + g.type_changed;
  var decisions = kept + changed;
  var out = { decisions: decisions, kept: kept, changed: changed, revisedLater: g.revised, saves: g.saves, coverage: g.saves > 0 ? Math.min(1, decisions / (g.saves * 2)) : null,
    score: null, status: "collecting", why: "" };
  if(decisions < ADMIN_SCORE_MIN_DECISIONS_){
    out.why = "Only " + decisions + " guess" + (decisions === 1 ? "" : "es") + " shown to people so far. A score needs at least " + ADMIN_SCORE_MIN_DECISIONS_ + ".";
  }else{
    var right = Math.max(0, kept - g.revised);
    out.status = "verified";
    out.score = right / decisions;
    out.why = kept + " of " + decisions + " guesses were kept" + (g.revised ? ", minus " + g.revised + " that were corrected later" : "") + ". A kept guess is not proof it was right (someone may save without looking), which is why later corrections are subtracted.";
  }
  return out;
}

function adminHandledFor_(g){
  var total = g.auto + g.saves;
  var out = { auto: g.auto, typed: g.saves, score: null, status: "collecting", why: "" };
  if(total < ADMIN_SCORE_MIN_DECISIONS_){
    out.why = "Only " + total + " payment" + (total === 1 ? "" : "s") + " so far. A score needs at least " + ADMIN_SCORE_MIN_DECISIONS_ + ".";
  }else{
    out.status = "verified";
    out.score = g.auto / total;
    out.why = g.auto + " payment" + (g.auto === 1 ? "" : "s") + " were settled by the app (Rent / EMI / SIP recognised) out of " + total + ". Everything else needed a person. This only grows as more fixed payments are recognised.";
  }
  return out;
}

// "strong" is only said when the evidence behind it is large (n >= 60 checks / guesses); a high score on a small sample is "promising".
function adminVerdict_(score, n){
  if(score === null || score === undefined) return "";
  if(score >= 0.9) return n >= 60 ? "strong" : "promising (small sample)";
  return score >= 0.75 ? "fair" : "needs work";
}

// weeks = every week document available (any order); nowMs = now. Returns the whole "understanding" block of the dashboard.
function adminComputeUnderstanding_(weeks, nowMs){
  var cur = adminWeekIndex_(nowMs);
  var inWindow = weeks.filter(function(w){ return w.weekIdx > cur - ADMIN_SCORE_WINDOW_WEEKS_ && w.weekIdx <= cur; });
  var sum = adminSumWeeks_(inWindow);
  var all = { full: 0, partial: 0, unc: 0, ign: 0, dup: 0, nopayee: 0, rev: 0, fix: 0, unc_junk: 0, unc_restored: 0, conf_removed: 0, restored: 0 };
  var bankList = Object.keys(sum.banks).map(function(k){
    var c = sum.banks[k];
    Object.keys(all).forEach(function(m){ all[m] += c[m]; });
    var r = adminReadingFor_(c, 0);
    r.bank = k; r.verdict = adminVerdict_(r.score, r.checked); r.unknownBank = k.indexOf("UNK") === 0;
    return r;
  });
  bankList = bankList.filter(function(b){ return b.messages > 0; });
  var missedAll = sum.g.recon_added;
  if(missedAll > 0) bankList.forEach(function(b){ b.note = "Excludes the " + missedAll + " payment" + (missedAll === 1 ? "" : "s") + " statement checks found missing: those cannot be assigned to a bank, so they only lower the overall figure."; });                // a sender that only ever sent ignored junk is not a bank row
  bankList.sort(function(a, b){ return b.messages - a.messages; });
  var reading = adminReadingFor_(all, sum.g.recon_added);
  reading.verdict = adminVerdict_(reading.score, reading.checked);
  var guessing = adminGuessFor_(sum.g); guessing.verdict = adminVerdict_(guessing.score, guessing.decisions);
  var handled = adminHandledFor_(sum.g);

  var trend = [];
  for(var i = ADMIN_TREND_WEEKS_ - 1; i >= 0; i--){
    var wi = cur - i;
    var wk = weeks.filter(function(w){ return w.weekIdx === wi; });
    var s = adminSumWeeks_(wk), c2 = { full: 0, partial: 0, unc: 0, ign: 0, dup: 0, nopayee: 0, rev: 0, fix: 0, unc_junk: 0, unc_restored: 0, conf_removed: 0, restored: 0 };
    Object.keys(s.banks).forEach(function(k){ Object.keys(c2).forEach(function(m){ c2[m] += s.banks[k][m]; }); });
    var r2 = adminReadingFor_(c2, s.g.recon_added);
    var show = r2.status === "verified";          // a week is plotted only when it would be scored on its own, by the same rules as the headline (enough messages, enough checks, a quarter checked)
    trend.push({ weekStartMs: adminWeekStartMs_(wi), reading: show ? r2.readRate * r2.accuracy : null, messages: r2.messages });
  }
  var firstWeek = weeks.length ? Math.min.apply(null, weeks.map(function(w){ return w.weekIdx; })) : null;

  var blind = [
    "A real transaction that the reader wrongly IGNORED cannot be seen here. Only a statement check (Reconcile) reveals it, and only for people who upload statements (" + sum.g.recon_added + " found in this period).",
    "Only mistakes a person FIXES are seen. A wrong amount (for example the balance read as the amount) or a wrong spent-or-received that nobody edits counts as correct, so 'needed no correction' is not the same as 'was right'. Pending cannot edit an amount that was read; History can.",
    "Only payments read by the new SMS doors and arriving after recording started are scored (on the start day itself a few earlier ones may be included). Payments from the old Tasker reader, older history, and Reconcile's bulk 'save found notes' are left out on both sides.",
    "Messages nobody has opened are not assumed correct. A bank stays 'unverified' until enough of its payments have been checked by a person.",
    "The payee name is not checked at all. A wrong shop name would not lower the score.",
    "A guess kept unchanged is not proof it was right. Corrections made later in History are subtracted, but a mistake nobody notices is not.",
    "Numbers start from the day recording was switched on" + (firstWeek !== null ? " (week of " + new Date(adminWeekStartMs_(firstWeek)).toISOString().slice(0, 10) + ")" : "") + ". Older history is not included."
  ];
  return { windowWeeks: ADMIN_SCORE_WINDOW_WEEKS_, reading: reading, banks: bankList, guessing: guessing, handled: handled, trend: trend, blindSpots: blind,
    thresholds: { minMessages: ADMIN_SCORE_MIN_MESSAGES_, minChecked: ADMIN_SCORE_MIN_CHECKED_, minDecisions: ADMIN_SCORE_MIN_DECISIONS_ } };
}

// ---- The dashboard (owner only) ---------------------------------------------------------------------------------------------

// Everything the admin web page shows, in one answer. Reads a fixed, small set of documents: the last 8 weekly counter documents,
// one presence document per person, this and last week's usage per person, and up to 100 grouped errors.
function adminDashboard_(){
  var now = Date.now(), cur = adminWeekIndex_(now);
  var overview = adminOverview_();
  var me = splitsKey_(PWA_ALLOWED_EMAIL);
  var people = [{ name: "You", email: me, isOwner: true, fullApp: true }].concat((overview.people || []).map(function(p){ return { name: p.name, email: p.email, isOwner: false, fullApp: p.fullApp }; }));

  var paths = [];
  for(var i = 0; i < ADMIN_TREND_WEEKS_; i++) paths.push("adminStats/u_" + (cur - i));
  people.forEach(function(p){
    p.key = adminPersonKey_(p.email);
    paths.push("adminStats/p_" + p.key, "adminStats/w" + cur + "_" + p.key, "adminStats/w" + (cur - 1) + "_" + p.key);
  });
  var docs = fsBatchGetPaths_(paths);

  var weekDocs = [];
  for(var j = 0; j < ADMIN_TREND_WEEKS_; j++){ var d = docs["adminStats/u_" + (cur - j)]; if(d) weekDocs.push({ weekIdx: cur - j, fields: d.fields }); }
  var understanding = adminComputeUnderstanding_(weekDocs, now);

  var features = {};
  var rows = people.map(function(p){
    var pres = docs["adminStats/p_" + p.key], w0 = docs["adminStats/w" + cur + "_" + p.key], w1 = docs["adminStats/w" + (cur - 1) + "_" + p.key];
    var pf = pres ? pres.fields : {};
    var usage = {}, sms = { saved: 0, uncertain: 0, ignored: 0 }, errs = 0;
    [w0, w1].forEach(function(w){
      if(!w) return;
      Object.keys(w.fields).forEach(function(k){
        var n = adminNum_(w.fields[k]);
        if(k.indexOf("s_") === 0){ usage[k.slice(2)] = (usage[k.slice(2)] || 0) + n; features[k.slice(2)] = (features[k.slice(2)] || 0) + n; }
        else if(k === "sms_saved") sms.saved += n; else if(k === "sms_unc") sms.uncertain += n; else if(k === "sms_ign") sms.ignored += n; else if(k === "errs") errs += n;
      });
    });
    var lastSeen = adminNum_(pf.lastSeenMs), lastSms = adminNum_(pf.lastSmsMs);
    var status = "ok", note = "";
    if(!p.isOwner && !p.fullApp){ status = "splits"; note = "Splits only"; }
    else if(!lastSeen){ status = "never"; note = "Invited, not started"; }
    else if(p.fullApp && lastSms && now - lastSms > 3 * ADMIN_DAY_MS_){ status = "warn"; note = "No SMS for " + Math.floor((now - lastSms) / ADMIN_DAY_MS_) + " days"; }
    else if(p.fullApp && !lastSms){ status = "warn"; note = "No SMS received yet"; }
    return { name: p.name, email: p.email, isOwner: !!p.isOwner, fullApp: !!p.fullApp, lastSeenMs: lastSeen, lastSmsMs: lastSms, version: pf.version || "", platform: pf.platform || "",
      sms: sms, errors2w: errs, usage: usage, status: status, note: note };
  });

  var errDocs = [];
  try{ errDocs = fsListPath_("adminErrors", 300); }catch(ignore){}
  // Tidy-up: problems not seen for 30 days are deleted (at most 25 per load), so the list never grows without limit.
  try{
    var stale = errDocs.filter(function(e){ return adminNum_((e.fields || {}).lastMs) > 0 && now - adminNum_(e.fields.lastMs) > 30 * ADMIN_DAY_MS_; }).slice(0, 25);
    if(stale.length){ fsCommit_(stale.map(function(e){ return { del: { path: "adminErrors/" + e.id } }; })); errDocs = errDocs.filter(function(e){ return stale.indexOf(e) === -1; }); }
  }catch(ignorePrune){}
  var problemsTruncated = errDocs.length >= 300;
  var problems = errDocs.map(function(e){
    var f = e.fields || {}, total = adminNum_(f.count), last = adminNum_(f.lastMs), resolved = adminNum_(f.resolvedAtMs);
    var people2 = Object.keys(f).filter(function(k){ return k.indexOf("u_") === 0; }).length;
    var week = 0; for(var d = 0; d < 7; d++) week += adminNum_(f["d_" + adminDayKey_(now - d * ADMIN_DAY_MS_)]);
    return { id: e.id, kind: f.kind || "", screen: f.screen || "", msg: f.msg || "", total: total, last7: week, people: people2, lastMs: last, resolved: resolved > 0 && resolved > last };
  }).filter(function(p){ return !p.resolved && p.last7 > 0; }).sort(function(a, b){ return b.last7 - a.last7 || b.lastMs - a.lastMs; }).slice(0, 25);

  var activeToday = rows.filter(function(r){ return r.lastSeenMs && now - r.lastSeenMs < ADMIN_DAY_MS_; }).length;
  var errorsToday = 0; errDocs.forEach(function(e){ errorsToday += adminNum_((e.fields || {})["d_" + adminDayKey_(now)]); });
  var smsToday = 0; // this week's saved count is available; "today" is not tracked separately, so show the week
  rows.forEach(function(r){ smsToday += r.sms.saved; });
  var featureList = Object.keys(features).map(function(k){ return { screen: k, count: features[k] }; }).sort(function(a, b){ return b.count - a.count; });
  var timer = {};
  try{ var t = fsGetPathMeta_("_system/timer"); timer = t ? t.fields : {}; }catch(ignoreT){}
  var tickAge = adminNum_(timer.tickAtMs) ? now - adminNum_(timer.tickAtMs) : null;
  // The latest "every 3 days" problem review (written by tools/admin_review.py; plain text only). Missing = never run yet.
  var review = null;
  try{ var rv = fsGetPathMeta_("adminReview/latest"); if(rv && rv.fields && rv.fields.json) review = JSON.parse(rv.fields.json); }catch(ignoreReview){}
  return { ok: true, generatedMs: now, review: review, tiles: { people: people.length, activeToday: activeToday, errorsToday: errorsToday, smsThisWeek: smsToday,
      dbReadsPct: overview.usage ? overview.usage.readsPct : 0, dbWritesPct: overview.usage ? overview.usage.writesPct : 0,
      timerOk: tickAge !== null && tickAge < 12 * 60000 && adminNum_(timer.failCount) === 0, timerAgeMs: tickAge },
    people: rows, features: featureList, problems: problems, problemsTruncated: problemsTruncated, understanding: understanding };
}

// Owner only: mark a problem as resolved (it comes back by itself if it happens again after this moment).
function adminResolveProblem_(id){
  var clean = String(id || "");
  if(!/^[0-9a-f]{16}$/.test(clean)) return { ok: false, error: "Unknown problem." };
  var ok = adminStatsCommit_([{ path: "adminErrors/" + clean, fields: { resolvedAtMs: Date.now() }, adds: {} }]);
  return ok ? { ok: true } : { ok: false, error: "Couldn't save. Try again." };
}
