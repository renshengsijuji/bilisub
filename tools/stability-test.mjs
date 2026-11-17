/**
 * 稳定性测试：连续翻译 90 秒，期间切换模式/语言，统计成功与异常
 */
const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DURATION = 60_000;

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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8099/fixture.html' });
await sleep(2000);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let n2 = 0;
const p2 = new Map();
const exceptions = [];
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p2.has(m.id)) {
    const q = p2.get(m.id);
    p2.delete(m.id);
    m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 160));
  }
});
const send2 = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n2;
    p2.set(i, { resolve: res, reject: rej });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 30000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
await send2('Runtime.enable');

for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector(".bs-fab")').catch(() => false)) break;
  await sleep(500);
}
await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
await sleep(300);
await ev(`document.querySelector('[data-act="toggle"]').click()`);
await sleep(2000);

const start = Date.now();
let last = '';
const seen = new Set();
let errors = 0;
let samples = 0;

while (Date.now() - start < DURATION) {
  await sleep(1000);
  const s = await ev(`(() => ({
    dst: document.querySelector('.bs-dst')?.textContent || '',
    tip: document.querySelector('[data-role="tip"]')?.textContent || ''
  }))()`);
  samples++;
  if (s.dst && s.dst !== last) {
    seen.add(s.dst);
    last = s.dst;
  }
  if (s.tip.includes('失败') || s.tip.includes('错误')) errors++;

  const elapsed = Date.now() - start;
  // 中途切一次「听声」再切回「字幕」，验证模式切换不崩
  if (elapsed > 30000 && elapsed < 31000) {
    await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'smart').click()`);
  }
  if (elapsed > 36000 && elapsed < 37000) {
    await ev(`[...document.querySelectorAll('.bs-tab')].find(t => t.dataset.mode === 'subtitle').click()`);
  }
  if (Math.round(elapsed / 1000) % 15 === 0) {
    console.log(`  ${Math.round(elapsed / 1000)}s dst=${JSON.stringify(s.dst.slice(0, 24))} tip=${JSON.stringify(s.tip.slice(0, 20))}`);
  }
}

const final = await ev(`(() => ({
  tip: document.querySelector('[data-role="tip"]')?.textContent,
  dst: document.querySelector('.bs-dst')?.textContent || '',
  toggle: document.querySelector('[data-act="toggle"]')?.textContent
}))()`);
console.log('\n结果:');
console.log('  不同译文句数:', seen.size, '| 采样:', samples, '| 错误采样:', errors);
console.log('  页面异常:', exceptions.length, exceptions.slice(0, 3));
console.log('  最终状态:', JSON.stringify(final));

ws2.close();
ws.close();
process.exit(0);
