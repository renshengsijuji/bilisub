/** 并发测试：7B（高质量）加载/推理时，实时请求是否还能秒回 */
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
const call = (payload, timeout = 120000) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ v: 1, ...payload, id: i }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), timeout);
  });

// 先打一发高质量，触发 7B 加载（可能很慢）
const tQ = Date.now();
const qPromise = call({ type: 'translate.batch', texts: ['Hello everyone, welcome back to the channel.'], src: 'en', tgt: 'zh', role: 'quality' })
  .then((r) => ({ ok: true, ms: Date.now() - tQ, text: r.texts[0] }))
  .catch((e) => ({ ok: false, ms: Date.now() - tQ, text: e.message }));

await new Promise((r) => setTimeout(r, 200));

// 紧接着发实时请求，应该不被 7B 阻塞
const tR = Date.now();
const r = await call({ type: 'translate.batch', texts: ['This is a realtime latency test.'], src: 'en', tgt: 'zh', role: 'realtime' })
  .then((x) => ({ ok: true, ms: Date.now() - tR, text: x.texts[0] }))
  .catch((e) => ({ ok: false, ms: Date.now() - tR, text: e.message }));

console.log('实时请求:', JSON.stringify(r));
const q = await qPromise;
console.log('高质量请求:', JSON.stringify(q));

ws.close();
process.exit(0);
