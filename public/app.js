const API = '/api';
const SESSION_KEY = 'linjiang_workshop_session_v1';
const LOCAL_WALLET_KEY = 'linjiang_workshop_local_tokens_v1';
const USED_CLAIMS_KEY = 'linjiang_workshop_used_claims_v1';
const BRIDGE_CHANNEL = 'linjiang-workshop:bridge';
const WORKSHOP_MODE = new URLSearchParams(location.search).get('mode') || '';
const SELECT_STREAMER_MODE = WORKSHOP_MODE === 'select-streamer';
const TYPE_LABEL = { streamer: '自定义主播', city_node: '城市节点', extension: '拓展' };

const state = {
  type: 'streamer',
  items: [],
  selected: null,
  session: loadJson(SESSION_KEY, null),
  user: null,
  bridge: { available: false, capabilities: {} },
  publishPackage: null,
  gameSources: [],
  extensionSections: [],
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const CITY_ARCHETYPE_LABEL = Object.freeze({
  living: '\u751f\u6d3b', residential: '\u5c45\u4f4f', commercial: '\u5546\u4e1a', entertainment: '\u5a31\u4e50',
  public: '\u516c\u5171', service: '\u670d\u52a1', adult: '\u6210\u4eba\u5411', private: '\u79c1\u5bc6',
});
const cityArchetypeLabel = (value) => CITY_ARCHETYPE_LABEL[String(value || '').trim().toLowerCase()] || String(value || '').trim();
const renderTags = (item) => (item.tags || []).map((tag) => `<em>${esc(item.itemType === 'city_node' ? cityArchetypeLabel(tag) : tag)}</em>`).join('');
const status = $('#status');
let toastTimer = 0;

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('on'), 2400);
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let extensionSectionSequence = 0;

function createExtensionSection(kind = 'content', value = {}) {
  const normalizedKind = kind === 'overview' ? 'overview' : 'content';
  const triggerWords = Array.isArray(value.triggerWords)
    ? value.triggerWords.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(value.triggerWords ?? value.trigger_words ?? '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  return {
    id: String(value.id || '').trim() || `extension-section-${Date.now()}-${++extensionSectionSequence}`,
    kind: normalizedKind,
    title: String(value.title || '').trim(),
    content: String(value.content ?? value.contentText ?? value.content_text ?? '').trim(),
    triggerWords: normalizedKind === 'content' ? (triggerWords.length ? triggerWords : ['']) : [],
  };
}

function normalizeExtensionSections(value, ensureDefault = false) {
  const source = Array.isArray(value) ? value : [];
  const sections = source.map((item) => createExtensionSection(item?.kind, item)).filter((item) => item.content || item.title || item.triggerWords.some(Boolean));
  if (!sections.length && ensureDefault) {
    return [createExtensionSection('overview'), createExtensionSection('content')];
  }
  return sections;
}

function renderExtensionSections() {
  const container = $('#extension-sections');
  if (!container) return;
  let blueCount = 0;
  let greenCount = 0;
  if (!state.extensionSections.length) {
    container.innerHTML = '<div class="extension-empty">还没有条目，请添加蓝灯或绿灯条目。</div>';
    return;
  }
  container.innerHTML = `<div class="extension-section-list">${state.extensionSections.map((section, index) => {
    const isBlue = section.kind === 'overview';
    const number = isBlue ? ++blueCount : ++greenCount;
    const label = isBlue ? `蓝灯条目 ${number}` : `绿灯条目 ${number}`;
    const icon = isBlue ? '✦' : '⚡';
    const triggers = isBlue ? '' : `<div class="extension-trigger-list"><small>触发词（绿灯条目至少填写 1 个）</small>${(section.triggerWords.length ? section.triggerWords : ['']).map((word, wordIndex) => `<div class="extension-trigger-row"><input data-extension-field="trigger" data-index="${index}" data-word-index="${wordIndex}" value="${esc(word)}" placeholder="触发词 ${wordIndex + 1}"><button type="button" class="secondary" data-extension-action="remove-trigger" data-index="${index}" data-word-index="${wordIndex}" aria-label="删除触发词">×</button></div>`).join('')}<div class="extension-trigger-actions"><button type="button" class="secondary" data-extension-action="add-trigger" data-index="${index}">＋ 添加触发词</button></div></div>`;
    return `<article class="extension-section-card ${isBlue ? 'is-blue' : 'is-green'}" data-extension-index="${index}"><div class="extension-section-top"><span class="extension-light-badge ${isBlue ? 'blue' : 'green'}">${icon} ${label}</span><div class="extension-section-actions"><button type="button" class="secondary" data-extension-action="move-up" data-index="${index}" aria-label="上移">↑</button><button type="button" class="secondary" data-extension-action="move-down" data-index="${index}" aria-label="下移">↓</button><button type="button" class="secondary" data-extension-action="remove" data-index="${index}" aria-label="删除条目">×</button></div></div><input data-extension-field="title" data-index="${index}" value="${esc(section.title)}" placeholder="条目标题（可选，用于识别这条世界书内容）"><textarea data-extension-field="content" data-index="${index}" rows="7" placeholder="${isBlue ? '填写常驻蓝灯内容' : '填写按触发词激活的绿灯内容'}">${esc(section.content)}</textarea>${triggers}</article>`;
  }).join('')}</div>`;
  container.querySelectorAll('[data-extension-field]').forEach((field) => field.addEventListener('input', () => {
    const index = Number(field.dataset.index);
    const section = state.extensionSections[index];
    if (!section) return;
    if (field.dataset.extensionField === 'trigger') {
      section.triggerWords[Number(field.dataset.wordIndex)] = field.value;
    } else {
      section[field.dataset.extensionField] = field.value;
    }
  }));
}

