/**
 * 等 qwen2.5:7b 下载完成后：
 * 1) 把引擎「高质量」模型切到 Ollama
 * 2) 跑一组翻译测试并记录耗时/译文
 * 结果写到 tools/ollama-deploy.log
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOG = 'E:/Deepseek/bili-sub/tools/ollama-deploy.log';
const OLLAMA = process.env.LOCALAPPDATA + '/Programs/Ollama/ollama.exe';
const MODEL = 'qwen2.5:7b';
const DEADLINE = Date.now() + 90 * 60 * 1000;

const log = (msg) => {
  const line = `[${new Date().toLocaleString('zh-CN')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n', 'utf8');
};

const hasModel = () => {
  try {
    const out = execFileSync(OLLAMA, ['list'], { encoding: 'utf8', timeout: 20000 });
    return out.includes(MODEL);
  } catch {
    return false;
  }
};

log('等待 ' + MODEL + ' 下载完成…');
while (Date.now() < DEADLINE) {
  if (hasModel()) break;
  await new Promise((r) => setTimeout(r, 20000));
}
if (!hasModel()) {
  log('等待超时，未检测到模型');
  process.exit(1);
}
log('模型已就绪，开始部署');

// 连接引擎
const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.code + ': ' + m.message)) : p.resolve(m);
  }
});
await new Promise((r, rej) => {
  ws.addEventListener('open', r, { once: true });
  setTimeout(() => rej(new Error('连接引擎超时')), 8000);
});
const call = (payload, timeout = 180000) =>
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
    quality: { provider: 'ollama', model: MODEL }
  }
});
log('已切换高质量模型为 Ollama / ' + MODEL);

const sentences = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching.",
  'The quick brown fox jumps over the lazy dog.'
];

let total = 0;
for (const s of sentences) {
  const t0 = Date.now();
  try {
    const r = await call({ type: 'translate.batch', texts: [s], src: 'en', tgt: 'zh', role: 'quality' });
    const ms = Date.now() - t0;
    total += ms;
    log(`  ${ms}ms  ${r.texts[0]}`);
  } catch (e) {
    log('  失败: ' + e.message);
  }
}
log(`平均 ${Math.round(total / sentences.length)}ms/句`);

// 首次调用含模型加载，再测一次稳态
const t1 = Date.now();
const r2 = await call({ type: 'translate.batch', texts: [sentences[0]], src: 'en', tgt: 'zh', role: 'quality' });
log(`稳态: ${Date.now() - t1}ms  ${r2.texts[0]}`);

ws.close();
log('部署完成');
process.exit(0);
