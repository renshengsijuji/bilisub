/** 验证：未启动时无空框；停止后文本框立即消失且不被在途翻译写回 */
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
await send('Runtime.enable');

const state = () =>
  ev(`(() => {
    const box = document.querySelector('.bs-box');
    const ov = document.querySelector('.bs-overlay');
    return {
      boxVisible: box ? !box.hidden && box.getBoundingClientRect().height > 2 : false,
      ovDisplay: ov ? getComputedStyle(ov).display : 'none',
      src: document.querySelector('.bs-src')?.textContent || '',
      dst: document.querySelector('.bs-dst')?.textContent || ''
    };
  })()`);

for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}

console.log('未启动时:', JSON.stringify(await state()));

await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(300);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
for (let i = 0; i < 30; i++) {
  await sleep(300);
  const s = await state();
  if (s.dst) {
    console.log('翻译中出现文本:', JSON.stringify(s));
    break;
  }
}

await ev(`document.querySelector('[data-act="toggle"]').click()`);
let hiddenAt = null;
for (let i = 0; i < 25; i++) {
  await sleep(100);
  const s = await state();
  const hidden = !s.boxVisible && s.ovDisplay === 'none';
  if (hidden && hiddenAt === null) hiddenAt = (i + 1) * 100;
  if (!hidden) {
    console.log(`✗ ${(i + 1) * 100}ms 仍有残留:`, JSON.stringify(s));
    break;
  }
}
console.log(hiddenAt !== null ? `停止后 ${hiddenAt}ms 内消失，之后 2.5 秒保持隐藏` : '✗ 停止后仍有残留');

ws.close();
process.exit(0);
