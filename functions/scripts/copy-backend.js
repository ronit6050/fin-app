// functions/scripts/copy-backend.js
//
// Runs automatically before every deploy (see firebase.json "predeploy"): copies the backend code (backend/*.js, NOT the tests) into
// functions/backend/ so it is uploaded with the function. That way there is ONE copy of the logic in the repo, shared by Apps Script
// and the new server. functions/backend/ is generated and git-ignored.
const fs = require("node:fs");
const path = require("node:path");
const src = path.join(__dirname, "..", "..", "backend");
const dst = path.join(__dirname, "..", "backend");
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
let n = 0;
fs.readdirSync(src).forEach(function(f){
  if(f.endsWith(".js")){ fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
});
console.log("Copied " + n + " backend files into functions/backend");
