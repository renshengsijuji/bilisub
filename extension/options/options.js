'use strict';

const $ = (id) => document.getElementById(id);
let info = null;

const ROLE_LABEL = {
  'mt-opus-en-zh': '实时翻译',
  'mt-nllb-600m': '高质量翻译',
  'asr-whisper-tiny': '实时识别',
  'asr-whisper-small': '定稿识别',
  'asr-distil-small-en': '定稿识别'
};

function setEngine(text, kind) {
  $('engine').textContent = text;
  $('dot').className = 'dot' + (kind ? ' ' + kind : '');
}

/* ---------------- 模型列表 ---------------- */
function renderModels() {
  const box = $('modelList');
  box.innerHTML = '';
  const models = (info && info.models) || [];
  const ollama = (info && info.ollama) || { available: false, models: [] };
  const chat = (ollama.models || []).filter((n) => !/embed|bge|minilm/i.test(n));

  const rows = [];

  for (const m of models) {
    rows.push({
      name: m.name,
      role: ROLE_LABEL[m.id] || (m.kind === 'asr' ? '语音识别' : '翻译'),
      installed: !!m.installed
    });
  }
  for (const name of chat) {
    rows.push({ name: name, role: '高质量翻译', installed: true, ollama: true });
  }

  if (!rows.length) {
    box.innerHTML = '<div class="model-row missing"><span class="model-name">没有检测到可用模型</span></div>';
    $('modelTag').textContent = '0 个';
    return;
  }

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'model-row' + (r.installed ? '' : ' missing');
    row.innerHTML = `
      <span class="model-name">${r.name}</span>
      <span class="model-role">${r.role}</span>
      <span class="model-state ${r.installed ? 'ok' : ''}">${r.installed ? '已安装' : '未安装'}</span>`;
    box.appendChild(row);
  }
  $('modelTag').textContent = rows.filter((r) => r.installed).length + ' 个可用';
  $('modelTag').classList.add('on');
}

/* ---------------- 下拉 ---------------- */
function renderSelects() {
  const models = ((info && info.models) || []).filter((m) => m.kind === 'mt' && m.installed);
  const ollama = (info && info.ollama) || { available: false, models: [] };
  const chat = (ollama.models || []).filter((n) => !/embed|bge|minilm/i.test(n));

  const groups = [];
  if (models.length) {
    groups.push(
      `<optgroup label="本机 CT2 模型">${models
        .map((m) => `<option value="local:${m.id}">${m.name}</option>`)
        .join('')}</optgroup>`
    );
  }
  if (chat.length) {
    groups.push(
      `<optgroup label="Ollama（GPU）">${chat
        .map((n) => `<option value="ollama:${n}">${n}</option>`)
        .join('')}</optgroup>`
    );
  }
  const html = groups.join('') || '<option value="">（没有可用模型）</option>';

  const rt = $('realtimeModel');
  const q = $('qualityModel');
  rt.innerHTML = html;
  q.innerHTML = html;

  const cur = (info && info.current && info.current.mt) || {};
  const val = (cfg) => (cfg ? (cfg.provider === 'ollama' ? `ollama:${cfg.model}` : `local:${cfg.model}`) : '');
  const pick = (sel, wanted) => {
    if (wanted && [...sel.options].some((o) => o.value === wanted)) sel.value = wanted;
  };
  pick(rt, val(cur.realtime));
  pick(q, val(cur.quality));

  const isApi = cur.realtime && cur.realtime.provider === 'openai';
  $('useApi').checked = !!isApi;
  $('apiBox').hidden = !isApi;
  if (isApi) {
    $('baseUrl').value = cur.realtime.base_url || '';
    $('apiKey').value = cur.realtime.api_key || '';
    $('apiModel').value = cur.realtime.model || '';
  }
}

/* ---------------- 加载 ---------------- */
async function load() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ENGINE_INFO' });
    if (!res || !res.ok) throw new Error((res && res.error) || '无法连接本地引擎');
    info = res.info;

    const mt = info.current && info.current.mt;
    const rt = mt && mt.realtime ? mt.realtime.model : '—';
    const q = mt && mt.quality ? mt.quality.model : '—';
    setEngine(`本地引擎 v${info.server} · 实时 ${rt} · 高质量 ${q}`, 'ok');

    renderModels();
    renderSelects();

    const dir = await chrome.runtime.sendMessage({ type: 'MODELS_DIR' });
    const d = (dir && dir.info) || dir || {};
    $('modelsDir').textContent = d.path || '—';
  } catch (err) {
    setEngine('本地引擎未连接：' + String((err && err.message) || err), 'err');
    $('modelsDir').textContent = '—';
    $('modelTag').textContent = '离线';
  }
}

