/* ============================================
   SAVINGS v2 — GOALS-BASED ENGINE
   ============================================
   Replaces the old fixed 4-pot system (Emergency / WishList /
   FreeSavings / CCBuffer) with: Emergency (locked) + Goals (a
   flexible list, one-time or recurring) + Free Savings (the
   default for money with no goal picked yet).

   SavingsAdvisor.js is left untouched — it's dormant Telegram-only
   code, same as AIAdvisor.js / Analysis.js elsewhere in this backend.
   This file is the new engine the PWA is being switched to.

   See docs/features/savings-v2.md for the full design.
============================================ */

const GOAL_TYPE_ONE_TIME  = "OneTime";
const GOAL_TYPE_RECURRING = "Recurring";
const CC_BUFFER_GOAL_NAME = "CC Buffer";
const CC_BUFFER_FALLBACK_TARGET = 6000; // used until 3 real billing cycles exist
const SAVINGS_FREE_SHARE = 0.10;        // Free Savings' constant slice, every stage

/* ============================================
   SHEET ACCESS
============================================ */

function getSavingsSheet_(){
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Savings");
}

function getGoalsSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Goals");
  if(!sheet){
    sheet = ss.insertSheet("Goals");
    sheet.appendRow(["Name","Type","Target","Status","Priority","DateAdded"]);
  }
  return sheet;
}

/* ============================================
   PURE HELPERS — no sheet access, Node-testable
============================================ */

// Sums Savings-sheet rows for a given "pot" value (Emergency / Free /
// a goal's exact name). Positive rows = added, negative = withdrawn.
function sumSavingsByPot_(savingsRows, potName){
  let total = 0;
  for(let i = 0; i < savingsRows.length; i++){
    const pot = (savingsRows[i][4] || "").toString().trim();
    if(pot === potName) total += Number(savingsRows[i][1]) || 0;
  }
  return total;
}

// cycleTotals: array of numbers, one per recent closed billing cycle's
// card spend (oldest or newest order doesn't matter). Zero-spend cycles
// are excluded before averaging (a cycle with no data yet shouldn't drag
// the average toward zero).
function computeCCBufferTargetFromCycles_(cycleTotals, fallback){
  const withData = (cycleTotals || []).filter(function(t){ return t > 0; });
  if(withData.length === 0) return fallback;
  const sum = withData.reduce(function(a, b){ return a + b; }, 0);
  return Math.round(sum / withData.length);
}

// Priority-waterfall split: Emergency -> CC Buffer goal -> priority
// one-time goal -> Free Savings (constant slice throughout). Every
// stage computes the LAST bucket as a remainder, never an independent
// rounded share, so the parts always sum to exactly `amount`.
function computeAutoSplitFromBreakdown_(amount, breakdown){
  amount = Math.round(Number(amount) || 0);
  if(amount <= 0) return { ok:false, error:"Enter a valid amount." };

  const emergencyGap = Math.max(breakdown.emergencyTarget - breakdown.emergency, 0);
  const ccBufferGap  = breakdown.ccBufferGoal
    ? Math.max(breakdown.ccBufferGoal.target - breakdown.ccBufferGoal.saved, 0)
    : 0;
  const goalName = breakdown.priorityGoalName || null;

  let parts;

  if(emergencyGap > 0){
    // Stage 1 — Emergency isn't full yet: building the "don't touch" fund comes first.
    const emergency = Math.round(amount * 0.70);
    const ccBuffer   = Math.round(amount * 0.20);
    parts = {
      emergency: emergency,
      ccBuffer: ccBuffer,
      goal: 0,
      goalName: goalName,
      free: amount - emergency - ccBuffer
    };
  } else if(ccBufferGap > 0){
    // Stage 2 — Emergency full, CC Buffer still building.
    const ccBuffer = Math.round(amount * 0.70);
    const goal      = goalName ? Math.round(amount * 0.20) : 0;
    parts = {
      emergency: 0,
      ccBuffer: ccBuffer,
      goal: goal,
      goalName: goalName,
      free: amount - ccBuffer - goal
    };
  } else {
    // Stage 3 — Emergency and CC Buffer both healthy: focus on the goal.
    const goal = goalName ? Math.round(amount * 0.90) : 0;
    parts = {
      emergency: 0,
      ccBuffer: 0,
      goal: goal,
      goalName: goalName,
      free: amount - goal
    };
  }

  return { ok:true, amount:amount, breakdown:parts };
}

