/**
 * 新版 UI / 模式 / 语言 综合测试
 */
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2500);
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
await send2('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

for (let i = 0; i < 30; i++) {
  if (await ev('!!document.querySelector("#bilisub-root")').catch(() => false)) break;
  await sleep(500);
}

const ui = await ev(`(() => ({
  tabs: [...document.querySelectorAll('.bs-tab')].map(t => t.textContent),
  activeTab: document.querySelector('.bs-tab.is-active')?.textContent,
  langs: [...document.querySelectorAll('[data-k="srcLang"] option')].map(o => o.value),
  hasQuality: !!document.querySelector('[data-k="qualityMode"]'),
  fab: !!document.querySelector('.bs-fab')
}))()`);
console.log('UI:', JSON.stringify(ui));

// 打开面板截图
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(400);
const shot1 = await send2('Page.captureScreenshot', { format: 'png' });
(await import('node:fs')).writeFileSync('E:/Deepseek/bili-sub/tools/ui-panel.png', Buffer.from(shot1.data, 'base64'));

// 切到「字幕」并启动
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(300);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(3500);
const sub = await ev(`(() => ({
  mode: document.querySelector('.bs-tab.is-active')?.textContent,
  tip: document.querySelector('[data-role="tip"]').textContent,
  src: document.querySelector('.bs-src')?.textContent,
  dst: document.querySelector('.bs-dst')?.textContent,
  toggle: document.querySelector('[data-act="toggle"]').textContent
}))()`);
console.log('字幕模式:', JSON.stringify(sub));

// 中文直出：语言切到中文
await ev(`(() => { const s=document.querySelector('[data-k="srcLang"]'); s.value='zh'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
await sleep(3000);
const zh = await ev(`(() => ({
  src: document.querySelector('.bs-src')?.textContent,
  dst: document.querySelector('.bs-dst')?.textContent,
  tip: document.querySelector('[data-role="tip"]').textContent
}))()`);
console.log('中文直出:', JSON.stringify(zh));

// 切回英文 + 智能模式
await ev(`(() => { const s=document.querySelector('[data-k="srcLang"]'); s.value='en'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
await sleep(500);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'smart').click()`);
await sleep(2500);
const smart = await ev(`(() => ({
  mode: document.querySelector('.bs-tab.is-active')?.textContent,
  tip: document.querySelector('[data-role="tip"]').textContent,
  dst: document.querySelector('.bs-dst')?.textContent
}))()`);
console.log('智能模式:', JSON.stringify(smart));

const shot2 = await send2('Page.captureScreenshot', { format: 'png' });
(await import('node:fs')).writeFileSync('E:/Deepseek/bili-sub/tools/ui-running.png', Buffer.from(shot2.data, 'base64'));

ws2.close();
ws.close();
process.exit(0);
