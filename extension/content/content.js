/*!
 * BiliSub · 内容脚本
 * 视频定位 → 字幕采集（字幕轨 / DOM）→ 本地引擎翻译 → 浮层渲染
 * 同时负责原声模式的开关与结果展示
 */
(function () {
  'use strict';
  if (window.__BILISUB__) return;
  window.__BILISUB__ = true;

  const DEFAULTS = { enabled: false, mode: 'smart', srcLang: 'en', display: 'bilingual', scale: 1, hideNative: true, qualityMode: true };

  const state = {
    enabled: false,
    mode: 'smart',
    srcLang: 'en',
    display: 'bilingual',
    scale: 1,
    video: null,
    overlay: null,
    root: null,
    panel: null,
    sourceText: '',
    targetText: '',
    lastSource: '',
    lastError: '',
    connected: null,
    seq: 0,
    audio: false,
    hideNative: true,
    qualityMode: false,
    enabledAt: 0,
    hintShown: false,
    smartTried: false,
    shortcut: '',
    pendingTranslation: false,
    lastCaptionAt: 0,
    lastShownAt: 0,
    holdUntil: 0,
    holdLength: 0,
    loadingNote: ''
  };

  const CAPTION_SELECTORS = [
    '.ytp-caption-segment',
    '.bpx-player-subtitle-panel-text',
    '.bilibili-player-video-subtitle',
    '.jw-text-track-display',
    '.plyr__captions',
    '[data-testid="closed-captions"]',
    '[class*="caption-window"] [class*="caption"]'
  ];

  /* ---------------- 设置 ---------------- */
  async function loadSettings() {
    try {
      const s = await chrome.storage.local.get(DEFAULTS);
      // 会话状态不跨页面恢复：重载页面后必须重新点「启动」，
      // 否则会出现“按钮显示正在运行、实际什么都没跑”的假状态
      state.enabled = false;
      state.mode = ['smart', 'subtitle', 'audio'].includes(s.mode) ? s.mode : 'smart';
      state.srcLang = s.srcLang || 'en';
      state.display = s.display || 'bilingual';
      state.scale = Number(s.scale) || 1;
      state.hideNative = s.hideNative !== false;
      state.qualityMode = !!s.qualityMode;
    } catch {
      /* ignore */
    }
  }

  async function saveSettings() {
    try {
      await chrome.storage.local.set({
        enabled: state.enabled,
        mode: state.mode,
        srcLang: state.srcLang,
        display: state.display,
        scale: state.scale,
        hideNative: state.hideNative,
        qualityMode: state.qualityMode
      });
    } catch {
      /* ignore */
    }
  }

  /* ---------------- 视频与字幕 ---------------- */
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.offsetParent !== null;
  }

  function clean(text) {
    return String(text || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  function readCaption() {
    const video = state.video;
    if (!video) return '';

    try {
      const tracks = video.textTracks || [];
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.mode === 'disabled' || !track.activeCues) continue;
        const parts = [];
        for (const cue of track.activeCues) {
          if (cue && cue.text) parts.push(cue.text);
        }
        if (parts.length) return clean(parts.join(' '));
      }
    } catch {
      /* CORS 限制时忽略 */
    }

    for (const selector of CAPTION_SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      if (!nodes.length) continue;
      const parts = [];
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = (node.innerText || node.textContent || '').trim();
        if (text) parts.push(text);
      }
      if (parts.length) return clean(parts.join(' '));
    }

    return '';
  }

  function findVideo() {
    const all = Array.from(document.querySelectorAll('video'));
    if (!all.length) return null;
    let best = null;
    let bestArea = 0;
    for (const v of all) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 160) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  /* ---------------- 浮层 ---------------- */
  function contentRect(video) {
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return r;

    const fit = getComputedStyle(video).objectFit || 'contain';
    let w;
    let h;
    if (fit === 'cover') {
      return r; // 画面被裁切，直接贴元素
    }
    if (fit === 'fill') {
      w = r.width;
      h = r.height;
    } else {
      const s = Math.min(r.width / vw, r.height / vh);
      w = vw * s;
      h = vh * s;
    }
    return {
      left: r.left + (r.width - w) / 2,
      top: r.top + (r.height - h) / 2,
      width: w,
      height: h
    };
  }

  function ensureOverlay() {
    if (!state.overlay) {
      const el = document.createElement('div');
      el.className = 'bs-overlay bs-empty';
      // 一个固定底框，内部只换文字：避免替换时背景框跟着闪
      el.innerHTML =
        '<div class="bs-box" hidden><div class="bs-src"></div><div class="bs-dst"></div></div>';
      state.overlay = el;
    }
    const host = document.fullscreenElement || document.body;
    if (state.overlay.parentElement !== host) host.appendChild(state.overlay);
  }

  function positionOverlay() {
    const video = state.video;
    if (!state.overlay || !video) return;
    try {
      const host = document.fullscreenElement;
      const r = contentRect(video);
      const base = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
      const el = state.overlay;
      el.style.position = host ? 'absolute' : 'fixed';
      el.style.left = r.left - base.left + 'px';
      el.style.top = r.top - base.top + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
      el.style.fontSize = Math.max(13, Math.round(r.height * 0.045 * state.scale)) + 'px';
    } catch {
      /* ignore */
    }
  }

  function render() {
    if (!state.overlay) return;
    const box = state.overlay.querySelector('.bs-box');
    const src = state.overlay.querySelector('.bs-src');
    const dst = state.overlay.querySelector('.bs-dst');
    const showSrc = state.display !== 'target' && state.sourceText;
    const showDst = state.display !== 'source' && state.targetText;
    src.textContent = showSrc || '';
    dst.textContent = showDst || '';
    src.hidden = !showSrc;
    dst.hidden = !showDst;
    // 底框只在整条字幕都为空时隐藏；单纯换字不会让框消失
    if (box) box.hidden = !showSrc && !showDst;
    state.overlay.classList.toggle('bs-empty', !showSrc && !showDst);
  }

  // 新译文到位后再解除“更新中”的变暗状态，避免每句都闪一下
  function clearPending() {
    state.pendingTranslation = false;
    if (state.overlay) state.overlay.classList.remove('bs-pending');
  }

  /* ---------------- 翻译 ---------------- */
  let debounce = null;

  function onCaption(text, final = true) {
    if (!text || text === state.lastSource) return;
    // 定稿刚替换完时，短暂压住下一条中间结果，避免刚看清就被刷掉
    if (!final && Date.now() < state.holdUntil && text.length < state.holdLength + 15) return;
    state.lastSource = text;
    state.sourceText = text;
    state.lastShownAt = Date.now();
    // 不清空旧译文：先把它变暗，等新译文回来再交叉淡入，避免每句闪一下
    state.pendingTranslation = true;
    state.partial = !final;
    if (state.overlay) state.overlay.classList.add('bs-pending');
    if (state.hintShown) {
      state.hintShown = false;
      state.lastError = '';
      updateStatus();
    }
    render();
    clearTimeout(debounce);
    // 实时听声的中间结果用更短的防抖，尽快把译文补上
    debounce = setTimeout(() => translate(text, final), final ? 80 : 120);
  }

  // 已翻译过的句子直接复用，避免同一句重复请求
  const translationCache = new Map();

  async function translate(text, final = true) {
    // 中文直出：不需要翻译，直接显示原文
    if (state.srcLang === 'zh') {
      state.sourceText = '';
      state.targetText = text;
      state.connected = true;
      clearPending();
      render();
      updateStatus();
      return;
    }

    // 字幕句：先用快速模型出稿，再用高质量模型润色（两遍）
    const subtitleLine = state.mode === 'subtitle' && final;
    // 听声定稿句 / 非英语：直接走高质量模型
    const directQuality = state.srcLang !== 'en' || (state.mode === 'audio' && final);
    const role = directQuality ? 'quality' : 'realtime';
    const cacheKey = role + '|' + state.srcLang + '|' + text;
    if (translationCache.has(cacheKey)) {
      state.targetText = translationCache.get(cacheKey);
      state.connected = true;
      state.lastError = '';
      clearPending();
      render();
      updateStatus();
      return;
    }

    const my = ++state.seq;
    const slowTimer = setTimeout(() => {
      if (my === state.seq) {
        state.loadingNote = role === 'quality' ? '高质量模型翻译中…' : '本地模型加载中，首次可能需要几秒…';
        updateStatus();
      }
    }, 1200);
    try {
      const res = await Promise.race([
        chrome.runtime.sendMessage({ type: 'TRANSLATE', texts: [text], src: state.srcLang, tgt: 'zh', role }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('翻译超时（本地引擎无响应）')), 15000))
      ]);
      if (my !== state.seq) return;
      if (res && res.ok) {
        state.targetText = res.texts[0] || '';
        state.connected = true;
        state.lastError = '';
        state.lastShownAt = Date.now();
        // 听声的定稿句多停留一会儿，别刚换成高质量译文就被下一句中间结果顶掉
        if (final && state.mode === 'audio') {
          state.holdUntil = Date.now() + 1300;
          state.holdLength = text.length;
        }
        if (state.targetText) {
          translationCache.set(cacheKey, state.targetText);
          if (translationCache.size > 400) {
            translationCache.delete(translationCache.keys().next().value);
          }
        }
      } else {
        state.lastError = (res && res.error) || '翻译失败';
        state.connected = false;
      }
      clearPending();
    } catch (err) {
      state.lastError = String((err && err.message) || err);
      state.connected = false;
      clearPending();
    } finally {
      clearTimeout(slowTimer);
      state.loadingNote = '';
    }
    render();
    updateStatus();

    // 字幕句：快速稿已显示，后台再用高质量模型润色一次（不阻塞显示）
    if (subtitleLine && role === 'realtime' && state.qualityMode) {
      upgradeQuality(text, my);
    }
  }

  // 静默润色：只在句子没变时替换文字，失败或已换句就保持快速稿
  async function upgradeQuality(text, my) {
    const key = 'quality|' + state.srcLang + '|' + text;
    if (my !== state.seq) return;
    if (translationCache.has(key)) {
      state.targetText = translationCache.get(key);
      state.lastShownAt = Date.now();
      render();
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'TRANSLATE',
        texts: [text],
        src: state.srcLang,
        tgt: 'zh',
        role: 'quality'
      });
      if (my !== state.seq) return;
      if (res && res.ok && res.texts[0]) {
        state.targetText = res.texts[0];
        state.lastShownAt = Date.now();
        translationCache.set(key, state.targetText);
        if (translationCache.size > 400) {
          translationCache.delete(translationCache.keys().next().value);
        }
        render();
      }
    } catch {
      /* 润色失败保留快速稿 */
    }
  }

  /* ---------------- B 站字幕轨预读（登录状态下走官方接口） ---------------- */
  const track = { key: null, cues: null, lastCue: null, lastCueAt: 0, translating: false };

  async function ensureBiliTrack() {
    if (track.translating) return;
    if (!/(^|\.)bilibili\.com$/i.test(location.hostname)) return;

    const match = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
    if (!match) return;

    const bvid = match[1];
    const pageNo = Math.max(1, parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1);
    const key = bvid + ':' + pageNo;
    if (track.key === key) return;
    track.key = key;
    track.cues = null;
    track.lastCue = null;

    try {
      const view = await (
        await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { credentials: 'include' })
      ).json();
      if (!view || view.code !== 0) return;

      const pages = (view.data && view.data.pages) || [];
      const page = pages[pageNo - 1] || pages[0];
      if (!page) return;

      const pv = await (
        await fetch(
          `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${page.cid}`,
          { credentials: 'include' }
        )
      ).json();
      const subs = (pv && pv.data && pv.data.subtitle && pv.data.subtitle.subtitles) || [];
      if (!subs.length) return;

      let url = subs[0].subtitle_url || '';
      if (url.startsWith('//')) url = 'https:' + url;
      if (!url) return;

      const body = await (await fetch(url, { credentials: 'include' })).json();
      const cues = (body.body || [])
        .map((c) => ({ s: Number(c.from) || 0, e: Number(c.to) || 0, text: String(c.content || '').trim(), zh: '' }))
        .filter((c) => c.text && c.e > c.s);
      if (!cues.length) return;

      track.cues = cues;
      translateTrack(cues);
    } catch {
      /* 接口不可用就退回 DOM 字幕 */
    }
  }

  async function translateTrack(cues) {
    if (track.translating) return;
    track.translating = true;
    const CHUNK = 12;

    for (let i = 0; i < cues.length; i += CHUNK) {
      const batch = cues.slice(i, i + CHUNK);
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'TRANSLATE',
          texts: batch.map((c) => c.text),
          src: 'en',
          tgt: 'zh',
          role: 'realtime'
        });
        if (res && res.ok && Array.isArray(res.texts)) {
          res.texts.forEach((zh, j) => {
            if (batch[j]) batch[j].zh = zh;
          });
          if (track.lastCue) renderTrack();
        }
      } catch {
        /* 单批失败继续 */
      }
    }
    track.translating = false;
  }

  function renderTrack() {
    const video = state.video;
    if (!video || !track.cues) return;
    const t = video.currentTime;
    const cue = track.cues.find((c) => t >= c.s - 0.15 && t <= c.e + 0.15);

    if (!cue) {
      // 两条字幕之间的空档先保留，且保证每条至少显示 1.8 秒
      if (track.lastCue !== null) {
        if (Date.now() - (track.lastCueAt || 0) < 600) return;
        if (Date.now() - (state.lastShownAt || 0) < 1800) return;
        track.lastCue = null;
        state.sourceText = '';
        state.targetText = '';
        render();
      }
      return;
    }

    if (cue === track.lastCue) {
      if (cue.zh && state.targetText !== cue.zh) {
        state.targetText = cue.zh;
        render();
      }
      return;
    }

    track.lastCue = cue;
    track.lastCueAt = Date.now();
    state.lastShownAt = Date.now();
    state.sourceText = cue.text;
    state.targetText = cue.zh || '';
    state.lastSource = cue.text;
    if (cue.zh) state.connected = true;
    render();
    updateStatus();
  }

  /* ---------------- 面板 ---------------- */
  function ensureBaseStyle() {
    if (document.getElementById('bilisub-style')) return;
    const style = document.createElement('style');
    style.id = 'bilisub-style';
    style.textContent = `
      html.bs-hide-native .ytp-caption-window-container,
      html.bs-hide-native .bpx-player-subtitle-panel,
      html.bs-hide-native .bilibili-player-video-subtitle,
      html.bs-hide-native .jw-text-track-display,
      html.bs-hide-native .plyr__captions,
      html.bs-hide-native [data-testid="closed-captions"] { opacity: 0 !important; pointer-events: none !important; }
    `;
    document.documentElement.appendChild(style);
  }

  function applyHideNative() {
    document.documentElement.classList.toggle('bs-hide-native', !!state.enabled && state.hideNative);
  }

  function buildPanel() {
    const root = document.createElement('div');
    root.id = 'bilisub-root';
    root.innerHTML = `
      <button class="bs-fab" data-act="open" title="BiliSub 字幕">译</button>
      <div class="bs-panel" hidden>
        <div class="bs-head">
          <span class="bs-logo">译</span>
          <span class="bs-title">BILISUB</span>
          <span class="bs-dot" data-role="dot"></span>
          <button class="bs-x" data-act="close" title="收起">×</button>
        </div>
        <div class="bs-body">
          <div class="bs-tabs" data-role="tabs">
            <button class="bs-tab" data-mode="smart">智能</button>
            <button class="bs-tab" data-mode="subtitle">字幕</button>
            <button class="bs-tab" data-mode="audio">听声</button>
          </div>
          <div class="bs-row"><label>语言</label>
            <select data-k="srcLang">
              <option value="en">英语</option>
              <option value="zh">中文</option>
              <option value="fr">法语</option>
              <option value="ru">俄语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
            </select>
          </div>
          <div class="bs-row"><label>显示</label>
            <select data-k="display">
              <option value="bilingual">双语</option>
              <option value="target">仅译文</option>
              <option value="source">仅原文</option>
            </select>
          </div>
          <div class="bs-row"><label>字号</label>
            <input type="range" min="0.8" max="1.8" step="0.1" data-k="scale" />
          </div>
          <div class="bs-row"><label>隐藏原字幕</label>
            <input type="checkbox" data-k="hideNative" />
          </div>
          <div class="bs-row"><label title="字幕先用快速模型出稿（约 0.06 秒），再用高质量模型润色（约 0.3 秒）；关闭则只用快速模型">高质量字幕</label>
            <input type="checkbox" data-k="qualityMode" />
          </div>
          <button class="bs-primary" data-act="toggle">启动</button>
          <div class="bs-tip" data-role="tip">选择模式后启动</div>
          <button class="bs-link" data-act="options">引擎与模型设置</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.hidden = true;

    state.root = root;
    state.panel = root.querySelector('.bs-panel');

    root.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-mode]');
      if (tab) {
        onModeClick(tab.dataset.mode).catch((err) => showTip(String((err && err.message) || err)));
        return;
      }
      const btn = event.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'open') {
        state.panel.hidden = false;
        root.classList.add('bs-open');
        refreshStatus();
      } else if (act === 'close') {
        state.panel.hidden = true;
        root.classList.remove('bs-open');
      } else if (act === 'toggle') {
        toggle().catch((err) => showTip(String((err && err.message) || err)));
      } else if (act === 'options') {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }).catch(() => {});
      }
    });

    root.addEventListener('change', (event) => {
      const el = event.target;
      const key = el.dataset && el.dataset.k;
      if (!key) return;
      if (key === 'scale') state.scale = Number(el.value) || 1;
      else if (el.type === 'checkbox') state[key] = el.checked;
      else state[key] = el.value;
      saveSettings();
      positionOverlay();
      render();
      if (key === 'hideNative') applyHideNative();
      if (key === 'srcLang' && state.enabled) {
        stopAll().then(() => toggle());
      }
    });

    const dispSel = root.querySelector('[data-k="display"]');
    const langSel = root.querySelector('[data-k="srcLang"]');
    const scale = root.querySelector('[data-k="scale"]');
    const hideNative = root.querySelector('[data-k="hideNative"]');
    const qualityMode = root.querySelector('[data-k="qualityMode"]');
    dispSel.value = state.display;
    langSel.value = state.srcLang;
    scale.value = String(state.scale);
    hideNative.checked = !!state.hideNative;
    qualityMode.checked = !!state.qualityMode;

    renderMode();
    syncToggleLabel();
  }

  function renderMode() {
    if (!state.root) return;
    for (const tab of state.root.querySelectorAll('[data-mode]')) {
      tab.classList.toggle('is-active', tab.dataset.mode === state.mode);
    }
  }

  async function onModeClick(mode) {
    if (!['smart', 'subtitle', 'audio'].includes(mode) || mode === state.mode) return;
    const wasEnabled = state.enabled;
    if (wasEnabled) await stopAll();
    state.mode = mode;
    state.lastError = '';
    state.hintShown = false;
    saveSettings();
    renderMode();
    updateStatus();
    if (wasEnabled) await toggle();
  }

  async function stopAll() {
    state.enabled = false;
    state.audio = false;
    try {
      await chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
    } catch {
      /* ignore */
    }
    // 让在途的翻译结果失效，否则它们回来会重新写回文字
    state.seq += 1;
    clearTimeout(debounce);
    state.sourceText = '';
    state.targetText = '';
    state.lastSource = '';
    state.lastError = '';
    clearPending();
    track.lastCue = null;
    render();
    saveSettings();
    applyHideNative();
    updateStatus();
  }

  function syncToggleLabel() {
    const btn = state.root && state.root.querySelector('[data-act="toggle"]');
    if (!btn) return;
    btn.textContent = state.enabled ? '停止' : '启动';
  }

  function showTip(text) {
    state.lastError = text;
    updateStatus();
  }

  function updateStatus() {
    if (!state.root) return;
    const dot = state.root.querySelector('[data-role="dot"]');
    const tip = state.root.querySelector('[data-role="tip"]');
    dot.classList.toggle('bs-ok', state.connected === true);
    dot.classList.toggle('bs-err', state.connected === false);

    if (state.lastError) tip.textContent = state.lastError;
    else if (state.loadingNote) tip.textContent = state.loadingNote;
    else if (state.enabled) {
      const audioActive = state.mode === 'audio' || state.audio;
      tip.textContent = audioActive
        ? state.audio
          ? '正在识别当前标签页声音…'
          : '正在请求音频权限…'
        : state.srcLang === 'zh'
          ? '正在显示中文字幕…'
          : '正在翻译字幕…';
    } else tip.textContent = '选择模式后启动';
    syncToggleLabel();
  }

  async function refreshStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'STATUS' });
      state.connected = !!(res && res.ok && res.connected);
      if (!state.connected) state.lastError = (res && res.error) || '本地引擎未连接';
    } catch (err) {
      state.connected = false;
      state.lastError = '本地引擎未连接：' + String((err && err.message) || err);
    }
    updateStatus();
  }

  async function toggle() {
    if (state.enabled) {
      await stopAll();
      return;
    }

    state.enabled = true;
    state.audio = false;
    state.smartTried = false;
    state.lastError = '';
    saveSettings();
    applyHideNative();
    state.enabledAt = Date.now();
    state.hintShown = false;

    if (state.mode !== 'audio') ensureBiliTrack();
    if (state.mode === 'audio') {
      try {
        await startAudio();
      } catch (err) {
        // 抓音失败（多半是没点工具栏图标）：回到未启动状态，避免按钮显示“停止”却什么也没跑
        state.enabled = false;
        state.audio = false;
        saveSettings();
        applyHideNative();
        updateStatus();
        await explainAudioBlocked(err);
        return;
      }
    }
    updateStatus();
  }

  async function explainAudioBlocked(err) {
    const msg = String((err && err.message) || err);
    if (/调用扩展|invoked|授权|gesture|permission/i.test(msg)) {
      // 面板里的点击不算“调用扩展”，试着替用户打开工具栏菜单，让那一次点击完成授权
      const opened = await chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => null);
      if (opened && opened.ok) {
        showTip('已打开工具栏菜单，点「开始听声翻译」即可完成授权。');
        return;
      }
      showTip(
        '听声翻译需要授权：点工具栏图标' +
          (state.shortcut ? `，或按 ${state.shortcut}` : '，或到 edge://extensions/shortcuts 绑定快捷键') +
          '。'
      );
      return;
    }
    showTip(msg || '无法开始听声翻译');
  }

  async function loadShortcut() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SHORTCUT_INFO' });
      const cmd = ((res && res.commands) || []).find((c) => c.name === 'toggle-capture');
      state.shortcut = (cmd && cmd.shortcut) || '';
    } catch {
      /* ignore */
    }
  }

  async function startAudio() {
    const res = await chrome.runtime.sendMessage({ type: 'AUDIO_START', src: state.srcLang });
    if (!res || !res.ok) {
      state.audio = false;
      throw new Error((res && res.error) || '无法开始音频捕获');
    }
    state.audio = true;
  }

  /* ---------------- 主循环 ---------------- */
  function tick() {
    const video = findVideo();
    if (state.root) state.root.hidden = !video;
    if (video !== state.video) {
      state.video = video;
      if (video) {
        ensureOverlay();
        positionOverlay();
      } else if (state.overlay) {
        state.overlay.remove();
        state.overlay = null;
      }
    }

    if (!state.video) return;
    if (state.overlay && state.overlay.parentElement !== (document.fullscreenElement || document.body)) {
      ensureOverlay();
      positionOverlay();
    }

    if (!state.enabled) return;

    // 看门狗：显示“运行中”但实际没跑，就复位状态，避免假开启
    if (state.mode === 'audio' && !state.audio && state.enabledAt && Date.now() - state.enabledAt > 3000) {
      state.enabled = false;
      saveSettings();
      updateStatus();
      showTip(
        '听声翻译没有在运行，请重新启动：点工具栏图标' +
          (state.shortcut ? `，或按 ${state.shortcut}` : '，或到 edge://extensions/shortcuts 绑定快捷键') +
          '。'
      );
      return;
    }

    // 听声模式（或智能模式已回退到听声）由消息驱动，不再轮询 DOM
    if (state.mode === 'audio' || state.audio) return;

    // B 站优先走官方字幕轨（预读 + 按时间显示，延迟最低）
    ensureBiliTrack();
    if (track.cues) {
      renderTrack();
      return;
    }

    const rawCaption = readCaption();
    if (rawCaption) {
      state.lastCaptionAt = Date.now();
      onCaption(rawCaption);
    } else if (
      state.sourceText &&
      state.lastCaptionAt &&
      Date.now() - state.lastCaptionAt > 600 &&
      Date.now() - (state.lastShownAt || 0) > 1800
    ) {
      // 字幕消失后至少再停留 1.8 秒，保证短句也看得完整
      state.sourceText = '';
      state.targetText = '';
      state.lastSource = '';
      clearPending();
      render();
    }

    if (!state.sourceText && state.enabledAt && Date.now() - state.enabledAt > 4000) {
      if (state.mode === 'smart' && !state.smartTried) {
        // 智能模式：没有字幕就自动转听声
        state.smartTried = true;
        startAudio()
          .then(() => {
            state.hintShown = true;
            showTip('未检测到字幕，已自动切换为原声识别。');
          })
          .catch(() => {
            state.hintShown = true;
            showTip(
              '未检测到字幕；听声翻译需要授权：点工具栏图标' +
                (state.shortcut ? `，或按 ${state.shortcut}` : '，或到 edge://extensions/shortcuts 绑定快捷键') +
                '。'
            );
          });
      } else if (state.mode === 'subtitle' && !state.hintShown) {
        state.hintShown = true;
        showTip('没有检测到字幕轨。可以切换到「智能」或「听声」模式。');
      }
    }
  }

  /* ---------------- 消息 ---------------- */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'BS_STATE') {
      sendResponse({ ok: true, enabled: state.enabled, mode: state.mode });
      return true;
    }
    if (msg.type === 'BS_TOGGLE') {
      toggle().catch((err) => showTip(String((err && err.message) || err)));
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'AUDIO_STARTED') {
      // 从工具栏/快捷键启动的听声：同步到浮层状态
      state.audio = true;
      state.enabled = true;
      if (msg.src) state.srcLang = msg.src;
      if (state.mode !== 'audio') {
        state.mode = 'audio';
        renderMode();
      }
      saveSettings();
      updateStatus();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'AUDIO_CAPTION') {
      if (state.enabled && (state.mode === 'audio' || state.audio)) {
        onCaption(clean(msg.text), msg.final !== false);
      }
    } else if (msg.type === 'AUDIO_ERROR') {
      // 抓音中断（导航、系统占用等）：状态必须同步回“未启动”
      state.audio = false;
      state.enabled = false;
      saveSettings();
      updateStatus();
      showTip(String(msg.error || '音频捕获失败'));
    } else if (msg.type === 'AUDIO_STOPPED') {
      state.audio = false;
      if (state.enabled) {
        state.enabled = false;
        saveSettings();
      }
      updateStatus();
    }
  });

  /* ---------------- 启动 ---------------- */
  async function init() {
    await loadSettings();
    loadShortcut();
    buildPanel();
    ensureBaseStyle();
    applyHideNative();
    tick();
    setInterval(tick, 250);
    setInterval(() => {
      const video = state.video;
      if (video) positionOverlay();
    }, 1000);

    window.addEventListener('resize', positionOverlay);
    document.addEventListener('fullscreenchange', () => {
      ensureOverlay();
      positionOverlay();
    });
    document.addEventListener('scroll', positionOverlay, true);

    if (state.enabled && state.mode === 'subtitle') updateStatus();
    else updateStatus();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });

  // 调试出口（仅隔离世界可见，页面脚本拿不到）
  try {
    window.__bilisub = { state, translate, onCaption, readCaption };
  } catch {
    /* ignore */
  }
})();
