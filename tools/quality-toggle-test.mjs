/** 验证「高质量模式」勾选框是否真的生效：对比字幕翻译延迟 */
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

for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(300);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(2500);

async function measure(label, seconds) {
  const start = Date.now();
  let lastSrc = '';
  let srcAt = 0;
  const delays = [];
  while (Date.now() - start < seconds * 1000) {
    await sleep(50);
    const s = await ev(`(() => {
      const src = document.querySelector('.bs-src')?.textContent || '';
      const dst = document.querySelector('.bs-dst')?.textContent || '';
      return { src, dst };
    })()`);
    if (s.src && s.src !== lastSrc) {
      lastSrc = s.src;
      srcAt = Date.now();
    } else if (s.dst && srcAt && Date.now() - srcAt < 3000 && !delays.some((d) => d.src === lastSrc)) {
      delays.push({ src: lastSrc, ms: Date.now() - srcAt });
    }
  }
  const avg = delays.length ? Math.round(delays.reduce((a, b) => a + b.ms, 0) / delays.length) : 0;
  console.log(`${label}: ${delays.length} 句  平均 ${avg}ms  明细 ${delays.map((d) => d.ms).join('/')}`);
}

await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(c.checked){ c.click(); } })()`);
await sleep(500);
await measure('高质量模式 关', 11);

await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(!c.checked){ c.click(); } })()`);
await sleep(500);
await measure('高质量模式 开', 11);

ws2.close();
ws.close();
process.exit(0);
