/**
 * 指定 B 站视频端到端延迟：从点击开始到第一句译文出现
 */
const PORT = Number(process.env.CDP_PORT || 9333);
const URL = process.argv[2] || 'https://www.bilibili.com/video/BV1VxWq6WE3h/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 30000);
  });

const { targetId } = await send('Target.createTarget', { url: URL });
await sleep(5000);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.id === targetId);
const ws2 = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
let n2 = 0;
const p2 = new Map();
ws2.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p2.has(m.id)) {
    const q = p2.get(m.id);
    p2.delete(m.id);
    m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
  }
});
const send2 = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n2;
    p2.set(i, { resolve: res, reject: rej });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => p2.has(i) && (p2.delete(i), rej(new Error('timeout'))), 30000);
  });
const ev = async (expr) => {
  const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
await send2('Runtime.enable');

for (let i = 0; i < 40; i++) {
  if (await ev('!!document.querySelector("#bilisub-root")').catch(() => false)) break;
  await sleep(500);
}
console.log('页面:', await ev('document.title'));
console.log('面板:', await ev('!!document.querySelector("#bilisub-root")'));

// 看看页面上有哪些候选字幕节点
const candidates = await ev(`(() => {
  const sels = ['.ytp-caption-segment','.bpx-player-subtitle-panel-text','.bilibili-player-video-subtitle','.jw-text-track-display','.plyr__captions','[data-testid="closed-captions"]','[class*="caption-window"] [class*="caption"]'];
  const out = {};
  for (const s of sels) { const n = document.querySelectorAll(s).length; if (n) out[s] = n; }
  const v = document.querySelector('video');
  out.__tracks = v ? v.textTracks.length : -1;
  out.__subtitlePanels = document.querySelectorAll('[class*="subtitle"]').length;
  return out;
})()`);
console.log('字幕候选:', JSON.stringify(candidates));

await ev(`document.querySelector('.bs-fab').click()`);
await sleep(300);
const t0 = Date.now();
await ev(`document.querySelector('[data-act="toggle"]').click()`);

let first = null;
for (let i = 0; i < 60; i++) {
  await sleep(100);
  const dst = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
  if (dst) {
    first = { ms: Date.now() - t0, dst };
    break;
  }
}
console.log('首句译文:', first ? first.ms + 'ms · ' + first.dst : '60 秒内没有译文');

if (first) {
  // 观察后续 4 句的更新间隔
  let last = first.dst;
  const changes = [];
  let lastAt = Date.now();
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    const dst = await ev(`document.querySelector('.bs-dst')?.textContent || ''`);
    if (dst && dst !== last) {
      changes.push({ after: Date.now() - lastAt, text: dst });
      last = dst;
      lastAt = Date.now();
      if (changes.length >= 4) break;
    }
  }
  for (const c of changes) console.log(`  +${c.after}ms  ${c.text}`);
}

ws2.close();
ws.close();
process.exit(0);
