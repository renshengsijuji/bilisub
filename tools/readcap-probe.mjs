const PORT = 9333;
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 15000);
  });
await send('Runtime.enable');
await sleep(400);
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

console.log('state.enabled:', await ev('window.__bilisub?.state?.enabled'));
console.log('readCaption():', JSON.stringify(await ev('window.__bilisub?.readCaption ? window.__bilisub.readCaption() : "no-export"')));
console.log(
  'segment 几何:',
  JSON.stringify(
    await ev(`(() => {
      const el = document.querySelector('.ytp-caption-segment');
      if (!el) return 'none';
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, offsetParent: el.offsetParent ? el.offsetParent.className || el.offsetParent.tagName : null,
               display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility,
               opacity: getComputedStyle(el).opacity, parentOpacity: getComputedStyle(el.parentElement).opacity };
    })()`)
  )
);
console.log('state.video:', await ev('!!window.__bilisub?.state?.video'));
console.log('tick 是否在跑:', await ev(`(() => { const s = window.__bilisub?.state; return { enabled: s?.enabled, mode: s?.mode, audio: s?.audio }; })()`));

ws.close();
process.exit(0);
