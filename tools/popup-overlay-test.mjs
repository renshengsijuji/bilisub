/** 验证 popup 的「在当前页启动」链路（BS_STATE / BS_TOGGLE） */
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

await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2000);
const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
await sleep(1500);
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

const before = await ev(`(async () => {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8099/*' });
  if (!tabs.length) return 'no-tab';
  return await chrome.tabs.sendMessage(tabs[0].id, { type: 'BS_STATE' });
})()`);
console.log('启动前:', JSON.stringify(before));

const clicked = await ev(`(async () => {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8099/*' });
  if (!tabs.length) return 'no-tab';
  await chrome.tabs.sendMessage(tabs[0].id, { type: 'BS_TOGGLE' });
  return 'sent';
})()`);
console.log('切换:', clicked);
await sleep(2000);

const after = await ev(`(async () => {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8099/*' });
  return await chrome.tabs.sendMessage(tabs[0].id, { type: 'BS_STATE' });
})()`);
console.log('启动后:', JSON.stringify(after));

ws2.close();
ws.close();
process.exit(0);
