/** 贴近真实用法的稳定性：串行请求（等上一句完成再发下一句） */
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

const sentences = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching.",
  'The quick brown fox jumps over the lazy dog.'
];
const rt = [];
const ql = [];
let errors = 0;

for (let i = 0; i < 30; i++) {
  const t0 = Date.now();
  try {
    await call({ type: 'translate.batch', texts: [sentences[i % sentences.length]], src: 'en', tgt: 'zh', role: 'realtime' }, 15000);
    rt.push(Date.now() - t0);
  } catch {
    errors++;
  }
  if (i % 5 === 4) {
    const t1 = Date.now();
    try {
      await call({ type: 'translate.batch', texts: [sentences[i % sentences.length]], src: 'en', tgt: 'zh', role: 'quality' }, 30000);
      ql.push(Date.now() - t1);
    } catch {
      errors++;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))];
};
console.log(`实时: ${rt.length} 次 p50=${pct(rt, 50)}ms p95=${pct(rt, 95)}ms max=${Math.max(...rt)}ms`);
console.log(`高质量: ${ql.length} 次 p50=${pct(ql, 50)}ms p95=${pct(ql, 95)}ms max=${Math.max(...ql)}ms`);
console.log(`错误: ${errors}`);
ws.close();
process.exit(0);
