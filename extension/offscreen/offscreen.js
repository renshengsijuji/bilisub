/*!
 * BiliSub · Offscreen 文档
 * 捕获标签页音频 → 16k PCM → 本地引擎（WebSocket）→ 回传识别结果
 */
'use strict';

let ctx = null;
let stream = null;
let worklet = null;
let socket = null;
let tabId = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'START') start(msg).catch((err) => reportError(err));
  if (msg.type === 'STOP') stop();
});

async function start(msg) {
  await stop();
  tabId = msg.tabId;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: msg.streamId
      }
    },
    video: false
  });

  ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // 关键：把捕获到的声音送回扬声器，否则标签页会静音
  source.connect(ctx.destination);

  await ctx.audioWorklet.addModule('pcm-worklet.js');
  worklet = new AudioWorkletNode(ctx, 'pcm16k');
  source.connect(worklet);

  socket = new WebSocket(msg.engine);
  socket.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接本地引擎超时')), 4000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('无法连接本地引擎（127.0.0.1:8765）'));
    };
  });

  socket.send(JSON.stringify({ v: 1, type: 'hello' }));
  socket.send(JSON.stringify({ v: 1, type: 'stt.start', session: String(tabId), src: msg.src || 'en' }));

  socket.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'caption' && m.text) {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_CAPTION', text: m.text }).catch(() => {});
      } else if (m.type === 'error') {
        reportError(new Error(m.message || m.code));
      }
    } catch {
      /* ignore */
    }
  };

  // 引擎中途断开时明确上报，避免界面一直显示“正在识别”
  socket.onclose = () => {
    if (socket && socket.readyState === WebSocket.CLOSED) {
      reportError(new Error('与本地引擎的连接已断开，请重启引擎后重新启动'));
    }
  };

  worklet.port.onmessage = (ev) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(ev.data);
  };
}

async function stop() {
  try {
    if (worklet) worklet.port.onmessage = null;
  } catch {
    /* ignore */
  }
  worklet = null;

  if (socket) {
    try {
      socket.send(JSON.stringify({ v: 1, type: 'stt.stop' }));
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }

  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }

  if (ctx) {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
    ctx = null;
  }
}

function reportError(err) {
  chrome.runtime
    .sendMessage({ type: 'OFFSCREEN_ERROR', error: String((err && err.message) || err) })
    .catch(() => {});
}