function addExtensionSection(kind) {
  state.extensionSections.push(createExtensionSection(kind));
  renderExtensionSections();
}

function moveExtensionSection(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= state.extensionSections.length) return;
  [state.extensionSections[index], state.extensionSections[next]] = [state.extensionSections[next], state.extensionSections[index]];
  renderExtensionSections();
}

function removeExtensionSection(index) {
  state.extensionSections.splice(index, 1);
  renderExtensionSections();
}

function addExtensionTrigger(index) {
  const section = state.extensionSections[index];
  if (!section || section.kind !== 'content') return;
  section.triggerWords = [...(section.triggerWords || []), ''];
  renderExtensionSections();
}

function removeExtensionTrigger(index, wordIndex) {
  const section = state.extensionSections[index];
  if (!section || section.kind !== 'content') return;
  section.triggerWords = section.triggerWords.filter((_, currentIndex) => currentIndex !== wordIndex);
  if (!section.triggerWords.length) section.triggerWords = [''];
  renderExtensionSections();
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.session?.token) headers.authorization = `Bearer ${state.session.token}`;
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function bridgeRequest(action, payload = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (window.parent === window) return reject(new Error('当前页面未连接游戏桥接'));
    const id = `ljw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('游戏桥接响应超时')); }, timeout);
    const onMessage = (event) => {
      const data = event.data;
      if (!data || data.channel !== BRIDGE_CHANNEL || data.kind !== 'response' || data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      data.ok ? resolve(data.payload) : reject(new Error(data.error || '游戏桥接执行失败'));
    };
    window.addEventListener('message', onMessage);
    const useOpeningBridge = SELECT_STREAMER_MODE && window.parent !== window
      && (action === 'listPublishSources' || action === 'exportPublishSource');
    const target = useOpeningBridge ? window.parent : (window.top || window.parent);
    target.postMessage({ channel: BRIDGE_CHANNEL, kind: 'request', id, action, payload }, '*');
  });
}

async function detectBridge() {
  try {
    const result = await bridgeRequest('handshake', {}, 1800);
    state.bridge = { available: true, capabilities: result.capabilities || {} };
    $('#bridge-state').textContent = '已连接当前游戏';
    $('#bridge-state').classList.add('connected');
  } catch {
    state.bridge = { available: false, capabilities: {} };
    $('#bridge-state').textContent = '独立网页模式';
  }
}

async function refreshAuth() {
  if (!state.session?.token) return paintAuth();
  try {
    const data = await api('/auth/me');
    if (data.authenticated) state.user = data.user;
    else clearSession();
  } catch {
    clearSession();
  }
  paintAuth();
}

function paintAuth() {
  const button = $('#login-button');
  if (state.user) {
    button.textContent = state.user.username;
    $('#wallet-button').textContent = `代币 ${state.user.tokenBalance || 0}`;
  } else {
    button.textContent = 'Discord 登录';
    $('#wallet-button').textContent = '代币 0';
  }
}

function clearSession() {
  state.session = null;
  state.user = null;
  localStorage.removeItem(SESSION_KEY);
}

function oauthStateFromUrl(authorizeUrl) {
  try { return new URL(authorizeUrl).searchParams.get('state') || ''; } catch { return ''; }
}

function waitForAuthResult(authorizeUrl, requestId = '') {
  const oauthState = oauthStateFromUrl(authorizeUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    let pollTimer = 0;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(pollTimer);
      window.removeEventListener('message', onMessage);
      error ? reject(error) : resolve(data);
    };
    const onMessage = (event) => {
      const data = event.data;
      if (!data || data.channel !== 'linjiang-workshop:auth' || event.origin !== location.origin) return;
      if (requestId && data.requestId !== requestId) return;
      if (!requestId && data.oauthState && data.oauthState !== oauthState) return;
      if (data.kind && data.kind !== 'response' && data.kind !== 'error') return;
      if (data.ok === false) finish(new Error(data.error || 'Discord ????'));
      else if (data.ok === true && data.sessionToken) finish(null, data);
    };
    const poll = async () => {
      if (settled || !oauthState) return;
      try {
        const response = await fetch(`${API}/auth/discord/poll?state=${encodeURIComponent(oauthState)}`);
        const data = await response.json().catch(() => ({}));
        if (data.result) return finish(data.result.ok === false ? new Error(data.result.error || 'Discord ????') : null, data.result);
      } catch {}
      if (!settled) pollTimer = setTimeout(poll, 700);
    };
    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish(new Error('????????')), 120000);
    poll();
  });
}

function requestHostLogin(authorizeUrl) {
  return new Promise((resolve, reject) => {
    const requestId = `ljw-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const wait = waitForAuthResult(authorizeUrl, requestId);
    const target = window.top || window.parent;
    target.postMessage({ channel: 'linjiang-workshop:auth', kind: 'request', action: 'openDiscordLogin', url: authorizeUrl, requestId }, '*');
    wait.then(resolve, reject);
  });
}

