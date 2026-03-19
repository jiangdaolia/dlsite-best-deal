# DL Price Tracker (Tampermonkey)

基于 [Cassandra-fox/dlTracker](https://github.com/Cassandra-fox/dlTracker) 的工作进行改写，当前仓库仅维护油猴脚本版本。

> 史低/当前价格数据来源：[DLwatcher](https://dlwatcher.com/)

## 当前功能

- DLsite RJ（同人）/BJ（乙女）商品页显示价格标签（当前价、史低、折扣）
- 收藏页卡片显示价格标签
- 点击“查看价格趋势”跳转 DLwatcher
- 24h 本地缓存（IndexedDB）与 SPA 路由兼容
- 自动检测新版本

## 安装

1. 安装浏览器插件 Tampermonkey（或 Violentmonkey），或使用支持脚本的浏览器（如Via浏览器）
2. [点击链接安装脚本](https://github.com/syoius/dlTracker4TamperMonkey/raw/refs/heads/main/userscript/dl-price-tracker.user.js)
3. 安装并启用脚本后，打开或刷新 `https://www.dlsite.com/*` 相关页面即可生效

## 仓库结构

```text
userscript/
  dl-price-tracker.user.js
README.md
```

## 上游代码存放方式

为方便对照与同步，上游仓库代码单独放在本地目录 `_upstream/dlTracker`（递归克隆），并通过 `.gitignore` 排除，不纳入本仓库版本管理。

示例：

```bash
git clone --recursive https://github.com/Cassandra-fox/dlTracker.git _upstream/dlTracker
```
