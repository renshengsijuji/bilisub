/** 混合压力稳定性测试：实时高频 + 高质量低频，统计延迟与错误 */
const DURATION = 60000;
const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.code + ': ' + m.message)) : p.resolve(m);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const call = (payload, timeout = 60000) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ v: 1, ...payload, id: i }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), timeout);
  });

const rt = [];
const ql = [];
let errors = 0;
let n = 0;
const sentences = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching.",
  'The quick brown fox jumps over the lazy dog.'
];

const started = Date.now();
const timers = [];

// 实时：每 250ms 一次
timers.push(
  setInterval(async () => {
    if (Date.now() - started > DURATION) return;
    const t0 = Date.now();
    try {
      await call({ type: 'translate.batch', texts: [sentences[n++ % sentences.length]], src: 'en', tgt: 'zh', role: 'realtime' }, 15000);
      rt.push(Date.now() - t0);
    } catch {
      errors++;
    }
  }, 250)
);

// 高质量：每 3 秒一次
timers.push(
  setInterval(async () => {
    if (Date.now() - started > DURATION) return;
    const t0 = Date.now();
    try {
      await call({ type: 'translate.batch', texts: [sentences[n++ % sentences.length]], src: 'en', tgt: 'zh', role: 'quality' }, 30000);
      ql.push(Date.now() - t0);
    } catch {
      errors++;
    }
  }, 3000)
);

await new Promise((r) => setTimeout(r, DURATION + 3000));
timers.forEach(clearInterval);

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))];
};

console.log(`实时请求: ${rt.length} 次  p50=${pct(rt, 50)}ms  p95=${pct(rt, 95)}ms  max=${Math.max(...rt, 0)}ms`);
console.log(`高质量请求: ${ql.length} 次  p50=${pct(ql, 50)}ms  p95=${pct(ql, 95)}ms  max=${Math.max(...ql, 0)}ms`);
console.log(`错误: ${errors}`);

// 收尾：再各测一次确认仍然健康
const t1 = Date.now();
const r1 = await call({ type: 'translate.batch', texts: ['Final health check.'], src: 'en', tgt: 'zh', role: 'realtime' });
const t2 = Date.now();
const r2 = await call({ type: 'translate.batch', texts: ['Final health check.'], src: 'en', tgt: 'zh', role: 'quality' });
console.log(`收尾: 实时 ${t2 - t1}ms 「${r1.texts[0]}」 | 高质量 ${Date.now() - t2}ms 「${r2.texts[0]}」`);

ws.close();
process.exit(0);
