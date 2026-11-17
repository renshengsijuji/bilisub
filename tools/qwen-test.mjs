/** 测试 Ollama qwen2.5:7b 作为高质量翻译模型的译文与耗时 */
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

const call = (payload, timeout = 300000) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ v: 1, ...payload, id: i }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), timeout);
  });

await call({
  type: 'config.save',
  mt: {
    realtime: { provider: 'local', model: 'mt-opus-en-zh' },
    quality: { provider: 'ollama', model: 'qwen2.5:7b' }
  }
});
console.log('已切换 高质量 = Ollama / qwen2.5:7b');

const sentences = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching.",
  'This model runs on the local GPU through Ollama.'
];
let total = 0;
for (const s of sentences) {
  const t0 = Date.now();
  try {
    const r = await call({ type: 'translate.batch', texts: [s], src: 'en', tgt: 'zh', role: 'quality' });
    const ms = Date.now() - t0;
    total += ms;
    console.log(`${ms}ms  ${r.texts[0]}`);
  } catch (e) {
    console.log('失败:', e.message);
  }
}
console.log(`平均 ${Math.round(total / sentences.length)}ms/句`);

const t1 = Date.now();
const r2 = await call({ type: 'translate.batch', texts: [sentences[0]], src: 'en', tgt: 'zh', role: 'quality' });
console.log(`稳态 ${Date.now() - t1}ms  ${r2.texts[0]}`);

ws.close();
process.exit(0);
