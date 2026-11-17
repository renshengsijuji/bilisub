/**
 * 观察 content.js 内部状态：seq / lastSource / targetText 的变化
 */
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
const contexts = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });
await send('Runtime.enable');
await sleep(300);

const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

console.log('调试对象:', await ev(`typeof window.__bilisub`));

for (let i = 0; i < 8; i++) {
  const s = await ev(`(() => { const s = window.__bilisub?.state; return s ? {
    seq: s.seq, enabled: s.enabled, mode: s.mode,
    lastSource: (s.lastSource||'').slice(0,24),
    src: (s.sourceText||'').slice(0,24),
    dst: (s.targetText||'').slice(0,24),
    err: s.lastError,
    overlayDst: document.querySelector('.bs-dst')?.textContent
  } : null })()`);
  console.log(i + 's', JSON.stringify(s));
  await sleep(1000);
}

ws.close();
process.exit(0);
