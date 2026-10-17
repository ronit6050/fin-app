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
   CLAUDE.md). getSplitRule()/getStageLabel() in SavingsAdvisor.js still
   accept optional overrides for that reason, but as of 2026-08-12
   nothing live actually passes them anymore — PWA.js's getSavingsData()/
   logSavingFromApp() (the only things that used to read these settings
   live) were removed as dead code, superseded by the Goals-based
   Savings engine (savingsGoals.js). getCCAdvisorData is now the only
   thing in PWA.js reading these settings live.
============================================ */

function getSettings(){
  const props = dbProps_();

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
    monthlyInvestmentGoal: Number(props.getProperty("SETTING_MONTHLY_INVESTMENT_GOAL")) || 0,
    // Added 2026-10-17 - day of month the salary arrives (0 = work it out from past Income credits), used by Home's run-out date.
    salaryDay: Number(props.getProperty("SETTING_SALARY_DAY")) || 0,
    // Added 2026-10-17 - the 9pm "how much you spent today" notification (dailySummary.js). On unless switched off here.
    dailySummary: String(props.getProperty("SETTING_DAILY_SUMMARY_OFF") || "") !== "1",
    // Added 2026-10-17 - how often to be reminded about payments waiting for a note (pendingReminder.js): off / 30 / 60 (default) / twice
    pendingReminder: (typeof reminderChoice_ === "function") ? reminderChoice_(props.getProperty("SETTING_PENDING_REMINDER")) : "60"
  };
}

// Only overwrites values actually provided — so saving from a partially
// filled form never wipes out the other settings.
function updateSettings(newSettings){
  try{
    const props = dbProps_();

    if(newSettings.ccLimit)         props.setProperty("SETTING_CC_LIMIT", String(newSettings.ccLimit));
    if(newSettings.ccWarnPct)       props.setProperty("SETTING_CC_WARN_PCT", String(newSettings.ccWarnPct));
    if(newSettings.ccAlertPct)      props.setProperty("SETTING_CC_ALERT_PCT", String(newSettings.ccAlertPct));
    if(newSettings.monthlyExpenses) props.setProperty("SETTING_MONTHLY_EXPENSES", String(newSettings.monthlyExpenses));
    if(newSettings.monthlySaveGoal) props.setProperty("SETTING_MONTHLY_SAVE_GOAL", String(newSettings.monthlySaveGoal));
    if(newSettings.monthlyInvestmentGoal !== undefined && newSettings.monthlyInvestmentGoal !== null && newSettings.monthlyInvestmentGoal !== "")
      props.setProperty("SETTING_MONTHLY_INVESTMENT_GOAL", String(newSettings.monthlyInvestmentGoal));
    if(newSettings.salaryDay !== undefined && newSettings.salaryDay !== null && newSettings.salaryDay !== ""){
      const sd = Math.floor(Number(newSettings.salaryDay));
      if(sd >= 0 && sd <= 31) props.setProperty("SETTING_SALARY_DAY", String(sd));
    }
    if(newSettings.dailySummary === true || newSettings.dailySummary === false)
      props.setProperty("SETTING_DAILY_SUMMARY_OFF", newSettings.dailySummary ? "" : "1");
    if(["off", "30", "60", "twice"].indexOf(String(newSettings.pendingReminder)) !== -1)
      props.setProperty("SETTING_PENDING_REMINDER", String(newSettings.pendingReminder));

    return { ok: true };
  }catch(err){
    return { ok: false, error: err.toString() };
  }
}
