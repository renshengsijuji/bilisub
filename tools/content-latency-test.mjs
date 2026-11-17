/** 测 content → background → engine 的完整翻译耗时（隔离世界） */
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 60000);
  });
await send('Runtime.enable');
await sleep(400);
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.text || '');
  return r.result.value;
};

for (let i = 1; i <= 4; i++) {
  const expr = `(async () => {
    const t0 = Date.now();
    const r = await chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      texts: ['Content path unique sentence number ${i} for timing.'],
      src: 'en', tgt: 'zh', role: 'quality'
    });
    return { ms: Date.now() - t0, ok: r && r.ok, text: r && r.texts && r.texts[0], err: r && r.error };
  })()`;
  console.log(JSON.stringify(await ev(expr)));
  await sleep(500);
}
ws.close();
process.exit(0);
