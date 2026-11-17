/** 检查勾选框是否真的修改了 state.qualityMode */
const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('8099'));
if (!page) {
  console.log('没有 fixture 页面');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0;
const pend = new Map();
const ctx = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.executionContextCreated') ctx.push(m.params.context);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 20000);
  });
await send('Runtime.enable');
await sleep(400);
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

console.log('初始 qualityMode:', await ev('window.__bilisub?.state?.qualityMode'));
console.log('勾选框 checked:', await ev(`document.querySelector('[data-k="qualityMode"]')?.checked`));
await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(!c.checked) c.click(); })()`);
await sleep(300);
console.log('点击后 qualityMode:', await ev('window.__bilisub?.state?.qualityMode'));
console.log('点击后 checked:', await ev(`document.querySelector('[data-k="qualityMode"]')?.checked`));
console.log('storage:', JSON.stringify(await ev(`new Promise(r => chrome.storage.local.get(['qualityMode'], r))`)));
ws.close();
process.exit(0);
