// Checks the shared FinMotion helper (index.html): numbers land on the exact
// real value, motion-off / hidden-tab show it instantly, stagger sets delays.
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const src = html.match(/const FinMotion = \(function \(\) \{[\s\S]*?\n    \}\)\(\);/)[0];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

function run(reduced, hidden) {
  const els = [{ dataset: { count: "1240" }, textContent: "" }, { dataset: { count: "32.4", dec: "1" }, textContent: "" }, { dataset: { count: "0" }, textContent: "" }];
  let t = 0, queue = [];
  const kids = [0, 1, 2].map(() => ({ style: {}, classList: { remove() {}, add() { this.added = true; } }, offsetWidth: 1 }));
  const ctx = {
    window: { matchMedia: () => ({ matches: reduced }) }, matchMedia: () => ({ matches: reduced }),
    document: { hidden, documentElement: {}, querySelectorAll: () => els },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: (f) => queue.push(f), parseFloat, parseInt, isFinite, Math
  };
  vm.createContext(ctx);
  vm.runInContext(src + "; this.FM = FinMotion;", ctx);
  ctx.FM.countUp(null);
  const instant = els.map(e => e.textContent);
  let guard = 0;
  while (queue.length && guard++ < 500) { t += 20; const f = queue.shift(); f(t); }
  ctx.FM.stagger({ children: kids });
  return { instant, final: els.map(e => e.textContent), kids };
}
let r = run(false, false);
ok(r.final[0] === "1,240", "counts to 1,240 exactly, got " + r.final[0]);
ok(r.final[1] === "32.4", "decimal lands on 32.4, got " + r.final[1]);
ok(r.final[2] === "0", "zero shows 0");
ok(r.instant[0] === "0", "animated run starts at 0, got " + r.instant[0]);
ok(r.kids[0].style.animationDelay === "0ms" && r.kids[2].style.animationDelay === "110ms", "stagger delays 0/55/110, got " + r.kids[2].style.animationDelay);
r = run(true, false);
ok(r.instant[0] === "1,240", "reduced motion: instant final value");
ok(!r.kids[0].classList.added, "reduced motion: no stagger class");
r = run(false, true);
ok(r.instant[0] === "1,240", "hidden tab: instant final value");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
