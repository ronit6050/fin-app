// functions/runtime/syncfetch.js
//
// PLAIN-ENGLISH WHAT THIS IS: the backend code was written for Apps Script, where "fetch a web address" simply WAITS for the answer
// (UrlFetchApp.fetch). Node normally does not wait. This gives the same waiting behaviour: a small helper thread does the real
// fetch while this thread sleeps until the answer is ready. Because it waits, one server instance handles one request at a time
// (the function is deployed with concurrency 1), exactly like Apps Script.

const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const signal = new Int32Array(workerData.signalBuffer);
parentPort.on("message", async (msg) => {
  let reply;
  try {
    const init = { method: msg.method, headers: msg.headers, redirect: msg.followRedirects === false ? "manual" : "follow" };
    if (msg.body !== undefined && msg.body !== null && msg.method !== "GET" && msg.method !== "HEAD") init.body = msg.body;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), msg.timeoutMs || 50000);
    const res = await fetch(msg.url, { ...init, signal: ctl.signal });
    const text = await res.text();
    clearTimeout(timer);
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    reply = { ok: true, status: res.status, headers, text };
  } catch (err) {
    reply = { ok: false, error: String(err && err.message || err) };
  }
  msg.port.postMessage(reply);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
`;

let worker = null;
let signalArray = null;

function ensureWorker(){
  if(worker) return;
  const signalBuffer = new SharedArrayBuffer(4);
  signalArray = new Int32Array(signalBuffer);
  worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { signalBuffer } });
  worker.unref();
}

// req: { url, method, headers, body, followRedirects, timeoutMs }. Returns { status, headers, text }. Throws on a network failure.
function syncFetch(req){
  ensureWorker();
  const { port1, port2 } = new MessageChannel();
  Atomics.store(signalArray, 0, 0);
  worker.postMessage({ ...req, port: port2 }, [port2]);
  // Sleep until the helper thread says it is done (a hard cap so a stuck call can never hang the server for ever)
  const waited = Atomics.wait(signalArray, 0, 0, (req.timeoutMs || 50000) + 5000);
  if(waited === "timed-out") throw new Error("Network call did not finish in time.");
  const got = receiveMessageOnPort(port1);
  port1.close();
  if(!got) throw new Error("Network call returned nothing.");
  const reply = got.message;
  if(!reply.ok) throw new Error(reply.error);
  return { status: reply.status, headers: reply.headers, text: reply.text };
}

function syncSleep(ms){
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

module.exports = { syncFetch, syncSleep };
