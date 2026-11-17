/** 下载 distil-whisper small.en，并配置 实时=tiny / 定稿=distil */
const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'models.progress' && m.percent % 10 === 0) {
    console.log(`  ${m.model} ${m.percent}%  ${(m.bytes / 1048576).toFixed(0)}/${(m.total / 1048576).toFixed(0)} MB`);
  }
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.code + ': ' + m.message)) : p.resolve(m);
  }
});
await new Promise((r, rej) => {
  ws.addEventListener('open', r, { once: true });
  setTimeout(() => rej(new Error('connect timeout')), 8000);
});
const call = (payload, timeout = 3600000) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ v: 1, ...payload, id: i }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), timeout);
  });

await call({ type: 'config.save', asr: { realtime: 'asr-whisper-tiny', final: 'asr-distil-small-en' } });
console.log('配置已更新: 实时=tiny, 定稿=distil-small.en');

console.log('开始下载 distil-small.en …');
try {
  const res = await call({ type: 'models.download', model: 'asr-distil-small-en' });
  console.log('下载完成:', JSON.stringify(res.meta && res.meta.size));
} catch (e) {
  console.log('下载失败:', e.message);
  process.exit(1);
}
ws.close();
process.exit(0);
