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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 15000);
  });

const { targetId } = await send('Target.createTarget', { url: 'chrome://extensions-internals/' });
await sleep(2000);
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
  return r.result.value;
};
const text = await ev('document.body.innerText');
let data = null;
try {
  data = JSON.parse(String(text));
} catch {
  console.log('无法解析:', String(text).slice(0, 300));
  process.exit(1);
}
const mine = data.find((e) => (e.path || '').toLowerCase().includes('bili-sub'));
if (!mine) {
  console.log('未找到扩展，现有条目:', data.map((e) => e.name + ' ' + e.path).join('\n'));
  process.exit(2);
}
console.log('EXT_ID=' + mine.id);
console.log('NAME=' + mine.name);
console.log('STATE=' + (mine.disable_reasons || []).join(','));
ws.close();
process.exit(0);
