# 开发、测试与发布

## 文档权威顺序

1. 当前代码与用户最新要求
2. 本地 `PROJECT_MEMORY.md`
3. 公开的 `docs/FEATURES.md` 与 `README.md`
4. `notes/README.md` 所索引的历史访谈记录

历史访谈用于追溯决策，不得覆盖当前代码或后续明确修改。

## 仓库结构

```text
userscript/
  dl-price-tracker.user.js       # 日常主脚本
  dlsite-coupon-reader.user.js   # 诊断/兼容脚本
tests/
  browse-refresh.test.mjs        # 浏览卡、筛选、排序、动态刷新
  cart-coupon-marker.test.mjs    # 购物车券匹配与门槛
  coupon-reader-a.test.mjs       # 响应解析、脱敏与风控
  deal-insight.test.mjs          # 优惠归一化、本次可到与缓存
  deal-optimizer.test.mjs        # 单笔报价与拼单候选
  language-edition.test.mjs      # 语言家族、账号索引与单件操作
docs/
  FEATURES.md                    # 当前功能和产品规则
  DEVELOPMENT.md                 # 本文
```

本地的 `AGENTS.md`、`PROJECT_MEMORY.md` 和 `notes/` 被 `.gitignore` 排除，只用于开发交接，不应发布。

## 核心数据流

1. 从当前页面收集作品编号、价格和购物车分区。
2. 批量补全 DLsite 公开作品元数据。
3. 读取或复用优惠券、平台活动和购物车快照。
4. 为每部作品计算适用券、平台路径、本次可到和门槛状态。
5. 从 IndexedDB 或 DLwatcher 补全史低。
6. 原子渲染卡片，应用账号提醒、排序、筛选和隐藏状态。

页面观察器必须忽略助手自身 DOM。普通浏览页只处理未标记或新增卡片；购物车门槛变化时允许重算全部相关作品。

## 安全边界

- 公开作品信息使用匿名请求，不携带 Cookie，不发送来源页。
- 购物车、已购清单和优惠券只在当前账号功能确实需要时使用登录态。
- 403、429、验证页或异常 HTML 会触发熔断；不得通过自动重试绕过。
- 不遍历优惠券适用作品分页，不预取下一页，不逐作品打开详情页。
- 不自动加购、移出、换语言、套券、拆单或下单。
- 只有用户明确点击时，才代理一个实际 SKU 的 DLsite 官方前端操作。
- 仓库、日志和诊断不得包含账号标识、邮箱、Cookie、认证头或凭据。

## 修改约束

- 主脚本是 `userscript/dl-price-tracker.user.js`。
- 保留对 `syoius/dlTracker4TamperMonkey` 的直接署名和对 `Cassandra-fox/dlTracker` 的间接署名。
- 工作树可能包含用户改动；先检查 `git status --short`，不要重置无关内容。
- 文件修改使用补丁方式，避免覆盖用户未提交变更。
- 变更界面时保持 DLsite 原生标题、封面、价格和操作布局。
- 缓存或请求策略变更必须同时考虑限频、熔断、跨标签页与失效迁移。

## 必需检查

需要 Node.js 20 或更新版本：

```bash
node --check userscript/dl-price-tracker.user.js
node --check userscript/dlsite-coupon-reader.user.js
node --test tests/*.test.mjs
git diff --check
```

功能变更应增加对应回归测试。文档变更至少检查 Markdown 链接、版本号、安装链接和 `git diff --check`；发布前仍执行完整测试。

## 发布

- `origin` 是上游比较仓库，不得作为发布目标。
- 只使用 `git push publish main` 发布。
- 用户已确认：代码或文档修改完成并通过检查后直接提交、推送，不再等待单独的“上传”指令。
- 主脚本版本更新时，先提交并推送代码，再把 README 安装链接固定到代码提交的完整哈希，单独提交并推送。
- 发布后确认工作树干净、脚本元数据版本与 `APP_VERSION` 一致。

## 上游对照

如需本地保存其他上游代码，可克隆到被忽略的 `_upstream/`：

```bash
git clone --recursive https://github.com/Cassandra-fox/dlTracker.git _upstream/dlTracker
```
