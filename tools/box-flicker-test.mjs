/** 验证：换字过程中底框不会消失（只换文字） */
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

// 打开面板并启动字幕模式
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

let violations = 0;
let samples = 0;
let srcChanges = 0;
let lastSrc = '';
const start = Date.now();
while (Date.now() - start < 12000) {
  await sleep(50);
  const s = await ev(`(() => {
    const box = document.querySelector('.bs-box');
    const src = document.querySelector('.bs-src');
    const dst = document.querySelector('.bs-dst');
    const srcText = src?.textContent || '';
    const dstText = dst?.textContent || '';
    const visible = box ? !box.hidden && box.getBoundingClientRect().height > 2 : false;
    return { srcText, dstText, visible, h: box ? box.getBoundingClientRect().height : 0 };
  })()`);
  samples++;
  if (s.srcText !== lastSrc) {
    srcChanges++;
    lastSrc = s.srcText;
  }
  if ((s.srcText || s.dstText) && !s.visible) violations++;
}

console.log(`样本 ${samples}（12 秒 / 50ms），字幕换句 ${srcChanges} 次`);
console.log(`有文字但底框不可见的样本: ${violations}`);
ws2.close();
ws.close();
process.exit(0);