async function beginLogin() {
  if (state.user) {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession(); paintAuth(); toast('?????'); return;
  }
  const data = await api('/auth/discord/start', { method: 'POST', body: { returnOrigin: location.origin } });
  let result;
  if (window.parent !== window && state.bridge.available) {
    result = await requestHostLogin(data.authorizeUrl);
  } else {
    const wait = waitForAuthResult(data.authorizeUrl);
    const popup = window.open(data.authorizeUrl, 'linjiang_workshop_discord', 'width=620,height=820,scrollbars=yes,resizable=yes');
    if (!popup) throw new Error('?????????? Discord ??');
    result = await wait;
  }
  state.session = { token: result.sessionToken, expiresAt: result.expiresAt };
  saveJson(SESSION_KEY, state.session);
  await refreshAuth();
  await loadItems();
  toast(`???${state.user?.username || result.user?.username || '???'}`);
}

async function loadItems(page = state.page) {  status.textContent = '\u6b63\u5728\u8bfb\u53d6\u5de5\u574a\u2026\u2026';  try {    const q = new URLSearchParams({ type: state.type, sort: $('#sort').value, page: String(page), pageSize: String(state.pageSize) });    const search = $('#search').value.trim();    if (search) q.set('q', search);    const data = await api(`/items?${q}`);    state.items = data.items || [];    state.page = Number(data.page || page) || 1;    state.pageSize = Number(data.pageSize || state.pageSize) || 12;    state.total = Number(data.total || state.items.length) || 0;    state.totalPages = Number(data.totalPages || Math.max(1, Math.ceil(state.total / state.pageSize))) || 1;    paintItems();    paintPagination();    const first = state.total ? ((state.page - 1) * state.pageSize + 1) : 0;    const last = state.total ? Math.min(state.total, state.page * state.pageSize) : 0;    status.textContent = state.total ? `\u6d4f\u89c8${TYPE_LABEL[state.type]}` : `\u8fd8\u6ca1\u6709${TYPE_LABEL[state.type]}\u4f5c\u54c1`;  } catch (error) {    status.textContent = `\u8bfb\u53d6\u5931\u8d25\uff1a${error.message}`;    state.total = 0; state.totalPages = 0;    $('#grid').innerHTML = '<div class="empty">\u5de5\u574a\u6682\u65f6\u6ca1\u6709\u8fd4\u56de\u5185\u5bb9</div>';    paintPagination();  }}function paintItems() {
  const grid = $('#grid');
  if (!state.items.length) {
    grid.innerHTML = `<div class="empty">\u8fd9\u91cc\u8fd8\u6ca1\u6709${TYPE_LABEL[state.type]}\u4f5c\u54c1\u3002\u767b\u5f55\u540e\u53d1\u5e03\u7b2c\u4e00\u4ef6\u5427</div>`;
    return;
  }
  grid.innerHTML = state.items.map((item) => `
    <article class="work-card" data-item-id="${esc(item.id)}">
      <div class="cover">${item.coverUrl ? `<img src="${esc(item.coverUrl)}" alt="" loading="lazy" data-hide-on-error>` : `<div class="cover-fallback">${item.itemType === 'streamer' ? '\u2662' : item.itemType === 'city_node' ? '\u2316' : '\u2726'}</div>`}<span class="type-badge">${TYPE_LABEL[item.itemType]}</span></div>
      <div class="card-body"><h3>${esc(item.title)}</h3><p>${esc(item.summary || '\u4f5c\u8005\u6ca1\u6709\u586b\u5199\u7b80\u4ecb')}</p>
      <div class="tags">${renderTags(item)}</div>
      <div class="card-meta"><span class="card-author"><i class="meta-icon author-icon" aria-hidden="true">\u270e</i><b>${esc(item.authorName || '\u533f\u540d\u4f5c\u8005')}</b></span><span class="card-stat like-stat"><i class="meta-icon" aria-hidden="true">${item.liked ? '\u2665' : '\u2661'}</i><b>${item.likeCount || 0}</b></span><span class="card-stat adopt-stat"><i class="meta-icon" aria-hidden="true">\u21e9</i><b>${item.downloadCount || 0}</b></span></div></div>
    </article>`).join('');
  grid.querySelectorAll('[data-hide-on-error]').forEach((image) => image.addEventListener('error', () => image.remove()));
}

