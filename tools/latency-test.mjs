/**
 * 按角色测翻译延迟：realtime vs quality
 */
const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
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

const welcome = await new Promise((resolve) => {
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'welcome') resolve(m);
  }, { once: true });
});
console.log('当前配置:', JSON.stringify(welcome.current.mt));

const sentences = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching."
];

for (const role of ['realtime', 'quality']) {
  console.log('\n== ' + role + ' ==');
  // 预热一次（不计入）
  await call({ type: 'translate.batch', texts: ['hello'], src: 'en', tgt: 'zh', role }).catch(() => {});
  let total = 0;
  for (const s of sentences) {
    const t0 = Date.now();
    try {
      const r = await call({ type: 'translate.batch', texts: [s], src: 'en', tgt: 'zh', role });
      const ms = Date.now() - t0;
      total += ms;
      console.log(`  ${ms}ms  ${r.texts[0]}`);
    } catch (e) {
      console.log('  失败:', e.message);
    }
  }
  console.log(`  平均 ${Math.round(total / sentences.length)}ms/句`);
}

ws.close();
process.exit(0);
