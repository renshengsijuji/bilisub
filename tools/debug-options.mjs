const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const sw = list.find((t) => t.type === 'service_worker' && t.url.includes('/background.js'));
if (!sw) {
  console.log('no sw');
  process.exit(2);
}
const extId = new URL(sw.url).host;
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 15000);
  });

const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await sleep(2000);
const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list2.find((x) => x.id === targetId);
console.log('target url:', t && t.url);

const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
  return r.result.value;
};
console.log('href:', await ev('location.href'));
console.log('title:', await ev('document.title'));
console.log('body:', await ev('document.body ? document.body.innerText.slice(0, 400) : "no body"'));
ws.close();
process.exit(0);