function paintPagination() {
  const node = $('#pagination');
  const summary = $('#pagination-summary');
  if (!node) return;
  if (summary) summary.textContent = state.total ? `\u5171 ${state.total} \u4ef6\u4f5c\u54c1${state.totalPages > 1 ? ` \u00b7 \u7b2c ${state.page} / ${state.totalPages} \u9875` : ''}` : '';
  if (state.totalPages <= 1) { node.innerHTML = ''; return; }
  const pages = new Set([1, state.totalPages, state.page, state.page - 1, state.page + 1]);
  const visible = [...pages].filter((page) => page >= 1 && page <= state.totalPages).sort((a, b) => a - b);
  const parts = [];
  visible.forEach((page, index) => {
    if (index && page - visible[index - 1] > 1) parts.push('<span class="pagination-gap">\u2026</span>');
    parts.push(`<button type="button" class="${page === state.page ? 'active' : ''}" data-page="${page}" aria-current="${page === state.page ? 'page' : 'false'}">${page}</button>`);
  });
  node.innerHTML = `<button type="button" class="pagination-arrow" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>\u4e0a\u4e00\u9875</button>${parts.join('')}<button type="button" class="pagination-arrow" data-page="${state.page + 1}" ${state.page >= state.totalPages ? 'disabled' : ''}>\u4e0b\u4e00\u9875</button>`;
}

function sendSelectionToParent(item) {
  if (window.parent === window) return false;
  const target = item?.package || item;
  window.parent.postMessage({
    channel: 'linjiang-workshop:select',
    kind: 'event',
    type: 'package',
    package: target,
  }, '*');
  return true;
}

