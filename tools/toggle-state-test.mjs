/**
 * 开关状态测试：
 * 1) 存储里 enabled=true 时重新打开页面，按钮应显示「启动」（不恢复会话）
 * 2) 听声模式启动失败后，按钮应回到「启动」
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

// 1) 先在存储里写入 enabled=true（模拟上一次会话）
const { targetId: optId } = await send('Target.createTarget', { url: `chrome-extension://${process.argv[2]}/options/options.html` });
await sleep(1500);
{
  const { ws2, ev } = await attach(optId);
  await ev(`chrome.storage.local.set({ enabled: true, mode: 'audio' })`);
  ws2.close();
}

// 2) 打开视频页，检查按钮状态
const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2500);
const { ws2, ev } = await attach(targetId);
for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
console.log('打开面板:', await ev(`JSON.stringify({ toggle: document.querySelector('[data-act="toggle"]')?.textContent, tip: document.querySelector('[data-role="tip"]')?.textContent })`));

// 3) 切到听声并点启动（预期失败后复位）
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'audio').click()`);
await sleep(400);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(4000);
console.log('听声启动后:', await ev(`JSON.stringify({ toggle: document.querySelector('[data-act="toggle"]')?.textContent, tip: document.querySelector('[data-role="tip"]')?.textContent })`));

ws2.close();
ws.close();
process.exit(0);
