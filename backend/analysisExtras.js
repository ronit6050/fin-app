/* ============================================
   ANALYSIS EXTRAS (added 2026-10-18, Analysis makeover)

   Action `getAnalysisExtras` — the "compare with the past" half of the
   Analysis screen. getMonthlyAnalysis answers "what happened this month";
   this answers:
     - trend:   the last 6 months (spent / income / Rent+EMI / invested), so
                the screen can draw a trend and say "lower than usual"
     - prev:    LAST month's category totals and day-by-day spend, for
                "vs September" arrows and "same point last month"
     - budgets: the targets you set in Planner for THIS month next to the
                real spend, for the "Against your plan" card

   It is a separate call (not stuffed into getMonthlyAnalysis) so the
   Home screen's big data call, which also builds getMonthlyAnalysis,
   does not pay for 7 months of work. Everything is built by calling
   getMonthlyAnalysis itself, so the spend rules can never drift apart.
   Full notes: docs/features/analysis-makeover.md
============================================ */

var ANALYSIS_TREND_MONTHS_ = 6;

function analysisMonthShift_(year, month, delta){
  const idx = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// Small summary of one month — what the trend/prev parts need, nothing more.
function analysisMonthDigest_(a){
  const cats = {};
  (a.categories || []).forEach(function(c){ cats[c.category] = c.amount; });
  return {
    spent: a.totalDebit || 0,
    income: a.totalCredit || 0,
    fixed: a.fixedObligations || 0,
    invested: a.invested || 0,
    categories: cats,
    daily: (a.detail && a.detail.daily) ? a.detail.daily : []
  };
}

function getAnalysisExtras(year, month, txnData, cashData){
  year = Number(year); month = Number(month);
  if(!(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12)){
    return { ok: false, error: "Invalid month" };
  }
  const ss = dbSs_();
  txnData  = txnData  || ss.getSheetByName("Transactions").getDataRange().getValues();
  cashData = cashData || ss.getSheetByName("Cash").getDataRange().getValues();

  const trend = [];
  let prev = null;
  for(let back = ANALYSIS_TREND_MONTHS_ - 1; back >= 0; back--){
    const ym = analysisMonthShift_(year, month, -back);
    const a = getMonthlyAnalysis(ym.year, ym.month, txnData, cashData, { skipSaved: true });
    const digest = analysisMonthDigest_(a);
    trend.push({
      year: ym.year, month: ym.month,
      spent: digest.spent, income: digest.income, fixed: digest.fixed, invested: digest.invested,
      byMode: {
        bank:   (a.byMode && a.byMode.bank   && a.byMode.bank.totalDebit)   || 0,
        card:   (a.byMode && a.byMode.card   && a.byMode.card.totalDebit)   || 0,
        wallet: (a.byMode && a.byMode.wallet && a.byMode.wallet.totalDebit) || 0
      }
    });
    if(back === 1){
      // Last month, for every payment-mode view (the screen's toggle).
      prev = { all: digest };
      ["bank", "card", "wallet"].forEach(function(m){
        prev[m] = a.byMode && a.byMode[m] ? analysisMonthDigest_(a.byMode[m]) : analysisMonthDigest_({});
      });
      prev.year = ym.year; prev.month = ym.month;
    }
  }

  return { year: year, month: month, trend: trend, prev: prev, budgets: analysisBudgetsForMonth_(year, month, txnData, cashData) };
}

// Targets saved in Planner for this month next to real spend. Only categories
// the user actually set a target for. Null when nothing was saved (the card
// then simply does not show). Never throws: a Planner problem must not
// take the whole Analysis screen down.
function analysisBudgetsForMonth_(year, month, txnData, cashData){
  try{
    if(typeof getPlannerData !== "function") return null;
    const key = year + "-" + (month < 10 ? "0" + month : "" + month);
    const planner = getPlannerData(key, txnData, cashData);
    const rows = [];
    (planner.categories || []).forEach(function(c){
      if(!c.saved || !(Number(c.saved.total) > 0)) return;
      rows.push({
        category: c.category,
        target: Number(c.saved.total) || 0,
        actual: Number(c.actual && c.actual.total) || 0
      });
    });
    if(!rows.length) return null;
    rows.sort(function(a, b){ return (b.actual / b.target) - (a.actual / a.target); });
    return { month: key, categories: rows };
  }catch(err){
    return null;
  }
}
