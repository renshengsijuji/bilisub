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
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 20000);
  });
const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2000);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let n2 = 0;
const p2 = new Map();
const logs = [];
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p2.has(m.id)) {
    const q = p2.get(m.id);
    p2.delete(m.id);
    m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 120));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + JSON.stringify(m.params.args?.[0]?.value || '').slice(0, 120));
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

console.log('caption 节点:', await ev(`document.querySelectorAll('.ytp-caption-segment').length`));
console.log('caption 文本:', JSON.stringify(await ev(`document.querySelector('.ytp-caption-segment')?.textContent`)));
console.log('video:', await ev(`(() => { const v=document.querySelector('video'); return v ? v.offsetWidth+'x'+v.offsetHeight : 'none' })()`));

await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
console.log('面板:', await ev(`JSON.stringify({ hidden: document.querySelector('.bs-panel')?.hidden, tab: document.querySelector('.bs-tab.is-active')?.dataset.mode })`));
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(300);
console.log('切tab后:', await ev(`JSON.stringify({ tab: document.querySelector('.bs-tab.is-active')?.dataset.mode, toggle: document.querySelector('[data-act="toggle"]')?.textContent })`));
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(300);
console.log('点启动后:', await ev(`JSON.stringify({ toggle: document.querySelector('[data-act="toggle"]')?.textContent, tip: document.querySelector('[data-role="tip"]')?.textContent })`));

for (let i = 0; i < 12; i++) {
  await sleep(600);
  const s = await ev(`(() => ({
    src: document.querySelector('.bs-src')?.textContent || '',
    dst: document.querySelector('.bs-dst')?.textContent || '',
    tip: document.querySelector('[data-role="tip"]')?.textContent?.slice(0,26),
    toggle: document.querySelector('[data-act="toggle"]')?.textContent
  }))()`);
  console.log(`${(i + 1) * 0.6}s`, JSON.stringify(s));
}
console.log('logs:', logs.slice(0, 5));
ws2.close();
ws.close();
process.exit(0);
