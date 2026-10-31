/* ============================================
   EXPORT DATA, the parts the screens do not return in full (added 2026-10-31)

   More > Export data builds its file on the phone from actions the screens already call. Four things were missing or cut short:
   payments still waiting for a note (Pending), EVERY cash entry (the Cash screen only returns the latest 60), the Savings entries
   and the Investments entries. getExportExtras returns them as plain rows. Read-only; it changes nothing and is per person
   (dbSs_() is already that person's own data).
============================================ */

function exportIso_(v){
  if(v === "" || v === null || v === undefined) return "";
  var d = new Date(v);
  if(isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
}

function exportRows_(sheetName){
  var sh = null;
  try{ sh = dbSs_().getSheetByName(sheetName); }catch(e){ sh = null; }
  if(!sh) return [];
  var values = sh.getDataRange().getValues();
  return values.length > 1 ? values.slice(1) : [];
}

function getExportExtras_(){
  var out = { ok: true, pending: [], cash: [], savings: [], investments: [] };

  try{
    out.pending = getPendingTransactions().map(function(t){
      return { date: t.date, time: t.time, type: t.type, amount: t.amount, counterparty: t.counterparty, mode: t.mode, bank: t.bank, reference: t.reference || "" };
    });
  }catch(e1){ out.pendingError = true; }

  try{
    // Cash columns: A ID, B Date, C Time, D Type, E Amount, F Note, G Category, ... K NeedWantSaving
    exportRows_("Cash").forEach(function(r){
      var type = (r[3] || "").toString().toLowerCase();
      if(!type && !r[4]) return;               // an entry removed from the app (emptied row)
      out.cash.push({ iso: exportIso_(r[1]), type: type, amount: Number(r[4]) || 0, note: (r[5] || "").toString(), category: (r[6] || "").toString(), needWantSaving: (r[10] || "").toString() });
    });
  }catch(e2){ out.cashError = true; }

  try{
    // Savings columns: A Date, B Amount (negative = withdrawal), C Type, D Note, E Destination
    exportRows_("Savings").forEach(function(r){
      if(!r[0] && !r[1]) return;
      out.savings.push({ iso: exportIso_(r[0]), amount: Number(r[1]) || 0, type: (r[2] || "").toString(), note: (r[3] || "").toString(), destination: (r[4] || "").toString() });
    });
  }catch(e3){ out.savingsError = true; }

  try{
    // Investments columns: A Date, B Name, C Amount, D Note, E Kind
    exportRows_("Investments").forEach(function(r){
      if(!r[0] && !r[2]) return;
      out.investments.push({ iso: exportIso_(r[0]), name: (r[1] || "").toString(), amount: Number(r[2]) || 0, note: (r[3] || "").toString(), kind: (r[4] || "").toString() });
    });
  }catch(e4){ out.investmentsError = true; }

  return out;
}
