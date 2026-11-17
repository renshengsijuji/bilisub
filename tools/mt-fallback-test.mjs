/**
 * 翻译模型自愈测试：
 * 1) 正常 NLLB
 * 2) 故意破坏 NLLB（移走 config.json）→ 应自动回退 OPUS 并给出提示
 * 3) 恢复后 NLLB 正常
 */
import fs from 'node:fs';

const MODEL = 'E:/Deepseek/bili-sub/models/mt-nllb-600m/config.json';
const BAK = MODEL + '.bak';

const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pend = new Map();
let notice = null;

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'notice') {
    notice = m.message;
    return;
  }
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

const SENT = 'Hello everyone, welcome back to the channel.';

notice = null;
await call({ type: 'config.set', mt: { provider: 'local', model: 'mt-nllb-600m' } });
let r = await call({ type: 'translate.batch', texts: [SENT], src: 'en', tgt: 'zh' });
console.log('① NLLB 正常:', r.texts[0]);

// 破坏 NLLB
fs.renameSync(MODEL, BAK);
try {
  notice = null;
  await call({ type: 'config.set', mt: { provider: 'local', model: 'mt-nllb-600m' } });
  r = await call({ type: 'translate.batch', texts: [SENT], src: 'en', tgt: 'zh' });
  console.log('② 回退结果:', r.texts[0]);
  console.log('   提示:', notice || '(无)');
} finally {
  fs.renameSync(BAK, MODEL);
}

notice = null;
await call({ type: 'config.set', mt: { provider: 'local', model: 'mt-nllb-600m' } });
r = await call({ type: 'translate.batch', texts: [SENT], src: 'en', tgt: 'zh' });
console.log('③ 恢复后 NLLB:', r.texts[0]);

ws.close();
process.exit(0);
