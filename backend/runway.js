/* ============================================
   HOME "RUN-OUT DATE" (added 2026-10-17)
   "At your current pace your money lasts until Oct 26."

   The app cannot see the real bank balance, so it asks: the person confirms
   (or types) what they have in the bank. That becomes a CHECKPOINT (amount +
   moment). From then on the app rolls it forward itself: checkpoint, plus
   money that came in, minus money that left the bank (card swipes do not
   leave the bank until the bill is paid, so they are skipped here - the bill
   payment itself is a normal bank debit).

   Run-out date = (balance - bills still ahead) / usual daily spend.
   Bills ahead = the closed, unpaid card bill + Rent/EMI/SIP expected and not
   yet paid this month. Salary day is per person: typed in Settings, or worked
   out from that person's own Income credits.

   computeRunway_ is a pure function (no Sheets/Properties), tested in
   backend/tests/runway.test.js.
============================================ */

var RUNWAY_STALE_DAYS_ = 7;

function runwayRowTime_(row){
  var raw = row[0];
  if(!raw) return null;
  var d = new Date(raw);
  if(isNaN(d.getTime())) return null;
  var t = (row[1] || "").toString().match(/(\d{1,2}):(\d{2})/);
  if(t) d.setHours(Number(t[1]), Number(t[2]), 0, 0);
  return d;
}

// Money that really moved in the bank after the checkpoint moment.
function runwayRollForward_(txnData, checkpointMs){
  var net = 0;
  for(var i = 1; i < txnData.length; i++){
    var when = runwayRowTime_(txnData[i]);
    if(!when || when.getTime() <= checkpointMs) continue;
    var type = (txnData[i][3] || "").toString().toLowerCase();
    var mode = (txnData[i][4] || "").toString().toLowerCase().trim();
    if(mode.indexOf("card") === 0 || mode === "wallet") continue;   // card swipe/credit and wallet spend: not a bank movement (the wallet top-up itself is the bank debit)
    var amount = Number(txnData[i][5]) || 0;
    if(type === "credit") net += amount;
    else if(type === "debit") net -= amount;
  }
  return net;
}

// Usual salary day: the day of month on which the biggest Income credit of each recent month landed.
function runwayDetectSalaryDay_(txnData){
  var biggest = {};   // "yyyy-m" -> { amount, day }
  for(var i = 1; i < txnData.length; i++){
    if(!txnData[i][0]) continue;
    if((txnData[i][3] || "").toString().toLowerCase() !== "credit") continue;
    if((txnData[i][13] || "").toString().trim() !== "Income") continue;
    var d = new Date(txnData[i][0]);
    if(isNaN(d.getTime())) continue;
    var amount = Number(txnData[i][5]) || 0;
    var key = d.getFullYear() + "-" + d.getMonth();
    if(!biggest[key] || amount > biggest[key].amount) biggest[key] = { amount: amount, day: d.getDate(), sort: d.getFullYear() * 12 + d.getMonth() };
  }
  var months = Object.keys(biggest).map(function(k){ return biggest[k]; })
    .sort(function(a, b){ return b.sort - a.sort; }).slice(0, 4);
  if(months.length < 2) return null;
  return mostCommonDayOfMonth_(months.map(function(m){ return m.day; }));
}

function runwayNextDayOfMonth_(today, day){
  var c = new Date(today.getFullYear(), today.getMonth(), clampDayToMonth_(today.getFullYear(), today.getMonth(), day));
  if(c <= today){
    var m = today.getMonth() + 1, y = today.getFullYear();
    if(m > 11){ m = 0; y++; }
    c = new Date(y, m, clampDayToMonth_(y, m, day));
  }
  return c;
}

function runwayIso_(d){
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}

