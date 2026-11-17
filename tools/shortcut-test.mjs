/** 快捷键注册 + 听声失败提示 实测 */
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

async function attach(targetId) {
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
  const ev = async (expr) => {
    const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
    return r.result.value;
  };
  await send2('Runtime.enable');
  return { ws2, ev };
}

// 1) 快捷键
const { targetId: optId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await sleep(1500);
{
  const { ws2, ev } = await attach(optId);
  const cmds = await ev(`chrome.commands.getAll()`);
  console.log('快捷键注册:', JSON.stringify(cmds));
  const popup = await ev(`chrome.runtime.sendMessage({ type: 'OPEN_POPUP' })`);
  console.log('OPEN_POPUP:', JSON.stringify(popup));
  ws2.close();
}

// 2) 面板听声失败提示
const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2500);
const { ws2, ev } = await attach(targetId);
for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'audio').click()`);
await sleep(300);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(3000);
console.log('听声失败提示:', await ev(`document.querySelector('[data-role="tip"]').textContent`));
console.log('按钮状态:', await ev(`document.querySelector('[data-act="toggle"]').textContent`));

ws2.close();
ws.close();
process.exit(0);
