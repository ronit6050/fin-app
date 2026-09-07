/* ============================================
   PLANNER (Phase 1) — added 2026-08-18
   ============================================
   A screen where you set a spend TARGET per category for the month, then
   see actual spend tracked against it as the month goes.

   Plain-English summary: for each of your real spend categories (Food,
   Transport, Bills, etc — everything except Income), Planner suggests a
   monthly target, lets you save your own number instead, and shows how
   much you've actually spent so far. A category only gets split into
   separate Need/Want targets (e.g. "Food: Need ₹4,500 / Want ₹3,000")
   when your OWN transaction history for that category has really shown
   both kinds of spend — nothing is hand-picked.

   See docs/features/planner.md for the full design, the exact request/
   response shapes the frontend build needs, and why the suggestion
   formula works the way it does.

   New sheet: Budgets — one row per category (or per category+Need/Want
   sub-target) per month. Columns: Month (YYYY-MM), Category, Type
   ("Need"/"Want"/"" for a whole-category target), Target. Auto-created
   on first use, same pattern as InvestmentInstruments/Goals.

   IMPORTANT — reuses the SAME spend-exclusion rules getMonthlyAnalysis
   already uses (isCreditCardBillPayment/isWalletTopUp/isLendingTransfer/
   a confirmed Financial Event), so Planner can never reintroduce the
   double-counting bugs this project has already hit and fixed multiple
   times (credit card bill payments, wallet top-ups, lending transfers,
   Rent/EMI/Investment all being counted as ordinary category spend).
============================================ */

// Every real spend category — reuses category.js's own SMART_CATEGORIES
// list (never a separate hand-typed copy, so Planner automatically stays
// in sync if that list ever changes) minus "Income", which isn't spend.
const PLANNER_CATEGORIES = Object.keys(SMART_CATEGORIES).filter(function(c){ return c !== "Income"; });

// The Need/Want/Saving/Investment tagging system only became reliable
// starting this month — see docs/features/need-want-saving.md's history
// (the sliding-window redesign, the lending-substring bug, the
// counterparty-gating bug were all fixed as late as 2026-08-09/10).
// Never average in anything from before this date. Written as a plain
// {year, month} pair (not a hardcoded "if August" check) so this keeps
// working correctly on its own as real months pass — nothing here needs
// touching again once September/October/etc. actually happen.
const PLANNER_RELIABLE_START = { year: 2026, month: 8 };

// The standard 50/30/20 budgeting rule of thumb — shown as a REFERENCE
// only (like your old manual budget sheet used to do), never enforced.
// Not user-editable yet; revisit if that's ever asked for.
const PLANNER_REFERENCE_SPLIT = { Need: 0.5, Want: 0.3, SavingsInvestment: 0.2 };

// The one pseudo-"category" name used to store a saved income override in
// the Budgets sheet, alongside real spend categories. Deliberately starts
// with "_" so it can never collide with a real category name, and is
// excluded from PLANNER_CATEGORIES so it's never offered as something to
// set a spend target for.
const PLANNER_INCOME_KEY = "_Income";

/* ============================================
   SHEET ACCESS
============================================ */

function getBudgetsSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Budgets");
  if(!sheet){
    sheet = ss.insertSheet("Budgets");
    sheet.appendRow(["Month", "Category", "Type", "Target"]);
  }
  return sheet;
}

// category -> { "": target, "Need": target, "Want": target } — only keys
// that actually have a saved row are present, so the caller can tell
// "saved as 0" apart from "never saved at all".
function getSavedBudgetsForMonth_(monthKey, budgetsData){
  const data = budgetsData || getBudgetsSheet_().getDataRange().getValues();
  const map = {};
  for(let i = 1; i < data.length; i++){
    const rowMonth = (data[i][0] || "").toString().trim();
    if(rowMonth !== monthKey) continue;
    const category = (data[i][1] || "").toString().trim();
    const type = (data[i][2] || "").toString().trim(); // "", "Need", or "Want"
    const target = Number(data[i][3]) || 0;
    if(!map[category]) map[category] = {};
    map[category][type] = target;
  }
  return map;
}

/* ============================================
   MONTH HELPERS
============================================ */

function formatPlannerMonth_(year, month){
  return year + "-" + String(month).padStart(2, "0");
}

