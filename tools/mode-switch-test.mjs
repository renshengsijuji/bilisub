/**
 * 模式切换状态机测试：字幕 → 听声(预期失败) → 字幕
 */
const PORT = 9333;
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

const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2000);
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

const snap = () =>
  ev(`(() => { const s = window.__bilisub?.state; return {
    mode: document.querySelector('.bs-tab.is-active')?.dataset.mode,
    enabled: s?.enabled, audio: s?.audio, dst: (s?.targetText||'').slice(0,20),
    tip: document.querySelector('[data-role="tip"]')?.textContent,
    toggle: document.querySelector('[data-act="toggle"]')?.textContent
  } })()`);

for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(200);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(200);
console.log('切换前:', JSON.stringify(await snap()));

await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(5000);
console.log('字幕启动后:', JSON.stringify(await snap()));

await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'audio').click()`);
await sleep(2500);
console.log('切到听声:', JSON.stringify(await snap()));

await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(2500);
console.log('切回字幕:', JSON.stringify(await snap()));

ws2.close();
ws.close();
process.exit(0);
