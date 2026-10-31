# Export data (2026-10-31)

More > **Export data** downloads the person's own data as **Excel (.xlsx)**, **PDF** or **CSV**.

## How it works
- Frontend only (`index.html`, block "EXPORT DATA (2026-10-31)"). No backend change, no new server cost.
- It reuses the actions the screens already call: `getTransactionHistory` (offset 0, limit 100000, so every noted payment), `getCash`, `getDebts`.
- The file is built **on the phone** and never stored anywhere. SheetJS (already used by Reconcile) and jsPDF 2.5.1 + jspdf-autotable 3.8.2 are
  loaded from cdnjs only when needed.
- Period choices: this month, last month, last 3 months, this financial year (Apr-Mar), all time, custom dates. Dates are the ones the server
  already formats in India time.

## What is in the file
- **Summary** (Excel/CSV and PDF): payments counted, spent (full amounts), spent (my share only), received, my-share spend by category.
- **Payments**: date, time, type, amount, **my share** (amount minus what a friend owes on a split), category, note, payee, mode, bank, reference, tag.
  Card-bill payments and wallet top-ups are listed but tagged and left out of the Summary (same rule as the Analysis screen). Rent/EMI/SIP are NOT
  left out, so Summary can differ from Analysis. The PDF shows a shorter column set.
- **Cash**: every entry (since 2026-10-31, via `getExportExtras`).
- **Waiting for a note, Savings, Investments**: added 2026-10-31 (same action, `backend/exportData.js`, test `exportExtras.test.js`).
- **Open debts**: unsettled debts and splits.
- Text starting with `= + - @` gets a leading `'` so Excel cannot run it as a formula.
- PDF uses plain Latin text and "Rs" (the built-in PDF fonts cannot draw the rupee sign).

## Known limits / ideas
- Planner data is still not exported (it is a plan, not records).
- Android WebView: the file download goes through a normal browser download; if the native app blocks it, a small bridge is needed in `D:\Fin-app Application`.
- Not tested on the real Android app yet.
