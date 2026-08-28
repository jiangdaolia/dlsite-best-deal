# DL Price Tracker + 优惠助手（Tampermonkey）

本项目直接基于 [syoius/dlTracker4TamperMonkey](https://github.com/syoius/dlTracker4TamperMonkey) 修改；该项目又基于 [Cassandra-fox/dlTracker](https://github.com/Cassandra-fox/dlTracker) 改写。因此，`syoius/dlTracker4TamperMonkey` 是本项目的直接来源，`Cassandra-fox/dlTracker` 是间接上游。代码继续遵循仓库中的 MIT 许可证并保留原作者署名。

> 史低/当前价格数据来源：[DLwatcher](https://dlwatcher.com/)

## 优惠券读取器：B 版

独立读取器会在“我的优惠券”页面读取并诊断账号优惠券；在购物车页面，它会自动读取一次全账号优惠券，再用一次批量请求取得页面中“立即购买”和“稍后再买”作品的分类、社团和站点条件。它不会打开优惠券详情、不会翻适用作品列表、不会逐个访问作品，也不会请求 DLwatcher。

读取器会根据响应正文判断 JSON 或 HTML，不依赖 DLsite 返回的 `Content-Type`；这兼容了接口把 JSON 标成 `text/html` 的情况。

**[直接安装优惠券读取器 B 版](https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dlsite-coupon-reader.user.js)**

Via 等支持 `.user.js` 的浏览器可以直接打开链接安装。安装后登录 DLsite：打开“我的优惠券”页面可查看读取诊断；打开购物车会在人民币等本地化价格后补充精确的日元现价，并在每部作品旁显示适用券。判断满减金额、优惠券件数和三件活动门槛时只统计“立即购买”；“稍后再买”作品只用于显示它本身适用哪些券，不增加当前金额或件数。底部浮动状态提示可点按隐藏。

`满1,200减400` 按用户指定以等效 `33.3% OFF` 参与显示和排序，但实际规则始终仍是“整个订单满1,200日元减400日元”，不会把每部作品直接按约66.7%价格计算。一个订单仍然只能使用一张券。

诊断 JSON 不包含 Cookie、认证请求头、登录凭据、优惠券兑换码、邮箱或账号身份字段，但会按当前验证方案保留真实优惠券 ID，因此不要把文件公开上传。若浏览器里仍启用了旧版“最优买法”脚本，它也可能自行读取优惠券；进行“一次请求”验收时只启用本读取器。

## 当前功能

- 搜索、分类、排行、新作、活动、社团、收藏、推荐和最近浏览等作品列表显示折后日元价
- 列表在“查看价格趋势”下方用两行简标平台活动（如 `3件60OFF`）和适用券（如 `券50OFF·3部起用`、`券33OFF·满1200`）
- 作品详情和购物车用两个紧凑框显示活动、优惠券、门槛差额、使用次数和中国时间到期
- 保留上游史低标签原样，并用同格式单独显示 `本次可到 88円  93OFF`
- DLsite RJ（同人）/BJ（乙女）商品页显示价格标签（当前价、史低、折扣）
- 收藏页卡片显示价格标签
- 购物车页面显示价格标签
- 打开 DLsite 优惠券页后，自动读取当前账号的有效优惠券和适用条件
- 支持“仅限指定作品”的百分比券、固定金额券和满减券
- 支持一次性券和“期限内可重复使用”券；每个订单最多使用一张券
- 支持三件折扣门槛，以及优惠券与三件折扣的三种叠加/互斥模式
- 稍后再买列表智能排序（可选当前是史低优先/当前最低可达优先/假设低价优先）
- 点击“查看价格趋势”跳转 DLwatcher
- 24h 本地缓存（IndexedDB）与 SPA 路由兼容
- 首次运行新版时显示更新说明

## 一键安装

直接打开下面的 `.user.js` 链接即可：Via 等带有内置用户脚本功能的手机浏览器可以直接使用，不要求另外安装 Tampermonkey；在桌面浏览器中，也可以由 Tampermonkey、Violentmonkey 等兼容管理器接管安装。

**[安装 DLsite 优惠助手 + 史低](https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dl-price-tracker.user.js)**

脚本包含标准 userscript 元数据以及 `@updateURL`、`@downloadURL`。是否自动弹出安装页和检查更新，由当前浏览器内置的用户脚本功能或所使用的脚本管理器决定。

## 自动读取与安全

优惠券会区分“从未读取”和“已读取但为空”。读取后不会定时轮询；只有已知优惠券到期、成功购买、切换账号，或主动打开优惠券页时才刷新。作品元数据缓存 30 分钟，每个页面至多进行一次、最多 100 个编号的批量读取。

脚本直接使用优惠券接口返回的结构化适用条件，不打开优惠券里的适用作品链接，也不会翻动其中数千部作品的分页。三件活动只按作品的 `bulkbuy_key` 读取一次规则页，不读取活动作品列表。遇到 403、429 或验证页时，本页后续 DLsite 数据请求立即停止且不自动重试。

购物车快照不存在时读取一次；之后只在成功加入购物车或购物车页面内容变化后更新。所有计算和展示均为只读，脚本不会自动加购、套券、拆单或提交订单。

## 测试

要求 Node.js 20 或更新版本：

```bash
node --check userscript/dl-price-tracker.user.js
node --test tests/*.mjs
```

## 仓库结构

```text
userscript/
  dlsite-coupon-reader.user.js
  dl-price-tracker.user.js
tests/
  cart-coupon-marker.test.mjs
  coupon-reader-a.test.mjs
  deal-insight.test.mjs
  deal-optimizer.test.mjs
README.md
```

## 上游代码存放方式

为方便对照与同步，上游仓库代码单独放在本地目录 `_upstream/dlTracker`（递归克隆），并通过 `.gitignore` 排除，不纳入本仓库版本管理。

示例：

```bash
git clone --recursive https://github.com/Cassandra-fox/dlTracker.git _upstream/dlTracker
```
