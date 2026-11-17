/** 闪烁检测：新字幕到达时译文是否会出现空白 */
const PORT = Number(process.env.CDP_PORT || 9333);
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
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 20000);
  });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('8099'));
if (!page) {
  console.log('没有 fixture 页面');
  process.exit(2);
}
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
await send2('Runtime.enable');

let blanks = 0;
let samples = 0;
let pendingSamples = 0;
let lastSrc = '';
const start = Date.now();
while (Date.now() - start < 12000) {
  await sleep(50);
  const s = await ev(`(() => {
    const src = document.querySelector('.bs-src')?.textContent || '';
    const dst = document.querySelector('.bs-dst')?.textContent || '';
    const ov = document.querySelector('.bs-overlay');
    return { src, dst, pending: ov ? ov.classList.contains('bs-pending') : false };
  })()`);
  samples++;
  if (s.pending) pendingSamples++;
  if (s.src && !s.dst) blanks++;
  if (s.src !== lastSrc) lastSrc = s.src;
}

console.log(`样本 ${samples}（12 秒 / 50ms）`);
console.log(`译文空白样本: ${blanks}`);
console.log(`处于“更新中”的样本: ${pendingSamples}`);
ws2.close();
ws.close();
process.exit(0);
