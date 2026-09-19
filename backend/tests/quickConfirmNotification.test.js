// backend/tests/quickConfirmNotification.test.js
//
// Plain-English what this checks: the new "Confirm" button on a
// transaction's push notification (added 2026-09-19) — tapping it saves
// the note/category straight from the notification, no need to open the
// app at all. See docs/features/quick-confirm-notification.md for the
// full design.
//
// This only offers that button when it's genuinely safe to fully
// auto-save with one tap — a plain debit with a CONFIDENT remembered
// note and category, and none of the special cases (Rent/EMI/
// Investment, a wallet top-up, money coming IN) that need the real
// Pending screen instead. Getting this gate wrong in either direction
// is a real problem: too loose, and a Rent/EMI payment could get
// silently mis-saved as ordinary spend from a notification tap; too
// strict, and the button just never shows up.
//
// Two things are tested, loading the REAL backend source (no real Apps
// Script/Google account needed):
//   1. getQuickConfirmSuggestion() (PWA.js) — the gating logic itself.
//   2. sendPushNotification() (push.js) — proves every extra field gets
//      turned into a plain string before being sent to FCM (FCM's "data"
//      message format silently rejects the whole send if any value
//      isn't a string — a real, easy mistake since row/amount are
//      naturally numbers).
//
// Run with: node backend/tests/quickConfirmNotification.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(condition, message){
  if(!condition){
    console.error("FAIL: " + message);
    process.exitCode = 1;
  } else {
    console.log("PASS: " + message);
  }
}

// ---------------------------------------------------------------------
// A tiny fake Google Sheets environment — same shape as the other tests
// in this folder.
// ---------------------------------------------------------------------
function makeFakeSheetsEnv(){
  const sheetsByName = {};

  function FakeSheet(name, initialRows){
    this.name = name;
    this.rows = initialRows.map(function(r){ return r.slice(); });
  }
  FakeSheet.prototype.getDataRange = function(){
    const self = this;
    return { getValues: function(){ return self.rows.map(function(r){ return r.slice(); }); } };
  };

  function seedSheet(name, headerAndRows){
    sheetsByName[name] = new FakeSheet(name, headerAndRows);
    return sheetsByName[name];
  }

  const SpreadsheetApp = {
    getActiveSpreadsheet: function(){
      return { getSheetByName: function(name){ return sheetsByName[name] || null; } };
    }
  };

  return { SpreadsheetApp, seedSheet, sheetsByName };
}

// ---------------------------------------------------------------------
// Loads getQuickConfirmSuggestion() and everything it calls into one
// sandbox — category.js (getSuggestedCategoryFast's own dependencies),
// noteMemory.js, needWantSaving.js, financialEvents.js, then PWA.js
// itself (isWalletTopUp + getQuickConfirmSuggestion live there).
// ---------------------------------------------------------------------
function loadBackendSandbox(){
  const env = makeFakeSheetsEnv();

  const sandbox = { SpreadsheetApp: env.SpreadsheetApp, console: console };
  vm.createContext(sandbox);

  const files = ["category.js", "noteMemory.js", "needWantSaving.js", "financialEvents.js", "PWA.js"];
  files.forEach(function(filename){
    const src = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInContext(src, sandbox, { filename: filename });
  });

  return { sandbox: sandbox, env: env };
}

function emptyFinancialEventsData(){
  return [["Type", "Amount", "Counterparty", "Confirmed", "Name"]];
}

// ---------------------------------------------------------------------
// Test 1 — the ordinary "everything lines up" case: a confident
// remembered note+category for a plain debit shows the button.
// ---------------------------------------------------------------------
(function testOrdinaryConfidentTransactionOffersButton(){
  const { sandbox, env } = loadBackendSandbox();
  const smartMemoryData = [["Merchant", "Category", "Subcategory", "Confidence"], ["swiggy", "Food", "Delivery", 100]];
  const noteMemoryData = [
    ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    ["Swiggy", "Medium", "dinner", 4, new Date()]
  ];
  const typeVotesData = [["Merchant", "AmountBand", "Type", "Timestamp"]];

  const result = sandbox.getQuickConfirmSuggestion(
    "debit", "Swiggy", 350, "upi", "REF001",
    smartMemoryData, noteMemoryData, emptyFinancialEventsData(), typeVotesData
  );

  assert(result !== null, "a confident, ordinary debit gets a quick-confirm suggestion");
  assert(result.note === "dinner", 'suggested note is "dinner", got "' + (result && result.note) + '"');
  assert(result.category === "Food", 'suggested category is "Food", got "' + (result && result.category) + '"');
})();

