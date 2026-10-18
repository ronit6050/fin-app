/* ============================================
   CARD COACH (added 2026-10-18)

   PLAIN-ENGLISH WHAT THIS IS: a card swipe for a "want" feels free, but it is next month's money spent early. Card Coach shows the real
   cost at the moment of the decision, calmly (never shaming), as ONE motivating number: "safe to put on the card".

   Three pieces live here:
     1. getCardCoach_(input)        - works out the `coach` block that getCCAdvisorData returns (also inside the Home copy, full.cc.coach).
     2. cardCoachPushLine_(...)     - the ONE short extra line added to the existing new-transaction notification, only for card swipes.
     3. cardBillReminderRun_(...)   - one push, 3 days before the card bill is due (once per bill, never when it is already paid).
   Full explanation, the formula and a worked example: docs/features/card-coach.md

   getCardCoach_ is a pure function (no Sheets, no Properties): everything it needs comes in through `input`, so it is tested offline in
   backend/tests/cardCoach.test.js. It NEVER throws: on any problem it returns null and the rest of the screen carries on without it.

   Cards: statement closes on the 18th, bill is due on the 9th of the NEXT month (same cycle maths as getCCAdvisorData / getOutstandingCCCycleWindow_).
   Column positions in Transactions (0-based): 0 date, 3 type, 4 mode, 5 amount, 7 counterparty, 12 note, 13 category,
   16 Need/Want/Saving tag (column Q), 17 Financial Event (Rent/EMI/Investment).
============================================ */

var CARD_COACH_FIXED_TOLERANCE_ = 0.25;   // amounts within 25% of each other count as "the same charge each month"
var CARD_COACH_CAP_PCT_         = 0.30;   // never suggest going past 30% of the limit (the app's existing "alert" line)
var CARD_COACH_WATCH_PCT_       = 0.20;   // "watch" when the safe amount is under 20% of the limit
var CARD_COACH_PUSH_MIN_        = 200;    // no extra notification line for swipes under this
var CARD_COACH_STREAK_MAX_      = 12;     // look back at most this many closed bills for the paid-in-full streak
var CARD_COACH_SALARY_LOOKBACK_DAYS_ = 70;
var CARD_BILL_REMIND_DAYS_      = 3;      // reminder goes out when the bill is due within this many days
var CARD_BILL_STATE_DOC_        = "_system/reminders";   // same small shared state document pendingReminder.js uses

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function cardCoachNorm_(name){
  return String(name === undefined || name === null ? "" : name).toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
}

function cardCoachIso_(d){
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}

var CARD_COACH_MONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function cardCoachShortDate_(d){
  return d.getDate() + " " + CARD_COACH_MONTHS_[d.getMonth()];
}

