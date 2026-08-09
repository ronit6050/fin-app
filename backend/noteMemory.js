// noteMemory.js
// Self-learning note suggestions, per merchant + amount band — same idea
// as SmartMemory (category) and TypeVotes (Need/Want/Saving), applied to
// the note text itself. See docs/features/note-memory.md for the full
// design and reasoning — this file only has short comments, that doc is
// the source of truth. Reuses getAmountBand() from needWantSaving.js
// (Apps Script shares one global scope across all files).

// Only suggest a note once you've used the SAME note for this merchant+band
// at least this many times. A note used just once might be a one-off (e.g.
// "birthday gift" to a friend) and shouldn't be resurfaced every time you
// pay that person again. This threshold is what makes suggestions behave
// sensibly for both recurring merchants (a restaurant's usual note repeats
// fast and clears the bar quickly) and person-to-person transfers (notes
// to a friend are usually different each time, so nothing clears the bar
// unless it's a genuinely recurring reason, like a monthly rent split —
// in which case suggesting it back is exactly right).
const NOTE_CONFIDENCE_MIN_USES = 2;

function getNoteMemorySheet(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("NoteMemory");
  if(!sheet){
    sheet = ss.insertSheet("NoteMemory");
    sheet.appendRow(["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"]);
  }
  return sheet;
}

// noteMemoryData is optional — pass an already-read NoteMemory sheet's
// values when checking many transactions in a row (see getPendingTransactions
// in PWA.js), same batching reasoning as getSuggestedType in needWantSaving.js.
function getSuggestedNote(counterparty, amount, noteMemoryData){
  if(!counterparty) return "";

  const band = getAmountBand(amount);
  const data = noteMemoryData || (function(){
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("NoteMemory");
    return sheet ? sheet.getDataRange().getValues() : [];
  })();

  let best = null;
  for(let i = 1; i < data.length; i++){
    if(data[i][0] === counterparty && data[i][1] === band){
      const timesUsed = Number(data[i][3]) || 0;
      if(!best || timesUsed > best.timesUsed){
        best = { note: data[i][2], timesUsed: timesUsed };
      }
    }
  }

  if(best && best.timesUsed >= NOTE_CONFIDENCE_MIN_USES) return best.note;
  return "";
}

// Called after a note is saved (from Pending or History) — remembers this
// merchant+band+note combo so it can be suggested again later. Matching on
// the note text is case-insensitive/trimmed, but the originally-typed
// version is what gets stored and later suggested back.
function recordNoteUsage(counterparty, amount, note){
  const cleanNote = (note || "").toString().trim();
  if(!counterparty || !cleanNote) return;

  const band  = getAmountBand(amount);
  const sheet = getNoteMemorySheet();
  const data  = sheet.getDataRange().getValues();

  for(let i = 1; i < data.length; i++){
    if(
      data[i][0] === counterparty &&
      data[i][1] === band &&
      (data[i][2] || "").toString().trim().toLowerCase() === cleanNote.toLowerCase()
    ){
      const rowNum    = i + 1;
      const timesUsed = (Number(data[i][3]) || 0) + 1;
      sheet.getRange(rowNum, 4).setValue(timesUsed);
      sheet.getRange(rowNum, 5).setValue(new Date());
      return;
    }
  }

  sheet.appendRow([counterparty, band, cleanNote, 1, new Date()]);
}
