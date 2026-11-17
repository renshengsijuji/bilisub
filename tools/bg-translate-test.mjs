/**
 * 直接从扩展页面测 background 的 TRANSLATE 链路
 */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extId = process.argv[2];
if (!extId) {
  console.log('用法: node bg-translate-test.mjs <extId>');
  process.exit(2);
}

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await sleep(2000);
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);

const evaluate = async (expr) => {
  const r = await send(
    'Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

console.log('引擎状态:', await evaluate(`document.getElementById('engineState').textContent`));

const t0 = Date.now();
try {
  const res = await evaluate(
    `chrome.runtime.sendMessage({type:'TRANSLATE', texts:['Hello, this is a test.'], src:'en', tgt:'zh'})`
  );
  console.log('后台返回(' + (Date.now() - t0) + 'ms):', JSON.stringify(res));
} catch (err) {
  console.log('后台调用失败(' + (Date.now() - t0) + 'ms):', err.message);
}

const info = await evaluate(`chrome.runtime.sendMessage({type:'ENGINE_INFO'})`);
console.log('ENGINE_INFO:', JSON.stringify(info).slice(0, 220));

ws.close();
process.exit(0);