function extensionDetailMarkup(item) {
  const sections = normalizeExtensionSections(item?.package?.data?.sections || item?.package?.data?.contentSections || []);
  if (!sections.length) return '<p class="extension-detail-empty">这组拓展还没有可展示的世界书条目。</p>';
  let blue = 0;
  let green = 0;
  return `<div class="extension-detail-list">${sections.map((section) => {
    const isBlue = section.kind === 'overview';
    const number = isBlue ? ++blue : ++green;
    const label = isBlue ? `蓝灯条目 ${number}` : `绿灯条目 ${number}`;
    const triggerMarkup = isBlue ? '' : `<div class="extension-detail-triggers"><small>触发词</small>${section.triggerWords.map((word) => `<em>${esc(word)}</em>`).join('')}</div>`;
    return `<article class="extension-detail-entry ${isBlue ? 'is-blue' : 'is-green'}"><header><span class="extension-light-badge ${isBlue ? 'blue' : 'green'}">${isBlue ? '✦' : '⚡'} ${label}</span>${section.title ? `<b>${esc(section.title)}</b>` : ''}</header><div class="extension-detail-content">${esc(section.content)}</div>${triggerMarkup}</article>`;
  }).join('')}</div>`;
}

async function selectStreamerToOpening() {
  const item = state.selected;
  if (!item || item.itemType !== 'streamer') return;
  if (!state.user) { await beginLogin(); return; }
  if (!sendSelectionToParent(item)) {
    toast('当前页面未连接开局页');
    return;
  }
  let install = null;
  try {
    install = await api(`/items/${encodeURIComponent(item.id)}/install`, { method: 'POST', body: { result: { mode: 'opening-selection' } } });
  } catch (error) {
    console.warn('[临江工坊] 记录主播采用失败', error);
  }
  const reason = install?.counted
    ? '采用量已增加 1'
    : install?.reason === 'self_install'
      ? '作者自己应用，不计入采用量'
      : install?.reason === 'already_installed'
        ? '这个账号已经采用过，不重复计数'
        : '已发送到开局页';
  $('#detail-dialog').close();
  toast(`已发送主播到开局页 · ${reason}`);
}

function openDetail(item) {
  state.selected = item;
  const pkg = item.package || {};
  const data = pkg.data || {};
  const profile = item.itemType === 'streamer' ? String(data.profileYaml || data.yaml || '').trim() : '';
  const extensionSections = item.itemType === 'extension' ? normalizeExtensionSections(data.sections || []) : [];
  const specifics = item.itemType === 'streamer'
    ? (data.handle && data.handle !== data.name ? `<p>主播网名 · ${esc(data.handle)}</p>` : '')
    : item.itemType === 'city_node'
      ? `<div class="node-facts"><p><small>位置</small><b>${esc(data.district)} · ${esc(data.name)}</b></p><p><small>类型</small><b>${esc(cityArchetypeLabel(data.archetype))}</b></p><p><small>私密度</small><b>${Number(data.privacy || 0)} / 5</b></p><p><small>接驳</small><b>${esc(data.placement?.anchorName || data.placement?.anchorId || '未设置')} · ${Number(data.placement?.accessKm || 0)} km</b></p></div>`
      : `<div class="extension-facts"><span><small>蓝灯条目</small><b>${extensionSections.filter((section) => section.kind === 'overview').length}</b></span><span><small>绿灯条目</small><b>${extensionSections.filter((section) => section.kind === 'content').length}</b></span></div>`;
  const persona = profile
    ? `<details class="detail-section persona-section" open><summary><span>人设档案</span><small>展开</small></summary><pre>${esc(profile)}</pre></details>`
    : '';
  const extensionDetails = item.itemType === 'extension'
    ? `<section class="detail-section extension-detail-section"><div class="section-heading"><i>✦</i> 世界书条目组</div>${extensionDetailMarkup(item)}</section>`
    : '';
  $('#detail-content').innerHTML = `
    ${item.coverUrl ? `<img class="detail-cover" src="${esc(item.coverUrl)}" alt="">` : ''}
    <span class="eyebrow">${TYPE_LABEL[item.itemType]}</span><h2>${esc(item.title)}</h2>
    <p class="detail-summary">${esc(item.summary || '作者没有填写简介')}</p>
    <div class="detail-metrics"><div class="metric metric-author"><i class="metric-icon author-icon" aria-hidden="true">✎</i><span><small>作者</small><b>${esc(item.authorName || '匿名作者')}</b></span></div><div class="metric metric-like"><i class="metric-icon" aria-hidden="true">${item.liked ? '♥' : '♡'}</i><span><small>喜欢</small><b>${item.likeCount || 0}</b></span></div><div class="metric metric-adopt"><i class="metric-icon" aria-hidden="true">⇩</i><span><small>采用</small><b>${item.downloadCount || 0}</b></span></div></div>
    <div class="detail-specifics">${specifics}</div>
    ${extensionDetails}
    ${persona}
    <div class="tags">${renderTags(item)}</div>
    <div class="detail-actions">
      <div class="detail-main-actions">
        ${SELECT_STREAMER_MODE && item.itemType === 'streamer' ? '<button class="primary" data-detail-action="select">选择此主播</button>' : ''}
        <button class="primary" data-detail-action="install">${state.bridge.available ? '应用到当前游戏' : '导出 JSON'}</button>
      </div>
      <div class="detail-utility-actions">
        <button class="utility-button like-button ${item.liked ? 'is-liked' : ''}" data-detail-action="like" aria-pressed="${item.liked ? 'true' : 'false'}"><span class="like-icon" aria-hidden="true">${item.liked ? '♥' : '♡'}</span><span>${item.liked ? '取消喜欢' : '喜欢'}</span><b>${item.likeCount || 0}</b></button>
        <button class="utility-button" data-detail-action="download">⇩ 导出 JSON</button>
      </div>
    </div>`;
  $('#detail-dialog').showModal();
}

