export const PACKAGE_SCHEMA = 'linjiang.workshop.package';
export const PACKAGE_SCHEMA_VERSION = 1;
export const ITEM_TYPES = Object.freeze(['streamer', 'city_node', 'extension']);
const ITEM_TYPE_SET = new Set(ITEM_TYPES);

const text = (value, max = 10000) => String(value ?? '').trim().slice(0, max);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, number(value, min)));
const list = (value, maxItems = 30, maxText = 80) => {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，]/);
  return [...new Set(source.map((item) => text(item, maxText)).filter(Boolean))].slice(0, maxItems);
};
const remoteUrl = (value) => {
  const raw = text(value, 2000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
};

export function cleanAuthorName(value) {
  return text(value, 48).replace(/[\r\n｜|]+/g, ' ').replace(/\s+/g, ' ').trim() || '匿名作者';
}

export function streamScale(tierValue) {
  const tier = clamp(tierValue, 0, 100);
  const roundNice = (raw) => {
    const value = Math.max(0, Math.round(Number(raw) || 0));
    if (value >= 100000) return Math.round(value / 1000) * 1000;
    if (value >= 10000) return Math.round(value / 100) * 100;
    if (value >= 1000) return Math.round(value / 10) * 10;
    return value;
  };
  const base = 50 * Math.pow(8, tier / 25);
  const followers = base * (60 - 0.42 * tier);
  const guards = followers * (0.0012 + 0.000038 * tier);
  return {
    tier,
    followers: roundNice(followers),
    base: roundNice(base),
    guards: roundNice(guards),
    admirals: Math.max(0, Math.floor((guards - 40) / 24)),
    governors: Math.max(0, Math.floor((guards - 300) / 260)),
  };
}

function normalizeStreamer(data = {}) {
  const tier = clamp(data.tier ?? data.scale?.tier ?? data.体量档位, 0, 100);
  const hoursStart = text(data.hoursStart, 5);
  const hoursEnd = text(data.hoursEnd, 5);
  const hours = text(data.hours, 40) || (hoursStart && hoursEnd ? `${hoursStart}-${hoursEnd}` : '不固定');
  const partSource = data.assets?.parts || data.partArt || data.parts || {};
  return {
    name: text(data.name, 40),
    handle: text(data.handle, 60),
    age: Math.round(clamp(data.age || 23, 18, 120)),
    home: text(data.home, 120),
    homeData: data.homeData && typeof data.homeData === 'object' ? {
      id: text(data.homeData.id, 80),
      name: text(data.homeData.name, 80),
      fullName: text(data.homeData.fullName, 120),
      district: text(data.homeData.district, 50),
    } : null,
    categories: list(data.categories, 16, 30),
    tier,
    scale: streamScale(tier),
    hoursStart,
    hoursEnd,
    hours,
    tone: text(data.tone, 200),
    seed: text(data.seed, 1000),
    medal: text(data.medal, 40),
    theme: text(data.theme, 30),
    profileYaml: text(data.profileYaml ?? data.yaml, 100000),
    assets: {
      cover: remoteUrl(data.assets?.cover ?? data.coverUrl ?? data.art?.src),
      parts: {
        oral: remoteUrl(partSource.oral ?? partSource['口腔']),
        chest: remoteUrl(partSource.chest ?? partSource['胸部'] ?? partSource['胸']),
        vagina: remoteUrl(partSource.vagina ?? partSource['小穴']),
        anus: remoteUrl(partSource.anus ?? partSource['肛门']),
      },
    },
  };
}

function normalizeCityNode(data = {}) {
  const position = data.placement || data.position || {};
  const rawPos = Array.isArray(position.localPos) ? position.localPos : (Array.isArray(data.localPos) ? data.localPos : []);
  const features = data.features || {};
  return {
    name: text(data.name, 30),
    aliases: list(data.aliases, 8, 40),
    district: text(data.district, 50),
    archetype: text(data.archetype || 'living', 30) || 'living',
    privacy: Math.round(clamp(data.privacy, 0, 5)),
    openHours: list(data.openHours?.length ? data.openHours : ['朝', '昼', '暮', '夜', '深夜'], 5, 10),
    detail: text(data.detail ?? data.intro, 100000),
    mapIntro: text(data.mapIntro ?? data.draw, 300),
    mapNotes: list(data.mapNotes ?? data.special, 12, 120),
    features: {
      canDate: !!features.canDate,
      canGather: !!features.canGather,
      canWork: !!features.canWork,
      hasShop: !!features.hasShop,
    },
    placement: {
      mapRevision: text(position.mapRevision ?? data.mapRevision, 80),
      plate: text(position.plate ?? data.plate, 50),
      localPos: rawPos.length >= 2 ? [clamp(rawPos[0], 0, 1), clamp(rawPos[1], 0, 1)] : [],
      anchorId: text(position.anchorId ?? data.anchorId, 80),
      anchorName: text(position.anchorName ?? data.anchorName, 80),
      accessKm: Math.max(0, Math.round(number(position.accessKm ?? data.accessKm, 0) * 100) / 100),
    },
  };
}

function normalizeExtension(data = {}) {
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const normalizedSections = sections.map((section, index) => ({
    id: text(section?.id, 80) || `section-${index + 1}`,
    kind: text(section?.kind, 20) === 'overview' ? 'overview' : 'content',
    title: text(section?.title, 80),
    content: text(section?.content ?? section?.contentText, 100000),
    triggerWords: list(section?.triggerWords ?? section?.trigger_words, 30, 80),
  })).filter((section) => section.content);
  if (!normalizedSections.length && text(data.content ?? data.contentText, 100000)) {
    normalizedSections.push({
      id: 'content-1',
      kind: 'content',
      title: '',
      content: text(data.content ?? data.contentText, 100000),
      triggerWords: list(data.triggerWords ?? data.trigger_words, 30, 80),
    });
  }
  return {
    sections: normalizedSections,
    position: {
      type: ['before_character_definition', 'after_character_definition', 'at_depth'].includes(data.position?.type)
        ? data.position.type : 'after_character_definition',
      depth: Math.max(0, Math.floor(number(data.position?.depth, 0))),
      order: Math.max(401, Math.min(499, Math.floor(number(data.position?.order, 420)))),
    },
  };
}

export function normalizePackage(input = {}, options = {}) {
  const itemType = text(input.itemType ?? input.item_type ?? input.type, 30);
  if (!ITEM_TYPE_SET.has(itemType)) throw new Error('作品类型无效');
  const rawData = input.data ?? input.payload ?? {};
  const data = itemType === 'streamer'
    ? normalizeStreamer(rawData)
    : itemType === 'city_node'
      ? normalizeCityNode(rawData)
      : normalizeExtension(rawData);
  const titleFallback = itemType === 'streamer' || itemType === 'city_node' ? data.name : '';
  const title = text(input.title || titleFallback, 80);
  const summary = text(input.summary ?? input.intro, 1000);
  const authorName = cleanAuthorName(options.authorName ?? input.authorName ?? input.author_name);
  const normalized = {
    schema: PACKAGE_SCHEMA,
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    game: 'linjiang',
    itemType,
    title,
    summary,
    tags: list(input.tags, 12, 30),
    coverUrl: remoteUrl(input.coverUrl ?? input.cover_url ?? (itemType === 'streamer' ? data.assets.cover : '')),
    authorName,
    data,
  };
  validatePackage(normalized);
  return normalized;
}

export function validatePackage(pkg) {
  if (pkg?.schema !== PACKAGE_SCHEMA || Number(pkg?.schemaVersion) !== PACKAGE_SCHEMA_VERSION) {
    throw new Error('作品包版本不受支持');
  }
  if (!ITEM_TYPE_SET.has(pkg.itemType)) throw new Error('作品类型无效');
  if (!text(pkg.title, 80)) throw new Error('作品标题为空');
  if (pkg.itemType === 'streamer') {
    if (!pkg.data.name || !pkg.data.handle) throw new Error('主播姓名和网名需要填写');
    if (!pkg.data.profileYaml) throw new Error('主播人设 YAML 为空');
  }
  if (pkg.itemType === 'city_node') {
    if (!pkg.data.name) throw new Error('城市节点名称为空');
    if (!pkg.data.placement.plate || pkg.data.placement.localPos.length < 2) throw new Error('城市节点定位信息不完整');
  }
  if (pkg.itemType === 'extension' && !pkg.data.sections.length) throw new Error('拓展正文为空');
  if (pkg.itemType === 'extension' && pkg.data.sections.some((section) => section.kind === 'content' && !section.triggerWords.length)) {
    throw new Error('每个绿灯条目至少填写一个触发词');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(pkg)).byteLength;
  if (bytes > 512 * 1024) throw new Error('作品包超过 512 KB');
  return pkg;
}

export function workshopWorldbookBase(pkg) {
  const author = cleanAuthorName(pkg?.authorName);
  if (pkg?.itemType === 'streamer') return `🧩mod 主播人设｜${text(pkg?.data?.name, 40)}｜${author}`;
  if (pkg?.itemType === 'extension') return `🧩mod 拓展｜${text(pkg?.title, 80)}｜${author}`;
  return '';
}
