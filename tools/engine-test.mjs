/**
 * 引擎联调：握手 → mock 翻译 → 下载 OPUS 模型 → 真实翻译
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pending = new Map();

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'models.progress') {
    if (m.percent % 10 < 2 || m.percent === 100) {
      console.log(`  下载 ${m.model}: ${m.percent}% (${(m.done / 1048576).toFixed(1)}MB)`);
    }
    return;
  }
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error || m.type === 'error' ? p.reject(new Error(m.message || m.code)) : p.resolve(m);
  }
});

const ready = new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
await ready;

function call(payload, timeout = 30000) {
  const reqId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, id: reqId }));
    setTimeout(() => pending.has(reqId) && (pending.delete(reqId), reject(new Error('timeout ' + payload.type))), timeout);
  });
}

// 先收 welcome
const welcome = await new Promise((resolve) => {
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'welcome') resolve(m);
  }, { once: true });
});
console.log('welcome:', JSON.stringify({
  server: welcome.server,
  tier: welcome.hardware.tier,
  ram: welcome.hardware.ramGB,
  vram: welcome.hardware.vramGB,
  caps: welcome.caps
}));

const mock = await call({ type: 'translate.batch', texts: ['Hello world', 'This is a test'], src: 'en', tgt: 'zh' });
console.log('mock 翻译:', JSON.stringify(mock.texts));

console.log('\n下载 OPUS 模型…');
const dl = await call({ type: 'models.download', model: 'mt-opus-en-zh' }, 300000);
console.log('下载完成:', (dl.meta.size / 1048576).toFixed(1), 'MB');

const models = await call({ type: 'models.list' });
console.log('已安装:', models.models.filter((m) => m.installed).map((m) => m.id).join(', '));

await call({ type: 'config.set', mt: { provider: 'local', model: 'mt-opus-en-zh' } });

const samples = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching."
];
const t0 = Date.now();
const real = await call({ type: 'translate.batch', texts: samples, src: 'en', tgt: 'zh' });
console.log(`\n真实翻译 (${Date.now() - t0}ms):`);
samples.forEach((s, i) => console.log('  EN:', s, '\n  ZH:', real.texts[i]));

ws.close();
process.exit(0);