function cardCoachMoney_(n){
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

function cardCoachRound2_(n){
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cardCoachRound500_(n){
  return Math.round(n / 500) * 500;
}

// The cycle windows, worked out from `today` (a Date at midnight). closed(0) = the most recently CLOSED bill (the one due next),
// closed(1) the one before, and so on. Same maths as getCCAdvisorData: a bill closes on the 18th, is due on the 9th of the next month.
function cardCoachCycles_(today){
  var dom = today.getDate();
  var mrc = new Date(today.getFullYear(), today.getMonth() - (dom < 18 ? 1 : 0), 18);
  var y = mrc.getFullYear(), m = mrc.getMonth();
  return {
    current: { start: new Date(y, m, 19), end: new Date(y, m + 1, 18), due: new Date(y, m + 2, 9) },
    closed: function(k){
      var end = new Date(y, m - k, 18);
      return {
        start: new Date(end.getFullYear(), end.getMonth() - 1, 19),
        end: end,
        due: new Date(end.getFullYear(), end.getMonth() + 1, 9)
      };
    }
  };
}

// Every card swipe (a debit with a Mode starting "card" and an amount): the same rows CC Advisor counts.
function cardCoachSwipes_(txnData){
  var out = [];
  for(var i = 1; i < txnData.length; i++){
    var r = txnData[i];
    if(!r[0]) continue;
    var d = new Date(r[0]);
    if(isNaN(d.getTime())) continue;
    var type = (r[3] || "").toString().toLowerCase();
    var mode = (r[4] || "").toString().toLowerCase().trim();
    var amount = Number(r[5]) || 0;
    if(type !== "debit" || mode.indexOf("card") !== 0 || !(amount > 0)) continue;
    var cp = (r[7] || "").toString().trim();
    out.push({
      d: d, amount: amount, cp: cp, name: cardCoachNorm_(cp),
      tag: (r[16] || "").toString().trim(),
      event: (r[17] || "").toString().trim()
    });
  }
  return out;
}

function cardCoachInWindow_(s, start, end){
  return s.d >= start && s.d <= end;
}

// Names that behave like a fixed monthly bill: swipes in at least 2 of the 3 most recent CLOSED cycles with the cycle totals within 25%
// of each other, OR a swipe the app already marked as a Rent/EMI/Investment Financial Event in those cycles.
function cardCoachFixedNames_(swipes, cycles){
  var perCycle = [];                      // [{ name: total }, ...] for closed cycles 0..2
  var recurring = {};
  for(var k = 0; k < 3; k++){
    var w = cycles.closed(k), totals = {};
    swipes.forEach(function(s){
      if(!s.name || !cardCoachInWindow_(s, w.start, w.end)) return;
      totals[s.name] = (totals[s.name] || 0) + s.amount;
      if(s.event) recurring[s.name] = true;
    });
    perCycle.push(totals);
  }
  var fixed = {};
  Object.keys(recurring).forEach(function(n){ fixed[n] = true; });
  var names = {};
  perCycle.forEach(function(t){ Object.keys(t).forEach(function(n){ names[n] = true; }); });
  Object.keys(names).forEach(function(n){
    var amounts = [];
    perCycle.forEach(function(t){ if(t[n] > 0) amounts.push(t[n]); });
    if(amounts.length < 2) return;
    for(var a = 0; a < amounts.length; a++){
      for(var b = a + 1; b < amounts.length; b++){
        var hi = Math.max(amounts[a], amounts[b]), lo = Math.min(amounts[a], amounts[b]);
        if((hi - lo) / hi <= CARD_COACH_FIXED_TOLERANCE_) fixed[n] = true;
      }
    }
  });
  return fixed;
}

// fixed / want / need / unsorted. A swipe the person tagged Want is ALWAYS want (they win over the merchant guess).
// Saving and Investment tags count with Need (they are not "wants").
function cardCoachBucket_(s, fixedNames){
  if(s.tag === "Want") return "want";
  if(s.event || (s.name && fixedNames[s.name])) return "fixed";
  if(s.tag === "Need" || s.tag === "Saving" || s.tag === "Investment") return "need";
  return "unsorted";
}

// Did the closed bill k (k >= 1) get paid in full? Payments are looked for between that cycle's close and the NEXT close (the 9th is in
// that gap). A payment is a non-card debit whose wording says "credit card bill" (isBillWording) OR whose amount equals one card's total
// for that cycle or all cards together. Same idea as isCreditCardBillPayment, applied to an older cycle.
function cardCoachPaidInCycle_(txnData, cycles, k, total, perCard, isBillWording){
  var w = cycles.closed(k), nextEnd = cycles.closed(k - 1).end;
  var candidates = Object.keys(perCard).map(function(c){ return perCard[c]; });
  candidates.push(total);
  var paid = 0;
  for(var i = 1; i < txnData.length; i++){
    var r = txnData[i];
    if(!r[0]) continue;
    var d = new Date(r[0]);
    if(isNaN(d.getTime()) || d <= w.end || d > nextEnd) continue;
    if((r[3] || "").toString().toLowerCase() !== "debit") continue;
    var mode = (r[4] || "").toString().toLowerCase().trim();
    if(mode.indexOf("card") === 0) continue;
    var amount = Number(r[5]) || 0;
    if(!(amount > 0)) continue;
    var hit = false;
    if(isBillWording && isBillWording(r[4], r[7], r[12])) hit = true;
    for(var c = 0; !hit && c < candidates.length; c++){ if(candidates[c] > 0 && Math.abs(amount - candidates[c]) < 1) hit = true; }
    if(hit) paid += amount;
  }
  return paid >= total - 1;
}

// Consecutive most recent CLOSED bills paid in full. The open (not yet due) bill neither counts nor breaks the streak; an overdue one
// makes it 0. A cycle with no card spend is skipped (no bill). null when no closed bill with spend can be found.
function cardCoachStreak_(txnData, swipes, cycles, out, isBillWording){
  var streak = 0, evaluated = false;
  if(out && out.total > 0){
    if(out.isPaid){ streak++; evaluated = true; }
    else if(out.isOverdue){ return 0; }
  }
  for(var k = 1; k <= CARD_COACH_STREAK_MAX_; k++){
    var w = cycles.closed(k), total = 0, perCard = {};
    swipes.forEach(function(s){
      if(!cardCoachInWindow_(s, w.start, w.end)) return;
      total += s.amount;
    });
    if(!(total > 0)) continue;
    // per card totals need the Mode, which `swipes` does not keep: rebuild from the sheet rows of this window
    for(var i = 1; i < txnData.length; i++){
      var r = txnData[i];
      if(!r[0]) continue;
      var d = new Date(r[0]);
      if(isNaN(d.getTime()) || d < w.start || d > w.end) continue;
      var mode = (r[4] || "").toString().toLowerCase().trim();
      if((r[3] || "").toString().toLowerCase() === "debit" && mode.indexOf("card") === 0 && Number(r[5]) > 0) perCard[mode] = (perCard[mode] || 0) + Number(r[5]);
    }
    evaluated = true;
    if(cardCoachPaidInCycle_(txnData, cycles, k, total, perCard, isBillWording)) streak++;
    else break;
  }
  return evaluated ? streak : null;
}

// The usual salary: the SECOND-largest Income-tagged credit of the last ~70 days when there are two or more (a one-off bonus or refund
// can then never become "salary"), else the only one. A salary paid in two parts is understated - that is the safe direction.
function cardCoachSalaryAmount_(txnData, today){
  var since = new Date(today.getTime() - CARD_COACH_SALARY_LOOKBACK_DAYS_ * 86400000);
  var amounts = [];
  for(var i = 1; i < txnData.length; i++){
    var r = txnData[i];
    if(!r[0]) continue;
    var d = new Date(r[0]);
    if(isNaN(d.getTime()) || d < since || d > today) continue;
    if((r[3] || "").toString().toLowerCase() !== "credit") continue;
    if((r[13] || "").toString().trim() !== "Income") continue;
    var a = Number(r[5]) || 0;
    if(a > 0) amounts.push(a);
  }
  if(!amounts.length) return null;
  amounts.sort(function(x, y){ return y - x; });
  return amounts.length >= 2 ? amounts[1] : amounts[0];
}

// ---------------------------------------------------------------------
// The monthly budget behind "safe to put" (added 2026-10-18).
//   cardRoom = monthlyIncome - committed - nonCardLiving   (money left each month for ALL card use)
// Returns { monthlyIncome, committed, nonCardLiving, cardRoom } or null when the inputs are not trustworthy
// (no usual income, under 14 days of history, or no idea what normal living costs).
// ---------------------------------------------------------------------
var CARD_COACH_MIN_HISTORY_DAYS_ = 14;

function cardCoachBudget_(input, txnData, today, cycles, swipes){
  var monthlyIncome = cardCoachSalaryAmount_(txnData, today);
  if(!(monthlyIncome > 0)) return null;

  // History: the person's first real row must be at least ~14 days old.
  var first = null;
  for(var i = 1; i < txnData.length; i++){
    var r = txnData[i];
    if(!r || !r[0]) continue;
    var d = new Date(r[0]);
    if(isNaN(d.getTime())) continue;
    if(first === null || d < first) first = d;
  }
  (input.cashData || []).forEach(function(cr, ci){
    if(ci === 0 || !cr || !cr[1]) return;
    var cd = new Date(cr[1]);
    if(!isNaN(cd.getTime()) && (first === null || cd < first)) first = cd;
  });
  if(first === null || (today - first) / 86400000 < CARD_COACH_MIN_HISTORY_DAYS_) return null;

  var settings = input.settings || {};

  // Committed every month: each named Rent/EMI/SIP once, plus the savings and investment goals from Settings.
  var committed = (Number(settings.monthlySaveGoal) || 0) + (Number(settings.monthlyInvestmentGoal) || 0);
  var seen = {};
  (input.obligations || []).forEach(function(o){
    if(!o || !o.enoughHistory || !(Number(o.avgAmount) > 0)) return;
    var key = cardCoachNorm_(o.label);
    if(seen[key]) return;
    seen[key] = true;
    committed += Number(o.avgAmount);
  });

  // No made-up fallback: with no usable closed month of REAL data the answer is "unknown" (Settings' monthlyExpenses default is a guess).
  var living = cardCoachNonCardLiving_(input, txnData, today, cycles, first);
  if(living === null) return null;

  return { monthlyIncome: monthlyIncome, committed: committed, nonCardLiving: living, cardRoom: monthlyIncome - committed - living };
}

// Average monthly day-to-day spend NOT on the card, over the last up-to-3 CLOSED calendar months that have any data. null = no such month.
// Left out (same exclusions as CC Advisor / Analysis): card swipes, credit card bill payments, wallet top-ups, loans, and Rent/EMI/SIP rows.
// Cash-sheet debits (input.cashData) count as day-to-day spend. The person's FIRST data month is skipped unless their first row is on or before
// day 7 of it (a part-month would understate a normal month and make the safe amount too high).
function cardCoachNonCardLiving_(input, txnData, today, cycles, first){
  // amounts that are really "a card bill was paid": each closed bill's total, each card's own total, for the last few cycles
  var billAmounts = [];
  for(var k = 0; k < 6; k++){
    var w = cycles.closed(k), perCard = {}, total = 0;
    for(var i = 1; i < txnData.length; i++){
      var r = txnData[i];
      if(!r || !r[0]) continue;
      var d = new Date(r[0]);
      if(isNaN(d.getTime()) || d < w.start || d > w.end) continue;
      var mode = (r[4] || "").toString().toLowerCase().trim();
      var amt = Number(r[5]) || 0;
      if((r[3] || "").toString().toLowerCase() === "debit" && mode.indexOf("card") === 0 && amt > 0){
        perCard[mode] = (perCard[mode] || 0) + amt;
        total += amt;
      }
    }
    if(total > 0){ billAmounts.push(total); Object.keys(perCard).forEach(function(c){ billAmounts.push(perCard[c]); }); }
  }

  var perMonth = {};    // "y-m" -> { hasData, living }
  for(var j = 1; j < txnData.length; j++){
    var row = txnData[j];
    if(!row || !row[0]) continue;
    var dt = new Date(row[0]);
    if(isNaN(dt.getTime())) continue;
    var key = dt.getFullYear() + "-" + dt.getMonth();
    if(!perMonth[key]) perMonth[key] = { y: dt.getFullYear(), m: dt.getMonth(), living: 0 };
    if((row[3] || "").toString().toLowerCase() !== "debit") continue;
    var md = (row[4] || "").toString().toLowerCase().trim();
    if(md.indexOf("card") === 0) continue;                                     // card swipes are counted separately (cycleSpent)
    var full = Number(row[5]) || 0;
    if(!(full > 0)) continue;
    if((row[17] || "").toString().trim()) continue;                            // Rent / EMI / Investment: already in "committed"
    var cp = row[7], note = row[12];
    if(typeof isWalletTopUp === "function" && isWalletTopUp(cp, row[6])) continue;
    if(typeof isLendingTransfer === "function" && isLendingTransfer(cp, note)) continue;
    if(input.isBillWording && input.isBillWording(row[4], cp, note)) continue;
    var isBill = false;
    for(var b = 0; !isBill && b < billAmounts.length; b++){ if(Math.abs(full - billAmounts[b]) < 1) isBill = true; }
    if(isBill) continue;
    var mine = (typeof txnMyAmount_ === "function") ? (Number(txnMyAmount_(row)) || 0) : full;   // a split's friend part is not their spend
    perMonth[key].living += mine;
  }

  // Cash debits: day-to-day cash spend (same lending exclusion as Analysis).
  var cashData = input.cashData || [];
  for(var q = 1; q < cashData.length; q++){
    var cr = cashData[q];
    if(!cr || !cr[1]) continue;
    var cdate = new Date(cr[1]);
    if(isNaN(cdate.getTime())) continue;
    var ckey = cdate.getFullYear() + "-" + cdate.getMonth();
    if(!perMonth[ckey]) perMonth[ckey] = { y: cdate.getFullYear(), m: cdate.getMonth(), living: 0 };
    if((cr[3] || "").toString().toLowerCase() !== "debit") continue;
    var camt = Number(cr[4]) || 0;
    if(!(camt > 0)) continue;
    if(typeof isLendingTransfer === "function" && isLendingTransfer("", cr[5])) continue;
    perMonth[ckey].living += camt;
  }
  var firstKey = first.getFullYear() + "-" + first.getMonth();

  // the most recent up-to-3 calendar months BEFORE this month that have any rows at all
  var picked = [];
  var y = today.getFullYear(), m = today.getMonth();
  for(var back = 1; back <= 24 && picked.length < 3; back++){
    var mm = m - back, yy = y;
    while(mm < 0){ mm += 12; yy--; }
    var rec = perMonth[yy + "-" + mm];
    if(!rec) continue;
    if((yy + "-" + mm) === firstKey && first.getDate() > 7) continue;      // partial first month: skipped
    picked.push(rec.living);
  }
  if(!picked.length) return null;
  return picked.reduce(function(a, c){ return a + c; }, 0) / picked.length;
}

// ---------------------------------------------------------------------
// The coach block. input = {
//   txnData, today (Date at midnight), limit,
//   wantsLimitSetting (number, 0/unset = none),
//   settings: { monthlySaveGoal, monthlyInvestmentGoal }  (the person's Settings; used by the monthly budget), cashData (Cash sheet rows),
//   outstanding: { total, isPaid, isOverdue, daysUntilDue, dueDate (Date) } | null,   // the most recently closed bill
//   runway: computeRunway_() output | null, obligations: computeObligationStatuses_() output | [],
//   isBillWording: optional function(mode, counterparty, note) (older bills' payment detection)
// }
// Returns the coach object, or null on ANY problem.
// ---------------------------------------------------------------------
function getCardCoach_(input){
  try{
    return cardCoachCompute_(input);
  }catch(err){
    return null;
  }
}

function cardCoachCompute_(input){
  if(!input || !input.txnData || !input.today) return null;
  var limit = Number(input.limit);
  if(!(limit > 0)) return null;
  var today = input.today, txnData = input.txnData;
  var cycles = cardCoachCycles_(today);
  var cur = cycles.current;
  var swipes = cardCoachSwipes_(txnData);
  var fixedNames = cardCoachFixedNames_(swipes, cycles);

  // This cycle's swipes, split four ways.
  var split = { fixed: 0, need: 0, want: 0, unsorted: 0 };
  var fixedSeen = {};            // normalised name -> { name, amount }
  var cycleSpent = 0;
  swipes.forEach(function(s){
    if(!cardCoachInWindow_(s, cur.start, today)) return;
    var b = cardCoachBucket_(s, fixedNames);
    split[b] += s.amount;
    cycleSpent += s.amount;
    if(b === "fixed"){
      var key = s.name || s.cp.toLowerCase();
      if(!fixedSeen[key]) fixedSeen[key] = { name: s.cp || key, amount: 0 };
      fixedSeen[key].amount += s.amount;
    }
  });
  var fixedMerchants = Object.keys(fixedSeen).map(function(k){ return fixedSeen[k]; })
    .sort(function(a, b){ return b.amount - a.amount; }).slice(0, 6).map(function(f){ return f.name; });

  // Wants limit: the person's own setting, plus a suggestion from their last up-to-3 closed bills (or 10% of the limit with no history).
  var wantsLimit = Number(input.wantsLimitSetting) > 0 ? Number(input.wantsLimitSetting) : null;
  var wantTotals = [];
  for(var k = 0; k < 3; k++){
    var w = cycles.closed(k), cycleTotal = 0, cycleWant = 0;
    swipes.forEach(function(s){
      if(!cardCoachInWindow_(s, w.start, w.end)) return;
      cycleTotal += s.amount;
      if(cardCoachBucket_(s, fixedNames) === "want") cycleWant += s.amount;
    });
    if(cycleTotal > 0) wantTotals.push(cycleWant);
  }
  var suggested;
  if(wantTotals.length){
    var avg = wantTotals.reduce(function(a, b){ return a + b; }, 0) / wantTotals.length;
    suggested = Math.max(1000, cardCoachRound500_(Math.min(avg, 0.2 * limit)));
  }else{
    suggested = Math.max(1000, cardCoachRound500_(0.1 * limit));
  }
  var wantsOver = wantsLimit !== null ? Math.max(0, cardCoachRound2_(split.want - wantsLimit)) : null;

  // Safe to put on the card: a MONTHLY BUDGET view that does not use today's bank balance at all (rewritten 2026-10-18; the formula and a
  // worked example are in docs/features/card-coach.md).
  var runway = input.runway || null;
  var out = input.outstanding || null;
  var budget = cardCoachBudget_(input, txnData, today, cycles, swipes);
  var safeToPut = null, safeReason = "unknown", cardRoom = null, monthlyIncome = null;
  if(budget){
    monthlyIncome = Math.round(budget.monthlyIncome);
    cardRoom = Math.round(budget.cardRoom);
    // cardRoom can be below zero (the usual month leaves nothing for the card): treat that as 0 room, so a negative number only ever comes from swipes.
    var room = Math.min(Math.max(budget.cardRoom, 0), CARD_COACH_CAP_PCT_ * limit);
    safeToPut = Math.round(room - cycleSpent);
    if(budget.cardRoom <= 0) safeReason = "budget_full";
    else if(safeToPut < 0) safeReason = "over_by_swipes";
    else safeReason = "ok";
  }

  var utilisationWatch = cycleSpent >= CARD_COACH_CAP_PCT_ * limit;
  var tone;
  if((safeToPut !== null && safeToPut < 0) || (wantsOver !== null && wantsOver > 0)) tone = "over";
  else if(safeToPut === null) tone = utilisationWatch ? "watch" : "unknown";
  else if(safeReason === "budget_full" || safeToPut < CARD_COACH_WATCH_PCT_ * limit || utilisationWatch) tone = "watch";
  else tone = "ok";

  // The closed bill and what is planned around it.
  var bill = null;
  if(out && out.total > 0){
    var planLines = [];
    var dueIso = cardCoachIso_(out.dueDate);
    if(!out.isPaid){
      var salary = cardCoachSalaryAmount_(txnData, today);
      if(runway && runway.salaryDate && salary && runway.salaryDate <= dueIso){
        planLines.push({ label: "Salary expected " + cardCoachShortDate_(new Date(runway.salaryDate + "T00:00:00")), amount: Math.round(salary), sign: 1 });
      }
      (input.obligations || []).filter(function(o){
        return o && o.enoughHistory && !o.alreadyThisMonth && o.daysUntil >= 0 && o.daysUntil <= out.daysUntilDue;
      }).sort(function(a, b){ return a.daysUntil - b.daysUntil; }).forEach(function(o){
        planLines.push({ label: o.label, amount: Math.round(o.avgAmount), sign: -1 });
      });
      planLines.push({ label: "Card bill", amount: Math.round(out.total), sign: -1 });
    }
    bill = {
      amount: Math.round(out.total),
      dueDate: dueIso,
      daysUntilDue: out.daysUntilDue,
      isPaid: !!out.isPaid,
      isOverdue: !!out.isOverdue,
      planLines: planLines,
      leftUntilSalary: (runway && runway.estimatedBalance !== null && runway.estimatedBalance !== undefined && runway.salaryDate)
        ? Math.round(runway.estimatedBalance - (Number(runway.billsAhead) || 0)) : null
    };
  }

  var streak = null;
  try{ streak = cardCoachStreak_(txnData, swipes, cycles, out, input.isBillWording); }catch(ignoreStreak){ streak = null; }

  return {
    limit: limit,
    limitUsedPct: Math.min(100, Math.max(0, Math.round(cycleSpent / limit * 100))),
    cycleSpent: cardCoachRound2_(cycleSpent),
    split: { fixed: cardCoachRound2_(split.fixed), need: cardCoachRound2_(split.need), want: cardCoachRound2_(split.want), unsorted: cardCoachRound2_(split.unsorted) },
    fixedMerchants: fixedMerchants,
    wantsLimit: wantsLimit,
    suggestedWantsLimit: suggested,
    wantsOver: wantsOver,
    safeToPut: safeToPut,
    safeReason: safeReason,
    cardRoom: cardRoom,
    monthlyIncome: monthlyIncome,
    safeUntil: cardCoachIso_(cur.due),
    tone: tone,
    utilisationWatch: utilisationWatch,
    bill: bill,
    paidInFullStreak: streak
  };
}

// ---------------------------------------------------------------------
// Gathering the pieces that need Sheets/Properties (everything best-effort: a problem gives null / []).
// ---------------------------------------------------------------------

// Runway + obligations for the coach. monthSpend = this calendar month's spend (what Home's runway uses); null = runway unknown.
function cardCoachGather_(txnData, today, settings, outstanding, monthSpend){
  var result = { runway: null, obligations: [] };
  try{
    if(typeof computeObligationStatuses_ === "function"){
      var feSheet = dbSs_().getSheetByName("FinancialEvents");
      if(feSheet) result.obligations = computeObligationStatuses_(feSheet.getDataRange().getValues(), txnData, today) || [];
    }
  }catch(e1){ result.obligations = []; }
  try{
    if(typeof computeRunway_ === "function" && typeof getRunwayCheckpoint_ === "function" && monthSpend !== null && isFinite(monthSpend)){
      var unpaid = (outstanding && outstanding.total > 0 && !outstanding.isPaid) ? outstanding.total : 0;
      result.runway = computeRunway_({
        txnData: txnData, today: today, now: new Date(),
        checkpoint: getRunwayCheckpoint_(),
        monthSpend: monthSpend,
        monthlyExpensesSetting: settings.monthlyExpenses,
        obligations: result.obligations,
        ccBillAhead: unpaid,
        ccDaysUntil: (outstanding && typeof outstanding.daysUntilDue === "number") ? outstanding.daysUntilDue : null,
        salaryDaySetting: settings.salaryDay
      });
    }
  }catch(e2){ result.runway = null; }
  return result;
}

// The closed bill, worked out from the rows alone (used by the notification line and the reminder, which do not run the whole CC Advisor).
// Paid-ness uses the very same detector as CC Advisor (isCreditCardBillPayment summed over payments after the close, getOutstandingCCPaidTotal_).
function cardCoachOutstanding_(txnData, today){
  var cycles = cardCoachCycles_(today);
  var w = cycles.closed(0);
  var total = 0;
  cardCoachSwipes_(txnData).forEach(function(s){ if(cardCoachInWindow_(s, w.start, w.end)) total += s.amount; });
  var paidTotal = 0;
  if(total > 0 && typeof getOutstandingCCPaidTotal_ === "function") paidTotal = getOutstandingCCPaidTotal_(txnData, w.end);
  var isPaid = total > 0 && paidTotal >= total - 1;
  var daysUntilDue = Math.ceil((w.due - today) / 86400000);
  return { total: total, isPaid: isPaid, isOverdue: !isPaid && total > 0 && daysUntilDue < 0, daysUntilDue: daysUntilDue, dueDate: w.due };
}

// A coach for callers that do not already have a CC Advisor result (the new-transaction notification). Never throws.
function cardCoachForPush_(txnData, cashData){
  try{
    var settings = getSettings();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var outstanding = cardCoachOutstanding_(txnData, today);
    var monthSpend = null;
    try{
      var m = getMonthlyAnalysis(today.getFullYear(), today.getMonth() + 1, txnData, cashData || [[]]);
      if(m && isFinite(m.totalDebit)) monthSpend = m.totalDebit;
    }catch(ignoreMonth){}
    var g = cardCoachGather_(txnData, today, settings, outstanding, monthSpend);
    return getCardCoach_({
      txnData: txnData, today: today, limit: settings.ccLimit, wantsLimitSetting: settings.cardWantsLimit, settings: settings, cashData: cashData || [],
      outstanding: outstanding, runway: g.runway, obligations: g.obligations,
      isBillWording: (typeof isCreditCardBillWording_ === "function") ? isCreditCardBillWording_ : null
    });
  }catch(err){
    return null;
  }
}

// ---------------------------------------------------------------------
// The one extra line on the new-transaction notification.
// ---------------------------------------------------------------------

// Cheap pre-check on a raw Transactions row, BEFORE any coach is built: only card debits of at least Rs 200, and never a wallet top-up
// or a row already marked as a fixed bill (Rent/EMI/SIP).
function cardCoachPushWanted_(row){
  try{
    if((row[3] || "").toString().toLowerCase() !== "debit") return false;
    if((row[4] || "").toString().toLowerCase().trim().indexOf("card") !== 0) return false;
    if(!(Number(row[5]) >= CARD_COACH_PUSH_MIN_)) return false;
    if((row[17] || "").toString().trim()) return false;
    if(typeof isWalletTopUp === "function" && isWalletTopUp(row[7], row[6])) return false;
    return true;
  }catch(e){ return false; }
}

// "" (say nothing) or one calm sentence. A recurring merchant (listed in coach.fixedMerchants) gets no line.
function cardCoachPushLine_(coach, row){
  try{
    if(!coach || !cardCoachPushWanted_(row)) return "";
    if(coach.safeToPut === null || coach.safeToPut === undefined || coach.tone === "unknown") return "";
    var name = cardCoachNorm_(row[7]);
    if(name && (coach.fixedMerchants || []).some(function(n){ return cardCoachNorm_(n) === name; })) return "";
    var amount = Number(row[5]) || 0;
    if(coach.safeReason === "ok" && coach.safeToPut >= 0) return "Safe left on card: " + cardCoachMoney_(coach.safeToPut) + ".";
    if(coach.safeReason !== "over_by_swipes" || !(coach.safeToPut < 0)) return "";   // "budget_full" / unknown: no line (nothing useful to say per swipe)
    var past = Math.min(amount, -coach.safeToPut);       // only the part of THIS swipe that is past the safe amount
    return "That is " + cardCoachMoney_(past) + " past your safe amount; it comes out of next salary.";
  }catch(e){ return ""; }
}

// ---------------------------------------------------------------------
// Bill reminder: one push when the closed card bill is due within 3 days, once per bill, never when paid.
// ---------------------------------------------------------------------

// Decides, from one person's rows, whether a reminder is due. Returns null or { amount, dueIso, dueDate, daysUntilDue }.
function cardBillReminderCheck_(txnData, today){
  var o = cardCoachOutstanding_(txnData, today);
  if(!(o.total > 0) || o.isPaid) return null;
  if(o.daysUntilDue < 0 || o.daysUntilDue > CARD_BILL_REMIND_DAYS_) return null;
  return { amount: Math.round(o.total), dueIso: cardCoachIso_(o.dueDate), dueDate: o.dueDate, daysUntilDue: o.daysUntilDue };
}

function cardBillReminderMessage_(r){
  var title = r.daysUntilDue === 0 ? "Card bill is due today" : (r.daysUntilDue === 1 ? "Card bill is due tomorrow" : "Card bill due in " + r.daysUntilDue + " days");
  return { title: title, body: "Card bill " + cardCoachMoney_(r.amount) + " is due on " + cardCoachShortDate_(r.dueDate) + ". Pay it in full." };
}

// The daily job (new server: fnTimer.js job "cardbill", about 09:15 India time). Returns how many reminders were sent. Never throws.
// Once per bill per person: the due date of the bill already reminded about is remembered in the shared reminders document.
function cardBillReminderRun_(nowMs){
  var sent = 0;
  try{
    nowMs = nowMs || Date.now();
    var quietFrom = (typeof REMINDER_QUIET_FROM_HOUR_ !== "undefined") ? REMINDER_QUIET_FROM_HOUR_ : 22;
    var quietTo = (typeof REMINDER_QUIET_TO_HOUR_ !== "undefined") ? REMINDER_QUIET_TO_HOUR_ : 8;
    var hour = Number(Utilities.formatDate(new Date(nowMs), "Asia/Kolkata", "HH"));
    if(hour >= quietFrom || hour < quietTo) return 0;                          // quiet hours: nothing, and nothing read
    var people = dailySummaryPeople_();
    if(!people.length) return 0;
    var today = new Date(nowMs); today.setHours(0, 0, 0, 0);
    var expectedDue = cardCoachIso_(cardCoachCycles_(today).closed(0).due);
    var stateDoc = fsGetPathMeta_(CARD_BILL_STATE_DOC_);
    var state = (stateDoc && stateDoc.fields) || {};
    var updates = {};
    people.forEach(function(email){
      try{
        var sk = "cb_" + adminPersonKey_(email) + "_due";                        // field names must start with a letter
        if(String(state[sk] || "") === expectedDue) return;                      // already reminded about this bill
        var token = splitNotifyToken_(email);
        if(!token) return;
        var due = v2dbRun_(email, function(){
          if(String(dbProps_().getProperty("SETTING_CARD_REMINDER_OFF") || "") === "1") return null;      // this person switched it off
          var sheet = dbSs_().getSheetByName("Transactions");
          return cardBillReminderCheck_(sheet ? sheet.getDataRange().getValues() : [[]], today);
        }, { prefetch: ["Transactions", "_Props"] });
        if(!due) return;
        var msg = cardBillReminderMessage_(due);
        var res = sendPushToToken_(token, msg.title, msg.body, { kind: "reminder", tag: "card-bill" });
        if(res && res.sent === false) return;                                    // not delivered: try again next time the job runs
        updates[sk] = due.dueIso;
        sent++;
      }catch(personErr){
        try{ logAI("REMINDER_ERROR", "card bill, one person: " + String(personErr && personErr.message).slice(0, 150)); }catch(ignoreLog){}
      }
    });
    if(Object.keys(updates).length) fsCommit_([{ merge: { path: CARD_BILL_STATE_DOC_, fields: updates, adds: [] } }]);
    try{ fsFlushUsage_(); }catch(ignoreFlush){}
  }catch(err){
    try{ logAI("REMINDER_ERROR", "card bill: " + String(err && err.message).slice(0, 150)); }catch(ignoreLog2){}
  }
  return sent;
}

// Optional: the owner can also run this by hand from the Apps Script editor. It is safe to run any number of times (once per bill).
function checkCardBillReminder(){
  return cardBillReminderRun_();
}