// Manual-split validation — pure, no sheet access. rows: [{destination, amount}]
function validateManualSplit_(amount, rows){
  amount = Number(amount) || 0;
  if(amount <= 0) return { ok:false, error:"Enter a valid amount." };
  if(!Array.isArray(rows) || rows.length === 0){
    return { ok:false, error:"Add at least one destination." };
  }

  let sum = 0;
  for(let i = 0; i < rows.length; i++){
    const rowAmt = Number(rows[i].amount) || 0;
    if(!rows[i].destination) return { ok:false, error:"Every row needs a destination." };
    if(rowAmt <= 0) return { ok:false, error:"Every row needs a valid amount." };
    sum += rowAmt;
  }

  if(sum !== amount){
    return {
      ok:false,
      error:"Amounts add up to ₹" + sum.toLocaleString("en-IN") +
            ", not ₹" + amount.toLocaleString("en-IN") + "."
    };
  }

  return { ok:true };
}

/* ============================================
   READING
============================================ */

// Builds the last N closed billing-cycle (19th->18th) card-spend totals
// from the Transactions sheet, then hands them to the pure averager.
function computeCCBufferTarget_(cyclesToAverage){
  cyclesToAverage = cyclesToAverage || 3;
  const txnSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transactions");
  if(!txnSheet) return CC_BUFFER_FALLBACK_TARGET;

  const data  = txnSheet.getDataRange().getValues();
  const today = new Date();

  let anchorEnd = new Date(today.getFullYear(), today.getMonth(), 18);
  if(today.getDate() < 19) anchorEnd = new Date(today.getFullYear(), today.getMonth() - 1, 18);

  const cycles = [];
  for(let i = 0; i < cyclesToAverage; i++){
    const cycleEnd   = new Date(anchorEnd.getFullYear(), anchorEnd.getMonth() - i, 18);
    const cycleStart = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth() - 1, 19);
    cycles.push({ start: cycleStart, end: cycleEnd, total: 0 });
  }

  for(let i = 1; i < data.length; i++){
    const rawDate = data[i][0];
    if(!rawDate) continue;
    const d = new Date(rawDate);

    const type   = (data[i][3] || "").toString().toLowerCase();
    const mode   = (data[i][4] || "").toString().toLowerCase();
    const amount = Number(data[i][5]) || 0;
    if(type !== "debit" || !mode.startsWith("card") || amount <= 0) continue;

    for(let c = 0; c < cycles.length; c++){
      if(d >= cycles[c].start && d <= cycles[c].end){
        cycles[c].total += amount;
        break;
      }
    }
  }

  return computeCCBufferTargetFromCycles_(cycles.map(function(c){ return c.total; }), CC_BUFFER_FALLBACK_TARGET);
}

function getGoalsList_(goalsSheet, savingsRows){
  const data = goalsSheet.getDataRange().getValues();
  const goals = [];

  for(let i = 1; i < data.length; i++){
    const name = (data[i][0] || "").toString().trim();
    if(!name) continue;

    const type       = (data[i][1] || GOAL_TYPE_ONE_TIME).toString().trim();
    const rawTarget  = Number(data[i][2]) || 0;
    const status     = (data[i][3] || "Active").toString().trim();
    const priorityVal = data[i][4];
    const priority   = priorityVal === true || (priorityVal || "").toString().trim().toUpperCase() === "TRUE";
    const dateAdded  = data[i][5] || "";

    const saved = sumSavingsByPot_(savingsRows, name);
    const target = type === GOAL_TYPE_RECURRING ? computeCCBufferTarget_() : rawTarget;

    goals.push({
      row: i + 1,
      name: name,
      type: type,
      target: target,
      saved: saved,
      remaining: Math.max(target - saved, 0),
      canAfford: target > 0 && saved >= target,
      status: status,
      priority: priority,
      dateAdded: dateAdded
    });
  }

  return goals;
}

