# DL Price Tracker + 最优买法（Tampermonkey）

本项目直接基于 [syoius/dlTracker4TamperMonkey](https://github.com/syoius/dlTracker4TamperMonkey) 修改；该项目又基于 [Cassandra-fox/dlTracker](https://github.com/Cassandra-fox/dlTracker) 改写。因此，`syoius/dlTracker4TamperMonkey` 是本项目的直接来源，`Cassandra-fox/dlTracker` 是间接上游。代码继续遵循仓库中的 MIT 许可证并保留原作者署名。

> 史低/当前价格数据来源：[DLwatcher](https://dlwatcher.com/)

## 优惠券读取器：验证 A 版

目前先用独立脚本验证 DLsite 登录账号实际返回的优惠券数据结构。A 版只在“我的优惠券”页面运行，并且脚本自身只发起一次 DLsite 同源结构化请求；它不会打开优惠券详情、不会翻适用作品列表、不会访问单个作品，也不会请求 DLwatcher。

读取器会根据响应正文判断 JSON 或 HTML，不依赖 DLsite 返回的 `Content-Type`；这兼容了接口把 JSON 标成 `text/html` 的情况。

**[直接安装优惠券读取器 A 版](https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dlsite-coupon-reader.user.js)**

Via 等支持 `.user.js` 的浏览器可以直接打开链接安装。安装后登录 DLsite 并打开“我的优惠券”页面，脚本会显示接口券数、页面券数、数量核对结果和字段结构摘要。随后点击“下载诊断 JSON”或“复制诊断 JSON”，把结果私下发回用于开发 B 版。

诊断 JSON 不包含 Cookie、认证请求头、登录凭据、邮箱或账号身份字段，但会按当前验证方案保留真实优惠券 ID，因此不要把文件公开上传。若浏览器里仍启用了旧版“最优买法”脚本，它也可能自行读取优惠券；进行“一次请求”验收时只启用本读取器。

## 当前功能

- DLsite RJ（同人）/BJ（乙女）商品页显示价格标签（当前价、史低、折扣）
- 收藏页卡片显示价格标签
- 购物车页面显示价格标签
- 在购物车中计算多张优惠券的最优分配和拆单方案
- 打开 DLsite 优惠券页后，自动读取当前账号的有效优惠券和适用条件
- 支持“仅限指定作品”的百分比券、固定金额券和满减券
- 支持一次性券和“期限内可重复使用”券；每个订单最多使用一张券
- 支持三件折扣门槛，以及优惠券与三件折扣的三种叠加/互斥模式
- 稍后再买列表智能排序（可选史低优先/折扣优先/低价优先）
- 点击“查看价格趋势”跳转 DLwatcher
- 24h 本地缓存（IndexedDB）与 SPA 路由兼容
- 首次运行新版时显示更新说明

## 一键安装

直接打开下面的 `.user.js` 链接即可：Via 等带有内置用户脚本功能的手机浏览器可以直接使用，不要求另外安装 Tampermonkey；在桌面浏览器中，也可以由 Tampermonkey、Violentmonkey 等兼容管理器接管安装。

**[安装 DLsite 最优买法](https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dl-price-tracker.user.js)**

脚本包含标准 userscript 元数据以及 `@updateURL`、`@downloadURL`。是否自动弹出安装页和检查更新，由当前浏览器内置的用户脚本功能或所使用的脚本管理器决定。

## 最优买法使用方法

1. 安装脚本后登录 DLsite，把想购买的作品放入购物车。
2. 点击右下角的“最优买法”。首次打开时脚本会自动读取优惠券，不需要先访问优惠券页面。
3. 点击“计算最优拆单方案”。脚本会按当前平台折扣价、三件活动价、优惠券的顺序估算，并考虑是否拆成多个订单。

优惠券接口返回的指定作品编号会直接保存；类型、站点、作品类别等条件会在计算时只针对当前购物车作品解析。“添加优惠券”和各输入框保留为接口字段无法识别时的校正手段，正常情况下不需要手填。

规则和优惠券只保存在当前浏览器的 `localStorage`。计算在本地完成，脚本不会自动增删购物车、应用优惠券或提交订单。

自动导入只在首次打开“最优买法”或主动访问优惠券页面时进行，并缓存五分钟；计算动态条件时只批量读取当前购物车作品的公开元数据。脚本不会后台翻页爬取“适用作品”列表。

### 三件折扣关系

- `折后继续用券`：先用三件折扣价，再在折后价上计算优惠券。
- `用券作品恢复普通价，但仍计入三件`：用券作品不用三件折扣，其他作品仍可依靠它满足三件门槛。
- `用券作品恢复普通价且不计入三件`：用券作品从三件活动中移除，可能导致整组不再满足门槛。

由于 DLsite 不同活动可能采用不同的计税、取整及互斥规则，结果属于按所填规则得到的估算；付款前必须以 DLsite 确认订单页为准。

## 计算范围

- 精确求解最多 12 部购物车作品、8 张优惠券。
- 同一订单最多使用一张券；一次性券在整次计算中最多使用一次，可重复券可以用于多个不同订单。
- “最低消费”可以选择按整单金额或仅按适用作品金额计算。
- 已过有效期的自动导入券不会参加计算；当前版本尚未把积分返还和支付方式返现计入目标函数。

## 测试

要求 Node.js 20 或更新版本：

```bash
node --check userscript/dl-price-tracker.user.js
node --test tests/deal-optimizer.test.mjs
```

## 仓库结构

```text
userscript/
  dlsite-coupon-reader.user.js
  dl-price-tracker.user.js
tests/
  deal-optimizer.test.mjs
README.md
```

## 上游代码存放方式

为方便对照与同步，上游仓库代码单独放在本地目录 `_upstream/dlTracker`（递归克隆），并通过 `.gitignore` 排除，不纳入本仓库版本管理。

示例：

```bash
git clone --recursive https://github.com/Cassandra-fox/dlTracker.git _upstream/dlTracker
```
