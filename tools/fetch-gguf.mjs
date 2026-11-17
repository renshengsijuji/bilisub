/**
 * 从 hf-mirror 下载 GGUF（支持断点续传 + 速度显示）
 * 用法: node fetch-gguf.mjs <url> <输出路径> [最大MB，测试用]
 */
import fs from 'node:fs';
import path from 'node:path';

const [url, out, limitMb] = process.argv.slice(2);
if (!url || !out) {
  console.log('用法: node fetch-gguf.mjs <url> <out> [limitMb]');
  process.exit(2);
}
const limit = limitMb ? Number(limitMb) * 1024 * 1024 : Infinity;
const part = out + '.part';

let offset = 0;
try {
  offset = fs.statSync(part).size;
} catch {
  /* 新文件 */
}
fs.mkdirSync(path.dirname(out), { recursive: true });

const started = Date.now();
let downloaded = 0;
let lastLog = 0;

while (downloaded < limit) {
  const end = Math.min(offset + downloaded + 8 * 1024 * 1024 - 1, limit === Infinity ? undefined : limit - 1);
  const headers = { Range: `bytes=${offset + downloaded}-${end ?? ''}`, 'User-Agent': 'Mozilla/5.0' };
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    console.log('请求失败，2 秒后重试:', err.message);
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  if (!res.ok && res.status !== 206) {
    console.log('HTTP', res.status);
    break;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) break;
  fs.appendFileSync(part, buf);
  downloaded += buf.length;

  const secs = (Date.now() - started) / 1000;
  if (Date.now() - lastLog > 3000) {
    lastLog = Date.now();
    const speed = downloaded / 1024 / 1024 / Math.max(secs, 1);
    console.log(`  ${(downloaded / 1048576).toFixed(0)} MB  ${speed.toFixed(2)} MB/s`);
  }
}

fs.renameSync(part, out);
const size = fs.statSync(out).size;
console.log(`完成: ${out}  ${(size / 1048576).toFixed(0)} MB  用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