// Validates a "YYYY-MM" string. Returns the same string back if valid,
// or null — never trust a month string from the frontend without
// checking it server-side (same defensive pattern used throughout this
// project, e.g. validateInvestmentInstrumentName_ in investmentInstruments.js).
function normalizePlannerMonth_(monthStr){
  const m = (monthStr || "").toString().trim();
  if(!/^\d{4}-\d{2}$/.test(m)) return null;
  const mm = Number(m.slice(5, 7));
  if(mm < 1 || mm > 12) return null;
  return m;
}

// Parses a "YYYY-MM" string into {year, month, key}, defaulting to the
// real current month (today) when missing/invalid — matches the "month
// (YYYY-MM, default current month)" contract for getPlannerData.
function parsePlannerMonthOrDefault_(monthStr, today){
  const normalized = normalizePlannerMonth_(monthStr);
  if(normalized){
    return { year: Number(normalized.slice(0, 4)), month: Number(normalized.slice(5, 7)), key: normalized };
  }
  const year = today.getFullYear(), month = today.getMonth() + 1;
  return { year: year, month: month, key: formatPlannerMonth_(year, month) };
}

// Every COMPLETE calendar month from the reliable start date up to (but
// NOT including) the real current month, oldest first. "Complete" means
// the month has genuinely finished — today being partway through the
// current month never counts it as complete, even on the very last day.
function getCompleteReliableMonths_(today){
  const months = [];
  let y = PLANNER_RELIABLE_START.year, m = PLANNER_RELIABLE_START.month;
  const curY = today.getFullYear(), curM = today.getMonth() + 1;
  while(y < curY || (y === curY && m < curM)){
    months.push({ year: y, month: m });
    m++;
    if(m > 12){ m = 1; y++; }
  }
  return months;
}

// Real income (Type=credit, Category=Income) actually received in the
// given calendar month — same rule getCCAdvisorData already uses for its
// own "recentIncome" figure (PWA.js), just for a whole calendar month
// instead of a rolling 35-day window. Cash entries are never Income —
// checked against this project's real categories, income only ever
// arrives via a bank transaction.
function computeMonthActualIncome_(txnData, year, month){
  let income = 0;
  for(let i = 1; i < txnData.length; i++){
    const rawDate = txnData[i][0];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(d.getFullYear() !== year || (d.getMonth() + 1) !== month) continue;
    const type = (txnData[i][3] || "").toString().toLowerCase();
    const cat  = (txnData[i][13] || "").toString().trim();
    if(type === "credit" && cat === "Income") income += Number(txnData[i][5]) || 0;
  }
  return income;
}

/* ============================================
   CATEGORY x TYPE SPEND BREAKDOWN
   ============================================
   One shared, parameterized function instead of three separate
   near-duplicates (this month's actual spend / historical months for
   the suggestion / the scaled-partial-month fallback) — matchesDate is
   the only thing that changes between callers. Mirrors
   getMonthlyAnalysis's own debit-only loops over Transactions + Cash,
   including every one of its existing spend-exclusion rules, but tracks
   spend per-CATEGORY-and-per-TYPE instead of one aggregated total — that
   per-category Need/Want split is the one thing getMonthlyAnalysis
   doesn't already return, which is the actual reason this couldn't just
   call that function directly for everything.
============================================ */

function plannerZeroBucket_(){
  return { Need: 0, Want: 0, Saving: 0, Investment: 0, Untagged: 0, total: 0 };
}

