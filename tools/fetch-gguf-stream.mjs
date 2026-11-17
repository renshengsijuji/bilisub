/**
 * 从镜像流式下载 GGUF（单连接 + 断点续传 + 速度显示）
 * 用法: node fetch-gguf-stream.mjs <url> <out>
 */
import fs from 'node:fs';
import path from 'node:path';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.log('用法: node fetch-gguf-stream.mjs <url> <out>');
  process.exit(2);
}
const part = out + '.part';
fs.mkdirSync(path.dirname(out), { recursive: true });

let offset = 0;
try {
  offset = fs.statSync(part).size;
} catch {
  /* 新文件 */
}
console.log(`从 ${(offset / 1048576).toFixed(0)} MB 处继续`);

const res = await fetch(url, {
  headers: { Range: `bytes=${offset}-`, 'User-Agent': 'Mozilla/5.0' }
});
if (!res.ok && res.status !== 206) {
  console.log('HTTP', res.status);
  process.exit(1);
}
const total = Number(res.headers.get('content-length') || 0) + offset;

const fd = fs.openSync(part, 'a');
let written = offset;
let lastLog = Date.now();
const started = Date.now();

for await (const chunk of res.body) {
  fs.writeSync(fd, chunk);
  written += chunk.length;
  if (Date.now() - lastLog > 3000) {
    lastLog = Date.now();
    const secs = (Date.now() - started) / 1000;
    const speed = (written - offset) / 1048576 / Math.max(secs, 1);
    const pct = total ? ((written / total) * 100).toFixed(1) : '?';
    console.log(`  ${(written / 1048576).toFixed(0)} MB / ${(total / 1048576).toFixed(0)} MB (${pct}%)  ${speed.toFixed(2)} MB/s`);
  }
}
fs.closeSync(fd);
fs.renameSync(part, out);
const size = fs.statSync(out).size;
console.log(`完成: ${out}  ${(size / 1048576).toFixed(0)} MB  用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
