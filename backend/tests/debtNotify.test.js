// backend/tests/debtNotify.test.js
//
// Plain-English what this checks: when someone adds a debt (Debts > + Add Debt), records a payment on one, or settles one, and the
// person named on the debt is one of THEIR friends who uses the app, that friend gets a push on THEIR phone, like a split does.
//   - the name must match exactly ONE friend (case and spaces ignored); no match or two matches = nobody is told;
//   - a friend with no phone token is simply not pushed; a failed action sends nothing; a push problem never changes the answer;
//   - the wording never guesses anyone's pronouns and says who owes whom;
//   - the same spam limit as splits (10 per sender to one person in 10 minutes).
// All data here is invented. Run with: node backend/tests/debtNotify.test.js

const { build, OWNER, FRIEND } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
const sent = [];
sb.sendPushToToken_ = function(token, title, body, extra){ sent.push({ token: token, title: title, body: body, extra: extra }); };
sb.sendPushNotification = function(){};
w.props.PWA_PUSH_TOKEN = "tok-owner-global";
const D = w.D;
w.addSheet("Debts", [["Date", "Person", "Type", "Amount", "Note", "DueDate", "Status", "SettledDate"],
  ["2026-10-01", "Vaidehi", "LENT", 500, "dinner", "", "Pending", ""],
  ["2026-10-02", "Someone Else", "LENT", 200, "", "", "Pending", ""]]);

sb.v2dbEnableUser(FRIEND);
w.act("friend", { action: "registerPushToken", token: "tok-friend" });

console.log("\n--- 1. Adding a debt tells the matching friend ---");
{
  let r = w.act("owner", { action: "addDebt", person: "Vaidehi", type: "LENT", amount: 300, note: "tickets" });
  assert(r.ok === true, "the debt was saved");
  assert(sent.length === 1 && sent[0].token === "tok-friend" && sent[0].title === "New debt recorded", "one push, to HER token only");
  assert(/you owe Ronit .*300/.test(sent[0].body) && sent[0].body.indexOf("tickets") !== -1, "'lent' = she owes the sender: " + sent[0].body);
  assert(!/\b(he|she|his|her|him)\b/i.test(sent[0].body.replace("Ronit", "")), "no pronouns in the wording");
  sent.length = 0;
  r = w.act("owner", { action: "addDebt", person: "  vaidehi ", type: "BORROWED", amount: 80, note: "" });
  assert(r.ok && sent.length === 1 && /Ronit owes you .*80/.test(sent[0].body), "'borrowed' = the sender owes her; case and spaces in the name are ignored: " + (sent[0] && sent[0].body));
}

console.log("\n--- 2. Nobody is told when the name does not match exactly one friend ---");
{
  sent.length = 0;
  w.act("owner", { action: "addDebt", person: "Stranger", type: "LENT", amount: 10, note: "" });
  assert(sent.length === 0, "a name that is not a friend sends nothing");
  w.store["users/" + OWNER + "/friends/vaidehi2@example.com"] = { fields: { name: "Vaidehi", email: "vaidehi2@example.com", mirror: false, balancePaise: 0 }, updateTime: "t0" };
  w.act("owner", { action: "addDebt", person: "Vaidehi", type: "LENT", amount: 10, note: "" });
  assert(sent.length === 0, "two friends with the same name: nobody is told (a wrong person must never be notified)");
  delete w.store["users/" + OWNER + "/friends/vaidehi2@example.com"];
  const bad = w.act("owner", { action: "addDebt", person: "Vaidehi", type: "LENT", amount: 10, note: "x" });
  assert(bad.ok === true && sent.length === 1, "back to one match: she is told again");
}

console.log("\n--- 3. Payments and settling ---");
{
  sent.length = 0;
  const p = w.act("owner", { action: "recordDebtPayment", row: 2, amount: 100 });
  assert(p.ok && p.settled === false && sent.length === 1 && sent[0].title === "Debt payment recorded" && /100/.test(sent[0].body), "a part payment tells her: " + (sent[0] && sent[0].body));
  sent.length = 0;
  const p2 = w.act("owner", { action: "recordDebtPayment", row: 2, amount: 400 });
  assert(p2.ok && p2.settled === true && sent.length === 1 && sent[0].title === "Debt settled", "a payment that clears it says 'settled'");
  sent.length = 0;
  const s = w.act("owner", { action: "settleDebt", row: 4 });
  assert(s.ok && sent.length === 1 && sent[0].title === "Debt settled", "settling one tells her");
  sent.length = 0;
  const s3 = w.act("owner", { action: "settleDebt", row: 3 });
  assert(s3.ok && sent.length === 0, "settling a debt with someone who is not a friend tells nobody");
  const bad = w.act("owner", { action: "recordDebtPayment", row: 2, amount: 0 });
  assert(bad.ok === false && sent.length === 0, "a failed payment sends nothing");
  const badRow = w.act("owner", { action: "settleDebt", row: 999 });
  assert(badRow.ok === false && sent.length === 0, "an invalid row sends nothing");
}

console.log("\n--- 4. No phone, push problems, spam limit, the other direction ---");
{
  sent.length = 0;
  delete w.props.PWA_PUSH_TOKEN;
  w.act("friend", { action: "registerPushToken", token: "" });
  const sbTokenless = sb.splitNotifyToken_;
  sb.splitNotifyToken_ = function(){ return ""; };
  const r = w.act("owner", { action: "addDebt", person: "Vaidehi", type: "LENT", amount: 5, note: "" });
  assert(r.ok === true && sent.length === 0, "a friend with no phone token is not pushed, and the debt still saves");
  sb.splitNotifyToken_ = sbTokenless;
  sb.sendPushToToken_ = function(){ throw new Error("push down"); };
  const r2 = w.act("owner", { action: "addDebt", person: "Vaidehi", type: "LENT", amount: 6, note: "" });
  assert(r2.ok === true, "a push failure never changes the answer to the person adding the debt");
  sb.sendPushToToken_ = function(token, title, body){ sent.push({ token: token, title: title, body: body }); };
  sent.length = 0; w.__cache = {};
  sb.CacheService = { getScriptCache: function(){ const s = w.__cache || (w.__cache = {}); return { get: function(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, put: function(k, v){ s[k] = String(v); }, remove: function(k){ delete s[k]; } }; } };
  w.act("friend", { action: "registerPushToken", token: "tok-friend" });
  for(let i = 0; i < 14; i++) w.act("owner", { action: "addDebt", person: "Vaidehi", type: "LENT", amount: 1 + i, note: "" });
  assert(sent.length === 10, "at most 10 debt pushes per sender to one person in 10 minutes: " + sent.length);
}

console.log("\nAll checks passed.");
