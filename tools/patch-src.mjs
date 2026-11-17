import fs from 'node:fs';

const bPath = 'E:/Deepseek/bili-sub/extension/background.js';
let b = fs.readFileSync(bPath, 'utf8');

b = b.replace('async function startAudio(tabId) {', 'async function startAudio(tabId, src) {');

const oldStart = `    type: 'START',
    streamId,
    tabId,
    engine: ENGINE_WS`;
const newStart = `    type: 'START',
    streamId,
    tabId,
    src: src || 'en',
    engine: ENGINE_WS`;
if (b.includes(oldStart)) {
  b = b.split(oldStart).join(newStart);
  console.log('patched START message');
}

if (b.includes('startAudio(msg.tabId || (sender.tab && sender.tab.id))')) {
  b = b.replace('startAudio(msg.tabId || (sender.tab && sender.tab.id))', 'startAudio(msg.tabId || (sender.tab && sender.tab.id), msg.src)');
  console.log('patched AUDIO_START handler');
}
fs.writeFileSync(bPath, b, 'utf8');

const oPath = 'E:/Deepseek/bili-sub/extension/offscreen/offscreen.js';
let o = fs.readFileSync(oPath, 'utf8');
const oldLine = "socket.send(JSON.stringify({ v: 1, type: 'stt.start', session: String(tabId), src: 'en' }));";
const newLine = "socket.send(JSON.stringify({ v: 1, type: 'stt.start', session: String(tabId), src: msg.src || 'en' }));";
if (o.includes(oldLine)) {
  o = o.split(oldLine).join(newLine);
  console.log('patched stt.start');
}
fs.writeFileSync(oPath, o, 'utf8');
