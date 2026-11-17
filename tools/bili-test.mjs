/**
 * 真实 B 站页面测试：注入 / 面板 / 字幕模式 / 无字幕提示
 */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let n = 0;
const pend = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: 'https://www.bilibili.com/video/BV1GJ411x7h7' });
await sleep(4000);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let n2 = 0;
const pend2 = new Map();
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend2.has(m.id)) {
    const p = pend2.get(m.id);
    pend2.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  }
});
const send2 = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n2;
    pend2.set(i, { resolve: res, reject: rej });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend2.has(i) && (pend2.delete(i), rej(new Error('timeout'))), 30000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
await send2('Runtime.enable');

for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector("#bilisub-root")').catch(() => false)) break;
  await sleep(500);
}

console.log('页面:', await ev('document.title'));
console.log('面板注入:', await ev('!!document.querySelector("#bilisub-root")'));
console.log('按钮可见(有视频):', await ev('!document.querySelector("#bilisub-root").hidden'));
console.log('识别到的视频尺寸:', await ev(`(() => { const v=[...document.querySelectorAll('video')].sort((a,b)=>b.offsetWidth*b.offsetHeight-a.offsetWidth*a.offsetHeight)[0]; return v ? v.offsetWidth+'x'+v.offsetHeight : 'none'; })()`));

await ev(`document.querySelector('.bs-fab').click()`);
await sleep(400);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(6000);

console.log('面板提示:', await ev(`document.querySelector('[data-role="tip"]').textContent`));
console.log('状态点:', await ev(`document.querySelector('[data-role="dot"]').className`));
console.log('浮层文本:', JSON.stringify(await ev(`(() => { const o=document.querySelector('.bs-overlay'); return o ? o.innerText : '(无浮层)' })()`)));
console.log('页面异常:', logs.slice(0, 5));

const shot = await send2('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync('E:/Deepseek/bili-sub/tools/bili-shot.png', Buffer.from(shot.data, 'base64'));

ws2.close();
ws.close();
process.exit(0);
