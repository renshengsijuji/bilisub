/**
 * 等 GGUF 下载完成 → 导入 Ollama → 引擎切到该模型 → 跑翻译测试
 * 日志: tools/ollama-deploy.log
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOG = 'E:/Deepseek/bili-sub/tools/ollama-deploy.log';
const OLLAMA = process.env.LOCALAPPDATA + '/Programs/Ollama/ollama.exe';
const GGUF = 'E:/ollama-models/gguf/qwen2.5-3b-instruct-q4_k_m.gguf';
const MODEL = 'qwen-zh';
const DEADLINE = Date.now() + 60 * 60 * 1000;

const log = (msg) => {
  const line = `[${new Date().toLocaleString('zh-CN')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n', 'utf8');
};

log('等待 GGUF 下载完成…');
while (Date.now() < DEADLINE) {
  if (fs.existsSync(GGUF)) break;
  await new Promise((r) => setTimeout(r, 5000));
}
if (!fs.existsSync(GGUF)) {
  log('等待超时');
  process.exit(1);
}
log(`GGUF 就绪: ${(fs.statSync(GGUF).size / 1048576).toFixed(0)} MB`);

// 生成 Modelfile 并导入
const modelfile = `FROM ${GGUF}
PARAMETER temperature 0
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
SYSTEM 你是专业的字幕翻译引擎。只输出简体中文译文，保留人名、术语和数字，不要解释，不要加引号。
`;
const mfPath = 'E:/ollama-models/gguf/Modelfile-qwen-zh';
fs.writeFileSync(mfPath, modelfile, 'utf8');

log('导入 Ollama（ollama create ' + MODEL + '）…');
try {
  const out = execFileSync(OLLAMA, ['create', MODEL, '-f', mfPath], { encoding: 'utf8', timeout: 600000 });
  log('导入完成: ' + out.trim().split('\n').slice(-1)[0]);
} catch (e) {
  log('导入失败: ' + (e.message || e));
  process.exit(1);
}

// 部署到引擎
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
log('引擎高质量模型已切到 Ollama / ' + MODEL);

const sentences = [
  'Hello everyone, welcome back to the channel.',
  'Today we are going to talk about how computers understand human language.',
  "That's all for today, thanks for watching.",
  'The quick brown fox jumps over the lazy dog.',
  'This model runs on the local GPU through Ollama.'
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

const t1 = Date.now();
const r2 = await call({ type: 'translate.batch', texts: [sentences[0]], src: 'en', tgt: 'zh', role: 'quality' });
log(`稳态: ${Date.now() - t1}ms  ${r2.texts[0]}`);

ws.close();
log('部署与验证完成');
process.exit(0);
