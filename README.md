# DL Price Tracker

基于需求规格说明实现的 Edge/Chrome (Manifest V3) 浏览器插件原型。

## 已实现功能（V1 可用）

- 作品页注入：在价格区域显示“史低价 + 查看趋势按钮”
- 收藏页导入：在收藏页面注入“导入收藏”入口，调用 DLsite 收藏接口并批量同步 DLwatcher 史低
- 后台数据策略：
  - 本地有数据：直接展示
  - 本地无数据：实时请求 DLwatcher
  - 非收藏作品默认不持久化（仅展示）
  - 当前价格低于史低时，自动下修本地史低
- 管理页面（Options）：
  - 列表查看（标题、当前价、史低、差价、收藏状态）
  - 单作品手动更新
  - 批量更新收藏
  - CSV 导出
- Popup：
  - 总记录/收藏数/当前<=史低统计
  - 快速打开管理页
  - 一键更新收藏

## 技术栈

- TypeScript
- Vite
- vite-plugin-web-extension
- IndexedDB（idb）
- dayjs

## 数据库设计（优化版）

### stores

1. `prices`（keyPath: `rjCode`）
   - 核心字段：`title`, `currentPrice`, `lowestPrice`, `regularPrice`, `discountRate`, `isFavorite`, `lastChecked`
   - 索引：`by-lastChecked`, `by-lowestPrice`, `by-isFavorite`, `by-updatedAt`
2. `favorites`（keyPath: `rjCode`）
   - 字段：`addedAt`
   - 索引：`by-addedAt`
3. `settings`（keyPath: `key`）
   - 字段：`value`, `updatedAt`
   - 索引：`by-updatedAt`

## 本地运行

1. 安装依赖
   - `npm install`
2. 开发构建
   - `npm run build`
3. 在 Edge 打开扩展管理页
   - 启用开发者模式
   - 加载已解压扩展：选择 `dist` 目录

## 目录结构

- `src/background`: Service Worker + 业务逻辑
- `src/content`: 页面注入脚本
- `src/db`: IndexedDB 定义与仓储层
- `src/services`: 外部站点请求（DLwatcher）
- `src/popup`: 弹窗
- `src/options`: 管理页
- `src/shared`: 类型、常量、工具函数

## 待你确认的信息

1. DLsite 是否只支持 `girls` 站点路径？（当前作品链接和收藏 API 按 `girls` 默认）
2. 收藏页导入入口希望固定插在页面哪个具体区域？（当前插在 `main` 顶部）
3. 作品页当前价解析选择器是否需要我按你常用主题做更精细适配？
4. 管理页默认排序目前是“收藏优先 + 最近更新”，是否改成“按价格/添加时间可切换”？

确认后我可以继续做 V1.1：

- 收藏列表页逐行史低增强
- 标签系统
- 图表趋势（chart.js）
- 更完整的首次安装引导
