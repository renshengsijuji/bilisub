/** 打开 popup 页面并截图 */
import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9333);
const extId = process.argv[2];
if (!extId) {
  console.log('用法: node popup-shot.mjs <extId>');
  process.exit(2);
}
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

const url = `chrome-extension://${extId}/popup/popup.html`;
const { targetId } = await send('Target.createTarget', { url });
await new Promise((r) => setTimeout(r, 2000));
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
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 20000);
  });
await send2('Runtime.enable');
await send2('Emulation.setDeviceMetricsOverride', { width: 320, height: 560, deviceScaleFactor: 2, mobile: false });
await new Promise((r) => setTimeout(r, 800));
const shot = await send2('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('E:/Deepseek/bili-sub/tools/popup-shot.png', Buffer.from(shot.data, 'base64'));
const text = await send2('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
console.log(text.result.value.slice(0, 300));
ws2.close();
ws.close();
process.exit(0);
