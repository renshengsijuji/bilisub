/**
 * 排查字幕选择器在 B 站页面的误匹配
 */
const PORT = 9333;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('bilibili.com/video'));
if (!page) {
  console.log('没有打开的 B 站页面');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
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
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++n;
    pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 15000);
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result.value;
};

const report = await ev(`(() => {
  const sels = ['.ytp-caption-segment','.bpx-player-subtitle-panel-text','.bilibili-player-video-subtitle','.jw-text-track-display','.plyr__captions','[data-testid="closed-captions"]','[class*="caption-window"] [class*="caption"]'];
  return sels.map(s => {
    const nodes = [...document.querySelectorAll(s)];
    return { sel: s, count: nodes.length, sample: nodes.slice(0,3).map(n => (n.innerText||'').trim().slice(0,60)) };
  });
})()`);
console.log(JSON.stringify(report, null, 2));

const canvas = await ev(`(() => {
  const v = document.querySelector('video');
  return v ? { textTracks: v.textTracks.length, modes: [...v.textTracks].map(t=>t.mode) } : null;
})()`);
console.log('textTracks:', JSON.stringify(canvas));

ws.close();
process.exit(0);
