/** 检查新设置页：模型下拉是否合并了 Ollama、是否有 JS 报错 */
import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9333);
const extId = process.argv[2];
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

const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await sleep(2500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let n2 = 0;
const p2 = new Map();
const errors = [];
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p2.has(m.id)) {
    const q = p2.get(m.id);
    p2.delete(m.id);
    m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || 'exception');
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
await send2('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
await sleep(1200);

console.log('实时下拉:', await ev(`[...document.querySelectorAll('#realtimeModel optgroup')].map(g => g.label + ': ' + [...g.children].map(o => o.textContent).join(' / ')).join(' | ')`));
console.log('高质量下拉:', await ev(`[...document.querySelectorAll('#qualityModel optgroup')].map(g => g.label + ': ' + [...g.children].map(o => o.textContent).join(' / ')).join(' | ')`));
console.log('当前选中:', await ev(`document.querySelector('#realtimeModel').value + ' | ' + document.querySelector('#qualityModel').value`));
console.log('页面异常:', errors.length, errors.slice(0, 2));

const shot = await send2('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('E:/Deepseek/bili-sub/tools/options-shot2.png', Buffer.from(shot.data, 'base64'));
ws2.close();
ws.close();
process.exit(0);
