/**
 * 模型目录切换测试：models.dir → models.setDir(新目录) → models.setDir(原目录)
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket('ws://127.0.0.1:8765');
let id = 0;
const pending = new Map();

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.message || m.code)) : p.resolve(m);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

function call(payload, timeout = 60000) {
  const reqId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ v: 1, ...payload, id: reqId }));
    setTimeout(() => pending.has(reqId) && (pending.delete(reqId), reject(new Error('timeout ' + payload.type))), timeout);
  });
}

const before = await call({ type: 'models.dir' });
console.log('当前目录:', before.path);
console.log('  已用:', (before.size / 1048576).toFixed(1), 'MB | 可用:', (before.free / 1073741824).toFixed(1), 'GB');

const target = 'E:\\Deepseek\\bili-sub\\models-alt';
const moved = await call({ type: 'models.setDir', path: target, move: false });
console.log('切换到:', moved.path, '| 移动项数:', moved.moved);

const after = await call({ type: 'models.dir' });
console.log('确认当前:', after.path);

const back = await call({ type: 'models.setDir', path: before.path, move: false });
console.log('切回:', back.path);

const check = await call({ type: 'models.list' });
console.log('模型仍可用:', check.models.filter((m) => m.installed).map((m) => m.id).join(', '));

ws.close();
process.exit(0);
