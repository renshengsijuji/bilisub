/**
 * 断线自愈测试：翻译进行中重启引擎，插件应自动重连并恢复翻译
 */
const { execSync } = await import('node:child_process');
import fs from 'node:fs';

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('8099'));
if (!page) {
  console.log('没有 fixture 页面');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0;
const pend = new Map();
const contexts = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });
await send('Runtime.enable');
await sleep(300);

const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && c.origin && c.origin.startsWith('chrome-extension://'));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: iso.id });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

console.log('重启前 dst:', await ev(`document.querySelector('.bs-dst')?.textContent`));

// 停掉引擎
execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*main.py*' -and $_.Name -like 'python*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`);
console.log('引擎已停止');
await sleep(1500);

// 重新启动引擎
execSync(`powershell -NoProfile -Command "Start-Process -FilePath 'E:\\Deepseek\\bili-sub\\engine\\.venv\\Scripts\\pythonw.exe' -ArgumentList 'E:\\Deepseek\\bili-sub\\engine\\main.py' -WorkingDirectory 'E:\\Deepseek\\bili-sub\\engine' -WindowStyle Hidden"`);
console.log('引擎已重启，等待插件自愈…');

let recovered = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const s = await ev(`(() => { const s = window.__bilisub?.state; return s ? { dst: s.targetText, err: s.lastError, note: s.loadingNote } : null })()`);
  console.log(`${i + 1}s`, JSON.stringify(s));
  if (s && s.dst) {
    recovered = s.dst;
    break;
  }
}

console.log('\n结论:', recovered ? 'PASS 自动恢复，译文: ' + recovered : 'FAIL 未恢复');
ws.close();
process.exit(recovered ? 0 : 1);