async function installSelected() {
  const item = state.selected;
  if (!item) return;
  if (!state.bridge.available) return downloadSelected();
  if (!state.user) { await beginLogin(); return; }
  try {
    const result = await bridgeRequest('installItem', { item }, item.itemType === 'city_node' ? 45000 : 20000);
    const install = await api(`/items/${encodeURIComponent(item.id)}/install`, { method: 'POST', body: { result: result || {} } });
    const reason = install.counted
      ? '采用量已增加 1'
      : install.reason === 'self_install'
        ? '作者自己应用，不计入采用量'
        : '这个账号已经采用过，不重复计数';
    toast(`${item.itemType === 'streamer' ? '主播已导入当前游戏' : item.itemType === 'city_node' ? '城市节点已写入当前存档' : '拓展已写入世界书'} · ${reason}`);
    if (install.item) state.selected = install.item;
    await loadItems();
    $('#detail-dialog').close();
  } catch (error) { toast(error.message); }
}

function downloadSelected() {
  if (!state.selected) return;
  const link = document.createElement('a');
  link.href = `${API}/items/${encodeURIComponent(state.selected.id)}/download`;
  link.download = `${state.selected.title}.json`;
  link.click();
}

async function toggleLike() {
  if (!state.selected) return;
  if (!state.user) { await beginLogin(); return; }
  try {
    const data = await api(`/items/${encodeURIComponent(state.selected.id)}/like`, { method: 'POST', body: {} });
    state.selected = data.item;
    const index = state.items.findIndex((item) => item.id === data.item.id);
    if (index >= 0) state.items[index] = data.item;
    paintItems(); openDetail(data.item);
  } catch (error) { toast(error.message); }
}

function openPublish() {
  if (!state.user) { beginLogin().catch((error) => toast(error.message)); return; }
  state.publishPackage = null;
  state.gameSources = [];
  state.extensionSections = [];
  $('#publish-form').reset();
  $('#publish-type').value = state.type;
  $('#publish-json').value = '';
  $('#local-source-row').hidden = true;
  syncExtensionFields();
  $('#publish-dialog').showModal();
}

function syncExtensionFields() {
  const isExtension = $('#publish-type').value === 'extension';
  $('#extension-fields').hidden = !isExtension;
  $('#publish-source').hidden = isExtension;
  $('#local-source-row').hidden = isExtension || !state.gameSources.length;
  $('#package-preview').hidden = isExtension;
  if (isExtension) {
    if (!state.extensionSections.length) state.extensionSections = normalizeExtensionSections([], true);
    renderExtensionSections();
  }
}

async function readGameSource() {
  if ($('#publish-type').value === 'extension') return toast('拓展请直接编辑世界书条目组');
  if (!state.bridge.available) return toast('独立网页模式请导入 JSON');
  try {
    const type = $('#publish-type').value;
    const result = await bridgeRequest('listPublishSources', { itemType: type }, 10000);
    state.gameSources = result.sources || [];
    const select = $('#local-source');
    select.innerHTML = state.gameSources.map((source, index) => `<option value="${index}">${esc(source.label || source.title || `内容 ${index + 1}`)}</option>`).join('');
    $('#local-source-row').hidden = !state.gameSources.length;
    if (state.gameSources.length) await chooseGameSource(0);
    else toast('当前游戏中没有可发布的此类内容');
  } catch (error) { toast(error.message); }
}

