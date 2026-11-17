const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 20000);
  });

const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let n2 = 0;
const p2 = new Map();
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p2.has(m.id)) {
    const q = p2.get(m.id);
    p2.delete(m.id);
    m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
  }
});
const send2 = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n2;
    p2.set(i, { resolve: res, reject: rej });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 20000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

const snap = () =>
  ev(`(() => ({
    toggle: document.querySelector('[data-act="toggle"]')?.textContent,
    tip: document.querySelector('[data-role="tip"]')?.textContent,
    src: document.querySelector('.bs-src')?.textContent,
    dst: document.querySelector('.bs-dst')?.textContent,
    hidden: document.querySelector('#bilisub-root')?.hidden
  }))()`);

for (let i = 0; i < 30; i++) {
  if (await ev('!!document.querySelector("#bilisub-root")').catch(() => false)) break;
  await sleep(500);
}
console.log('初始:', JSON.stringify(await snap()));

await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
console.log('打开面板:', JSON.stringify(await snap()));

await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(600);
console.log('点击后 0.6s:', JSON.stringify(await snap()));
await sleep(3000);
console.log('点击后 3.6s:', JSON.stringify(await snap()));

ws2.close();
ws.close();
process.exit(0);
