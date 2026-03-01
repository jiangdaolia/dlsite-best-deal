# DL Price Tracker

在 DLsite 作品页面显示历史最低价，一键导入收藏并批量追踪价格变动。

> 史低价格数据来源：[DLwatcher](https://dlwatcher.com/)

## ✨ 功能

- **作品页史低显示** — 在价格区域注入"史低价"标签 + "查看价格趋势"按钮（链接到 DLwatcher）
- **收藏一键导入** — 在 DLsite 收藏 / Wishlist 页面注入导入入口，自动解析并批量同步史低数据
- **收藏卡片增强** — 收藏列表页每张卡片直接显示史低价
- **管理页面** — 表格展示所有追踪作品（RJ号超链接、作品标题、史低价、收藏状态），支持单条 / 批量更新、CSV 导出
- **Popup 快捷面板** — 查看统计数据，一键更新收藏价格
- **SPA 路由兼容** — 支持 DLsite 站内导航不刷新页面的场景
- **girls + girls-drama** — 同时支持 RJ（同人）和 BJ（乙女）作品编号

## 📦 安装

### 从 GitHub Releases 下载（推荐）

1. 前往 [Releases](https://github.com/Cassandra-fox/dlTracker/releases) 下载最新版 `dl-price-tracker-vX.X.X.zip`
2. 解压到任意文件夹（**不要删除该文件夹，Edge 需要持续读取**）
3. 打开 Edge，地址栏输入 `edge://extensions/`
4. 打开左下角 **「开发人员模式」**
5. 点击 **「加载解压缩的扩展」** → 选择解压后的文件夹
6. 完成 🎉

> Chrome 用户同理，访问 `chrome://extensions/` 操作即可。

### 从源码构建

```bash
git clone https://github.com/Cassandra-fox/dlTracker.git
cd dlTracker
npm install
npm run build
```

构建产物在 `dist/` 目录，按上述步骤加载即可。

## 🖼️ 使用说明

| 场景     | 操作                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| 查看史低 | 打开任意 DLsite 作品页面，价格区域自动显示                                                       |
| 导入收藏 | 进入 [DLsite 收藏页](https://www.dlsite.com/girls/mypage/wishlist)，点击页面上方「导入收藏」按钮 |
| 管理数据 | 点击扩展图标 →「打开管理页」                                                                     |
| 更新价格 | 管理页中单条更新 / 批量「更新收藏」                                                              |
| 导出数据 | 管理页中点击「导出 CSV」                                                                         |

## 🏗️ 技术栈

| 类别     | 技术                             |
| -------- | -------------------------------- |
| 扩展框架 | Manifest V3 (Edge / Chrome)      |
| 语言     | TypeScript                       |
| 构建     | Vite + vite-plugin-web-extension |
| 存储     | IndexedDB (idb)                  |
| 日期     | dayjs                            |

## 📁 项目结构

```
src/
├── background/   # Service Worker — 消息处理、业务逻辑
├── content/      # Content Script — 页面注入（史低卡片、导入按钮）
├── db/           # IndexedDB 定义与数据仓储层
├── services/     # 外部 API 请求（DLwatcher）
├── popup/        # Popup 弹窗
├── options/      # 管理页面
└── shared/       # 类型定义、常量、工具函数
```

## ⚙️ 设计要点

- **24h 本地缓存 TTL** — 已有数据在 24 小时内不重复请求 DLwatcher，降低服务器压力
- **非收藏不持久化** — 仅浏览的作品只展示不写入数据库，节省存储空间
- **当前价 < 史低自动下修** — 页面当前价格低于已知史低时自动更新本地记录
- **MV3 Service Worker 保活** — 批量导入时通过 keepalive 机制防止 Worker 被终止
- **输入校验** — 所有 RJ/BJ 编号在后台入口处做格式验证，防止注入攻击
- **User-Agent 标识** — DLwatcher 请求携带插件标识，便于上游识别和限流

## ❓ FAQ

**Q: 更新扩展版本后怎么操作？**
A: 下载新版 zip，解压覆盖原文件夹，然后在 `edge://extensions/` 点击扩展卡片上的刷新按钮。

**Q: 数据存在哪里？**
A: 所有数据存储在浏览器本地的 IndexedDB 中，不会上传到任何服务器。

**Q: 支持哪些 DLsite 分区？**
A: 目前支持 `girls`（同人/RJ）和 `girls-drama`（乙女/BJ）两个分区。

## 📝 许可

MIT