// Newest-first, for the Recent Activity list — includes the row number
// so the frontend can edit/delete a specific entry.
function getRecentSavingsEntries_(savSheet, limit){
  limit = limit || 15;
  const data = savSheet.getDataRange().getValues();
  const entries = [];

  for(let i = data.length - 1; i >= 1; i--){
    const row = data[i];
    if(!row[0] && !row[1]) continue;
    entries.push({
      row: i + 1,
      date: row[0] instanceof Date ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd") : row[0],
      amount: Number(row[1]) || 0,
      type: row[2] || "",
      note: row[3] || "",
      destination: row[4] || ""
    });
    if(entries.length >= limit) break;
  }

  return entries;
}

function getSavingsBreakdown(){
  const savSheet   = getSavingsSheet_();
  const goalsSheet = getGoalsSheet_();
  const settings   = getSettings();

  const savingsRows = savSheet.getDataRange().getValues().slice(1);

  const emergency       = sumSavingsByPot_(savingsRows, "Emergency");
  const emergencyTarget = settings.monthlyExpenses * 3;
  const free             = sumSavingsByPot_(savingsRows, "Free");

  const goals = getGoalsList_(goalsSheet, savingsRows);
  const ccBufferGoal = goals.find(function(g){ return g.type === GOAL_TYPE_RECURRING; }) || null;
  const priorityGoal =
    goals.find(function(g){ return g.type === GOAL_TYPE_ONE_TIME && g.status === "Active" && g.priority; }) ||
    goals.find(function(g){ return g.type === GOAL_TYPE_ONE_TIME && g.status === "Active"; }) ||
    null;

  // Valid destination names for Manual split / Withdraw / edit-entry
  // dropdowns — Emergency, Free, and every still-active goal.
  const destinations = ["Emergency"].concat(
    goals.filter(function(g){ return g.status === "Active"; }).map(function(g){ return g.name; })
  ).concat(["Free"]);

  return {
    recentEntries: getRecentSavingsEntries_(savSheet, 15),
    destinations: destinations,
    emergency: emergency,
    emergencyTarget: emergencyTarget,
    emergencyDone: emergency >= emergencyTarget,
    free: free,
    goals: goals,
    ccBufferGoal: ccBufferGoal,
    priorityGoalName: priorityGoal ? priorityGoal.name : null
  };
}

/* ============================================
   AUTO SPLIT
============================================ */

// Preview only — used to show the breakdown before the user confirms.
function previewAutoSplit(amount){
  return computeAutoSplitFromBreakdown_(amount, getSavingsBreakdown());
}

function saveAutoSplit(amount, note){
  const preview = previewAutoSplit(amount);
  if(!preview.ok) return preview;

  const savSheet  = getSavingsSheet_();
  const today     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const cleanNote = note || "";
  const b = preview.breakdown;

  if(b.emergency > 0) savSheet.appendRow([today, b.emergency, "auto", cleanNote, "Emergency"]);
  if(b.ccBuffer  > 0) savSheet.appendRow([today, b.ccBuffer,  "auto", cleanNote, CC_BUFFER_GOAL_NAME]);
  if(b.goal > 0 && b.goalName) savSheet.appendRow([today, b.goal, "auto", cleanNote, b.goalName]);
  if(b.free > 0) savSheet.appendRow([today, b.free, "auto", cleanNote, "Free"]);

  return { ok:true, breakdown:b };
}

/* ============================================
   MANUAL SPLIT
============================================ */

function saveManualSplit(amount, rows, note){
  const check = validateManualSplit_(amount, rows);
  if(!check.ok) return check;

  const savSheet  = getSavingsSheet_();
  const today     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const cleanNote = note || "";

  rows.forEach(function(r){
    savSheet.appendRow([today, Number(r.amount), "manual", cleanNote, r.destination]);
  });

  return { ok:true };
}

/* ============================================
   WITHDRAW
============================================ */