// ---------------------------------------------------------------------
// Test 2 — a note used only once (below the confidence bar) does NOT
// offer the button — same confidence rule Pending/History already use.
// ---------------------------------------------------------------------
(function testUnconfidentNoteWithholdsButton(){
  const { sandbox, env } = loadBackendSandbox();
  const smartMemoryData = [["Merchant", "Category", "Subcategory", "Confidence"], ["swiggy", "Food", "Delivery", 100]];
  const noteMemoryData = [
    ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    ["Swiggy", "Medium", "dinner", 1, new Date()] // only used once — not confident yet
  ];

  const result = sandbox.getQuickConfirmSuggestion(
    "debit", "Swiggy", 350, "upi", "REF001",
    smartMemoryData, noteMemoryData, emptyFinancialEventsData(), []
  );

  assert(result === null, "a note used only once does not clear the confidence bar — no button offered");
})();

// ---------------------------------------------------------------------
// Test 3 — a recognized Rent/EMI/Investment payment never gets the
// button, even with a confident note+category — this is the case that
// actually matters most: a one-tap save can't also flag it as a
// Financial Event, so silently auto-saving it would wrongly count it as
// ordinary spend and skip the Fixed-obligations line entirely.
// ---------------------------------------------------------------------
(function testFinancialEventWithholdsButton(){
  const { sandbox, env } = loadBackendSandbox();
  const smartMemoryData = [["Merchant", "Category", "Subcategory", "Confidence"], ["landlord", "Bills", "Rent", 100]];
  const noteMemoryData = [
    ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    ["Landlord", "XLarge", "Rent", 6, new Date()]
  ];
  // A previously-confirmed Rent payment at ₹15000 — a new ₹15000 payment
  // now recurs by amount (see amountsMatch in financialEvents.js).
  const financialEventsData = [
    ["Type", "Amount", "Counterparty", "Confirmed", "Name"],
    ["Rent", 15000, "Landlord", true, ""]
  ];

  const result = sandbox.getQuickConfirmSuggestion(
    "debit", "Landlord", 15000, "upi", "REF002",
    smartMemoryData, noteMemoryData, financialEventsData, []
  );

  assert(result === null, "a recognized Rent payment does NOT get a quick-confirm button, even with a confident note+category");
})();

// ---------------------------------------------------------------------
// Test 4 — a wallet top-up (mentions the wallet by name AND has a real
// reference number) never gets the button either — same reasoning as
// isNonSpendTransfer elsewhere, it isn't real spending.
// ---------------------------------------------------------------------
(function testWalletTopUpWithholdsButton(){
  const { sandbox, env } = loadBackendSandbox();
  const smartMemoryData = [["Merchant", "Category", "Subcategory", "Confidence"], ["payzapp wallet", "Financial", "Other", 100]];
  const noteMemoryData = [
    ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    ["PayZapp Wallet", "Large", "top up", 3, new Date()]
  ];

  const result = sandbox.getQuickConfirmSuggestion(
    "debit", "PayZapp Wallet", 4625, "upi", "963466680709", // has a real reference — a top-up, per isWalletTopUp
    smartMemoryData, noteMemoryData, emptyFinancialEventsData(), []
  );

  assert(result === null, "a wallet top-up (reference present) does NOT get a quick-confirm button");
})();

// ---------------------------------------------------------------------
// Test 5 — money coming IN (a credit) never gets the button — this is
// meant for the "add an expense" habit, not incoming money.
// ---------------------------------------------------------------------
(function testCreditWithholdsButton(){
  const { sandbox, env } = loadBackendSandbox();
  const smartMemoryData = [["Merchant", "Category", "Subcategory", "Confidence"], ["employer", "Income", "Salary", 100]];
  const noteMemoryData = [
    ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    ["Employer", "XLarge", "salary", 5, new Date()]
  ];

  const result = sandbox.getQuickConfirmSuggestion(
    "credit", "Employer", 50000, "upi", "REF003",
    smartMemoryData, noteMemoryData, emptyFinancialEventsData(), []
  );

  assert(result === null, "a credit (money coming in) never gets a quick-confirm button");
})();

// ---------------------------------------------------------------------
// Test 6 — the suggested Need/Want/Saving type is included when real
// answer history exists for this merchant+band, using the same
// TYPE_VOTE_WINDOW learning needWantSaving.js already relies on.
// ---------------------------------------------------------------------
(function testSuggestedTypeIncludedWhenConfident(){
  const { sandbox, env } = loadBackendSandbox();
  const smartMemoryData = [["Merchant", "Category", "Subcategory", "Confidence"], ["swiggy", "Food", "Delivery", 100]];
  const noteMemoryData = [
    ["Merchant", "AmountBand", "Note", "TimesUsed", "LastUsed"],
    ["Swiggy", "Medium", "dinner", 4, new Date()]
  ];
  const typeVotesData = [
    ["Merchant", "AmountBand", "Type", "Timestamp"],
    ["Swiggy", "Medium", "Want", new Date()],
    ["Swiggy", "Medium", "Want", new Date()],
    ["Swiggy", "Medium", "Want", new Date()]
  ];

  const result = sandbox.getQuickConfirmSuggestion(
    "debit", "Swiggy", 350, "upi", "REF001",
    smartMemoryData, noteMemoryData, emptyFinancialEventsData(), typeVotesData
  );

  assert(result !== null, "still gets a quick-confirm suggestion");
  assert(result.type === "Want", 'suggested type is "Want" from real answer history, got "' + (result && result.type) + '"');
})();

