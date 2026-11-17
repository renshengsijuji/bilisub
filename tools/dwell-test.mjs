/** 验证：单条字幕在源消失后还能停留多久（应 >= 1.8s），以及替换是否无空白 */
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
const ctx = [];
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p2.has(m.id)) {
    const q = p2.get(m.id);
    p2.delete(m.id);
    m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.executionContextCreated') ctx.push(m.params.context);
});
const send2 = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n2;
    p2.set(i, { resolve: res, reject: rej });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 20000);
  });
await send2('Runtime.enable');
await sleep(400);
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// 确保浮层已创建
await ev(`(() => { const s=window.__bilisub?.state; return s ? !!s.overlay : false })()`);

// 注入一条字幕（模拟字幕源），然后不再更新，观察它停留多久
await ev(`window.__bilisub.onCaption('This is a dwell test sentence for subtitle continuity.', true)`);
await sleep(400);
const shown = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
console.log('译文:', JSON.stringify(shown));

const start = Date.now();
let clearedAt = null;
for (let i = 0; i < 80; i++) {
  await sleep(100);
  const dst = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
  if (!dst) {
    clearedAt = Date.now() - start;
    break;
  }
}
console.log(clearedAt === null ? '超过 8 秒仍未清除' : `停留时长: ${clearedAt}ms`);
ws2.close();
ws.close();
process.exit(0);
