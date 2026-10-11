// backend/tests/_fakeSheetsKit.js
//
// Shared test helper (NOT a test itself - the leading underscore and the
// missing ".test" keep it out of the "run every *.test.js" loop).
// Builds a tiny fake Google Sheets + Apps Script world around the REAL
// backend source files, so tests can run them in plain Node with invented
// data. Used by autoSettle.test.js and appHealth.test.js.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- tiny fake Sheet -------------------------------------------------
function FakeSheet(name, rows){
  this.name = name;
  this.rows = (rows || []).map(function(r){ return r.slice(); });
  this.failOnSet = null; // optional (row, col) => true to simulate a write error
}
FakeSheet.prototype._width = function(){
  return this.rows.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
};
FakeSheet.prototype.getLastRow = function(){ return this.rows.length; };
FakeSheet.prototype.getLastColumn = function(){ return this._width(); };
FakeSheet.prototype.appendRow = function(values){ this.rows.push(values.slice()); };
FakeSheet.prototype.getDataRange = function(){
  const self = this;
  return {
    getValues: function(){
      const w = self._width();
      return self.rows.map(function(r){
        const copy = r.slice();
        while(copy.length < w) copy.push("");
        return copy;
      });
    }
  };
};
FakeSheet.prototype.getRange = function(r, c, nr, nc){
  const self = this;
  nr = nr || 1; nc = nc || 1;
  return {
    getValue: function(){
      const row = self.rows[r - 1];
      const v = row ? row[c - 1] : undefined;
      return v === undefined ? "" : v;
    },
    setValue: function(v){
      if(self.failOnSet && self.failOnSet(r, c)) throw new Error("simulated write failure at row " + r + " col " + c);
      while(self.rows.length < r) self.rows.push([]);
      const row = self.rows[r - 1];
      while(row.length < c) row.push("");
      row[c - 1] = v;
    },
    getValues: function(){
      const out = [];
      for(let i = 0; i < nr; i++){
        const row = self.rows[r - 1 + i] || [];
        const line = [];
        for(let j = 0; j < nc; j++){ const v = row[c - 1 + j]; line.push(v === undefined ? "" : v); }
        out.push(line);
      }
      return out;
    },
    setValues: function(vals){
      for(let i = 0; i < vals.length; i++){
        while(self.rows.length < r + i) self.rows.push([]);
        const row = self.rows[r - 1 + i];
        for(let j = 0; j < vals[i].length; j++){
          while(row.length < c + j) row.push("");
          row[c - 1 + j] = vals[i][j];
        }
      }
    },
    sort: function(specs){
      const col = specs[0].column - 1, asc = specs[0].ascending !== false;
      const slice = self.rows.slice(r - 1, r - 1 + nr);
      slice.sort(function(a, b){
        // Google Sheets always puts blank cells LAST when sorting ascending
        // (and first when descending). The incident of 2026-10-11 depended on this.
        const isBlank = function(v){ return v === "" || v === null || v === undefined; };
        const x = a[col], y = b[col];
        if(isBlank(x) || isBlank(y)){
          if(isBlank(x) && isBlank(y)) return 0;
          return (isBlank(x) ? 1 : -1) * (asc ? 1 : -1);
        }
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
      for(let i = 0; i < slice.length; i++) self.rows[r - 1 + i] = slice[i];
    }
  };
};

// ---- the whole fake world -------------------------------------------
// files: backend file names to load into the sandbox, in order.
function makeWorld(files){
  const sheets = {};
  const props = {};
  const pushes = [];      // every sendPushNotification(title, body, extra)
  const messages = [];    // every sendMessage(text)

  const sandbox = { console: console };
  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return {
        getSheetByName: function(n){ return sheets[n] || null; },
        insertSheet: function(n){ sheets[n] = new FakeSheet(n, []); return sheets[n]; }
      };
    }
  };
  sandbox.PropertiesService = {
    getScriptProperties: function(){
      return {
        getProperty: function(k){ return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
        setProperty: function(k, v){ props[k] = String(v); },
        deleteProperty: function(k){ delete props[k]; },
        getProperties: function(){ return Object.assign({}, props); }
      };
    }
  };
  const pad = function(n){ return String(n).padStart(2, "0"); };
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  sandbox.Utilities = {
    formatDate: function(d, tz, fmt){
      d = new Date(d);
      return fmt.replace("yyyy", d.getFullYear()).replace("MMM", MONTHS[d.getMonth()])
        .replace("MM", pad(d.getMonth() + 1)).replace("dd", pad(d.getDate()))
        .replace("HH", pad(d.getHours())).replace("mm", pad(d.getMinutes())).replace("ss", pad(d.getSeconds()));
    }
  };
  sandbox.Logger = { log: function(){} };
  sandbox.Session = { getScriptTimeZone: function(){ return "Asia/Kolkata"; } };
  sandbox.ScriptApp = { _handlers: [], getProjectTriggers: function(){
    return sandbox.ScriptApp._handlers.map(function(h){ return { getHandlerFunction: function(){ return h; } }; });
  } };
  vm.createContext(sandbox);

  files.forEach(function(f){
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    vm.runInContext(src, sandbox, { filename: f });
  });

  // Stubs for the things that would talk to the outside world. Defined
  // AFTER loading the real files so they win.
  sandbox.__pushes = pushes;
  sandbox.__messages = messages;
  vm.runInContext(`
    var TELEGRAM_ENABLED = false;
    function getConfig(){ return { BOT_TOKEN: "x", CHAT_ID: "y" }; }
    function sendPushNotification(title, body, extra){ __pushes.push({ title: title, body: body, extra: extra || null }); }
    function sendMessage(text){ __messages.push(text); }
  `, sandbox);

  return {
    sb: sandbox, sheets: sheets, props: props, pushes: pushes, messages: messages,
    addSheet: function(name, rows){ sheets[name] = new FakeSheet(name, rows); return sheets[name]; }
  };
}

let failures = 0;
function assert(cond, msg){
  if(!cond){ console.error("FAIL: " + msg); failures++; process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

module.exports = { FakeSheet, makeWorld, assert, failures: function(){ return failures; } };
