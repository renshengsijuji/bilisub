/** 往扩展 storage 写入 enabled=true / mode=audio，模拟“上次会话开着” */
const PORT = Number(process.env.CDP_PORT || 9333);
const extId = process.argv[2];
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

const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await new Promise((r) => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
ws2.send(
  JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: "chrome.storage.local.set({ enabled: true, mode: 'audio' }).then(() => 'done')",
      awaitPromise: true,
      returnByValue: true
    }
  })
);
await new Promise((r) => setTimeout(r, 1200));
console.log('storage set');
ws2.close();
ws.close();
process.exit(0);
