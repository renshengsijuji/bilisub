/**
 * B 站智能模式：无字幕时应自动尝试听声，并给出可操作提示
 */
const PORT = Number(process.env.CDP_PORT || 9333);
const URL = process.argv[2] || 'https://www.bilibili.com/video/BV1VxWq6WE3h/';
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: URL });
await sleep(5000);
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
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 30000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
await send2('Runtime.enable');

for (let i = 0; i < 60; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}
if (!(await ev('!!document.querySelector(".bs-fab")'))) {
  console.log('面板未注入，页面标题:', await ev('document.title'));
  process.exit(3);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
console.log('模式:', await ev(`document.querySelector('.bs-tab.is-active')?.textContent`));
await ev(`document.querySelector('[data-act="toggle"]').click()`);

for (let i = 0; i < 8; i++) {
  await sleep(1500);
  const s = await ev(`(() => ({
    tip: document.querySelector('[data-role="tip"]').textContent,
    dst: document.querySelector('.bs-dst')?.textContent || ''
  }))()`);
  console.log(`${(i + 1) * 1.5}s`, JSON.stringify(s));
  if (s.tip.includes('工具栏') || s.tip.includes('自动切换')) break;
}

ws2.close();
ws.close();
process.exit(0);
