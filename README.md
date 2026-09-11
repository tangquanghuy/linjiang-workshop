# 临江创意工坊

独立部署的临江 RPG 创意工坊。仓库同时包含：

- Cloudflare Worker API
- 静态工坊网页
- D1 数据库结构
- 酒馆侧桥接脚本
- 自定义主播、城市节点、拓展的版本化 JSON 契约

## 已落地的核心规则

### 自定义主播

主播写入 MVU 后与开局创建的自定义主播保持同一结构，MVU 中不记录工坊来源：

- `对象信息.[主播名]`
- `系统配置.直播间.[主播名]`
- `系统配置.直播间.[主播名].部位图`

工坊只通过世界书特殊名称管理人设安装与卸载：

```text
🧩mod 主播人设｜主播名｜作者名
```

卸载只删除这条人设世界书，主播变量继续保留。

### 拓展

```text
🧩mod 拓展｜作品标题｜作者名｜蓝灯-01
🧩mod 拓展｜作品标题｜作者名｜蓝灯-02
🧩mod 拓展｜作品标题｜作者名｜绿灯-01
🧩mod 拓展｜作品标题｜作者名｜绿灯-02
```

工坊管理条目位于以下边界之间：

```text
--/Mod开始
--/Mod结束
```

### 城市节点

城市节点作品保存语义资料和相对定位：

- `plate`
- `[0, 1]` 范围内的 `localPos`
- 静态 `anchorId`
- `anchorName`
- `accessKm`

安装会生成新的本地节点 ID，按现有城市规划蓝图规则支付 `￥1,000,000` 建设费，并写入现有 `系统配置.地图.自建节点` 结构。城市节点使用项目原有的 `玩家地点 - 名称` 世界书格式。

### 创作代币

- 每位已登录玩家对一件作品首次成功采用，作品作者获得 1 枚代币。
- 作者自己采用、同一玩家重复采用不结算。
- 云端代币通过领取凭证转入当前浏览器。
- 本地钱包属于单机数据；服务器上的上传、点赞、奖励结算继续以 Discord 身份为准。

## 本地运行

```bash
npm install
copy .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

默认由 Wrangler 启动本地 Worker 和静态资源。

## Cloudflare 初始化

### 1. 创建 D1

```bash
npx wrangler d1 create linjiang_workshop
```

把返回的 `database_id` 写入 `wrangler.jsonc`。

### 2. 初始化远端数据库

```bash
npm run db:remote
```

### 3. 配置 Discord OAuth

在 Discord Developer Portal 创建应用，并添加回调地址：

```text
https://你的工坊域名/api/auth/discord/callback
```

更新 `wrangler.jsonc` 中的 `DISCORD_CLIENT_ID`，再写入机密：

```bash
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CLAIM_SECRET
```

### 4. 部署

```bash
npm run deploy
```

## 桥接脚本

文件：

```text
bridge/临江创意工坊桥接.js
```

发布 Worker 后，把脚本顶部的：

```js
https://workshop.rown.dpdns.org/?embed=1
```

替换成正式地址。也可以在脚本执行前配置：

```js
window.LINJIANG_WORKSHOP_URL = 'https://你的工坊域名/?embed=1';
```

酒馆按钮事件名称为：

```text
创意工坊
```

也可以从控制台或其他脚本调用：

```js
LinjiangWorkshop.open();
```

## 作品 JSON

统一包头：

```json
{
  "schema": "linjiang.workshop.package",
  "schemaVersion": 1,
  "game": "linjiang",
  "itemType": "streamer",
  "title": "作品标题",
  "summary": "作品简介",
  "tags": [],
  "coverUrl": "https://...",
  "authorName": "发布时由服务器写入",
  "data": {}
}
```

JSON 是底层交换格式。游戏内直传与直接安装只是由桥接自动完成 JSON 的读取和写入，独立网页继续支持手动导入、导出。

## 开发检查

```bash
npm run check
```

## GitHub

当前目录本身就是独立 Git 仓库：

```bash
git add .
git commit -m "feat: initialize Linjiang workshop"
git remote add origin 你的仓库地址
git push -u origin main
```