/* ---------------- 自检 ---------------- */
async function diagnose() {
  const btn = $('diag');
  const box = $('diagResult');
  btn.disabled = true;
  $('diagTag').textContent = '检测中…';
  $('diagTag').className = 'tag';
  box.hidden = false;
  box.innerHTML = '<div class="diag-row"><span class="diag-name">运行中</span><span class="diag-text">正在加载模型，首次可能需要几秒…</span></div>';

  try {
    const res = await chrome.runtime.sendMessage({ type: 'DIAGNOSE' });
    if (!res || !res.ok) throw new Error((res && res.error) || '检测失败');
    const r = res.result || {};
    const rows = [];

    const mtRow = (key, label) => {
      const d = (r.mt || {})[key] || {};
      if (d.ok) return { ok: true, name: label, ms: d.ms, text: d.text };
      return { ok: false, name: label, ms: '', text: d.error || '失败' };
    };
    rows.push(mtRow('realtime', '实时翻译'));
    rows.push(mtRow('quality', '高质量翻译'));

    const asrRow = (key, label) => {
      const d = (r.asr || {})[key] || {};
      if (d.ok) return { ok: true, name: label, ms: d.ms, text: '模型加载正常 · ' + d.model };
      return { ok: false, name: label, ms: '', text: d.error || '失败' };
    };
    rows.push(asrRow('realtime', '实时识别'));
    rows.push(asrRow('final', '定稿识别'));

    box.innerHTML = rows
      .map(
        (x) => `<div class="diag-row ${x.ok ? '' : 'bad'}">
          <span class="diag-name">${x.name}</span>
          <span class="diag-ms">${x.ms ? x.ms + 'ms' : '—'}</span>
          <span class="diag-text">${x.ok ? '✓ ' : '✗ '}${escapeHtml(x.text || '')}</span>
        </div>`
      )
      .join('');

    const bad = rows.filter((x) => !x.ok).length;
    $('diagTag').textContent = bad ? `${bad} 项异常` : '全部正常';
    $('diagTag').className = 'tag ' + (bad ? 'err' : 'on');
  } catch (err) {
    box.innerHTML = `<div class="diag-row bad"><span class="diag-name">检测失败</span><span class="diag-text">${escapeHtml(
      String((err && err.message) || err)
    )}</span></div>`;
    $('diagTag').textContent = '检测失败';
    $('diagTag').className = 'tag err';
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 保存 ---------------- */
function optionToCfg(value, fallback) {
  if (!value) return { provider: 'local', model: fallback };
  const idx = value.indexOf(':');
  const kind = value.slice(0, idx);
  const model = value.slice(idx + 1);
  return kind === 'ollama' ? { provider: 'ollama', model } : { provider: 'local', model };
}

async function save() {
  const el = $('saveResult');
  el.hidden = false;
  el.textContent = '保存中…';

  let mt;
  if ($('useApi').checked) {
    const api = {
      provider: 'openai',
      base_url: $('baseUrl').value.trim() || 'https://api.openai.com/v1',
      api_key: $('apiKey').value.trim(),
      model: $('apiModel').value.trim() || 'gpt-4o-mini'
    };
    if (!api.api_key) {
      el.textContent = '请先填写 API Key';
      return;
    }
    mt = { realtime: api, quality: { ...api } };
  } else {
    mt = {
      realtime: optionToCfg($('realtimeModel').value, 'mt-opus-en-zh'),
      quality: optionToCfg($('qualityModel').value, 'mt-opus-en-zh')
    };
  }

  const res = await chrome.runtime.sendMessage({ type: 'CONFIG_SAVE', mt });
  if (res && res.ok) {
    el.textContent = '已保存';
    await load();
  } else {
    el.textContent = '保存失败：' + ((res && res.error) || '未知错误');
  }
}

/* ---------------- 启动 ---------------- */
$('ver').textContent = 'v' + chrome.runtime.getManifest().version;
$('diag').addEventListener('click', diagnose);
$('save').addEventListener('click', save);
$('useApi').addEventListener('change', () => {
  $('apiBox').hidden = !$('useApi').checked;
});
load();
