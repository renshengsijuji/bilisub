const PORT = 9333;
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 15000);
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result.value;
};

console.log(await ev(`(() => {
  const root = document.querySelector('#bilisub-root');
  const panel = document.querySelector('.bs-panel');
  const overlay = document.querySelector('.bs-overlay');
  const src = document.querySelector('.bs-src');
  const dst = document.querySelector('.bs-dst');
  const tip = document.querySelector('[data-role="tip"]');
  const toggle = document.querySelector('[data-act="toggle"]');
  return JSON.stringify({
    rootHidden: root ? root.hidden : 'no-root',
    panelHidden: panel ? panel.hidden : 'no-panel',
    overlayText: overlay ? overlay.innerText : 'no-overlay',
    srcText: src ? src.textContent : '',
    srcHidden: src ? src.hidden : '',
    dstText: dst ? dst.textContent : '',
    tip: tip ? tip.textContent : '',
    toggle: toggle ? toggle.textContent : '',
    classes: overlay ? overlay.className : ''
  }, null, 2);
})()`));
ws.close();
process.exit(0);
