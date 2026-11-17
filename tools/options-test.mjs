/**
 * 设置页验证：模型目录区块是否正常渲染、是否读到当前路径
 */
import fs from 'node:fs';

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const extId = process.argv[2];
if (!extId) {
  console.log('用法: node options-test.mjs <extensionId>');
  process.exit(2);
}
console.log('扩展 ID:', extId);

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error('timeout ' + method))), 20000);
  });

const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await sleep(2500);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

console.log('引擎状态:', await ev(`document.getElementById('engineState').textContent`));
console.log('模型目录:', await ev(`document.getElementById('modelsDir').value`));
console.log('目录信息:', await ev(`document.getElementById('modelsDirMeta').textContent`));
console.log('硬件卡片:', await ev(`document.getElementById('hw').innerText.replace(/\\n/g,' | ')`));
console.log('翻译模型下拉:', await ev(`[...document.getElementById('localModel').options].map(o=>o.textContent).join(',')`));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
fs.writeFileSync('E:/Deepseek/bili-sub/tools/options-shot.png', Buffer.from(shot.data, 'base64'));

ws.close();
process.exit(0);
