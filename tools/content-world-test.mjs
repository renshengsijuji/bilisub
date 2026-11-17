/**
 * 在内容脚本的隔离世界里直接发消息，判断是消息通道问题还是 content.js 逻辑问题
 */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('8099'));
if (!page) {
  console.log('没有 fixture 页面');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let n = 0;
const pend = new Map();
const contexts = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

await send('Runtime.enable');
await sleep(500);

const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
console.log('隔离世界:', iso ? iso.origin : '未找到');

const ev = async (expr, contextId) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    ...(contextId ? { contextId } : {})
  });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

if (iso) {
  console.log('runtime 可用:', await ev(`typeof chrome !== 'undefined' && !!chrome.runtime`, iso.id));
  const t0 = Date.now();
  const res = await ev(
    `chrome.runtime.sendMessage({type:'TRANSLATE', texts:['Hello from content world'], src:'en', tgt:'zh'})
       .then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)`,
    iso.id
  );
  console.log('隔离世界直发 (' + (Date.now() - t0) + 'ms):', res);
}

ws.close();
process.exit(0);
