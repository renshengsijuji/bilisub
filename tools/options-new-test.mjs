/** 新版设置页：截图 + 模型列表 + 运行自检 */
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
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 200000);
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
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 200000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
await send2('Runtime.enable');
await send2('Emulation.setDeviceMetricsOverride', { width: 860, height: 1180, deviceScaleFactor: 1, mobile: false });
await sleep(1500);

console.log('引擎行:', await ev(`document.getElementById('engine').textContent`));
console.log('模型列表:', await ev(`[...document.querySelectorAll('.model-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim()).join(' | ')`));
console.log('目录:', await ev(`document.getElementById('modelsDir').textContent`));

// 运行自检
await ev(`document.getElementById('diag').click()`);
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const tag = await ev(`document.getElementById('diagTag').textContent`);
  if (tag !== '检测中…' && tag !== '未运行') break;
}
console.log('自检结果:');
console.log(await ev(`[...document.querySelectorAll('.diag-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim()).join('\\n')`));
console.log('页面异常:', errors.length, errors.slice(0, 2));

const shot = await send2('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('E:/Deepseek/bili-sub/tools/options-new.png', Buffer.from(shot.data, 'base64'));
ws2.close();
ws.close();
process.exit(0);
