// backend/tests/admin.test.js
//
// Plain-English what this checks: the "Access" panel's backend (admin.js). Everyone signed in can ask what they may use; only the
// owner sees the overview or switches a friend's full app on/off; a friend can never switch anything or see the list; a stranger
// is refused; switching works and is reflected straight away. All data here is invented.
// Run with: node backend/tests/admin.test.js

const { build, OWNER, FRIEND } = require("./_ownerWorld");
const { assert } = require("./_fakeSheetsKit");

const w = build(); const sb = w.sb;
w.store["users/" + OWNER + "/friends/other@example.com"] = { fields: { name: "Other", email: "other@example.com", mirror: false, balancePaise: -5000 }, updateTime: "t0" };
w.store["users/" + OWNER + "/friends/mirror@example.com"] = { fields: { name: "Mirror", email: "mirror@example.com", mirror: true, balancePaise: 0 }, updateTime: "t0" };

console.log("\n--- 1. What may I use? ---");
{
  const o = w.act("owner", { action: "getMyAccess" });
  assert(o.ok && o.isOwner === true && o.fullApp === true, "the owner has the full app");
  const f = w.act("friend", { action: "getMyAccess" });
  assert(f.ok && f.isOwner === false && f.fullApp === false, "a friend who is not switched on gets Splits only");
  const s = w.act("stranger", { action: "getMyAccess" });
  assert(s.ok === false && /not allowed/i.test(s.error), "a stranger is refused");
}

console.log("\n--- 2. Only the owner sees the overview ---");
{
  const o = w.act("owner", { action: "getAdminOverview" });
  assert(o.ok && o.totals.everyone === 3 && o.totals.friends === 2 && o.totals.fullApp === 0 && o.totals.splitsOnly === 2, "owner sees 3 people with access (him + 2 friends; a mirror entry is not counted): " + JSON.stringify(o.totals));
  assert(o.people.every(function(p){ return p.email !== "mirror@example.com"; }), "mirror entries are not listed as people with access");
  assert(o.owner.onPrivateCopy === false && typeof o.usage.readsPct === "number", "owner status and today's usage are included");
  const f = w.act("friend", { action: "getAdminOverview" });
  assert(f.ok === false && /not allowed/i.test(f.error) && !f.people, "a friend cannot see the overview");
}

console.log("\n--- 3. Switching a friend's full app ---");
{
  const r = w.act("owner", { action: "setFriendFullApp", email: FRIEND, on: true });
  assert(r.ok && r.totals.fullApp === 1 && r.people.filter(function(p){ return p.email === FRIEND; })[0].fullApp === true, "switching on is reflected at once");
  const f = w.act("friend", { action: "getMyAccess" });
  assert(f.fullApp === true, "the friend now sees the full app");
  const cash = w.act("friend", { action: "getCash" });
  assert(cash.ok === true, "and can really use it (Cash screen answers)");
  const r2 = w.act("owner", { action: "setFriendFullApp", email: FRIEND, on: false });
  assert(r2.ok && r2.totals.fullApp === 0, "switching off is reflected at once");
  assert(w.act("friend", { action: "getCash" }).ok === false, "and the friend is back to Splits only");
  const bad = w.act("owner", { action: "setFriendFullApp", email: "nobody@example.com", on: true });
  assert(bad.ok === false, "a person who is not one of his friends cannot be switched on");
  const self = w.act("owner", { action: "setFriendFullApp", email: OWNER, on: true });
  assert(self.ok === false, "the owner's own address is refused here");
  const sneaky = w.act("friend", { action: "setFriendFullApp", email: FRIEND, on: true });
  assert(sneaky.ok === false && w.act("friend", { action: "getMyAccess" }).fullApp === false, "a friend cannot switch himself on");
  const stranger = w.act("stranger", { action: "setFriendFullApp", email: FRIEND, on: true });
  assert(stranger.ok === false, "a stranger cannot switch anyone on");
  assert(w.errors("ADMIN_FULL_APP").length === 2, "each switch was logged (" + w.errors("ADMIN_FULL_APP").length + ")");
}
