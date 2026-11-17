/**
 * 7B 全自动：从 ModelScope 下分片 GGUF → 导入 Ollama → 引擎切高质量模型 → 测试
 * 日志: tools/ollama-7b.log
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOG = 'E:/Deepseek/bili-sub/tools/ollama-7b.log';
const OLLAMA = process.env.LOCALAPPDATA + '/Programs/Ollama/ollama.exe';
const DIR = 'E:/ollama-models/gguf';
const BASE = 'https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-7B-Instruct-GGUF/repo?Revision=master&FilePath=';
const SHARDS = [
  'qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf',
  'qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf'
];
const MODEL = 'qwen-zh-7b';

const log = (msg) => {
  const line = `[${new Date().toLocaleString('zh-CN')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n', 'utf8');
};

// 清理之前的 3B 残留
for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) {
  if (f.includes('3b-instruct')) {
    try {
      fs.unlinkSync(`${DIR}/${f}`);
      log('清理 3B 文件: ' + f);
    } catch {
      /* ignore */
    }
  }
}
fs.mkdirSync(DIR, { recursive: true });

async function download(name) {
  const out = `${DIR}/${name}`;
  const part = out + '.part';
  if (fs.existsSync(out)) {
    log(`已存在: ${name} (${(fs.statSync(out).size / 1048576).toFixed(0)} MB)`);
    return;
  }
  let offset = 0;
  try {
    offset = fs.statSync(part).size;
  } catch {
    /* 新文件 */
  }
  log(`开始下载 ${name}，从 ${(offset / 1048576).toFixed(0)} MB 处继续`);

  const res = await fetch(BASE + name, { headers: { Range: `bytes=${offset}-`, 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0) + offset;
  const fd = fs.openSync(part, 'a');
  let written = offset;
  let lastLog = Date.now();
  const started = Date.now();

  for await (const chunk of res.body) {
    fs.writeSync(fd, chunk);
    written += chunk.length;
    if (Date.now() - lastLog > 10000) {
      lastLog = Date.now();
      const speed = (written - offset) / 1048576 / Math.max((Date.now() - started) / 1000, 1);
      log(`  ${(written / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB  ${speed.toFixed(2)} MB/s`);
    }
  }
  fs.closeSync(fd);
  fs.renameSync(part, out);
  log(`完成 ${name}: ${(fs.statSync(out).size / 1048576).toFixed(0)} MB`);
}

for (const s of SHARDS) await download(s);

// 生成 Modelfile（分片用通配符）
const modelfile = `FROM ${DIR}/qwen2.5-7b-instruct-q4_k_m-*.gguf
PARAMETER temperature 0
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
SYSTEM 你是专业的字幕翻译引擎。只输出简体中文译文，保留人名、术语和数字，不要解释，不要加引号。
`;
const mf = `${DIR}/Modelfile-qwen-zh-7b`;
fs.writeFileSync(mf, modelfile, 'utf8');
log('导入 Ollama: ollama create ' + MODEL);
try {
  const out = execFileSync(OLLAMA, ['create', MODEL, '-f', mf], { encoding: 'utf8', timeout: 900000 });
  log('导入完成: ' + out.trim().split('\n').slice(-1)[0]);
} catch (e) {
  log('通配符导入失败，尝试仅指定第一个分片: ' + (e.message || e));
  fs.writeFileSync(mf, modelfile.replace('-*.gguf', '-00001-of-00002.gguf'), 'utf8');
  try {
    const out2 = execFileSync(OLLAMA, ['create', MODEL, '-f', mf], { encoding: 'utf8', timeout: 900000 });
    log('导入完成: ' + out2.trim().split('\n').slice(-1)[0]);
  } catch (e2) {
    log('导入失败: ' + (e2.message || e2));
    process.exit(1);
  }
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
log('7B 部署与验证完成');
process.exit(0);
