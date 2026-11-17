/**
 * 从 ModelScope 下载 faster-distil-whisper-small.en，并写入 installed.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/Deepseek/bili-sub';
const DIR = `${ROOT}/models/asr-distil-small-en`;
const BASE = 'https://modelscope.cn/api/v1/models/Systran/faster-distil-whisper-small.en/repo?Revision=master&FilePath=';
const FILES = ['model.bin', 'config.json', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json'];

fs.mkdirSync(DIR, { recursive: true });

async function download(name) {
  const out = path.join(DIR, name);
  const part = out + '.part';
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`已存在 ${name} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
    return;
  }
  let offset = 0;
  try {
    offset = fs.statSync(part).size;
  } catch {
    /* new */
  }
  const res = await fetch(BASE + name, { headers: { Range: `bytes=${offset}-`, 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok && res.status !== 206) throw new Error(`${name} HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0) + offset;
  const fd = fs.openSync(part, 'a');
  let written = offset;
  let last = Date.now();
  const t0 = Date.now();
  for await (const chunk of res.body) {
    fs.writeSync(fd, chunk);
    written += chunk.length;
    if (Date.now() - last > 5000) {
      last = Date.now();
      console.log(`  ${name}: ${(written / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB  ${((written - offset) / 1048576 / ((Date.now() - t0) / 1000)).toFixed(2)} MB/s`);
      fs.fsyncSync(fd);
    }
  }
  fs.closeSync(fd);
  fs.renameSync(part, out);
  console.log(`完成 ${name}: ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
}

for (const f of FILES) await download(f);

// 写入 installed.json
const statePath = `${ROOT}/models/installed.json`;
let state = {};
try {
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch {
  state = {};
}
const size = FILES.reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
state['asr-distil-small-en'] = {
  files: FILES,
  installedAt: Math.floor(Date.now() / 1000),
  repo: 'Systran/faster-distil-whisper-small.en',
  size
};
fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
console.log(`已登记到 installed.json，共 ${(size / 1048576).toFixed(0)} MB`);