// matchesDate(dateObj) -> bool decides which rows count at all. Returns
// { category: {Need, Want, Saving, Investment, Untagged, total} }, one
// entry per PLANNER_CATEGORIES category that had at least one matching
// row (categories with zero matching spend simply aren't keys here —
// callers should default to plannerZeroBucket_() for any missing key).
function computeCategoryTypeBreakdown_(txnData, cashData, matchesDate){
  const result = {};
  function bucketFor(cat){
    if(!result[cat]) result[cat] = plannerZeroBucket_();
    return result[cat];
  }

  for(let i = 1; i < txnData.length; i++){
    const rawDate = txnData[i][0];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(!matchesDate(d)) continue;

    const type = (txnData[i][3] || "").toString().toLowerCase();
    if(type !== "debit") continue; // Planner only ever tracks spend, never income

    const mode         = txnData[i][4]  || "";
    const amount        = Number(txnData[i][5]) || 0;
    const reference      = txnData[i][6]  || "";
    const counterparty    = txnData[i][7]  || "";
    const note         = txnData[i][12] || "";
    const category       = (txnData[i][13] || "Other").toString().trim();
    const financialEvent   = (txnData[i][17] || "").toString().trim(); // column R

    // Same exclusion rules getMonthlyAnalysis already uses — see that
    // function's own comments (PWA.js) for the full history of why each
    // one exists (a credit card bill payment, a wallet top-up, and a
    // lending transfer were all real double-counting bugs found and
    // fixed here before; a confirmed Rent/EMI/Investment is tracked
    // separately, never blended into day-to-day category spend).
    if(isCreditCardBillPayment(mode, counterparty, note)) continue;
    if(isWalletTopUp(counterparty, reference)) continue;
    if(isLendingTransfer(counterparty, note)) continue;
    if(financialEvent) continue;

    if(PLANNER_CATEGORIES.indexOf(category) === -1) continue; // "Income" or anything unrecognized — not a Planner category

    const bucket = bucketFor(category);
    bucket.total += amount;
    const savedType = (txnData[i][16] || "").toString().trim(); // column Q
    if(bucket.hasOwnProperty(savedType) && savedType) bucket[savedType] += amount;
    else bucket.Untagged += amount;
  }

  for(let i = 1; i < cashData.length; i++){
    const rawDate = cashData[i][1];
    if(!rawDate) continue;
    const d = new Date(rawDate);
    if(!matchesDate(d)) continue;

    const type = (cashData[i][3] || "").toString().toLowerCase();
    if(type !== "debit") continue;

    const amount   = Number(cashData[i][4]) || 0;
    const category = (cashData[i][6] || "Other").toString().trim();
    if(PLANNER_CATEGORIES.indexOf(category) === -1) continue;

    const bucket = bucketFor(category);
    bucket.total += amount;
    const savedType = (cashData[i][10] || "").toString().trim(); // column K
    if(bucket.hasOwnProperty(savedType) && savedType) bucket[savedType] += amount;
    else bucket.Untagged += amount;
  }

  return result;
}

function mergeCategoryBreakdown_(target, source){
  Object.keys(source).forEach(function(cat){
    if(!target[cat]) target[cat] = plannerZeroBucket_();
    Object.keys(source[cat]).forEach(function(key){
      target[cat][key] += source[cat][key];
    });
  });
  return target;
}

function divideCategoryBreakdown_(breakdown, n){
  const out = {};
  Object.keys(breakdown).forEach(function(cat){
    out[cat] = {};
    Object.keys(breakdown[cat]).forEach(function(key){
      out[cat][key] = breakdown[cat][key] / n;
    });
  });
  return out;
}

function scaleCategoryBreakdown_(breakdown, factor){
  const out = {};
  Object.keys(breakdown).forEach(function(cat){
    out[cat] = {};
    Object.keys(breakdown[cat]).forEach(function(key){
      out[cat][key] = breakdown[cat][key] * factor;
    });
  });
  return out;
}

/* ============================================
   SUGGESTED TARGET
   ============================================
   Prefers averaging up to the last 3 COMPLETE reliable months. Right
   now (the reliable window's very first month, August 2026, is still
   in progress) there are zero complete months yet — falls back to:
   real reliable spend so far this month, scaled up to a full-month
   estimate (divide by days elapsed, multiply by days in the month).
   Never returns a blank/no-suggestion state, even with almost no data
   yet. As real complete months accumulate (September onward), this
   naturally shifts to averaging those instead — nothing here needs a
   manual update when that happens.
============================================ */
function computeSuggestedTargets_(txnData, cashData, today){
  const reliableStart = new Date(PLANNER_RELIABLE_START.year, PLANNER_RELIABLE_START.month - 1, 1);
  const completeMonths = getCompleteReliableMonths_(today).slice(-3); // most recent up to 3

  if(completeMonths.length > 0){
    let sum = {};
    completeMonths.forEach(function(ym){
      const monthBreakdown = computeCategoryTypeBreakdown_(txnData, cashData, function(d){
        return d.getFullYear() === ym.year && (d.getMonth() + 1) === ym.month;
      });
      sum = mergeCategoryBreakdown_(sum, monthBreakdown);
    });
    return {
      source: "average",
      monthsUsed: completeMonths.length,
      breakdown: divideCategoryBreakdown_(sum, completeMonths.length)
    };
  }

  // Zero complete reliable months yet — scale the partial data available
  // so far this month up to a full-month estimate.
  const y = today.getFullYear(), m = today.getMonth() + 1;
  const dayOfMonth  = today.getDate();
  const daysInMonth = new Date(y, m, 0).getDate();

  const partial = computeCategoryTypeBreakdown_(txnData, cashData, function(d){
    return d >= reliableStart && d.getFullYear() === y && (d.getMonth() + 1) === m && d.getDate() <= dayOfMonth;
  });
  const factor = dayOfMonth > 0 ? (daysInMonth / dayOfMonth) : 1;

  return {
    source: "scaledPartialMonth",
    daysElapsed: dayOfMonth,
    daysInMonth: daysInMonth,
    breakdown: scaleCategoryBreakdown_(partial, factor)
  };
}

