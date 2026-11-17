'use strict';

const $ = (id) => document.getElementById(id);
let activeTab = null;
let capturing = false;
let overlayOn = false;

function setEngine(text, kind) {
  $('engine').textContent = text;
  const dot = $('dot');
  dot.className = 'dot' + (kind ? ' ' + kind : '');
}

function renderAudio() {
  const btn = $('audio');
  btn.textContent = capturing ? '停止听声翻译' : '开始听声翻译';
  btn.classList.toggle('is-on', capturing);
  $('audioTag').textContent = capturing ? '运行中' : '未运行';
  $('audioTag').classList.toggle('on', capturing);
  $('audioNote').textContent = capturing
    ? '正在识别当前标签页声音，字幕会显示在视频画面上。'
    : '点这一下同时完成浏览器的抓音授权。';
}

function renderOverlay() {
  const btn = $('overlay');
  btn.textContent = overlayOn ? '停止字幕浮层' : '在当前页启动';
  $('ovTag').textContent = overlayOn ? '运行中' : '未启动';
  $('ovTag').classList.toggle('on', overlayOn);
}

async function queryOverlay() {
  if (!activeTab) return false;
  try {
    const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'BS_STATE' });
    return !!(res && res.ok && res.enabled);
  } catch {
    return null; // 页面没有内容脚本
  }
}

async function refresh() {
  // 引擎状态 + 当前模型
  try {
    const res = await chrome.runtime.sendMessage({ type: 'STATUS' });
    if (res && res.ok && res.connected) {
      let detail = '';
      try {
        const info = await chrome.runtime.sendMessage({ type: 'ENGINE_INFO' });
        if (info && info.ok && info.info && info.info.current) {
          const mt = info.info.current.mt || {};
          const rt = (mt.realtime && mt.realtime.model) || '';
          const q = (mt.quality && mt.quality.model) || '';
          detail = ` · 实时 ${short(rt)} · 高质量 ${short(q)}`;
        }
      } catch {
        /* ignore */
      }
      setEngine('本地引擎已连接' + detail, 'ok');
    } else {
      setEngine('本地引擎未连接：' + ((res && res.error) || '请先运行安装目录里的 start-engine.cmd'), 'err');
    }
  } catch (err) {
    setEngine('本地引擎未连接：' + String(err.message || err), 'err');
  }

  // 抓音状态
  try {
    const state = await chrome.runtime.sendMessage({ type: 'AUDIO_STATE' });
    capturing = !!(state && state.ok && state.tabId && activeTab && state.tabId === activeTab.id);
  } catch {
    capturing = false;
  }
  renderAudio();

  // 浮层状态
  const ov = await queryOverlay();
  if (ov === null) {
    overlayOn = false;
    $('overlay').disabled = true;
    $('ovTag').textContent = '当前页不可用';
    $('ovTag').classList.remove('on');
  } else {
    overlayOn = ov;
    $('overlay').disabled = false;
    renderOverlay();
  }
}

function short(id) {
  if (!id) return '—';
  const map = {
    'mt-opus-en-zh': 'OPUS 英→中',
    'mt-nllb-600m': 'NLLB-600M',
    'mt-nllb-1.3b': 'NLLB-1.3B'
  };
  if (map[id]) return map[id];
  if (id.startsWith('qwen')) return id.replace(/:.*/, '').replace('qwen', 'Qwen');
  return id.replace('mt-', '').replace('asr-', '').toUpperCase();
}

async function toggleAudio() {
  $('audio').disabled = true;
  try {
    if (capturing) {
      await chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
    } else {
      if (!activeTab) throw new Error('没有可用的标签页');
      const res = await chrome.runtime.sendMessage({ type: 'AUDIO_START', tabId: activeTab.id });
      if (!res || !res.ok) throw new Error((res && res.error) || '启动失败');
    }
  } catch (err) {
    setEngine(String(err.message || err), 'err');
  } finally {
    $('audio').disabled = false;
    setTimeout(refresh, 500);
  }
}

async function toggleOverlay() {
  if (!activeTab) return;
  $('overlay').disabled = true;
  try {
    await chrome.tabs.sendMessage(activeTab.id, { type: 'BS_TOGGLE' });
  } catch {
    setEngine('当前页面没有加载字幕脚本（刷新页面后再试）', 'err');
  } finally {
    setTimeout(async () => {
      overlayOn = (await queryOverlay()) === true;
      $('overlay').disabled = false;
      renderOverlay();
    }, 600);
  }
}

async function init() {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  // 显示真实注册到的快捷键（可能被系统或用户改过）
  try {
    const info = await chrome.runtime.sendMessage({ type: 'SHORTCUT_INFO' });
    const cmd = ((info && info.commands) || []).find((c) => c.name === 'toggle-capture');
    const kbd = document.querySelector('.kbd');
    if (kbd) {
      kbd.textContent = (cmd && cmd.shortcut) || '未绑定';
      if (!(cmd && cmd.shortcut)) {
        kbd.title = '点击到 edge://extensions/shortcuts 绑定快捷键';
        kbd.style.cursor = 'pointer';
        kbd.addEventListener('click', async () => {
          try {
            await chrome.tabs.create({ url: 'edge://extensions/shortcuts' });
          } catch {
            kbd.textContent = '去 edge://extensions/shortcuts';
          }
        });
      } else {
        kbd.title = '快捷键：' + (cmd && cmd.shortcut);
      }
    }
  } catch {
    /* ignore */
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs && tabs[0];

  $('audio').addEventListener('click', toggleAudio);
  $('overlay').addEventListener('click', toggleOverlay);
  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  await refresh();
}

init();
