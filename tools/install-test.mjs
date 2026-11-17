/**
 * 安装流程测试：在设置页点击「Whisper tiny」安装，等待完成
 * 用法: node install-test.mjs <extId>
 */
const PORT = 9333;
const extId = process.argv[2];
if (!extId) {
  console.log('用法: node install-test.mjs <extId>');
  process.exit(2);
}
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

const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await sleep(2500);
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};

// 找到 Whisper tiny 这一行并点击安装
const clicked = await ev(`(() => {
  const rows = [...document.querySelectorAll('.model')];
  const row = rows.find(r => r.textContent.includes('Whisper tiny'));
  if (!row) return 'not-found';
  const btn = row.querySelector('button');
  if (btn.disabled) return 'disabled:' + btn.textContent;
  btn.click();
  return 'clicked';
})()`);
console.log('点击结果:', clicked);

for (let i = 0; i < 60; i++) {
  await sleep(2000);
  const state = await ev(`(() => {
    const rows = [...document.querySelectorAll('.model')];
    const row = rows.find(r => r.textContent.includes('Whisper tiny'));
    if (!row) return null;
    const meta = row.querySelector('.meta');
    const bar = row.querySelector('[data-role="bar"] > i');
    return {
      meta: meta ? meta.textContent.trim() : '',
      button: row.querySelector('button').textContent,
      width: bar ? bar.style.width : ''
    };
  })()`);
  if (!state) break;
  console.log(`${i * 2}s`, state.button, '|', state.meta, '|', state.width);
  if (state.button === '已安装') break;
  if (state.button === '重试') {
    console.log('安装失败');
    break;
  }
}

const dirMeta = await ev(`document.getElementById('modelsDirMeta').textContent`);
console.log('目录信息:', dirMeta);
ws.close();
process.exit(0);