/*
  input: {
    txnData, today (Date at midnight), now (Date),
    checkpoint: { amount, atMs } | null,
    monthSpend, monthlyExpensesSetting,
    obligations: computeObligationStatuses_ output,
    ccBillAhead: unpaid closed card bill amount (0 if none),
    salaryDaySetting: number | 0
  }
*/
function computeRunway_(input){
  var today = input.today, now = input.now || new Date();
  var dayOfMonth = today.getDate();

  var pace = dayOfMonth >= 5
    ? input.monthSpend / dayOfMonth
    : (Number(input.monthlyExpensesSetting) || 0) / 30;
  pace = Math.round(pace);

  var salaryDay = Number(input.salaryDaySetting) || runwayDetectSalaryDay_(input.txnData);
  var salaryDate = salaryDay ? runwayNextDayOfMonth_(today, salaryDay) : null;
  var daysToSalary = salaryDate ? Math.round((salaryDate - today) / 86400000) : null;

  var out = {
    hasCheckpoint: !!input.checkpoint,
    askBalance: true,
    estimatedBalance: null,
    checkpointAt: null,
    checkpointAgeDays: null,
    dailyPace: pace,
    billsAhead: 0,
    bills: [],
    runOutDate: null,
    daysLeft: null,
    salaryDay: salaryDay || null,
    salaryDate: salaryDate ? runwayIso_(salaryDate) : null,
    daysToSalary: daysToSalary,
    shortByDays: null,
    maxPerDay: null
  };
  if(!input.checkpoint) return out;

  var ageDays = Math.floor((now.getTime() - input.checkpoint.atMs) / 86400000);
  out.checkpointAt = new Date(input.checkpoint.atMs).toISOString();
  out.checkpointAgeDays = ageDays;
  out.askBalance = ageDays > RUNWAY_STALE_DAYS_;

  var balance = Math.max(0, Math.round(input.checkpoint.amount + runwayRollForward_(input.txnData, input.checkpoint.atMs)));   // never negative, so "Yes, that's right" can always be saved
  out.estimatedBalance = balance;

  // Bills still ahead (stop at salary day, or 35 days if the salary day is unknown).
  var horizon = daysToSalary !== null ? daysToSalary : 35;
  var bills = [];
  // The card bill follows the same "due before salary" rule as the other bills (2026-10-18): a bill that falls due AFTER the next
  // salary is paid out of that salary, so it must not be held against the balance you have now. Unchanged when the salary day is
  // unknown (daysToSalary null) or the bill's due date is unknown (always counted then, the safe side).
  var ccDays = input.ccDaysUntil;
  var ccDueAfterSalary = daysToSalary !== null && typeof ccDays === "number" && ccDays > daysToSalary;
  if(input.ccBillAhead > 0 && !ccDueAfterSalary) bills.push({ label: "Card bill", amount: Math.round(input.ccBillAhead), daysUntil: input.ccDaysUntil === undefined ? null : input.ccDaysUntil });
  (input.obligations || []).forEach(function(o){
    if(!o.enoughHistory || o.alreadyThisMonth) return;
    if(o.daysUntil > horizon) return;
    bills.push({ label: o.label, amount: Math.round(o.avgAmount), daysUntil: o.daysUntil });
  });
  var billsAhead = bills.reduce(function(s, b){ return s + b.amount; }, 0);
  out.bills = bills;
  out.billsAhead = billsAhead;

  var available = balance - billsAhead;
  if(pace > 0){
    var days = available <= 0 ? 0 : Math.floor(available / pace);
    out.daysLeft = days;
    var runOut = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
    out.runOutDate = runwayIso_(runOut);
    if(daysToSalary !== null){
      if(days < daysToSalary) out.shortByDays = daysToSalary - days;
      out.maxPerDay = daysToSalary > 0 ? Math.max(0, Math.floor(available / daysToSalary)) : null;
    }
  }
  return out;
}

// Reads the stored checkpoint (per person - dbProps_ is already per person).
function getRunwayCheckpoint_(){
  var props = dbProps_();
  var amount = props.getProperty("RUNWAY_BALANCE");
  var at = Number(props.getProperty("RUNWAY_BALANCE_AT"));
  if(amount === null || amount === "" || !at) return null;
  return { amount: Number(amount) || 0, atMs: at };
}

// "Yes, that's right" sends the estimate back; "Enter real amount" sends what was typed.
function saveRunwayBalance(amount){
  try{
    if(amount === null || amount === undefined || String(amount).trim() === "") return { ok: false, error: "Enter a valid amount." };
    var n = Number(amount);
    if(!isFinite(n) || n < 0 || n > 1e9) return { ok: false, error: "Enter a valid amount." };
    var props = dbProps_();
    props.setProperty("RUNWAY_BALANCE", String(Math.round(n)));
    props.setProperty("RUNWAY_BALANCE_AT", String(Date.now()));
    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}

// Home's "Latest" list: the newest 5 real rows (the sheet is appended in time order). Never throws.
function buildLatestForDashboard_(txnData){
  try{
    var out = [];
    for(var i = txnData.length - 1; i >= 1 && out.length < 5; i--){
      var r = txnData[i];
      var amount = Number(r[5]) || 0;
      if(!r[0] || !amount) continue;                         // blank / cleared rows
      out.push({
        label: ((r[12] || "").toString().trim()) || ((r[7] || "").toString().trim()) || (r[2] || "").toString(),
        category: (r[13] || "").toString().trim(),
        amount: amount,
        type: (r[3] || "").toString().toLowerCase() === "credit" ? "credit" : "debit"
      });
    }
    return out;
  }catch(err){ return []; }
}

// Called from getDashboardData. Never throws: the Home screen must load without it.
function buildRunwayForDashboard_(txnData, month, cc){
  try{
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var feSheet = dbSs_().getSheetByName("FinancialEvents");
    var obligations = feSheet ? computeObligationStatuses_(feSheet.getDataRange().getValues(), txnData, today) : [];
    var settings = getSettings();
    var ccAhead = (cc && cc.outstanding && !cc.outstanding.isPaid) ? (Number(cc.outstanding.amount) || 0) : 0;
    return computeRunway_({
      txnData: txnData, today: today, now: new Date(),
      checkpoint: getRunwayCheckpoint_(),
      monthSpend: month.totalDebit,
      monthlyExpensesSetting: settings.monthlyExpenses,
      obligations: obligations,
      ccBillAhead: ccAhead,
      ccDaysUntil: (cc && cc.outstanding && typeof cc.outstanding.daysUntilDue === "number") ? cc.outstanding.daysUntilDue : null,
      salaryDaySetting: settings.salaryDay
    });
  }catch(err){
    try{ logAI("RUNWAY_ERROR", err.toString()); }catch(ignore){}
    return null;
  }
}
