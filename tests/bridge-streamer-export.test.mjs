import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadBridgeFixture({ name = 'A&B', entryName = `角色详情：A&B` } = {}) {
  const handlers = [];
  const replies = [];
  const source = { postMessage(message) { replies.push(message); } };
  const stat = {
    对象信息: {
      [name]: { 位置: { 区域: '浦江区 · 测试住所' }, 直播: { 粉丝数: 12345 } },
    },
    系统配置: {
      直播间: {
        [name]: {
          自定义: true,
          主播网名: 'Green&Live',
          代表色: 'ice',
          档期: '20:00-23:00',
          牌子名: '绿芽',
          体量档位: 55,
          部位图: {},
          创意工坊资料: {
            age: 25,
            home: '浦江区 · 测试住所',
            categories: ['杂谈', '游戏'],
            hoursStart: '20:00',
            hoursEnd: '23:00',
            tone: '轻松',
            seed: '测试种子',
          },
        },
      },
    },
  };
  const document = {
    body: {}, head: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { style: {}, dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {} }; },
  };
  const window = {
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
    Mvu: {
      getMvuData() { return { stat_data: stat }; },
      replaceMvuData() {},
    },
    TavernHelper: {
      getCharWorldbookNames() { return { primary: 'fixture-book', additional: [] }; },
      async getWorldbook() {
        return [{ name: entryName, content: `${name}:\n  性格: 开朗`, extra: { linjiangOpening: { sourceName: name } } }];
      },
    },
    addEventListener(type, handler) { if (type === 'message') handlers.push(handler); },
    open() { return null; },
    console,
  };
  window.parent = window;
  window.top = window;
  const context = vm.createContext({ window, document, console, URL, setTimeout, clearTimeout });
  const code = await readFile(new URL('../bridge/临江创意工坊桥接.js', import.meta.url), 'utf8');
  vm.runInContext(code, context);
  async function request(action, payload = {}) {
    replies.length = 0;
    const event = { origin: 'https://workshop.rown.dpdns.org', source, data: { channel: 'linjiang-workshop:bridge', kind: 'request', id: `${action}-1`, action, payload } };
    handlers.forEach((handler) => handler(event));
    for (let i = 0; i < 30 && !replies.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    return replies[0];
  }
  return { request };
}

test('开局创建的主播可按角色详情前缀读取，名称含 & 时保持完整', async () => {
  const fixture = await loadBridgeFixture({ name: 'A&B', entryName: '角色详情：A&B' });
  const listed = await fixture.request('listPublishSources', { itemType: 'streamer' });
  assert.equal(listed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(listed.payload.sources)), [{ id: 'A&B', label: 'A&B / Green&Live' }]);
  const exported = await fixture.request('exportPublishSource', { itemType: 'streamer', sourceId: 'A&B' });
  assert.equal(exported.ok, true);
  assert.equal(exported.payload.package.title, 'A&B');
  assert.equal(exported.payload.package.data.name, 'A&B');
  assert.equal(exported.payload.package.data.handle, 'Green&Live');
  assert.equal(exported.payload.package.data.profileYaml, 'A&B:\n  性格: 开朗');
  assert.equal(exported.payload.package.data.age, 25);
  assert.deepEqual(JSON.parse(JSON.stringify(exported.payload.package.data.categories)), ['杂谈', '游戏']);
});
