# Daily nudges (2026-10-21)

Three very short notifications a day, per person, from their own data to their own phone. Code: `backend/dailyNudges.js` (+ the evening part in `backend/dailySummary.js`), jobs in `backend/fnTimer.js`. Test: `backend/tests/dailyNudges.test.js`.

| Time (India) | Example | Notes |
|---|---|---|
| 08:00 | "Today's limit: ₹1,150" / "18 days to salary" | Limit = runway `maxPerDay` (balance you confirmed - bills before salary, / days to salary). Remembered in property `NUDGE_LIMIT` ("date\|amount") so midday and evening use the same number all day. Running short: "Keep today under ₹900" / "Money runs out 4 days before salary". Balance missing or older than 7 days: "Confirm your balance". |
| 13:00 | "₹830 left today" / "You're ahead, keep going" | Also "Go easy this evening" (20% or less left), "Clean start so far", "₹X over today's limit". Nothing sent if there is no fresh balance. |
| 21:00 | "₹170 under today's limit" / "Tomorrow: ₹1,174" | This is the old 9pm summary made short (job key `cash`). With no limit known it falls back to "You spent ₹X today" / "N payments need a note". |

Rules: titles stay under about 30 characters, bodies under about 40 (people skip long notifications). The morning and midday jobs are skipped if the server only wakes up after 12:00 / 17:00. One Settings switch (`SETTING_DAILY_SUMMARY_OFF`, "Daily nudges" in Settings > Notifications) turns all three off. Best effort: one person's failure is logged (`NUDGE_ERROR`) and never stops the others. Push `kind` is `nudge` (evening stays `summary`).

Switch off for everyone: remove the `morning` / `midday` entries from `TIMER_DAILY_JOBS_` and redeploy.
