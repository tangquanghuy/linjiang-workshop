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

function openDetail(item) {
  state.selected = item;
  const pkg = item.package || {};
  const data = pkg.data || {};
  const profile = item.itemType === 'streamer' ? String(data.profileYaml || data.yaml || '').trim() : '';
  const specifics = item.itemType === 'streamer'
    ? (data.handle && data.handle !== data.name ? `<p>\u4e3b\u64ad\u7f51\u540d \u00b7 ${esc(data.handle)}</p>` : '')
    : item.itemType === 'city_node'
      ? `<div class="node-facts"><p><small>\u4f4d\u7f6e</small><b>${esc(data.district)} \u00b7 ${esc(data.name)}</b></p><p><small>\u7c7b\u578b</small><b>${esc(cityArchetypeLabel(data.archetype))}</b></p><p><small>\u79c1\u5bc6\u5ea6</small><b>${Number(data.privacy || 0)} / 5</b></p><p><small>\u63a5\u9a73</small><b>${esc(data.placement?.anchorName || data.placement?.anchorId || '\u672a\u8bbe\u7f6e')} \u00b7 ${Number(data.placement?.accessKm || 0)} km</b></p></div>`
      : `<p>${Number(data.sections?.length || 0)} \u4e2a\u5185\u5bb9\u533a\u5757</p>`;
  const persona = profile
    ? `<details class="detail-section persona-section" open><summary><span>\u4eba\u8bbe\u6863\u6848</span><small>\u5c55\u5f00</small></summary><pre>${esc(profile)}</pre></details>`
    : '';
  $('#detail-content').innerHTML = `
    ${item.coverUrl ? `<img class="detail-cover" src="${esc(item.coverUrl)}" alt="">` : ''}
    <span class="eyebrow">${TYPE_LABEL[item.itemType]}</span><h2>${esc(item.title)}</h2>
    <p class="detail-summary">${esc(item.summary || '\u4f5c\u8005\u6ca1\u6709\u586b\u5199\u7b80\u4ecb')}</p>
    <div class="detail-metrics"><div class="metric metric-author"><i class="metric-icon author-icon" aria-hidden="true">\u270e</i><span><small>\u4f5c\u8005</small><b>${esc(item.authorName || '\u533f\u540d\u4f5c\u8005')}</b></span></div><div class="metric metric-like"><i class="metric-icon" aria-hidden="true">${item.liked ? '\u2665' : '\u2661'}</i><span><small>\u559c\u6b22</small><b>${item.likeCount || 0}</b></span></div><div class="metric metric-adopt"><i class="metric-icon" aria-hidden="true">\u21e9</i><span><small>\u91c7\u7528</small><b>${item.downloadCount || 0}</b></span></div></div>
    <div class="detail-specifics">${specifics}</div>
    ${persona}
    <div class="tags">${renderTags(item)}</div>
    <div class="detail-actions">
      <div class="detail-main-actions">
        ${SELECT_STREAMER_MODE && item.itemType === 'streamer' ? '<button class="primary" data-detail-action="select">\u9009\u62e9\u6b64\u4e3b\u64ad</button>' : ''}
        <button class="primary" data-detail-action="install">${state.bridge.available ? '\u5b89\u88c5\u5230\u5f53\u524d\u6e38\u620f' : '\u4e0b\u8f7d JSON'}</button>
      </div>
      <div class="detail-utility-actions">
        <button class="utility-button like-button ${item.liked ? 'is-liked' : ''}" data-detail-action="like" aria-pressed="${item.liked ? 'true' : 'false'}"><span class="like-icon" aria-hidden="true">${item.liked ? '\u2665' : '\u2661'}</span><span>${item.liked ? '\u53d6\u6d88\u559c\u6b22' : '\u559c\u6b22'}</span><b>${item.likeCount || 0}</b></button>
        <button class="utility-button" data-detail-action="download">\u21e9 \u5bfc\u51fa JSON</button>
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
    await api(`/items/${encodeURIComponent(item.id)}/install`, { method: 'POST', body: { result: result || {} } });
    toast(item.itemType === 'streamer' ? '主播已按开局自定义主播结构导入' : item.itemType === 'city_node' ? '城市节点已写入当前存档' : '拓展已写入世界书');
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
  $('#publish-form').reset();
  $('#publish-type').value = state.type;
  $('#publish-json').value = '';
  $('#local-source-row').hidden = true;
  syncExtensionFields();
  $('#publish-dialog').showModal();
}

function syncExtensionFields() {
  $('#extension-fields').hidden = $('#publish-type').value !== 'extension';
}

async function readGameSource() {
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
  $('#publish-type').value = pkg.itemType || pkg.type || 'streamer';
  $('#publish-title').value = pkg.title || pkg.data?.name || '';
  $('#publish-summary').value = pkg.summary || '';
  $('#publish-tags').value = Array.isArray(pkg.tags) ? pkg.tags.join('，') : '';
  $('#publish-cover').value = pkg.coverUrl || pkg.data?.assets?.cover || '';
  $('#publish-json').value = JSON.stringify(pkg, null, 2);
  syncExtensionFields();
}

async function readPublishFile(file) {
  try {
    const pkg = JSON.parse(await file.text());
    setPublishPackage(pkg);
  } catch (error) { toast(`JSON 读取失败：${error.message}`); }
}

function packageFromForm() {
  let pkg = state.publishPackage ? structuredClone(state.publishPackage) : null;
  const type = $('#publish-type').value;
  if (!pkg && type === 'extension') {
    pkg = { schema: 'linjiang.workshop.package', schemaVersion: 1, game: 'linjiang', itemType: 'extension', data: {
      sections: [{ id: 'content-1', kind: 'content', content: $('#extension-content').value, triggerWords: $('#extension-triggers').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }],
      position: { type: 'after_character_definition', depth: 0, order: 420 },
    } };
  }
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
    if (state.selected?.itemType !== 'streamer' || !sendSelectionToParent(state.selected)) toast('当前页面未连接开局页'); else { $('#detail-dialog').close(); toast('已发送主播到开局页'); }
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
$('#publish-type').addEventListener('change', syncExtensionFields);
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
