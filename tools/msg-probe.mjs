/**
 * 在隔离世界给 chrome.runtime.sendMessage 挂钩子，观察 content.js 的请求与返回
 */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('8099'));
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
await sleep(400);

const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr, contextId) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// 安装探针
console.log('探针安装:', await ev(`(() => {
  if (window.__probeInstalled) return 'already';
  window.__probeInstalled = true;
  window.__calls = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function (msg) {
    const rec = { at: Date.now(), type: msg && msg.type, texts: msg && msg.texts };
    window.__calls.push(rec);
    const p = orig.apply(null, arguments);
    p.then(r => { rec.result = r; }).catch(e => { rec.error = String(e && e.message || e); });
    return p;
  };
  return 'ok';
})()`, iso.id));

await sleep(4000);

const calls = await ev(`JSON.stringify(window.__calls || [], null, 1)`, iso.id);
console.log('调用记录:', calls);
console.log('浮层:', await ev(`JSON.stringify({
  src: document.querySelector('.bs-src')?.textContent,
  dst: document.querySelector('.bs-dst')?.textContent,
  tip: document.querySelector('[data-role="tip"]')?.textContent
})`, iso.id));

ws.close();
process.exit(0);