async function chooseGameSource(index) {
  const source = state.gameSources[Number(index)];
  if (!source) return;
  const result = await bridgeRequest('exportPublishSource', { itemType: $('#publish-type').value, sourceId: source.id }, 10000);
  setPublishPackage(result.package || result);
}

function setPublishPackage(pkg) {
  state.publishPackage = pkg;
  const type = pkg.itemType || pkg.type || 'streamer';
  $('#publish-type').value = type;
  $('#publish-title').value = pkg.title || pkg.data?.name || '';
  $('#publish-summary').value = pkg.summary || '';
  $('#publish-tags').value = Array.isArray(pkg.tags) ? pkg.tags.join('，') : '';
  $('#publish-cover').value = pkg.coverUrl || pkg.data?.assets?.cover || '';
  if (type === 'extension') {
    state.extensionSections = normalizeExtensionSections(pkg.data?.sections || [], false);
    $('#publish-json').value = '';
  } else {
    state.extensionSections = [];
    $('#publish-json').value = JSON.stringify(pkg, null, 2);
  }
  syncExtensionFields();
}

async function readPublishFile(file) {
  try {
    const pkg = JSON.parse(await file.text());
    setPublishPackage(pkg);
  } catch (error) { toast(`JSON 读取失败：${error.message}`); }
}

function packageFromForm() {
  const type = $('#publish-type').value;
  if (type === 'extension') {
    const sections = normalizeExtensionSections(state.extensionSections).map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      content: section.content.trim(),
      triggerWords: section.kind === 'content' ? section.triggerWords.map((word) => word.trim()).filter(Boolean) : [],
    })).filter((section) => section.content);
    if (!sections.length) throw new Error('请至少添加一个蓝灯或绿灯条目，并填写正文');
    if (sections.some((section) => section.kind === 'content' && !section.triggerWords.length)) throw new Error('每个绿灯条目至少填写一个触发词');
    const pkg = state.publishPackage?.itemType === 'extension' ? structuredClone(state.publishPackage) : {
      schema: 'linjiang.workshop.package', schemaVersion: 1, game: 'linjiang', itemType: 'extension',
      data: { sections: [], position: { type: 'after_character_definition', depth: 0, order: 420 } },
    };
    pkg.itemType = 'extension';
    pkg.data = { ...(pkg.data || {}), sections, position: pkg.data?.position || { type: 'after_character_definition', depth: 0, order: 420 } };
    pkg.title = $('#publish-title').value.trim();
    pkg.summary = $('#publish-summary').value.trim();
    pkg.tags = $('#publish-tags').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    pkg.coverUrl = $('#publish-cover').value.trim();
    return pkg;
  }
  const pkg = state.publishPackage ? structuredClone(state.publishPackage) : null;
  if (!pkg) throw new Error('请先从游戏读取内容或导入作品 JSON');
  pkg.itemType = type;
  pkg.title = $('#publish-title').value.trim();
  pkg.summary = $('#publish-summary').value.trim();
  pkg.tags = $('#publish-tags').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  pkg.coverUrl = $('#publish-cover').value.trim();
  return pkg;
}

async function submitPublish(event) {
  event.preventDefault();
  const output = $('#publish-status');
  try {
    const pkg = packageFromForm();
    output.textContent = '正在发布……';
    const data = await api('/items', { method: 'POST', body: pkg });
    output.textContent = `发布成功：${data.item.title}`;
    $('#publish-dialog').close();
    state.type = data.item.itemType;
    syncTabs();
    await loadItems();
    openDetail(data.item);
  } catch (error) { output.textContent = error.message; }
}

async function openWallet() {
  if (!state.user) { await beginLogin(); return; }
  $('#wallet-dialog').showModal();
  await refreshWallet();
}

async function refreshWallet() {
  const local = loadJson(LOCAL_WALLET_KEY, { balance: 0 });
  $('#local-balance').textContent = Number(local.balance || 0);
  try {
    const data = await api('/me/wallet');
    $('#cloud-balance').textContent = data.wallet.available;
    $('#earned-total').textContent = data.wallet.earnedTotal;
    $('#claim-button').disabled = !data.wallet.available;
  } catch (error) { $('#wallet-status').textContent = error.message; }
}

