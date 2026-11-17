/** 直接挂钩 sendMessage，确认字幕句是否发起了「快速 + 高质量」两次请求 */
const PORT = Number(process.env.CDP_PORT || 9333);
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
const ctx = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.executionContextCreated') ctx.push(m.params.context);
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
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.text || '');
  return r.result.value;
};

// 安装探针 + 固定字幕模式
console.log(
  await ev(`(() => {
    const s = window.__bilisub.state;
    s.mode = 'subtitle';
    s.qualityMode = true;
    window.__calls = [];
    if (!window.__probe) {
      window.__probe = true;
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = function (msg) {
        if (msg && msg.type === 'TRANSLATE') window.__calls.push({ role: msg.role, text: msg.texts[0] });
        return orig.apply(null, arguments);
      };
    }
    return 'ok';
  })()`)
);

for (const [label, quality] of [['高质量字幕 开', true], ['高质量字幕 关', false]]) {
  await ev(`(() => { const s=window.__bilisub.state; s.qualityMode=${quality}; window.__calls = []; })()`);
  const text = `Probe sentence ${label} ${Date.now()}.`;
  await ev(`window.__bilisub.onCaption(${JSON.stringify(text)}, true)`);
  await sleep(1500);
  const calls = await ev(`JSON.stringify(window.__calls)`);
  console.log(`${label}: ${calls}`);
}

ws.close();
process.exit(0);
