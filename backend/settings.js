/* ============================================
   USER-EDITABLE SETTINGS (2026-08-08)
   CC limit, savings targets, etc — exposed via the PWA's Settings
   screen. Backed by Script Properties (same place BOT_TOKEN/
   PWA_PUSH_TOKEN already live), not a Sheet — simpler, no extra sheet
   to keep in sync.

   These used to be plain hardcoded constants (CC_LIMIT in CCAdvisor.js,
   MONTHLY_EXPENSES/MONTHLY_SAVE_GOAL in SavingsAdvisor.js). Deliberately
   NOT touching every place those constants are still used — most of
   that is dormant Telegram message-building code (Telegram's off, see
   CLAUDE.md). getSplitRule()/getStageLabel() in SavingsAdvisor.js now
   accept optional overrides (falling back to the original constants,
   so nothing dormant breaks); PWA.js's getCCAdvisorData/getSavingsData/
   logSavingFromApp are the only things that actually read these live.
============================================ */

function getSettings(){
  const props = PropertiesService.getScriptProperties();

  return {
    ccLimit:         Number(props.getProperty("SETTING_CC_LIMIT"))          || 50000,
    ccWarnPct:       Number(props.getProperty("SETTING_CC_WARN_PCT"))       || 0.25,
    ccAlertPct:      Number(props.getProperty("SETTING_CC_ALERT_PCT"))      || 0.30,
    monthlyExpenses: Number(props.getProperty("SETTING_MONTHLY_EXPENSES"))  || 30000,
    monthlySaveGoal: Number(props.getProperty("SETTING_MONTHLY_SAVE_GOAL")) || 1000,
    // Added 2026-08-10 — a fixed amount you always invest each month, so
    // CC Advisor's affordability check can treat it as committed even
    // before the matching transaction happens (or if you invest in
    // installments across the month). 0 default = feature is a no-op
    // for anyone who hasn't set it.
    monthlyInvestmentGoal: Number(props.getProperty("SETTING_MONTHLY_INVESTMENT_GOAL")) || 0
  };
}

// Only overwrites values actually provided — so saving from a partially
// filled form never wipes out the other settings.
function updateSettings(newSettings){
  try{
    const props = PropertiesService.getScriptProperties();

    if(newSettings.ccLimit)         props.setProperty("SETTING_CC_LIMIT", String(newSettings.ccLimit));
    if(newSettings.ccWarnPct)       props.setProperty("SETTING_CC_WARN_PCT", String(newSettings.ccWarnPct));
    if(newSettings.ccAlertPct)      props.setProperty("SETTING_CC_ALERT_PCT", String(newSettings.ccAlertPct));
    if(newSettings.monthlyExpenses) props.setProperty("SETTING_MONTHLY_EXPENSES", String(newSettings.monthlyExpenses));
    if(newSettings.monthlySaveGoal) props.setProperty("SETTING_MONTHLY_SAVE_GOAL", String(newSettings.monthlySaveGoal));
    if(newSettings.monthlyInvestmentGoal !== undefined && newSettings.monthlyInvestmentGoal !== null && newSettings.monthlyInvestmentGoal !== "")
      props.setProperty("SETTING_MONTHLY_INVESTMENT_GOAL", String(newSettings.monthlyInvestmentGoal));

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}
