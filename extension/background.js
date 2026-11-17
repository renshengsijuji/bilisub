/*!
 * BiliSub · Service Worker
 * 职责：引擎连接（WebSocket）、标签页音频捕获、offscreen 管理、消息路由
 */
'use strict';

const ENGINE_WS = 'ws://127.0.0.1:8765';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';

let ws = null;
let wsReady = null;
let reqId = 0;
const pending = new Map();
const waiters = [];
let lastWelcome = null;

let audioTabId = null;
let creatingOffscreen = null;
let heartbeatTimer = null;
let lastMessageAt = 0;

/* ---------------- 引擎连接 ---------------- */

function startHeartbeat(socket) {
  stopHeartbeat();
  lastMessageAt = Date.now();
  heartbeatTimer = setInterval(() => {
    if (!ws || ws !== socket || socket.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }
    // 长时间收不到任何消息（含 pong）说明连接已死，主动断开让下次重连
    if (Date.now() - lastMessageAt > 15000) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      socket.send(JSON.stringify({ v: 1, type: 'ping' }));
    } catch {
      /* ignore */
    }
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function hardReset() {
  stopHeartbeat();
  try {
    if (ws) ws.close();
  } catch {
    /* ignore */
  }
  ws = null;
  wsReady = null;
  lastWelcome = null;
  // 未完成的请求全部失败，避免永远挂着
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(new Error('与本地引擎的连接已重置'));
  }
}

function ensureWs(timeout = 4000) {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (wsReady) return wsReady;

  wsReady = new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(ENGINE_WS);
    } catch (err) {
      wsReady = null;
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      wsReady = null;
      reject(new Error('连接本地引擎超时，请确认引擎已启动'));
    }, timeout);

    socket.onopen = () => {
      clearTimeout(timer);
      ws = socket;
      socket.onmessage = onEngineMessage;
      socket.onclose = () => {
        if (ws === socket) ws = null;
        wsReady = null;
        lastWelcome = null;
        stopHeartbeat();
      };
      socket.onerror = () => {};
      startHeartbeat(socket);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      wsReady = null;
    };
  }).catch((err) => {
    wsReady = null;
    throw err;
  });

  return wsReady;
}

function onEngineMessage(ev) {
  lastMessageAt = Date.now();
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    return;
  }
  if (msg.type === 'welcome') {
    lastWelcome = msg;
    while (waiters.length) waiters.shift()(msg);
    return;
  }
  if (msg.type === 'models.progress') {
    chrome.runtime.sendMessage({ type: 'MODEL_PROGRESS', ...msg }).catch(() => {});
    return;
  }
  if (msg.type === 'caption') {
    if (audioTabId) {
      chrome.tabs.sendMessage(audioTabId, { type: 'AUDIO_CAPTION', text: msg.text }).catch(() => {});
    }
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message || msg.code));
    else p.resolve(msg);
  }
}

function waitWelcome(timeout = 3000) {
  if (lastWelcome) return Promise.resolve(lastWelcome);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('引擎未返回握手信息')), timeout);
    waiters.push((msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

async function ensureHealthy() {
  const socket = await ensureWs();
  if (Date.now() - lastMessageAt < 4000) return socket;

  const before = lastMessageAt;
  try {
    socket.send(JSON.stringify({ v: 1, type: 'ping' }));
  } catch {
    hardReset();
    return ensureWs();
  }
  await new Promise((r) => setTimeout(r, 700));
  if (lastMessageAt > before) return socket;

  // 没有 pong：连接已死（多半是引擎重启过）
  hardReset();
  return ensureWs();
}

async function rawCall(payload, timeout) {
  const socket = await ensureHealthy();
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ v: 1, id, ...payload }));
    if (timeout > 0) {
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('引擎请求超时'));
        }
      }, timeout);
    }
  });
}

async function callEngine(payload, timeout = 30000, retries = 1) {
  try {
    return await rawCall(payload, timeout);
  } catch (err) {
    const text = String((err && err.message) || err);
    // 连接可能已失效（引擎重启/休眠）：重置后重试一次
    if (retries > 0 && /超时|重置|closed|network|断开/i.test(text)) {
      hardReset();
      return callEngine(payload, timeout, retries - 1);
    }
    throw err;
  }
}

/* ---------------- 音频捕获 ---------------- */

async function ensureOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts && contexts.length) return;
  } catch {
    /* 老版本没有 getContexts，直接创建 */
  }
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: '捕获标签页音频并送入本地语音识别'
    })
    .catch((err) => {
      if (!String(err.message || err).includes('Only a single offscreen')) throw err;
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  return creatingOffscreen;
}

async function startAudio(tabId, src) {
  if (!tabId) throw new Error('没有可捕获的标签页');
  await ensureOffscreen();

  if (audioTabId && audioTabId !== tabId) {
    await stopAudio();
  }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    const text = String((err && err.message) || err);
    if (/invoked|activeTab|gesture|permission/i.test(text)) {
      return {
        ok: false,
        error: '抓取标签页声音需要先调用扩展：点一次工具栏图标，或使用快捷键（可在 edge://extensions/shortcuts 查看）'
      };
    }
    return { ok: false, error: '无法捕获标签页声音：' + text };
  }

  audioTabId = tabId;

  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START',
    streamId,
    tabId,
    src: src || 'en',
    engine: ENGINE_WS
  });

  // 告诉页面进入「听声」状态，否则浮层会忽略识别结果
  chrome.tabs.sendMessage(tabId, { type: 'AUDIO_STARTED', src: src || 'en' }).catch(() => {});

  return { ok: true, tabId };
}