/* ============================================
   MAIN ACTIONS — getPlannerData / saveBudgets
============================================ */

// One call, everything the Planner screen needs — same "one call per
// screen" pattern as getDashboard/getMonthlyAnalysis. txnData/cashData
// are optional (pass an already-read sheet's values to skip re-reading
// it), same reasoning as getCashData's own comment.
function getPlannerData(monthStr, txnData, cashData){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  txnData  = txnData  || ss.getSheetByName("Transactions").getDataRange().getValues();
  cashData = cashData || ss.getSheetByName("Cash").getDataRange().getValues();

  const today = new Date();
  const targetMonth = parsePlannerMonthOrDefault_(monthStr, today);
  const reliableStart = new Date(PLANNER_RELIABLE_START.year, PLANNER_RELIABLE_START.month - 1, 1);

  // Split-detection uses the FULL reliable window (reliable start ->
  // today), not just the up-to-3-months window used for the suggested
  // amount below — deciding "does this category ever really show both
  // Need and Want" is a one-time-ish structural question that benefits
  // from as much real history as exists, while the suggested AMOUNT
  // deliberately stays recent so it reflects how you're spending lately,
  // not months-old habits.
  const splitBreakdown = computeCategoryTypeBreakdown_(txnData, cashData, function(d){
    return d >= reliableStart && d <= today;
  });

  const suggestionInfo = computeSuggestedTargets_(txnData, cashData, today);

  // Actual spend so far in the REQUESTED month (the Track view) —
  // always the real requested month, independent of the "today"-anchored
  // suggestion logic above.
  const actualBreakdown = computeCategoryTypeBreakdown_(txnData, cashData, function(d){
    return d.getFullYear() === targetMonth.year && (d.getMonth() + 1) === targetMonth.month;
  });

  const savedMap = getSavedBudgetsForMonth_(targetMonth.key);

  const categories = PLANNER_CATEGORIES.map(function(cat){
    const splitStats = splitBreakdown[cat] || plannerZeroBucket_();
    const isSplit = splitStats.Need > 0 && splitStats.Want > 0;
    const dominantType = splitStats.Need > 0 ? "Need" : (splitStats.Want > 0 ? "Want" : "");

    const sugg = suggestionInfo.breakdown[cat] || plannerZeroBucket_();
    const suggested = isSplit
      ? { need: Math.round(sugg.Need), want: Math.round(sugg.Want), total: Math.round(sugg.Need + sugg.Want) }
      // Not split: suggest the WHOLE category's typical spend (every tag
      // combined), not just whichever one tag dominates — so a category
      // with little/no Need-Want history yet still gets a sensible,
      // non-zero suggestion instead of one based on a thin slice of it.
      : { total: Math.round(sugg.Need + sugg.Want + sugg.Saving + sugg.Investment + sugg.Untagged) };

    const savedRow = savedMap[cat];
    let saved = null;
    if(savedRow){
      if(isSplit){
        if(savedRow.hasOwnProperty("Need") || savedRow.hasOwnProperty("Want")){
          const need = savedRow["Need"] || 0, want = savedRow["Want"] || 0;
          saved = { need: need, want: want, total: need + want };
        }
      } else if(savedRow.hasOwnProperty("")){
        saved = { total: savedRow[""] };
      } else if(savedRow.hasOwnProperty("Need") || savedRow.hasOwnProperty("Want")){
        // The category was saved as split in a different month (or split-
        // ness has since changed) — still surface whatever was saved,
        // combined into one number rather than silently hiding it.
        const need = savedRow["Need"] || 0, want = savedRow["Want"] || 0;
        saved = { total: need + want };
      }
    }

    const act = actualBreakdown[cat] || plannerZeroBucket_();
    const actual = isSplit
      ? {
          need:     Math.round(act.Need),
          want:     Math.round(act.Want),
          // Spend in this category tagged Saving/Investment, or not
          // tagged at all yet — real category spend that doesn't count
          // toward either sub-target, shown honestly rather than hidden
          // (so actual.total never silently disagrees with need+want).
          untagged: Math.round(act.Saving + act.Investment + act.Untagged),
          total:    Math.round(act.total)
        }
      : { total: Math.round(act.total) };

    return {
      category: cat,
      split: isSplit,
      type: isSplit ? null : (dominantType || null), // null = genuinely no reliable history yet for this category
      suggested: suggested,
      saved: saved, // null = nothing saved for this month yet
      actual: actual
    };
  });

  const overview = buildPlannerOverview_(categories, actualBreakdown, savedMap, txnData, targetMonth);

  return {
    month: targetMonth.key,
    reliableSince: formatPlannerMonth_(PLANNER_RELIABLE_START.year, PLANNER_RELIABLE_START.month),
    suggestionSource: suggestionInfo.source, // "average" or "scaledPartialMonth"
    monthsAveraged: suggestionInfo.monthsUsed || null,
    categories: categories,
    overview: overview
  };
}

