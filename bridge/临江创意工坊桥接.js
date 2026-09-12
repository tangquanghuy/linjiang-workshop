// ==UserScript==
// @name         临江创意工坊桥接
// @namespace    linjiang.workshop
// @version      0.1.5
// @description  在酒馆内打开临江创意工坊，并负责主播、城市节点、拓展与本地代币写入
// @match        */*
// @grant        none
// @noframes
// ==/UserScript==
;(function () {
  'use strict';

  const SCRIPT_KEY = '__linjiangWorkshopBridgeV1';
  const BRIDGE_VERSION = 'bridge-20260912-city-detail-fields-v1';
  if (window[SCRIPT_KEY]) return;
  window[SCRIPT_KEY] = true;

  const TARGET_URL = String(window.LINJIANG_WORKSHOP_URL || 'https://workshop.rown.dpdns.org/?embed=1');
  const TARGET_ORIGIN = (() => { try { return new URL(TARGET_URL).origin; } catch { return ''; } })();
  const CHANNEL = 'linjiang-workshop:bridge';
  const PANEL_ID = 'linjiang-workshop-panel';
  const BUTTON_EVENT_NAME = '创意工坊';
  const PREFIX = '🧩mod ';
  const START_NAME = '--/Mod开始';
  const END_NAME = '--/Mod结束';
  const START_ORDER = 400;
  const END_ORDER = 500;
  const MAP_REVISION = '20260912-custom-location-detail-v1';

  const wins = () => {
    const list = [];
    for (const candidate of [window, window.parent, window.top]) {
      try { if (candidate && !list.includes(candidate)) list.push(candidate); } catch {}
    }
    return list;
  };
  const hostWindow = () => wins().find((win) => { try { return win.document?.body && win === window.top; } catch { return false; } }) || window;
  const hostDocument = () => hostWindow().document || document;
  const clean = (value, max = 10000) => String(value ?? '').trim().slice(0, max);
  const cleanLabel = (value) => clean(value, 48).replace(/[\r\n｜|]+/g, ' ').replace(/\s+/g, ' ').trim() || '匿名作者';
  const remote = (value) => /^https?:\/\//i.test(clean(value, 2000)) ? clean(value, 2000) : '';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function getMvu() {
    for (const win of wins()) {
      try { if (win.Mvu?.getMvuData && win.Mvu?.replaceMvuData) return win.Mvu; } catch {}
    }
    return null;
  }

  function readMvu() {
    const mvu = getMvu();
    if (!mvu) throw new Error('MVU 尚未就绪');
    const data = mvu.getMvuData({ type: 'message', message_id: 'latest' });
    if (!data?.stat_data) throw new Error('当前消息没有 MVU 数据');
    return { mvu, data, stat: data.stat_data };
  }

  function saveMvu(context) {
    context.mvu.replaceMvuData(context.data, { type: 'message', message_id: 'latest' });
  }

  function helperCandidates() {
    const output = [];
    for (const win of wins()) {
      try {
        for (const helper of [win, win.TavernHelper]) {
          if (helper && !output.includes(helper)) output.push(helper);
        }
      } catch {}
    }
    return output;
  }

  function getWorldbookHelper() {
    return helperCandidates().find((helper) => typeof helper.updateWorldbookWith === 'function'
      || typeof helper.createWorldbookEntries === 'function'
      || typeof helper.getWorldbook === 'function') || null;
  }

  async function targetWorldbookName(helper) {
    if (!helper) return '';
    try {
      const names = typeof helper.getCharWorldbookNames === 'function' ? await helper.getCharWorldbookNames('current') : null;
      if (names?.primary) return names.primary;
      if (Array.isArray(names?.additional) && names.additional[0]) return names.additional[0];
    } catch {}
    for (const name of ['getOrCreateChatWorldbook', 'getOrCreateChatLorebook']) {
      try { if (typeof helper[name] === 'function') return await helper[name]('current'); } catch {}
    }
    return '';
  }

  async function readWorldbook(helper, bookName) {
    for (const name of ['getWorldbook', 'getLorebookEntries']) {
      try {
        if (typeof helper?.[name] === 'function') {
          const rows = await helper[name](bookName);
          if (Array.isArray(rows)) return rows;
        }
      } catch {}
    }
    return [];
  }

  function boundaryEntry(name, order) {
    return {
      name, comment: name, enabled: true, keys: [], key: [], content: '',
      strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: 'after_character_definition', role: 'system', depth: 0, order },
      probability: 100,
      recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    };
  }

  function ensureBoundaries(entries) {
    const next = (Array.isArray(entries) ? entries : []).filter((entry, index, all) => {
      if (entry?.name !== START_NAME && entry?.name !== END_NAME) return true;
      return all.findIndex((candidate) => candidate?.name === entry.name) === index;
    });
    if (!next.some((entry) => entry?.name === START_NAME)) next.push(boundaryEntry(START_NAME, START_ORDER));
    if (!next.some((entry) => entry?.name === END_NAME)) next.push(boundaryEntry(END_NAME, END_ORDER));
    return next;
  }

  function reorderManaged(entries) {
    const next = ensureBoundaries(entries);
    const managed = next.filter((entry) => clean(entry?.name).startsWith(PREFIX))
      .sort((a, b) => Number(a?.position?.order || 0) - Number(b?.position?.order || 0));
    managed.forEach((entry, index) => {
      entry.position = { ...(entry.position || {}), type: entry.position?.type || 'after_character_definition', role: 'system', depth: Number(entry.position?.depth || 0), order: Math.min(END_ORDER - 1, START_ORDER + 1 + index) };
    });
    const start = next.find((entry) => entry?.name === START_NAME);
    const end = next.find((entry) => entry?.name === END_NAME);
    start.position = { ...(start.position || {}), type: 'after_character_definition', role: 'system', depth: 0, order: START_ORDER };
    end.position = { ...(end.position || {}), type: 'after_character_definition', role: 'system', depth: 0, order: END_ORDER };
    return next;
  }

  async function updateWorldbook(mutator) {
    const helper = getWorldbookHelper();
    const bookName = await targetWorldbookName(helper);
    if (!helper || !bookName) throw new Error('当前角色没有可写入的世界书');
    if (typeof helper.updateWorldbookWith === 'function') {
      await helper.updateWorldbookWith(bookName, (entries) => mutator(Array.isArray(entries) ? entries : []), { render: 'immediate' });
      return bookName;
    }
    throw new Error('当前世界书接口缺少 updateWorldbookWith');
  }

  async function currentWorldbookEntries() {
    const helper = getWorldbookHelper();
    const name = await targetWorldbookName(helper);
    return name ? readWorldbook(helper, name) : [];
  }

  function streamerEntryName(pkg) {
    return `${PREFIX}主播人设｜${clean(pkg?.data?.name, 40)}｜${cleanLabel(pkg?.authorName)}`;
  }

  function extensionEntryBase(pkg) {
    return `${PREFIX}拓展｜${clean(pkg?.title, 80)}｜${cleanLabel(pkg?.authorName)}`;
  }

  function managedEntry(name, content, keys, position = {}) {
    const normalizedKeys = [...new Set((keys || []).map((value) => clean(value, 80)).filter(Boolean))];
    return {
      name, comment: name, enabled: true, keys: normalizedKeys, key: normalizedKeys, content: clean(content, 100000),
      strategy: { type: normalizedKeys.length ? 'selective' : 'constant', keys: normalizedKeys, keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: position.type || 'after_character_definition', role: 'system', depth: Math.max(0, Number(position.depth || 0)), order: Math.max(START_ORDER + 1, Math.min(END_ORDER - 1, Number(position.order || 420))) },
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    };
  }

  function streamScale(tierValue) {
    const tier = Math.min(100, Math.max(0, Number(tierValue) || 0));
    const roundNice = (raw) => { const value = Math.max(0, Math.round(raw || 0)); if (value >= 100000) return Math.round(value / 1000) * 1000; if (value >= 10000) return Math.round(value / 100) * 100; if (value >= 1000) return Math.round(value / 10) * 10; return value; };
    const base = 50 * Math.pow(8, tier / 25);
    const followers = base * (60 - 0.42 * tier);
    const guards = followers * (0.0012 + 0.000038 * tier);
    return { tier, followers: roundNice(followers), base: roundNice(base), guards: roundNice(guards), admirals: Math.max(0, Math.floor((guards - 40) / 24)), governors: Math.max(0, Math.floor((guards - 300) / 260)) };
  }

  function emptyExperience() {
    const item = () => ({ 次数: 0, 可更新: true });
    return { 近期性经验次数: 0, 露出经验: item(), 自慰经验: item(), 排泄调教经验: item(), 道具调教经验: item(), 凌辱调教经验: item(), 隐奸经验: item(), 青奸经验: item(), 睡奸经验: item(), 催眠奸经验: item(), 情趣扮演经验: item(), 盗摄经验: item(), 性直播经验: item() };
  }

  function emptyDevelopment() {
    return { 口腔: { 档位: 0, 进度: 0, 可更新: true, 评语: '' }, 胸: { 档位: 0, 进度: 0, 可更新: true, 评语: '' }, 小穴: { 档位: 0, 进度: 0, 可更新: true, 评语: '' }, 肛门: { 档位: 0, 进度: 0, 可更新: true, 评语: '' } };
  }

  async function installStreamer(item) {
    const pkg = { ...(item.package || {}), authorName: item.authorName || item.package?.authorName };
    const d = pkg.data || {};
    const name = clean(d.name, 40);
    const handle = clean(d.handle, 60);
    if (!name || !handle || !clean(d.profileYaml, 100000)) throw new Error('主播作品包资料不完整');
    const context = readMvu();
    context.stat.对象信息 = context.stat.对象信息 && typeof context.stat.对象信息 === 'object' ? context.stat.对象信息 : {};
    context.stat.系统配置 = context.stat.系统配置 && typeof context.stat.系统配置 === 'object' ? context.stat.系统配置 : {};
    context.stat.系统配置.直播间 = context.stat.系统配置.直播间 && typeof context.stat.系统配置.直播间 === 'object' ? context.stat.系统配置.直播间 : {};
    if (context.stat.对象信息[name] || context.stat.系统配置.直播间[name]) throw new Error(`当前存档已经存在主播「${name}」`);
    const scale = streamScale(d.tier ?? d.scale?.tier ?? 42);
    const parts = d.assets?.parts || {};
    const partMap = {};
    if (remote(parts.oral)) partMap.口腔 = remote(parts.oral);
    if (remote(parts.chest)) partMap.胸部 = remote(parts.chest);
    if (remote(parts.vagina)) partMap.小穴 = remote(parts.vagina);
    if (remote(parts.anus)) partMap.肛门 = remote(parts.anus);
    context.stat.对象信息[name] = {
      羁绊: { 好感度: 80, 顺从度: 0, 心情: '开朗' },
      位置: { 区域: clean(d.home, 120), 场所: '家中', 私密度: 5 },
      性经历: emptyExperience(), 开发度: emptyDevelopment(),
      生理: { 性欲度: 0, 体力: 100, 尿意: 20, 异常状态: {} },
      直播: { 开播: false, 标题: '', 热度: 0, 粉丝数: scale.followers },
    };
    context.stat.系统配置.直播间[name] = {
      自定义: true, 代表色: clean(d.theme, 30), 主播网名: handle,
      封面: remote(d.assets?.cover), 封面类型: remote(d.assets?.cover) ? 'url' : '', 部位图: partMap,
      档期: clean(d.hours, 40) || '不固定', 牌子名: clean(d.medal, 40) || handle || name,
      体量档位: scale.tier, 底盘热度: scale.base, 本场热度: 0, 高能榜: [],
      大航海: { 舰长: scale.guards, 提督: scale.admirals, 总督: scale.governors, 名单: [] },
    };
    saveMvu(context);
    const entryName = streamerEntryName(pkg);
    await updateWorldbook((entries) => reorderManaged([
      ...entries.filter((entry) => clean(entry?.name) !== entryName),
      managedEntry(entryName, d.profileYaml, [name, handle], { order: 410 }),
    ]));
    return { name, worldbookEntry: entryName };
  }

  function customMapWorldbookEntry(node) {
    const keys = [...new Set([node.name, ...(node.aliases || [])].map((value) => clean(value, 80)).filter(Boolean))];
    const detail = clean(node.detail ?? node.intro, 100000);
    return {
      name: `玩家地点 - ${node.name}`, comment: `玩家地点 - ${node.name}`, enabled: true, keys, key: keys, content: detail || node.name,
      strategy: { type: 'selective', keys, keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: 'after_character_definition', role: 'system', depth: 0, order: 34 }, probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null }, effect: { sticky: null, cooldown: null, delay: null },
      extra: { linjiangCustomMapNode: { id: node.id, version: 2 } },
    };
  }

  async function installCityNode(item) {
    const d = item.package?.data || {};
    const p = d.placement || {};
    const name = clean(d.name, 30);
    if (!name || !clean(p.plate, 50) || !Array.isArray(p.localPos) || p.localPos.length < 2) throw new Error('城市节点作品包定位信息不完整');
    const context = readMvu();
    context.stat.系统配置 = context.stat.系统配置 && typeof context.stat.系统配置 === 'object' ? context.stat.系统配置 : {};
    context.stat.系统配置.地图 = context.stat.系统配置.地图 && typeof context.stat.系统配置.地图 === 'object' ? context.stat.系统配置.地图 : {};
    context.stat.系统配置.地图.版本 = 1;
    const nodes = context.stat.系统配置.地图.自建节点 && typeof context.stat.系统配置.地图.自建节点 === 'object' ? context.stat.系统配置.地图.自建节点 : {};
    if (Object.values(nodes).some((row) => clean(row?.名称) === name)) throw new Error(`当前存档已经存在地点「${name}」`);
    const id = `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const node = {
      id, name, aliases: Array.isArray(d.aliases) ? d.aliases.map((value) => clean(value, 40)).filter(Boolean).slice(0, 8) : [],
      district: clean(d.district, 50), plate: clean(p.plate, 50),
      localPos: [Math.max(0, Math.min(1, Number(p.localPos[0]) || 0)), Math.max(0, Math.min(1, Number(p.localPos[1]) || 0))],
      anchorId: clean(p.anchorId, 80), anchorName: clean(p.anchorName, 80), accessKm: Math.max(0, Number(p.accessKm) || 0),
      archetype: clean(d.archetype, 30) || 'living', privacy: Math.max(0, Math.min(5, Math.round(Number(d.privacy) || 0))),
      openHours: Array.isArray(d.openHours) && d.openHours.length ? d.openHours.slice(0, 5) : ['朝', '昼', '暮', '夜', '深夜'],
      detail: clean(d.detail ?? d.intro, 100000), mapIntro: clean(d.mapIntro ?? d.draw, 300),
      mapNotes: Array.isArray(d.mapNotes ?? d.special) ? (d.mapNotes ?? d.special).map((value) => clean(value, 120)).filter(Boolean).slice(0, 12) : [],
      features: { canDate: !!d.features?.canDate, canGather: !!d.features?.canGather, canWork: !!d.features?.canWork, hasShop: !!d.features?.hasShop },
      createdAt: `${clean(context.stat.世界信息?.年历, 30)} ${clean(context.stat.世界信息?.时间?.时钟, 10)}`.trim(),
    };
    let worldbookSynced = false;
    try {
      await updateWorldbook((entries) => [...entries.filter((entry) => clean(entry?.name) !== `玩家地点 - ${node.name}`), customMapWorldbookEntry(node)]);
      worldbookSynced = true;
    } catch (error) { console.warn('[临江工坊] 城市节点世界书写入失败，将由地图动态注入', error); }
    nodes[id] = {
      名称: node.name, 别名: node.aliases, 区域: node.district, 底板: node.plate, 区内坐标: node.localPos,
      锚点: node.anchorId, 锚点名称: node.anchorName, 接驳距离: node.accessKm, 类型: node.archetype, 私密度: node.privacy,
      开放时段: node.openHours, 功能: { 可约会: node.features.canDate, 可采集: node.features.canGather, 可工作: node.features.canWork, 有商店: node.features.hasShop },
      详情: node.detail, 地图简介: node.mapIntro, 特殊: node.mapNotes, 创建时间: node.createdAt,
      世界书同步: { 状态: worldbookSynced ? '已同步' : '由地图加载动态注入', 条目UID: null },
    };
    context.stat.系统配置.地图.自建节点 = nodes;
    saveMvu(context);
    return { id, name, cost: 0, money: Number(context.stat.玩家信息?.金钱) || 0 };
  }

  async function installExtension(item) {
    const pkg = { ...(item.package || {}), authorName: item.authorName || item.package?.authorName };
    const base = extensionEntryBase(pkg);
    const sections = Array.isArray(pkg.data?.sections) ? pkg.data.sections : [];
    if (!sections.length) throw new Error('拓展正文为空');
    if (sections.some((section) => section.kind === 'content' && (!Array.isArray(section.triggerWords) || !section.triggerWords.length))) {
      throw new Error('每个绿灯条目至少填写一个触发词');
    }
    const position = pkg.data?.position || {};
    let blueIndex = 0;
    let greenIndex = 0;
    const entries = sections.map((section, index) => {
      const isBlue = section.kind === 'overview';
      const lightIndex = isBlue ? ++blueIndex : ++greenIndex;
      const lightLabel = `${isBlue ? '蓝灯' : '绿灯'}-${String(lightIndex).padStart(2, '0')}`;
      const titleLabel = clean(section.title, 80);
      const suffix = `｜${lightLabel}${titleLabel ? `｜${titleLabel}` : ''}`;
      return managedEntry(`${base}${suffix}`, section.content, isBlue ? [] : section.triggerWords, { ...position, order: Number(position.order || 420) + index });
    });
    await updateWorldbook((current) => reorderManaged([...current.filter((entry) => !clean(entry?.name).startsWith(base)), ...entries]));
    return { worldbookBase: base, entries: entries.length };
  }

  function worldbookEntryTitle(entry) {
    return clean(entry?.name || entry?.comment || entry?.title);
  }

  function parseManagedBase(name, type) {
    const value = clean(name);
    const prefix = type === 'streamer' ? `${PREFIX}主播人设｜` : `${PREFIX}拓展｜`;
    if (!value.startsWith(prefix)) return null;
    const parts = value.slice(prefix.length).split('｜');
    if (type === 'streamer') {
      return { title: clean(parts[0], 80), authorName: cleanLabel(parts[1]) };
    }
    return { title: clean(parts[0], 80), authorName: cleanLabel(parts[1]), base: `${prefix}${parts[0]}｜${parts[1]}` };
  }

  async function listInstalledItems() {
    const context = readMvu();
    const stat = context.stat || {};
    const entries = await currentWorldbookEntries();
    const output = [];
    const seen = new Set();
    const rooms = stat.系统配置?.直播间 || {};
    const objects = stat.对象信息 || {};

    for (const entry of entries) {
      const name = worldbookEntryTitle(entry);
      const parsed = parseManagedBase(name, 'streamer');
      if (!parsed || seen.has(`streamer:${parsed.title}`) || !rooms[parsed.title] || !objects[parsed.title]) continue;
      const pkg = await exportStreamer(parsed.title);
      pkg.authorName = parsed.authorName;
      output.push({ id: `streamer:${parsed.title}`, itemType: 'streamer', title: parsed.title, authorName: parsed.authorName, package: pkg });
      seen.add(`streamer:${parsed.title}`);
    }

    const nodes = stat.系统配置?.地图?.自建节点 || {};
    for (const [id, row] of Object.entries(nodes)) {
      const name = clean(row?.名称);
      if (!name || seen.has(`city_node:${id}`)) continue;
      const pkg = exportCityNode(id);
      output.push({ id: `city_node:${id}`, itemType: 'city_node', title: name, authorName: '当前游戏', package: pkg });
      seen.add(`city_node:${id}`);
    }

    const extensionGroups = new Map();
    for (const entry of entries) {
      const name = worldbookEntryTitle(entry);
      const parsed = parseManagedBase(name, 'extension');
      if (!parsed) continue;
      const key = parsed.base;
      if (!extensionGroups.has(key)) extensionGroups.set(key, { parsed, rows: [] });
      extensionGroups.get(key).rows.push(entry);
    }
    for (const [base, group] of extensionGroups) {
      if (seen.has(`extension:${base}`)) continue;
      const position = group.rows[0]?.position || {};
      const sections = group.rows.map((entry, index) => {
        const name = worldbookEntryTitle(entry);
        const suffix = name.slice(base.length).replace(/^｜/, '');
        const isBlue = suffix.startsWith('蓝灯') || suffix.includes('总览');
        const title = suffix.replace(/^(蓝灯|绿灯)-?\d*｜?/, '').replace(/^总览｜?/, '').replace(/^\d+｜?/, '').trim();
        const keys = Array.isArray(entry?.strategy?.keys) ? entry.strategy.keys : (Array.isArray(entry?.keys) ? entry.keys : []);
        return { id: `installed-${index + 1}`, kind: isBlue ? 'overview' : 'content', title, content: clean(entry?.content, 100000), triggerWords: isBlue ? [] : keys };
      }).filter((section) => section.content);
      const pkg = { schema: 'linjiang.workshop.package', schemaVersion: 1, game: 'linjiang', itemType: 'extension', title: group.parsed.title, summary: '', tags: [], authorName: group.parsed.authorName, data: { sections, position: { type: position.type || 'after_character_definition', depth: Number(position.depth || 0), order: Number(position.order || 420) } } };
      output.push({ id: `extension:${base}`, itemType: 'extension', title: group.parsed.title, authorName: group.parsed.authorName, package: pkg, entryCount: sections.length });
      seen.add(`extension:${base}`);
    }
    return { items: output };
  }

  async function uninstallItem(item) {
    const pkg = { ...(item.package || {}), authorName: item.authorName || item.package?.authorName };
    if (pkg.itemType === 'city_node') {
      const context = readMvu();
      const id = clean(item.id).replace(/^city_node:/, '') || clean(pkg.data?.id);
      const nodes = context.stat.系统配置?.地图?.自建节点 || {};
      const row = nodes[id];
      if (!row) throw new Error('城市节点不存在');
      const nodeName = clean(row.名称);
      delete nodes[id];
      context.stat.系统配置.地图.自建节点 = nodes;
      saveMvu(context);
      let removed = 0;
      try {
        await updateWorldbook((entries) => entries.filter((entry) => {
          const hit = worldbookEntryTitle(entry) === `玩家地点 - ${nodeName}`;
          if (hit) removed += 1;
          return !hit;
        }));
      } catch (error) { console.warn('[临江工坊] 删除城市节点世界书失败', error); }
      return { removed, id, name: nodeName };
    }
    const base = pkg.itemType === 'streamer' ? streamerEntryName(pkg) : pkg.itemType === 'extension' ? extensionEntryBase(pkg) : '';
    if (!base) throw new Error('作品类型无效');
    let removed = 0;
    await updateWorldbook((entries) => reorderManaged(entries.filter((entry) => {
      const hit = pkg.itemType === 'streamer' ? worldbookEntryTitle(entry) === base : worldbookEntryTitle(entry).startsWith(base);
      if (hit) removed += 1;
      return !hit;
    })));
    if (pkg.itemType === 'streamer') {
      const context = readMvu();
      const name = clean(pkg.data?.name || item.title);
      if (context.stat.对象信息) delete context.stat.对象信息[name];
      if (context.stat.系统配置?.直播间) delete context.stat.系统配置.直播间[name];
      saveMvu(context);
    }
    return { removed, base };
  }

  async function listPublishSources(itemType) {
    if (itemType === 'streamer') {
      const { stat } = readMvu();
      const rooms = stat.系统配置?.直播间 || {};
      const objects = stat.对象信息 || {};
      return Object.entries(rooms).filter(([name, room]) => room?.自定义 === true && objects[name]).map(([name, room]) => ({ id: name, label: `${name} / ${clean(room.主播网名) || '未设置网名'}` }));
    }
    if (itemType === 'city_node') {
      const nodes = readMvu().stat.系统配置?.地图?.自建节点 || {};
      return Object.entries(nodes).map(([id, node]) => ({ id, label: `${clean(node?.区域)} · ${clean(node?.名称)}` }));
    }
    return [];
  }

  async function exportStreamer(name) {
    const { stat } = readMvu();
    const room = stat.系统配置?.直播间?.[name];
    const object = stat.对象信息?.[name];
    if (!room || room.自定义 !== true || !object) throw new Error('自定义主播不存在');
    const entries = await currentWorldbookEntries();
    const openingName = `人物详情 - ${name}`;
    const profile = entries.find((entry) => clean(entry?.name) === openingName)
      || entries.find((entry) => clean(entry?.name).startsWith(`${PREFIX}主播人设｜${name}｜`));
    if (!profile?.content) throw new Error(`没有找到「${name}」的人设世界书正文`);
    const part = room.部位图 || {};
    const data = {
      name, handle: clean(room.主播网名), age: 23, home: clean(object.位置?.区域), categories: [],
      tier: Number(room.体量档位 ?? 42), hours: clean(room.档期) || '不固定', tone: '', seed: '', medal: clean(room.牌子名), theme: clean(room.代表色),
      profileYaml: clean(profile.content, 100000),
      assets: { cover: remote(room.封面), parts: { oral: remote(part.口腔), chest: remote(part.胸部 || part.胸), vagina: remote(part.小穴), anus: remote(part.肛门) } },
    };
    return { schema: 'linjiang.workshop.package', schemaVersion: 1, game: 'linjiang', itemType: 'streamer', title: name, summary: '', tags: [], coverUrl: data.assets.cover, data };
  }

  function exportCityNode(id) {
    const row = readMvu().stat.系统配置?.地图?.自建节点?.[id];
    if (!row) throw new Error('城市节点不存在');
    const features = row.功能 || {};
    const data = {
      name: clean(row.名称), aliases: Array.isArray(row.别名) ? row.别名 : [], district: clean(row.区域), archetype: clean(row.类型) || 'living', privacy: Number(row.私密度 || 0),
      openHours: Array.isArray(row.开放时段) ? row.开放时段 : ['朝', '昼', '暮', '夜', '深夜'],
      detail: clean(row.详情 ?? row.简介, 100000), mapIntro: clean(row.地图简介 ?? row.看点, 300), mapNotes: Array.isArray(row.地图备注 ?? row.特殊) ? (row.地图备注 ?? row.特殊) : [],
      features: { canDate: !!features.可约会, canGather: !!features.可采集, canWork: !!features.可工作, hasShop: !!features.有商店 },
      placement: { mapRevision: MAP_REVISION, plate: clean(row.底板), localPos: Array.isArray(row.区内坐标) ? row.区内坐标.slice(0, 2) : [], anchorId: clean(row.锚点), anchorName: clean(row.锚点名称), accessKm: Number(row.接驳距离 || 0) },
    };
    return { schema: 'linjiang.workshop.package', schemaVersion: 1, game: 'linjiang', itemType: 'city_node', title: data.name, summary: data.mapIntro, tags: [data.district, data.archetype].filter(Boolean), coverUrl: '', data };
  }

  function claimTokens(claim) {
    const host = hostWindow();
    const key = 'linjiang_workshop_local_tokens_v1';
    let wallet = { balance: 0, claims: [] };
    try { wallet = JSON.parse(host.localStorage.getItem(key) || '') || wallet; } catch {}
    const claims = new Set(Array.isArray(wallet.claims) ? wallet.claims : []);
    if (!claims.has(claim.claimId)) {
      wallet.balance = Number(wallet.balance || 0) + Number(claim.amount || 0);
      claims.add(claim.claimId);
      wallet.claims = [...claims].slice(-500);
      host.localStorage.setItem(key, JSON.stringify(wallet));
    }
    return wallet;
  }

  async function handleAction(action, payload) {
    switch (action) {
      case 'handshake': return { label: '临江创意工坊桥接', version: BRIDGE_VERSION, capabilities: { streamer: true, cityNode: true, extension: true, tokens: true, installedManager: true } };
      case 'listPublishSources': return { sources: await listPublishSources(payload.itemType) };
      case 'listInstalledItems': return listInstalledItems();
      case 'exportPublishSource': return { package: payload.itemType === 'streamer' ? await exportStreamer(payload.sourceId) : exportCityNode(payload.sourceId) };
      case 'installItem': {
        const type = payload.item?.itemType || payload.item?.package?.itemType;
        if (type === 'streamer') return installStreamer(payload.item);
        if (type === 'city_node') return installCityNode(payload.item);
        if (type === 'extension') return installExtension(payload.item);
        throw new Error('作品类型无效');
      }
      case 'uninstallItem': return uninstallItem(payload.item);
      case 'claimTokens': return claimTokens(payload.claim || {});
      case 'openExternal': hostWindow().open(clean(payload.url, 2000), '_blank', 'noopener'); return true;
      default: throw new Error(`未知桥接动作：${action}`);
    }
  }

  function closeWorkshopPanel(panel = null, event = null) {
    event?.preventDefault();
    event?.stopPropagation();
    const target = panel || hostDocument().getElementById(PANEL_ID);
    if (target) {
      target.classList.remove('open');
      target.setAttribute('aria-hidden', 'true');
    }
    const floating = hostDocument().getElementById(`${PANEL_ID}-close`);
    floating?.classList.remove('open');
  }

  function ensurePanel() {
    const doc = hostDocument();
    let panel = doc.getElementById(PANEL_ID);
    if (!doc.getElementById(`${PANEL_ID}-style`)) {
      const style = doc.createElement('style');
      style.id = `${PANEL_ID}-style`;
      style.textContent = `#${PANEL_ID}{position:fixed;inset:0;z-index:2147483000;display:none;pointer-events:none;background:rgba(2,4,10,.72);backdrop-filter:blur(8px)}#${PANEL_ID}.open{display:block;pointer-events:auto}#${PANEL_ID} iframe{position:absolute;inset:3vh 3vw;width:94vw;height:94vh;z-index:0;border:1px solid rgba(220,232,255,.25);border-radius:20px;background:#080b15;box-shadow:0 28px 100px #000}#${PANEL_ID} .ljw-close{display:none}#${PANEL_ID}-close{position:fixed;display:none;right:calc(3vw + 12px);top:calc(3vh + 10px);z-index:2147483647;width:44px;height:44px;border:1px solid rgba(255,255,255,.42);border-radius:12px;background:rgba(10,14,26,.96);color:#fff;font-size:27px;line-height:1;cursor:pointer;pointer-events:auto;touch-action:manipulation;place-items:center;box-shadow:0 8px 24px rgba(0,0,0,.42)}#${PANEL_ID}-close.open{display:grid}@media(max-width:700px){#${PANEL_ID} iframe{inset:0;width:100vw;height:100vh;border:0;border-radius:0}#${PANEL_ID}-close{right:10px;top:10px}}`;
      doc.head.appendChild(style);
    }
    if (!panel) {
      panel = doc.createElement('div');
      panel.id = PANEL_ID;
      panel.setAttribute('aria-hidden', 'true');
      panel.innerHTML = `<iframe title="临江创意工坊" src="${esc(TARGET_URL)}" allow="clipboard-read; clipboard-write"></iframe>`;
      doc.body.appendChild(panel);
      panel.addEventListener('click', (event) => { if (event.target === panel) closeWorkshopPanel(panel, event); });
    }
    let closeButton = doc.getElementById(`${PANEL_ID}-close`);
    if (!closeButton) {
      closeButton = doc.createElement('button');
      closeButton.id = `${PANEL_ID}-close`;
      closeButton.className = 'ljw-close-floating';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', '关闭创意工坊');
      closeButton.textContent = '×';
      doc.body.appendChild(closeButton);
    }
    if (closeButton.dataset.bound !== 'true') {
      const handler = (event) => closeWorkshopPanel(panel, event);
      closeButton.addEventListener('pointerdown', handler, true);
      closeButton.addEventListener('click', handler, true);
      closeButton.dataset.bound = 'true';
    }
    const oldCloseButton = panel.querySelector('.ljw-close');
    if (oldCloseButton && oldCloseButton.dataset.bound !== 'true') {
      const handler = (event) => closeWorkshopPanel(panel, event);
      oldCloseButton.addEventListener('pointerdown', handler, true);
      oldCloseButton.addEventListener('click', handler, true);
      oldCloseButton.dataset.bound = 'true';
    }
    return panel;
  }

  function openPanel() {
    const panel = ensurePanel();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    hostDocument().getElementById(`${PANEL_ID}-close`)?.classList.add('open');
  }

  function setupMessages() {
    const host = hostWindow();
    host.addEventListener('message', async (event) => {
      const panel = hostDocument().getElementById(PANEL_ID);
      const frame = panel?.querySelector('iframe');
      const data = event.data;
      // Nested workshop iframes send their bridge requests directly to top.
      const isKnownPanel = frame && event.source === frame.contentWindow;
      const isNestedWorkshop = event.source && event.source !== host && data?.channel === CHANNEL;
      if ((!isKnownPanel && !isNestedWorkshop) || !data || data.channel !== CHANNEL || data.kind !== 'request') return;
      if (TARGET_ORIGIN && event.origin !== TARGET_ORIGIN) return;
      const reply = { channel: CHANNEL, kind: 'response', id: data.id };
      try { event.source.postMessage({ ...reply, ok: true, payload: await handleAction(data.action, data.payload || {}) }, event.origin); }
      catch (error) { event.source.postMessage({ ...reply, ok: false, error: error?.message || String(error) }, event.origin); }
    });
  }

  function setupAuthMessages() {
    const host = hostWindow();
    let loginWindow = null;
    let pending = null;
    host.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.channel !== 'linjiang-workshop:auth') return;

      if (data.kind === 'request' && data.action === 'openDiscordLogin') {
        if (TARGET_ORIGIN && event.origin !== TARGET_ORIGIN) return;
        if (!event.source || event.source === host) return;
        if (pending?.requestId === data.requestId && loginWindow && !loginWindow.closed) {
          try { loginWindow.focus(); } catch {}
          return;
        }
        pending = { source: event.source, origin: event.origin, requestId: data.requestId };
        if (loginWindow && !loginWindow.closed) {
          try { loginWindow.focus(); } catch {}
          return;
        }
        loginWindow = host.open(data.url, 'linjiang_workshop_discord', 'width=620,height=820,scrollbars=yes,resizable=yes');
        if (!loginWindow) {
          pending.source?.postMessage({ channel: 'linjiang-workshop:auth', kind: 'error', requestId: data.requestId, ok: false, error: 'Popup permission is required for Discord login' }, event.origin);
          pending = null;
        }
        return;
      }

      // The callback page is opened by this host, so only that exact popup and origin are accepted.
      if (TARGET_ORIGIN && event.origin !== TARGET_ORIGIN) return;
      if (!loginWindow || event.source !== loginWindow || typeof data.ok !== 'boolean') return;
      const request = pending;
      pending = null;
      if (request?.source) request.source.postMessage({ ...data, kind: 'response', requestId: request.requestId }, request.origin);
      try { if (!loginWindow.closed) loginWindow.close(); } catch {}
      loginWindow = null;
    });
  }

  setupMessages();
  setupAuthMessages();
  try {
    const core = wins().find((win) => typeof win.eventOn === 'function' && typeof win.getButtonEvent === 'function');
    if (core) core.eventOn(core.getButtonEvent(BUTTON_EVENT_NAME), openPanel);
  } catch {}
  hostWindow().LinjiangWorkshop = { open: openPanel, close: () => closeWorkshopPanel() };
  console.info('[临江创意工坊] 桥接已加载，调用 LinjiangWorkshop.open() 可打开面板');
})();
