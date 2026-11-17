/** 验证字幕两遍翻译：先快速出稿，再被高质量译文替换 */
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
await new Promise((r) => setTimeout(r, 400));
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.text || '');
  return r.result.value;
};

// 切到字幕模式并启动
const fab = await ev(`!!document.querySelector('.bs-fab')`);
if (!fab) {
  console.log('面板未注入');
  process.exit(3);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(300);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(2000);
console.log('mode:', await ev('window.__bilisub?.state?.mode'), '| qualityMode:', await ev('window.__bilisub?.state?.qualityMode'));

let counter = 0;
async function sample(label) {
  const text = `Subtitle two pass sample number ${++counter}.`;
  const before = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
  await ev(`window.__bilisub.onCaption(${JSON.stringify(text)}, true)`);
  const t0 = Date.now();
  const changes = [];
  let last = before;
  for (let i = 0; i < 80; i++) {
    await sleep(25);
    const now = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
    if (now && now !== last) {
      changes.push({ ms: Date.now() - t0, text: now });
      last = now;
    }
  }
  console.log(`${label}: 变化 ${changes.length} 次  ${changes.map((c) => c.ms + 'ms').join(' → ')}`);
  console.log(`   最终: ${changes.length ? changes[changes.length - 1].text : '(无)'}`);
}

// 关闭
await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(c.checked) c.click(); })()`);
await sleep(300);
await sample('高质量字幕 关');

// 打开
await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(!c.checked) c.click(); })()`);
await sleep(300);
await sample('高质量字幕 开');

ws.close();
process.exit(0);