/* ============================================
   OVERVIEW — the "big picture" your old manual budget sheet had: total
   income, split into Needs/Wants/Savings+Investment, compared to the
   standard 50/30/20 rule of thumb, plus a single "Unallocated" number
   (income minus everything planned) — the same idea as your old sheet's
   per-bucket "Bal" row, just one total instead of one per bucket, since
   the Needs/Wants totals below are already summed automatically from
   your per-category targets.
============================================ */
function buildPlannerOverview_(categories, actualBreakdown, savedMap, txnData, targetMonth){
  const settings = getSettings();
  const savingsInvestmentTarget = (settings.monthlySaveGoal || 0) + (settings.monthlyInvestmentGoal || 0);

  // Needs/Wants targets = whatever's actually being planned per category
  // right now (prefer what you saved, fall back to the suggestion) — so
  // this total always matches what you'd get adding up the per-category
  // numbers on screen. A category with no reliable Need/Want history yet
  // (type: null, not split) can't be credited to either bucket — real,
  // not silently guessed.
  let needsTarget = 0, wantsTarget = 0;
  categories.forEach(function(c){
    const src = c.saved || c.suggested;
    if(c.split){
      needsTarget += src.need || 0;
      wantsTarget += src.want || 0;
    } else if(c.type === "Need"){
      needsTarget += src.total || 0;
    } else if(c.type === "Want"){
      wantsTarget += src.total || 0;
    }
  });

  const totalPlanned = needsTarget + wantsTarget + savingsInvestmentTarget;

  const savedIncomeRow = savedMap[PLANNER_INCOME_KEY];
  const savedIncome = (savedIncomeRow && savedIncomeRow.hasOwnProperty("")) ? savedIncomeRow[""] : null;
  const actualIncome = computeMonthActualIncome_(txnData, targetMonth.year, targetMonth.month);
  const incomeForCalc = savedIncome !== null ? savedIncome : actualIncome;

  // Actual spend-by-type this month, for the Track view — sums the same
  // per-category breakdown already computed for the requested month,
  // across every category, rather than per-category.
  let actualNeeds = 0, actualWants = 0, actualSaving = 0, actualInvestment = 0, actualUntagged = 0;
  Object.keys(actualBreakdown).forEach(function(cat){
    const b = actualBreakdown[cat];
    actualNeeds      += b.Need;
    actualWants      += b.Want;
    actualSaving     += b.Saving;
    actualInvestment += b.Investment;
    actualUntagged   += b.Untagged;
  });

  return {
    income: { actual: Math.round(actualIncome), saved: savedIncome === null ? null : Math.round(savedIncome) },
    targets: {
      needs: Math.round(needsTarget),
      wants: Math.round(wantsTarget),
      savingsInvestment: Math.round(savingsInvestmentTarget)
    },
    referenceSplit: PLANNER_REFERENCE_SPLIT, // fixed 50/30/20 reference, shown for comparison only
    unallocated: Math.round(incomeForCalc - totalPlanned),
    actual: {
      needs: Math.round(actualNeeds),
      wants: Math.round(actualWants),
      savingsInvestment: Math.round(actualSaving + actualInvestment),
      untagged: Math.round(actualUntagged)
    }
  };
}