async function stopAudio() {
  if (!audioTabId) return { ok: true };
  const tabId = audioTabId;
  audioTabId = null;
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' });
  } catch {
    /* offscreen 可能已关 */
  }
  try {
    chrome.tabs.sendMessage(tabId, { type: 'AUDIO_STOPPED' });
  } catch {
    /* ignore */
  }
  return { ok: true, tabId };
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;

  if (msg.type === 'TRANSLATE') {
    callEngine(
      {
        type: 'translate.batch',
        texts: msg.texts,
        src: msg.src || 'en',
        tgt: msg.tgt || 'zh',
        role: msg.role || 'realtime'
      },
      8000
    )
      .then((res) => sendResponse({ ok: true, texts: res.texts }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'SHORTCUT_INFO') {
    chrome.commands
      .getAll()
      .then((commands) => sendResponse({ ok: true, commands }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'OPEN_POPUP') {
    // 面板里无法直接发起 tabCapture；尝试帮用户打开工具栏弹窗，让那一次点击成为授权
    if (chrome.action && chrome.action.openPopup) {
      chrome.action
        .openPopup()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }
    sendResponse({ ok: false, error: '当前浏览器不支持自动打开工具栏弹窗' });
    return false;
  }

  if (msg.type === 'DIAGNOSE') {
    callEngine({ type: 'diagnose' }, 180000)
      .then((res) => sendResponse({ ok: true, result: res }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ENGINE_INFO') {
    ensureWs()
      .then(() => waitWelcome())
      .then(async (welcome) => {
        // welcome 是连接时缓存的，模型列表可能已过期，这里补一次最新数据
        let models = welcome.models || [];
        try {
          const fresh = await callEngine({ type: 'models.list' });
          models = fresh.models || models;
        } catch {
          /* 拉不到就退回缓存 */
        }
        sendResponse({ ok: true, info: { ...welcome, models } });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'MODEL_INSTALL') {
    // 下载可能持续数分钟：立即返回，进度与结果通过 MODEL_PROGRESS / MODEL_DONE 推送
    callEngine({ type: 'models.download', model: msg.model }, 0)
      .then(() => {
        chrome.runtime.sendMessage({ type: 'MODEL_DONE', model: msg.model }).catch(() => {});
      })
      .catch((err) => {
        chrome.runtime
          .sendMessage({ type: 'MODEL_FAILED', model: msg.model, error: String(err.message || err) })
          .catch(() => {});
      });
    sendResponse({ ok: true, started: true });
    return false;
  }

  if (msg.type === 'MODELS_LIST') {
    callEngine({ type: 'models.list' })
      .then((res) => sendResponse({ ok: true, models: res.models }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'MODELS_DIR') {
    callEngine({ type: 'models.dir' })
      .then((res) => sendResponse({ ok: true, info: res }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'MODELS_CHOOSE_DIR') {
    callEngine({ type: 'models.chooseDir' }, 120000)
      .then((res) => sendResponse({ ok: true, path: res.path }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'MODELS_SET_DIR') {
    callEngine({ type: 'models.setDir', path: msg.path, move: !!msg.move }, 300000)
      .then((res) => sendResponse({ ok: true, path: res.path, size: res.size, free: res.free, moved: res.moved }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'CONFIG_SAVE') {
    callEngine({ type: 'config.save', mt: msg.mt, asr: msg.asr })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'STATUS') {
    ensureWs()
      .then(() => callEngine({ type: 'models.list' }))
      .then((models) => sendResponse({ ok: true, connected: true, models }))
      .catch((err) => sendResponse({ ok: false, connected: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'AUDIO_STATE') {
    sendResponse({ ok: true, tabId: audioTabId });
    return false;
  }

  if (msg.type === 'AUDIO_START') {
    startAudio(msg.tabId || (sender.tab && sender.tab.id), msg.src)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === 'AUDIO_STOP') {
    stopAudio().then(sendResponse);
    return true;
  }

  if (msg.type === 'OFFSCREEN_CAPTION') {
    if (audioTabId) {
      chrome.tabs.sendMessage(audioTabId, { type: 'AUDIO_CAPTION', text: msg.text }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'OFFSCREEN_ERROR') {
    if (audioTabId) {
      chrome.tabs.sendMessage(audioTabId, { type: 'AUDIO_ERROR', error: msg.error }).catch(() => {});
    }
    return;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-capture') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (audioTabId === tab.id) {
    await stopAudio();
    return;
  }

  let res;
  try {
    res = await startAudio(tab.id);
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  if (!res || !res.ok) {
    await chrome.tabs
      .sendMessage(tab.id, { type: 'AUDIO_ERROR', error: (res && res.error) || '无法抓取声音' })
      .catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === audioTabId) stopAudio();
});
