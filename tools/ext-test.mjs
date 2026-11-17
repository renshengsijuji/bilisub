/**
 * 扩展端到端：本地测试页 → 面板 → 开启字幕翻译 → 检查浮层
 */
const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('ERR: ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  }
});

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error('timeout ' + method))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let id2 = 0;
const pend2 = new Map();
ws2.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend2.has(m.id)) {
    const p = pend2.get(m.id);
    pend2.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('ERR: ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  }
});
const send2 = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id2;
    pend2.set(i, { resolve, reject });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend2.has(i) && (pend2.delete(i), reject(new Error('timeout ' + method))), 30000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

await send2('Runtime.enable');

let hasRoot = false;
for (let i = 0; i < 40; i++) {
  hasRoot = await ev('!!document.querySelector("#bilisub-root")').catch(() => false);
  if (hasRoot) break;
  await sleep(500);
}
console.log('面板注入:', hasRoot);
if (!hasRoot) {
  console.log('日志:', logs.slice(0, 5));
  process.exit(2);
}

await ev(`document.querySelector('.bs-fab').click()`);
await sleep(400);
console.log('面板可见:', await ev(`!document.querySelector('.bs-panel').hidden`));

await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(3500);

const state = await ev(`(() => {
  const o = document.querySelector('.bs-overlay');
  const src = o && o.querySelector('.bs-src');
  const dst = o && o.querySelector('.bs-dst');
  const tip = document.querySelector('[data-role="tip"]');
  const dot = document.querySelector('[data-role="dot"]');
  const r = o && o.getBoundingClientRect();
  return {
    overlay: !!o,
    src: src ? src.textContent : '',
    dst: dst ? dst.textContent : '',
    tip: tip ? tip.textContent : '',
    dot: dot ? dot.className : '',
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    video: (() => { const v = document.querySelector('video'); const b = v.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })()
  };
})()`);
console.log('状态:', JSON.stringify(state, null, 2));

const shot = await send2('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync('E:/Deepseek/bili-sub/tools/ext-shot.png', Buffer.from(shot.data, 'base64'));

console.log('日志:', logs.slice(0, 6));
ws2.close();
ws.close();
process.exit(state.dst && state.dst.length > 0 ? 0 : 1);
