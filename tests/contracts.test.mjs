import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePackage, streamScale, workshopWorldbookBase } from '../src/contracts.js';

test('主播包使用作者名生成世界书特殊名称', () => {
  const pkg = normalizePackage({
    itemType: 'streamer',
    title: '测试主播',
    data: { name: '测试主播', handle: 'Test_Channel', profileYaml: '测试主播:\n  性格: 开朗' },
  }, { authorName: '作者甲' });
  assert.equal(workshopWorldbookBase(pkg), '🧩mod 主播人设｜测试主播｜作者甲');
  assert.equal(pkg.data.scale.followers, streamScale(pkg.data.tier).followers);
});

test('城市节点保留相对位置和锚点', () => {
  const pkg = normalizePackage({
    itemType: 'city_node',
    title: '海风旧仓库',
    data: {
      name: '海风旧仓库', district: '西洲区', archetype: 'commercial', privacy: 3,
      placement: { mapRevision: 'v1', plate: 'xizhou', localPos: [0.25, 0.7], anchorId: 'xz_port', anchorName: '西洲港', accessKm: 0.8 },
    },
  }, { authorName: '作者乙' });
  assert.deepEqual(pkg.data.placement.localPos, [0.25, 0.7]);
  assert.equal(pkg.data.placement.anchorId, 'xz_port');
});

test('拓展正文为空时校验报错', () => {
  assert.throws(() => normalizePackage({ itemType: 'extension', title: '空拓展', data: {} }, { authorName: '作者丙' }), /拓展正文为空/);
});


test('拓展允许多个蓝灯和绿灯条目，但每个绿灯都需要触发词', () => {
  const pkg = normalizePackage({
    itemType: 'extension',
    title: '夜间经济系统',
    data: {
      sections: [
        { id: 'blue-1', kind: 'overview', title: '规则总览', content: '常驻规则' },
        { id: 'blue-2', kind: 'overview', content: '第二组常驻规则' },
        { id: 'green-1', kind: 'content', title: '夜市经营', content: '夜市规则', triggerWords: ['夜市', '摆摊'] },
        { id: 'green-2', kind: 'content', content: '黑市规则', triggerWords: ['黑市'] },
      ],
    },
  }, { authorName: '作者丁' });
  assert.equal(pkg.data.sections.length, 4);
  assert.equal(pkg.data.sections.filter((section) => section.kind === 'overview').length, 2);
  assert.equal(pkg.data.sections.filter((section) => section.kind === 'content').length, 2);
  assert.throws(() => normalizePackage({
    itemType: 'extension',
    title: '缺少触发词',
    data: { sections: [{ kind: 'content', content: '正文', triggerWords: [] }] },
  }, { authorName: '作者戊' }), /每个绿灯条目至少填写一个触发词/);
});
