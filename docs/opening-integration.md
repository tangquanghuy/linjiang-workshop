# 与 opening.html 的接入约定

`opening.html` 仍属于临江游戏仓库。工坊仓库只定义交换协议，避免两个仓库互相复制业务状态。

## 开局页建议增加的入口

每个主播存档项增加：

- 导出 JSON
- 导入 JSON
- 投稿到工坊

页面顶部增加：

- 从工坊选择主播

## 开局 JSON 序列化

直接复用 `opening.js` 中 `normalizeCustom()` 的字段，并改造成工坊包：

```js
function toWorkshopStreamerPackage(custom) {
  const data = normalizeCustom(custom);
  return {
    schema: 'linjiang.workshop.package',
    schemaVersion: 1,
    game: 'linjiang',
    itemType: 'streamer',
    title: data.name,
    summary: data.tone || '',
    tags: data.categories || [],
    coverUrl: data.art?.type === 'url' ? data.art.src : '',
    data: {
      name: data.name,
      handle: data.handle,
      age: data.age,
      home: data.home,
      homeData: data.homeData,
      categories: data.categories,
      tier: data.tier,
      hoursStart: data.hoursStart,
      hoursEnd: data.hoursEnd,
      hours: data.hours,
      tone: data.tone,
      seed: data.seed,
      medal: data.medal,
      theme: data.theme,
      profileYaml: data.yaml,
      assets: {
        cover: data.art?.type === 'url' ? data.art.src : '',
        parts: data.partArt || { oral: '', chest: '', vagina: '', anus: '' }
      }
    }
  };
}
```

本地上传形成的 `data:image/*` 只用于当前浏览器预览；投稿工坊时图片字段使用 `http(s)` 网络链接。

## 从工坊接收主播

独立开局页可打开工坊弹窗，并通过 `postMessage` 接收作品包。收到包后：

```js
const custom = normalizeCustom({
  ...pkg.data,
  yaml: pkg.data.profileYaml,
  art: { type: pkg.data.assets?.cover ? 'url' : '', src: pkg.data.assets?.cover || '' },
  partArt: pkg.data.assets?.parts || {}
});
```

然后放入现有 `state.archives` 或 `state.customs`，后续 `openingPayload()` 按普通自定义主播生成 MVU。

## 部位开发图

开局编辑器增加四个可选 URL：

```text
oral   -> 口腔
chest  -> 胸部
vagina -> 小穴
anus   -> 肛门
```

`openingPayload()` 写入：

```js
rooms[d.name].部位图 = {
  口腔: d.partArt?.oral || '',
  胸部: d.partArt?.chest || '',
  小穴: d.partArt?.vagina || '',
  肛门: d.partArt?.anus || ''
};
```

过滤空值后再进入 MVU。