// Saves/replaces a month's ENTIRE budget plan in one call — the
// frontend collects every category's input then saves them all
// together, not one row at a time. All-or-nothing: every line is
// validated first, so one bad line can never half-overwrite a month's
// existing plan. budgets is an array of either:
//   { category: "Food", split: true, need: 4000, want: 3500 }
//   { category: "Transport", split: false, target: 2200 }
// income is optional — undefined/null/"" means "don't save an override,
// use real actual income instead" (getPlannerData falls back to that
// automatically). Passing a number saves/replaces the override; passing
// null/"" explicitly clears a previously-saved one, since this is a full
// replace of the month's Budgets rows either way.
function saveBudgets(monthStr, budgets, income){
  try{
    const monthKey = normalizePlannerMonth_(monthStr);
    if(!monthKey) return { ok:false, error:"Enter a valid month." };
    if(!Array.isArray(budgets) || budgets.length === 0){
      return { ok:false, error:"No budget targets received." };
    }

    // Three-way: income left out of the request entirely (undefined) means
    // "this save isn't touching income" — a previously-saved override, if
    // any, is left completely alone. null/"" explicitly clears it. A real
    // number saves/replaces it. This matters because "budgets" (the
    // category targets) and income are edited from the same screen but
    // conceptually separate things — tweaking one category's target must
    // never silently wipe out a saved income figure just because this
    // request happened not to mention it.
    const incomeProvided = income !== undefined;
    let incomeToWrite = null;
    if(incomeProvided && income !== null && income !== ""){
      incomeToWrite = Number(income);
      if(!(incomeToWrite >= 0)) return { ok:false, error:"Enter a valid income amount." };
    }

    const rowsToWrite = [];
    if(incomeToWrite !== null) rowsToWrite.push([monthKey, PLANNER_INCOME_KEY, "", incomeToWrite]);
    for(let i = 0; i < budgets.length; i++){
      const b = budgets[i] || {};
      const category = (b.category || "").toString().trim();
      if(PLANNER_CATEGORIES.indexOf(category) === -1){
        return { ok:false, error:"Unknown category: " + (category || "(blank)") };
      }

      if(b.split){
        const need = Number(b.need);
        const want = Number(b.want);
        if(!(need >= 0) || !(want >= 0)){
          return { ok:false, error:"Enter a valid Need and Want target for " + category + "." };
        }
        rowsToWrite.push([monthKey, category, "Need", need]);
        rowsToWrite.push([monthKey, category, "Want", want]);
      } else {
        const target = Number(b.target);
        if(!(target >= 0)){
          return { ok:false, error:"Enter a valid target for " + category + "." };
        }
        rowsToWrite.push([monthKey, category, "", target]);
      }
    }

    const sheet = getBudgetsSheet_();
    const data = sheet.getDataRange().getValues();

    // Remove every existing CATEGORY row for this month first (bottom-up,
    // so deleting doesn't shift the row numbers of rows still to be
    // checked), THEN append the fresh set — a full replace for the
    // category targets, never leaves stale/duplicate rows behind from an
    // earlier save. The saved income row (PLANNER_INCOME_KEY) is only
    // ever removed when this call actually provided an income value
    // (see comment above) — untouched otherwise.
    for(let r = data.length - 1; r >= 1; r--){
      const rowMonth = (data[r][0] || "").toString().trim();
      if(rowMonth !== monthKey) continue;
      const rowCategory = (data[r][1] || "").toString().trim();
      if(rowCategory === PLANNER_INCOME_KEY && !incomeProvided) continue; // leave a previously-saved income alone
      sheet.deleteRow(r + 1);
    }

    rowsToWrite.forEach(function(row){ sheet.appendRow(row); });

    return { ok:true, saved: rowsToWrite.length };
  }catch(err){
    return { ok:false, error: err.toString() };
  }
}