function withdrawSaving(bucket, amount, note){
  amount = Number(amount) || 0;
  if(!bucket) return { ok:false, error:"Pick where to withdraw from." };
  if(amount <= 0) return { ok:false, error:"Enter a valid amount." };

  const savSheet    = getSavingsSheet_();
  const savingsRows = savSheet.getDataRange().getValues().slice(1);
  const available   = sumSavingsByPot_(savingsRows, bucket);

  if(amount > available){
    return { ok:false, error:"Only ₹" + Math.round(available).toLocaleString("en-IN") + " available there." };
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  savSheet.appendRow([today, -amount, "withdraw", note || "", bucket]);

  return { ok:true, remaining: available - amount };
}

// Convenience wrapper for buying a one-time goal in full: withdraws its
// saved amount and marks it Done in one step.
function purchaseGoal(row, name, amount){
  const result = withdrawSaving(name, amount, "Purchased: " + name);
  if(!result.ok) return result;
  return markGoalDone(row);
}

/* ============================================
   ONE-TIME MIGRATION — 2026-08-11
   Run once, manually, from the Apps Script editor (not called by the
   PWA). Brings the user's fresh-start data (they'd already cleared
   Savings down to one "Starting balance" row and left WishList as-is)
   into the new Goals-based shape:
     1. Each active WishList item -> a OneTime goal (High-priority
        items first, so the cheapest High item becomes the default
        Auto Split priority goal).
     2. A Recurring "CC Buffer" goal, so the waterfall has something
        to fund once Emergency is done.
     3. The single un-potted Savings row gets run through Auto Split
        (Stage 1, since Emergency is at ₹0) and replaced with the
        resulting per-bucket rows, same date/type/note preserved.
   Safe to run only once — running it again would duplicate goals and
   re-split whatever the first migrated row turned into (which by then
   has a pot set, so the "find the first un-potted row" step would just
   find nothing and skip step 3, but goals would still duplicate). If
   ever needed again, clear the Goals sheet first.
============================================ */

function migrateSavingsToV2(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const wishSheet = ss.getSheetByName("WishList");
  const savSheet  = getSavingsSheet_();

  const log = [];

  // ── 1. Active WishList items -> OneTime goals, High priority first ──
  const wishData = wishSheet ? wishSheet.getDataRange().getValues() : [];
  const items = [];
  for(let i = 1; i < wishData.length; i++){
    const item     = (wishData[i][0] || "").toString().trim();
    const price    = Number(wishData[i][1]) || 0;
    const priority = (wishData[i][2] || "Medium").toString().trim();
    const status   = (wishData[i][3] || "Active").toString().trim();
    if(!item || status !== "Active") continue;
    items.push({ item: item, price: price, priority: priority });
  }

  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  items.sort(function(a, b){
    const ra = priorityRank[a.priority] === undefined ? 1 : priorityRank[a.priority];
    const rb = priorityRank[b.priority] === undefined ? 1 : priorityRank[b.priority];
    return ra - rb;
  });

  items.forEach(function(it){
    const result = addGoal(it.item, GOAL_TYPE_ONE_TIME, it.price);
    log.push("Goal added: " + it.item + " (₹" + it.price + ") -> " + JSON.stringify(result));
  });

  // ── 2. CC Buffer, a Recurring goal ──
  const ccResult = addGoal(CC_BUFFER_GOAL_NAME, GOAL_TYPE_RECURRING, 0);
  log.push("CC Buffer goal added -> " + JSON.stringify(ccResult));

  // ── 3. Split the existing un-potted Savings row via Auto Split ──
  const savData = savSheet.getDataRange().getValues();
  let startingRowIndex = -1;
  let startingRow = null;
  for(let i = 1; i < savData.length; i++){
    const pot = (savData[i][4] || "").toString().trim();
    if(!pot){ startingRow = savData[i]; startingRowIndex = i + 1; break; }
  }

  if(startingRow){
    const amount = Number(startingRow[1]) || 0;
    const preview = previewAutoSplit(amount);

    if(preview.ok){
      const date = startingRow[0];
      const type = startingRow[2] || "";
      const note = startingRow[3] || "Starting balance";
      const b = preview.breakdown;

      savSheet.deleteRow(startingRowIndex);

      if(b.emergency > 0) savSheet.appendRow([date, b.emergency, type, note, "Emergency"]);
      if(b.ccBuffer  > 0) savSheet.appendRow([date, b.ccBuffer,  type, note, CC_BUFFER_GOAL_NAME]);
      if(b.goal > 0 && b.goalName) savSheet.appendRow([date, b.goal, type, note, b.goalName]);
      if(b.free > 0) savSheet.appendRow([date, b.free, type, note, "Free"]);

      log.push("Starting balance ₹" + amount + " split -> " + JSON.stringify(b));
    } else {
      log.push("Could not split starting balance: " + preview.error);
    }
  } else {
    log.push("No un-potted starting row found — nothing to split.");
  }

  Logger.log(log.join("\n"));
  return { ok:true, log: log };
}

/* ============================================
   EDIT / DELETE PAST ENTRIES
============================================ */

function updateSavingsEntry(row, amount, note, destination){
  const savSheet = getSavingsSheet_();
  if(!Number.isInteger(row) || row < 2 || row > savSheet.getLastRow()){
    return { ok:false, error:"Invalid row." };
  }
  if(!amount || Number(amount) === 0){
    return { ok:false, error:"Enter a valid amount." };
  }
  if(!destination) return { ok:false, error:"Pick a destination." };

  savSheet.getRange(row, 2).setValue(Number(amount));
  savSheet.getRange(row, 4).setValue(note || "");
  savSheet.getRange(row, 5).setValue(destination);

  return { ok:true };
}

function deleteSavingsEntry(row){
  const savSheet = getSavingsSheet_();
  if(!Number.isInteger(row) || row < 2 || row > savSheet.getLastRow()){
    return { ok:false, error:"Invalid row." };
  }
  savSheet.deleteRow(row);
  return { ok:true };
}

/* ============================================
   GOAL MANAGEMENT
============================================ */

function addGoal(name, type, target){
  name = (name || "").toString().trim();
  type = type === GOAL_TYPE_RECURRING ? GOAL_TYPE_RECURRING : GOAL_TYPE_ONE_TIME;

  if(!name) return { ok:false, error:"Enter a goal name." };
  if(type === GOAL_TYPE_ONE_TIME && (!target || Number(target) <= 0)){
    return { ok:false, error:"Enter a target amount." };
  }

  const goalsSheet = getGoalsSheet_();
  const data = goalsSheet.getDataRange().getValues();

  const hasActiveOneTime = data.slice(1).some(function(r){
    return (r[1] || "") === GOAL_TYPE_ONE_TIME && (r[3] || "Active") === "Active";
  });

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  goalsSheet.appendRow([
    name,
    type,
    type === GOAL_TYPE_ONE_TIME ? Number(target) : "",
    "Active",
    (type === GOAL_TYPE_ONE_TIME && !hasActiveOneTime), // first active one-time goal defaults to priority
    today
  ]);

  return { ok:true };
}

function setPriorityGoal(row){
  const goalsSheet = getGoalsSheet_();
  if(!Number.isInteger(row) || row < 2 || row > goalsSheet.getLastRow()){
    return { ok:false, error:"Invalid row." };
  }

  const data = goalsSheet.getDataRange().getValues();
  for(let i = 1; i < data.length; i++){
    const type = (data[i][1] || "").toString().trim();
    if(type !== GOAL_TYPE_ONE_TIME) continue;
    goalsSheet.getRange(i + 1, 5).setValue(i + 1 === row);
  }

  return { ok:true };
}

function markGoalDone(row){
  const goalsSheet = getGoalsSheet_();
  if(!Number.isInteger(row) || row < 2 || row > goalsSheet.getLastRow()){
    return { ok:false, error:"Invalid row." };
  }
  goalsSheet.getRange(row, 4).setValue("Done");
  goalsSheet.getRange(row, 5).setValue(false);
  return { ok:true };
}
