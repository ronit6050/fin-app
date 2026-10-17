// Checks the pure logic behind the new-look Pending swipe-to-confirm (index.html, block
// between FIN-LOGIC-START and FIN-LOGIC-END): which cards may be swiped, and the
// "confirm now, send after a short undo window" queue (undo, flush, one at a time).
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const m = html.match(/FIN-LOGIC-START\r?\n([\s\S]*?)\/\/ FIN-LOGIC-END/);
if (!m) { console.log("FAIL: logic block not found"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + "; this.elig = finSwipeEligibility; this.mk = finMakeConfirmQueue;", ctx);

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };

// ---- eligibility ----
const base = { note: "lunch", typeRequired: true, type: "Need" };
ok(ctx.elig(base).ok === true, "note + type = ready");
ok(ctx.elig({ ...base, note: "   " }).ok === false && /note/i.test(ctx.elig({ ...base, note: "" }).hint), "empty note refused with a note hint");
ok(ctx.elig({ ...base, type: null }).ok === false && /Need, Want or Saving/.test(ctx.elig({ ...base, type: null }).hint), "missing type refused");
ok(ctx.elig({ ...base, type: null, typeUnsure: true }).ok === true, "'Not sure' counts as an answer");
ok(ctx.elig({ note: "salary", typeRequired: false, type: null }).ok === true, "no type question on this card (credit / rent / lending) = ready");
ok(ctx.elig({ ...base, needsDirection: true, direction: "" }).ok === false, "unread message: direction missing refused");
ok(ctx.elig({ ...base, needsDirection: true, direction: "debit" }).ok === true, "direction chosen = ready");
ok(ctx.elig({ ...base, needsAmount: true, amount: "0" }).ok === false, "amount 0 refused");
ok(ctx.elig({ ...base, needsAmount: true, amount: "120.5" }).ok === true, "amount given = ready");
ok(ctx.elig({ ...base, splitOpen: true }).ok === false, "open split panel refused");
ok(ctx.elig({}).ok === false, "empty state refused, no crash");

// ---- confirm queue with a fake clock ----
function harness() {
  const timers = []; const log = [];
  const q = ctx.mk({
    delayMs: 4000,
    setTimer: (f, ms) => { const t = { f, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; }
  });
  const entry = (name) => ({ commit: () => log.push("send " + name), onUndo: () => log.push("undo " + name), onDone: (h) => log.push("done " + name + " " + h) });
  const tick = () => { timers.filter(t => t.live).forEach(t => { t.live = false; t.f(); }); };
  return { q, log, entry, tick, timers };
}
let h = harness();
h.q.add(h.entry("A"));
ok(h.log.length === 0 && h.q.pending(), "nothing is sent while the undo window is open");
ok(h.timers[0].ms === 4000, "window is 4 seconds");
h.tick();
ok(h.log.join("|") === "send A|done A sent" && !h.q.pending(), "window ends: it is sent exactly once");

h = harness();
h.q.add(h.entry("A"));
ok(h.q.undo() === true, "undo works inside the window");
h.tick();
ok(h.log.join("|") === "undo A|done A undone", "undone card is never sent, even when the timer would have fired");
ok(h.q.undo() === false, "undo with nothing waiting is a no-op");

h = harness();
h.q.add(h.entry("A"));
ok(h.q.flush() === true, "flush sends right away (leaving the screen / closing the app)");
h.tick();
ok(h.log.join("|") === "send A|done A sent", "flushed card is sent once, not again by the timer");
ok(h.q.flush() === false, "second flush: nothing left");

h = harness();
h.q.add(h.entry("A"));
h.q.add(h.entry("B"));
ok(h.log.join("|") === "send A|done A sent", "a newer confirm sends the older one first");
ok(h.q.pending(), "newer one still waiting");
h.q.undo();
ok(h.log.join("|") === "send A|done A sent|undo B|done B undone", "only the newest can be undone; the older one stays sent");

// a failing send must not wedge the queue
h = harness();
h.q.add({ commit: () => { throw new Error("boom"); }, onUndo() {}, onDone: (x) => h.log.push("done " + x) });
let threw = false; try { h.q.flush(); } catch (e) { threw = true; }
ok(threw && !h.q.pending() && h.log.join("|") === "done sent", "a failing send is reported and the queue is clear again");
h.q.add(h.entry("C"));
ok(h.q.pending(), "queue still usable afterwards");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