// ---------------------------------------------------------------------
// Test 7 — sendPushNotification() (push.js) turns every extra field
// into a plain string before sending, since FCM's "data" message format
// only accepts strings (a row NUMBER or amount sent as-is would make
// Firebase reject the whole request).
// ---------------------------------------------------------------------
(function testSendPushNotificationStringifiesExtraData(){
  const capturedRequests = [];

  const PropertiesService = {
    getScriptProperties: function(){
      return {
        getProperty: function(key){
          if(key === "PWA_PUSH_TOKEN") return "fake-device-token";
          if(key === "FIREBASE_SERVICE_ACCOUNT") return JSON.stringify({ project_id: "fin-app-test", client_email: "x@y.com", private_key: "fake" });
          return null;
        }
      };
    }
  };

  const UrlFetchApp = {
    fetch: function(url, options){
      capturedRequests.push({ url: url, options: options });
      return { getContentText: function(){ return "{}"; } };
    }
  };

  const sandbox = {
    PropertiesService: PropertiesService,
    UrlFetchApp: UrlFetchApp,
    Utilities: {
      base64EncodeWebSafe: function(s){ return Buffer.from(s).toString("base64"); },
      computeRsaSha256Signature: function(){ return "fake-signature"; }
    },
    logAI: function(){}, // real logAI lives in Logger.js, not needed for this test
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "push.js"), "utf8"), sandbox, { filename: "push.js" });

  // getFirebaseAccessToken() would normally call oauth2.googleapis.com —
  // stub it directly so this test never makes a real network call.
  sandbox.getFirebaseAccessToken = function(){ return "fake-access-token"; };

  sandbox.sendPushNotification("💳 New Transaction", "₹350 · HDFC · Swiggy", {
    quickConfirm: "1",
    row: 42,           // a real number, not a string — this is the case that must not break
    note: "dinner",
    category: "Food",
    counterparty: "Swiggy",
    type: "Want"
  });

  assert(capturedRequests.length === 1, "exactly one FCM request was sent");
  const sentPayload = JSON.parse(capturedRequests[0].options.payload);
  const sentData = sentPayload.message.data;

  assert(sentData.row === "42", 'the numeric row (42) was converted to the string "42", got ' + JSON.stringify(sentData.row));
  assert(typeof sentData.row === "string", "every value in the FCM data payload is a string, as FCM requires");
  assert(sentData.quickConfirm === "1", "quickConfirm flag passed through correctly");
  assert(sentData.note === "dinner" && sentData.category === "Food", "note/category passed through correctly");
  assert(sentData.title === "💳 New Transaction" && sentData.body === "₹350 · HDFC · Swiggy", "title/body are unaffected by extraData");
})();

// ---------------------------------------------------------------------
// Test 8 — calling sendPushNotification with no third argument at all
// (the existing 2-argument call sites — telegram.js, testPushNotification)
// still works exactly as before.
// ---------------------------------------------------------------------
(function testBackwardCompatibleTwoArgumentCall(){
  const capturedRequests = [];
  const sandbox = {
    PropertiesService: {
      getScriptProperties: function(){
        return {
          getProperty: function(key){
            if(key === "PWA_PUSH_TOKEN") return "fake-device-token";
            if(key === "FIREBASE_SERVICE_ACCOUNT") return JSON.stringify({ project_id: "fin-app-test", client_email: "x@y.com", private_key: "fake" });
            return null;
          }
        };
      }
    },
    UrlFetchApp: {
      fetch: function(url, options){
        capturedRequests.push({ url: url, options: options });
        return { getContentText: function(){ return "{}"; } };
      }
    },
    Utilities: { base64EncodeWebSafe: function(s){ return Buffer.from(s).toString("base64"); }, computeRsaSha256Signature: function(){ return "fake-signature"; } },
    logAI: function(){},
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "push.js"), "utf8"), sandbox, { filename: "push.js" });
  sandbox.getFirebaseAccessToken = function(){ return "fake-access-token"; };

  sandbox.sendPushNotification("🔔 Test Notification", "If you see this, push notifications are working!");

  assert(capturedRequests.length === 1, "the plain 2-argument call still sends exactly one request");
  const sentData = JSON.parse(capturedRequests[0].options.payload).message.data;
  assert(Object.keys(sentData).length === 2, "only title+body are present, no leftover extra fields, got keys: " + Object.keys(sentData).join(","));
})();

console.log("\nDone.");
