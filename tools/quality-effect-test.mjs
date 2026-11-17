/** 用互不重复的句子对比：勾选「高质量模式」是否真的切到高质量模型 */
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 20000);
  });
await send('Runtime.enable');
await sleep(400);
const iso = ctx.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

let counter = 0;
async function measure(label, rounds = 5) {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const text = `Unique test sentence number ${++counter} for quality comparison.`;
    const before = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
    const t0 = Date.now();
    await ev(`window.__bilisub.onCaption(${JSON.stringify(text)}, true)`);
    let got = before;
    for (let k = 0; k < 80; k++) {
      await sleep(25);
      const now = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
      if (now && now !== before) {
        got = now;
        break;
      }
    }
    times.push(Date.now() - t0);
    await sleep(600);
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`${label}: 平均 ${avg}ms  明细 ${times.join('/')}`);
  return avg;
}

console.log('qualityMode 当前:', await ev('window.__bilisub?.state?.qualityMode'));

// 关闭
await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(c.checked) c.click(); })()`);
await sleep(300);
console.log('关闭后:', await ev('window.__bilisub?.state?.qualityMode'));
const off = await measure('高质量模式 关');

// 打开
await ev(`(() => { const c=document.querySelector('[data-k="qualityMode"]'); if(!c.checked) c.click(); })()`);
await sleep(300);
console.log('打开后:', await ev('window.__bilisub?.state?.qualityMode'));
const on = await measure('高质量模式 开');

console.log(`\n结论: ${on > off * 1.8 ? '勾选框确实切换了模型（差 ' + (on - off) + 'ms）' : '两者耗时接近，可能没生效'}`);
ws.close();
process.exit(0);