async function claimWallet() {
  const output = $('#wallet-status');
  try {
    const data = await api('/me/claims', { method: 'POST', body: {} });
    if (state.bridge.available) await bridgeRequest('claimTokens', { claim: data.claim }, 10000);
    const used = new Set(loadJson(USED_CLAIMS_KEY, []));
    if (!used.has(data.claim.claimId)) {
      const wallet = loadJson(LOCAL_WALLET_KEY, { balance: 0, claims: [] });
      wallet.balance = Number(wallet.balance || 0) + Number(data.claim.amount || 0);
      wallet.claims = [...(wallet.claims || []), data.claim.claimId].slice(-500);
      saveJson(LOCAL_WALLET_KEY, wallet);
      used.add(data.claim.claimId); saveJson(USED_CLAIMS_KEY, [...used]);
    }
    output.textContent = `已领取 ${data.claim.amount} 枚代币`;
    await refreshAuth(); await refreshWallet();
  } catch (error) { output.textContent = error.message; }
}

function syncTabs() {
  $('#tabs').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.type === state.type));
}

$('#tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-type]');
  if (!button) return;
  state.type = button.dataset.type; state.page = 1; syncTabs(); loadItems();
});
$('#grid').addEventListener('click', (event) => { const card = event.target.closest('[data-item-id]'); if (card) openDetail(state.items.find((item) => item.id === card.dataset.itemId)); });
$('#detail-content').addEventListener('click', (event) => {
  const action = event.target.closest('[data-detail-action]')?.dataset.detailAction;
  if (action === 'select') {
    selectStreamerToOpening().catch((error) => toast(error.message));
    return;
  }
  if (action === 'install') installSelected();
  if (action === 'download') downloadSelected();
  if (action === 'like') toggleLike();
});
$('#publish-button').addEventListener('click', openPublish);
$('#login-button').addEventListener('click', () => beginLogin().catch((error) => toast(error.message)));
$('#wallet-button').addEventListener('click', () => openWallet().catch((error) => toast(error.message)));
$('#claim-button').addEventListener('click', claimWallet);
$('#read-game-source').addEventListener('click', readGameSource);
$('#local-source').addEventListener('change', (event) => chooseGameSource(event.target.value));
$('#publish-file').addEventListener('change', (event) => event.target.files?.[0] && readPublishFile(event.target.files[0]));
$('#publish-type').addEventListener('change', () => {
  const type = $('#publish-type').value;
  if (type === 'extension') {
    state.publishPackage = state.publishPackage?.itemType === 'extension' ? state.publishPackage : null;
    state.extensionSections = normalizeExtensionSections(state.publishPackage?.data?.sections || [], true);
  } else {
    state.publishPackage = state.publishPackage?.itemType === type ? state.publishPackage : null;
    state.extensionSections = [];
  }
  syncExtensionFields();
});
$('#add-blue-entry').addEventListener('click', () => addExtensionSection('overview'));
$('#add-green-entry').addEventListener('click', () => addExtensionSection('content'));
$('#extension-sections').addEventListener('click', (event) => {
  const button = event.target.closest('[data-extension-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  const action = button.dataset.extensionAction;
  if (action === 'move-up') moveExtensionSection(index, -1);
  if (action === 'move-down') moveExtensionSection(index, 1);
  if (action === 'remove') removeExtensionSection(index);
  if (action === 'add-trigger') addExtensionTrigger(index);
  if (action === 'remove-trigger') removeExtensionTrigger(index, Number(button.dataset.wordIndex));
});
$('#publish-form').addEventListener('submit', submitPublish);
$('#search').addEventListener('input', debounce(() => { state.page = 1; loadItems(); }, 250));
$('#sort').addEventListener('change', () => { state.page = 1; loadItems(); });
$('#pagination').addEventListener('click', (event) => { const button = event.target.closest('[data-page]'); if (!button || button.disabled) return; state.page = Number(button.dataset.page) || 1; loadItems(state.page); });
document.addEventListener('click', (event) => { const id = event.target.closest('[data-close]')?.dataset.close; if (id) document.getElementById(id)?.close(); });

document.querySelectorAll('dialog.dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

await Promise.all([detectBridge(), refreshAuth()]);
await loadItems();
