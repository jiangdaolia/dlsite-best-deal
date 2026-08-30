// ==UserScript==
// @name         DLsite 最优买法 + 史低
// @namespace    https://github.com/jiangdaolia/dlsite-best-deal
// @version      0.6.39
// @description  在 DLsite 页面显示史低、折后日元价、优惠券与本次可到价格
// @author       Syoius & Cassandra-fox; coupon insights maintained by jiangdaolia
// @license      MIT
// @match        https://www.dlsite.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      dlwatcher.com
// @homepageURL  https://github.com/jiangdaolia/dlsite-best-deal
// @supportURL   https://github.com/jiangdaolia/dlsite-best-deal/issues
// @updateURL    https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dl-price-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dl-price-tracker.user.js
// ==/UserScript==

(function () {
  "use strict";

  // Directly derived from syoius/dlTracker4TamperMonkey, which is itself
  // derived from Cassandra-fox/dlTracker. See README and LICENSE for details.

  const APP_NAME = "DL Price Tracker";
  const APP_VERSION = "0.6.39";

  const DLWATCHER_BASE = "https://dlwatcher.com/product";
  const FAVORITE_API_PATH = "/girls/load/favorite/product";

  const BATCH_SIZE = 10;
  const BATCH_INTERVAL_MS = 1000;
  const REQUEST_TIMEOUT_MS = 10000;
  const CART_RENDER_CONCURRENCY = 4;
  const RETRYABLE_FETCH_ATTEMPTS = 1;
  const RETRY_BASE_DELAY_MS = 450;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_FAVORITES = 500;
  const ENABLE_WISHLIST_ACTION_PANEL = false;
  const ENABLE_CART_DIAGNOSTIC_PANEL = false;
  const BUY_LATER_SORT_STORAGE_KEY = "dltracker-buy-later-sort-enabled";
  const BUY_LATER_SORT_MODE_STORAGE_KEY = "dltracker-buy-later-sort-mode";
  const BUY_LATER_SORT_MODE_LOWEST = "lowest";
  const BUY_LATER_SORT_MODE_REACH = "reach";
  const BUY_LATER_SORT_MODE_PRICE = "price";
  const BUY_LATER_SORT_MODE_PLATFORM_EXPIRY = "platform-expiry";
  const BROWSE_SORT_MODE_STORAGE_KEY = "dltracker-browse-sort-mode";
  const BROWSE_FILTER_STORAGE_KEY = "dltracker-browse-bundle-filter";
  const BROWSE_HIDE_PURCHASED_STORAGE_KEY = "dltracker-browse-hide-purchased";
  const BROWSE_HIDE_CARTED_STORAGE_KEY = "dltracker-browse-hide-carted";
  const BROWSE_SORT_MODE_NATIVE = "native";
  const UPDATE_NOTICE_SEEN_VERSION_KEY = "dltracker-update-notice-seen-version";
  const DEAL_PLANNER_STORAGE_KEY = "dltracker-deal-planner-v1";
  const DEAL_PLANNER_MAX_ITEMS = 12;
  const DEAL_PLANNER_MAX_COUPONS = 8;
  const DLSITE_COUPON_API_PATH = "/books/mypage/coupon/list/ajax";
  const DLSITE_PRODUCT_INFO_PATH = "/maniax/product/info/ajax";
  const PRODUCT_METADATA_TTL_MS = 30 * 60 * 1000;
  const DEAL_CACHE_STORAGE_KEY = "dltracker-deal-insight-cache-v3";
  const CART_SNAPSHOT_STORAGE_KEY = "dltracker-cart-snapshot-v5";
  const ACCOUNT_INDEX_STORAGE_KEY = "dltracker-account-index-v1";
  const LANGUAGE_FAMILY_CACHE_STORAGE_KEY = "dltracker-language-family-cache-v1";
  const LANGUAGE_DIALOG_RESTORE_STORAGE_KEY = "dltracker-language-dialog-restore-v1";
  const ACCOUNT_REFRESH_COOLDOWN_MS = 60 * 1000;
  const LANGUAGE_FAMILY_TTL_MS = 24 * 60 * 60 * 1000;
  const ACCOUNT_METADATA_BATCH_SIZE = 40;
  const ACCOUNT_METADATA_BATCH_PAUSE_MS = 10 * 1000;
  const ACCOUNT_INDEX_REQUEST_VERSION = 3;
  const DLSITE_MEMBER_STATUS_PATH = "/load/member/status";
  const DLSITE_BOUGHT_PRODUCTS_PATH = "/load/bought/product";
  const PRODUCT_CODE_REGEX = /\b([RBV]J\d{6,})\b/i;
  const DEAL_INSIGHT_CLASSNAME = "dltracker-deal-insight";
  const DEAL_PROCESSED_ATTRIBUTE = "data-dltracker-deal-processed";
  const MAX_PRODUCT_METADATA_BATCH = 100;
  const RELEASE_NOTES = {
    "0.6.39": [
      "账号索引使用独立请求会话，不再被优惠券或当页分析的停止状态误伤",
      "语言索引暂停进度直接显示具体接口、HTTP状态或验证页原因",
    ],
    "0.6.38": [
      "公开作品信息批量请求不再携带登录Cookie，旧的0/88暂停状态会自动匿名重试一次",
      "账号索引与账号提醒改为页面优惠渲染完成后的后台任务，不再阻塞购物车和浏览页",
    ],
    "0.6.37": [
      "账号语言索引改为每批40部且批间等待10秒，避免88部单请求被DLsite拒绝",
    ],
    "0.6.36": [
      "账号语言索引恢复每批最多100部，减少请求次数并持久显示安全暂停原因",
      "浏览隐藏开关改用页面级点击代理，并新增隐藏购物车与稍后再买作品",
    ],
    "0.6.35": [
      "自动续接被页面刷新或跳转中断的账号语言索引，并显示暂停原因与剩余数量",
      "浏览优惠区重绘时迁移现有购买状态节点，彻底避免已购买按钮闪烁",
    ],
    "0.6.34": [
      "浏览列表与稍后再买新增平台折扣失效时间排序，最早失效优先",
      "账号信息按钮在列表节点复用或页面缓存恢复后重新绑定弹窗事件",
      "浏览控制区新增隐藏已购买按钮，并记住用户的显示选择",
    ],
    "0.6.33": [
      "账号提醒改为异步完成后原子替换，修复浏览页已购买标记闪烁",
      "账号语言索引改为每批 10 部串行读取，并明确区分读取中与未取得项",
    ],
    "0.6.32": [
      "账号清单读取后立即更新面板，并明确显示读取中或读取失败状态",
    ],
    "0.6.31": [
      "把桌面语言比较入口收回原生操作容器，修复标题竖排和原生按钮被挤走",
    ],
    "0.6.30": [
      "桌面语言比较按钮与原生稍后再买或放回按钮左边缘对齐，保持真正正上方",
    ],
    "0.6.29": [
      "桌面购物车入口实时跟随原生操作按钮宽高，手机入口改为其左侧文字链接",
      "语言比较弹窗异步刷新时保留现有内容，修复弹窗闪烁",
      "购物车页加购刷新后自动恢复原语言比较弹窗",
    ],
    "0.6.28": [
      "缩小购物车的语言版本比较入口，使其与 DLsite 原生操作按钮协调",
      "语言版本加入购物车后自动刷新购物车页，无需手动刷新",
      "按实际语言商品编号精确执行移出操作，并在确认中明确语言与编号",
    ],
    "0.6.27": [
      "新增同一作品各语言版本的理论最低价、平台折扣与独立史低比较",
      "新增账号信息索引，在浏览卡提示已购买及购物车中的其他语言版本",
      "购物车和详情页新增比较语言版本入口，并支持单件加入、放回或移出",
    ],
    "0.6.26": [
      "购物车前三个价格框改用人民币/日元紧凑格式，为状态与趋势释放空间",
    ],
    "0.6.25": [
      "保留 DLsite 横向卡为封面预留的原生内容缩进，避免优惠框挤入图片区域",
      "仅用自动宽度消除整宽与缩进相加造成的越界，不改动原生图片列",
    ],
    "0.6.24": [
      "清除助手宿主继承的 DLsite 横向卡内容缩进，修复本次可到与史低框仍然越界",
      "宿主宽度改由原生卡片自动计算，不使用固定像素且不改变原生作品布局",
    ],
    "0.6.23": [
      "按 DLsite 移动路由和触控输入特征适配普通作品卡，不再扩大固定像素断点",
      "普通作品卡沿用 DLsite 的自然收缩与长文案换行，修复手机横向卡片溢出",
    ],
    "0.6.22": [
      "手机普通作品卡的本次可到、史低与趋势改为一行一个框",
      "优惠券与平台活动拆为可自适应换行的独立内容组",
      "修复从作品详情返回浏览列表后已选筛选未重新生效",
    ],
    "0.6.21": [
      "调整手机普通作品卡的优惠分析间距，使其更贴近本卡并远离下一张卡",
    ],
    "0.6.20": [
      "压缩普通作品卡的趋势框，为本次可到和史低释放更多宽度",
      "横向普通作品卡显示本次可到与史低的人民币（日元），窄卡只显示折扣",
      "三框字体、间距与内边距进一步缩小，避免金额和折扣文字被截断",
      "修复指定条件搜索页误选加载骨架，恢复优惠筛选和横向卡片分析",
      "手机购物车五框改为两行摘要条，弱化边框与整块高亮",
      "需凑单推荐表改用人民币/日元与现在/平台/史低的紧凑斜杠格式",
      "需凑单推荐表的表头与内容统一垂直居中、左对齐",
    ],
    "0.6.19": [
      "修复部分语言和手机端拼单推荐的加购物车按钮无法点击",
      "优先复用 DLsite 原生 link_move_cart 操作，按钮文字仅作兼容兜底",
      "购物车底部推荐卡新增史低、本次可到、优惠券和平台活动分析",
    ],
    "0.6.18": [
      "手机端优惠信息移到完整原生作品行之后，不再改变 DLsite 原生布局",
      "手机端状态按钮与价格趋势改为同一行",
      "需凑单推荐表新增看详情与单作品放回购物车按钮",
      "本单优惠券移到方案总结，其他同档券与适用活动并入备注",
    ],
    "0.6.17": [
      "调整购物车价格框顺序为史低优先于平台折扣",
      "需凑单推荐表改为按内容自适应列宽并支持横向滚动",
      "购物车原生价格后不再重复追加日元价格",
      "本次可到与史低改为只高亮更便宜的一方",
      "本次可到弹窗明确显示比史低贵或便宜的人民币与日元差额",
      "本次可到弹窗的节省额改为相对平台当前折扣价",
      "购物车可用优惠券默认显示前两种并可展开其余券",
    ],
    "0.6.16": [
      "重做购物车作品卡片为五框价格状态行",
      "优惠券与平台活动改为各自独立的自适应表格",
      "把原计算弹窗拆为理论价格与购物车状态两个入口",
      "移除自动拆单展示并新增窄屏单框单行布局",
    ],
    "0.6.15": [
      "修正满额券方案的优惠前总计口径",
      "优惠前改为平台折扣或平台活动后的价格合计",
      "优惠后再扣除满1200减400等本单优惠券",
    ],
    "0.6.14": [
      "修正购物车占位原价覆盖接口真实原价的问题",
      "平台折扣优先使用结构化 official_price 与当前日元价计算",
      "修正拼单表把平台30OFF错误显示为无折扣的问题",
      "压缩拼单表内容并让六列随弹窗宽度自适应",
      "合并三种折扣并高亮其中折扣力度最大的项目",
    ],
    "0.6.13": [
      "修正人民币估算混用其他作品换算比例的问题",
      "优先使用当前作品同源的结构化 CNY/JPY 现价",
      "避免购物车划线原价或含糊的 ¥ 数值污染汇率",
    ],
    "0.6.12": [
      "重写拼单推荐：限定范围、史低门槛与券层高低严格匹配",
      "件数券和平台活动改为六列候选清单，默认显示前10部",
      "满额券改为少超额优先，同超额优先更多作品并提供3个方案",
      "同时需要平台活动与优惠券时只推荐逐部都命中的交集作品",
      "修正 macOS Chrome 排序下拉菜单展开后立即关闭的问题",
    ],
    "0.6.11": [
      "修正点击‘本次可到’后计算弹窗频繁闪烁的问题",
      "弹窗改为后台计算完成后一次更新，相同数据不重复渲染",
      "修正稍后再买作品缺少本次可到和可用优惠券的问题",
    ],
    "0.6.10": [
      "拼单只推荐当前已达或低于史低的稍后再买作品",
      "推荐总计改为简洁文字行，不再使用表格",
      "修正手机版作品一览缺少凑单优惠筛选的问题",
    ],
    "0.6.9": [
      "‘稍后再买’新增与浏览列表相同的凑单优惠筛选",
      "满额券拼单会同时考虑多部作品合计达到门槛的方案",
      "拼单推荐改为逐作品价格、折扣、史低与总计表格",
    ],
    "0.6.8": [
      "默认隐藏购物车右下角诊断按钮",
    ],
    "0.6.7": [
      "满额券拼单优先用更少作品达到门槛，并尽量减少超额",
      "拼单分别推荐全员最优方案和预计总价最低方案",
      "还差条件只显示当前作品真正适用的活动与优惠券",
      "修正满额固定减免券把理论最低错误算成 0 的问题",
      "打开本次可到弹窗时锁定背景页面滚动",
    ],
    "0.6.6": [
      "修正 DLsite 隐藏购物车副本被计入立即购买门槛的问题",
      "修正浏览列表凑单筛选框反复重建造成的闪烁",
    ],
    "0.6.5": [
      "购物车诊断改为右下角固定悬浮面板，避免被页面重绘移除",
    ],
    "0.6.4": [
      "购物车诊断支持下载 JSON 文件和调起系统面板分享到微信",
    ],
    "0.6.3": [
      "购物车页新增一键复制脱敏诊断 JSON",
    ],
    "0.6.2": [
      "严格按立即购买/稍后再买所在区域计算购物车门槛",
      "本次可到的价格计算步骤改为每步单独一行",
      "复用 DLwatcher 史低数据中的声优资料，并为音声列表原生名字补上声优标签",
    ],
    "0.6.1": [
      "修正折扣商品原价被误计入购物车满减门槛",
      "移除与价格栏重复的‘当前 N円’标签",
    ],
    "0.6.0": [
      "点击‘本次可到’查看作品与购物车计算、拆单和拼单建议",
      "浏览列表新增最高可达折扣、理论低价排序和凑件优惠筛选",
      "列表补充声优与‘单买即最优’提示，并修正活动结束时间解析",
    ],
    "0.5.1": [
      "本次可到价不高于史低时用金黄色，高于史低时用蓝灰色",
      "移入、移出、删除或移到稍后再买后立即重算门槛",
      "进一步隔离稍后再买与立即购买的金额和件数",
    ],
    "0.5.0": [
      "“本次可到”改为价格加圆形 OFF 标签，与史低同格式",
      "满1200减400和三件活动的门槛不再计入稍后再买作品",
      "移除需要手填规则的最优拆单规划器",
      "浏览列表的活动和优惠券放在价格趋势下方",
    ],
    "0.4.6": [
      "所有页面的“本次可到”都与史低拆框换行，并防止移动端溢出",
    ],
    "0.4.5": [
      "折后日元价简化为“880円”格式",
    ],
    "0.4.4": [
      "中文等本地货币价格后紧跟显示折后日元价",
    ],
    "0.4.3": [
      "详情页强制将“本次可到”与史低拆成上下两个独立框",
    ],
    "0.4.2": [
      "作品详情页将“本次可到”独立放在史低标签下方",
      "多张可用优惠券改为每种单独一行显示",
    ],
    "0.4.1": [
      "优惠券读取结果改为 5 秒临时提示，并同时显示张数与合并种类",
      "购物车和详情页改用紧凑的活动框与优惠券框",
      "稍后再买支持史低、本次可到和假设低价三种排序",
    ],
    "0.4.0": [
      "浏览列表与作品详情页显示可用优惠券和三件折扣活动",
      "史低标签后追加满足条件时的“本次可到”折扣",
      "按事件更新购物车进度，并限制作品信息为每页一次批量请求",
    ],
    "0.3.1": [
      "安装说明不再把 Tampermonkey 作为唯一运行方式",
      "补充 Via 等内置用户脚本浏览器的安装入口",
      "明确直接来源与间接上游的署名关系",
    ],
    "0.3.0": [
      "打开 DLsite 优惠券页时自动导入可用优惠券",
      "自动解析指定作品、类型和站点等适用范围",
      "支持期限内可重复使用的优惠券参与多次拆单",
    ],
    "0.2.0": [
      "购物车新增最优买法面板",
      "支持仅限指定 RJ/BJ 作品的百分比券与满减券",
      "支持三件折扣、优惠互斥和多张券拆单计算",
    ],
    "0.1.1.2": [
      "支持购物车页面显示提示标签",
      "新增【稍后再买】列表的智能排序（史低优先）开关+次级排序模式设置（低价优先/折扣优先）",
      "新增标签【无折扣记录】",
    ],
  };

  const RJ_CODE_REGEX = /\b([RB]J\d{6,})\b/i;
  const UI_CLASSNAME = "dltracker-lowest-price-card";
  const STYLE_ID = "dltracker-userscript-style";

  const DB_NAME = "dltracker-userscript";
  const DB_VERSION = 1;
  const STORE_PRICES = "prices";
  const STORE_FAVORITES = "favorites";

  const PRODUCT_PRICE_HOST_SELECTORS = [
    "#work_price .work_buy_container",
    "#work_price",
    "#work_buy",
    ".c-purchaseBox__priceInfo",
    ".c-purchaseBox__value",
    ".work_buy_container",
    ".work_buy_content",
    ".work_price_wrap",
    '[data-testid*="price"]',
  ];

  const WISHLIST_CARD_SELECTORS = [
    "#wishlist_work article",
    "#wishlist_work li",
    '[id*="wishlist"] article',
    '[id*="wishlist"] li',
    ".wishlist_work article",
    ".wishlist_work li",
  ];

  const CART_ITEM_SELECTORS = [
    "li.cart_list_item._cart_items",
    "li.cart_list_item[id^='buy_now_']",
    "li.cart_list_item[id^='buy_later_']",
    "li.cart_list_item[data-workno]",
    "li.n_work_list_item._cart_item",
    "li.n_work_list_item[id^='buy_now_']",
    "li.n_work_list_item[id^='buy_later_']",
    "li.n_work_list_item[data-workno]",
    ".__buy_now_target",
    ".__buy_later_target",
  ];
  const BUY_LATER_AREA_SELECTOR = [
    "div.buy_later",
    "section.buy_later",
    "li.buy_later",
    ".buy_later",
    ".cart_hold",
    "[id^='buy_later_']",
    "[data-cart-area='later']",
    "[data-area='later']",
  ].join(",");
  const BUY_NOW_AREA_SELECTOR = [
    "div.buy_now",
    "section.buy_now",
    "li.buy_now",
    ".buy_now",
    "li[id^='buy_now_']",
    "[data-cart-area='active']",
    "[data-area='active']",
  ].join(",");

  let dbPromise = null;
  const recordInFlight = new Map();
  const canonicalRjCache = new Map();
  const pendingRecommendationRestoreIds = new Set();
  let couponImportInFlight = null;
  let dealCouponFetchInFlight = null;
  let importedCouponPageUrl = "";
  let dealSessionStopped = false;
  let dealSessionStopReason = "";
  let accountIndexSessionStopped = false;
  let accountIndexSessionStopReason = "";
  let insightBootstrapInFlight = null;
  const dealInsightById = new Map();
  const browseRecordById = new Map();
  let latestDealContext = {
    coupons: [],
    cartSnapshot: { loaded: false, active: [], later: [], updatedAt: 0 },
    bulkRules: new Map(),
    partial: false,
  };
  let openReachProductId = "";
  let openReachDialogMode = "price";
  let openReachRenderToken = 0;
  let reachDialogScrollLock = null;
  let browseNativeSortPending = false;
  let pendingCartAdd = null;
  let cartRefreshInFlight = null;
  let dealToastTimer = null;
  let lastCartSnapshotFingerprint = "";
  let accountIndexRefreshInFlight = null;
  let accountIndexRuntimeFingerprint = "";
  let accountIndexRuntimeError = "";
  const accountReminderRenderTokens = new WeakMap();
  let openLanguageDialogState = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function getSeenUpdateVersion() {
    try {
      return String(localStorage.getItem(UPDATE_NOTICE_SEEN_VERSION_KEY) || "");
    } catch {
      return "";
    }
  }

  function setSeenUpdateVersion(version) {
    try {
      localStorage.setItem(UPDATE_NOTICE_SEEN_VERSION_KEY, String(version));
    } catch {
      // noop
    }
  }

  function showUpdateNoticeIfNeeded() {
    if (getSeenUpdateVersion() === APP_VERSION) return;

    const notes = Array.isArray(RELEASE_NOTES[APP_VERSION])
      ? RELEASE_NOTES[APP_VERSION]
      : ["本次版本包含功能优化与问题修复。"];
    const message = [
      `${APP_NAME} 已更新到 v${APP_VERSION}`,
      "",
      ...notes.map((x) => `- ${x}`),
    ].join("\n");

    console.info(message);
    setSeenUpdateVersion(APP_VERSION);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function mapWithConcurrency(items, limit, worker) {
    if (!Array.isArray(items) || !items.length) return;
    const concurrency = Math.max(1, Math.min(limit || 1, items.length));
    let cursor = 0;

    const run = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => run()));
  }

  function toYen(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    return `${Math.round(value).toLocaleString("ja-JP")}円`;
  }

  function safeNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  function hasEffectiveDiscount(record) {
    const discountRate = safeNumber(record?.discountRate);
    if (typeof discountRate === "number" && discountRate > 0) return true;

    const regularPrice = safeNumber(record?.regularPrice);
    const lowestPrice = safeNumber(record?.lowestPrice);
    if (
      typeof regularPrice === "number" &&
      typeof lowestPrice === "number" &&
      regularPrice - lowestPrice > 0.01
    ) {
      return true;
    }

    return false;
  }

  function parseNumberish(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "").trim();
      if (!cleaned) return undefined;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  // <deal-optimizer-core>
  function plannerYen(value, fallback = 0) {
    const parsed = parseNumberish(value);
    if (typeof parsed !== "number" || parsed < 0) return fallback;
    return Math.round(parsed);
  }

  function normalizePlannerItems(rawItems) {
    const seen = new Set();
    return (Array.isArray(rawItems) ? rawItems : []).map((raw, index) => {
      const id = String(raw?.id || `ITEM-${index + 1}`).toUpperCase();
      if (seen.has(id)) throw new Error(`作品编号重复：${id}`);
      seen.add(id);
      const regularPrice = plannerYen(raw?.regularPrice);
      const parsedSetPrice = parseNumberish(raw?.setPrice);
      const setPrice =
        typeof parsedSetPrice === "number" && parsedSetPrice >= 0
          ? Math.round(parsedSetPrice)
          : null;
      return {
        id,
        title: String(raw?.title || id),
        regularPrice,
        setPrice,
        setGroup: String(raw?.setGroup || "").trim(),
        setMinCount: Math.max(2, plannerYen(raw?.setMinCount, 3)),
      };
    });
  }

  function normalizePlannerCoupons(rawCoupons, itemIds) {
    const allItemIds = new Set(itemIds);
    return (Array.isArray(rawCoupons) ? rawCoupons : []).map((raw, index) => {
      const eligibleIds = Array.isArray(raw?.eligibleIds)
        ? raw.eligibleIds
            .map((id) => String(id).toUpperCase())
            .filter((id) => allItemIds.has(id))
        : [];
      const parsedValue = parseNumberish(raw?.value);
      return {
        id: String(raw?.id || `COUPON-${index + 1}`),
        name: String(raw?.name || `优惠券 ${index + 1}`),
        type: raw?.type === "fixed" ? "fixed" : "percent",
        value: raw?.type === "fixed"
          ? plannerYen(raw?.value)
          : Math.max(0, typeof parsedValue === "number" ? parsedValue : 0),
        minSpend: plannerYen(raw?.minSpend),
        minEligibleCount: Math.max(1, plannerYen(raw?.minEligibleCount, 1)),
        maxDiscount: plannerYen(raw?.maxDiscount),
        scope: raw?.scope === "one" ? "one" : "all",
        minSpendScope:
          raw?.minSpendScope === "eligible" ? "eligible" : "order",
        stackMode: ["after", "replace-target", "exclude-target"].includes(
          raw?.stackMode,
        )
          ? raw.stackMode
          : "after",
        allEligible:
          raw?.allEligible === true ||
          (raw?.allEligible === undefined && eligibleIds.length === 0),
        repeatable: raw?.repeatable === true,
        maxUses: raw?.repeatable === true
          ? Number.POSITIVE_INFINITY
          : Math.max(1, plannerYen(raw?.maxUses, 1)),
        eligibleIds,
      };
    });
  }

  function selectedPlannerIndexes(mask, count) {
    const indexes = [];
    for (let index = 0; index < count; index += 1) {
      if (mask & (1 << index)) indexes.push(index);
    }
    return indexes;
  }

  function quotePlannerSelection(items, selected, coupon = null, mask = null) {
    if (!selected.length) return null;

    const eligible = coupon
      ? selected.filter(
          (index) =>
            coupon.allEligible ||
            coupon.eligibleIds.includes(items[index].id),
        )
      : [];
    if (coupon && !eligible.length) return null;
    if (coupon && eligible.length < coupon.minEligibleCount) return null;

    const targetSets = !coupon
      ? [[]]
      : coupon.scope === "one"
        ? eligible.map((index) => [index])
        : [eligible];
    let best = null;

    for (const targets of targetSets) {
      const targetSet = new Set(targets);
      const groupCounts = new Map();
      for (const index of selected) {
        const item = items[index];
        const excluded =
          coupon?.stackMode === "exclude-target" && targetSet.has(index);
        if (!item.setGroup || excluded) continue;
        groupCounts.set(item.setGroup, (groupCounts.get(item.setGroup) || 0) + 1);
      }

      const lines = selected.map((index) => {
        const item = items[index];
        const dealApplied = Boolean(
          item.setGroup &&
            item.setPrice !== null &&
            item.setPrice < item.regularPrice &&
            (groupCounts.get(item.setGroup) || 0) >= item.setMinCount,
        );
        let price = dealApplied ? item.setPrice : item.regularPrice;
        if (
          targetSet.has(index) &&
          coupon &&
          coupon.stackMode !== "after"
        ) {
          price = item.regularPrice;
        }
        return {
          id: item.id,
          title: item.title,
          price,
          dealApplied:
            dealApplied &&
            !(targetSet.has(index) && coupon?.stackMode !== "after"),
          couponTarget: targetSet.has(index),
        };
      });
      const subtotal = lines.reduce((sum, line) => sum + line.price, 0);
      const couponBase = lines
        .filter((line) => line.couponTarget)
        .reduce((sum, line) => sum + line.price, 0);
      const thresholdBase =
        coupon?.minSpendScope === "eligible" ? couponBase : subtotal;
      if (coupon && thresholdBase < coupon.minSpend) continue;

      let discount = 0;
      if (coupon) {
        discount =
          coupon.type === "fixed"
            ? Math.min(coupon.value, couponBase)
            : Math.floor((couponBase * coupon.value) / 100);
        if (coupon.maxDiscount > 0) {
          discount = Math.min(discount, coupon.maxDiscount);
        }
        discount = Math.max(0, Math.min(discount, subtotal));
      }
      const quote = {
        mask,
        subtotal,
        discount,
        total: subtotal - discount,
        couponId: coupon?.id || null,
        couponName: coupon?.name || null,
        targetIds: lines
          .filter((line) => line.couponTarget)
          .map((line) => line.id),
        lines,
      };
      if (
        !best ||
        quote.total < best.total ||
        (quote.total === best.total && quote.discount > best.discount)
      ) {
        best = quote;
      }
    }

    return best;
  }

  function quotePlannerOrder(items, mask, coupon = null) {
    return quotePlannerSelection(
      items,
      selectedPlannerIndexes(mask, items.length),
      coupon,
      mask,
    );
  }

  function betterPlannerPlan(candidate, current) {
    if (!current) return true;
    if (candidate.total !== current.total) return candidate.total < current.total;
    if (candidate.orders.length !== current.orders.length) {
      return candidate.orders.length < current.orders.length;
    }
    return candidate.discount > current.discount;
  }

  function quoteBestSingleOrder(rawItems, rawCoupons) {
    const items = normalizePlannerItems(rawItems);
    if (!items.length) throw new Error("购物车中没有可计算的作品");
    const coupons = normalizePlannerCoupons(
      rawCoupons,
      items.map((item) => item.id),
    );
    const selected = items.map((_, index) => index);
    let best = quotePlannerSelection(items, selected);
    for (const coupon of coupons) {
      const quote = quotePlannerSelection(items, selected, coupon);
      if (!quote) continue;
      if (!best || quote.total < best.total ||
        (quote.total === best.total && quote.discount > best.discount)) {
        best = quote;
      }
    }
    return best;
  }

  function optimizeDealPlan(rawItems, rawCoupons) {
    const items = normalizePlannerItems(rawItems);
    if (!items.length) throw new Error("购物车中没有可计算的作品");
    if (items.length > DEAL_PLANNER_MAX_ITEMS) {
      throw new Error(
        `精确计算最多支持 ${DEAL_PLANNER_MAX_ITEMS} 部作品，请先减少购物车作品`,
      );
    }
    const coupons = normalizePlannerCoupons(
      rawCoupons,
      items.map((item) => item.id),
    );
    if (coupons.length > DEAL_PLANNER_MAX_COUPONS) {
      throw new Error(
        `精确计算最多支持 ${DEAL_PLANNER_MAX_COUPONS} 张券，请删除暂时不用的券`,
      );
    }

    const fullMask = (1 << items.length) - 1;
    const baseQuotes = new Map();
    const couponQuotes = coupons.map(() => new Map());
    const getBaseQuote = (mask) => {
      if (!mask) return null;
      if (!baseQuotes.has(mask)) {
        baseQuotes.set(mask, quotePlannerOrder(items, mask));
      }
      return baseQuotes.get(mask);
    };
    const getCouponQuote = (couponIndex, mask) => {
      const cache = couponQuotes[couponIndex];
      if (!cache.has(mask)) {
        cache.set(
          mask,
          quotePlannerOrder(items, mask, coupons[couponIndex]),
        );
      }
      return cache.get(mask);
    };

    const memo = new Map();
    const solve = (couponPosition, remainingMask, usesRemaining = null) => {
      const key = `${couponPosition}:${remainingMask}:${usesRemaining ?? "new"}`;
      if (memo.has(key)) return memo.get(key);
      if (couponPosition >= coupons.length) {
        const base = getBaseQuote(remainingMask);
        const result = {
          total: base?.total || 0,
          discount: 0,
          orders: base ? [base] : [],
        };
        memo.set(key, result);
        return result;
      }

      const coupon = coupons[couponPosition];
      const allowedUses = usesRemaining ?? Math.min(
        items.length,
        Number.isFinite(coupon.maxUses) ? coupon.maxUses : items.length,
      );
      let best = solve(couponPosition + 1, remainingMask, null);
      if (allowedUses <= 0) {
        memo.set(key, best);
        return best;
      }
      for (
        let orderMask = remainingMask;
        orderMask > 0;
        orderMask = (orderMask - 1) & remainingMask
      ) {
        const quote = getCouponQuote(couponPosition, orderMask);
        if (!quote || quote.discount <= 0) continue;
        const rest = allowedUses > 1
          ? solve(couponPosition, remainingMask ^ orderMask, allowedUses - 1)
          : solve(couponPosition + 1, remainingMask ^ orderMask, null);
        const candidate = {
          total: quote.total + rest.total,
          discount: quote.discount + rest.discount,
          orders: [quote, ...rest.orders],
        };
        if (betterPlannerPlan(candidate, best)) best = candidate;
      }
      memo.set(key, best);
      return best;
    };

    const baselineQuote = getBaseQuote(fullMask);
    const best = solve(0, fullMask, null);
    return {
      items,
      coupons,
      baseline: baselineQuote.total,
      total: best.total,
      savings: baselineQuote.total - best.total,
      discount: best.discount,
      orders: best.orders,
    };
  }
  // </deal-optimizer-core>

  function toCsvCell(raw) {
    if (raw === undefined || raw === null) return "";
    const value = String(raw);
    const formulaPrefix = /^[=+\-@\t\r]/.test(value) ? "'" : "";
    if (
      formulaPrefix ||
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n")
    ) {
      return `"${formulaPrefix}${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  function extractRjCodeFromUrl(url) {
    const pathMatch = url.match(/product_id\/([RB]J\d{6,})/i);
    if (pathMatch) return pathMatch[1].toUpperCase();
    const matched = url.match(RJ_CODE_REGEX);
    return matched ? matched[1].toUpperCase() : null;
  }

  function isProductPage(url) {
    return /\/product_id\/[RBV]J\d+/i.test(url);
  }

  function isFavoritePage(url) {
    return /\/(favorites?|wishlist)(?:[/?#]|$)/i.test(url);
  }

  function isCartPage(url) {
    return /\/cart(?:[/?#]|$)/i.test(url);
  }

  function isCouponPage(url) {
    return /\/mypage\/coupon(?:\/|[?#]|$)/i.test(url);
  }

  function isTouchPath(url) {
    return /-touch\//i.test(url);
  }

  function shouldStackBrowseAnalysis() {
    if (isTouchPath(location.href)) return true;
    try {
      const pointerQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
      if (typeof pointerQuery?.matches === "boolean") return pointerQuery.matches;
    } catch {
      // Older engines can lack matchMedia; maxTouchPoints is the semantic fallback.
    }
    return Number(window.navigator?.maxTouchPoints || 0) > 0;
  }

  function isNarrowViewport() {
    try {
      return window.matchMedia("(max-width: 900px)").matches;
    } catch {
      return window.innerWidth <= 900;
    }
  }

  function firstElementBySelectors(selectors, root) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function findProductPriceHost() {
    const direct = firstElementBySelectors(
      PRODUCT_PRICE_HOST_SELECTORS,
      document,
    );
    if (direct) return direct;

    const fuzzyCandidates = document.querySelectorAll(
      '[id*="price"], [class*="price"]',
    );
    for (const el of fuzzyCandidates) {
      const text = (el.textContent || "").replace(/\s+/g, " ");
      if (/円|jpy|rmb/i.test(text)) {
        return el;
      }
    }

    return null;
  }

  function ensureMobileProductRenderHost() {
    if (!isTouchPath(location.href) && !isNarrowViewport()) return null;

    const purchaseInner = document.querySelector(".c-purchaseBox__inner");
    if (!purchaseInner) return null;

    // 清理旧版本可能插在 c-purchaseBox 外层的容器，避免结构污染。
    const purchaseBox = document.querySelector(".c-purchaseBox");
    if (
      purchaseBox?.previousElementSibling?.classList?.contains(
        "dltracker-mobile-product-host",
      )
    ) {
      purchaseBox.previousElementSibling.remove();
    }

    const purchaseSection =
      purchaseInner.querySelector(":scope > .c-purchaseBox__purchase") ||
      purchaseInner.querySelector(".c-purchaseBox__purchase");
    if (!purchaseSection) return null;

    const allHosts = document.querySelectorAll(
      ".dltracker-mobile-product-host",
    );
    let host =
      purchaseSection.querySelector(
        ":scope > .dltracker-mobile-product-host",
      ) || purchaseSection.querySelector(".dltracker-mobile-product-host");

    if (!host) {
      host = document.createElement("div");
      host.className = "dltracker-mobile-product-host";
    }

    // 固定插在购买模块顶部（优惠券区前），确保单独一行且不影响上方价格/评分布局。
    if (
      host.parentElement !== purchaseSection ||
      host !== purchaseSection.firstElementChild
    ) {
      purchaseSection.prepend(host);
    }

    // 去重：只保留当前宿主，避免 SPA 场景重复注入。
    for (const node of allHosts) {
      if (node !== host) node.remove();
    }

    return host;
  }

  function findProductRenderHost() {
    // 移动端优先：插在 c-purchaseBox__purchase 顶部（优惠券区前），确保单独一行。
    const mobileHost = ensureMobileProductRenderHost();
    if (mobileHost) return mobileHost;
    return findProductPriceHost();
  }

  function hasProductContainer() {
    return !!(
      findProductPriceHost() ||
      document.querySelector(".c-purchaseBox") ||
      document.querySelector(".c-purchaseBox__inner") ||
      document.querySelector(".c-purchaseBox__purchase")
    );
  }

  function getWishlistCards() {
    for (const selector of WISHLIST_CARD_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length > 0) return [...nodes];
    }

    // 移动端兜底：按作品链接回溯到卡片容器。
    const links = document.querySelectorAll('a[href*="product_id/"]');
    if (!links.length) return [];

    const seen = new Set();
    const cards = [];
    for (const link of links) {
      const card = link.closest("article, li, .item, .product-item, .work");
      if (!card) continue;
      if (seen.has(card)) continue;
      seen.add(card);
      cards.push(card);
    }

    if (cards.length > 0) return cards;
    return [];
  }

  function findWishlistPriceHost(card) {
    const selectors = [
      "div.primary dl dd.work_price_wrap",
      "dd.work_price_wrap",
      ".work_price_wrap",
      '[class*="price"]',
      "dd",
      "dl",
    ];

    for (const selector of selectors) {
      const node = card.querySelector(selector);
      if (node) return node;
    }

    const productLink = card.querySelector('a[href*="product_id/"]');
    if (productLink) {
      const fallbackHost = document.createElement("div");
      fallbackHost.className = "dltracker-inline-host";
      productLink.insertAdjacentElement("afterend", fallbackHost);
      return fallbackHost;
    }

    return card;
  }

  function ensureWishlistRenderHost(card, priceHost) {
    if (priceHost) {
      const legacyCard = priceHost.querySelector(`.${UI_CLASSNAME}`);
      if (legacyCard) legacyCard.remove();
    }

    const existed = card.querySelector(".dltracker-wishlist-host");
    if (existed) return existed;

    const host = document.createElement("div");
    host.className = "dltracker-wishlist-host";

    if (
      priceHost &&
      priceHost !== card &&
      priceHost.parentElement &&
      card.contains(priceHost)
    ) {
      priceHost.insertAdjacentElement("afterend", host);
    } else {
      card.appendChild(host);
    }

    return host;
  }

  function findFavoritePanelAnchor() {
    const wishlistRoot = firstElementBySelectors(
      [
        "#wishlist_work",
        '[id*="wishlist_work"]',
        '[id*="wishlist"]',
        ".wishlist_work",
      ],
      document,
    );
    if (wishlistRoot) {
      return {
        parent: wishlistRoot.parentElement || document.body,
        before: wishlistRoot,
      };
    }

    const mainInner = document.querySelector("#main_inner");
    if (mainInner) {
      return {
        parent: mainInner,
        before: mainInner.firstChild,
      };
    }

    const main = document.querySelector("main");
    if (main) {
      return {
        parent: main,
        before: main.firstChild,
      };
    }

    return {
      parent: document.body,
      before: document.body.firstChild,
    };
  }

  function hasWishlistContainer() {
    return (
      getWishlistCards().length > 0 ||
      !!firstElementBySelectors(
        ["#wishlist_work", '[id*="wishlist"]'],
        document,
      )
    );
  }

  function getCartItems() {
    const items = [];
    const seen = new Set();
    const selectors = [...CART_ITEM_SELECTORS, "li.cart_list_item"];
    const listItemSelector = "li.cart_list_item, li.n_work_list_item";
    const cartTargetSelector = ".__buy_now_target, .__buy_later_target";

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const item =
          node.closest(listItemSelector) ||
          node.closest(cartTargetSelector) ||
          node;
        if (seen.has(item)) continue;
        seen.add(item);
        items.push(item);
      }
    }

    return items;
  }

  function hasCartContainer() {
    return getCartItems().some((item) => isRenderableCartItem(item));
  }

  function findCartPriceHost(item) {
    const selectors = [
      ".__buy_now_target .n_work_price_wrap",
      ".__buy_later_target .n_work_price_wrap",
      ".n_work_price_wrap",
      ".__buy_now_target .work_price",
      ".__buy_later_target .work_price",
      ".work_price",
    ];
    for (const selector of selectors) {
      const node = item.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function findCartOperationAnchor(item) {
    const inner =
      item.querySelector(".__buy_now_target .cart_list_item_inner") ||
      item.querySelector(".__buy_later_target .cart_list_item_inner") ||
      item.querySelector(".cart_list_item_inner") ||
      item;
    if (inner !== item && inner.parentElement) {
      return { parent: inner.parentElement, before: inner.nextSibling };
    }
    return { parent: item, before: null };
  }

  function ensureCartRenderHost(item) {
    const existed = item.querySelector(".dltracker-cart-host");
    const placement = findCartOperationAnchor(item);
    if (existed) {
      const oldParent = existed.parentElement;
      oldParent?.classList.remove("dltracker-cart-layout-parent");
      const needsMove = placement.parent && placement.before !== existed && (
        oldParent !== placement.parent ||
        existed.nextSibling !== placement.before
      );
      if (needsMove) {
        placement.parent.insertBefore(existed, placement.before);
      }
      return existed;
    }

    const host = document.createElement("div");
    host.className = "dltracker-cart-host";
    if (placement.parent) {
      placement.parent.insertBefore(host, placement.before);
      return host;
    }

    item.appendChild(host);
    return host;
  }

  function extractRjCodeFromCartItem(item) {
    const concrete = concreteCartProductId(item);
    if (concrete) return concrete;
    const fromData =
      item.getAttribute("data-workno") ||
      item.getAttribute("data-product-id") ||
      item.getAttribute("data-pack-parent-id");
    if (fromData && isValidProductCode(fromData)) return fromData.toUpperCase();

    const link = item.querySelector('a[href*="product_id/"]');
    const href = link?.getAttribute("href") || "";
    const productMatched = `${fromData || ""} ${href}`.match(/product_id\/([RBV]J\d{6,})/i);
    return productMatched ? productMatched[1].toUpperCase() : null;
  }

  function parseTranslationInfo(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    const normalized = raw.replace(/&quot;/g, '"');
    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }

  function extractFallbackRjCodesFromCartItem(item, primaryRjCode) {
    const result = [];
    const seen = new Set([String(primaryRjCode || "").toUpperCase()]);
    const add = (value) => {
      if (!isValidRjCode(value)) return;
      const code = String(value).toUpperCase();
      if (seen.has(code)) return;
      seen.add(code);
      result.push(code);
    };

    const info = parseTranslationInfo(
      item.getAttribute("data-translation_info"),
    );
    add(info?.parent_workno);
    add(info?.original_workno);

    const fromData = [
      item.getAttribute("data-pack-parent-id"),
      item.getAttribute("data-product-id"),
      item.getAttribute("data-workno"),
    ];
    for (const code of fromData) add(code);

    const productLink = item.querySelector('a[href*="product_id/"]');
    if (productLink) {
      const href = productLink.getAttribute("href") || "";
      add(extractRjCodeFromUrl(href));
      try {
        const url = new URL(href, location.origin);
        add(url.searchParams.get("translation"));
      } catch {
        // noop
      }
    }

    return result;
  }

  async function resolveCanonicalRjCodeFromProductHref(productHref) {
    if (typeof productHref !== "string" || !productHref.trim()) return null;
    const href = productHref.trim();
    if (canonicalRjCache.has(href)) {
      return canonicalRjCache.get(href) || null;
    }

    try {
      const response = await fetch(href, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
      });
      const resolved = extractRjCodeFromUrl(response.url || href);
      const code = isValidRjCode(resolved) ? resolved : null;
      canonicalRjCache.set(href, code);
      return code;
    } catch (error) {
      console.warn(`[${APP_NAME}] resolve canonical RJ failed:`, error);
      canonicalRjCache.set(href, null);
      return null;
    }
  }

  function isRenderableCartItem(item) {
    if (!item) return false;
    const ownerItem =
      item.closest("li.cart_list_item, li.n_work_list_item") || item;
    if (isHiddenOrRemovedCartItem(ownerItem)) return false;
    const hasCartTarget =
      ownerItem.matches?.(".__buy_now_target, .__buy_later_target") ||
      !!ownerItem.querySelector(".__buy_now_target, .__buy_later_target");
    if (!hasCartTarget) return false;
    return true;
  }

  function getPlannerState() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(DEAL_PLANNER_STORAGE_KEY) || "null",
      );
      return {
        coupons: Array.isArray(parsed?.coupons) ? parsed.coupons : [],
        itemOverrides:
          parsed?.itemOverrides && typeof parsed.itemOverrides === "object"
            ? parsed.itemOverrides
            : {},
        lastCouponImport:
          parsed?.lastCouponImport && typeof parsed.lastCouponImport === "object"
            ? parsed.lastCouponImport
            : null,
      };
    } catch {
      return { coupons: [], itemOverrides: {}, lastCouponImport: null };
    }
  }

  function savePlannerState(state) {
    try {
      localStorage.setItem(DEAL_PLANNER_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn(`[${APP_NAME}] save deal planner state failed:`, error);
    }
  }

  // <coupon-import-core>
  function firstNumberish(objects, keys, fallback = 0) {
    for (const object of objects) {
      if (!object || typeof object !== "object") continue;
      for (const key of keys) {
        const parsed = parseNumberish(object[key]);
        if (typeof parsed === "number") return parsed;
        for (const token of conditionTokens(object[key])) {
          const nested = parseNumberish(token);
          if (typeof nested === "number") return nested;
        }
      }
    }
    return fallback;
  }

  function conditionTokens(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(conditionTokens);
    if (typeof value === "object") {
      return Object.values(value).flatMap(conditionTokens);
    }
    return [String(value)];
  }

  function inferRepeatableCoupon(raw, combinedText) {
    const booleanFields = [
      "unlimited",
      "is_unlimited",
      "repeatable",
      "is_multiple_use",
      "repeat_flg",
      "reuse_flg",
      "use_unlimited_flg",
    ];
    for (const field of booleanFields) {
      if (!(field in raw)) continue;
      const value = raw[field];
      if (value === true || value === 1 || value === "1") return true;
      if (value === false || value === 0 || value === "0") return false;
    }
    if (
      /期[間间]中.{0,8}何度でも|何度でも利用|回数制限なし|無制限|不限次数|无限使用/i.test(
        combinedText,
      )
    ) {
      return true;
    }
    return false;
  }

  function normalizeDlsiteCoupon(raw, index) {
    const conditions =
      raw?.conditions && typeof raw.conditions === "object"
        ? raw.conditions
        : {};
    const conditionType = String(raw?.condition_type || "").toLowerCase();
    const combinedText = [
      raw?.coupon_name,
      raw?.description,
      raw?.info,
      raw?.condition_info,
      raw?.notes,
      JSON.stringify(raw),
    ]
      .filter(Boolean)
      .join(" ");
    const discountType = String(raw?.discount_type || "").toLowerCase();
    if (!['rate', 'price'].includes(discountType)) return null;

    const textThreshold = combinedText.match(/([\d,]+)\s*円以上/i);
    const textMaximum = combinedText.match(/(?:最大|上限)\s*([\d,]+)\s*円/i);
    const minSpend = firstNumberish(
      [raw, conditions],
      [
        "minimum_applicable_price",
        "minimum_order_amount",
        "minimum_price",
        "min_price",
        "lower_limit_price",
        "price_sum",
      ],
      textThreshold ? Number(textThreshold[1].replace(/,/g, "")) : 0,
    );
    const maxDiscount = firstNumberish(
      [raw, conditions],
      ["maximum_discount_price", "max_discount", "discount_limit"],
      textMaximum ? Number(textMaximum[1].replace(/,/g, "")) : 0,
    );
    const eligibleIds = conditionType === "id_all"
      ? conditionTokens(conditions.product_all)
          .map((id) => String(id).toUpperCase())
          .filter((id) => /^[RBV]J\d{6,}$/i.test(id))
      : [];
    const unrestricted = ["", "all", "all_product", "product_all", "payment"].includes(
      conditionType,
    );
    const repeatable = inferRepeatableCoupon(raw, combinedText);
    const warnings = [];
    if (
      !unrestricted &&
      !["id_all", "custom_genre", "site_ids", "worktype", "common", "payment"].includes(
        conditionType,
      )
    ) {
      warnings.push(`暂不认识适用条件 ${conditionType || "（空）"}`);
    }
    if (
      !repeatable &&
      !/(?:1回|一回|一度|一枚|一次のみ|一度のみ)/i.test(combinedText)
    ) {
      warnings.push("未发现明确的使用次数字段，暂按一次性券计算");
    }

    const expiresNumber = parseNumberish(raw?.limit_date);
    const expiresAt = typeof expiresNumber === "number"
      ? new Date(expiresNumber > 1e12 ? expiresNumber : expiresNumber * 1000).toISOString()
      : null;
    return {
      id: `dlsite-${String(raw?.coupon_id || index + 1)}`,
      source: "dlsite",
      sourceCouponId: String(raw?.coupon_id || ""),
      sourceConditionType: conditionType,
      sourceConditions: conditions,
      name: String(raw?.coupon_name || `DLsite 优惠券 ${index + 1}`),
      type: discountType === "price" ? "fixed" : "percent",
      value: plannerYen(raw?.discount),
      minSpend: plannerYen(minSpend),
      minEligibleCount: Math.max(
        1,
        plannerYen(conditions?.post_condition?.count, 1),
      ),
      maxDiscount: plannerYen(maxDiscount),
      scope:
        /(?:1作品|1本|1点|一作品|一商品)/i.test(combinedText)
          ? "one"
          : "all",
      minSpendScope: "order",
      stackMode: "after",
      repeatable,
      allEligible: unrestricted,
      eligibleIds: [...new Set(eligibleIds)],
      expiresAt,
      autoWarnings: warnings,
    };
  }

  function couponArrayFromPayload(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["coupons", "items", "data", "values"]) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }
  // </coupon-import-core>

  // <deal-insight-core>
  function dealNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  function dealTokens(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(dealTokens);
    if (typeof value === "object") return Object.values(value).flatMap(dealTokens);
    return [String(value)];
  }

  function dealPlainText(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cartAreaFromMarkerText(value) {
    const marker = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    if (/(?:^|_)(?:buy_later|cart_hold)(?:_|$)/.test(marker) ||
      /(?:^|_)later(?:_|$)/.test(marker)) {
      return "later";
    }
    if (/(?:^|_)buy_now(?:_|$)/.test(marker) ||
      /(?:^|_)active(?:_|$)/.test(marker)) {
      return "active";
    }
    return "unknown";
  }

  function lastYenPriceFromText(value) {
    const matches = [...String(value || "")
      .replace(/,/g, "")
      .matchAll(/(\d{1,8}(?:\.\d{1,2})?)\s*(?:円|JPY)/gi)];
    return matches.length ? Number(matches.at(-1)[1]) : null;
  }

  function lastCnyPriceFromText(value) {
    const text = String(value || "").replace(/,/g, "");
    const explicit = [...text.matchAll(
      /(?:RMB|CNY|CN\s*[¥￥]|人民币)\s*(\d{1,8}(?:\.\d{1,2})?)/gi,
    )];
    if (explicit.length) return Number(explicit.at(-1)[1]);
    // 中文站点有时只显示货币符号。只接受带小数的本地价，避免把
    // “¥1100”一类日元原价或划线价误当成人民币。
    const symbolic = [...text.matchAll(/[¥￥]\s*(\d{1,8}\.\d{1,2})/g)];
    return symbolic.length ? Number(symbolic.at(-1)[1]) : null;
  }

  function dealNormalizedSite(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/-touch$|touch$/g, "")
      .replace(/-/g, "");
  }

  function dealDateMillis(value) {
    const numeric = dealNumber(value, NaN);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const japanDate = String(value || "").match(
      /^(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)[ T]([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/,
    );
    if (japanDate) {
      return Date.UTC(
        Number(japanDate[1]),
        Number(japanDate[2]) - 1,
        Number(japanDate[3]),
        Number(japanDate[4]) - 9,
        Number(japanDate[5]),
        Number(japanDate[6] || 0),
      );
    }
    const parsed = Date.parse(String(value || "").replace(" ", "T"));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function platformDiscountExpiryMillis(product, now = Date.now()) {
    const raw = product?.raw && typeof product.raw === "object"
      ? product.raw
      : product || {};
    const price = dealNumber(product?.price ?? raw?.price, 0);
    const officialPrice = dealNumber(
      product?.officialPrice ?? raw?.official_price ?? raw?.regular_price,
      price,
    );
    const explicitlyDiscounted = raw?.is_discount === true ||
      raw?.is_discount === 1 ||
      String(raw?.is_discount || "").toLowerCase() === "true" ||
      dealNumber(raw?.discount_rate, 0) > 0;
    if (!(price > 0 && officialPrice > price) && !explicitlyDiscounted) {
      return Number.POSITIVE_INFINITY;
    }
    const value = product?.platformDiscountExpiresAt ??
      raw?.discount_end_date ?? raw?.discount_end_at ?? raw?.discount_to_date;
    const short = String(value || "").trim().match(
      /^(\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/,
    );
    let expiresAt;
    if (short) {
      const japanNow = new Date(now + 9 * 60 * 60 * 1000);
      let year = japanNow.getUTCFullYear();
      expiresAt = Date.UTC(
        year,
        Number(short[1]) - 1,
        Number(short[2]),
        Number(short[3]) - 9,
        Number(short[4]),
        0,
      );
      if (expiresAt < now - 180 * 24 * 60 * 60 * 1000) {
        year += 1;
        expiresAt = Date.UTC(
          year,
          Number(short[1]) - 1,
          Number(short[2]),
          Number(short[3]) - 9,
          Number(short[4]),
          0,
        );
      }
    } else {
      expiresAt = dealDateMillis(value);
    }
    return Number.isFinite(expiresAt) && expiresAt > now
      ? expiresAt
      : Number.POSITIVE_INFINITY;
  }

  function normalizeDealCoupon(raw, index = 0) {
    if (!raw || typeof raw !== "object") return null;
    const discountKind = String(raw.discount_type || "").toLowerCase();
    if (!['rate', 'price'].includes(discountKind)) return null;
    const conditions = raw.conditions && typeof raw.conditions === "object"
      ? raw.conditions
      : {};
    const conditionType = String(raw.condition_type || "").toLowerCase();
    const combinedText = dealPlainText([
      raw.coupon_name,
      raw.info,
      raw.condition_info,
    ].filter(Boolean).join("\n"));
    const textMinimum = combinedText.match(/([\d,]+)\s*(?:円|엔|日元|JPY)(?:以上|이상|起)?/i);
    const minimumValue = conditions.price_sum ??
      raw.minimum_applicable_price ?? raw.minimum_order_amount;
    const minSpend = dealNumber(
      dealTokens(minimumValue)[0],
      textMinimum ? dealNumber(textMinimum[1]) : 0,
    );
    const postCondition = conditions.post_condition || {};
    const minCount = Math.max(1, Math.round(dealNumber(postCondition.count, 1)));
    const repeatable = raw.is_multiple_use === true ||
      raw.is_multiple_use === 1 ||
      /何回でも|回数制限なし|不限次数|无限使用|무제한|횟수 제한 없음/i.test(combinedText);
    const expiresAt = dealDateMillis(raw.limit_date ?? raw.end_date);
    const productIds = dealTokens(conditions.product_all)
      .map((value) => String(value).toUpperCase())
      .filter((value) => /^[RBV]J\d{6,}$/i.test(value));
    const coupon = {
      id: String(raw.coupon_id || `coupon-${index + 1}`),
      name: dealPlainText(raw.coupon_name) || `优惠券 ${index + 1}`,
      info: dealPlainText(raw.info),
      conditionInfo: dealPlainText(raw.condition_info),
      conditionType,
      discountType: discountKind === "rate" ? "percent" : "fixed",
      discount: Math.max(0, dealNumber(raw.discount)),
      maxDiscount: Math.max(0, dealNumber(
        raw.maximum_discount_price ?? raw.max_discount ??
        conditions.maximum_discount_price ?? conditions.max_discount,
      )),
      minSpend: Math.max(0, minSpend),
      minCount,
      maxPrice: Math.max(0, dealNumber(
        conditions.maximum_applicable_price ?? conditions.maximum_price,
      )),
      productIds: [...new Set(productIds)],
      makerIds: [...new Set(dealTokens(conditions.maker_id))],
      siteIds: [...new Set(dealTokens(conditions.site_ids).map(dealNormalizedSite))],
      customGenres: [...new Set(dealTokens(conditions.custom_genre))],
      workTypes: [...new Set(dealTokens(conditions.worktype).map((x) => String(x).toLowerCase()))],
      distributeTargets: [...new Set(dealTokens(raw.distribute_targets).map(dealNormalizedSite))],
      repeatable,
      usageCount: Math.max(0, dealNumber(raw.limited_usage_count)),
      usageLimit: Math.max(0, dealNumber(raw.limited_usage_limit)),
      expiresAt,
      relativeExpiry: raw.is_static_limit === false,
      raw,
    };
    return coupon;
  }

  function dealCouponGroupKey(coupon) {
    const sorted = (values) => [...values].sort().join(",");
    return [
      coupon.conditionType,
      coupon.discountType,
      coupon.discount,
      coupon.maxDiscount,
      coupon.minSpend,
      coupon.minCount,
      coupon.maxPrice,
      sorted(coupon.productIds),
      sorted(coupon.makerIds),
      sorted(coupon.siteIds),
      sorted(coupon.customGenres),
      sorted(coupon.workTypes),
      sorted(coupon.distributeTargets),
      coupon.repeatable ? "repeat" : "single",
      coupon.relativeExpiry ? "relative" : "fixed-expiry",
    ].join("|");
  }

  function groupDealCoupons(rawCoupons, now = Date.now()) {
    const groups = new Map();
    (Array.isArray(rawCoupons) ? rawCoupons : [])
      .map(normalizeDealCoupon)
      .filter(Boolean)
      .filter((coupon) => !coupon.expiresAt || coupon.expiresAt > now)
      .forEach((coupon) => {
        const key = dealCouponGroupKey(coupon);
        const group = groups.get(key);
        if (!group) {
          groups.set(key, {
            ...coupon,
            groupKey: key,
            ids: [coupon.id],
            names: [coupon.name],
            instances: 1,
            earliestExpiry: coupon.expiresAt,
            originals: [{
              id: coupon.id,
              name: coupon.name,
              info: coupon.info,
              conditionInfo: coupon.conditionInfo,
              expiresAt: coupon.expiresAt,
            }],
          });
          return;
        }
        group.ids.push(coupon.id);
        group.names.push(coupon.name);
        group.instances += 1;
        group.originals.push({
          id: coupon.id,
          name: coupon.name,
          info: coupon.info,
          conditionInfo: coupon.conditionInfo,
          expiresAt: coupon.expiresAt,
        });
        if (!group.earliestExpiry ||
          (coupon.expiresAt && coupon.expiresAt < group.earliestExpiry)) {
          group.earliestExpiry = coupon.expiresAt;
        }
      });
    return [...groups.values()];
  }

  function dealProductIds(product) {
    return new Set([product?.id, ...(product?.alternateIds || [])]
      .filter(Boolean)
      .map((value) => String(value).toUpperCase()));
  }

  function couponMatchesDealProduct(coupon, product) {
    if (!coupon || !product?.id) return false;
    const price = dealNumber(product.price);
    if (coupon.maxPrice > 0 && price > coupon.maxPrice) return false;
    const type = coupon.conditionType;
    if (["", "all", "all_product", "product_all", "payment"].includes(type)) {
      return true;
    }
    if (type === "id_all") {
      const ids = dealProductIds(product);
      return coupon.productIds.some((id) => ids.has(id));
    }
    if (type === "common") {
      return coupon.makerIds.length > 0 &&
        coupon.makerIds.includes(String(product.makerId || ""));
    }
    if (type === "site_ids") {
      const site = dealNormalizedSite(product.siteId || product.site || "");
      return coupon.siteIds.includes(site);
    }
    if (type === "custom_genre") {
      const genres = new Set(dealTokens(product.customGenres));
      return coupon.customGenres.some((value) => genres.has(value));
    }
    if (type === "worktype") {
      const workType = String(product.workType || "").toLowerCase();
      return coupon.workTypes.includes(workType);
    }
    return false;
  }

  function couponEquivalentRate(coupon, product) {
    if (coupon.discountType === "percent") {
      const basis = Math.max(1, dealNumber(product?.price));
      const rawDiscount = basis * Math.min(100, coupon.discount) / 100;
      const discount = coupon.maxDiscount > 0
        ? Math.min(rawDiscount, coupon.maxDiscount)
        : rawDiscount;
      return Math.min(100, discount / basis * 100);
    }
    const basis = coupon.minSpend > 0
      ? coupon.minSpend
      : Math.max(1, dealNumber(product?.price));
    return Math.min(100, (coupon.discount / basis) * 100);
  }

  function buildDealCouponOptions(
    coupons,
    product,
    cartProducts = [],
    cartSubtotalOverride = null,
  ) {
    const cart = Array.isArray(cartProducts) ? cartProducts : [];
    const fallbackSubtotal = cart.reduce((sum, item) =>
      sum + Math.max(0, dealNumber(item?.price)), 0);
    const cartSubtotal = Number.isFinite(cartSubtotalOverride)
      ? Math.max(0, cartSubtotalOverride)
      : fallbackSubtotal;
    return (Array.isArray(coupons) ? coupons : [])
      .filter((coupon) => couponMatchesDealProduct(coupon, product))
      .map((coupon) => {
        const eligibleCartCount = cart.filter((item) =>
          couponMatchesDealProduct(coupon, item),
        ).length;
        const countShortfall = Math.max(0, coupon.minCount - eligibleCartCount);
        const spendShortfall = Math.max(0, coupon.minSpend - cartSubtotal);
        return {
          ...coupon,
          equivalentRate: couponEquivalentRate(coupon, product),
          eligibleCartCount,
          cartSubtotal,
          countShortfall,
          spendShortfall,
          ready: countShortfall === 0 && spendShortfall === 0,
        };
      })
      .sort((a, b) => b.equivalentRate - a.equivalentRate ||
        (a.earliestExpiry || Infinity) - (b.earliestExpiry || Infinity));
  }

  function calculateBestReach(product, couponOptions, bulkRule) {
    const officialPrice = Math.max(0, dealNumber(product?.officialPrice));
    const currentPrice = Math.max(0, dealNumber(product?.price));
    const saleRate = officialPrice > 0 && currentPrice < officialPrice
      ? (1 - currentPrice / officialPrice) * 100
      : 0;
    const bulkRate = product?.bulkbuyKey && bulkRule?.discountRate
      ? Math.max(0, dealNumber(bulkRule.discountRate))
      : 0;
    const platformRate = Math.max(saleRate, bulkRate);
    const platformPrice = officialPrice * (1 - platformRate / 100);
    const rankedCoupons = (Array.isArray(couponOptions) ? couponOptions : [])
      .map((coupon) => {
        let rate = coupon.equivalentRate;
        if (coupon.discountType === "percent") {
          const rawDiscount = platformPrice * Math.min(100, coupon.discount) / 100;
          const discount = coupon.maxDiscount > 0
            ? Math.min(rawDiscount, coupon.maxDiscount)
            : rawDiscount;
          rate = platformPrice > 0 ? discount / platformPrice * 100 : 0;
        } else if (!(coupon.minSpend > 0)) {
          rate = platformPrice > 0
            ? Math.min(100, coupon.discount / platformPrice * 100)
            : 0;
        }
        return { coupon, rate };
      })
      .sort((a, b) => b.rate - a.rate ||
        (a.coupon.earliestExpiry || Infinity) -
          (b.coupon.earliestExpiry || Infinity));
    const bestCoupon = rankedCoupons[0]?.coupon || null;
    const couponRate = rankedCoupons[0]?.rate || 0;
    const totalRate = 100 - ((100 - platformRate) * (100 - couponRate)) / 100;
    return {
      saleRate,
      bulkRate,
      platformRate,
      couponRate,
      totalRate: Math.max(0, Math.min(100, totalRate)),
      bestCoupon,
      fixedOrderApproximation: bestCoupon?.discountType === "fixed" &&
        bestCoupon?.minSpend > 0,
    };
  }

  function calculateHypotheticalPrice(product, bestReach) {
    const officialPrice = Math.max(0, dealNumber(product?.officialPrice));
    const rate = Math.max(0, Math.min(100, dealNumber(bestReach?.totalRate)));
    return officialPrice > 0
      ? Math.round(officialPrice * (1 - rate / 100))
      : Number.POSITIVE_INFINITY;
  }

  function isSingleBuyOptimal(product, couponOptions, bulkRule, bestReach) {
    const officialPrice = Math.max(0, dealNumber(product?.officialPrice));
    const currentPrice = Math.max(0, dealNumber(product?.price));
    if (!(officialPrice > 0) || !(currentPrice >= 0)) return false;
    const targetPrice = calculateHypotheticalPrice(product, bestReach);
    if (!Number.isFinite(targetPrice)) return false;
    const saleRate = officialPrice > 0 && currentPrice < officialPrice
      ? (1 - currentPrice / officialPrice) * 100
      : 0;
    const singleCoupons = (Array.isArray(couponOptions) ? couponOptions : [])
      .filter((coupon) => coupon.minCount <= 1 && coupon.minSpend <= currentPrice);
    const rates = [0, ...singleCoupons.map((coupon) => coupon.equivalentRate)];
    const singleBestPrice = Math.min(...rates.map((couponRate) => Math.round(
      officialPrice * (1 - saleRate / 100) * (1 - couponRate / 100),
    )));
    const bulkNeedsOthers = dealNumber(bulkRule?.minCount, 1) > 1 &&
      dealNumber(bestReach?.bulkRate) > saleRate;
    return !bulkNeedsOthers && singleBestPrice <= targetPrice;
  }

  function extractVoiceActorNames(raw) {
    const names = [];
    const add = (value) => {
      const text = dealPlainText(value);
      if (!text || /^\d+$/.test(text) || names.includes(text)) return;
      names.push(text);
    };
    const collect = (value) => {
      if (value === null || value === undefined) return;
      if (typeof value === "string" || typeof value === "number") {
        String(value).split(/[\n,，、／/]+/).forEach(add);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      if (typeof value === "object") {
        const direct = value.name ?? value.actor_name ?? value.creater_name ??
          value.creator_name ?? value.label ?? value.value;
        if (direct !== undefined) {
          collect(direct);
          return;
        }
        Object.values(value).forEach(collect);
      }
    };
    if (typeof raw === "string" || typeof raw === "number" || Array.isArray(raw)) {
      collect(raw);
      return names;
    }
    const sources = [
      raw?.voice_actor,
      raw?.voice_actors,
      raw?.voiceActor,
      raw?.voiceActors,
      raw?.cv,
      raw?.casts?.voice_actor,
      raw?.creater?.voice_actor,
      raw?.creaters?.voice_actor,
      raw?.creators?.voice_actor,
    ];
    sources.forEach(collect);
    for (const collection of [raw?.creater, raw?.creaters, raw?.creators, raw?.casts]) {
      if (Array.isArray(collection)) {
        collection
          .filter((entry) => /voice|actor|cv|声優|声优|配音/i.test(dealPlainText(
            entry?.role ?? entry?.type ?? entry?.category ?? entry?.label ??
              entry?.creater_type ?? entry?.creator_type,
          )))
          .forEach(collect);
        continue;
      }
      if (!collection || typeof collection !== "object") continue;
      for (const [key, value] of Object.entries(collection)) {
        if (/voice|actor|cv|声優|声优|配音/i.test(key)) collect(value);
      }
    }
    return names;
  }

  function mergeBrowseVoiceActorNames(workType, metadataNames, cardAuthors) {
    const sources = [metadataNames];
    if (String(workType || "").toUpperCase() === "SOU") {
      sources.push(cardAuthors);
    }
    return extractVoiceActorNames(sources);
  }

  function compareDealSortEntries(a, b, mode) {
    if (mode === "platform-expiry") {
      if (a.platformDiscountExpiry !== b.platformDiscountExpiry) {
        return a.platformDiscountExpiry - b.platformDiscountExpiry;
      }
      return a.order - b.order;
    }
    if (mode === "reach" && a.reachRank !== b.reachRank) {
      return b.reachRank - a.reachRank;
    }
    if (mode === "price" && a.hypotheticalPrice !== b.hypotheticalPrice) {
      return a.hypotheticalPrice - b.hypotheticalPrice;
    }
    if (a.isNewLowest !== b.isNewLowest) {
      return a.isNewLowest ? -1 : 1;
    }
    return a.order - b.order;
  }

  function activeCartFingerprint(products) {
    return JSON.stringify(
      (Array.isArray(products) ? products : [])
        .map((item) => [
          String(item?.id || "").toUpperCase(),
          Math.max(0, dealNumber(item?.price)),
          String(item?.bulkbuyKey || ""),
        ])
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
  }

  function cartSnapshotFingerprint(snapshot) {
    return JSON.stringify([
      activeCartFingerprint(snapshot?.active || snapshot?.products || []),
      activeCartFingerprint(snapshot?.later || []),
    ]);
  }
  // </deal-insight-core>

  function emptyDealCache() {
    return {
      coupons: { loaded: false, raw: [], fetchedAt: 0, accountKey: "" },
      metadata: {},
      bulkRules: {},
    };
  }

  function loadDealCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DEAL_CACHE_STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return emptyDealCache();
      return {
        ...emptyDealCache(),
        ...parsed,
        coupons: { ...emptyDealCache().coupons, ...(parsed.coupons || {}) },
        metadata: parsed.metadata && typeof parsed.metadata === "object"
          ? parsed.metadata
          : {},
        bulkRules: parsed.bulkRules && typeof parsed.bulkRules === "object"
          ? parsed.bulkRules
          : {},
      };
    } catch {
      return emptyDealCache();
    }
  }

  function saveDealCache(cache) {
    try {
      localStorage.setItem(DEAL_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.warn(`[${APP_NAME}] deal cache write failed:`, error);
    }
  }

  function quickHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function currentAccountKey() {
    const explicit = document.querySelector(
      "[data-customer-id], [data-user-id], input[name='customer_id']",
    );
    const value = explicit?.getAttribute("data-customer-id") ||
      explicit?.getAttribute("data-user-id") || explicit?.value || "";
    return value ? `account-${quickHash(value)}` : "account-unresolved";
  }

  function stopDealRequests(reason) {
    dealSessionStopped = true;
    dealSessionStopReason = String(reason || "检测到风控信号");
    console.warn(`[${APP_NAME}] DLsite deal requests stopped for this page: ${reason}`);
  }

  function requestSessionStopped(session = "deal") {
    return session === "account" ? accountIndexSessionStopped : dealSessionStopped;
  }

  function stopRequestSession(session, reason) {
    if (session !== "account") {
      stopDealRequests(reason);
      return;
    }
    accountIndexSessionStopped = true;
    accountIndexSessionStopReason = String(reason || "检测到风控信号");
    console.warn(`[${APP_NAME}] account index requests stopped: ${reason}`);
  }

  function showDealToast(message, isError = false, durationMs = 5000) {
    document.querySelector(".dltracker-deal-toast")?.remove();
    if (dealToastTimer) clearTimeout(dealToastTimer);
    const toast = document.createElement("div");
    toast.className = `dltracker-deal-toast${isError ? " is-error" : ""}`;
    toast.textContent = String(message || "");
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    dealToastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 180);
      dealToastTimer = null;
    }, durationMs);
  }

  async function fetchSameOriginText(
    url,
    label,
    { anonymous = false, requestSession = "deal" } = {},
  ) {
    if (requestSessionStopped(requestSession)) {
      throw new Error(`${label}请求已因风控信号停止`);
    }
    const response = await fetch(url, {
      credentials: anonymous ? "omit" : "include",
      ...(anonymous ? { referrerPolicy: "no-referrer" } : {}),
      headers: { Accept: "application/json, text/html;q=0.9" },
    });
    const text = await response.text();
    if (response.status === 403 || response.status === 429) {
      stopRequestSession(requestSession, `${label} HTTP ${response.status}`);
      throw new Error(`${label}返回 HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`${label}返回 HTTP ${response.status}`);
    if (/captcha|reCAPTCHA|認証|验证|アクセスが集中/i.test(text) &&
      /^\s*</.test(text)) {
      stopRequestSession(requestSession, `${label}返回验证页`);
      throw new Error(`${label}返回了验证页`);
    }
    return text;
  }

  function rawCouponEarliestExpiry(rawCoupons) {
    const values = (Array.isArray(rawCoupons) ? rawCoupons : [])
      .map((raw) => dealDateMillis(raw?.limit_date ?? raw?.end_date))
      .filter((value) => typeof value === "number" && value > Date.now());
    return values.length ? Math.min(...values) : null;
  }

  function syncPlannerCouponsFromRaw(rawCoupons) {
    const imported = (Array.isArray(rawCoupons) ? rawCoupons : [])
      .map(normalizeDlsiteCoupon)
      .filter(Boolean)
      .filter((coupon) => !coupon.expiresAt || Date.parse(coupon.expiresAt) > Date.now());
    const state = getPlannerState();
    state.coupons = [
      ...state.coupons.filter((coupon) => coupon?.source !== "dlsite"),
      ...imported,
    ];
    state.lastCouponImport = {
      at: nowIso(),
      count: imported.length,
      repeatableCount: imported.filter((coupon) => coupon.repeatable).length,
    };
    savePlannerState(state);
    return imported;
  }

  async function ensureDealCoupons(force = false) {
    const cache = loadDealCache();
    const accountKey = currentAccountKey();
    const accountChanged = cache.coupons.accountKey &&
      accountKey !== "account-unresolved" &&
      cache.coupons.accountKey !== "account-unresolved" &&
      cache.coupons.accountKey !== accountKey;
    const expired = cache.coupons.earliestExpiry &&
      cache.coupons.earliestExpiry <= Date.now();
    if (!force && cache.coupons.loaded && !expired && !accountChanged) {
      return Array.isArray(cache.coupons.raw) ? cache.coupons.raw : [];
    }
    if (dealCouponFetchInFlight) return dealCouponFetchInFlight;
    dealCouponFetchInFlight = (async () => {
      const url = new URL(DLSITE_COUPON_API_PATH, location.origin);
      const text = await fetchSameOriginText(url, "优惠券接口");
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        if (/^\s*</.test(text)) stopDealRequests("优惠券接口返回网页");
        throw new Error("优惠券接口没有返回 JSON");
      }
      const raw = couponArrayFromPayload(payload);
      cache.coupons = {
        loaded: true,
        raw,
        fetchedAt: Date.now(),
        accountKey,
        earliestExpiry: rawCouponEarliestExpiry(raw),
      };
      saveDealCache(cache);
      showDealToast(
        `已读取 ${raw.length} 张优惠券，合并为 ${groupDealCoupons(raw).length} 种`,
        false,
        5000,
      );
      return raw;
    })();
    try {
      return await dealCouponFetchInFlight;
    } finally {
      dealCouponFetchInFlight = null;
    }
  }

  function invalidateCouponCacheAfterPurchase() {
    if (!/(?:order|purchase|payment).*(?:complete|finish|thanks)|thanks.*(?:order|purchase)/i.test(location.pathname)) {
      return;
    }
    const cache = loadDealCache();
    cache.coupons = { ...cache.coupons, loaded: false };
    saveDealCache(cache);
  }

  function normalizedMetadataProduct(id, raw) {
    const nestedYen = raw?.currency_price?.JPY;
    const nestedCny = raw?.currency_price?.CNY ?? raw?.currency_price?.RMB;
    const translationInfo = typeof raw?.translation_info === "string"
      ? parseTranslationInfo(raw.translation_info)
      : raw?.translation_info;
    const price = dealNumber(
      raw?.price ?? nestedYen?.price ?? nestedYen,
      0,
    );
    const officialPrice = dealNumber(
      raw?.official_price ?? raw?.regular_price ?? nestedYen?.official_price,
      price,
    );
    return {
      id: String(id || raw?.product_id || raw?.workno || "").toUpperCase(),
      title: dealPlainText(raw?.product_name ?? raw?.work_name ?? raw?.title) ||
        String(id || raw?.product_id || raw?.workno || "").toUpperCase(),
      price,
      officialPrice,
      cnyPrice: dealNumber(nestedCny?.price ?? nestedCny, 0),
      voiceActors: extractVoiceActorNames(raw),
      makerId: String(raw?.maker_id || ""),
      makerName: dealPlainText(raw?.maker_name),
      siteId: String(raw?.site_id || location.pathname.split("/")[1] || ""),
      workType: String(raw?.work_type || ""),
      customGenres: dealTokens(raw?.custom_genres),
      bulkbuyKey: String(raw?.bulkbuy_key || ""),
      alternateIds: dealTokens([
        translationInfo?.parent_workno,
        translationInfo?.original_workno,
        raw?.parent_workno,
      ]).map((value) => String(value).toUpperCase()),
      translationInfo: translationInfo && typeof translationInfo === "object"
        ? translationInfo
        : {},
      onSale: Boolean(dealNumber(raw?.on_sale, raw?.is_sale ? 1 : 0)),
      platformDiscountExpiresAt: platformDiscountExpiryMillis(raw),
      raw,
    };
  }

  async function ensureProductMetadata(ids, { requestSession = "deal" } = {}) {
    const cache = loadDealCache();
    const unique = [...new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id).toUpperCase())
      .filter((id) => /^[RBV]J\d{6,}$/i.test(id)))];
    const result = new Map();
    const missing = [];
    for (const id of unique) {
      const entry = cache.metadata[id];
      if (entry && Date.now() - dealNumber(entry.fetchedAt) < PRODUCT_METADATA_TTL_MS) {
        result.set(id, normalizedMetadataProduct(id, entry.raw));
      } else {
        missing.push(id);
      }
    }
    if (!missing.length || requestSessionStopped(requestSession)) return result;
    // 无限滚动会在同一 URL 下追加作品；每次只读未缓存的下一批。
    const batch = missing.slice(0, MAX_PRODUCT_METADATA_BATCH);

    const url = new URL(DLSITE_PRODUCT_INFO_PATH, location.origin);
    url.searchParams.set("product_id", batch.join(","));
    try {
      const text = await fetchSameOriginText(url, "作品信息接口", {
        anonymous: true,
        requestSession,
      });
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        if (/^\s*</.test(text)) {
          stopRequestSession(requestSession, "作品信息接口返回网页");
        }
        throw new Error("作品信息接口没有返回 JSON");
      }
      const records = productRecordsFromPayload(payload);
      for (const id of batch) {
        const raw = records.get(id);
        if (!raw) continue;
        cache.metadata[id] = { fetchedAt: Date.now(), raw };
        result.set(id, normalizedMetadataProduct(id, raw));
      }
      saveDealCache(cache);
    } catch (error) {
      console.warn(`[${APP_NAME}] product metadata batch failed:`, error);
    }
    return result;
  }

  async function ensureProductMetadataBatches(ids, options = {}) {
    const unique = [...new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id).toUpperCase())
      .filter((id) => /^[RBV]J\d{6,}$/i.test(id)))];
    const result = new Map();
    for (let start = 0; start < unique.length; start += MAX_PRODUCT_METADATA_BATCH) {
      const batch = await ensureProductMetadata(
        unique.slice(start, start + MAX_PRODUCT_METADATA_BATCH),
        options,
      );
      for (const [id, product] of batch.entries()) result.set(id, product);
      if (requestSessionStopped(options.requestSession)) break;
    }
    return result;
  }

  // <language-account-core>
  function currentDlsiteSection() {
    return (location.pathname.split("/").filter(Boolean)[0] || "maniax")
      .replace(/-touch$/i, "");
  }

  function readCookieValue(name) {
    const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return matched ? decodeURIComponent(matched[1]) : "";
  }

  function dlsiteBoughtToken() {
    const direct = document.cookie.match(/(?:^|;\s*)uhash(?:jp|en)?=([^;]+)/i);
    return direct ? decodeURIComponent(direct[1]) : "";
  }

  function isDlsiteMemberLoggedIn() {
    const value = Number(readCookieValue("loginchecked") || 0);
    return Boolean(value & 1);
  }

  const LANGUAGE_LABELS = {
    JPN: "日语",
    ENG: "英语",
    CHI_HANS: "简体中文",
    CHI_HANT: "繁体中文",
    CHI: "中文",
    KO_KR: "韩语",
    KOR: "韩语",
    SPA: "西班牙语",
    GER: "德语",
    FRE: "法语",
    IND: "印尼语",
    ITA: "意大利语",
    POR: "葡萄牙语",
    SWE: "瑞典语",
    THA: "泰语",
    VIE: "越南语",
  };

  function normalizedLanguageCode(value, product = null) {
    const explicit = String(value || "").trim().toUpperCase();
    if (explicit) return explicit;
    const options = String(product?.raw?.options || product?.raw?.option || "")
      .toUpperCase().split(/[# ,]+/);
    return ["CHI_HANS", "CHI_HANT", "KO_KR", "ENG", "JPN"]
      .find((code) => options.includes(code)) || "JPN";
  }

  function languageDisplayName(code, fallback = "") {
    return LANGUAGE_LABELS[normalizedLanguageCode(code)] ||
      dealPlainText(fallback) || normalizedLanguageCode(code) || "未知语言";
  }

  function productLanguageIdentity(product, fallbackId = "") {
    const id = String(product?.id || fallbackId || "").toUpperCase();
    const info = product?.translationInfo || product?.raw?.translation_info || {};
    const isChild = Boolean(info?.is_child);
    const isParent = Boolean(info?.is_parent);
    const isOriginal = Boolean(info?.is_original);
    const parentId = String(
      isChild ? info?.parent_workno : isParent ? id : id,
    ).toUpperCase() || id;
    const familyId = String(
      info?.original_workno || (isOriginal ? id : parentId),
    ).toUpperCase() || parentId || id;
    const lang = normalizedLanguageCode(
      info?.lang || (isOriginal ? "JPN" : ""),
      product,
    );
    return { id, parentId, familyId, lang };
  }

  function cartSkuFromSignals(signals = {}) {
    const valid = (value) => {
      const normalized = String(value || "").toUpperCase();
      return isValidProductCode(normalized) ? normalized : "";
    };
    const parseHref = (href) => {
      if (!href) return { translation: "", product: "" };
      try {
        const url = new URL(String(href), "https://www.dlsite.com");
        const translation = valid(url.searchParams.get("translation"));
        const fromQuery = valid(
          url.searchParams.get("product_id") || url.searchParams.get("workno"),
        );
        const matched = url.pathname.match(/product_id\/([RBV]J\d{6,})/i);
        return {
          translation,
          product: fromQuery || valid(matched?.[1]),
        };
      } catch {
        return { translation: "", product: "" };
      }
    };
    const actionHref = parseHref(signals.actionHref);
    const detailHref = parseHref(signals.detailHref);
    return valid(signals.actionProductId) ||
      valid(signals.actionWorkno) ||
      actionHref.translation ||
      actionHref.product ||
      detailHref.translation ||
      valid(signals.dataProductId) ||
      valid(signals.dataWorkno) ||
      detailHref.product ||
      "";
  }

  function emptyAccountIndex() {
    return {
      loaded: false,
      active: [],
      later: [],
      bought: [],
      entries: {},
      indexed: 0,
      total: 0,
      complete: false,
      failedIds: [],
      updatedAt: 0,
      lastManualAt: 0,
      accountFingerprint: "",
      pausedReason: "",
      requestVersion: 0,
    };
  }

  function loadAccountIndex() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ACCOUNT_INDEX_STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return emptyAccountIndex();
      return {
        ...emptyAccountIndex(),
        ...parsed,
        active: Array.isArray(parsed.active) ? parsed.active : [],
        later: Array.isArray(parsed.later) ? parsed.later : [],
        bought: Array.isArray(parsed.bought) ? parsed.bought : [],
        entries: parsed.entries && typeof parsed.entries === "object"
          ? parsed.entries
          : {},
        failedIds: Array.isArray(parsed.failedIds) ? parsed.failedIds : [],
      };
    } catch {
      return emptyAccountIndex();
    }
  }

  function saveAccountIndex(index) {
    try {
      localStorage.setItem(ACCOUNT_INDEX_STORAGE_KEY, JSON.stringify(index));
    } catch (error) {
      console.warn(`[${APP_NAME}] account index write failed:`, error);
    }
    return index;
  }

  function clearAccountIndex() {
    try { localStorage.removeItem(ACCOUNT_INDEX_STORAGE_KEY); } catch { /* noop */ }
    accountIndexRuntimeFingerprint = "";
    return emptyAccountIndex();
  }

  function accountEntryFromProduct(id, product) {
    const identity = productLanguageIdentity(product, id);
    return {
      id: String(id || "").toUpperCase(),
      parentId: identity.parentId,
      familyId: identity.familyId,
      lang: identity.lang,
      language: languageDisplayName(identity.lang),
    };
  }

  function accountEntriesForFamily(familyId, index = loadAccountIndex()) {
    const target = String(familyId || "").toUpperCase();
    return Object.values(index.entries || {}).filter((entry) =>
      String(entry?.familyId || "").toUpperCase() === target);
  }

  async function fetchSameOriginJson(url, label, options = {}) {
    if (accountIndexSessionStopped) {
      throw new Error("账号索引请求已因风控信号停止");
    }
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(options.headers || {}),
      },
      ...options,
    });
    const text = await response.text();
    if (response.status === 403 || response.status === 429) {
      stopRequestSession("account", `${label} HTTP ${response.status}`);
      throw new Error(`${label}返回 HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`${label}返回 HTTP ${response.status}`);
    if (/captcha|reCAPTCHA|認証|验证|アクセスが集中/i.test(text) && /^\s*</.test(text)) {
      stopRequestSession("account", `${label}返回验证页`);
      throw new Error(`${label}返回了验证页`);
    }
    try {
      return JSON.parse(text);
    } catch {
      if (/^\s*</.test(text)) stopRequestSession("account", `${label}返回网页`);
      throw new Error(`${label}没有返回 JSON`);
    }
  }

  function cartIdsFromMemberStatus(status) {
    const active = [];
    const later = [];
    for (const item of Array.isArray(status?.cart) ? status.cart : []) {
      const id = String(item?.product_id || item?.workno || "").toUpperCase();
      if (!isValidProductCode(id)) continue;
      if (!item?.status || Number(item.status) === 1) active.push(id);
      else later.push(id);
    }
    return { active: [...new Set(active)], later: [...new Set(later)] };
  }

  async function refreshAccountIndex({ manual = false } = {}) {
    if (accountIndexRefreshInFlight) return accountIndexRefreshInFlight;
    const previous = loadAccountIndex();
    if (manual && Date.now() - dealNumber(previous.lastManualAt) < ACCOUNT_REFRESH_COOLDOWN_MS) {
      const seconds = Math.max(1, Math.ceil(
        (ACCOUNT_REFRESH_COOLDOWN_MS - (Date.now() - previous.lastManualAt)) / 1000,
      ));
      throw new Error(`请等待 ${seconds} 秒后再读取`);
    }
    // 只重置账号索引自己的会话，不改变优惠券或当页分析的熔断状态。
    accountIndexSessionStopped = false;
    accountIndexSessionStopReason = "";
    accountIndexRuntimeError = "";
    const manualStartedAt = manual ? Date.now() : dealNumber(previous.lastManualAt);
    if (manual || dealNumber(previous.requestVersion) < ACCOUNT_INDEX_REQUEST_VERSION) {
      saveAccountIndex({
        ...previous,
        lastManualAt: manualStartedAt,
        requestVersion: ACCOUNT_INDEX_REQUEST_VERSION,
      });
    }
    accountIndexRefreshInFlight = (async () => {
      if (!isDlsiteMemberLoggedIn()) return clearAccountIndex();
      const section = currentDlsiteSection();
      const status = await fetchSameOriginJson(
        `/${section}${DLSITE_MEMBER_STATUS_PATH}`,
        "账号购物车信息",
      );
      const token = dlsiteBoughtToken();
      const rawFingerprint = String(
        token || status?.customer_id || status?.login_id || "",
      );
      const fingerprint = rawFingerprint ? `account-${quickHash(rawFingerprint)}` : "";
      if (accountIndexRuntimeFingerprint && fingerprint &&
        accountIndexRuntimeFingerprint !== fingerprint) {
        clearAccountIndex();
      }
      if (previous.accountFingerprint && fingerprint &&
        previous.accountFingerprint !== fingerprint) {
        clearAccountIndex();
      }
      accountIndexRuntimeFingerprint = fingerprint;
      const boughtUrl = new URL(`/${section}${DLSITE_BOUGHT_PRODUCTS_PATH}`, location.origin);
      if (token) boughtUrl.searchParams.set("_", token);
      const boughtPayload = await fetchSameOriginJson(boughtUrl, "已购清单");
      const cartIds = cartIdsFromMemberStatus(status);
      const bought = (Array.isArray(boughtPayload?.boughts)
        ? boughtPayload.boughts
        : Array.isArray(boughtPayload) ? boughtPayload : [])
        .map((id) => String(id || "").toUpperCase())
        .filter(isValidProductCode);
      const ids = [...new Set([...cartIds.active, ...cartIds.later, ...bought])];
      const entries = {};
      const failedIds = [];
      saveAccountIndex({
        ...emptyAccountIndex(),
        loaded: true,
        active: cartIds.active,
        later: cartIds.later,
        bought: [...new Set(bought)],
        entries,
        indexed: 0,
        total: ids.length,
        complete: ids.length === 0,
        failedIds,
        updatedAt: Date.now(),
        lastManualAt: manualStartedAt,
        accountFingerprint: fingerprint,
        pausedReason: "",
        requestVersion: ACCOUNT_INDEX_REQUEST_VERSION,
      });
      refreshAccountInformationPanels();
      for (let start = 0; start < ids.length; start += ACCOUNT_METADATA_BATCH_SIZE) {
        const batchIds = ids.slice(start, start + ACCOUNT_METADATA_BATCH_SIZE);
        const metadata = await ensureProductMetadata(batchIds, {
          requestSession: "account",
        });
        for (const id of batchIds) {
          const product = metadata.get(id);
          if (product) entries[id] = accountEntryFromProduct(id, product);
          else if (!accountIndexSessionStopped) {
            entries[id] = accountEntryFromProduct(id, { id });
            failedIds.push(id);
          }
        }
        saveAccountIndex({
          ...emptyAccountIndex(),
          loaded: true,
          active: cartIds.active,
          later: cartIds.later,
          bought: [...new Set(bought)],
          entries,
          indexed: Object.keys(entries).length - failedIds.length,
          total: ids.length,
          complete: false,
          failedIds,
          updatedAt: Date.now(),
          lastManualAt: manualStartedAt,
          accountFingerprint: fingerprint,
          requestVersion: ACCOUNT_INDEX_REQUEST_VERSION,
        });
        refreshAccountInformationPanels();
        if (accountIndexSessionStopped) {
          const remaining = ids.filter((id) => !entries[id]).length;
          accountIndexRuntimeError = `语言索引已暂停：${accountIndexSessionStopReason || "账号索引请求已停止"}${
            remaining ? `；剩余${remaining}项` : ""
          }`;
          break;
        }
        if (start + ACCOUNT_METADATA_BATCH_SIZE < ids.length) {
          await sleep(ACCOUNT_METADATA_BATCH_PAUSE_MS);
        }
      }
      const next = {
        ...emptyAccountIndex(),
        loaded: true,
        active: cartIds.active,
        later: cartIds.later,
        bought: [...new Set(bought)],
        entries,
        indexed: Object.keys(entries).length - failedIds.length,
        total: ids.length,
        complete: Object.keys(entries).length === ids.length && failedIds.length === 0,
        failedIds,
        updatedAt: Date.now(),
        lastManualAt: manualStartedAt,
        accountFingerprint: fingerprint,
        pausedReason: accountIndexSessionStopped ? accountIndexSessionStopReason : "",
        requestVersion: ACCOUNT_INDEX_REQUEST_VERSION,
      };
      if (ids.length && next.indexed === 0 && !accountIndexRuntimeError) {
        accountIndexRuntimeError = "语言索引未取得任何作品信息，请稍后重新读取";
      }
      saveAccountIndex(next);
      return next;
    })().catch((error) => {
      accountIndexRuntimeError = error instanceof Error ? error.message : String(error);
      if (accountIndexSessionStopped) {
        const current = loadAccountIndex();
        saveAccountIndex({
          ...current,
          pausedReason: accountIndexSessionStopReason || accountIndexRuntimeError,
          requestVersion: ACCOUNT_INDEX_REQUEST_VERSION,
          updatedAt: Date.now(),
        });
      }
      throw error;
    }).finally(() => {
      accountIndexRefreshInFlight = null;
      refreshAccountInformationPanels();
    });
    refreshAccountInformationPanels();
    return accountIndexRefreshInFlight;
  }

  async function ensureInitialAccountIndex() {
    if (!isDlsiteMemberLoggedIn()) {
      if (loadAccountIndex().loaded) clearAccountIndex();
      return loadAccountIndex();
    }
    const index = loadAccountIndex();
    const token = dlsiteBoughtToken();
    const visibleFingerprint = token
      ? `account-${quickHash(token)}`
      : currentAccountKey();
    if (index.loaded && index.accountFingerprint &&
      visibleFingerprint !== "account-unresolved" &&
      index.accountFingerprint !== visibleFingerprint) {
      clearAccountIndex();
      return refreshAccountIndex();
    }
    const purchaseKey = "dltracker-account-purchase-refresh-marker";
    const purchaseComplete = /(?:order|purchase|payment).*(?:complete|finish|thanks)|thanks.*(?:order|purchase)/i
      .test(location.pathname);
    let purchaseAlreadyHandled = false;
    try {
      if (!purchaseComplete) sessionStorage.removeItem(purchaseKey);
      purchaseAlreadyHandled = sessionStorage.getItem(purchaseKey) === location.href;
    } catch { /* noop */ }
    if (purchaseComplete && !purchaseAlreadyHandled) {
      try { sessionStorage.setItem(purchaseKey, location.href); } catch { /* noop */ }
      return refreshAccountIndex();
    }
    const processed = Object.keys(index.entries || {}).length;
    const requestStrategyChanged = dealNumber(index.requestVersion) <
      ACCOUNT_INDEX_REQUEST_VERSION;
    if (index.loaded && !index.complete && processed < index.total &&
      (!index.pausedReason || requestStrategyChanged)) {
      return refreshAccountIndex();
    }
    if (!index.loaded) return refreshAccountIndex();
    return index;
  }

  function updateAccountIndexCart(activeIds, laterIds) {
    const index = loadAccountIndex();
    if (!index.loaded) return index;
    const active = [...new Set((activeIds || []).map((id) => String(id).toUpperCase()))];
    const later = [...new Set((laterIds || []).map((id) => String(id).toUpperCase()))];
    const next = saveAccountIndex({ ...index, active, later, updatedAt: Date.now() });
    refreshAccountInformationPanels();
    refreshOpenLanguageDialog();
    return next;
  }

  function emptyLanguageFamilyCache() {
    return { families: {}, parents: {} };
  }

  function loadLanguageFamilyCache() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(LANGUAGE_FAMILY_CACHE_STORAGE_KEY) || "null",
      );
      if (!parsed || typeof parsed !== "object") return emptyLanguageFamilyCache();
      return {
        families: parsed.families && typeof parsed.families === "object"
          ? parsed.families
          : {},
        parents: parsed.parents && typeof parsed.parents === "object"
          ? parsed.parents
          : {},
      };
    } catch {
      return emptyLanguageFamilyCache();
    }
  }

  function saveLanguageFamilyCache(cache) {
    try {
      localStorage.setItem(LANGUAGE_FAMILY_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.warn(`[${APP_NAME}] language cache write failed:`, error);
    }
  }

  function languageEditionsFromDocument(doc, fallbackId = "") {
    const selector = doc?.querySelector?.(
      '[data-vue-component="language-edition-selector"][data-language-editions]',
    );
    let raw = [];
    try { raw = JSON.parse(selector?.getAttribute("data-language-editions") || "[]"); } catch { /* noop */ }
    const editions = (Array.isArray(raw) ? raw : []).map((edition, order) => ({
      parentId: String(edition?.workno || "").toUpperCase(),
      lang: normalizedLanguageCode(edition?.lang),
      language: languageDisplayName(edition?.lang, edition?.display_label),
      displayLabel: dealPlainText(edition?.display_label),
      displayOrder: dealNumber(edition?.display_order, order),
      price: dealNumber(edition?.price, NaN),
      officialPrice: dealNumber(edition?.official_price, NaN),
    })).filter((edition) => isValidProductCode(edition.parentId));
    if (editions.length) return editions;
    const id = String(fallbackId || "").toUpperCase();
    return isValidProductCode(id)
      ? [{ parentId: id, lang: "JPN", language: "日语", displayLabel: "日语", displayOrder: 0 }]
      : [];
  }

  async function ensureLanguageFamily(productId) {
    const id = String(productId || "").toUpperCase();
    const metadata = await ensureProductMetadataBatches([id]);
    const product = metadata.get(id) || { id };
    const identity = productLanguageIdentity(product, id);
    const cache = loadLanguageFamilyCache();
    const cachedFamilyId = cache.parents[identity.parentId] || identity.familyId;
    const cached = cache.families[cachedFamilyId];
    if (cached && Date.now() - dealNumber(cached.fetchedAt) < LANGUAGE_FAMILY_TTL_MS) {
      return cached;
    }
    let editions = [];
    const currentId = extractRjCodeFromUrl(location.href);
    if (isProductPage(location.href) && [id, identity.parentId].includes(currentId)) {
      editions = languageEditionsFromDocument(document, identity.parentId);
    }
    if (!editions.length || editions.length === 1 && editions[0].parentId === identity.parentId) {
      const url = new URL(
        `/${currentDlsiteSection()}/work/=/product_id/${identity.parentId}.html`,
        location.origin,
      );
      const html = await fetchSameOriginText(url, "语言版本详情");
      if (!/^\s*</.test(html)) throw new Error("语言版本详情没有返回网页");
      const doc = new DOMParser().parseFromString(html, "text/html");
      editions = languageEditionsFromDocument(doc, identity.parentId);
    }
    const familyId = identity.familyId || editions.find((entry) => entry.lang === "JPN")?.parentId || identity.parentId;
    const family = { familyId, fetchedAt: Date.now(), editions };
    cache.families[familyId] = family;
    cache.parents[id] = familyId;
    cache.parents[identity.parentId] = familyId;
    editions.forEach((edition) => { cache.parents[edition.parentId] = familyId; });
    saveLanguageFamilyCache(cache);
    return family;
  }
  // </language-account-core>

  function loadCartSnapshot() {
    const empty = { loaded: false, active: [], later: [], products: [], updatedAt: 0 };
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_SNAPSHOT_STORAGE_KEY) || "null");
      if (!parsed || !parsed.loaded) return empty;
      const active = Array.isArray(parsed.active)
        ? parsed.active
        : Array.isArray(parsed.products) ? parsed.products : [];
      const later = Array.isArray(parsed.later) ? parsed.later : [];
      return { ...parsed, active, later, products: active };
    } catch {
      return empty;
    }
  }

  function saveCartSnapshot(value) {
    const active = Array.isArray(value)
      ? value
      : Array.isArray(value?.active) ? value.active : [];
    const later = Array.isArray(value?.later) ? value.later : [];
    const snapshot = {
      loaded: true,
      active,
      later,
      products: active,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(CART_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn(`[${APP_NAME}] cart snapshot write failed:`, error);
    }
    return snapshot;
  }

  function cartCurrentPriceFromNode(node) {
    const priceHost = firstElementBySelectors([
      ".n_work_price_wrap",
      ".work_price",
      "[class*='price']",
    ], node);
    if (priceHost) {
      const clean = priceHost.cloneNode(true);
      for (const injected of clean.querySelectorAll([
        `.${UI_CLASSNAME}`,
        `.${DEAL_INSIGHT_CLASSNAME}`,
        ".dltracker-jpy-price",
        "[class^='dltracker-']",
        "[class*=' dltracker-']",
        "[class^='dlcr-']",
        "[class*=' dlcr-']",
      ].join(","))) {
        injected.remove();
      }
      const textPrice = lastYenPriceFromText(clean.textContent);
      if (Number.isFinite(textPrice) && textPrice >= 0) return textPrice;
    }
    for (const name of [
      "data-price",
      "data-sale-price",
      "data-bulkbuy_price",
      "data-bulk-price",
    ]) {
      const raw = node.getAttribute(name) ||
        node.querySelector(`[${name}]`)?.getAttribute(name);
      const parsed = dealNumber(raw, NaN);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 0;
  }

  function isHiddenOrRemovedCartItem(item) {
    const owner = item?.closest?.("li.cart_list_item, li.n_work_list_item") || item;
    if (!owner) return true;
    if (owner.hidden || owner.classList?.contains("_removed")) return true;
    if (String(owner.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") {
      return true;
    }
    return /display\s*:\s*none/i.test(owner.getAttribute?.("style") || "");
  }

  function cartProductsFromRoot(root, area = "active") {
    const nodes = root.querySelectorAll([
      "li.cart_list_item._cart_items",
      "li.cart_list_item[id^='buy_now_']",
      "li.cart_list_item[id^='buy_later_']",
      "li.n_work_list_item._cart_item",
      "li.n_work_list_item[id^='buy_now_']",
      "li.n_work_list_item[id^='buy_later_']",
      "li[data-workno]",
    ].join(","));
    const products = [];
    const seen = new Set();
    for (const node of nodes) {
      if (isHiddenOrRemovedCartItem(node)) continue;
      if (cartProductArea(node) !== area) continue;
      const dataId = node.getAttribute("data-workno") ||
        node.getAttribute("data-product-id") || "";
      const href = node.querySelector('a[href*="product_id/"]')?.getAttribute("href") || "";
      const matched = `${dataId} ${href}`.match(/([RBV]J\d{6,})/i);
      if (!matched) continue;
      const id = matched[1].toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const priceText = node.querySelector(".work_price, .n_work_price_wrap, [class*='price']")?.textContent || "";
      const cnyPrice = lastCnyPriceFromText(priceText);
      const price = cartCurrentPriceFromNode(node);
      products.push({
        id,
        title: dealPlainText(
          node.querySelector(".work_name a, .n_work_name a, a[href*='product_id/']")?.textContent,
        ) || id,
        price,
        officialPrice: dealNumber(
          node.getAttribute("data-official_price") ||
          node.getAttribute("data-bulkbuy_origin_price"),
          price,
        ),
        cnyPrice: Number.isFinite(cnyPrice) ? cnyPrice : 0,
        bulkbuyKey: node.getAttribute("data-bulkbuy_key") || "",
      });
    }
    return products;
  }

  function cartSnapshotFromRoot(root) {
    return {
      active: cartProductsFromRoot(root, "active"),
      later: cartProductsFromRoot(root, "later"),
    };
  }

  function cartDiagnosticElementSummary(node) {
    if (!node) return null;
    const attributes = {};
    for (const name of [
      "data-workno",
      "data-product-id",
      "data-cart-area",
      "data-area",
      "data-bulkbuy_key",
      "data-bulkbuy-key",
      "data-price",
      "data-sale-price",
    ]) {
      const value = node.getAttribute?.(name);
      if (value !== null && value !== undefined && value !== "") {
        attributes[name] = String(value).slice(0, 160);
      }
    }
    const rawId = String(node.id || "");
    return {
      tag: String(node.tagName || "").toLowerCase(),
      id: rawId && /cart|buy|later|now|hold|main|work|product|[RBV]J\d{6,}/i.test(rawId)
        ? rawId.slice(0, 160)
        : rawId ? "[omitted]" : "",
      classes: typeof node.className === "string"
        ? node.className.split(/\s+/).filter(Boolean).slice(0, 24)
        : [],
      attributes,
    };
  }

  function cartDiagnosticProduct(product) {
    return {
      id: String(product?.id || "").toUpperCase(),
      price: Math.max(0, dealNumber(product?.price)),
      officialPrice: Math.max(0, dealNumber(product?.officialPrice)),
      bulkbuyKey: String(product?.bulkbuyKey || "").slice(0, 160),
    };
  }

  function cartDiagnosticCandidateItems() {
    const owners = [];
    const seen = new Set();
    for (const item of getCartItems()) {
      const owner = getCartOwnerItem(item);
      if (!owner || seen.has(owner)) continue;
      seen.add(owner);
      owners.push(owner);
    }
    return owners.map((owner, index) => {
      const ancestors = [];
      let cursor = owner;
      for (let depth = 0; cursor && depth < 12; depth += 1) {
        ancestors.push(cartDiagnosticElementSummary(cursor));
        if (cursor === document.body) break;
        cursor = cursor.parentElement;
      }
      const nativePriceText = [...owner.querySelectorAll([
        ".work_price",
        ".n_work_price_wrap",
        "[class*='price']",
      ].join(","))]
        .filter((node) => !node.closest("[class^='dltracker-'], [class*=' dltracker-']"))
        .flatMap((node) => [...String(node.textContent || "")
          .replace(/,/g, "")
          .matchAll(/(\d{1,8})\s*(?:円|JPY)/gi)]
          .map((match) => Number(match[1])))
        .filter((value) => Number.isFinite(value));
      const id = extractRjCodeFromCartItem(owner) || "";
      return {
        index,
        productId: id,
        computedArea: cartProductArea(owner),
        computedPrice: cartCurrentPriceFromNode(owner),
        nativeYenValues: nativePriceText,
        hiddenOrRemoved: isHiddenOrRemovedCartItem(owner),
        areaSignals: {
          closestBuyNow: cartDiagnosticElementSummary(
            owner.closest?.(BUY_NOW_AREA_SELECTOR),
          ),
          closestBuyLater: cartDiagnosticElementSummary(
            owner.closest?.(BUY_LATER_AREA_SELECTOR),
          ),
          hasBuyNowActionTarget: Boolean(owner.querySelector?.(".__buy_now_target")),
          hasBuyLaterActionTarget: Boolean(owner.querySelector?.(".__buy_later_target")),
        },
        displayedDealText: dealPlainText(
          owner.querySelector?.(`.${DEAL_INSIGHT_CLASSNAME}`)?.textContent,
        ).slice(0, 800),
        ancestors,
      };
    });
  }

  function buildCartDiagnostic() {
    const domSnapshot = cartSnapshotFromRoot(document);
    const storedSnapshot = loadCartSnapshot();
    const contextSnapshot = latestDealContext.cartSnapshot || {};
    const active = contextSnapshot.active || contextSnapshot.products || [];
    const products = [
      ...(contextSnapshot.active || contextSnapshot.products || []),
      ...(contextSnapshot.later || []),
    ];
    const calculations = products.map((product) => ({
      product: cartDiagnosticProduct(product),
      couponOptions: buildDealCouponOptions(
        latestDealContext.coupons,
        product,
        active,
      ).map((option) => ({
        discountType: option.discountType,
        discount: dealNumber(option.discount),
        minCount: dealNumber(option.minCount),
        minSpend: dealNumber(option.minSpend),
        eligibleCartCount: dealNumber(option.eligibleCartCount),
        cartSubtotal: dealNumber(option.cartSubtotal),
        countShortfall: dealNumber(option.countShortfall),
        spendShortfall: dealNumber(option.spendShortfall),
        ready: Boolean(option.ready),
      })),
    }));
    const summarizeSnapshot = (snapshot) => ({
      loaded: Boolean(snapshot?.loaded),
      updatedAt: dealNumber(snapshot?.updatedAt),
      active: (snapshot?.active || snapshot?.products || []).map(cartDiagnosticProduct),
      later: (snapshot?.later || []).map(cartDiagnosticProduct),
    });
    return {
      format: "dltracker-cart-diagnostic-v1",
      scriptVersion: APP_VERSION,
      capturedAt: new Date().toISOString(),
      pagePath: location.pathname,
      safety: {
        titlesIncluded: false,
        accountIdentifiersIncluded: false,
        cookiesIncluded: false,
        requestHeadersIncluded: false,
        fullHtmlIncluded: false,
      },
      candidates: cartDiagnosticCandidateItems(),
      domSnapshot: summarizeSnapshot({ loaded: true, ...domSnapshot }),
      storedSnapshot: summarizeSnapshot(storedSnapshot),
      contextSnapshot: summarizeSnapshot(contextSnapshot),
      calculations,
    };
  }

  async function copyCartDiagnosticText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to the textarea method used by older mobile browsers.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }
    return copied;
  }

  function createCartDiagnosticPayload() {
    const diagnostic = buildCartDiagnostic();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      text: JSON.stringify(diagnostic, null, 2),
      filename: `dltracker-cart-diagnostic-${timestamp}.json`,
    };
  }

  function downloadCartDiagnosticPayload(payload) {
    downloadText(
      payload.filename,
      payload.text,
      "application/json;charset=utf-8",
    );
  }

  async function shareCartDiagnosticPayload(payload) {
    if (typeof navigator.share !== "function" || typeof File !== "function") {
      return false;
    }
    const file = new File(
      [payload.text],
      payload.filename,
      { type: "application/json" },
    );
    const shareData = {
      title: "DLsite 购物车诊断 JSON",
      text: "脱敏的 DLsite 购物车区域、价格和计算数据",
      files: [file],
    };
    if (typeof navigator.canShare === "function" &&
      !navigator.canShare(shareData)) {
      return false;
    }
    await navigator.share(shareData);
    return true;
  }

  function injectCartDiagnosticPanel() {
    if (!isCartPage(location.href) ||
      document.querySelector(".dltracker-cart-diagnostic")) return;
    const panel = document.createElement("section");
    panel.className = "dltracker-cart-diagnostic";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "复制 JSON";
    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.textContent = "下载 JSON 文件";
    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.textContent = "微信分享";
    const status = document.createElement("span");
    status.textContent = "仅包含脱敏的区域、价格和计算信息";
    const buttons = [copyButton, downloadButton, shareButton];
    const setBusy = (busy) => {
      buttons.forEach((button) => {
        button.disabled = busy;
      });
    };
    copyButton.addEventListener("click", async () => {
      setBusy(true);
      status.textContent = "正在生成…";
      try {
        const payload = createCartDiagnosticPayload();
        const copied = await copyCartDiagnosticText(payload.text);
        if (copied) {
          status.textContent = "已复制，请直接粘贴发给我";
        } else {
          downloadCartDiagnosticPayload(payload);
          status.textContent = "无法复制，已改为下载 JSON 文件";
        }
      } catch (error) {
        status.textContent = `生成失败：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        setBusy(false);
      }
    });
    downloadButton.addEventListener("click", () => {
      try {
        downloadCartDiagnosticPayload(createCartDiagnosticPayload());
        status.textContent = "JSON 文件已生成并下载";
      } catch (error) {
        status.textContent = `下载失败：${error instanceof Error ? error.message : String(error)}`;
      }
    });
    shareButton.addEventListener("click", async () => {
      setBusy(true);
      status.textContent = "正在生成分享文件…";
      let payload = null;
      try {
        payload = createCartDiagnosticPayload();
        if (await shareCartDiagnosticPayload(payload)) {
          status.textContent = "已打开系统分享面板，请选择微信";
        } else {
          downloadCartDiagnosticPayload(payload);
          status.textContent = "浏览器不支持文件分享，已下载 JSON，请在微信中选择该文件";
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          status.textContent = "已取消分享";
        } else {
          if (payload) downloadCartDiagnosticPayload(payload);
          status.textContent = payload
            ? "分享失败，已下载 JSON，请在微信中选择该文件"
            : `生成失败：${error instanceof Error ? error.message : String(error)}`;
        }
      } finally {
        setBusy(false);
      }
    });
    panel.append(copyButton, downloadButton, shareButton, status);
    (document.body || document.documentElement).appendChild(panel);
  }

  async function ensureCartSnapshot() {
    if (isCartPage(location.href)) {
      return saveCartSnapshot(cartSnapshotFromRoot(document));
    }
    const existing = loadCartSnapshot();
    if (existing.loaded) return existing;
    const section = location.pathname.split("/").filter(Boolean)[0] || "maniax";
    const url = new URL(`/${section}/cart`, location.origin);
    try {
      const html = await fetchSameOriginText(url, "购物车");
      if (!/^\s*</.test(html)) throw new Error("购物车没有返回网页");
      const doc = new DOMParser().parseFromString(html, "text/html");
      return saveCartSnapshot(cartSnapshotFromRoot(doc));
    } catch (error) {
      console.warn(`[${APP_NAME}] cart snapshot failed:`, error);
      return existing;
    }
  }

  function invalidateCartSnapshot() {
    try {
      localStorage.removeItem(CART_SNAPSHOT_STORAGE_KEY);
    } catch {
      // noop
    }
  }

  function readHeaderCartCount() {
    const candidates = document.querySelectorAll([
      "#cart_count",
      ".header_cart_count",
      "[class*='cart_count']",
      "[data-cart-count]",
    ].join(","));
    for (const node of candidates) {
      const value = node.getAttribute("data-cart-count") || node.textContent || "";
      const matched = String(value).match(/\d+/);
      if (matched) return Number(matched[0]);
    }
    return null;
  }

  async function refreshCartSnapshotAfterAdd() {
    if (cartRefreshInFlight) return cartRefreshInFlight;
    invalidateCartSnapshot();
    cartRefreshInFlight = ensureCartSnapshot().finally(() => {
      cartRefreshInFlight = null;
    });
    return cartRefreshInFlight;
  }

  function maybeConfirmPendingCartAdd() {
    if (!pendingCartAdd) return;
    if (Date.now() > pendingCartAdd.expiresAt) {
      pendingCartAdd = null;
      return;
    }
    const nextCount = readHeaderCartCount();
    const countIncreased = typeof pendingCartAdd.beforeCount === "number" &&
      typeof nextCount === "number" && nextCount > pendingCartAdd.beforeCount;
    const successNode = document.querySelector([
      ".add_cart_complete",
      ".cart_add_complete",
      "[class*='add_cart'][class*='complete']",
      "[class*='cart'][class*='success']",
    ].join(","));
    if (!countIncreased && !successNode) return;
    pendingCartAdd = null;
    void refreshCartSnapshotAfterAdd();
  }

  function installDealEventListeners() {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("button, a, input[type='button'], input[type='submit']")
        : null;
      if (!target) return;
      if (target.matches(".dltracker-account-info-button")) {
        event.preventDefault();
        event.stopPropagation();
        openAccountInformationDialog();
        return;
      }
      if (target.matches(".dltracker-hide-purchased-button, .dltracker-hide-carted-button")) {
        event.preventDefault();
        event.stopPropagation();
        toggleBrowseAccountVisibility(
          target.matches(".dltracker-hide-carted-button") ? "carted" : "purchased",
        );
        return;
      }
      const signature = [
        target.id,
        target.className,
        target.getAttribute("href"),
        target.getAttribute("data-action"),
        target.textContent,
        target.getAttribute("value"),
      ].filter(Boolean).join(" ");
      if (!/(?:add.{0,8}cart|cart.{0,8}add|カートに入|加入购物车|加入購物車)/i.test(signature)) {
        return;
      }
      pendingCartAdd = {
        beforeCount: readHeaderCartCount(),
        expiresAt: Date.now() + 12_000,
      };
    }, true);
    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) ||
        target.matches(".dltracker-browse-sort, .dltracker-browse-filter") ||
        !target.matches([
          "select[name*='sort']",
          ".sort_box select",
          ".search_result_sort select",
          "[class*='sort'] select",
        ].join(","))) return;
      browseNativeSortPending = true;
      setTimeout(() => {
        if (!browseNativeSortPending) return;
        browseNativeSortPending = false;
        resetBrowseOriginalOrder();
        void bootstrap();
      }, 1000);
    }, true);
  }

  function dealCampaignPath(product, key) {
    const currentSection = location.pathname.split("/").filter(Boolean)[0] || "";
    const section = currentSection.replace(/-touch$/i, "") ||
      String(product?.siteId || "maniax").replace(/-touch$/i, "");
    return `/${section}/campaign/bulkbuy/=/key/${encodeURIComponent(key)}/`;
  }

  // <campaign-time-core>
  function campaignEndFromEmbedded(embedded) {
    if (!embedded || typeof embedded !== "object") return null;
    const candidates = [];
    const visit = (value, path = "") => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (/(?:end|finish|limit).*(?:date|time|at)|period_end|end_date/i.test(nextPath)) {
          candidates.push(child);
        }
        if (child && typeof child === "object") visit(child, nextPath);
      }
    };
    visit(embedded);
    for (const value of candidates) {
      if (typeof value === "string" &&
        /^\s*20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}\s*$/.test(value)) continue;
      const parsed = dealDateMillis(value);
      if (typeof parsed === "number" && parsed > 0) return parsed;
    }
    return null;
  }

  function campaignEndFromHtml(html, embedded = null) {
    const structured = campaignEndFromEmbedded(embedded);
    if (structured) return structured;
    const labelled = String(html || "").match(
      /(?:end_date|endDate|period_end|終了|截止|结束|까지|まで)[\s\S]{0,160}?(20\d{2})[\/-年](\d{1,2})[\/-月](\d{1,2})(?:日)?(?:[^\d]{0,12}(\d{1,2}):(\d{2}))?/i,
    );
    if (labelled?.[4] && labelled?.[5]) {
      return Date.UTC(
        Number(labelled[1]),
        Number(labelled[2]) - 1,
        Number(labelled[3]),
        Number(labelled[4]) - 9,
        Number(labelled[5]),
        0,
      );
    }
    const short = dealPlainText(html).match(
      /(?:終了|截止|结束|까지|まで)[^\n]{0,80}?(\d{1,2})[\/-月](\d{1,2})(?:日)?(?:[^\d]{0,12}(\d{1,2}):(\d{2}))?/i,
    );
    if (!short?.[3] || !short?.[4]) return null;
    const now = new Date();
    let result = new Date(Date.UTC(
      now.getFullYear(),
      Number(short[1]) - 1,
      Number(short[2]),
      Number(short[3]) - 9,
      Number(short[4]),
      0,
    ));
    if (result.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      result = new Date(Date.UTC(
        now.getFullYear() + 1,
        Number(short[1]) - 1,
        Number(short[2]),
        Number(short[3]) - 9,
        Number(short[4]),
        0,
      ));
    }
    return result.getTime();
  }
  // </campaign-time-core>

  async function ensureBulkRule(product) {
    const key = String(product?.bulkbuyKey || "");
    if (!key) return null;
    const cache = loadDealCache();
    const cached = cache.bulkRules[key];
    if (cached && (!cached.cacheUntil || cached.cacheUntil > Date.now())) return cached;
    try {
      const html = await fetchSameOriginText(
        new URL(dealCampaignPath(product, key), location.origin),
        "三件折扣活动页",
      );
      const objectMatch = html.match(
        /window\[[^\]]*?_product[^\]]*\]\s*=\s*(\{[\s\S]*?\})\s*;/i,
      );
      let embedded = null;
      if (objectMatch) {
        try { embedded = JSON.parse(objectMatch[1]); } catch { /* noop */ }
      }
      const titleMatch = dealPlainText(html).match(/(\d+)\s*(?:作品|本|件).*?(\d+)\s*%/i);
      const discountRate = dealNumber(embedded?.discount_rate, titleMatch ? dealNumber(titleMatch[2]) : 0);
      const minCount = Math.max(1, Math.round(dealNumber(embedded?.per_item, titleMatch ? dealNumber(titleMatch[1]) : 3)));
      if (!discountRate) return null;
      const parsedEnd = campaignEndFromHtml(html, embedded);
      const rule = {
        key,
        discountRate,
        minCount,
        expiresAt: parsedEnd,
        // 未识别到结束时间时只缓存 24 小时，宁可低频复核，也不沿用过期活动。
        cacheUntil: parsedEnd || Date.now() + 24 * 60 * 60 * 1000,
        fetchedAt: Date.now(),
      };
      cache.bulkRules[key] = rule;
      saveDealCache(cache);
      return rule;
    } catch (error) {
      console.warn(`[${APP_NAME}] bulkbuy rule failed:`, error);
      return null;
    }
  }

  function productIdFromNode(node) {
    const values = [
      node?.getAttribute?.("data-workno"),
      node?.getAttribute?.("data-list_item_product_id"),
      node?.getAttribute?.("data-product_id"),
      node?.getAttribute?.("data-product-id"),
      node?.id,
      node?.querySelector?.('a[href*="product_id/"]')?.getAttribute("href"),
    ];
    const matched = values.filter(Boolean).join(" ").match(PRODUCT_CODE_REGEX);
    return matched ? matched[1].toUpperCase() : null;
  }

  function markDealProcessed(node, id) {
    if (!node || !id) return;
    node.setAttribute(DEAL_PROCESSED_ATTRIBUTE, String(id).toUpperCase());
  }

  function needsDealProcessing(node, id = productIdFromNode(node)) {
    if (!node || !id) return false;
    return node.getAttribute(DEAL_PROCESSED_ATTRIBUTE) !== String(id).toUpperCase();
  }

  function isCartRecommendationCard(node) {
    return Boolean(node?.closest?.(".__cart_recommend, .recommend_list"));
  }

  function findBrowsePrimaryList() {
    const selectors = [
      "#search_result_img_box",
      "#search_result_list",
      "form#works .n_work_list_container",
      ".n_work_list_container",
    ];
    const candidates = selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]);
    let best = null;
    let bestCount = 0;
    for (const candidate of candidates) {
      if (candidate.matches(".search_skeleton_box") ||
        candidate.querySelector(".search_skeleton_box") &&
          !candidate.querySelector('a[href*="product_id/"]')) continue;
      const count = candidate.querySelectorAll([
        "[data-workno]",
        "[data-list_item_product_id]",
        '[data-vue-component="product-item"][data-product_id]',
        'a[href*="product_id/"]',
      ].join(",")).length;
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    return best;
  }

  function collectBrowseCards() {
    if (/\/mypage\/(?:order|purchase|library|download)/i.test(location.pathname)) return [];
    // 手机版作品页会在主列表前插入一组热门排行。有明确的
    // “作品一览”容器时只采集该容器，避免把控件挂到排行区。
    const primaryList = isCartPage(location.href) || isProductPage(location.href)
      ? null
      : findBrowsePrimaryList();
    const scope = primaryList || document;
    const selectors = [
      "li.search_result_img_box_inner[data-workno]",
      ".search_result_img_box_inner[data-workno]",
      "tr[data-list_item_product_id]",
      "article[data-workno]",
      "li[data-workno]",
      '[data-vue-component="product-item"][data-product_id]',
    ];
    const currentMatch = location.pathname.match(/product_id\/([RBV]J\d{6,})/i);
    const currentId = currentMatch ? currentMatch[1].toUpperCase() : null;
    const cards = [];
    const seen = new Set();
    const addCard = (node) => {
      if (!node || seen.has(node)) return;
      const cartPage = isCartPage(location.href);
      const cartItem = cartPage && isRenderableCartItem(node);
      const cartRecommendation = cartPage && isCartRecommendationCard(node);
      if (cartPage && !cartItem && !cartRecommendation) return;
      const id = productIdFromNode(node);
      if (!id ||
        id === currentId ||
        cards.some((entry) => entry.id === id &&
          (entry.node.contains(node) || node.contains(entry.node))) ||
        node.closest("#work_buy, .c-purchaseBox")) return;
      seen.add(node);
      cards.push({ id, node, cartItem, cartRecommendation });
    };
    for (const node of scope.querySelectorAll(selectors.join(","))) {
      addCard(node);
    }
    for (const link of scope.querySelectorAll('a[href*="product_id/"]')) {
      const node = link.closest([
        "li",
        "article",
        "tr[data-list_item_product_id]",
        "tr[data-product_id]",
        ".search_result_img_box_inner",
        ".product-item",
        ".n_worklist_item",
        ".work",
      ].join(","));
      if (!node || !findBrowsePriceHost(node)) continue;
      addCard(node);
    }
    if (isCartPage(location.href)) {
      // 购物车的“立即购买”和“稍后再买”结构不完全等同普通列表。
      // 直接从购物车条目补采，避免某一区因外层 class 不同而漏掉。
      for (const item of getCartItems()) {
        addCard(item.closest("li.cart_list_item, li.n_work_list_item") || item);
      }
    }
    return cards;
  }

  function findBrowsePriceHost(card) {
    return firstElementBySelectors([
      "dd.work_price_wrap",
      ".work_price_wrap",
      ".n_work_price_wrap",
      ".work_price",
      '[class*="price"]',
    ], card);
  }

  function findBrowseTagAnchor(card) {
    const selectors = [
      ".work_genre",
      ".n_work_genre",
      ".work_tags",
      ".work_tag",
      ".work_deals",
      ".work_labels",
      ".search_tag",
      "[class*='genre_list']",
      "[class*='tag_list']",
    ];
    const candidates = selectors.flatMap((selector) =>
      [...card.querySelectorAll(selector)]
        .filter((node) => !node.closest(".dltracker-browse-analysis-host")));
    return candidates.at(-1) || null;
  }

  function ensureBrowseAnalysisHost(card) {
    const existed = card.querySelector(":scope > .dltracker-browse-analysis-host") ||
      card.querySelector(".dltracker-browse-analysis-host");
    if (existed) return existed;
    const anchor = findBrowseTagAnchor(card);
    const parent = anchor?.parentElement || firstElementBySelectors([
      ".work_info",
      ".n_work_info",
      "dl.work_img_main",
      "dl",
    ], card) || card;
    const host = document.createElement(parent.tagName === "DL" ? "dd" : "div");
    host.className = "dltracker-browse-analysis-host";
    if (anchor?.parentElement === parent) {
      anchor.insertAdjacentElement("afterend", host);
    } else {
      parent.appendChild(host);
    }
    return host;
  }

  function removeLegacyBrowseAnalysis(card, keepHost) {
    for (const ui of card.querySelectorAll(`.${UI_CLASSNAME}`)) {
      if (keepHost.contains(ui) || ui.closest(".dltracker-cart-host")) continue;
      const wrapper = ui.parentElement;
      ui.remove();
      if (wrapper?.matches(".dltracker-inline-host, .dltracker-wishlist-host") &&
        !wrapper.childNodes.length) {
        wrapper.remove();
      }
    }
    for (const insight of card.querySelectorAll(`.${DEAL_INSIGHT_CLASSNAME}`)) {
      if (!keepHost.contains(insight)) insight.remove();
    }
  }

  function browseCardWorkType(card) {
    const explicit = card?.querySelector?.("[data-worktype]")
      ?.getAttribute("data-worktype");
    if (explicit) return String(explicit).toUpperCase();
    const category = card?.querySelector?.(".work_category");
    const matched = String(category?.className || "").match(/(?:^|\s)type_([A-Z0-9]+)/i);
    return matched ? matched[1].toUpperCase() : "";
  }

  function browseCardAuthorElements(card) {
    return [...card.querySelectorAll([
      ".maker_name .author",
      ".work_maker .author",
      ".n_work_maker .author",
    ].join(","))];
  }

  function renderBrowseVoiceActors(card, product) {
    if (!card) return;
    if (card.querySelector(".dltracker-voice-actors")) return;
    const workType = browseCardWorkType(card);
    const authorElements = browseCardAuthorElements(card);
    const authorNames = authorElements.flatMap((element) =>
      [...element.querySelectorAll("a")].map((link) => link.textContent)
        .concat(element.querySelector("a") ? [] : [element.textContent]),
    );
    const voiceActors = mergeBrowseVoiceActorNames(
      workType,
      product?.voiceActors || [],
      authorNames,
    );
    if (!voiceActors.length) return;
    const originalText = dealPlainText(card.textContent);
    if (/(?:声優|声优)\s*[:：]|(?:^|[【[(\s])CV\s*[.．:：]/i.test(originalText)) return;

    if (workType === "SOU" && authorElements.length) {
      for (const author of authorElements) {
        if (author.querySelector(".dltracker-voice-label")) continue;
        const label = document.createElement("span");
        label.className = "dltracker-voice-label";
        label.textContent = "声优：";
        author.prepend(label);
      }
      return;
    }

    const line = document.createElement("div");
    line.className = "dltracker-voice-actors";
    line.textContent = `声优：${voiceActors.join("／")}`;
    const maker = firstElementBySelectors([
      ".maker_name",
      ".work_maker",
      ".n_work_maker",
      "[class*='maker']",
    ], card);
    if (maker) maker.insertAdjacentElement("afterend", line);
    else findBrowsePriceHost(card)?.insertAdjacentElement("beforebegin", line);
  }

  function getBrowseSortMode() {
    try {
      const value = localStorage.getItem(BROWSE_SORT_MODE_STORAGE_KEY);
      return [
        BROWSE_SORT_MODE_NATIVE,
        BUY_LATER_SORT_MODE_REACH,
        BUY_LATER_SORT_MODE_PRICE,
        BUY_LATER_SORT_MODE_PLATFORM_EXPIRY,
      ]
        .includes(value) ? value : BUY_LATER_SORT_MODE_REACH;
    } catch {
      return BUY_LATER_SORT_MODE_REACH;
    }
  }

  function setBrowseSortMode(mode) {
    try {
      localStorage.setItem(BROWSE_SORT_MODE_STORAGE_KEY, mode);
    } catch {
      // noop
    }
  }

  function getBrowseBundleFilter() {
    try {
      return localStorage.getItem(BROWSE_FILTER_STORAGE_KEY) || "all";
    } catch {
      return "all";
    }
  }

  function setBrowseBundleFilter(value) {
    try {
      localStorage.setItem(BROWSE_FILTER_STORAGE_KEY, value || "all");
    } catch {
      // noop
    }
  }

  function getBrowseHidePurchased() {
    try {
      return localStorage.getItem(BROWSE_HIDE_PURCHASED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setBrowseHidePurchased(hidden) {
    try {
      localStorage.setItem(BROWSE_HIDE_PURCHASED_STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      // noop
    }
  }

  function getBrowseHideCarted() {
    try {
      return localStorage.getItem(BROWSE_HIDE_CARTED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setBrowseHideCarted(hidden) {
    try {
      localStorage.setItem(BROWSE_HIDE_CARTED_STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      // noop
    }
  }

  function syncBrowseAccountVisibilityButtons() {
    const purchasedHidden = getBrowseHidePurchased();
    const cartedHidden = getBrowseHideCarted();
    for (const button of document.querySelectorAll(".dltracker-hide-purchased-button")) {
      button.textContent = purchasedHidden ? "显示已购买" : "隐藏已购买";
      button.setAttribute("aria-pressed", purchasedHidden ? "true" : "false");
      button.classList.toggle("is-active", purchasedHidden);
    }
    for (const button of document.querySelectorAll(".dltracker-hide-carted-button")) {
      button.textContent = cartedHidden
        ? "显示购物车/稍后再买"
        : "隐藏购物车/稍后再买";
      button.setAttribute("aria-pressed", cartedHidden ? "true" : "false");
      button.classList.toggle("is-active", cartedHidden);
    }
  }

  function toggleBrowseAccountVisibility(kind) {
    if (kind === "carted") setBrowseHideCarted(!getBrowseHideCarted());
    else setBrowseHidePurchased(!getBrowseHidePurchased());
    syncBrowseAccountVisibilityButtons();
    refreshBrowsePurchasedVisibility();
  }

  function syncBrowseCardVisibility(node) {
    if (!node) return;
    const bundleHidden = node.classList.contains("dltracker-browse-filtered-out");
    const purchasedHidden = getBrowseHidePurchased() &&
      node.classList.contains("dltracker-browse-purchased-card");
    const cartedHidden = getBrowseHideCarted() &&
      node.classList.contains("dltracker-browse-carted-card");
    node.classList.toggle(
      "dltracker-browse-account-hidden",
      purchasedHidden || cartedHidden,
    );
    node.hidden = bundleHidden || purchasedHidden || cartedHidden;
  }

  function refreshBrowsePurchasedVisibility() {
    collectBrowseCards()
      .filter(({ cartItem }) => !cartItem)
      .forEach(({ node }) => syncBrowseCardVisibility(node));
  }

  function browseCardMatchesFilter(insight, filter) {
    if (filter === "all") return true;
    const bundleCoupons = insight?.couponOptions?.filter((coupon) => coupon.minCount > 1) || [];
    if (filter === "bundle") {
      return dealNumber(insight?.bulkRule?.minCount, 1) > 1 || bundleCoupons.length > 0;
    }
    if (filter.startsWith("activity:")) {
      return String(insight?.product?.bulkbuyKey || "") === filter.slice(9);
    }
    if (filter.startsWith("coupon:")) {
      return bundleCoupons.some((coupon) =>
        String(coupon.groupKey || coupon.id) === filter.slice(7));
    }
    return true;
  }

  function stampBrowseOriginalOrder(cards) {
    const counters = new Map();
    for (const { node } of cards) {
      const parent = node.parentElement;
      if (!parent || !node.dataset.dltrackerBrowseOrder) continue;
      const current = dealNumber(node.dataset.dltrackerBrowseOrder, -1);
      counters.set(parent, Math.max(counters.get(parent) || 0, current + 1));
    }
    for (const { node } of cards) {
      const parent = node.parentElement;
      if (!parent) continue;
      const order = counters.get(parent) || 0;
      if (!node.dataset.dltrackerBrowseOrder) {
        node.dataset.dltrackerBrowseOrder = String(order);
        counters.set(parent, order + 1);
      }
    }
  }

  function resetBrowseOriginalOrder() {
    for (const { node } of collectBrowseCards()) {
      delete node.dataset.dltrackerBrowseOrder;
    }
  }

  async function applyBrowseSortAndFilter() {
    if (isCartPage(location.href) || isProductPage(location.href)) return;
    const cards = collectBrowseCards();
    if (!cards.length) return;
    stampBrowseOriginalOrder(cards);
    const mode = getBrowseSortMode();
    const filter = getBrowseBundleFilter();
    const grouped = new Map();
    for (const { id, node } of cards) {
      const insight = dealInsightById.get(String(id).toUpperCase());
      const bundleHidden = !browseCardMatchesFilter(insight, filter);
      node.classList.toggle("dltracker-browse-filtered-out", bundleHidden);
      syncBrowseCardVisibility(node);
      const parent = node.parentElement;
      if (!parent) continue;
      const record = browseRecordById.get(String(id).toUpperCase()) ||
        (/^[RB]J/i.test(id) ? await getPriceRecord(String(id).toUpperCase()) : null);
      const order = dealNumber(node.dataset.dltrackerBrowseOrder, 0);
      const reachRank = dealNumber(insight?.bestReach?.totalRate, -1);
      const entry = {
        node,
        order,
        isNewLowest: isRecordNewLowest(record, insight?.product?.price),
        reachRank,
        hypotheticalPrice: reachRank >= 0
          ? calculateHypotheticalPrice(insight?.product, insight?.bestReach)
          : Number.POSITIVE_INFINITY,
        platformDiscountExpiry: platformDiscountExpiryMillis(insight?.product),
      };
      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push(entry);
    }
    for (const [parent, entries] of grouped.entries()) {
      entries.sort(mode === BROWSE_SORT_MODE_NATIVE
        ? (a, b) => a.order - b.order
        : (a, b) => compareDealSortEntries(a, b, mode));
      const sortedNodes = entries.map((entry) => entry.node);
      const memberNodes = new Set(sortedNodes);
      const currentNodes = [...parent.children].filter((node) => memberNodes.has(node));
      if (sortedNodes.some((node, index) => currentNodes[index] !== node)) {
        sortedNodes.forEach((node) => parent.appendChild(node));
      }
    }
  }

  function browseBundleFilterOptions(cards) {
    const active = latestDealContext.cartSnapshot.active || [];
    const options = [
      { value: "all", label: "全部作品" },
      { value: "bundle", label: "所有需要凑单的优惠" },
    ];
    const seen = new Set(options.map((option) => option.value));
    const cacheRules = loadDealCache().bulkRules || {};
    for (const [key, rule] of Object.entries(cacheRules)) {
      if (!rule || dealNumber(rule.minCount, 1) <= 1 ||
        (rule.cacheUntil && rule.cacheUntil <= Date.now())) continue;
      const value = `activity:${key}`;
      if (seen.has(value)) continue;
      seen.add(value);
      const count = active.filter((item) => item.bulkbuyKey === key).length;
      options.push({
        value,
        label: `${rule.minCount}件${compactOff(rule.discountRate)}｜${count >= rule.minCount ? "已满" : "已有"}${count}/${rule.minCount}`,
      });
    }
    for (const coupon of latestDealContext.coupons) {
      if (coupon.minCount <= 1) continue;
      const value = `coupon:${coupon.groupKey || coupon.id}`;
      if (seen.has(value)) continue;
      seen.add(value);
      const count = active.filter((item) => couponMatchesDealProduct(coupon, item)).length;
      const sample = cards
        .map(({ id }) => dealInsightById.get(String(id).toUpperCase())?.product)
        .find((product) => product && couponMatchesDealProduct(coupon, product));
      const rate = couponEquivalentRate(coupon, sample || active[0] || { price: 1 });
      options.push({
        value,
        label: `${compactOff(rate, "券")}·${coupon.minCount}部起用｜${count >= coupon.minCount ? "已满" : "已有"}${count}/${coupon.minCount}`,
      });
    }
    return options;
  }

  function browseControlsInsertionBefore(group, controls) {
    const next = group?.nextSibling || null;
    return next === controls ? controls.nextSibling : next;
  }

  function findBrowseControlsAnchor(cards) {
    const nativeSort = [...document.querySelectorAll([
      "select[name*='sort']",
      ".sort_box select",
      ".search_result_sort select",
      "[class*='sort'] select",
    ].join(","))].find((select) => !select.closest(".dltracker-browse-controls"));
    if (nativeSort?.parentElement) {
      const group = nativeSort.closest(
        ".sort_box, .search_result_sort, [class*='sort'], label",
      ) || nativeSort.parentElement;
      if (group.parentElement) {
        const controls = document.querySelector(".dltracker-browse-controls");
        return {
          parent: group.parentElement,
          before: browseControlsInsertionBefore(group, controls),
        };
      }
    }
    const first = cards[0]?.node;
    const list = first?.parentElement;
    if (list?.parentElement) {
      return { parent: list.parentElement, before: list };
    }
    return list ? { parent: list, before: first } : null;
  }

  function browseSelectOptionsMatch(select, options) {
    if (!select || select.options.length !== options.length) return false;
    return options.every((option, index) =>
      select.options[index]?.value === option.value &&
      select.options[index]?.textContent === option.label);
  }

  function syncBundleFilterSelect(filter, cards, resetMissing = true) {
    if (!filter) return;
    const options = browseBundleFilterOptions(cards);
    const selected = getBrowseBundleFilter();
    if (!browseSelectOptionsMatch(filter, options)) {
      filter.replaceChildren(...options.map((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        return node;
      }));
    }
    if (options.some((option) => option.value === selected)) {
      filter.value = selected;
    } else if (resetMissing) {
      filter.value = "all";
      setBrowseBundleFilter("all");
      showDealToast("已选凑单优惠已失效，已恢复全部作品", false, 5000);
    } else {
      filter.value = "all";
    }
  }

  function injectBrowseControls(resetMissing = true) {
    if (isCartPage(location.href) || isProductPage(location.href)) return;
    const cards = collectBrowseCards();
    if (!cards.length) return;
    const anchor = findBrowseControlsAnchor(cards);
    if (!anchor) return;
    let controls = document.querySelector(".dltracker-browse-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "dltracker-browse-controls";
      const sortLabel = document.createElement("label");
      sortLabel.textContent = "优惠助手排序 ";
      const sort = document.createElement("select");
      sort.className = "dltracker-browse-sort";
      sort.innerHTML = `
        <option value="${BROWSE_SORT_MODE_NATIVE}">保持 DLsite 当前顺序</option>
        <option value="${BUY_LATER_SORT_MODE_REACH}">最高可达到折扣</option>
        <option value="${BUY_LATER_SORT_MODE_PRICE}">理论低价优先</option>
        <option value="${BUY_LATER_SORT_MODE_PLATFORM_EXPIRY}">平台折扣失效时间</option>
      `;
      sort.value = getBrowseSortMode();
      sort.addEventListener("change", () => {
        setBrowseSortMode(sort.value);
        void applyBrowseSortAndFilter();
      });
      sortLabel.appendChild(sort);
      const filterLabel = document.createElement("label");
      filterLabel.textContent = "凑单优惠 ";
      const filter = document.createElement("select");
      filter.className = "dltracker-browse-filter";
      filter.addEventListener("change", () => {
        setBrowseBundleFilter(filter.value);
        void applyBrowseSortAndFilter();
      });
      filterLabel.appendChild(filter);
      const accountButton = document.createElement("button");
      accountButton.type = "button";
      accountButton.className = "dltracker-account-info-button";
      accountButton.textContent = "账号信息";
      controls.append(sortLabel, filterLabel, accountButton);
    }
    if (anchor.before !== controls &&
      (controls.parentElement !== anchor.parent ||
        controls.nextSibling !== anchor.before)) {
      anchor.parent.insertBefore(controls, anchor.before);
    }
    const sort = controls.querySelector(".dltracker-browse-sort");
    if (sort) sort.value = getBrowseSortMode();
    const filter = controls.querySelector(".dltracker-browse-filter");
    let purchasedButton = controls.querySelector(".dltracker-hide-purchased-button");
    if (!purchasedButton) {
      purchasedButton = document.createElement("button");
      purchasedButton.type = "button";
      purchasedButton.className = "dltracker-hide-purchased-button";
      controls.appendChild(purchasedButton);
    }
    let cartedButton = controls.querySelector(".dltracker-hide-carted-button");
    if (!cartedButton) {
      cartedButton = document.createElement("button");
      cartedButton.type = "button";
      cartedButton.className = "dltracker-hide-carted-button";
      controls.appendChild(cartedButton);
    }
    syncBrowseAccountVisibilityButtons();
    syncBundleFilterSelect(filter, cards, resetMissing);
  }

  function detailProductFromDom(id) {
    const ga = document.querySelector(
      `.ga4_event_item_${id}, [class*="ga4_event_item_"][data-price]`,
    );
    const price = dealNumber(ga?.getAttribute("data-price"), parseCurrentPrice() || 0);
    const officialPrice = dealNumber(
      ga?.getAttribute("data-official_price") || ga?.getAttribute("data-official-price"),
      price,
    );
    const bulkHref = document.querySelector('a[href*="/campaign/bulkbuy/=/key/"]')?.getAttribute("href") || "";
    const bulkMatch = bulkHref.match(/\/key\/([^/?#]+)/i);
    return {
      id,
      price,
      officialPrice,
      makerId: ga?.getAttribute("data-maker_id") || ga?.getAttribute("data-maker-id") || "",
      siteId: location.pathname.split("/").filter(Boolean)[0] || "",
      workType: ga?.getAttribute("data-work_type") || ga?.getAttribute("data-work-type") || "",
      customGenres: [],
      bulkbuyKey: bulkMatch ? decodeURIComponent(bulkMatch[1]) : "",
      alternateIds: [],
    };
  }

  function appendJpyPrice(host, product) {
    if (!host || !product?.price) return;
    const priceSelectors = [
      ".work_price.discount",
      ".work_price",
      ".c-purchaseBox__value",
      ".app-price",
      "[data-testid*='price']",
    ];
    const descendants = priceSelectors
      .flatMap((selector) => [...host.querySelectorAll(selector)]);
    const localizedCurrency = /RMB|CNY|CN\s*¥|人民币|USD|US\s*\$|EUR|€|KRW|₩/i;
    const localizedSymbol = /[¥￥]/;
    const isChinesePage = /^zh(?:-|$)/i.test(document.documentElement.lang || "") ||
      /^zh(?:-|$)/i.test(navigator.language || "");
    const target = descendants.find((element) => {
      const text = element.textContent || "";
      return localizedCurrency.test(text) || (isChinesePage && localizedSymbol.test(text));
    }) || descendants[0] || host;
    const visible = target.textContent || "";
    if (host.querySelector(".dltracker-jpy-price")) return;
    const showsLocalizedPrice = localizedCurrency.test(visible) ||
      (isChinesePage && localizedSymbol.test(visible));
    if (!showsLocalizedPrice && /\bJPY\b|円/i.test(visible)) return;
    const label = document.createElement("span");
    label.className = "dltracker-jpy-price";
    label.textContent = `${Math.round(product.price).toLocaleString("ja-JP")}円`;
    target.appendChild(label);
  }

  // <deal-insight-format-core>
  function compactOff(rate, prefix = "") {
    return `${prefix}${Math.round(dealNumber(rate))}OFF`;
  }

  function compactCouponCondition(option, includeProgress = false) {
    const parts = [];
    if (option.minCount > 1) {
      let text = `${option.minCount}部起用`;
      if (includeProgress) {
        text += option.countShortfall > 0
          ? `（还差${option.countShortfall}部）`
          : "（已满足）";
      }
      parts.push(text);
    }
    if (option.minSpend > 0) {
      let text = `满${Math.round(option.minSpend).toLocaleString("ja-JP")}日元`;
      if (includeProgress) {
        text += option.spendShortfall > 0
          ? `（还差${Math.round(option.spendShortfall).toLocaleString("ja-JP")}日元）`
          : "（已满足）";
      }
      parts.push(text);
    }
    return parts.length ? parts.join("＋") : "无门槛";
  }

  function chinaExpiryText(value, earliest = false) {
    if (!value) return "到期时间未确认";
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    const pick = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${earliest ? "最早" : ""}${Number(pick("month"))}月${Number(pick("day"))}日 ${pick("hour")}:${pick("minute")}中国时间到期`;
  }

  function compactCouponExpiry(option) {
    const expiries = new Set((option.originals || [])
      .map((original) => original.expiresAt)
      .filter(Boolean));
    return chinaExpiryText(option.earliestExpiry, expiries.size > 1);
  }

  function compactCouponUsage(option) {
    if (option.repeatable) return "无限使用";
    if (option.usageLimit > 0) {
      return `${option.instances}张，已用${option.usageCount}/${option.usageLimit}`;
    }
    return `${option.instances}张，每张1次`;
  }

  function compactCouponListLabel(option) {
    const condition = option.minCount > 1
      ? `${option.minCount}部起用`
      : option.minSpend > 0
        ? `满${Math.round(option.minSpend)}`
        : "";
    return `${compactOff(option.equivalentRate, "券")}${condition ? `·${condition}` : ""}`;
  }

  function bestReachColorClass(bestPrice, lowestPrice) {
    return Number.isFinite(bestPrice) &&
      Number.isFinite(lowestPrice) && bestPrice <= lowestPrice
      ? "dltracker-best-reach-gold"
      : "dltracker-best-reach-bluegray";
  }
  // </deal-insight-format-core>

  function currencyRateFromProducts(products) {
    for (const product of Array.isArray(products) ? products : []) {
      const yen = dealNumber(product?.price);
      const cny = dealNumber(product?.cnyPrice);
      if (yen > 0 && cny > 0) return cny / yen;
    }
    return null;
  }

  function dealMoney(value, cnyRate = null) {
    const yen = toYen(value);
    return Number.isFinite(cnyRate) && cnyRate > 0
      ? `${yen}｜约${(Math.round(value) * cnyRate).toFixed(2)}元`
      : yen;
  }

  async function bulkRuleMapForProducts(products) {
    const rules = new Map();
    const seen = new Set();
    for (const product of Array.isArray(products) ? products : []) {
      const key = String(product?.bulkbuyKey || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const insightRule = dealInsightById.get(String(product.id || "").toUpperCase())?.bulkRule;
      const rule = insightRule || await ensureBulkRule(product);
      if (rule) rules.set(key, rule);
    }
    return rules;
  }

  function platformSubtotalWithBulkRules(products, rules = new Map()) {
    const cart = Array.isArray(products) ? products : [];
    const counts = new Map();
    for (const product of cart) {
      const key = String(product?.bulkbuyKey || "");
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return cart.reduce((sum, product) => {
      const currentPrice = Math.max(0, dealNumber(product?.price));
      const officialPrice = Math.max(
        currentPrice,
        dealNumber(product?.officialPrice, currentPrice),
      );
      const key = String(product?.bulkbuyKey || "");
      const rule = rules.get(key);
      if (!key || !rule ||
        (counts.get(key) || 0) < dealNumber(rule.minCount, 3)) {
        return sum + currentPrice;
      }
      const activityPrice = Math.round(
        officialPrice * (1 - dealNumber(rule.discountRate) / 100),
      );
      return sum + Math.min(currentPrice, Math.max(0, activityPrice));
    }, 0);
  }

  function plannerItemsFromProducts(products, rules, theoretical = false) {
    return (Array.isArray(products) ? products : []).map((product) => {
      const currentPrice = Math.max(0, dealNumber(product?.price));
      const officialPrice = Math.max(currentPrice, dealNumber(product?.officialPrice, currentPrice));
      const rule = rules.get(String(product?.bulkbuyKey || ""));
      const bulkPrice = rule?.discountRate
        ? Math.round(officialPrice * (1 - dealNumber(rule.discountRate) / 100))
        : null;
      return {
        id: String(product?.id || "").toUpperCase(),
        title: String(product?.title || product?.id || "未命名作品"),
        regularPrice: currentPrice,
        setPrice: Number.isFinite(bulkPrice) && bulkPrice < currentPrice ? bulkPrice : null,
        setGroup: rule ? String(product?.bulkbuyKey || "") : "",
        setMinCount: theoretical ? 1 : Math.max(2, dealNumber(rule?.minCount, 3)),
      };
    });
  }

  function plannerCouponsFromDeals(coupons, products, theoretical = false) {
    const result = [];
    for (const coupon of Array.isArray(coupons) ? coupons : []) {
      const eligibleIds = products
        .filter((product) => couponMatchesDealProduct(coupon, product))
        .map((product) => String(product.id).toUpperCase());
      if (!eligibleIds.length) continue;
      const proportionalSpendCoupon = theoretical &&
        coupon.discountType === "fixed" && coupon.minSpend > 0;
      result.push({
        id: coupon.groupKey || coupon.id,
        name: compactCouponListLabel({
          ...coupon,
          equivalentRate: couponEquivalentRate(coupon, products[0]),
        }),
        type: proportionalSpendCoupon ? "percent" : coupon.discountType,
        value: proportionalSpendCoupon
          ? Math.min(100, dealNumber(coupon.discount) / coupon.minSpend * 100)
          : coupon.discount,
        minSpend: theoretical ? 0 : coupon.minSpend,
        minEligibleCount: theoretical ? 1 : coupon.minCount,
        maxDiscount: proportionalSpendCoupon
          ? dealNumber(coupon.discount)
          : coupon.maxDiscount || 0,
        scope: "all",
        minSpendScope: "order",
        stackMode: "after",
        allEligible: false,
        repeatable: coupon.repeatable,
        maxUses: coupon.repeatable ? Number.POSITIVE_INFINITY : coupon.instances || 1,
        eligibleIds,
      });
    }
    return result;
  }

  function pruneDominatedPlannerCoupons(coupons) {
    const list = Array.isArray(coupons) ? coupons : [];
    const eligibilityKey = (coupon) => [
      coupon.type,
      coupon.minSpend,
      coupon.minEligibleCount,
      coupon.scope,
      coupon.minSpendScope,
      coupon.stackMode,
      [...coupon.eligibleIds].sort().join(","),
    ].join("|");
    const capAtLeast = (candidate, other) =>
      other.maxDiscount <= 0 ||
      (candidate.maxDiscount > 0 && other.maxDiscount >= candidate.maxDiscount);
    return list.filter((coupon, index) => !list.some((other, otherIndex) => {
      if (index === otherIndex || !other.repeatable) return false;
      if (eligibilityKey(coupon) !== eligibilityKey(other)) return false;
      if (other.value < coupon.value || !capAtLeast(coupon, other)) return false;
      return other.value > coupon.value || other.maxDiscount !== coupon.maxDiscount ||
        String(other.id) < String(coupon.id);
    }));
  }

  async function calculateCartPlans(products, coupons) {
    const active = (Array.isArray(products) ? products : [])
      .filter((product) => product?.id && dealNumber(product?.price) >= 0);
    if (!active.length) {
      return {
        empty: true,
        platformTotal: 0,
        currentBestTotal: 0,
        theoreticalTotal: 0,
        exact: true,
        splitPlan: null,
      };
    }
    const rules = await bulkRuleMapForProducts(active);
    const items = plannerItemsFromProducts(active, rules, false);
    const theoreticalItems = plannerItemsFromProducts(active, rules, true);
    const plannerCoupons = pruneDominatedPlannerCoupons(
      plannerCouponsFromDeals(coupons, active, false),
    );
    const theoreticalCoupons = pruneDominatedPlannerCoupons(
      plannerCouponsFromDeals(coupons, active, true),
    );
    const exact = items.length <= DEAL_PLANNER_MAX_ITEMS &&
      plannerCoupons.length <= DEAL_PLANNER_MAX_COUPONS;
    const platformTotal = items.reduce((sum, item) => sum + item.regularPrice, 0);
    const singleQuote = quoteBestSingleOrder(items, plannerCoupons);
    const currentPlan = exact ? optimizeDealPlan(items, plannerCoupons) : null;
    const currentBestTotal = currentPlan?.total ?? singleQuote.total;
    const theoreticalPlan = exact
      ? optimizeDealPlan(theoreticalItems, theoreticalCoupons)
      : null;
    const theoreticalQuote = theoreticalPlan
      ? null
      : quoteBestSingleOrder(theoreticalItems, theoreticalCoupons);
    const theoreticalTotal = theoreticalPlan?.total ?? theoreticalQuote.total;
    return {
      empty: false,
      products: active,
      rules,
      items,
      plannerCoupons,
      platformTotal,
      singleQuote,
      currentPlan,
      currentBestTotal,
      theoreticalPlan,
      theoreticalTotal,
      exact,
      splitPlan: currentPlan && currentPlan.total < singleQuote.total &&
        currentPlan.orders.length > 1 ? currentPlan : null,
    };
  }

  function unmetBundleOffers(products, coupons, rules) {
    const offers = [];
    const active = Array.isArray(products) ? products : [];
    const platformTotal = platformSubtotalWithBulkRules(active, rules);
    for (const [key, rule] of rules.entries()) {
      const eligible = active.filter((product) => product.bulkbuyKey === key);
      const missing = Math.max(0, dealNumber(rule.minCount, 3) - eligible.length);
      if (missing > 0) {
        offers.push({ type: "activity", key, rule, missing, eligible });
      }
    }
    for (const coupon of Array.isArray(coupons) ? coupons : []) {
      const eligible = active.filter((product) => couponMatchesDealProduct(coupon, product));
      const missing = Math.max(0, coupon.minCount - eligible.length);
      if (coupon.minCount > 1 && missing > 0) {
        offers.push({
          type: "coupon",
          key: coupon.groupKey || coupon.id,
          coupon,
          missing,
          missingSpend: Math.max(0, coupon.minSpend - platformTotal),
          targetSpend: coupon.minSpend,
          eligible,
        });
      }
      if (coupon.minSpend > platformTotal && eligible.length >= coupon.minCount) {
        offers.push({
          type: "spend",
          key: coupon.groupKey || coupon.id,
          coupon,
          missingSpend: coupon.minSpend - platformTotal,
          targetSpend: coupon.minSpend,
          eligible,
        });
      }
    }
    return offers;
  }

  function compareRecommendationOrder(a, b) {
    const aOrders = a.map((item) => dealNumber(item.order)).sort((x, y) => x - y);
    const bOrders = b.map((item) => dealNumber(item.order)).sort((x, y) => x - y);
    for (let index = 0; index < Math.min(aOrders.length, bOrders.length); index += 1) {
      if (aOrders[index] !== bOrders[index]) return aOrders[index] - bOrders[index];
    }
    return aOrders.length - bOrders.length;
  }

  function recommendationCombinationFinalTotal(items) {
    return items.reduce((sum, item) =>
      sum + Math.max(0, dealNumber(item.recommendationPrice, item.price)), 0);
  }

  function recommendationCombinationRate(items) {
    const regular = items.reduce((sum, item) => sum + Math.max(
      dealNumber(item.price),
      dealNumber(item.officialPrice, item.price),
    ), 0);
    const final = recommendationCombinationFinalTotal(items);
    return regular > 0 ? (1 - final / regular) * 100 : 0;
  }

  function spendThresholdCombinations(
    items,
    missingSpend,
    limit = 30,
    minimumItems = 0,
  ) {
    const target = Math.max(0, Math.ceil(dealNumber(missingSpend)));
    if (target <= 0) return [[]];
    const candidates = (Array.isArray(items) ? items : [])
      .filter((item) => dealNumber(item?.price) > 0);
    if (!candidates.length) return [];

    const minimumCount = Math.max(1, Math.ceil(dealNumber(minimumItems)));
    if (minimumCount > candidates.length) return [];
    // 正价格组合第一次越过门槛时，超额一定小于候选最高价；更大的
    // 小计不可能进入“少超额优先”的前三名，无需保留其 DP 状态。
    const maximumPrice = Math.max(...candidates.map((item) =>
      Math.round(dealNumber(item.price))));
    const maximumSubtotal = target + maximumPrice;
    const states = Array.from({ length: candidates.length + 1 }, () => new Map());
    states[0].set(0, []);
    candidates.forEach((item, itemIndex) => {
      const price = Math.round(dealNumber(item.price));
      for (let count = itemIndex + 1; count >= 1; count -= 1) {
        for (const [subtotal, combination] of states[count - 1]) {
          const nextSubtotal = subtotal + price;
          if (nextSubtotal > maximumSubtotal) continue;
          const nextCombination = [...combination, item];
          const existing = states[count].get(nextSubtotal);
          if (!existing ||
            recommendationCombinationFinalTotal(nextCombination) <
              recommendationCombinationFinalTotal(existing) ||
            (recommendationCombinationFinalTotal(nextCombination) ===
              recommendationCombinationFinalTotal(existing) &&
              recommendationCombinationRate(nextCombination) >
                recommendationCombinationRate(existing)) ||
            (recommendationCombinationFinalTotal(nextCombination) ===
              recommendationCombinationFinalTotal(existing) &&
              Math.abs(recommendationCombinationRate(nextCombination) -
                recommendationCombinationRate(existing)) < 0.001 &&
              compareRecommendationOrder(nextCombination, existing) < 0)) {
            states[count].set(nextSubtotal, nextCombination);
          }
        }
      }
    });
    const result = [];
    for (let count = minimumCount; count <= candidates.length; count += 1) {
      result.push(...[...states[count].entries()]
        .filter(([subtotal]) => subtotal >= target)
        .map(([, combination]) => combination));
    }
    return result.sort((a, b) => {
      const aSubtotal = a.reduce((sum, item) => sum + dealNumber(item.price), 0);
      const bSubtotal = b.reduce((sum, item) => sum + dealNumber(item.price), 0);
      return (aSubtotal - target) - (bSubtotal - target) ||
        b.length - a.length ||
        recommendationCombinationFinalTotal(a) -
          recommendationCombinationFinalTotal(b) ||
        recommendationCombinationRate(b) - recommendationCombinationRate(a) ||
        compareRecommendationOrder(a, b);
    }).slice(0, limit);
  }

  function calculationUsesCoupon(calculation, couponKey) {
    const expected = String(couponKey || "");
    const orders = calculation?.currentPlan?.orders?.length
      ? calculation.currentPlan.orders
      : calculation?.singleQuote ? [calculation.singleQuote] : [];
    return orders.some((order) => String(order.couponId || "") === expected);
  }

  function couponIsCurrent(coupon, now = Date.now()) {
    return !dealNumber(coupon?.earliestExpiry || coupon?.expiresAt) ||
      dealNumber(coupon?.earliestExpiry || coupon?.expiresAt) > now;
  }

  function highestRecommendationCoupons(coupons, product) {
    const applicable = (Array.isArray(coupons) ? coupons : [])
      .filter((coupon) => couponIsCurrent(coupon) &&
        couponMatchesDealProduct(coupon, product))
      .map((coupon) => ({
        coupon,
        rate: couponEquivalentRate(coupon, product),
      }));
    const highest = Math.max(0, ...applicable.map((entry) => entry.rate));
    return applicable
      .filter((entry) => Math.abs(entry.rate - highest) < 0.001)
      .map((entry) => entry.coupon);
  }

  function recommendationCouponEligibility(targetCoupon, coupons, product) {
    if (!targetCoupon || !couponIsCurrent(targetCoupon) ||
      !couponMatchesDealProduct(targetCoupon, product)) {
      return { eligible: false, targetRate: 0, tied: [] };
    }
    const targetRate = couponEquivalentRate(targetCoupon, product);
    const applicable = (Array.isArray(coupons) ? coupons : [])
      .filter((coupon) => couponIsCurrent(coupon) &&
        couponMatchesDealProduct(coupon, product));
    const higher = applicable.some((coupon) =>
      couponEquivalentRate(coupon, product) > targetRate + 0.001);
    return {
      eligible: !higher,
      targetRate,
      tied: applicable.filter((coupon) =>
        (coupon.groupKey || coupon.id) !==
          (targetCoupon.groupKey || targetCoupon.id) &&
        Math.abs(couponEquivalentRate(coupon, product) - targetRate) < 0.001),
    };
  }

  function targetRecommendationOffers(active, coupons, rules, targetProduct) {
    if (!targetProduct) return [];
    const cart = Array.isArray(active) ? active : [];
    const subtotal = platformSubtotalWithBulkRules(cart, rules);
    const targetRule = rules.get(String(targetProduct.bulkbuyKey || ""));
    const officialPrice = Math.max(
      dealNumber(targetProduct.price),
      dealNumber(targetProduct.officialPrice, targetProduct.price),
    );
    const saleRate = officialPrice > 0
      ? Math.max(0, (1 - dealNumber(targetProduct.price) / officialPrice) * 100)
      : 0;
    const activityCount = targetProduct.bulkbuyKey
      ? cart.filter((product) =>
        product.bulkbuyKey === targetProduct.bulkbuyKey).length
      : 0;
    const activityMissing = targetRule &&
      dealNumber(targetRule.discountRate) > saleRate + 0.001
      ? Math.max(0, dealNumber(targetRule.minCount, 3) - activityCount)
      : 0;
    const couponOffers = highestRecommendationCoupons(coupons, targetProduct)
      .map((coupon) => {
        const eligibleCount = cart.filter((product) =>
          couponMatchesDealProduct(coupon, product)).length;
        const missing = Math.max(0, dealNumber(coupon.minCount, 1) - eligibleCount);
        const missingSpend = Math.max(0, dealNumber(coupon.minSpend) - subtotal);
        if (!missing && !missingSpend) return null;
        return {
          type: missingSpend > 0 ? "spend" : "candidates",
          key: coupon.groupKey || coupon.id,
          coupon,
          missing,
          missingSpend,
          targetSpend: dealNumber(coupon.minSpend),
          needsActivity: activityMissing > 0,
          activityKey: activityMissing > 0 ? targetProduct.bulkbuyKey : "",
          activityRule: activityMissing > 0 ? targetRule : null,
          activityMissing,
        };
      })
      .filter(Boolean);
    if (couponOffers.length) return couponOffers;
    if (activityMissing > 0) {
      return [{
        type: "candidates",
        key: targetProduct.bulkbuyKey,
        coupon: null,
        missing: activityMissing,
        missingSpend: 0,
        targetSpend: 0,
        needsActivity: true,
        activityKey: targetProduct.bulkbuyKey,
        activityRule: targetRule,
        activityMissing,
      }];
    }
    return [];
  }

  function recommendationCandidateMatchesOffer(product, offer, coupons) {
    if (!product?.id || !(dealNumber(product.price) > 0)) return false;
    if (offer.needsActivity && product.bulkbuyKey !== offer.activityKey) return false;
    if (!offer.coupon) return true;
    return recommendationCouponEligibility(
      offer.coupon,
      coupons,
      product,
    ).eligible;
  }

  function recommendationRuleForProduct(product, rules, offer) {
    if (offer?.needsActivity && product.bulkbuyKey === offer.activityKey) {
      return offer.activityRule;
    }
    return rules.get(String(product.bulkbuyKey || "")) ||
      dealInsightById.get(String(product.id || "").toUpperCase())?.bulkRule ||
      null;
  }

  function recommendationCouponRateAtPrice(coupon, product, platformPrice) {
    if (!coupon) return 0;
    if (coupon.discountType === "percent") {
      const rawDiscount = platformPrice * Math.min(100, coupon.discount) / 100;
      const discount = coupon.maxDiscount > 0
        ? Math.min(rawDiscount, coupon.maxDiscount)
        : rawDiscount;
      return platformPrice > 0 ? discount / platformPrice * 100 : 0;
    }
    if (!(coupon.minSpend > 0)) {
      return platformPrice > 0
        ? Math.min(100, coupon.discount / platformPrice * 100)
        : 0;
    }
    return couponEquivalentRate(coupon, product);
  }

  function recommendationCandidatePricing(product, offer, coupons, rules) {
    const officialPrice = Math.max(
      dealNumber(product.price),
      dealNumber(product.officialPrice, product.price),
    );
    const saleRate = officialPrice > 0
      ? Math.max(0, (1 - dealNumber(product.price) / officialPrice) * 100)
      : 0;
    const rule = recommendationRuleForProduct(product, rules, offer);
    const activityRate = rule && product.bulkbuyKey
      ? Math.max(0, dealNumber(rule.discountRate))
      : 0;
    const useActivity = Boolean(rule) &&
      (offer.needsActivity || activityRate > saleRate + 0.001);
    const platformRate = useActivity ? activityRate : saleRate;
    const platformPrice = Math.round(officialPrice * (1 - platformRate / 100));
    const coupon = offer.coupon || highestRecommendationCoupons(coupons, product)[0] || null;
    const couponRate = recommendationCouponRateAtPrice(
      coupon,
      product,
      platformPrice,
    );
    const recommendationPrice = Math.max(
      0,
      Math.round(platformPrice * (1 - couponRate / 100)),
    );
    const totalRate = officialPrice > 0
      ? Math.max(0, (1 - recommendationPrice / officialPrice) * 100)
      : 0;
    const couponState = coupon
      ? recommendationCouponEligibility(coupon, coupons, product)
      : { tied: [] };
    const equalCouponPaths = (couponState.tied || []).filter((item) => {
      const rate = recommendationCouponRateAtPrice(item, product, platformPrice);
      return Math.round(platformPrice * (1 - rate / 100)) === recommendationPrice;
    });
    const alternativeLabels = equalCouponPaths.length
      ? [`同档券：${equalCouponPaths.map((item) => compactCouponListLabel({
          ...item,
          equivalentRate: couponEquivalentRate(item, product),
        })).join("、")}`]
      : [];
    return {
      recommendationPrice,
      totalRate,
      platformRate,
      platformLabel: useActivity
        ? `${dealNumber(rule.minCount, 3)}件${compactOff(activityRate)}`
        : saleRate > 0 ? `当前${compactOff(saleRate)}` : "无折扣",
      coupon,
      couponLabel: coupon ? compactCouponListLabel({
        ...coupon,
        equivalentRate: couponEquivalentRate(coupon, product),
      }) : "—",
      activityLabel: useActivity
        ? `${dealNumber(rule.minCount, 3)}件${compactOff(activityRate)}`
        : "—",
      applicableActivityLabel: rule && product.bulkbuyKey && activityRate > 0
        ? `${dealNumber(rule.minCount, 3)}件${compactOff(activityRate)}`
        : "—",
      alternativeLabels,
    };
  }

  function sortRecommendationCandidates(candidates) {
    return [...candidates].sort((a, b) =>
      dealNumber(b.totalRate) - dealNumber(a.totalRate) ||
      dealNumber(a.recommendationPrice, Infinity) -
        dealNumber(b.recommendationPrice, Infinity) ||
      dealNumber(a.order) - dealNumber(b.order));
  }

  function targetedRecommendationCalculation(products, coupon, rules) {
    const items = plannerItemsFromProducts(products, rules, false);
    const plannerCoupon = coupon
      ? plannerCouponsFromDeals([coupon], products, false)
      : [];
    const quote = quoteBestSingleOrder(items, plannerCoupon);
    return {
      products,
      singleQuote: quote,
      currentPlan: { orders: [quote] },
      currentBestTotal: quote.total,
    };
  }

  function productsWithRecommendationQuote(products, calculation, offer, rules) {
    const finalPrices = recommendationFinalPriceMap(calculation);
    const quote = calculation.currentPlan?.orders?.[0] || calculation.singleQuote;
    const lines = new Map((quote?.lines || []).map((line) =>
      [String(line.id).toUpperCase(), line]));
    return products.map((product) => {
      const id = String(product.id).toUpperCase();
      const line = lines.get(id);
      const officialPrice = Math.max(
        dealNumber(product.price),
        dealNumber(product.officialPrice, product.price),
      );
      const finalPrice = finalPrices.get(id) ?? dealNumber(product.price);
      const saleRate = officialPrice > 0
        ? Math.max(0, (1 - dealNumber(product.price) / officialPrice) * 100)
        : 0;
      const rule = recommendationRuleForProduct(product, rules, offer);
      const activityLabel = line?.dealApplied && rule
        ? `${dealNumber(rule.minCount, 3)}件${compactOff(rule.discountRate)}`
        : "—";
      const applicableActivityLabel = rule && product.bulkbuyKey &&
        dealNumber(rule.discountRate) > 0
        ? `${dealNumber(rule.minCount, 3)}件${compactOff(rule.discountRate)}`
        : "—";
      return {
        ...product,
        recommendationPrice: finalPrice,
        totalRate: officialPrice > 0
          ? Math.max(0, (1 - finalPrice / officialPrice) * 100)
          : 0,
        platformRate: line?.dealApplied && rule
          ? Math.max(0, dealNumber(rule.discountRate))
          : saleRate,
        platformLabel: line?.dealApplied
          ? activityLabel
          : saleRate > 0 ? `当前${compactOff(saleRate)}` : "无折扣",
        activityLabel,
        applicableActivityLabel,
        couponLabel: line?.couponTarget ? product.couponLabel : "—",
        alternativeLabels: product.alternativeLabels,
      };
    });
  }

  async function buildBundleRecommendations(
    active,
    later,
    coupons,
    rules,
    targetProduct = null,
  ) {
    const recommendationRules = new Map(rules);
    const targetRules = targetProduct
      ? await bulkRuleMapForProducts([targetProduct])
      : new Map();
    for (const [key, rule] of targetRules) recommendationRules.set(key, rule);
    const offers = targetRecommendationOffers(
      active,
      coupons,
      recommendationRules,
      targetProduct,
    );
    const results = [];
    for (const offer of offers) {
      const matching = (Array.isArray(later) ? later : [])
        .map((product, order) => ({ product, order }))
        .filter(({ product }) =>
          recommendationCandidateMatchesOffer(product, offer, coupons));
      const withHistory = await Promise.all(matching.map(async ({ product, order }) => {
        const record = await getPriceRecord(String(product.id).toUpperCase());
        if (!isRecordNewLowest(record, product.price)) return null;
        return {
          ...product,
          ...recommendationCandidatePricing(
            product,
            offer,
            coupons,
            recommendationRules,
          ),
          order,
          atLowest: true,
          lowestPrice: safeNumber(record?.lowestPrice),
          historyRegularPrice: safeNumber(record?.regularPrice),
        };
      }));
      const candidates = sortRecommendationCandidates(withHistory.filter(Boolean));
      if (!candidates.length) continue;
      if (offer.type !== "spend") {
        results.push({ kind: "candidates", offer, candidates });
        continue;
      }
      const combinations = spendThresholdCombinations(
        candidates,
        offer.missingSpend,
        3,
        Math.max(offer.missing, offer.activityMissing),
      );
      const alternatives = [];
      for (const added of combinations) {
        const combined = [...active, ...added];
        const combinedRules = new Map(recommendationRules);
        for (const product of added) {
          const rule = recommendationRuleForProduct(product, combinedRules, offer);
          if (rule && product.bulkbuyKey) combinedRules.set(product.bulkbuyKey, rule);
        }
        const calculation = targetedRecommendationCalculation(
          combined,
          offer.coupon,
          combinedRules,
        );
        if (!calculationUsesCoupon(calculation, offer.key)) continue;
        const quotedAdded = productsWithRecommendationQuote(
          added,
          calculation,
          offer,
          combinedRules,
        );
        alternatives.push({
          added: quotedAdded,
          calculation,
          total: calculation.currentBestTotal,
          spendOverage: Math.max(0, combined.reduce((sum, product) =>
            sum + dealNumber(product.price), 0) - offer.targetSpend),
        });
      }
      if (alternatives.length) {
        results.push({ kind: "spend", offer, alternatives });
      }
    }
    return results;
  }

  function recommendationFinalPriceMap(calculation) {
    const result = new Map();
    const orders = calculation?.currentPlan?.orders?.length
      ? calculation.currentPlan.orders
      : calculation?.singleQuote ? [calculation.singleQuote] : [];
    for (const order of orders) {
      const targets = (order.lines || []).filter((line) => line.couponTarget);
      const couponBase = targets.reduce(
        (sum, line) => sum + Math.max(0, dealNumber(line.price)),
        0,
      );
      let allocated = 0;
      let targetIndex = 0;
      for (const line of order.lines || []) {
        let discount = 0;
        if (line.couponTarget && couponBase > 0 && order.discount > 0) {
          discount = targetIndex === targets.length - 1
            ? order.discount - allocated
            : Math.floor(order.discount * dealNumber(line.price) / couponBase);
          allocated += discount;
          targetIndex += 1;
        }
        result.set(
          String(line.id).toUpperCase(),
          Math.max(0, dealNumber(line.price) - discount),
        );
      }
    }
    return result;
  }

  function recommendationPreCouponPriceMap(calculation) {
    const result = new Map();
    const orders = calculation?.currentPlan?.orders?.length
      ? calculation.currentPlan.orders
      : calculation?.singleQuote ? [calculation.singleQuote] : [];
    for (const order of orders) {
      for (const line of order.lines || []) {
        result.set(
          String(line.id).toUpperCase(),
          Math.max(0, dealNumber(line.price)),
        );
      }
    }
    return result;
  }

  function recommendationMoneyLines(value, cnyRate = null) {
    const yen = toYen(value);
    return Number.isFinite(cnyRate) && cnyRate > 0
      ? [`约${(Math.round(value) * cnyRate).toFixed(2)}元/${yen}`]
      : [yen];
  }

  function appendRecommendationCellLines(cell, lines) {
    (Array.isArray(lines) ? lines : [lines]).forEach((value) => {
      const line = document.createElement("div");
      line.textContent = value;
      cell.appendChild(line);
    });
  }

  function recommendationStrongestDiscountRate(rates) {
    return Math.max(0, ...(Array.isArray(rates) ? rates : []).map((rate) =>
      Math.max(0, dealNumber(rate))));
  }

  function appendRecommendationDiscounts(cell, discounts) {
    const strongest = recommendationStrongestDiscountRate(
      discounts.map((item) => item.rate),
    );
    cell.classList.add("dltracker-reach-recommendation-discounts");
    cell.title = "现在 / 平台 / 史低";
    discounts.forEach((item, index) => {
      if (index > 0) cell.appendChild(document.createTextNode("/"));
      const value = document.createElement("span");
      value.textContent = item.text;
      if (strongest > 0 && Math.abs(dealNumber(item.rate) - strongest) < 0.001) {
        value.className = "is-strongest";
      }
      cell.appendChild(value);
    });
  }

  function buyLaterOwnerForRecommendation(productId) {
    const expected = String(productId || "").toUpperCase();
    if (!expected) return null;
    return getBuyLaterOwnerItems().find((item) =>
      extractRjCodeFromCartItem(item) === expected) || null;
  }

  function recommendationProductHref(productId) {
    const owner = buyLaterOwnerForRecommendation(productId);
    return owner?.querySelector('a[href*="product_id/"]')?.href || "";
  }

  function nativeRestoreCartAction(productId) {
    const owner = buyLaterOwnerForRecommendation(productId);
    if (!owner) return null;
    const nativeClassAction = owner.querySelector(
      "a.link_move_cart, button.link_move_cart",
    );
    if (nativeClassAction) return nativeClassAction;
    return [...owner.querySelectorAll(
      'a, button, input[type="button"], input[type="submit"]',
    )].find((node) => {
      if (node.closest("[class^='dltracker-'], [class*=' dltracker-']")) {
        return false;
      }
      const label = dealPlainText([
        node.textContent,
        node.value,
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
      ].filter(Boolean).join(" "));
      return /放回购物车|カート(?:に|へ)戻す/i.test(label);
    }) || null;
  }

  function restoreRecommendationToCart(productId, control) {
    const id = String(productId || "").toUpperCase();
    if (pendingRecommendationRestoreIds.has(id)) return;
    const action = nativeRestoreCartAction(id);
    if (!action) {
      showDealToast(`${id} 未找到 DLsite 原生放回按钮`, true, 6000);
      return;
    }
    pendingRecommendationRestoreIds.add(id);
    control.disabled = true;
    control.textContent = "处理中";
    action.click();
    showDealToast(`${id} 已交给 DLsite 放回购物车`, false, 4000);
    setTimeout(() => {
      pendingRecommendationRestoreIds.delete(id);
      if (!control.isConnected) return;
      const stillLater = Boolean(buyLaterOwnerForRecommendation(id));
      control.disabled = !stillLater;
      control.textContent = stillLater ? "加购物车" : "已加入";
    }, 2500);
  }

  function recommendationRemarkLines(product) {
    const lines = [...(product.alternativeLabels || [])];
    const activity = product.applicableActivityLabel || product.activityLabel;
    if (activity && activity !== "—") {
      lines.push(`适用活动：${activity}`);
    }
    return lines.length ? lines : ["—"];
  }

  function appendRecommendationActions(row, product) {
    const detailCell = document.createElement("td");
    detailCell.className = "dltracker-reach-recommendation-action-cell";
    const href = recommendationProductHref(product.id);
    if (href) {
      const detail = document.createElement("a");
      detail.className = "dltracker-reach-recommendation-action";
      detail.href = href;
      detail.target = "_blank";
      detail.rel = "noopener noreferrer";
      detail.textContent = "看详情";
      detailCell.appendChild(detail);
    } else {
      detailCell.textContent = "—";
    }

    const cartCell = document.createElement("td");
    cartCell.className = "dltracker-reach-recommendation-action-cell";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "dltracker-reach-recommendation-action";
    add.textContent = "加购物车";
    const pending = pendingRecommendationRestoreIds.has(
      String(product.id || "").toUpperCase(),
    );
    const nativeAction = nativeRestoreCartAction(product.id);
    add.disabled = pending || !nativeAction;
    if (pending) {
      add.textContent = "处理中";
    } else if (!nativeAction) {
      add.title = "未找到 DLsite 原生放回购物车按钮";
    }
    add.addEventListener("click", () =>
      restoreRecommendationToCart(product.id, add));
    cartCell.appendChild(add);
    row.append(detailCell, cartCell);
  }

  function appendRecommendationTable(
    parent,
    recommendation,
    cnyRate,
    options = {},
  ) {
    const products = recommendation.candidates || recommendation.added || [];
    const finalPrices = recommendation.calculation
      ? recommendationFinalPriceMap(recommendation.calculation)
      : new Map();
    const wrapper = document.createElement("div");
    wrapper.className = "dltracker-reach-recommendation-table-wrap";
    const table = document.createElement("table");
    table.className = "dltracker-reach-recommendation-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["作品", "人民币/日元", "现在/平台/史低", "备注", "看详情", "加购物车"]
      .forEach((label) => {
        const cell = document.createElement("th");
        cell.textContent = label;
        headRow.appendChild(cell);
      });
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    products.forEach((product, index) => {
      const row = document.createElement("tr");
      if (options.collapseAfter > 0 && index >= options.collapseAfter) {
        row.hidden = true;
        row.className = "dltracker-reach-recommendation-extra";
      }
      const officialPrice = Math.max(
        dealNumber(product.price),
        dealNumber(product.officialPrice, product.price),
      );
      const finalPrice = finalPrices.get(String(product.id).toUpperCase()) ??
        dealNumber(product.recommendationPrice, product.price);
      const historyRegularPrice = Math.max(
        officialPrice,
        dealNumber(product.historyRegularPrice, officialPrice),
      );
      const platformRate = Math.max(0, dealNumber(product.platformRate));
      const currentRate = officialPrice > 0
        ? Math.max(0, (1 - finalPrice / officialPrice) * 100)
        : 0;
      const historyRate = historyRegularPrice > 0 &&
        dealNumber(product.lowestPrice) < historyRegularPrice
        ? Math.max(0, (1 - dealNumber(product.lowestPrice) / historyRegularPrice) * 100)
        : 0;
      const discounts = [
        { rate: currentRate, text: currentRate > 0 ? compactOff(currentRate) : "无折扣" },
        { rate: platformRate, text: platformRate > 0 ? compactOff(platformRate) : "无折扣" },
        { rate: historyRate, text: historyRate > 0 ? compactOff(historyRate) : "无折扣" },
      ];
      const values = [
        product.id || product.title || `作品${index + 1}`,
        recommendationMoneyLines(finalPrice, cnyRate),
        discounts,
        recommendationRemarkLines(product),
      ];
      values.forEach((value, cellIndex) => {
        const cell = document.createElement(cellIndex === 0 ? "th" : "td");
        if (cellIndex === 2) {
          appendRecommendationDiscounts(cell, value);
        } else {
          appendRecommendationCellLines(cell, value);
        }
        if (cellIndex === 0 && product.title && product.title !== product.id) {
          cell.title = product.title;
        }
        row.appendChild(cell);
      });
      appendRecommendationActions(row, product);
      body.appendChild(row);
    });
    table.append(head, body);
    wrapper.appendChild(table);
    parent.appendChild(wrapper);

    if (options.collapseAfter > 0 && products.length > options.collapseAfter) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "dltracker-reach-recommendation-toggle";
      toggle.textContent = `查看全部 ${products.length} 部`;
      toggle.addEventListener("click", () => {
        const expanded = toggle.dataset.expanded === "true";
        wrapper.querySelectorAll(".dltracker-reach-recommendation-extra")
          .forEach((row) => { row.hidden = expanded; });
        toggle.dataset.expanded = expanded ? "false" : "true";
        toggle.textContent = expanded
          ? `查看全部 ${products.length} 部`
          : "收起到前 10 部";
      });
      parent.appendChild(toggle);
    }

    if (!recommendation.calculation) return;
    const preCouponPrices = recommendationPreCouponPriceMap(
      recommendation.calculation,
    );
    const addedBefore = products.reduce((sum, product) =>
      sum + (preCouponPrices.get(String(product.id).toUpperCase()) ??
        Math.max(0, dealNumber(product.price))), 0);
    const addedAfter = products.reduce((sum, product) =>
      sum + (finalPrices.get(String(product.id).toUpperCase()) ??
        Math.max(0, dealNumber(product.price))), 0);
    const totals = document.createElement("div");
    totals.className = "dltracker-reach-recommendation-summary";
    const combinedBefore = (recommendation.calculation.products || []).reduce(
      (sum, product) => sum + (preCouponPrices.get(
        String(product.id).toUpperCase(),
      ) ?? Math.max(0, dealNumber(product.price))),
      0,
    );
    appendReachRow(
      totals,
      "推荐作品小计",
      `优惠前 ${dealMoney(addedBefore, cnyRate)}｜优惠后 ${dealMoney(addedAfter, cnyRate)}`,
    );
    appendReachRow(
      totals,
      "购物车＋推荐总计",
      `优惠前 ${dealMoney(combinedBefore, cnyRate)}｜优惠后 ${dealMoney(recommendation.total, cnyRate)}`,
    );
    parent.appendChild(totals);
  }

  function appendOrderDetails(parent, order, index, cnyRate) {
    const details = document.createElement("details");
    details.className = "dltracker-reach-order";
    const summary = document.createElement("summary");
    const offers = [];
    const activityCount = order.lines.filter((line) => line.dealApplied).length;
    if (activityCount) offers.push(`多件活动${activityCount}部`);
    if (order.couponName) offers.push(order.couponName);
    const offer = offers.length ? `｜${offers.join("＋")}` : "";
    summary.textContent = `第${index + 1}单｜${order.lines.length}部${offer}｜${dealMoney(order.total, cnyRate)}`;
    const formula = document.createElement("div");
    formula.className = "dltracker-reach-formula";
    formula.textContent = `${dealMoney(order.subtotal, cnyRate)}${order.discount ? ` - ${dealMoney(order.discount, cnyRate)}` : ""} = ${dealMoney(order.total, cnyRate)}`;
    const list = document.createElement("ul");
    for (const line of order.lines) {
      const item = document.createElement("li");
      item.textContent = `${line.title}｜${dealMoney(line.price, cnyRate)}`;
      list.appendChild(item);
    }
    details.append(summary, formula, list);
    parent.appendChild(details);
  }

  function appendReachRow(parent, label, value, className = "") {
    const row = document.createElement("div");
    row.className = `dltracker-reach-row ${className}`.trim();
    const name = document.createElement("strong");
    name.textContent = label;
    const content = document.createElement("span");
    content.textContent = value;
    row.append(name, content);
    parent.appendChild(row);
  }

  function bestReachFormulaLines(insight, cnyRate = null) {
    const product = insight.product;
    const reach = insight.bestReach;
    const officialPrice = Math.max(0, dealNumber(product.officialPrice));
    const platformPrice = Math.round(officialPrice * (1 - reach.platformRate / 100));
    const platformLabel = reach.bulkRate > reach.saleRate
      ? `${dealNumber(insight.bulkRule?.minCount, 3)}件${compactOff(reach.bulkRate)}`
      : reach.saleRate > 0 ? `当前平台${compactOff(reach.saleRate)}` : "当前平台价";
    const lines = [
      `原价 ${cartLocalizedMoney(officialPrice, cnyRate)}`,
      `${platformLabel}后 ${cartLocalizedMoney(platformPrice, cnyRate)}`,
    ];
    if (reach.bestCoupon) {
      const couponPrice = calculateHypotheticalPrice(product, reach);
      lines.push(`${compactCouponListLabel(reach.bestCoupon)}后 ${cartLocalizedMoney(couponPrice, cnyRate)}`);
    }
    lines.push(`${insight.partial ? "当前已知可到" : "本次可到"} ${cartLocalizedMoney(calculateHypotheticalPrice(product, reach), cnyRate)}｜${compactOff(reach.totalRate)}`);
    return lines;
  }

  function reachDialogDataSignature(insight, lowestPrice, mode = "price") {
    const snapshot = latestDealContext.cartSnapshot || {};
    const summarizeProducts = (products) => (Array.isArray(products) ? products : [])
      .map((product) => [
        String(product?.id || "").toUpperCase(),
        dealNumber(product?.price),
        dealNumber(product?.officialPrice),
        dealNumber(product?.cnyPrice),
        String(product?.bulkbuyKey || ""),
      ])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const couponSignature = (latestDealContext.coupons || [])
      .map((coupon) => JSON.stringify([
        String(coupon?.groupKey || coupon?.id || ""),
        coupon?.discountType,
        dealNumber(coupon?.discount),
        dealNumber(coupon?.minCount, 1),
        dealNumber(coupon?.minSpend),
        dealNumber(coupon?.maxDiscount),
        dealNumber(coupon?.instances),
        dealNumber(coupon?.usageCount),
        dealNumber(coupon?.earliestExpiry),
      ]))
      .sort();
    return JSON.stringify({
      mode,
      id: String(insight?.product?.id || "").toUpperCase(),
      product: summarizeProducts([insight?.product]),
      lowestPrice: Number.isFinite(lowestPrice) ? lowestPrice : null,
      reach: [
        dealNumber(insight?.bestReach?.saleRate),
        dealNumber(insight?.bestReach?.bulkRate),
        dealNumber(insight?.bestReach?.totalRate),
        String(insight?.bestReach?.bestCoupon?.groupKey ||
          insight?.bestReach?.bestCoupon?.id || ""),
      ],
      active: summarizeProducts(snapshot.active || snapshot.products),
      later: summarizeProducts(snapshot.later),
      coupons: couponSignature,
      partial: Boolean(insight?.partial || latestDealContext.partial || !snapshot.loaded),
    });
  }

  function appendReachDisclaimer(parent) {
    const disclaimer = document.createElement("details");
    disclaimer.className = "dltracker-reach-disclaimer";
    const summary = document.createElement("summary");
    summary.textContent = "价格与方案仅供参考，以 DLsite 实际结算为准｜查看计算说明";
    const notes = document.createElement("ul");
    [
      "本次可到可能依赖尚未满足的件数或金额门槛。",
      "新增凑单作品的价格不计入未完成方案的理论总价。",
      "每笔订单最多使用一张优惠券。",
      "当前平台折扣与多件活动二选一，优惠券可与其中一项叠加。",
      "人民币金额使用 DLsite 同一作品的 CNY/JPY 价格比例估算。",
    ].forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      notes.appendChild(item);
    });
    disclaimer.append(summary, notes);
    parent.appendChild(disclaimer);
  }

  async function renderReachDialog(insight, lowestPrice, mode = "price") {
    const overlay = document.querySelector(".dltracker-reach-overlay");
    const body = overlay?.querySelector(".dltracker-reach-dialog-body");
    if (!body || !insight) return;
    const signature = reachDialogDataSignature(insight, lowestPrice, mode);
    if (body.dataset.dltrackerReachSignature === signature ||
      body.dataset.dltrackerReachPending === signature) return;
    body.dataset.dltrackerReachPending = signature;
    const renderToken = ++openReachRenderToken;
    const renderRoot = document.createElement("div");
    try {
    const snapshot = latestDealContext.cartSnapshot;
    const partialData = Boolean(insight.partial || latestDealContext.partial || !snapshot.loaded);
    const active = snapshot.active || snapshot.products || [];
    const later = snapshot.later || [];
    const allForRate = [insight.product, ...active, ...later];
    const cnyRate = currencyRateFromProducts(allForRate);

    const work = document.createElement("section");
    work.className = "dltracker-reach-section";
    const workTitle = document.createElement("h3");
    workTitle.textContent = insight.product.title || insight.product.id || "当前作品";
    const formula = document.createElement("div");
    formula.className = "dltracker-reach-work-formula";
    for (const line of bestReachFormulaLines(insight, cnyRate)) {
      const step = document.createElement("div");
      step.className = "dltracker-reach-work-step";
      step.textContent = line;
      formula.appendChild(step);
    }
    work.append(workTitle, formula);
    if (partialData) {
      const partial = document.createElement("div");
      partial.className = "dltracker-reach-warning";
      partial.textContent = "部分优惠未确认，以下仅为当前已知最低。";
      work.appendChild(partial);
    }
    const currentPrice = dealNumber(insight.product.price);
    const targetPrice = calculateHypotheticalPrice(insight.product, insight.bestReach);
    appendReachRow(
      work,
      "比平台当前折扣价节省",
      cartLocalizedMoney(Math.max(0, currentPrice - targetPrice), cnyRate),
    );
    if (Number.isFinite(lowestPrice)) {
      const historyDifference = Math.round(targetPrice - lowestPrice);
      const historyComparison = historyDifference < 0
        ? `比史低便宜 ${cartLocalizedMoney(-historyDifference, cnyRate)}`
        : historyDifference > 0
          ? `比史低贵 ${cartLocalizedMoney(historyDifference, cnyRate)}`
          : "与史低相同";
      appendReachRow(work, "史低对比", historyComparison);
    }
    if (mode === "price") {
      renderRoot.appendChild(work);
      appendReachDisclaimer(renderRoot);
      if (renderToken !== openReachRenderToken || !body.isConnected) return;
      body.replaceChildren(...renderRoot.childNodes);
      body.dataset.dltrackerReachSignature = signature;
      return;
    }

    const status = cartDealStatus(insight);
    const cart = document.createElement("section");
    cart.className = "dltracker-reach-section";
    const cartTitle = document.createElement("h3");
    cartTitle.textContent = cartDealStatusLabel(status);
    cart.appendChild(cartTitle);
    if (status === "single") {
      appendReachRow(cart, "状态", "当前作品无需凑金额或件数");
      const reach = insight.bestReach;
      const platformLabel = reach.saleRate > 0
        ? `当前平台${compactOff(reach.saleRate)}`
        : "当前平台无折扣";
      appendReachRow(cart, "平台优惠", platformLabel);
      appendReachRow(
        cart,
        "优惠券",
        reach.bestCoupon ? compactCouponListLabel(reach.bestCoupon) : "无需优惠券",
      );
      appendReachRow(
        cart,
        "单买结算价＝理论最优价",
        cartLocalizedMoney(targetPrice, cnyRate),
        "is-current-best",
      );
      renderRoot.appendChild(cart);
      appendReachDisclaimer(renderRoot);
      if (renderToken !== openReachRenderToken || !body.isConnected) return;
      body.replaceChildren(...renderRoot.childNodes);
      body.dataset.dltrackerReachSignature = signature;
      return;
    }
    if (snapshot.updatedAt) {
      const updated = document.createElement("div");
      updated.className = "dltracker-reach-muted";
      updated.textContent = `购物车数据更新于 ${new Date(snapshot.updatedAt).toLocaleString("zh-CN")}${isCartPage(location.href) ? "" : "，离开购物车后可能已变化"}`;
      cart.appendChild(updated);
    }
    const calculation = await calculateCartPlans(active, latestDealContext.coupons);
    if (renderToken !== openReachRenderToken || !body.isConnected) return;
    if (!snapshot.loaded) {
      appendReachRow(cart, "状态", "购物车数据未读取，暂无法计算");
    } else if (calculation.empty) {
      appendReachRow(cart, "状态", "立即购买中没有作品");
    } else {
      appendReachRow(cart, "当前平台价合计", cartLocalizedMoney(calculation.platformTotal, cnyRate));
      appendReachRow(cart, partialData ? "当前已知可结算最低" : "当前可结算最低", cartLocalizedMoney(calculation.currentBestTotal, cnyRate), "is-current-best");
      appendReachRow(cart, partialData ? "当前已知理论最低" : "理论最低", cartLocalizedMoney(calculation.theoreticalTotal, cnyRate));
      appendReachRow(cart, "距离理论最低", cartLocalizedMoney(Math.max(0, calculation.currentBestTotal - calculation.theoreticalTotal), cnyRate));
      const shortfalls = unmetBundleOffers(
        active,
        latestDealContext.coupons,
        calculation.rules,
      ).filter((offer) => offer.type === "activity"
        ? Boolean(insight.product.bulkbuyKey) && insight.product.bulkbuyKey === offer.key
        : couponMatchesDealProduct(offer.coupon, insight.product))
        .map((offer) => offer.type === "activity"
          ? `${offer.rule.minCount}件${compactOff(offer.rule.discountRate)}·还差${offer.missing}件`
          : `${compactOff(couponEquivalentRate(offer.coupon, insight.product), "券")}·${cartCouponConditionText({
              ...offer.coupon,
              countShortfall: offer.type === "count" ? offer.missing : 0,
              spendShortfall: offer.type === "spend" ? offer.missingSpend : 0,
            })}`);
      if (shortfalls.length) {
        appendReachRow(cart, "还差条件", shortfalls.slice(0, 3).join("｜"));
      } else if (status === "met") {
        const satisfied = [];
        if (insight.bestReach.bulkRate > insight.bestReach.saleRate + 0.001 &&
          insight.bulkRule) {
          satisfied.push(`${insight.bulkRule.minCount}件${compactOff(insight.bulkRule.discountRate)}`);
        }
        if (insight.bestReach.bestCoupon) {
          satisfied.push(cartCouponConditionText(insight.bestReach.bestCoupon));
        }
        appendReachRow(cart, "已满足门槛", satisfied.join("｜") || "当前最优条件已满足");
      }
      if (!calculation.exact) {
        const warning = document.createElement("div");
        warning.className = "dltracker-reach-warning";
        warning.textContent = "组合规模过大，当前价格为近似结果";
        cart.appendChild(warning);
      }
      if (calculation.theoreticalTotal < calculation.currentBestTotal) {
        const note = document.createElement("div");
        note.className = "dltracker-reach-warning";
        note.textContent = "理论总价未计入尚未加入的凑单作品价格";
        cart.appendChild(note);
      }
      if (later.length && (status === "needs" ||
        calculation.theoreticalTotal < calculation.currentBestTotal)) {
        const recommendations = await buildBundleRecommendations(
          active,
          later,
          latestDealContext.coupons,
          calculation.rules,
          insight.product,
        );
        if (renderToken !== openReachRenderToken || !body.isConnected) return;
        if (recommendations.length) {
          const recommendationTitle = document.createElement("h4");
          recommendationTitle.textContent = "从稍后再买中推荐拼单";
          cart.appendChild(recommendationTitle);
          const renderRecommendation = (recommendation, index, parent) => {
            const details = document.createElement("details");
            details.className = "dltracker-reach-recommendation";
            details.open = index === 0;
            const summary = document.createElement("summary");
            const offer = recommendation.offer;
            const offerLabels = [];
            if (offer.coupon) {
              offerLabels.push(`本单适用优惠券：${compactCouponListLabel({
                ...offer.coupon,
                equivalentRate: couponEquivalentRate(
                  offer.coupon,
                  insight.product,
                ),
              })}`);
            }
            if (offer.needsActivity) {
              offerLabels.push(`本单适用平台活动：${dealNumber(offer.activityRule?.minCount, 3)}件${compactOff(offer.activityRule?.discountRate)}`);
            }
            const offerSummary = offerLabels.length
              ? `${offerLabels.join("＋")}｜`
              : "";
            summary.textContent = `${offerSummary}${recommendation.kind === "spend" ? "满额拼单方案" : `候选 ${recommendation.candidates.length} 部`}`;
            details.appendChild(summary);
            if (recommendation.kind === "candidates") {
              appendRecommendationTable(details, recommendation, cnyRate, {
                collapseAfter: 10,
              });
            } else {
              const [best, ...alternatives] = recommendation.alternatives;
              appendRecommendationTable(details, best, cnyRate);
              if (alternatives.length) {
                const more = document.createElement("details");
                more.className = "dltracker-reach-alternatives";
                const moreSummary = document.createElement("summary");
                moreSummary.textContent = `查看其他方案（${alternatives.length}）`;
                more.appendChild(moreSummary);
                alternatives.forEach((alternative, alternativeIndex) => {
                  const heading = document.createElement("h5");
                  heading.textContent = `备选方案 ${alternativeIndex + 2}｜超出门槛 ${toYen(alternative.spendOverage)}`;
                  more.appendChild(heading);
                  appendRecommendationTable(more, alternative, cnyRate);
                });
                details.appendChild(more);
              }
            }
            parent.appendChild(details);
          };
          recommendations.forEach((recommendation, index) =>
            renderRecommendation(recommendation, index, cart));
        }
      }
    }
    renderRoot.appendChild(cart);
    appendReachDisclaimer(renderRoot);
    if (renderToken !== openReachRenderToken || !body.isConnected) return;
    body.replaceChildren(...renderRoot.childNodes);
    body.dataset.dltrackerReachSignature = signature;
    } finally {
      if (body.dataset.dltrackerReachPending === signature) {
        delete body.dataset.dltrackerReachPending;
      }
    }
  }

  function lockReachDialogScroll() {
    if (reachDialogScrollLock || !document.body) return;
    const body = document.body;
    const root = document.documentElement;
    const properties = ["position", "top", "left", "right", "width", "overflow"];
    reachDialogScrollLock = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      bodyStyles: Object.fromEntries(properties.map((property) =>
        [property, body.style[property]])),
      rootOverflow: root.style.overflow,
    };
    root.classList.add("dltracker-reach-open");
    body.classList.add("dltracker-reach-open");
    root.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-reachDialogScrollLock.scrollY}px`;
    body.style.left = `${-reachDialogScrollLock.scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }

  function unlockReachDialogScroll() {
    if (!reachDialogScrollLock || !document.body) return;
    const state = reachDialogScrollLock;
    reachDialogScrollLock = null;
    const body = document.body;
    const root = document.documentElement;
    root.classList.remove("dltracker-reach-open");
    body.classList.remove("dltracker-reach-open");
    for (const [property, value] of Object.entries(state.bodyStyles)) {
      body.style[property] = value;
    }
    root.style.overflow = state.rootOverflow;
    window.scrollTo(state.scrollX, state.scrollY);
  }

  function closeReachDialog() {
    openReachRenderToken += 1;
    document.querySelector(".dltracker-reach-overlay")?.remove();
    unlockReachDialogScroll();
    openReachProductId = "";
    openReachDialogMode = "price";
  }

  function openReachDialog(insight, lowestPrice, mode = "price") {
    closeReachDialog();
    openReachProductId = String(insight?.product?.id || "").toUpperCase();
    openReachDialogMode = mode === "status" ? "status" : "price";
    const overlay = document.createElement("div");
    overlay.className = "dltracker-reach-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeReachDialog();
    });
    const dialog = document.createElement("section");
    dialog.className = "dltracker-reach-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeReachDialog();
    });
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = openReachDialogMode === "status"
      ? cartDealStatusLabel(cartDealStatus(insight))
      : "本次可到计算";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", closeReachDialog);
    header.append(title, close);
    const body = document.createElement("div");
    body.className = "dltracker-reach-dialog-body";
    body.textContent = "正在计算…";
    dialog.append(header, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    lockReachDialogScroll();
    dialog.focus({ preventScroll: true });
    void renderReachDialog(insight, lowestPrice, openReachDialogMode).catch((error) => {
      console.warn(`[${APP_NAME}] reach dialog calculation failed:`, error);
      body.textContent = error instanceof Error ? error.message : String(error);
    });
  }

  function refreshOpenReachDialog() {
    if (!openReachProductId) return;
    const insight = dealInsightById.get(openReachProductId);
    if (!insight) return;
    const card = document.querySelector(
      `.${UI_CLASSNAME}[data-product-id="${openReachProductId}"]`,
    );
    const lowestPrice = Number(card?.dataset.lowestPrice);
    void renderReachDialog(
      insight,
      Number.isFinite(lowestPrice) ? lowestPrice : undefined,
      openReachDialogMode,
    );
  }

  function createSingleBuyBadge() {
    const badge = document.createElement("div");
    badge.className = "dltracker-single-buy-badge";
    badge.textContent = "单买即最优";
    return badge;
  }

  function createBrowseAnalysisFrame({
    tag = "div",
    className = "",
    label,
    value = "",
    valueClass = "",
    rate = null,
    href = "",
    onActivate = null,
  }) {
    const frame = document.createElement(href ? "a" : tag);
    frame.className = `dltracker-browse-analysis-frame ${className}`.trim();
    if (frame.tagName === "BUTTON") frame.type = "button";
    if (href) {
      frame.href = href;
      frame.target = "_blank";
      frame.rel = "noopener noreferrer";
    }
    const title = document.createElement("strong");
    title.textContent = label;
    frame.appendChild(title);
    if (value) {
      const price = document.createElement("span");
      price.className = `dltracker-browse-analysis-price ${valueClass}`.trim();
      price.textContent = value;
      frame.appendChild(price);
    }
    if (Number.isFinite(rate) && rate > 0) {
      const off = document.createElement("span");
      off.className = "dltracker-browse-analysis-off";
      off.textContent = compactOff(rate);
      frame.appendChild(off);
    }
    if (onActivate) {
      frame.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      });
    } else if (href) {
      frame.addEventListener("click", (event) => event.stopPropagation());
    }
    return frame;
  }

  function renderBrowseCardAnalysis(host, record, insight) {
    if (!host) return;
    const previousLayout = host.querySelector(":scope > .dltracker-browse-analysis");
    const existingReminders = previousLayout?.querySelector(
      ":scope > .dltracker-account-reminders",
    );
    const purchased = previousLayout?.classList.contains("is-account-purchased");
    const layout = document.createElement("section");
    layout.className = `${UI_CLASSNAME} dltracker-browse-analysis${
      shouldStackBrowseAnalysis() ? " is-stacked" : ""
    }${purchased ? " is-account-purchased" : ""}`;
    if (existingReminders) layout.appendChild(existingReminders);
    const id = String(record?.rjCode || insight?.product?.id || "").toUpperCase();
    if (id) layout.dataset.productId = id;
    if (Number.isFinite(record?.lowestPrice)) {
      layout.dataset.lowestPrice = String(record.lowestPrice);
    }
    const grid = document.createElement("div");
    grid.className = "dltracker-browse-analysis-grid";
    const reachPrice = insight
      ? calculateHypotheticalPrice(insight.product, insight.bestReach)
      : Number.POSITIVE_INFINITY;
    const lowestPrice = safeNumber(record?.lowestPrice);
    const comparable = Number.isFinite(reachPrice) &&
      Number.isFinite(lowestPrice);
    const cnyRate = currencyRateFromProducts([insight?.product]);
    grid.appendChild(createBrowseAnalysisFrame({
      tag: insight ? "button" : "div",
      className: comparable && reachPrice <= lowestPrice
        ? "dltracker-browse-analysis-best"
        : "",
      label: "本次可到",
      value: insight && Number.isFinite(reachPrice)
        ? cartLocalizedMoney(reachPrice, cnyRate)
        : "读取中",
      valueClass: insight && Number.isFinite(reachPrice)
        ? "dltracker-browse-analysis-amount"
        : "",
      rate: insight ? insight.bestReach.totalRate : null,
      onActivate: insight
        ? () => openReachDialog(insight, lowestPrice, "price")
        : null,
    }));
    const historyRegular = Math.max(
      dealNumber(record?.regularPrice),
      dealNumber(insight?.product?.officialPrice),
    );
    const historyRate = Number.isFinite(lowestPrice) && historyRegular > 0 &&
      lowestPrice < historyRegular
      ? (1 - lowestPrice / historyRegular) * 100
      : 0;
    grid.appendChild(createBrowseAnalysisFrame({
      className: comparable && lowestPrice <= reachPrice
        ? "dltracker-browse-analysis-best"
        : "",
      label: "史低",
      value: Number.isFinite(lowestPrice)
        ? cartLocalizedMoney(lowestPrice, cnyRate)
        : "暂无",
      valueClass: Number.isFinite(lowestPrice)
        ? "dltracker-browse-analysis-amount"
        : "",
      rate: historyRate,
    }));
    grid.appendChild(createBrowseAnalysisFrame({
      className: `dltracker-browse-analysis-trend${record?.dlwatcherUrl ? "" : " is-disabled"}`,
      label: "趋势",
      href: record?.dlwatcherUrl || "",
    }));
    layout.appendChild(grid);

    if (insight) {
      const couponLabels = insight.couponOptions
        .slice(0, 2)
        .map(compactCouponListLabel);
      const offerGroups = [];
      if (couponLabels.length) {
        const labels = [...couponLabels];
        if (insight.couponOptions.length > 2) {
          labels.push(`+${insight.couponOptions.length - 2}种`);
        }
        offerGroups.push({ label: "可用优惠券：", values: labels });
      }
      if (insight.bulkRule) {
        offerGroups.push({
          label: "平台活动：",
          values: [`${insight.bulkRule.minCount}件${compactOff(insight.bulkRule.discountRate)}`],
        });
      }
      if (offerGroups.length || insight.partial) {
        const offers = document.createElement("div");
        offers.className = "dltracker-browse-analysis-offers";
        for (const offerGroup of offerGroups) {
          const group = document.createElement("span");
          group.className = "dltracker-browse-analysis-offer-group";
          const title = document.createElement("strong");
          title.textContent = offerGroup.label;
          group.appendChild(title);
          offerGroup.values.forEach((value) => {
            const item = document.createElement("span");
            item.className = "dltracker-browse-analysis-offer-item";
            item.textContent = value;
            group.appendChild(item);
          });
          offers.appendChild(group);
        }
        if (insight.partial) {
          const partial = document.createElement("span");
          partial.className = "dltracker-browse-analysis-offer-group";
          partial.textContent = "部分优惠未确认";
          offers.appendChild(partial);
        }
        layout.appendChild(offers);
      }
    }
    host.replaceChildren(layout);
  }

  function accountIndexTimeText(value) {
    const time = dealNumber(value, 0);
    if (!time) return "尚未读取";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(time));
  }

  function accountIndexProgressText(index, reading) {
    const indexed = dealNumber(index?.indexed, 0);
    const total = dealNumber(index?.total, 0);
    if (reading && indexed < total) return `${indexed}/${total}（读取中）`;
    if (index?.complete) return `${indexed}/${total}`;
    const failed = Array.isArray(index?.failedIds) ? index.failedIds.length : 0;
    if (failed) return `${indexed}/${total}（${failed}项未取得）`;
    const processed = Object.keys(index?.entries || {}).length;
    const remaining = Math.max(0, total - processed);
    const reason = dealPlainText(index?.pausedReason);
    return `${indexed}/${total}${remaining
      ? `（已暂停${reason ? `：${reason}` : ""}；剩余${remaining}项）`
      : "（未完成）"}`;
  }

  function renderAccountInformationPanel(panel) {
    if (!panel) return;
    const index = loadAccountIndex();
    const reading = Boolean(accountIndexRefreshInFlight);
    panel.className = "dltracker-account-info-panel";
    const summary = document.createElement("div");
    summary.className = "dltracker-account-info-summary";
    const loadedValues = [
      ["立即购买", index.active.length],
      ["稍后再买", index.later.length],
      ["已购买", index.bought.length],
      ["语言索引", accountIndexProgressText(index, reading)],
      ["上次读取", accountIndexTimeText(index.updatedAt)],
    ];
    let values;
    if (!isDlsiteMemberLoggedIn()) {
      values = [["状态", "未登录"]];
    } else if (reading) {
      values = [
        ["状态", index.loaded ? "正在重新读取…" : "正在读取购物车和已购清单…"],
        ...(index.loaded ? loadedValues : []),
      ];
    } else if (accountIndexRuntimeError || index.pausedReason) {
      values = [
        ["状态", index.pausedReason
          ? `读取暂停：${index.pausedReason}`
          : `读取失败：${accountIndexRuntimeError}`],
        ...(index.loaded ? loadedValues : []),
      ];
    } else {
      values = index.loaded ? loadedValues : [["状态", "尚未读取"]];
    }
    for (const [label, value] of values) {
      const row = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = `${label}：`;
      row.append(strong, document.createTextNode(String(value)));
      summary.appendChild(row);
    }
    const action = document.createElement("button");
    action.type = "button";
    action.className = "dltracker-account-refresh";
    action.textContent = reading
      ? `读取中 ${index.indexed}/${index.total || "?"}`
      : "读取购物车和已购清单（请勿频繁读取）";
    const cooldown = Date.now() - dealNumber(index.lastManualAt) < ACCOUNT_REFRESH_COOLDOWN_MS;
    action.disabled = reading || cooldown || !isDlsiteMemberLoggedIn();
    if (cooldown && !reading) {
      const remaining = ACCOUNT_REFRESH_COOLDOWN_MS -
        (Date.now() - dealNumber(index.lastManualAt));
      setTimeout(() => {
        if (panel.isConnected) renderAccountInformationPanel(panel);
      }, Math.max(100, remaining + 50));
    }
    action.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.disabled = true;
      action.textContent = "正在读取…";
      try {
        await refreshAccountIndex({ manual: true });
        await refreshAllAccountReminders();
        await refreshOpenLanguageDialog();
      } catch (error) {
        showDealToast(error instanceof Error ? error.message : String(error), true, 6000);
      } finally {
        refreshAccountInformationPanels();
      }
    });
    panel.replaceChildren(summary, action);
  }

  function refreshAccountInformationPanels() {
    document.querySelectorAll(".dltracker-account-info-panel")
      .forEach(renderAccountInformationPanel);
  }

  function closeAccountInformationDialog() {
    document.querySelector(".dltracker-account-overlay")?.remove();
    unlockReachDialogScroll();
  }

  function openAccountInformationDialog() {
    closeLanguageDialog();
    closeReachDialog();
    const overlay = document.createElement("div");
    overlay.className = "dltracker-reach-overlay dltracker-account-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeAccountInformationDialog();
    });
    const dialog = document.createElement("section");
    dialog.className = "dltracker-reach-dialog dltracker-account-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAccountInformationDialog();
    });
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "账号信息";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", closeAccountInformationDialog);
    header.append(title, close);
    const body = document.createElement("div");
    body.className = "dltracker-reach-dialog-body";
    const panel = document.createElement("section");
    renderAccountInformationPanel(panel);
    body.appendChild(panel);
    dialog.append(header, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    lockReachDialogScroll();
    dialog.focus({ preventScroll: true });
  }

  function groupedAccountEntries(entries, ids) {
    const idSet = new Set((ids || []).map((id) => String(id).toUpperCase()));
    const groups = new Map();
    for (const entry of entries) {
      if (!idSet.has(String(entry?.id || "").toUpperCase())) continue;
      const key = normalizedLanguageCode(entry.lang);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return groups;
  }

  function compressedLanguageNames(groups, currentLang = "") {
    const names = [...groups.keys()]
      .filter((lang) => lang !== currentLang)
      .map((lang) => `${languageDisplayName(lang)}版`);
    const visible = names.slice(0, 2);
    if (names.length > 2) visible.push(`+${names.length - 2}个版本`);
    return visible.join("、");
  }

  function metadataProductFromCache(id) {
    const entry = loadDealCache().metadata[String(id || "").toUpperCase()];
    return entry?.raw
      ? normalizedMetadataProduct(String(id).toUpperCase(), entry.raw)
      : null;
  }

  async function theoreticalPriceForAccountEntry(entry) {
    const id = String(entry?.parentId || entry?.id || "").toUpperCase();
    let insight = dealInsightById.get(id);
    if (!insight) {
      const metadata = await ensureProductMetadataBatches([id]);
      const product = metadata.get(id);
      if (!product) return null;
      insight = await buildInsight(
        product,
        latestDealContext.coupons,
        latestDealContext.cartSnapshot.active || [],
      );
    }
    const price = calculateHypotheticalPrice(insight.product, insight.bestReach);
    return Number.isFinite(price) ? { price, insight } : null;
  }

  async function accountReminderData(productId) {
    const id = String(productId || "").toUpperCase();
    const index = loadAccountIndex();
    if (!index.loaded) return null;
    let product = metadataProductFromCache(id);
    if (!product) product = (await ensureProductMetadataBatches([id])).get(id);
    if (!product) return null;
    const identity = productLanguageIdentity(product, id);
    const familyEntries = accountEntriesForFamily(identity.familyId, index);
    const exactIndexed = index.entries[id];
    const exactKnown = index.active.includes(id) || index.later.includes(id) ||
      index.bought.includes(id);
    if (exactKnown && !familyEntries.some((entry) => entry.id === id)) {
      familyEntries.push({
        ...(exactIndexed || {}),
        id,
        parentId: identity.parentId,
        familyId: identity.familyId,
        lang: identity.lang,
        language: languageDisplayName(identity.lang),
      });
    }
    if (!familyEntries.length) return null;
    const boughtGroups = groupedAccountEntries(familyEntries, index.bought);
    const activeGroups = groupedAccountEntries(familyEntries, index.active);
    const laterGroups = groupedAccountEntries(familyEntries, index.later);
    const carted = activeGroups.size > 0 || laterGroups.size > 0;
    const lines = [];
    let purchased = false;
    if (boughtGroups.has(identity.lang)) {
      lines.push("已购买");
      purchased = true;
    } else {
      const otherBought = compressedLanguageNames(boughtGroups, identity.lang);
      if (otherBought) {
        lines.push(`已购买${otherBought}`);
        purchased = true;
      }
    }
    if (activeGroups.has(identity.lang)) {
      lines.push("已在购物车");
    } else if (laterGroups.has(identity.lang)) {
      lines.push("已在稍后再买");
    } else {
      const otherCartEntries = [];
      for (const [lang, values] of activeGroups) {
        if (lang !== identity.lang) otherCartEntries.push({ lang, entry: values[0], area: "购物车" });
      }
      for (const [lang, values] of laterGroups) {
        if (lang !== identity.lang && !otherCartEntries.some((item) => item.lang === lang)) {
          otherCartEntries.push({ lang, entry: values[0], area: "稍后再买" });
        }
      }
      if (otherCartEntries.length) {
        const currentPrice = await theoreticalPriceForAccountEntry({
          id,
          parentId: identity.parentId,
        });
        const parts = [];
        for (const item of otherCartEntries.slice(0, 2)) {
          const otherPrice = await theoreticalPriceForAccountEntry(item.entry);
          let compare = "";
          if (currentPrice && otherPrice) {
            if (otherPrice.price < currentPrice.price) compare = "，比当前便宜";
            else if (otherPrice.price > currentPrice.price) compare = "，当前更便宜";
            else compare = "，与当前同价";
          }
          parts.push(`${languageDisplayName(item.lang)}版在${item.area}${compare}`);
        }
        if (otherCartEntries.length > 2) parts.push(`+${otherCartEntries.length - 2}个版本`);
        lines.push(parts.join("｜"));
      }
    }
    return lines.length ? { lines, purchased, carted, identity } : null;
  }

  async function renderAccountReminderForCard(node, id) {
    const host = node?.querySelector?.(".dltracker-browse-analysis-host");
    const layout = host?.querySelector?.(".dltracker-browse-analysis");
    if (!layout) return;
    const renderToken = (accountReminderRenderTokens.get(layout) || 0) + 1;
    accountReminderRenderTokens.set(layout, renderToken);
    const data = await accountReminderData(id);
    if (!layout.isConnected || accountReminderRenderTokens.get(layout) !== renderToken) return;
    const existing = layout.querySelector(".dltracker-account-reminders");
    if (!data) {
      existing?.remove();
      layout.classList.remove("is-account-purchased");
      node.classList.remove("dltracker-browse-purchased-card");
      node.classList.remove("dltracker-browse-carted-card");
      syncBrowseCardVisibility(node);
      return;
    }
    node.classList.toggle("dltracker-browse-purchased-card", Boolean(data.purchased));
    node.classList.toggle("dltracker-browse-carted-card", Boolean(data.carted));
    syncBrowseCardVisibility(node);
    const signature = JSON.stringify({
      lines: data.lines,
      purchased: data.purchased,
      carted: data.carted,
    });
    if (existing?.dataset.reminderSignature === signature &&
      layout.classList.contains("is-account-purchased") === Boolean(data.purchased)) {
      return;
    }
    const reminders = document.createElement("div");
    reminders.className = "dltracker-account-reminders";
    reminders.dataset.reminderSignature = signature;
    for (const line of data.lines) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dltracker-account-reminder";
      button.textContent = line;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openLanguageComparison(id, button);
      });
      reminders.appendChild(button);
    }
    layout.classList.toggle("is-account-purchased", Boolean(data.purchased));
    if (existing) existing.replaceWith(reminders);
    else layout.prepend(reminders);
  }

  async function refreshAllAccountReminders() {
    const cards = collectBrowseCards().filter(({ cartItem }) => !cartItem);
    await mapWithConcurrency(cards, 1, ({ node, id }) =>
      renderAccountReminderForCard(node, id));
  }

  function languageDetailUrl(parentId, childId = "") {
    const url = new URL(
      `/${currentDlsiteSection()}/work/=/product_id/${String(parentId).toUpperCase()}.html`,
      location.origin,
    );
    if (childId && String(childId).toUpperCase() !== String(parentId).toUpperCase()) {
      url.searchParams.set("translation", String(childId).toUpperCase());
    }
    return url.href;
  }

  function currentTranslationSelection() {
    return String(new URL(location.href).searchParams.get("translation") || "").toUpperCase();
  }

  function cartStateIdSets() {
    const index = loadAccountIndex();
    const snapshot = latestDealContext.cartSnapshot || loadCartSnapshot();
    return {
      active: new Set([
        ...index.active,
        ...(snapshot.active || snapshot.products || []).map((item) => item.id),
      ].map((id) => String(id).toUpperCase())),
      later: new Set([
        ...index.later,
        ...(snapshot.later || []).map((item) => item.id),
      ].map((id) => String(id).toUpperCase())),
      bought: new Set(index.bought.map((id) => String(id).toUpperCase())),
    };
  }

  function firstMatchingId(ids, set) {
    return ids.find((id) => set.has(String(id).toUpperCase())) || "";
  }

  async function buildLanguageComparisonRows(state, onlyParents = null) {
    const sourceMetadata = await ensureProductMetadataBatches([state.sourceId]);
    const sourceProduct = sourceMetadata.get(state.sourceId) || { id: state.sourceId };
    const sourceIdentity = productLanguageIdentity(sourceProduct, state.sourceId);
    state.currentParentId = sourceIdentity.parentId;
    const editions = state.family.editions;
    const parentIds = onlyParents || editions.map((edition) => edition.parentId);
    const parentMetadata = await ensureProductMetadataBatches(parentIds);
    const childIds = [];
    for (const edition of editions) {
      const info = parentMetadata.get(edition.parentId)?.translationInfo || {};
      childIds.push(...dealTokens(info.child_worknos)
        .map((id) => String(id).toUpperCase())
        .filter(isValidProductCode));
    }
    const childMetadata = await ensureProductMetadataBatches(childIds);
    const cartSets = cartStateIdSets();
    const querySelection = currentTranslationSelection();
    const rows = [];
    for (const edition of editions) {
      if (onlyParents && !onlyParents.includes(edition.parentId)) continue;
      try {
        const product = parentMetadata.get(edition.parentId);
        if (!product) throw new Error("作品信息读取失败");
        const info = product.translationInfo || {};
        const editionChildIds = dealTokens(info.child_worknos)
          .map((id) => String(id).toUpperCase())
          .filter(isValidProductCode);
        if (editionChildIds.some((id) => !childMetadata.has(id))) {
          throw new Error("译者信息读取失败");
        }
        const children = editionChildIds.map((id) => childMetadata.get(id));
        const purchasableChildren = children.filter((child) => child.onSale);
        const purchasableIds = purchasableChildren.length
          ? purchasableChildren.map((child) => child.id)
          : product.onSale ? [edition.parentId] : [];
        const allIds = [...new Set([edition.parentId, ...children.map((child) => child.id)])];
        const statusId = firstMatchingId(allIds, cartSets.active) ||
          firstMatchingId(allIds, cartSets.later) ||
          firstMatchingId(allIds, cartSets.bought);
        const chosen = state.selectedByParent[edition.parentId] ||
          (allIds.includes(querySelection) ? querySelection : "") ||
          (purchasableIds.includes(statusId) ? statusId : "") ||
          (purchasableIds.length === 1 ? purchasableIds[0] : "");
        if (chosen) state.selectedByParent[edition.parentId] = chosen;
        const insight = await buildInsight(
          product,
          latestDealContext.coupons,
          latestDealContext.cartSnapshot.active || [],
          false,
        );
        const theoreticalPrice = calculateHypotheticalPrice(product, insight.bestReach);
        const record = /^[RB]J/i.test(edition.parentId)
          ? await buildOrUpdateRecord({
              rjCode: edition.parentId,
              title: product.title || edition.parentId,
              currentPrice: product.price || undefined,
              forceFetch: false,
            })
          : null;
        const activeId = firstMatchingId(allIds, cartSets.active);
        const laterId = firstMatchingId(allIds, cartSets.later);
        const boughtId = firstMatchingId(allIds, cartSets.bought);
        rows.push({
          ...edition,
          product,
          children,
          purchasableIds,
          allIds,
          selectedId: chosen,
          selectedProduct: children.find((child) => child.id === chosen) ||
            (chosen === edition.parentId ? product : null),
          activeId,
          laterId,
          boughtId,
          purchased: Boolean(boughtId),
          stopped: purchasableIds.length === 0,
          insight,
          theoreticalPrice,
          record: record || { rjCode: edition.parentId },
          current: edition.parentId === sourceIdentity.parentId,
          error: "",
        });
      } catch (error) {
        rows.push({
          ...edition,
          current: edition.parentId === sourceIdentity.parentId,
          stopped: true,
          error: error instanceof Error ? error.message : String(error),
          theoreticalPrice: Number.POSITIVE_INFINITY,
        });
      }
    }
    return rows;
  }

  function sortLanguageComparisonRows(rows) {
    return [...rows].sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      const aPrice = Number.isFinite(a.theoreticalPrice)
        ? a.theoreticalPrice
        : Number.POSITIVE_INFINITY;
      const bPrice = Number.isFinite(b.theoreticalPrice)
        ? b.theoreticalPrice
        : Number.POSITIVE_INFINITY;
      return aPrice - bPrice || a.displayOrder - b.displayOrder;
    });
  }

  function languageWinnerRows(rows) {
    const eligible = rows.filter((row) => !row.error && !row.stopped &&
      Number.isFinite(row.theoreticalPrice));
    if (!eligible.length) return [];
    const best = Math.min(...eligible.map((row) => row.theoreticalPrice));
    return eligible.filter((row) => row.theoreticalPrice === best);
  }

  function languageComparisonConclusion(rows, cnyRate) {
    const winners = languageWinnerRows(rows);
    const current = rows.find((row) => row.current && !row.error);
    const failed = rows.filter((row) => row.error).length;
    if (!winners.length || !current || !Number.isFinite(current.theoreticalPrice)) {
      return `比较数据不足${failed ? `，${failed} 个语言读取失败` : ""}`;
    }
    const suffix = failed ? `｜另有 ${failed} 个语言读取失败` : "";
    if (winners.some((row) => row.current)) {
      if (winners.length > 1) {
        return `${winners.map((row) => row.language).join("、")}理论最低价并列${suffix}`;
      }
      return `当前${current.language}版本理论最低价最优惠${suffix}`;
    }
    const winner = winners[0];
    const difference = Math.max(0, current.theoreticalPrice - winner.theoreticalPrice);
    return `${winner.language}版本更优惠，比当前便宜${cartLocalizedMoney(difference, cnyRate)}${suffix}`;
  }

  function languageRowStatusText(row) {
    const states = [];
    if (row.purchased) states.push("已购买");
    if (row.activeId) states.push("已在购物车");
    else if (row.laterId) states.push("已在稍后再买");
    else if (row.stopped) states.push("停售");
    else states.push("可购买");
    if (row.children?.length > 1) {
      const selected = row.selectedProduct;
      states.push(`当前选择：${selected
        ? `${selected.makerName || "译者"}（${selected.id}）`
        : "未选择"}`);
    }
    return `状态：${states.join("｜")}`;
  }

  async function postOfficialCartAdd(productId) {
    const response = await fetch(`/${currentDlsiteSection()}/cart/ajax`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        mode: "cart",
        obj_nocheck: "1",
        product_id: String(productId).toUpperCase(),
      }),
    });
    const text = await response.text();
    if (response.status === 403 || response.status === 429) {
      stopDealRequests(`购物车操作 HTTP ${response.status}`);
      throw new Error(`购物车操作返回 HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`购物车操作返回 HTTP ${response.status}`);
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const result = xml.querySelector("result_code")?.textContent || "-1";
    const message = dealPlainText(xml.querySelector("res_msg")?.textContent);
    if (result === "-1") throw new Error(message || "DLsite 未能加入购物车");
    return true;
  }

  function mutateAccountCartId(id, nextArea) {
    const index = loadAccountIndex();
    if (!index.loaded) return;
    const target = String(id || "").toUpperCase();
    const active = index.active.filter((value) => String(value).toUpperCase() !== target);
    const later = index.later.filter((value) => String(value).toUpperCase() !== target);
    if (nextArea === "active") active.push(target);
    if (nextArea === "later") later.push(target);
    const product = metadataProductFromCache(target);
    const entries = { ...index.entries };
    if (nextArea && product) entries[target] = accountEntryFromProduct(target, product);
    saveAccountIndex({
      ...index,
      active: [...new Set(active)],
      later: [...new Set(later)],
      entries,
      updatedAt: Date.now(),
    });
  }

  function concreteCartProductId(item) {
    if (!item) return "";
    const nativeAction = item.querySelector(
      "a.link_delete, button.link_delete, a.link_move_cart, button.link_move_cart, " +
      "a.link_move_later, button.link_move_later",
    );
    const detailLink = [...item.querySelectorAll('a[href*="product_id/"]')]
      .find((node) => !node.closest("[class^='dltracker-'], [class*=' dltracker-']"));
    return cartSkuFromSignals({
      actionProductId: nativeAction?.getAttribute("data-product-id"),
      actionWorkno: nativeAction?.getAttribute("data-workno"),
      actionHref: nativeAction?.getAttribute("href"),
      detailHref: detailLink?.getAttribute("href"),
      dataProductId: item.getAttribute("data-product-id"),
      dataWorkno: item.getAttribute("data-workno"),
    });
  }

  function nativeCartItemForProduct(id) {
    const target = String(id || "").toUpperCase();
    return getCartItems().find((item) => concreteCartProductId(item) === target) || null;
  }

  async function waitForNativeCartAction(productId, action) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const item = nativeCartItemForProduct(productId);
      if (action === "remove") {
        if (!item || isHiddenOrRemovedCartItem(item)) return;
      } else if (item && !isHiddenOrRemovedCartItem(item) && isBuyNowCartItem(item)) {
        return;
      }
      await sleep(200);
    }
    throw new Error("DLsite 购物车操作未完成，请稍后手动重试");
  }

  async function triggerNativeCartAction(productId, action) {
    const item = nativeCartItemForProduct(productId);
    const selector = action === "remove" ? "a.link_delete" : "a.link_move_cart";
    const nativeAction = item?.querySelector?.(selector);
    if (!nativeAction) {
      location.href = `/${currentDlsiteSection()}/cart`;
      return false;
    }
    nativeAction.click();
    await waitForNativeCartAction(productId, action);
    const snapshot = saveCartSnapshot(cartSnapshotFromRoot(document));
    latestDealContext = {
      ...latestDealContext,
      cartSnapshot: snapshot,
    };
    updateAccountIndexCart(
      snapshot.active.map((item) => item.id),
      snapshot.later.map((item) => item.id),
    );
    return snapshot;
  }

  async function performLanguageCartAction(row, button) {
    const selectedId = row.activeId || row.laterId || row.selectedId || row.purchasableIds?.[0];
    if (!selectedId) throw new Error("请先选择译者");
    button.disabled = true;
    try {
      if (row.activeId) {
        const confirmed = window.confirm([
          `确认从购物车永久移出【${row.language}】版本吗？`,
          `语言母作品：${row.parentId}`,
          `实际商品：${row.activeId}`,
        ].join("\n"));
        if (!confirmed) return;
        await triggerNativeCartAction(row.activeId, "remove");
      } else if (row.laterId) {
        await triggerNativeCartAction(row.laterId, "move");
      } else {
        await postOfficialCartAdd(selectedId);
        mutateAccountCartId(selectedId, "active");
        if (isCartPage(location.href)) {
          saveLanguageDialogRestoreState(openLanguageDialogState);
          location.reload();
          return;
        }
        const snapshot = await refreshCartSnapshotAfterAdd();
        if (snapshot?.loaded) {
          latestDealContext = {
            ...latestDealContext,
            cartSnapshot: snapshot,
          };
          updateAccountIndexCart(
            (snapshot.active || []).map((item) => item.id),
            (snapshot.later || []).map((item) => item.id),
          );
        }
      }
      await refreshOpenLanguageDialog();
      await refreshAllAccountReminders();
    } catch (error) {
      showDealToast(error instanceof Error ? error.message : String(error), true, 7000);
      throw error;
    } finally {
      if (button.isConnected) button.disabled = false;
      refreshAccountInformationPanels();
    }
  }

  function appendLanguageDiscountCell(row, parent) {
    const rates = [
      dealNumber(row.insight?.bestReach?.totalRate),
      dealNumber(row.insight?.bestReach?.saleRate),
      Number.isFinite(row.record?.lowestPrice) && dealNumber(row.record?.regularPrice) > 0
        ? (1 - row.record.lowestPrice /
          Math.max(dealNumber(row.record.regularPrice), dealNumber(row.product?.officialPrice))) * 100
        : null,
    ];
    const max = Math.max(...rates.filter(Number.isFinite));
    rates.forEach((rate, index) => {
      if (index) parent.appendChild(document.createTextNode("/"));
      const span = document.createElement("span");
      span.textContent = Number.isFinite(rate)
        ? rate > 0 ? compactOff(rate) : "无折扣"
        : index === 2 ? "暂无" : "—";
      if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - max) < 0.01) {
        span.className = "dltracker-language-best-rate";
      }
      parent.appendChild(span);
    });
  }

  function languageActionCell(row, state) {
    const cell = document.createElement("td");
    if (row.error || row.stopped && !row.activeId) {
      const disabled = document.createElement("button");
      disabled.type = "button";
      disabled.disabled = true;
      disabled.textContent = row.error ? "读取失败" : "停售";
      cell.appendChild(disabled);
      return cell;
    }
    if (row.purchased && !row.activeId) {
      const disabled = document.createElement("button");
      disabled.type = "button";
      disabled.disabled = true;
      disabled.textContent = "已购买";
      cell.appendChild(disabled);
      return cell;
    }
    if (!row.activeId && !row.laterId && row.purchasableIds.length > 1 && !row.selectedId) {
      const choose = document.createElement("button");
      choose.type = "button";
      choose.textContent = "选择译者";
      choose.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const select = document.createElement("select");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "请选择译者";
        select.appendChild(placeholder);
        row.purchasableIds.forEach((id) => {
          const product = row.children.find((child) => child.id === id);
          const option = document.createElement("option");
          option.value = id;
          option.textContent = `${product?.makerName || "译者"}（${id}）`;
          select.appendChild(option);
        });
        select.addEventListener("change", () => {
          if (!select.value) return;
          state.selectedByParent[row.parentId] = select.value;
          void refreshOpenLanguageDialog();
        });
        cell.replaceChildren(select);
        select.focus();
      });
      cell.appendChild(choose);
      return cell;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = row.activeId ? "移出购物车" : "加购物车";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void performLanguageCartAction(row, button).catch(() => {});
    });
    cell.appendChild(button);
    return cell;
  }

  async function renderLanguageComparisonDialog() {
    const state = openLanguageDialogState;
    const body = document.querySelector(".dltracker-language-dialog-body");
    if (!state || !body) return;
    const token = ++state.renderToken;
    const initialRender = !state.rows.length || !body.firstElementChild;
    if (initialRender) body.textContent = "正在读取语言版本与理论最低价…";
    body.setAttribute("aria-busy", "true");
    const retryParents = Array.isArray(state.retryParents) && state.retryParents.length
      ? [...state.retryParents]
      : null;
    state.retryParents = null;
    const refreshedRows = await buildLanguageComparisonRows(state, retryParents);
    const mergedRows = retryParents && state.rows.length
      ? state.rows.map((row) =>
          refreshedRows.find((candidate) => candidate.parentId === row.parentId) || row)
      : refreshedRows;
    const rows = sortLanguageComparisonRows(mergedRows);
    if (!openLanguageDialogState || token !== state.renderToken || !body.isConnected) return;
    state.rows = rows;
    const cnyRate = currencyRateFromProducts(rows.map((row) => row.product));
    const winners = new Set(languageWinnerRows(rows).map((row) => row.parentId));
    const root = document.createDocumentFragment();
    const conclusion = document.createElement("p");
    conclusion.className = "dltracker-language-conclusion";
    conclusion.textContent = languageComparisonConclusion(rows, cnyRate);
    root.appendChild(conclusion);
    const wrap = document.createElement("div");
    wrap.className = "dltracker-language-table-wrap";
    const table = document.createElement("table");
    table.className = "dltracker-language-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["语言", "作品", "人民币/日元", "现在/平台/史低", "备注", "看详情", "购物车"]
      .forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });
    head.appendChild(headRow);
    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      if (winners.has(row.parentId)) tr.classList.add("is-best");
      if (row.purchased || row.stopped || row.error) tr.classList.add("is-muted");
      const language = document.createElement("td");
      language.textContent = row.language;
      if (row.current) {
        const badge = document.createElement("small");
        badge.textContent = "当前";
        language.appendChild(badge);
      }
      if (winners.has(row.parentId)) {
        const badge = document.createElement("small");
        badge.textContent = "最优惠";
        language.appendChild(badge);
      }
      const work = document.createElement("td");
      work.textContent = row.parentId;
      const price = document.createElement("td");
      const priceButton = document.createElement("button");
      priceButton.type = "button";
      priceButton.className = "dltracker-language-price-button";
      priceButton.textContent = row.error
        ? "读取失败"
        : cartFrameLocalizedMoney(row.theoreticalPrice, cnyRate);
      priceButton.disabled = Boolean(row.error);
      if (!row.error) priceButton.addEventListener("click", () => {
        closeLanguageDialog();
        openReachDialog(row.insight, row.record?.lowestPrice, "price");
      });
      price.appendChild(priceButton);
      const discounts = document.createElement("td");
      if (row.error) discounts.textContent = "—/—/—";
      else {
        const discountButton = document.createElement("button");
        discountButton.type = "button";
        discountButton.className = "dltracker-language-discount-button";
        appendLanguageDiscountCell(row, discountButton);
        discountButton.addEventListener("click", () => {
          closeLanguageDialog();
          openReachDialog(row.insight, row.record?.lowestPrice, "price");
        });
        discounts.appendChild(discountButton);
      }
      const note = document.createElement("td");
      note.textContent = row.error ? "状态：读取失败" : languageRowStatusText(row);
      const detail = document.createElement("td");
      const detailLink = document.createElement("a");
      detailLink.href = languageDetailUrl(row.parentId, row.selectedId);
      detailLink.target = "_blank";
      detailLink.rel = "noopener noreferrer";
      detailLink.textContent = "看详情";
      detail.appendChild(detailLink);
      tr.append(language, work, price, discounts, note, detail, languageActionCell(row, state));
      tbody.appendChild(tr);
    }
    table.append(head, tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);
    const failed = rows.filter((row) => row.error);
    if (failed.length) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "dltracker-language-retry";
      retry.textContent = `重试失败项（${failed.length}）`;
      retry.addEventListener("click", () => {
        state.retryParents = failed.map((row) => row.parentId);
        void refreshOpenLanguageDialog();
      });
      root.appendChild(retry);
    }
    const account = document.createElement("details");
    account.className = "dltracker-language-account-details";
    const accountSummary = document.createElement("summary");
    accountSummary.textContent = "账号信息";
    const accountPanel = document.createElement("section");
    renderAccountInformationPanel(accountPanel);
    account.append(accountSummary, accountPanel);
    root.appendChild(account);
    body.replaceChildren(root);
    body.removeAttribute("aria-busy");
  }

  function saveLanguageDialogRestoreState(state) {
    if (!state?.sourceId) return;
    try {
      sessionStorage.setItem(LANGUAGE_DIALOG_RESTORE_STORAGE_KEY, JSON.stringify({
        sourceId: String(state.sourceId).toUpperCase(),
        selectedByParent: state.selectedByParent && typeof state.selectedByParent === "object"
          ? state.selectedByParent
          : {},
        expiresAt: Date.now() + 2 * 60 * 1000,
      }));
    } catch {
      // sessionStorage 不可用时仍允许正常刷新购物车页。
    }
  }

  function takeLanguageDialogRestoreState() {
    try {
      const raw = sessionStorage.getItem(LANGUAGE_DIALOG_RESTORE_STORAGE_KEY);
      sessionStorage.removeItem(LANGUAGE_DIALOG_RESTORE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || dealNumber(parsed.expiresAt) < Date.now() ||
        !isValidProductCode(parsed.sourceId)) return null;
      return {
        sourceId: String(parsed.sourceId).toUpperCase(),
        selectedByParent: parsed.selectedByParent && typeof parsed.selectedByParent === "object"
          ? parsed.selectedByParent
          : {},
      };
    } catch {
      return null;
    }
  }

  function closeLanguageDialog() {
    if (!openLanguageDialogState) return;
    openLanguageDialogState.renderToken += 1;
    openLanguageDialogState = null;
    document.querySelector(".dltracker-language-overlay")?.remove();
    unlockReachDialogScroll();
  }

  async function refreshOpenLanguageDialog() {
    if (!openLanguageDialogState) return;
    return renderLanguageComparisonDialog();
  }

  async function openLanguageComparison(productId, trigger = null, options = {}) {
    const id = String(productId || "").toUpperCase();
    if (!isValidProductCode(id)) return;
    const originalText = trigger?.textContent;
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = "正在读取…";
    }
    try {
      const family = await ensureLanguageFamily(id);
      if (family.editions.length <= 1) {
        if (trigger) trigger.textContent = "无其他语言";
        return;
      }
      closeAccountInformationDialog();
      closeReachDialog();
      openLanguageDialogState = {
        sourceId: id,
        family,
        selectedByParent: { ...(options.selectedByParent || {}) },
        rows: [],
        renderToken: 0,
      };
      const overlay = document.createElement("div");
      overlay.className = "dltracker-reach-overlay dltracker-language-overlay";
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeLanguageDialog();
      });
      const dialog = document.createElement("section");
      dialog.className = "dltracker-reach-dialog dltracker-language-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.tabIndex = -1;
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeLanguageDialog();
      });
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = "语言版本优惠比较";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", "关闭");
      close.addEventListener("click", closeLanguageDialog);
      header.append(title, close);
      const body = document.createElement("div");
      body.className = "dltracker-reach-dialog-body dltracker-language-dialog-body";
      dialog.append(header, body);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      lockReachDialogScroll();
      dialog.focus({ preventScroll: true });
      if (options.deferRender) {
        body.textContent = "正在恢复语言版本优惠比较…";
      } else {
        await renderLanguageComparisonDialog();
      }
    } catch (error) {
      showDealToast(error instanceof Error ? error.message : String(error), true, 7000);
    } finally {
      if (trigger && trigger.textContent === "正在读取…") {
        trigger.disabled = false;
        trigger.textContent = originalText || "比较语言版本";
      }
    }
  }

  async function restoreLanguageDialogAfterReload({ deferRender = false } = {}) {
    const pending = takeLanguageDialogRestoreState();
    if (!pending || !isCartPage(location.href)) return;
    await openLanguageComparison(pending.sourceId, null, {
      selectedByParent: pending.selectedByParent,
      deferRender,
    });
  }

  function createLanguageComparisonEntry(productId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dltracker-language-entry-button";
    button.dataset.productId = String(productId || "").toUpperCase();
    const cache = loadLanguageFamilyCache();
    const familyId = cache.parents[button.dataset.productId];
    const family = familyId ? cache.families[familyId] : null;
    const noOther = family && Date.now() - dealNumber(family.fetchedAt) < LANGUAGE_FAMILY_TTL_MS &&
      family.editions?.length <= 1;
    button.textContent = noOther ? "无其他语言" : "比较语言版本";
    button.disabled = Boolean(noOther);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openLanguageComparison(button.dataset.productId, button);
    });
    return button;
  }

  function syncLanguageEntryButtonSize(entry, nativeAction) {
    const button = entry?.querySelector(".dltracker-language-entry-button");
    if (!button || !nativeAction) return;
    const apply = () => {
      if (!button.isConnected || !nativeAction.isConnected) return false;
      const rect = nativeAction.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return true;
      button.style.inlineSize = `${rect.width}px`;
      button.style.blockSize = `${rect.height}px`;
      button.style.minInlineSize = `${rect.width}px`;
      button.style.maxInlineSize = `${rect.width}px`;
      button.style.minBlockSize = `${rect.height}px`;
      button.style.maxBlockSize = `${rect.height}px`;
      const parent = entry.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const parentStyle = getComputedStyle(parent);
        const contentLeft = parentRect.left +
          dealNumber(parseFloat(parentStyle.borderLeftWidth)) +
          dealNumber(parseFloat(parentStyle.paddingLeft));
        entry.style.marginInlineStart = `${Math.max(0, rect.left - contentLeft)}px`;
      }
      return true;
    };
    requestAnimationFrame(apply);
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        if (!apply()) observer.disconnect();
      });
      observer.observe(nativeAction);
      if (entry.parentElement) observer.observe(entry.parentElement);
    }
  }

  function syncMobileLanguageEntryText(entry, nativeAction) {
    const button = entry?.querySelector(".dltracker-language-entry-button");
    if (!button || !nativeAction) return;
    const style = getComputedStyle(nativeAction);
    button.style.color = style.color;
    button.style.fontFamily = style.fontFamily;
    button.style.fontSize = style.fontSize;
    button.style.fontWeight = style.fontWeight;
    button.style.lineHeight = style.lineHeight;
    button.style.textDecoration = style.textDecoration;
  }

  function injectCartLanguageEntries() {
    for (const item of getCartItems()) {
      if (!isRenderableCartItem(item)) continue;
      const id = extractRjCodeFromCartItem(item);
      if (!id) continue;
      const owner = item.closest("li.cart_list_item, li.n_work_list_item") || item;
      if (owner.querySelector(":scope .dltracker-language-entry")) continue;
      const nativeAction = owner.querySelector(
        "a.link_move_later, button.link_move_later, a.link_move_cart, button.link_move_cart",
      );
      const nativeHost = nativeAction?.parentElement;
      const mobileText = isTouchPath(location.href) || shouldStackBrowseAnalysis();
      const entry = document.createElement(mobileText ? "span" : "div");
      entry.className = `dltracker-language-entry dltracker-language-entry-cart ${
        mobileText ? "is-mobile-text" : "is-desktop-button"
      }`;
      entry.appendChild(createLanguageComparisonEntry(id));
      if (nativeHost && nativeAction) {
        nativeHost.insertBefore(entry, nativeAction);
      } else {
        owner.querySelector(".dltracker-cart-host")?.insertAdjacentElement("beforebegin", entry);
      }
      if (nativeAction) {
        if (mobileText) syncMobileLanguageEntryText(entry, nativeAction);
        else syncLanguageEntryButtonSize(entry, nativeAction);
      }
    }
  }

  function injectDetailLanguageEntry(productId) {
    if (!isProductPage(location.href)) return;
    const host = findProductRenderHost();
    if (!host) return;
    let entry = host.querySelector(":scope > .dltracker-language-entry");
    if (!entry) {
      entry = document.createElement("div");
      entry.className = "dltracker-language-entry dltracker-language-entry-detail";
      host.appendChild(entry);
    }
    if (!entry.querySelector(".dltracker-language-entry-button")) {
      entry.appendChild(createLanguageComparisonEntry(productId));
    }
  }

  function renderCompactInsight(host, insight) {
    if (!host) return;
    host.querySelector(`.${DEAL_INSIGHT_CLASSNAME}`)?.remove();
    if (!insight.bulkRule && !insight.couponOptions.length && !insight.partial) return;
    const box = document.createElement("div");
    box.className = `${DEAL_INSIGHT_CLASSNAME} dltracker-deal-compact`;
    if (insight.bulkRule) {
      const activity = document.createElement("div");
      activity.className = "dltracker-deal-row dltracker-activity-row";
      activity.textContent = `${insight.bulkRule.minCount}件${compactOff(insight.bulkRule.discountRate)}`;
      box.appendChild(activity);
    }
    if (insight.couponOptions.length) {
      const coupons = document.createElement("div");
      coupons.className = "dltracker-deal-row dltracker-coupon-row";
      const visible = insight.couponOptions.slice(0, 3).map(compactCouponListLabel);
      for (const label of visible) {
        const line = document.createElement("span");
        line.className = "dltracker-coupon-compact-line";
        line.textContent = label;
        coupons.appendChild(line);
      }
      if (insight.couponOptions.length > 3) {
        const more = document.createElement("span");
        more.className = "dltracker-coupon-compact-line";
        more.textContent = `+${insight.couponOptions.length - 3}种`;
        coupons.appendChild(more);
      }
      box.appendChild(coupons);
    }
    if (insight.partial) {
      const partial = document.createElement("span");
      partial.className = "dltracker-deal-partial";
      partial.textContent = "部分优惠未确认";
      box.appendChild(partial);
    }
    const languageEntry = host.querySelector(":scope > .dltracker-language-entry");
    if (languageEntry) host.insertBefore(box, languageEntry);
    else host.appendChild(box);
  }

  function renderDetailInsight(host, insight) {
    if (!host) return;
    host.querySelector(`.${DEAL_INSIGHT_CLASSNAME}`)?.remove();
    if (!insight.bulkRule && !insight.couponOptions.length && !insight.partial) return;
    const box = document.createElement("section");
    box.className = `${DEAL_INSIGHT_CLASSNAME} dltracker-deal-detail`;
    if (insight.bulkRule) {
      const activity = document.createElement("div");
      activity.className = "dltracker-deal-section dltracker-activity-row";
      const activityTitle = document.createElement("strong");
      activityTitle.textContent = "平台活动";
      const cartBulkCount = insight.cartProducts.filter((item) =>
        item.bulkbuyKey && item.bulkbuyKey === insight.product.bulkbuyKey,
      ).length;
      const shortfall = Math.max(0, insight.bulkRule.minCount - cartBulkCount);
      const activityText = document.createElement("span");
      activityText.textContent = [
        `${insight.bulkRule.minCount}件${compactOff(insight.bulkRule.discountRate)}`,
        shortfall ? `还差${shortfall}件` : "已满足",
        chinaExpiryText(insight.bulkRule.expiresAt),
      ].join("｜");
      activity.append(activityTitle, activityText);
      box.appendChild(activity);
    }
    if (insight.couponOptions.length) {
      const couponSection = document.createElement("div");
      couponSection.className = "dltracker-deal-section dltracker-coupon-row";
      const couponTitle = document.createElement("strong");
      couponTitle.textContent = "可用优惠券";
      couponSection.appendChild(couponTitle);
      for (const option of insight.couponOptions) {
        const line = document.createElement("div");
        line.className = "dltracker-coupon-line";
        line.textContent = [
          compactOff(option.equivalentRate),
          compactCouponCondition(option, true),
          compactCouponUsage(option),
          compactCouponExpiry(option),
        ].join("｜");
        couponSection.appendChild(line);
      }
      box.appendChild(couponSection);
    }
    if (insight.partial) {
      const partial = document.createElement("div");
      partial.className = "dltracker-deal-partial";
      partial.textContent = "部分优惠未确认";
      box.appendChild(partial);
    }
    const languageEntry = host.querySelector(":scope > .dltracker-language-entry");
    if (languageEntry) host.insertBefore(box, languageEntry);
    else host.appendChild(box);
  }

  function cartDealStatus(insight) {
    if (!insight) return "loading";
    if (insight.singleBuyOptimal) return "single";
    const reach = insight.bestReach || {};
    const requirements = [];
    if (reach.bulkRate > reach.saleRate + 0.001 && insight.bulkRule) {
      const count = (insight.cartProducts || []).filter((item) =>
        item.bulkbuyKey && item.bulkbuyKey === insight.product.bulkbuyKey,
      ).length;
      requirements.push(count >= dealNumber(insight.bulkRule.minCount, 1));
    }
    if (reach.bestCoupon) {
      requirements.push(Boolean(reach.bestCoupon.ready));
    }
    return requirements.length && requirements.every(Boolean)
      ? "met"
      : "needs";
  }

  function cartDealStatusLabel(status) {
    if (status === "single") return "单买即最优";
    if (status === "met") return "门槛已满足";
    if (status === "needs") return "需凑单";
    return "价格读取中";
  }

  function cartLocalizedMoney(value, cnyRate = null) {
    const yenValue = dealNumber(value, NaN);
    if (!Number.isFinite(yenValue)) return "价格读取中";
    const rounded = Math.round(yenValue);
    const yen = toYen(rounded);
    return Number.isFinite(cnyRate) && cnyRate > 0
      ? `约${(rounded * cnyRate).toFixed(2)}元（${yen}）`
      : yen;
  }

  function cartFrameLocalizedMoney(value, cnyRate = null) {
    const yenValue = dealNumber(value, NaN);
    if (!Number.isFinite(yenValue)) return "价格读取中";
    const rounded = Math.round(yenValue);
    const yen = toYen(rounded);
    return Number.isFinite(cnyRate) && cnyRate > 0
      ? `约${(rounded * cnyRate).toFixed(2)}元/${yen}`
      : yen;
  }

  function cartCouponConditionText(option) {
    const conditions = [];
    if (dealNumber(option?.minCount, 1) > 1) {
      conditions.push(`${Math.round(option.minCount)}部起用`);
    }
    if (dealNumber(option?.minSpend) > 0) {
      const threshold = Math.round(option.minSpend);
      conditions.push(option.discountType === "fixed" && option.discount > 0
        ? `满${threshold}-${Math.round(option.discount)}`
        : `满${threshold}円`);
    }
    if (!conditions.length) conditions.push("无门槛");
    const progress = [];
    if (dealNumber(option?.countShortfall) > 0) {
      progress.push(`还差${Math.round(option.countShortfall)}部`);
    }
    if (dealNumber(option?.spendShortfall) > 0) {
      progress.push(`还差${toYen(option.spendShortfall)}`);
    }
    return `${conditions.join("＋")}·${progress.join("＋") || "可用"}`;
  }

  function cartTableExpiryText(value, earliest = false) {
    return chinaExpiryText(value, earliest).replace(/中国时间到期$/, "");
  }

  function createCartDealPriceFrame({
    tag = "div",
    className = "",
    label,
    price,
    rate,
    onActivate = null,
  }) {
    const frame = document.createElement(tag);
    frame.className = `dltracker-cart-deal-frame dltracker-cart-price-frame ${className}`.trim();
    if (tag === "button") frame.type = "button";
    const title = document.createElement("strong");
    title.textContent = label;
    const amount = document.createElement("span");
    amount.className = "dltracker-cart-deal-price";
    amount.textContent = price;
    frame.append(title, amount);
    if (typeof rate === "number" && Number.isFinite(rate)) {
      const off = document.createElement("span");
      off.className = "dltracker-cart-deal-off";
      off.textContent = rate > 0 ? compactOff(rate) : "无折扣";
      frame.appendChild(off);
    }
    if (onActivate) {
      frame.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      });
    }
    return frame;
  }

  function appendCartCouponTable(parent, insight) {
    if (!insight?.couponOptions?.length) return;
    const section = document.createElement("section");
    section.className = "dltracker-cart-offer-section dltracker-cart-coupon-section";
    const heading = document.createElement("h4");
    heading.textContent = "可用优惠券";
    const scroll = document.createElement("div");
    scroll.className = "dltracker-cart-offer-table-wrap";
    const table = document.createElement("table");
    table.className = "dltracker-cart-offer-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["折扣", "使用条件", "可用次数", "到期（中国时间）"].forEach((text) => {
      const cell = document.createElement("th");
      cell.textContent = text;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    insight.couponOptions.forEach((option, index) => {
      const row = document.createElement("tr");
      if (index >= 2) {
        row.hidden = true;
        row.className = "dltracker-cart-coupon-extra";
      }
      const expiries = new Set((option.originals || [])
        .map((original) => original.expiresAt)
        .filter(Boolean));
      [
        compactOff(option.equivalentRate),
        cartCouponConditionText(option),
        compactCouponUsage(option),
        cartTableExpiryText(option.earliestExpiry, expiries.size > 1),
      ].forEach((text) => {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.append(head, body);
    scroll.appendChild(table);
    section.append(heading, scroll);
    if (insight.couponOptions.length > 2) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "dltracker-cart-coupon-toggle";
      toggle.textContent = `展开其余 ${insight.couponOptions.length - 2} 种优惠券`;
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const expanded = toggle.dataset.expanded === "true";
        body.querySelectorAll(".dltracker-cart-coupon-extra")
          .forEach((row) => { row.hidden = expanded; });
        toggle.dataset.expanded = expanded ? "false" : "true";
        toggle.textContent = expanded
          ? `展开其余 ${insight.couponOptions.length - 2} 种优惠券`
          : "收起到前 2 种";
      });
      section.appendChild(toggle);
    }
    parent.appendChild(section);
  }

  function appendCartActivityTable(parent, insight) {
    if (!insight?.bulkRule) return;
    const count = (insight.cartProducts || []).filter((item) =>
      item.bulkbuyKey && item.bulkbuyKey === insight.product.bulkbuyKey,
    ).length;
    const missing = Math.max(0, dealNumber(insight.bulkRule.minCount, 1) - count);
    const condition = `${dealNumber(insight.bulkRule.minCount, 3)}件${compactOff(insight.bulkRule.discountRate)}·${missing ? `还差${missing}件` : "可用"}`;
    const section = document.createElement("section");
    section.className = "dltracker-cart-offer-section dltracker-cart-activity-section";
    const heading = document.createElement("h4");
    heading.textContent = "平台活动";
    const scroll = document.createElement("div");
    scroll.className = "dltracker-cart-offer-table-wrap";
    const table = document.createElement("table");
    table.className = "dltracker-cart-offer-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["活动条件", "到期（中国时间）"].forEach((text) => {
      const cell = document.createElement("th");
      cell.textContent = text;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    const row = document.createElement("tr");
    [condition, cartTableExpiryText(insight.bulkRule.expiresAt)].forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.appendChild(cell);
    });
    body.appendChild(row);
    table.append(head, body);
    scroll.appendChild(table);
    section.append(heading, scroll);
    parent.appendChild(section);
  }

  function renderCartDealLayout(host, record, insight) {
    if (!host || !record) return;
    const card = document.createElement("section");
    card.className = `${UI_CLASSNAME} dltracker-cart-layout`;
    card.dataset.productId = String(record.rjCode || insight?.product?.id || "").toUpperCase();
    if (typeof record.lowestPrice === "number") {
      card.dataset.lowestPrice = String(record.lowestPrice);
    }
    const allForRate = insight
      ? [
          insight.product,
          ...(latestDealContext.cartSnapshot.active || []),
          ...(latestDealContext.cartSnapshot.later || []),
        ]
      : [];
    const cnyRate = currencyRateFromProducts(allForRate);
    const grid = document.createElement("div");
    grid.className = "dltracker-cart-deal-grid";
    const reachPrice = insight
      ? calculateHypotheticalPrice(insight.product, insight.bestReach)
      : Number.POSITIVE_INFINITY;
    const hasPriceComparison = Boolean(insight) &&
      Number.isFinite(record.lowestPrice);
    if (!insight) {
      grid.appendChild(createCartDealPriceFrame({
        className: "dltracker-cart-reach",
        label: "本次可到",
        price: "价格读取中",
        rate: null,
      }));
    } else {
      grid.appendChild(createCartDealPriceFrame({
        tag: "button",
        className: [
          "dltracker-cart-reach",
          hasPriceComparison && reachPrice <= record.lowestPrice
            ? "dltracker-best-reach-gold"
            : "",
        ].filter(Boolean).join(" "),
        label: insight.partial ? "当前已知可到" : "本次可到",
        price: cartFrameLocalizedMoney(reachPrice, cnyRate),
        rate: insight.bestReach.totalRate,
        onActivate: () => openReachDialog(insight, record.lowestPrice, "price"),
      }));
    }
    const historyRegular = Math.max(
      dealNumber(record.regularPrice),
      dealNumber(insight?.product?.officialPrice),
    );
    const historyRate = historyRegular > 0 &&
      dealNumber(record.lowestPrice, Infinity) < historyRegular
      ? (1 - dealNumber(record.lowestPrice) / historyRegular) * 100
      : 0;
    const historyClassNames = ["dltracker-cart-history"];
    if (!insight || !Number.isFinite(record.lowestPrice)) {
      historyClassNames.push("is-unavailable");
    } else if (record.lowestPrice <= reachPrice) {
      historyClassNames.push("dltracker-best-reach-gold");
    }
    grid.appendChild(createCartDealPriceFrame({
      className: historyClassNames.join(" "),
      label: "史低折扣",
      price: !insight
        ? "价格读取中"
        : Number.isFinite(record.lowestPrice)
          ? cartFrameLocalizedMoney(record.lowestPrice, cnyRate)
          : "暂无数据",
      rate: insight && Number.isFinite(record.lowestPrice) ? historyRate : null,
    }));
    grid.appendChild(createCartDealPriceFrame({
      className: "dltracker-cart-platform",
      label: "平台折扣",
      price: insight
        ? cartFrameLocalizedMoney(insight.product.price, cnyRate)
        : "价格读取中",
      rate: insight ? insight.bestReach.saleRate : null,
    }));
    const status = cartDealStatus(insight);
    const statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.className = `dltracker-cart-deal-frame dltracker-cart-status is-${status}`;
    statusButton.textContent = cartDealStatusLabel(status);
    statusButton.disabled = !insight;
    if (insight) {
      statusButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openReachDialog(insight, record.lowestPrice, "status");
      });
    }
    grid.appendChild(statusButton);
    const trend = document.createElement(record.dlwatcherUrl ? "a" : "span");
    trend.className = "dltracker-cart-deal-frame dltracker-cart-trend";
    trend.textContent = "价格趋势";
    if (record.dlwatcherUrl) {
      trend.href = record.dlwatcherUrl;
      trend.target = "_blank";
      trend.rel = "noopener noreferrer";
      trend.addEventListener("click", (event) => event.stopPropagation());
    }
    grid.appendChild(trend);
    card.appendChild(grid);
    if (insight) {
      appendCartCouponTable(card, insight);
      appendCartActivityTable(card, insight);
      if (insight.partial) {
        const partial = document.createElement("div");
        partial.className = "dltracker-deal-partial";
        partial.textContent = "部分优惠未确认";
        card.appendChild(partial);
      }
    }
    host.replaceChildren(card);
  }

  function createBestReachBadge(insight, lowestPrice) {
    const badge = document.createElement("div");
    const price = calculateHypotheticalPrice(insight?.product, insight?.bestReach);
    badge.className = [
      "dltracker-chip",
      "dltracker-best-reach-badge",
      bestReachColorClass(price, lowestPrice),
    ].join(" ");
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-label", "查看本次可到的计算说明");
    const text = document.createElement("span");
    text.className = "dltracker-chip-text";
    const label = insight?.partial ? "当前已知可到" : "本次可到";
    text.textContent = Number.isFinite(price)
      ? `${label} ${toYen(price)}`
      : label;
    const off = document.createElement("span");
    off.className = "dltracker-off-badge";
    off.textContent = `${Math.round(insight?.bestReach?.totalRate || 0)}OFF`;
    badge.append(text, off);
    const open = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openReachDialog(insight, lowestPrice);
    };
    badge.addEventListener("click", open);
    badge.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    });
    return badge;
  }

  function refreshHistoryReachBadges(id) {
    const insight = dealInsightById.get(String(id).toUpperCase());
    for (const card of document.querySelectorAll(
      `.${UI_CLASSNAME}[data-product-id="${String(id).toUpperCase()}"]`,
    )) {
      const cartHost = card.closest(".dltracker-cart-host");
      const browseHost = card.closest(".dltracker-browse-analysis-host");
      const cartRecord = browseRecordById.get(String(id).toUpperCase());
      if (cartHost && cartRecord) {
        renderCartDealLayout(cartHost, cartRecord, insight);
        continue;
      }
      if (browseHost) {
        if (cartRecord) renderBrowseCardAnalysis(browseHost, cartRecord, insight);
        continue;
      }
      card.querySelector(".dltracker-best-reach-badge")?.remove();
      card.querySelector(".dltracker-single-buy-badge")?.remove();
      if (!insight?.bestReach?.totalRate) continue;
      const lowestPrice = Number(card.dataset.lowestPrice);
      const badge = createBestReachBadge(
        insight,
        Number.isFinite(lowestPrice) ? lowestPrice : undefined,
      );
      const chip = card.querySelector(".dltracker-history-chip");
      if (chip) {
        chip?.insertAdjacentElement("afterend", badge);
      } else {
        card.appendChild(badge);
      }
      if (insight.singleBuyOptimal) {
        badge.insertAdjacentElement("afterend", createSingleBuyBadge());
      }
    }
  }

  async function buildInsight(product, coupons, cartProducts, partial = false) {
    const bulkRule = await ensureBulkRule(product);
    const bulkRules = new Map(latestDealContext.bulkRules || []);
    if (product?.bulkbuyKey && bulkRule) {
      bulkRules.set(String(product.bulkbuyKey), bulkRule);
    }
    const cartSubtotal = platformSubtotalWithBulkRules(
      cartProducts,
      bulkRules,
    );
    const options = buildDealCouponOptions(
      coupons,
      product,
      cartProducts,
      cartSubtotal,
    );
    const bestReach = calculateBestReach(product, options, bulkRule);
    const insight = {
      product,
      couponOptions: options,
      cartProducts,
      bulkRule,
      bestReach,
      singleBuyOptimal: isSingleBuyOptimal(product, options, bulkRule, bestReach),
      partial: partial || latestDealContext.partial ||
        Boolean(product?.bulkbuyKey && !bulkRule),
    };
    dealInsightById.set(product.id, insight);
    refreshHistoryReachBadges(product.id);
    return insight;
  }

  async function enhanceGenericBrowseCards(coupons, cartProducts) {
    const cards = collectBrowseCards();
    if (!cards.length) return;
    // 价格、声优和活动信息可能需要数秒才处理完，先把排序/筛选入口放到主列表。
    injectBrowseControls(false);
    const metadata = await ensureProductMetadataBatches(cards.map((entry) => entry.id));
    const enrichedCartProducts = cartProducts.map((item) => ({
      ...item,
      ...(metadata.get(item.id) || {}),
      id: item.id,
      price: item.price || metadata.get(item.id)?.price || 0,
    }));
    // 活动页同源请求也保持串行，避免列表上出现并发访问。
    await mapWithConcurrency(cards, 1, async ({ id, node, cartItem }) => {
      const priceHost = findBrowsePriceHost(node);
      if (!priceHost) {
        markDealProcessed(node, id);
        return;
      }
      const priceMatch = (priceHost.textContent || "")
        .replace(/,/g, "")
        .match(/(\d{1,8})\s*(?:円|JPY)/i);
      const product = metadata.get(id) || {
        id,
        title: node.querySelector('a[href*="product_id/"]')?.textContent?.trim() || id,
        price: priceMatch ? Number(priceMatch[1]) : 0,
        officialPrice: priceMatch ? Number(priceMatch[1]) : 0,
        cnyPrice: 0,
        voiceActors: [],
        makerId: "",
        siteId: location.pathname.split("/").filter(Boolean)[0] || "",
        workType: "",
        customGenres: [],
        bulkbuyKey: "",
        alternateIds: [],
      };
      const partial = !metadata.has(id);
      const usableCoupons = partial
        ? coupons.filter((coupon) =>
            ["payment", "id_all"].includes(coupon.conditionType) &&
            (!coupon.maxPrice || product.price > 0),
          )
        : coupons;
      const cartPage = isCartPage(location.href);
      if (cartPage) {
        priceHost.querySelector(".dltracker-jpy-price")?.remove();
      } else {
        appendJpyPrice(priceHost, product);
      }
      const analysisHost = cartItem ? null : ensureBrowseAnalysisHost(node);
      if (analysisHost) {
        removeLegacyBrowseAnalysis(node, analysisHost);
        renderBrowseCardAnalysis(analysisHost, { rjCode: id }, null);
      }
      renderBrowseVoiceActors(node, product);
      const insight = await buildInsight(product, usableCoupons, enrichedCartProducts, partial);
      const cartHost = cartItem
        ? node.querySelector(".dltracker-cart-host") ||
          ensureCartRenderHost(node)
        : null;
      if (cartHost) {
        const record = browseRecordById.get(String(id).toUpperCase()) || {
          rjCode: id,
        };
        renderCartDealLayout(cartHost, record, insight);
      }

      let record = browseRecordById.get(String(id).toUpperCase()) || {
        rjCode: id,
      };
      if (/^[RB]J/i.test(id)) {
        const link = node.querySelector('a[href*="product_id/"]');
        record = await buildOrUpdateRecord({
          rjCode: id,
          title: link?.textContent?.trim() || id,
          currentPrice: product.price || undefined,
          forceFetch: false,
        }) || { rjCode: id };
        browseRecordById.set(String(id).toUpperCase(), record || { rjCode: id });
        if (record?.voiceActors?.length) {
          renderBrowseVoiceActors(node, {
            ...product,
            voiceActors: extractVoiceActorNames([
              product.voiceActors || [],
              record.voiceActors,
            ]),
          });
        }
      }
      if (cartHost) {
        renderPriceCard(record, cartHost);
      } else if (analysisHost) {
        renderBrowseCardAnalysis(analysisHost, record, insight);
      }
      markDealProcessed(node, id);
    });
    injectBrowseControls();
    await applyBrowseSortAndFilter();
    void refreshAllAccountReminders().catch((error) => {
      console.warn(`[${APP_NAME}] account reminder refresh failed:`, error);
    });
  }

  async function enhanceProductDealDetail(coupons, cartProducts) {
    if (!isProductPage(location.href)) return;
    const matched = location.pathname.match(/product_id\/([RBV]J\d{6,})/i);
    const id = matched ? matched[1].toUpperCase() : productIdFromNode(document.body);
    if (!id) return;
    const domProduct = detailProductFromDom(id);
    const metadata = await ensureProductMetadataBatches([
      id,
      ...cartProducts.map((item) => item.id),
    ]);
    const product = metadata.get(id) || domProduct;
    const enrichedCart = cartProducts.map((item) => ({
      ...item,
      ...(metadata.get(item.id) || {}),
      id: item.id,
      price: item.price || metadata.get(item.id)?.price || 0,
    }));
    const partial = !metadata.has(id) && coupons.some((coupon) =>
      ["custom_genre", "common", "site_ids", "worktype"].includes(coupon.conditionType),
    );
    const insight = await buildInsight(product, coupons, enrichedCart, partial);
    const priceHost = findProductPriceHost();
    appendJpyPrice(priceHost, product);
    const renderHost = findProductRenderHost();
    renderDetailInsight(renderHost, insight);
    injectDetailLanguageEntry(id);
    markDealProcessed(renderHost, id);
  }

  async function enhanceDealInsights() {
    if (insightBootstrapInFlight) return insightBootstrapInFlight;
    insightBootstrapInFlight = (async () => {
      invalidateCouponCacheAfterPurchase();
      let rawCoupons = [];
      let dealDataPartial = false;
      try {
        const forceCouponRefresh = isCouponPage(location.href) &&
          importedCouponPageUrl !== location.href;
        if (forceCouponRefresh) importedCouponPageUrl = location.href;
        rawCoupons = await ensureDealCoupons(forceCouponRefresh);
      } catch (error) {
        dealDataPartial = true;
        console.warn(`[${APP_NAME}] coupon insight load failed:`, error);
        stopDealRequests("优惠券读取失败");
        showDealToast("优惠券读取失败，本页已停止自动请求", true, 8000);
      }
      const coupons = groupDealCoupons(rawCoupons);
      const rawCartSnapshot = await ensureCartSnapshot();
      const currentProductMatch = location.pathname.match(/product_id\/([RBV]J\d{6,})/i);
      const metadataIds = [
        ...(rawCartSnapshot.active || rawCartSnapshot.products || []).map((item) => item.id),
        ...(rawCartSnapshot.later || []).map((item) => item.id),
        ...collectBrowseCards().map((entry) => entry.id),
        ...(currentProductMatch ? [currentProductMatch[1]] : []),
      ];
      const cartMetadata = await ensureProductMetadataBatches(metadataIds);
      const enrich = (item) => ({
        ...(cartMetadata.get(String(item.id).toUpperCase()) || {}),
        ...item,
        id: String(item.id).toUpperCase(),
        price: item.price || cartMetadata.get(String(item.id).toUpperCase())?.price || 0,
        // 购物车 DOM 缺少原价时会以当前价占位；结构化接口的
        // official_price 才能区分“231/330”这类平台 30OFF。
        officialPrice: cartMetadata.get(String(item.id).toUpperCase())?.officialPrice ||
          item.officialPrice || item.price || 0,
        title: item.title || cartMetadata.get(String(item.id).toUpperCase())?.title || item.id,
        // 接口的 currency_price.CNY 与精确 JPY 现价同源，优先级高于
        // 购物车 DOM 中可能同时包含划线原价的“¥”文本。
        cnyPrice: cartMetadata.get(String(item.id).toUpperCase())?.cnyPrice ||
          item.cnyPrice || 0,
      });
      const cartSnapshot = {
        ...rawCartSnapshot,
        active: (rawCartSnapshot.active || rawCartSnapshot.products || []).map(enrich),
        later: (rawCartSnapshot.later || []).map(enrich),
      };
      cartSnapshot.products = cartSnapshot.active;
      const bulkRules = await bulkRuleMapForProducts(cartSnapshot.active);
      latestDealContext = {
        coupons,
        cartSnapshot,
        bulkRules,
        partial: dealDataPartial || !rawCartSnapshot.loaded,
      };
      const cartProducts = cartSnapshot.loaded ? cartSnapshot.active : [];
      if (isProductPage(location.href)) {
        await enhanceProductDealDetail(coupons, cartProducts);
      }
      await enhanceGenericBrowseCards(coupons, cartProducts);
      if (isCartPage(location.href)) await sortBuyLaterItems();
      refreshOpenReachDialog();
      await refreshOpenLanguageDialog();
      // 账号索引可能需要多批串行请求和安全间隔；
      // 先完成当页价格与优惠渲染，再在后台更新账号提醒。
      void ensureInitialAccountIndex()
        .then(async () => {
          await refreshAllAccountReminders();
          await refreshOpenLanguageDialog();
        })
        .catch((error) => {
          console.warn(`[${APP_NAME}] initial account index failed:`, error);
        });
    })().finally(() => {
      insightBootstrapInFlight = null;
    });
    return insightBootstrapInFlight;
  }

  async function importDlsiteCoupons() {
    if (couponImportInFlight) return couponImportInFlight;
    couponImportInFlight = (async () => {
      const raw = await ensureDealCoupons(false);
      return syncPlannerCouponsFromRaw(raw);
    })().catch((error) => {
      console.warn(`[${APP_NAME}] import coupons failed:`, error);
      stopDealRequests("优惠券读取失败");
      showDealToast("优惠券读取失败，本页已停止自动请求", true, 8000);
      return [];
    }).finally(() => {
      couponImportInFlight = null;
    });
    return couponImportInFlight;
  }

  async function ensureDlsiteCoupons(force = false) {
    const raw = await ensureDealCoupons(force);
    return syncPlannerCouponsFromRaw(raw);
  }

  async function enhanceCouponPage() {
    if (!isCouponPage(location.href)) return;
    if (importedCouponPageUrl === location.href) return;
    importedCouponPageUrl = location.href;
    const raw = await ensureDealCoupons(true);
    syncPlannerCouponsFromRaw(raw);
  }

  function productRecordsFromPayload(payload) {
    const rawRecords = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.products)
        ? payload.products
        : payload?.products && typeof payload.products === "object"
          ? Object.entries(payload.products).map(([id, value]) => ({
              ...(value || {}),
              product_id: value?.product_id || id,
            }))
          : payload && typeof payload === "object"
            ? Object.entries(payload).map(([id, value]) => ({
                ...(value || {}),
                product_id: value?.product_id || id,
              }))
            : [];
    const records = new Map();
    for (const record of rawRecords) {
      const id = String(
        record?.product_id || record?.workno || record?.id || "",
      ).toUpperCase();
      if (id) records.set(id, record);
    }
    return records;
  }

  async function fetchCartProductMetadata(items) {
    const url = new URL(DLSITE_PRODUCT_INFO_PATH, location.origin);
    url.searchParams.set("product_id", items.map((item) => item.id).join(","));
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`作品条件接口返回 HTTP ${response.status}`);
    return productRecordsFromPayload(await response.json());
  }

  function couponMatchesProduct(coupon, item, metadata) {
    const type = coupon.sourceConditionType;
    const conditions = coupon.sourceConditions || {};
    const maximumPrice = firstNumberish(
      [conditions],
      ["maximum_applicable_price", "maximum_price", "max_price"],
      0,
    );
    const productPrice =
      parseNumberish(metadata?.price) ?? item.regularPrice;
    if (maximumPrice > 0 && productPrice > maximumPrice) return false;
    if (type === "custom_genre") {
      const allowed = new Set(conditionTokens(conditions.custom_genre));
      return conditionTokens(metadata?.custom_genres).some((id) => allowed.has(id));
    }
    if (type === "site_ids") {
      const allowed = new Set(conditionTokens(conditions.site_ids));
      return conditionTokens(metadata?.site_id).some((id) => allowed.has(id));
    }
    if (type === "worktype") {
      const allowed = new Set(conditionTokens(conditions.worktype));
      return conditionTokens(metadata?.work_type).some((id) => allowed.has(id));
    }
    if (type === "common") {
      const allowed = new Set(conditionTokens(conditions.maker_id));
      return conditionTokens(metadata?.maker_id).some((id) => allowed.has(id));
    }
    if (type === "payment") return true;
    return false;
  }

  async function resolveImportedCouponEligibility(items, coupons) {
    const dynamicTypes = new Set(["custom_genre", "site_ids", "worktype", "common"]);
    const needsMetadata = coupons.some(
      (coupon) =>
        coupon?.source === "dlsite" &&
        dynamicTypes.has(coupon.sourceConditionType),
    );
    const metadata = needsMetadata
      ? await fetchCartProductMetadata(items)
      : new Map();
    return coupons.map((coupon) => {
      if (coupon?.source !== "dlsite") return coupon;
      if (!dynamicTypes.has(coupon.sourceConditionType)) return coupon;
      return {
        ...coupon,
        allEligible: false,
        eligibleIds: items
          .filter((item) =>
            couponMatchesProduct(coupon, item, metadata.get(item.id)),
          )
          .map((item) => item.id),
      };
    });
  }

  function cartItemAttribute(item, names) {
    for (const name of names) {
      const direct = item.getAttribute(name);
      if (direct !== null && direct !== "") return direct;
      const nested = item.querySelector(`[${name}]`)?.getAttribute(name);
      if (nested !== null && nested !== undefined && nested !== "") {
        return nested;
      }
    }
    return null;
  }

  function parseYenFromCartText(item) {
    const candidates = [
      item.querySelector(".n_work_price_wrap"),
      item.querySelector(".work_price"),
      item.querySelector('[class*="price"]'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const text = (candidate.textContent || "").replace(/,/g, "");
      const matched = text.match(/(\d{1,8})\s*(?:円|JPY)/i);
      if (matched) return Number(matched[1]);
    }
    return 0;
  }

  function extractPlannerItemsFromCart(itemOverrides = {}) {
    const result = [];
    const seen = new Set();
    for (const rawItem of getCartItems()) {
      const item =
        rawItem.closest("li.cart_list_item, li.n_work_list_item") || rawItem;
      if (!isRenderableCartItem(item) || isBuyLaterCartItem(item)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      const id = extractRjCodeFromCartItem(item);
      if (!id) continue;

      const title =
        item.querySelector(".work_name a")?.textContent?.trim() ||
        item.querySelector(".n_work_name a")?.textContent?.trim() ||
        item.querySelector('a[href*="product_id/"]')?.textContent?.trim() ||
        id;
      const originPrice = parseNumberish(
        cartItemAttribute(item, [
          "data-bulkbuy_origin_price",
          "data-origin-price",
          "data-price",
        ]),
      );
      const detectedSetPrice = parseNumberish(
        cartItemAttribute(item, [
          "data-bulkbuy_price",
          "data-bulk-price",
        ]),
      );
      const detected = {
        id,
        title,
        regularPrice:
          typeof originPrice === "number" ? originPrice : parseYenFromCartText(item),
        setPrice:
          typeof detectedSetPrice === "number" ? detectedSetPrice : null,
        setGroup:
          cartItemAttribute(item, ["data-bulkbuy_key", "data-bulkbuy-key"]) ||
          "",
        setMinCount: 3,
      };
      const override = itemOverrides[id];
      result.push(override ? { ...detected, ...override, id, title } : detected);
    }
    return result;
  }

  function plannerInput(type, value, onInput, options = {}) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    input.className = "dltracker-planner-input";
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  function plannerSelect(value, entries, onChange) {
    const select = document.createElement("select");
    select.className = "dltracker-planner-input";
    for (const [entryValue, label] of entries) {
      const option = document.createElement("option");
      option.value = entryValue;
      option.textContent = label;
      option.selected = entryValue === value;
      select.appendChild(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function plannerField(label, control) {
    const wrapper = document.createElement("label");
    wrapper.className = "dltracker-planner-field";
    const title = document.createElement("span");
    title.textContent = label;
    wrapper.appendChild(title);
    wrapper.appendChild(control);
    return wrapper;
  }

  function renderPlannerItems(container, items, state, rerender) {
    const heading = document.createElement("div");
    heading.className = "dltracker-planner-section-title";
    heading.textContent = `购物车作品（${items.length}/${DEAL_PLANNER_MAX_ITEMS}）`;
    container.appendChild(heading);

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "dltracker-planner-muted";
      empty.textContent = "没有读到购物车作品。请确认作品在“现在购买”列表并刷新页面。";
      container.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "dltracker-planner-item";
      const name = document.createElement("div");
      name.className = "dltracker-planner-item-name";
      name.textContent = `${item.id} · ${item.title}`;
      row.appendChild(name);
      const grid = document.createElement("div");
      grid.className = "dltracker-planner-grid";
      const update = (field, value) => {
        state.itemOverrides[item.id] = {
          ...(state.itemOverrides[item.id] || {}),
          [field]: ["regularPrice", "setPrice", "setMinCount"].includes(field)
            ? value === ""
              ? field === "setPrice"
                ? null
                : 0
              : Number(value)
            : value,
        };
        savePlannerState(state);
      };
      grid.appendChild(
        plannerField(
          "普通/当前价",
          plannerInput("number", item.regularPrice, (value) =>
            update("regularPrice", value),
          { min: 0 }),
        ),
      );
      grid.appendChild(
        plannerField(
          "三件折后价",
          plannerInput(
            "number",
            item.setPrice ?? "",
            (value) => update("setPrice", value),
            { min: 0, placeholder: "不参加则留空" },
          ),
        ),
      );
      grid.appendChild(
        plannerField(
          "同组标识",
          plannerInput("text", item.setGroup, (value) =>
            update("setGroup", value),
          { placeholder: "例如 3x60" }),
        ),
      );
      grid.appendChild(
        plannerField(
          "成组数量",
          plannerInput("number", item.setMinCount, (value) =>
            update("setMinCount", value),
          { min: 2, max: 20 }),
        ),
      );
      row.appendChild(grid);

      if (state.itemOverrides[item.id]) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "dltracker-planner-link-button";
        reset.textContent = "恢复页面识别值";
        reset.addEventListener("click", () => {
          delete state.itemOverrides[item.id];
          savePlannerState(state);
          rerender();
        });
        row.appendChild(reset);
      }
      container.appendChild(row);
    }
  }

  function newPlannerCoupon(items, index) {
    return {
      id: `coupon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `优惠券 ${index + 1}`,
      type: "percent",
      value: 20,
      minSpend: 0,
      maxDiscount: 0,
      scope: "all",
      minSpendScope: "order",
      stackMode: "after",
      repeatable: false,
      allEligible: false,
      eligibleIds: items.map((item) => item.id),
    };
  }

  function renderPlannerCoupons(container, items, state, rerender) {
    const titleRow = document.createElement("div");
    titleRow.className = "dltracker-planner-title-row";
    const heading = document.createElement("div");
    heading.className = "dltracker-planner-section-title";
    heading.textContent = `优惠券（${state.coupons.length}/${DEAL_PLANNER_MAX_COUPONS}）`;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "dltracker-planner-secondary";
    add.textContent = "添加优惠券";
    add.disabled = !items.length || state.coupons.length >= DEAL_PLANNER_MAX_COUPONS;
    add.addEventListener("click", () => {
      state.coupons.push(newPlannerCoupon(items, state.coupons.length));
      savePlannerState(state);
      rerender();
    });
    titleRow.appendChild(heading);
    titleRow.appendChild(add);
    container.appendChild(titleRow);

    for (const coupon of state.coupons) {
      if (!Array.isArray(coupon.eligibleIds)) coupon.eligibleIds = [];
      const card = document.createElement("div");
      card.className = "dltracker-planner-coupon";
      const header = document.createElement("div");
      header.className = "dltracker-planner-title-row";
      const nameWrap = document.createElement("div");
      nameWrap.className = "dltracker-planner-coupon-name-wrap";
      const name = plannerInput("text", coupon.name, (value) => {
        coupon.name = value;
        savePlannerState(state);
      });
      name.classList.add("dltracker-planner-coupon-name");
      nameWrap.appendChild(name);
      if (coupon.source === "dlsite") {
        const badge = document.createElement("span");
        badge.className = "dltracker-planner-source-badge";
        badge.textContent = "DLsite 自动导入";
        nameWrap.appendChild(badge);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "dltracker-planner-danger";
      remove.textContent = "删除";
      remove.addEventListener("click", () => {
        state.coupons = state.coupons.filter((item) => item.id !== coupon.id);
        savePlannerState(state);
        rerender();
      });
      header.appendChild(nameWrap);
      header.appendChild(remove);
      card.appendChild(header);

      const update = (field, value) => {
        coupon[field] = value;
        savePlannerState(state);
      };
      const grid = document.createElement("div");
      grid.className = "dltracker-planner-grid";
      grid.appendChild(
        plannerField(
          "优惠类型",
          plannerSelect(
            coupon.type,
            [
              ["percent", "百分比券"],
              ["fixed", "固定金额/满减券"],
            ],
            (value) => update("type", value),
          ),
        ),
      );
      grid.appendChild(
        plannerField(
          "优惠值",
          plannerInput("number", coupon.value, (value) =>
            update("value", Number(value)),
          { min: 0 }),
        ),
      );
      grid.appendChild(
        plannerField(
          "最低消费",
          plannerInput("number", coupon.minSpend, (value) =>
            update("minSpend", Number(value)),
          { min: 0 }),
        ),
      );
      grid.appendChild(
        plannerField(
          "减免上限（0=无）",
          plannerInput("number", coupon.maxDiscount, (value) =>
            update("maxDiscount", Number(value)),
          { min: 0 }),
        ),
      );
      grid.appendChild(
        plannerField(
          "优惠几部",
          plannerSelect(
            coupon.scope,
            [
              ["all", "订单内全部适用作品"],
              ["one", "仅一部适用作品"],
            ],
            (value) => update("scope", value),
          ),
        ),
      );
      grid.appendChild(
        plannerField(
          "门槛计算范围",
          plannerSelect(
            coupon.minSpendScope,
            [
              ["order", "整单金额"],
              ["eligible", "适用作品金额"],
            ],
            (value) => update("minSpendScope", value),
          ),
        ),
      );
      grid.appendChild(
        plannerField(
          "与三件折扣关系",
          plannerSelect(
            coupon.stackMode,
            [
              ["after", "折后继续用券"],
              ["replace-target", "用券作品恢复普通价，但仍计入三件"],
              ["exclude-target", "用券作品恢复普通价且不计入三件"],
            ],
            (value) => update("stackMode", value),
          ),
        ),
      );
      grid.appendChild(
        plannerField(
          "使用次数",
          plannerSelect(
            coupon.repeatable ? "repeatable" : "once",
            [
              ["once", "整次购买中使用一次"],
              ["repeatable", "期限内可在不同订单重复"],
            ],
            (value) => update("repeatable", value === "repeatable"),
          ),
        ),
      );
      grid.appendChild(
        plannerField(
          "适用范围",
          plannerSelect(
            coupon.allEligible ? "all" : "selected",
            [
              ["all", "购物车全部作品"],
              ["selected", "仅下方勾选作品"],
            ],
            (value) => {
              update("allEligible", value === "all");
              rerender();
            },
          ),
        ),
      );
      card.appendChild(grid);

      const eligibilityTitle = document.createElement("div");
      eligibilityTitle.className = "dltracker-planner-eligibility-title";
      eligibilityTitle.textContent = coupon.source === "dlsite"
        ? "当前购物车中的适用作品（类型/站点条件会在计算时自动解析）"
        : "当前购物车中的适用作品";
      card.appendChild(eligibilityTitle);
      const eligibility = document.createElement("div");
      eligibility.className = "dltracker-planner-checkboxes";
      for (const item of items) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = coupon.eligibleIds.includes(item.id);
        checkbox.addEventListener("change", () => {
          const next = new Set(coupon.eligibleIds);
          if (checkbox.checked) next.add(item.id);
          else next.delete(item.id);
          coupon.eligibleIds = [...next];
          coupon.allEligible = false;
          savePlannerState(state);
        });
        const text = document.createElement("span");
        text.textContent = `${item.id} ${item.title}`;
        label.appendChild(checkbox);
        label.appendChild(text);
        eligibility.appendChild(label);
      }
      card.appendChild(eligibility);
      if (coupon.expiresAt || coupon.repeatable || coupon.autoWarnings?.length) {
        const meta = document.createElement("p");
        meta.className = "dltracker-planner-muted";
        const parts = [];
        if (coupon.expiresAt) {
          parts.push(`有效期至 ${new Date(coupon.expiresAt).toLocaleString("zh-CN")}`);
        }
        if (coupon.repeatable) parts.push("期限内可重复使用");
        if (coupon.autoWarnings?.length) {
          parts.push(`注意：${coupon.autoWarnings.join("；")}`);
        }
        meta.textContent = parts.join(" · ");
        card.appendChild(meta);
      }
      container.appendChild(card);
    }
  }

  function renderPlannerResult(container, result) {
    container.replaceChildren();
    const summary = document.createElement("div");
    summary.className = "dltracker-planner-result-summary";
    summary.textContent = `不使用优惠券 ${toYen(result.baseline)} → 推荐付款 ${toYen(result.total)}，节省 ${toYen(result.savings)}`;
    container.appendChild(summary);

    result.orders.forEach((order, index) => {
      const card = document.createElement("div");
      card.className = "dltracker-planner-order";
      const title = document.createElement("strong");
      title.textContent = order.couponName
        ? `第 ${index + 1} 单：使用「${order.couponName}」`
        : `第 ${index + 1} 单：不使用优惠券`;
      card.appendChild(title);
      const list = document.createElement("ul");
      for (const line of order.lines) {
        const item = document.createElement("li");
        const tags = [];
        if (line.dealApplied) tags.push("三件折扣");
        if (line.couponTarget) tags.push("用券");
        item.textContent = `${line.id} ${line.title}：${toYen(line.price)}${tags.length ? `（${tags.join("、")}）` : ""}`;
        list.appendChild(item);
      }
      card.appendChild(list);
      const total = document.createElement("div");
      total.className = "dltracker-planner-order-total";
      total.textContent = `小计 ${toYen(order.subtotal)} − 优惠 ${toYen(order.discount)} = ${toYen(order.total)}`;
      card.appendChild(total);
      container.appendChild(card);
    });

    const note = document.createElement("p");
    note.className = "dltracker-planner-warning";
    note.textContent =
      "这是按所填规则得到的估算值。DLsite 可能采用不同的计税、取整或互斥规则，请在付款确认页核对最终金额。脚本不会自动改购物车或下单。";
    container.appendChild(note);
  }

  function renderDealPlanner(root) {
    const panel = root.querySelector(".dltracker-planner-panel");
    const body = root.querySelector(".dltracker-planner-body");
    const resultBox = root.querySelector(".dltracker-planner-result");
    if (!panel || !body || !resultBox) return;
    const state = getPlannerState();
    const items = extractPlannerItemsFromCart(state.itemOverrides);
    body.replaceChildren();
    resultBox.replaceChildren();
    const rerender = () => renderDealPlanner(root);
    renderPlannerItems(body, items, state, rerender);
    renderPlannerCoupons(body, items, state, rerender);

    const calculate = document.createElement("button");
    calculate.type = "button";
    calculate.className = "dltracker-planner-primary";
    calculate.textContent = "计算最优拆单方案";
    calculate.disabled = !items.length;
    calculate.addEventListener("click", async () => {
      calculate.disabled = true;
      const oldText = calculate.textContent;
      calculate.textContent = "正在解析优惠券条件…";
      try {
        const freshState = getPlannerState();
        const freshItems = extractPlannerItemsFromCart(
          freshState.itemOverrides,
        );
        const resolvedCoupons = await resolveImportedCouponEligibility(
          freshItems,
          freshState.coupons,
        );
        const activeCoupons = resolvedCoupons.filter((coupon) => {
          if (coupon.expiresAt && Date.parse(coupon.expiresAt) <= Date.now()) {
            return false;
          }
          return coupon.allEligible || coupon.eligibleIds?.length;
        });
        renderPlannerResult(
          resultBox,
          optimizeDealPlan(freshItems, activeCoupons),
        );
      } catch (error) {
        resultBox.replaceChildren();
        const message = document.createElement("p");
        message.className = "dltracker-planner-warning";
        message.textContent = error instanceof Error ? error.message : String(error);
        resultBox.appendChild(message);
      } finally {
        calculate.disabled = !extractPlannerItemsFromCart(
          getPlannerState().itemOverrides,
        ).length;
        calculate.textContent = oldText;
      }
    });
    body.appendChild(calculate);
  }

  function injectDealPlanner() {
    if (!isCartPage(location.href)) return;
    if (document.querySelector(".dltracker-deal-planner")) return;
    const root = document.createElement("div");
    root.className = "dltracker-deal-planner";
    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "dltracker-planner-launcher";
    launcher.textContent = "最优买法";
    const panel = document.createElement("section");
    panel.className = "dltracker-planner-panel";
    panel.hidden = true;
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "DLsite 最优买法（本地计算）";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dltracker-planner-close";
    close.textContent = "×";
    close.addEventListener("click", () => {
      panel.hidden = true;
    });
    header.appendChild(title);
    header.appendChild(close);
    const body = document.createElement("div");
    body.className = "dltracker-planner-body";
    const result = document.createElement("div");
    result.className = "dltracker-planner-result";
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(result);
    launcher.addEventListener("click", async () => {
      panel.hidden = false;
      launcher.disabled = true;
      const oldText = launcher.textContent;
      launcher.textContent = "正在读取优惠券…";
      await ensureDlsiteCoupons();
      renderDealPlanner(root);
      launcher.disabled = false;
      launcher.textContent = oldText;
    });
    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);
  }

  function isBuyLaterSortEnabled() {
    try {
      const raw = localStorage.getItem(BUY_LATER_SORT_STORAGE_KEY);
      if (raw === null) return true;
      return raw !== "0" && raw !== "false";
    } catch {
      return true;
    }
  }

  function setBuyLaterSortEnabled(enabled) {
    try {
      localStorage.setItem(BUY_LATER_SORT_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // noop
    }
  }

  function getBuyLaterSortMode() {
    try {
      const raw = localStorage.getItem(BUY_LATER_SORT_MODE_STORAGE_KEY);
      if ([
        BUY_LATER_SORT_MODE_REACH,
        BUY_LATER_SORT_MODE_PRICE,
        BUY_LATER_SORT_MODE_PLATFORM_EXPIRY,
      ].includes(raw)) return raw;
      // 旧版史低/折扣模式统一迁移到最高可达折扣。
      if (raw === "discount" || raw === BUY_LATER_SORT_MODE_LOWEST) {
        return BUY_LATER_SORT_MODE_REACH;
      }
      return BUY_LATER_SORT_MODE_REACH;
    } catch {
      return BUY_LATER_SORT_MODE_REACH;
    }
  }

  function setBuyLaterSortMode(mode) {
    const normalized = [
      BUY_LATER_SORT_MODE_REACH,
      BUY_LATER_SORT_MODE_PRICE,
      BUY_LATER_SORT_MODE_PLATFORM_EXPIRY,
    ].includes(mode) ? mode : BUY_LATER_SORT_MODE_REACH;
    try {
      localStorage.setItem(BUY_LATER_SORT_MODE_STORAGE_KEY, normalized);
    } catch {
      // noop
    }
  }

  function ensureBuyLaterSubtitleHost() {
    const desktopSection = document.querySelector("section.buy_later");
    const desktopHost = desktopSection?.querySelector(".contents_sub_title");
    const desktopTitle = desktopHost?.querySelector("h2");
    if (desktopHost && desktopTitle) {
      return { host: desktopHost, title: desktopTitle, isMobile: false };
    }

    const mobileSection = document.querySelector("section.cart_hold");
    if (!mobileSection) return null;

    // 兼容旧版本：把曾经包裹 h2 的临时容器移除，恢复 h2 为 section 直子元素。
    const legacyHost = mobileSection.querySelector(
      ":scope > .dltracker-buy-later-mobile-subtitle",
    );
    if (legacyHost) {
      const legacyTitle =
        legacyHost.querySelector(":scope > h2.sub_lead_01") ||
        legacyHost.querySelector(":scope > h2");
      if (legacyTitle) {
        mobileSection.insertBefore(legacyTitle, legacyHost);
      }
      legacyHost.remove();
    }

    const mobileTitle =
      mobileSection.querySelector(":scope > h2.sub_lead_01") ||
      mobileSection.querySelector(":scope > h2");
    if (!mobileTitle) return null;

    mobileSection.classList.add("dltracker-buy-later-mobile-section");
    return { host: mobileSection, title: mobileTitle, isMobile: true };
  }

  function injectBuyLaterSortToggle() {
    if (!isCartPage(location.href)) return;

    const header = ensureBuyLaterSubtitleHost();
    if (!header?.host || !header.title) return;
    const subtitle = header.host;
    if (!header.isMobile) {
      subtitle.classList.add("dltracker-buy-later-subtitle");
    }

    let controls = header.isMobile
      ? subtitle.querySelector(":scope > .dltracker-buy-later-controls")
      : subtitle.querySelector(".dltracker-buy-later-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "dltracker-buy-later-controls";

      const toggle = document.createElement("label");
      toggle.className = "dltracker-buy-later-toggle";

      const input = document.createElement("input");
      input.type = "checkbox";

      const text = document.createElement("span");
      text.textContent = "启用排序";

      toggle.appendChild(input);
      toggle.appendChild(text);

      const modeWrap = document.createElement("label");
      modeWrap.className = "dltracker-buy-later-mode";

      const modeLabel = document.createElement("span");
      modeLabel.textContent = "排序方式";

      const modeSelect = document.createElement("select");
      modeSelect.className = "dltracker-buy-later-mode-select";
      modeSelect.innerHTML = `
        <option value="${BUY_LATER_SORT_MODE_REACH}">最高可达到折扣</option>
        <option value="${BUY_LATER_SORT_MODE_PRICE}">理论低价优先</option>
        <option value="${BUY_LATER_SORT_MODE_PLATFORM_EXPIRY}">平台折扣失效时间</option>
      `;

      const updateState = () => {
        modeSelect.disabled = !input.checked;
        modeWrap.classList.toggle("is-disabled", modeSelect.disabled);
      };

      input.addEventListener("change", () => {
        const enabled = Boolean(input.checked);
        setBuyLaterSortEnabled(enabled);
        updateState();
        if (enabled) {
          stampBuyLaterOriginalOrder();
          void sortBuyLaterItems();
        } else {
          restoreBuyLaterOriginalOrder();
        }
      });

      modeSelect.addEventListener("change", () => {
        setBuyLaterSortMode(modeSelect.value);
        if (input.checked) {
          void sortBuyLaterItems();
        }
      });

      modeWrap.appendChild(modeLabel);
      modeWrap.appendChild(modeSelect);

      const filterWrap = document.createElement("label");
      filterWrap.className = "dltracker-buy-later-filter";

      const filterLabel = document.createElement("span");
      filterLabel.textContent = "凑单优惠";

      const filterSelect = document.createElement("select");
      filterSelect.className = "dltracker-buy-later-filter-select";
      filterSelect.innerHTML = `
        <option value="all">全部作品</option>
        <option value="bundle">所有需要凑单的优惠</option>
      `;
      filterSelect.addEventListener("change", () => {
        setBrowseBundleFilter(filterSelect.value);
        void sortBuyLaterItems();
      });

      filterWrap.appendChild(filterLabel);
      filterWrap.appendChild(filterSelect);

      controls.appendChild(toggle);
      controls.appendChild(modeWrap);
      controls.appendChild(filterWrap);
      if (header.isMobile) {
        header.title.insertAdjacentElement("afterend", controls);
      } else {
        subtitle.appendChild(controls);
      }
    } else if (
      header.isMobile &&
      (controls.parentElement !== subtitle ||
        controls.previousElementSibling !== header.title)
    ) {
      header.title.insertAdjacentElement("afterend", controls);
    }

    const input = controls.querySelector(
      '.dltracker-buy-later-toggle input[type="checkbox"]',
    );
    const modeSelect = controls.querySelector(
      ".dltracker-buy-later-mode-select",
    );
    const modeWrap = controls.querySelector(".dltracker-buy-later-mode");
    const filterSelect = controls.querySelector(
      ".dltracker-buy-later-filter-select",
    );

    if (input) {
      input.checked = isBuyLaterSortEnabled();
    }
    if (modeSelect) {
      modeSelect.value = getBuyLaterSortMode();
      modeSelect.disabled = !(input?.checked ?? true);
    }
    if (modeWrap && modeSelect) {
      modeWrap.classList.toggle("is-disabled", modeSelect.disabled);
    }
    if (filterSelect && !filterSelect.value) {
      filterSelect.value = "all";
    }
  }

  function getCartOwnerItem(item) {
    return item?.closest("li.cart_list_item, li.n_work_list_item") || item;
  }

  function getBuyLaterOwnerItems() {
    const rawItems = getCartItems().filter(
      (item) => isRenderableCartItem(item) && isBuyLaterCartItem(item),
    );
    if (!rawItems.length) return [];

    const ownerItems = [];
    const seenOwners = new Set();
    for (const item of rawItems) {
      const owner = getCartOwnerItem(item);
      if (!owner || seenOwners.has(owner)) continue;
      seenOwners.add(owner);
      ownerItems.push(owner);
    }

    return ownerItems;
  }

  function buyLaterBrowseCards(ownerItems = getBuyLaterOwnerItems()) {
    return ownerItems.map((node) => ({
      id: extractRjCodeFromCartItem(node),
      node,
    })).filter(({ id }) => Boolean(id));
  }

  function applyBuyLaterBundleFilter(ownerItems) {
    const cards = buyLaterBrowseCards(ownerItems);
    const laterNodes = new Set(cards.map(({ node }) => node));
    for (const node of document.querySelectorAll(
      ".dltracker-buy-later-filtered-out",
    )) {
      if (!laterNodes.has(node)) {
        node.classList.remove("dltracker-buy-later-filtered-out");
      }
    }
    const hasInsights = cards.some(({ id }) =>
      dealInsightById.has(String(id).toUpperCase()));
    if (!hasInsights) return;

    const filter = document.querySelector(
      ".dltracker-buy-later-filter-select",
    );
    syncBundleFilterSelect(filter, cards);
    const selected = getBrowseBundleFilter();
    for (const { id, node } of cards) {
      const insight = dealInsightById.get(String(id).toUpperCase());
      node.classList.toggle(
        "dltracker-buy-later-filtered-out",
        !browseCardMatchesFilter(insight, selected),
      );
    }
  }

  function stampBuyLaterOriginalOrder() {
    const ownerItems = getBuyLaterOwnerItems();
    if (!ownerItems.length) return;

    const parentCounters = new Map();
    for (const owner of ownerItems) {
      const parent = owner.parentElement;
      if (!parent) continue;

      const current = parentCounters.get(parent) || 0;
      if (!owner.dataset.dltrackerBuyLaterOrder) {
        owner.dataset.dltrackerBuyLaterOrder = String(current);
      }
      parentCounters.set(parent, current + 1);
    }
  }

  function restoreBuyLaterOriginalOrder() {
    if (!isCartPage(location.href)) return;

    stampBuyLaterOriginalOrder();
    const ownerItems = getBuyLaterOwnerItems();
    if (!ownerItems.length) return;

    const grouped = new Map();
    for (const owner of ownerItems) {
      const parent = owner.parentElement;
      if (!parent) continue;

      const parsed = Number(owner.dataset.dltrackerBuyLaterOrder);
      const order = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;

      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push({ node: owner, order });
    }

    for (const [parent, entries] of grouped.entries()) {
      entries.sort((a, b) => a.order - b.order);
      for (const entry of entries) {
        parent.appendChild(entry.node);
      }
    }
  }

  function cartProductArea(item) {
    const owner = getCartOwnerItem(item);
    const anchor = owner || item;
    if (!anchor) return "unknown";

    if (anchor.matches?.(BUY_LATER_AREA_SELECTOR) ||
      anchor.closest?.(BUY_LATER_AREA_SELECTOR)) {
      return "later";
    }
    if (anchor.matches?.(BUY_NOW_AREA_SELECTOR) ||
      anchor.closest?.(BUY_NOW_AREA_SELECTOR)) {
      return "active";
    }

    let sawActive = false;
    let cursor = anchor;
    for (let depth = 0; cursor && depth < 12; depth += 1) {
      const marker = [
        cursor.id,
        typeof cursor.className === "string" ? cursor.className : "",
        cursor.getAttribute?.("data-cart-area"),
        cursor.getAttribute?.("data-area"),
      ].filter(Boolean).join(" ");
      const resolved = cartAreaFromMarkerText(marker);
      if (resolved === "later") return "later";
      if (resolved === "active") sawActive = true;
      cursor = cursor.parentElement;
    }
    return sawActive ? "active" : "unknown";
  }

  function isBuyLaterCartItem(item) {
    return cartProductArea(item) === "later";
  }

  function isBuyNowCartItem(item) {
    return cartProductArea(item) === "active";
  }

  function getRecordCompareCurrentPrice(record) {
    return (
      safeNumber(record?.dlwatcherCurrentPrice) ??
      safeNumber(record?.currentPrice)
    );
  }

  function isRecordNewLowest(record, currentPrice) {
    const compareCurrent = safeNumber(currentPrice) ??
      getRecordCompareCurrentPrice(record);
    const lowestPrice = safeNumber(record?.lowestPrice);
    if (typeof compareCurrent !== "number" || typeof lowestPrice !== "number") {
      return false;
    }
    return (
      compareCurrent <= lowestPrice + 0.01
    );
  }

  async function sortBuyLaterItems() {
    if (!isCartPage(location.href)) return;

    stampBuyLaterOriginalOrder();
    const ownerItems = getBuyLaterOwnerItems();
    if (!ownerItems.length) return;
    applyBuyLaterBundleFilter(ownerItems);
    if (!isBuyLaterSortEnabled()) {
      restoreBuyLaterOriginalOrder();
      return;
    }
    const sortMode = getBuyLaterSortMode();

    const grouped = new Map();
    for (const owner of ownerItems) {
      const parent = owner.parentElement;
      if (!parent) continue;

      const rjCode = extractRjCodeFromCartItem(owner);
      const record = rjCode ? await getPriceRecord(rjCode) : null;
      const insight = rjCode
        ? dealInsightById.get(String(rjCode).toUpperCase())
        : null;
      const isNewLowest = isRecordNewLowest(record, insight?.product?.price);
      const reachRank = dealNumber(insight?.bestReach?.totalRate, -1);
      const hypotheticalPrice = reachRank >= 0
        ? calculateHypotheticalPrice(insight?.product, insight?.bestReach)
        : Number.POSITIVE_INFINITY;
      const platformDiscountExpiry = platformDiscountExpiryMillis(insight?.product);
      const originalOrder = Number(owner.dataset.dltrackerBuyLaterOrder);

      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push({
        node: owner,
        isNewLowest,
        reachRank,
        hypotheticalPrice,
        platformDiscountExpiry,
        order: Number.isFinite(originalOrder)
          ? originalOrder
          : grouped.get(parent).length,
      });
    }

    for (const [parent, entries] of grouped.entries()) {
      entries.sort((a, b) => compareDealSortEntries(a, b, sortMode));

      for (const entry of entries) {
        parent.appendChild(entry.node);
      }
    }
  }

  function parseCurrentPrice() {
    const candidates = [
      document.querySelector(".c-purchaseBox__priceInfo .app-price"),
      document.querySelector(".c-purchaseBox__priceInfo .c-purchaseBox__value"),
      findProductPriceHost(),
      document.querySelector(".work_price_wrap"),
      document.querySelector('[class*="work_price"]'),
    ].filter(Boolean);

    for (const target of candidates) {
      const cleaned = (target.textContent || "").replace(/,/g, "");
      // 仅采集日元价格；RMB 等本地化货币不写入 currentPrice，避免与日元史低混比
      if (/rmb|usd|eur/i.test(cleaned)) continue;
      const matched = cleaned.match(/(\d{1,8}(?:\.\d{1,2})?)\s*(円|jpy)/i);
      if (matched) return Number(matched[1]);
    }

    return undefined;
  }

  function parseTitle() {
    const h1 =
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector(".work_name")?.textContent?.trim() ||
      document.querySelector('[class*="title"]')?.textContent?.trim();
    return h1 || document.title;
  }

  function isValidRjCode(code) {
    return typeof code === "string" && /^[RB]J\d{6,}$/i.test(code);
  }

  function isValidProductCode(code) {
    return typeof code === "string" && /^[RBV]J\d{6,}$/i.test(code);
  }

  function isCacheFresh(record) {
    if (!record?.lastChecked) return false;
    const checkedAt = new Date(record.lastChecked).getTime();
    return Number.isFinite(checkedAt) && Date.now() - checkedAt < CACHE_TTL_MS;
  }

  function hasUsableLowestPrice(record) {
    return typeof record?.lowestPrice === "number";
  }

  async function getReusablePriceRecord(rjCode) {
    if (!isValidRjCode(rjCode)) return null;
    const record = await getPriceRecord(String(rjCode).toUpperCase());
    if (!record) return null;
    const reusable = record.isFavorite || isCacheFresh(record);
    if (!reusable || !hasUsableLowestPrice(record)) return null;
    return record;
  }

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PRICES)) {
          db.createObjectStore(STORE_PRICES, { keyPath: "rjCode" });
        }
        if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
          db.createObjectStore(STORE_FAVORITES, { keyPath: "rjCode" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("IndexedDB open failed"));
    });

    return dbPromise;
  }

  async function storeGet(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error(`IDB get failed: ${storeName}`));
    });
  }

  async function storePut(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error(`IDB put failed: ${storeName}`));
    });
  }

  async function storeDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error(`IDB delete failed: ${storeName}`));
    });
  }

  async function storeGetAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () =>
        resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () =>
        reject(request.error || new Error(`IDB getAll failed: ${storeName}`));
    });
  }

  async function storeGetAllKeys(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => {
        const keys = Array.isArray(request.result) ? request.result : [];
        resolve(keys.map((x) => String(x)));
      };
      request.onerror = () =>
        reject(
          request.error || new Error(`IDB getAllKeys failed: ${storeName}`),
        );
    });
  }

  async function getPriceRecord(rjCode) {
    return storeGet(STORE_PRICES, rjCode);
  }

  async function listPriceRecords() {
    return storeGetAll(STORE_PRICES);
  }

  async function listFavoriteCodes() {
    return storeGetAllKeys(STORE_FAVORITES);
  }

  async function upsertPriceRecord(input) {
    const existing = await getPriceRecord(input.rjCode);
    const now = nowIso();

    let merged;
    if (existing) {
      const safeLowest =
        typeof input.lowestPrice === "number"
          ? input.lowestPrice
          : existing.lowestPrice;
      merged = {
        ...existing,
        ...input,
        lowestPrice: Math.min(existing.lowestPrice, safeLowest),
        updatedAt: now,
      };
    } else {
      merged = {
        ...input,
        createdAt: input.createdAt || now,
        updatedAt: input.updatedAt || now,
      };
    }

    await storePut(STORE_PRICES, merged);
  }

  async function markFavorites(rjCodes) {
    const now = nowIso();
    for (const rjCode of rjCodes) {
      await storePut(STORE_FAVORITES, { rjCode, addedAt: now });
      const existing = await getPriceRecord(rjCode);
      if (existing) {
        await upsertPriceRecord({
          ...existing,
          isFavorite: true,
          favoriteAddedAt: existing.favoriteAddedAt || now,
          updatedAt: now,
        });
      }
    }
  }

  async function clearFavoriteFlagForMissing(nextFavoriteSet) {
    const all = await listPriceRecords();
    const now = nowIso();
    for (const record of all) {
      if (record.isFavorite && !nextFavoriteSet.has(record.rjCode)) {
        await upsertPriceRecord({
          ...record,
          isFavorite: false,
          updatedAt: now,
        });
      }
    }

    const favoriteKeys = await listFavoriteCodes();
    for (const code of favoriteKeys) {
      if (!nextFavoriteSet.has(code)) {
        await storeDelete(STORE_FAVORITES, code);
      }
    }
  }

  async function deletePriceRecord(rjCode) {
    await storeDelete(STORE_PRICES, rjCode);
  }

  async function listNonFavoriteRecords() {
    const all = await listPriceRecords();
    return all.filter((record) => !record.isFavorite);
  }

  function buildApiUrl(rjCode) {
    return `${DLWATCHER_BASE}/${rjCode}.json`;
  }

  function buildDlwatcherPageUrl(rjCode) {
    return `${DLWATCHER_BASE}/${rjCode}/`;
  }

  function extractDlwatcherCurrentPrice(json) {
    const candidates = [
      json?.currentPrice?.priceInfo?.price,
      json?.currentPrice?.priceInfo?.currentPrice,
      json?.currentPrice?.priceInfo?.value,
      json?.currentPrice?.price,
      json?.currentPrice?.amount,
      json?.currentPrice?.value,
      json?.currentPrice,
      json?.priceInfo?.price,
      json?.priceInfo?.currentPrice,
      json?.price?.current,
      json?.price?.price,
      json?.price?.amount,
      json?.price,
    ];

    for (const item of candidates) {
      const parsed = parseNumberish(item);
      if (typeof parsed === "number") return parsed;
    }
    return undefined;
  }

  function hasDlwatcherCreatorData(record) {
    return Array.isArray(record?.voiceActors);
  }

  function isRetryableFetchError(error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    return /timeout|failed|HTTP 429|HTTP 5\d{2}/i.test(message);
  }

  function gmRequestJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest is unavailable"));
        return;
      }

      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: timeoutMs,
        headers: {
          Accept: "application/json",
        },
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(
              error instanceof Error ? error : new Error("JSON parse failed"),
            );
          }
        },
        ontimeout: () => reject(new Error("Request timeout")),
        onerror: () => reject(new Error("Request failed")),
      });
    });
  }

  async function fetchPriceFromDlwatcher(rjCode) {
    let attempt = 0;
    while (attempt <= RETRYABLE_FETCH_ATTEMPTS) {
      try {
        const json = await gmRequestJson(
          buildApiUrl(rjCode),
          REQUEST_TIMEOUT_MS,
        );
        const lowestPrice =
          safeNumber(json?.lowestPrice?.priceInfo?.price) ?? null;
        return {
          rjCode,
          title:
            typeof json?.productName === "string"
              ? json.productName
              : undefined,
          dlwatcherCurrentPrice: extractDlwatcherCurrentPrice(json),
          lowestPrice,
          regularPrice: safeNumber(json?.lowestPrice?.priceInfo?.regularPrice),
          discountRate: safeNumber(json?.lowestPrice?.priceInfo?.discountRate),
          voiceActors: extractVoiceActorNames(json),
          dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
        };
      } catch (error) {
        if (
          attempt < RETRYABLE_FETCH_ATTEMPTS &&
          isRetryableFetchError(error)
        ) {
          attempt += 1;
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        console.warn(`[${APP_NAME}] fetch ${rjCode} failed:`, error);
        return {
          rjCode,
          lowestPrice: null,
          dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
        };
      }
    }

    return {
      rjCode,
      lowestPrice: null,
      dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
    };
  }

  async function batchFetchPrices(rjCodes) {
    const result = new Map();
    for (let i = 0; i < rjCodes.length; i += BATCH_SIZE) {
      const batch = rjCodes.slice(i, i + BATCH_SIZE);
      const prices = await Promise.all(
        batch.map((code) => fetchPriceFromDlwatcher(code)),
      );
      for (const item of prices) result.set(item.rjCode, item);
      if (i + BATCH_SIZE < rjCodes.length) {
        await sleep(BATCH_INTERVAL_MS);
      }
    }
    return result;
  }

  async function syncCurrentPrice(existing, currentPrice) {
    if (typeof currentPrice !== "number") return existing;
    if (currentPrice === existing.currentPrice) return existing;

    const next = { ...existing, currentPrice, updatedAt: nowIso() };
    await upsertPriceRecord(next);
    return next;
  }

  async function fetchRemoteAndPersist(
    rjCode,
    title,
    currentPrice,
    existing,
    forcePersist,
    fallbackRjCodes = [],
    resolveFallbackRjCode,
  ) {
    const queryCodes = [];
    const pushCode = (value) => {
      if (!isValidRjCode(value)) return;
      const code = String(value).toUpperCase();
      if (queryCodes.includes(code)) return;
      queryCodes.push(code);
    };
    pushCode(rjCode);
    for (const code of fallbackRjCodes) pushCode(code);

    let fetched = null;
    let resolvedRjCode = rjCode;

    for (const code of queryCodes) {
      const cached = await getReusablePriceRecord(code);
      if (cached && hasDlwatcherCreatorData(cached)) {
        fetched = {
          rjCode: code,
          title: cached.title,
          dlwatcherCurrentPrice: cached.dlwatcherCurrentPrice,
          lowestPrice: cached.lowestPrice,
          regularPrice: cached.regularPrice,
          discountRate: cached.discountRate,
          voiceActors: cached.voiceActors,
          dlwatcherUrl: cached.dlwatcherUrl || buildDlwatcherPageUrl(code),
        };
        resolvedRjCode = code;
        break;
      }

      const item = await fetchPriceFromDlwatcher(code);
      if (item.lowestPrice === null) continue;
      fetched = item;
      resolvedRjCode = code;
      break;
    }

    if (!fetched && typeof resolveFallbackRjCode === "function") {
      const resolved = await resolveFallbackRjCode();
      if (isValidRjCode(resolved) && !queryCodes.includes(resolved)) {
        const cached = await getReusablePriceRecord(resolved);
        if (cached && hasDlwatcherCreatorData(cached)) {
          fetched = {
            rjCode: resolved,
            title: cached.title,
            dlwatcherCurrentPrice: cached.dlwatcherCurrentPrice,
            lowestPrice: cached.lowestPrice,
            regularPrice: cached.regularPrice,
            discountRate: cached.discountRate,
            voiceActors: cached.voiceActors,
            dlwatcherUrl:
              cached.dlwatcherUrl || buildDlwatcherPageUrl(resolved),
          };
          resolvedRjCode = resolved;
        } else {
          const item = await fetchPriceFromDlwatcher(resolved);
          if (item.lowestPrice !== null) {
            fetched = item;
            resolvedRjCode = resolved;
          }
        }
      }
    }

    if (!fetched) {
      if (existing) {
        const next = {
          ...existing,
          lastChecked: nowIso(),
          updatedAt: nowIso(),
        };
        await upsertPriceRecord(next);
        return next;
      }
      return null;
    }

    const favoriteSet = new Set(await listFavoriteCodes());
    const record = {
      rjCode,
      title:
        existing?.title && existing.title !== rjCode
          ? existing.title
          : fetched.title || title || rjCode,
      currentPrice,
      dlwatcherCurrentPrice:
        fetched.dlwatcherCurrentPrice ?? existing?.dlwatcherCurrentPrice,
      lowestPrice: existing
        ? Math.min(existing.lowestPrice, fetched.lowestPrice)
        : fetched.lowestPrice,
      sourceRjCode: resolvedRjCode,
      regularPrice: fetched.regularPrice,
      discountRate: fetched.discountRate,
      voiceActors: fetched.voiceActors ?? existing?.voiceActors ?? [],
      lastChecked: nowIso(),
      dlwatcherUrl: fetched.dlwatcherUrl,
      isFavorite: Boolean(existing?.isFavorite || favoriteSet.has(rjCode)),
      favoriteAddedAt: existing?.favoriteAddedAt,
      tags: existing?.tags || [],
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };

    // 与扩展版一致：收藏记录和普通浏览记录都写入本地，用作 24h 缓存。
    // forcePersist 参数保留用于后续扩展能力，当前逻辑统一持久化。
    void forcePersist;
    await upsertPriceRecord(record);

    return record;
  }

  async function buildOrUpdateRecord(params) {
    const normalizedRjCode = String(params?.rjCode || "").toUpperCase();
    if (!isValidRjCode(normalizedRjCode)) return null;

    const inFlight = recordInFlight.get(normalizedRjCode);
    if (inFlight) return inFlight;

    const task = (async () => {
      const {
        title = normalizedRjCode,
        currentPrice,
        forceFetch = false,
        forcePersist = false,
        fallbackRjCodes = [],
        resolveFallbackRjCode,
      } = params;

      const existing = await getPriceRecord(normalizedRjCode);
      if (forceFetch) {
        return fetchRemoteAndPersist(
          normalizedRjCode,
          title,
          currentPrice,
          existing,
          forcePersist,
          fallbackRjCodes,
          resolveFallbackRjCode,
        );
      }

      if (existing) {
        const cacheReusable = existing.isFavorite || isCacheFresh(existing);
        if (cacheReusable && hasUsableLowestPrice(existing) &&
          hasDlwatcherCreatorData(existing)) {
          return syncCurrentPrice(existing, currentPrice);
        }
      }

      return fetchRemoteAndPersist(
        normalizedRjCode,
        title,
        currentPrice,
        existing,
        forcePersist,
        fallbackRjCodes,
        resolveFallbackRjCode,
      );
    })();

    recordInFlight.set(normalizedRjCode, task);
    try {
      return await task;
    } finally {
      if (recordInFlight.get(normalizedRjCode) === task) {
        recordInFlight.delete(normalizedRjCode);
      }
    }
  }

  async function handleImportFavorites(rjCodes, skipCache) {
    if (!Array.isArray(rjCodes) || rjCodes.length === 0) return { imported: 0 };

    const codes = rjCodes
      .filter(isValidRjCode)
      .map((code) => code.toUpperCase())
      .slice(0, MAX_FAVORITES);

    if (!codes.length) return { imported: 0 };

    await markFavorites(codes);
    await clearFavoriteFlagForMissing(new Set(codes));

    let imported = 0;
    const staleCodes = [];

    for (const code of codes) {
      if (skipCache) {
        staleCodes.push(code);
        continue;
      }

      const cached = await getPriceRecord(code);
      if (cached && isCacheFresh(cached)) {
        imported += 1;
      } else {
        staleCodes.push(code);
      }
    }

    if (!staleCodes.length) {
      return { imported };
    }

    const prices = await batchFetchPrices(staleCodes);
    for (const rjCode of staleCodes) {
      const fetched = prices.get(rjCode);
      if (!fetched || fetched.lowestPrice === null) {
        const rec = await getPriceRecord(rjCode);
        if (rec) {
          await upsertPriceRecord({
            ...rec,
            lastChecked: nowIso(),
            updatedAt: nowIso(),
          });
        }
        continue;
      }

      const existing = await getPriceRecord(rjCode);
      const record = {
        rjCode,
        title:
          existing?.title && existing.title !== rjCode
            ? existing.title
            : fetched.title || rjCode,
        currentPrice: existing?.currentPrice,
        dlwatcherCurrentPrice:
          fetched.dlwatcherCurrentPrice ?? existing?.dlwatcherCurrentPrice,
        lowestPrice: existing
          ? Math.min(existing.lowestPrice, fetched.lowestPrice)
          : fetched.lowestPrice,
        regularPrice: fetched.regularPrice,
        discountRate: fetched.discountRate,
        voiceActors: fetched.voiceActors ?? existing?.voiceActors ?? [],
        lastChecked: nowIso(),
        dlwatcherUrl: fetched.dlwatcherUrl,
        isFavorite: true,
        favoriteAddedAt: existing?.favoriteAddedAt || nowIso(),
        tags: existing?.tags || [],
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };

      await upsertPriceRecord(record);
      imported += 1;
    }

    return { imported };
  }

  function recordsToCsv(records) {
    const header = [
      "RJ/BJ",
      "Title",
      "CurrentPrice",
      "LowestPrice",
      "RegularPrice",
      "DiscountRate",
      "LastChecked",
      "DlwatcherUrl",
      "IsFavorite",
      "FavoriteAddedAt",
      "UpdatedAt",
    ];

    const lines = [header.map(toCsvCell).join(",")];
    for (const record of records) {
      lines.push(
        [
          record.rjCode,
          record.title || "",
          record.currentPrice,
          record.lowestPrice,
          record.regularPrice,
          record.discountRate,
          record.lastChecked || "",
          record.dlwatcherUrl || "",
          record.isFavorite ? "1" : "0",
          record.favoriteAddedAt || "",
          record.updatedAt || "",
        ]
          .map(toCsvCell)
          .join(","),
      );
    }
    return lines.join("\n");
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderPriceCard(record, host) {
    if (isCartPage(location.href) && host?.classList?.contains("dltracker-cart-host")) {
      if (record?.rjCode) {
        const id = String(record.rjCode).toUpperCase();
        browseRecordById.set(id, record);
        renderCartDealLayout(host, record, dealInsightById.get(id));
      } else {
        host.textContent = "史低获取失败";
      }
      return;
    }
    const existed = host.querySelector(`.${UI_CLASSNAME}`);
    if (existed) existed.remove();

    const card = document.createElement("div");
    card.className = UI_CLASSNAME;
    if (record?.rjCode) card.dataset.productId = record.rjCode;
    if (typeof record?.lowestPrice === "number") {
      card.dataset.lowestPrice = String(record.lowestPrice);
    }
    const isProductDetailPage = isProductPage(location.href);
    if (isProductDetailPage) {
      card.classList.add("dltracker-product-wide");
    }
    if (
      isFavoritePage(location.href) &&
      !isTouchPath(location.href) &&
      !isNarrowViewport()
    ) {
      card.classList.add("dltracker-wishlist-inline");
    }
    if (
      isCartPage(location.href) &&
      !isTouchPath(location.href) &&
      !isNarrowViewport()
    ) {
      card.classList.add("dltracker-cart-inline");
    }

    const chip = document.createElement("span");
    chip.className = "dltracker-chip dltracker-history-chip";

    if (!record) {
      chip.classList.add("dltracker-error");
      chip.textContent = "史低获取失败";
      card.appendChild(chip);
      host.appendChild(card);
      return;
    }

    const compareCurrent =
      typeof record.dlwatcherCurrentPrice === "number"
        ? record.dlwatcherCurrentPrice
        : undefined;
    const isAtLowest =
      typeof compareCurrent === "number" &&
      typeof record.lowestPrice === "number" &&
      Math.abs(compareCurrent - record.lowestPrice) < 0.01;

    const text = document.createElement("span");
    text.className = "dltracker-chip-text";
    const discounted = hasEffectiveDiscount(record);
    chip.classList.add(
      discounted
        ? isAtLowest
          ? "dltracker-chip-hot"
          : "dltracker-chip-normal"
        : "dltracker-chip-current",
    );
    text.textContent = discounted
      ? isAtLowest
        ? `新史低 ${toYen(record.lowestPrice)}`
        : `史低 ${toYen(record.lowestPrice)}`
      : `无折扣记录`;
    chip.appendChild(text);

    const isCartContext = isCartPage(location.href);
    const isMobileCartContext =
      isCartContext && (isTouchPath(location.href) || isNarrowViewport());
    const derivedDiscountRate =
      typeof record.discountRate === "number"
        ? record.discountRate
        : typeof record.regularPrice === "number" &&
            typeof record.lowestPrice === "number" &&
            record.regularPrice > 0
          ? (1 - record.lowestPrice / record.regularPrice) * 100
          : undefined;
    const showOffBadge = discounted;
    if (
      showOffBadge &&
      typeof derivedDiscountRate === "number" &&
      derivedDiscountRate > 0
    ) {
      const offBadge = document.createElement("span");
      offBadge.className = "dltracker-off-badge";
      offBadge.textContent = `${Math.round(derivedDiscountRate)}OFF`;
      chip.appendChild(offBadge);
    }

    card.appendChild(chip);
    const insight = record?.rjCode
      ? dealInsightById.get(String(record.rjCode).toUpperCase())
      : null;
    if (insight?.bestReach?.totalRate > 0) {
      const reachBadge = createBestReachBadge(insight, record.lowestPrice);
      card.appendChild(reachBadge);
      if (insight.singleBuyOptimal) card.appendChild(createSingleBuyBadge());
    }
    if (discounted) {
      const button = document.createElement("a");
      button.className = "dltracker-btn";
      button.textContent = "查看价格趋势";
      button.href = record.dlwatcherUrl;
      button.target = "_blank";
      button.rel = "noopener noreferrer";
      button.addEventListener("click", (event) => event.stopPropagation());
      card.appendChild(button);
    }
    host.appendChild(card);
  }

  function renderLoadingCard(host) {
    if (isCartPage(location.href) && host?.classList?.contains("dltracker-cart-host")) {
      const loading = document.createElement("div");
      loading.className = `${UI_CLASSNAME} dltracker-cart-layout dltracker-cart-layout-loading`;
      const grid = document.createElement("div");
      grid.className = "dltracker-cart-deal-grid";
      [
        ["本次可到", "dltracker-cart-reach"],
        ["史低折扣", "dltracker-cart-history"],
        ["平台折扣", "dltracker-cart-platform"],
      ].forEach(([label, className]) => {
        grid.appendChild(createCartDealPriceFrame({
          className,
          label,
          price: "价格读取中",
          rate: null,
        }));
      });
      for (const [label, className] of [
        ["价格读取中", "dltracker-cart-status is-loading"],
        ["价格趋势", "dltracker-cart-trend"],
      ]) {
        const frame = document.createElement("span");
        frame.className = `dltracker-cart-deal-frame ${className}`;
        frame.textContent = label;
        grid.appendChild(frame);
      }
      loading.appendChild(grid);
      host.replaceChildren(loading);
      return;
    }
    const existed = host.querySelector(`.${UI_CLASSNAME}`);
    if (existed) existed.remove();

    const card = document.createElement("div");
    card.className = UI_CLASSNAME;

    const chip = document.createElement("span");
    chip.className = "dltracker-chip";
    chip.textContent = "史低获取中...";

    card.appendChild(chip);
    host.appendChild(card);
  }

  async function enhanceProductPage() {
    const pathMatch = location.pathname.match(/product_id\/([RB]J\d{6,})/i);
    const rjCode = pathMatch
      ? pathMatch[1].toUpperCase()
      : extractRjCodeFromUrl(location.href);
    if (!rjCode || !isValidRjCode(rjCode)) return;

    const host = findProductRenderHost();
    if (!host) return;

    // 清理旧位置残留的商品页卡片，避免布局策略切换后出现两份 UI。
    const allCards = document.querySelectorAll(`.${UI_CLASSNAME}`);
    for (const card of allCards) {
      if (!host.contains(card)) {
        card.remove();
      }
    }

    renderLoadingCard(host);

    const record = await buildOrUpdateRecord({
      rjCode,
      title: parseTitle(),
      currentPrice: parseCurrentPrice(),
      forceFetch: false,
    });
    renderPriceCard(record, host);
  }

  async function fetchFavoriteCodesFromApi() {
    const url = `${location.origin}${FAVORITE_API_PATH}?_=${Date.now()}`;
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`收藏接口返回异常: ${response.status}`);
    }

    const data = await response.json();
    const favorites = Array.isArray(data?.favorites) ? data.favorites : [];
    return favorites
      .map((x) => (typeof x === "string" ? x.toUpperCase() : ""))
      .filter((x) => RJ_CODE_REGEX.test(x));
  }

  function parseFavoriteCodesFromDom() {
    const links = document.querySelectorAll('a[href*="product_id/"]');
    const codeSet = new Set();
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const matched = href.match(/product_id\/([RB]J\d{6,})/i);
      if (matched) codeSet.add(matched[1].toUpperCase());
    }
    return [...codeSet];
  }

  function createActionButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    return button;
  }

  function removeFavoriteImportBox() {
    const panel = document.querySelector(".dltracker-import-box");
    if (panel) panel.remove();
  }

  function injectFavoriteImportBox() {
    if (document.querySelector(".dltracker-import-box")) return;

    const anchorInfo = findFavoritePanelAnchor();

    const box = document.createElement("div");
    box.className = "dltracker-import-box";

    const text = document.createElement("span");
    text.className = "dltracker-import-title";
    text.textContent = `${APP_NAME}：可导入收藏并抓取史低价`;

    const importBtn = createActionButton("导入收藏");
    const updateBtn = createActionButton("更新收藏价");
    const exportBtn = createActionButton("导出CSV");

    const status = document.createElement("span");
    status.className = "dltracker-import-status";

    importBtn.addEventListener("click", async () => {
      importBtn.disabled = true;
      status.textContent = "正在获取收藏列表...";

      try {
        let codes = parseFavoriteCodesFromDom();
        if (!codes.length) {
          codes = await fetchFavoriteCodesFromApi();
        }

        if (!codes.length) {
          status.textContent = "未获取到收藏作品";
          return;
        }

        status.textContent = `已获取 ${codes.length} 个收藏，正在同步史低...`;
        const result = await handleImportFavorites(codes, false);
        status.textContent = `导入完成：成功同步 ${result.imported} 条`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        status.textContent = `导入失败：${message}`;
      } finally {
        importBtn.disabled = false;
      }
    });

    updateBtn.addEventListener("click", async () => {
      updateBtn.disabled = true;
      status.textContent = "正在更新全部收藏...";

      try {
        const favoriteCodes = await listFavoriteCodes();
        if (!favoriteCodes.length) {
          status.textContent = "本地暂无收藏记录，请先导入收藏";
          return;
        }

        const result = await handleImportFavorites(favoriteCodes, true);
        status.textContent = `更新完成：成功同步 ${result.imported} 条`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        status.textContent = `更新失败：${message}`;
      } finally {
        updateBtn.disabled = false;
      }
    });

    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      status.textContent = "正在导出 CSV...";

      try {
        const records = (await listPriceRecords())
          .filter((record) => record.isFavorite)
          .sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
          );

        const csv = recordsToCsv(records);
        const fileName = `dltracker-userscript-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadText(fileName, csv, "text/csv;charset=utf-8;");
        status.textContent = `CSV 导出完成：${records.length} 条`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        status.textContent = `导出失败：${message}`;
      } finally {
        exportBtn.disabled = false;
      }
    });

    box.appendChild(text);
    box.appendChild(importBtn);
    box.appendChild(updateBtn);
    box.appendChild(exportBtn);
    box.appendChild(status);

    if (anchorInfo.before) {
      anchorInfo.parent.insertBefore(box, anchorInfo.before);
    } else {
      anchorInfo.parent.prepend(box);
    }
  }

  async function enhanceWishlistCards() {
    const cards = getWishlistCards();
    if (!cards.length) return;

    for (const card of cards) {
      const priceHost = findWishlistPriceHost(card);
      if (!priceHost) continue;
      const renderHost = ensureWishlistRenderHost(card, priceHost);
      if (renderHost.querySelector(`.${UI_CLASSNAME}`)) continue;

      const link = card.querySelector('a[href*="product_id/"]');
      const href = link?.getAttribute("href") || "";
      const matched = href.match(/product_id\/([RB]J\d{6,})/i);
      if (!matched) continue;

      const rjCode = matched[1].toUpperCase();
      const title = link?.textContent?.trim() || rjCode;

      renderLoadingCard(renderHost);

      void buildOrUpdateRecord({
        rjCode,
        title,
        forceFetch: false,
      }).then((record) => renderPriceCard(record, renderHost));
    }
  }

  async function enhanceCartItems() {
    document.querySelector(".dltracker-deal-planner")?.remove();
    injectBuyLaterSortToggle();

    const items = getCartItems();
    if (!items.length) return;

    const tasks = [];
    for (const item of items) {
      if (!isRenderableCartItem(item)) continue;
      const renderHost = ensureCartRenderHost(item);
      if (!renderHost) continue;
      const existedCard = renderHost.querySelector(`.${UI_CLASSNAME}`);
      if (existedCard && !existedCard.querySelector(".dltracker-error")) {
        continue;
      }

      const rjCode = extractRjCodeFromCartItem(item);
      if (!rjCode) continue;
      if (!isValidRjCode(rjCode)) continue;

      const title =
        item.querySelector(".work_name a")?.textContent?.trim() ||
        item.querySelector(".n_work_name a")?.textContent?.trim() ||
        item.querySelector('a[href*="product_id/"]')?.textContent?.trim() ||
        rjCode;
      const productHref =
        item.querySelector('a[href*="product_id/"]')?.getAttribute("href") ||
        "";
      const fallbackRjCodes = extractFallbackRjCodesFromCartItem(item, rjCode);

      renderLoadingCard(renderHost);
      tasks.push({
        rjCode,
        title,
        renderHost,
        fallbackRjCodes,
        productHref,
      });
    }

    if (!tasks.length) {
      await sortBuyLaterItems();
      injectCartLanguageEntries();
      return;
    }

    await mapWithConcurrency(tasks, CART_RENDER_CONCURRENCY, async (task) => {
      try {
        const record = await buildOrUpdateRecord({
          rjCode: task.rjCode,
          title: task.title,
          forceFetch: false,
          fallbackRjCodes: task.fallbackRjCodes,
          resolveFallbackRjCode: () =>
            resolveCanonicalRjCodeFromProductHref(task.productHref),
        });
        const displayRecord = record || { rjCode: task.rjCode };
        browseRecordById.set(String(task.rjCode).toUpperCase(), displayRecord);
        renderPriceCard(displayRecord, task.renderHost);
      } catch (error) {
        console.warn(`[${APP_NAME}] cart render failed:`, error);
        const displayRecord = { rjCode: task.rjCode };
        browseRecordById.set(String(task.rjCode).toUpperCase(), displayRecord);
        renderPriceCard(displayRecord, task.renderHost);
      }
    });

    await sortBuyLaterItems();
    injectCartLanguageEntries();
  }

  function queueCartBootstrap() {
    let timer = null;
    return () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void bootstrap();
      }, 120);
    };
  }

  const scheduleCartBootstrap = queueCartBootstrap();

  function maybeBootstrapForCartMutation(currentUrl) {
    if (!isCartPage(currentUrl)) return false;
    const cartSnapshot = cartSnapshotFromRoot(document);
    const nextFingerprint = cartSnapshotFingerprint(cartSnapshot);
    const hadFingerprint = Boolean(lastCartSnapshotFingerprint);
    const thresholdChanged = hadFingerprint &&
      nextFingerprint !== lastCartSnapshotFingerprint;
    const shouldSave = !hadFingerprint || thresholdChanged;
    lastCartSnapshotFingerprint = nextFingerprint;
    if (shouldSave) {
      saveCartSnapshot(cartSnapshot);
      updateAccountIndexCart(
        cartSnapshot.active.map((item) => item.id),
        cartSnapshot.later.map((item) => item.id),
      );
    }
    if (thresholdChanged) {
      scheduleCartBootstrap();
      return true;
    }
    const items = getCartItems();
    if (
      items.some(
        (item) =>
          isRenderableCartItem(item) &&
          (!item.querySelector(`.${UI_CLASSNAME}`) ||
            needsDealProcessing(item)),
      )
    ) {
      scheduleCartBootstrap();
      return true;
    }
    const recommendationCards = collectBrowseCards().filter(
      ({ cartRecommendation }) => cartRecommendation,
    );
    if (recommendationCards.some(({ id, node }) =>
      !node.querySelector(`.${UI_CLASSNAME}`) ||
      needsDealProcessing(node, id))) {
      scheduleCartBootstrap();
    }
    return true;
  }

  function maybeBootstrapForWishlistMutation(currentUrl) {
    if (!isFavoritePage(currentUrl)) return false;
    const cards = getWishlistCards();
    if (cards.some((card) =>
      !card.querySelector(`.${UI_CLASSNAME}`) ||
      needsDealProcessing(card),
    )) {
      void bootstrap();
    }
    return true;
  }

  async function cleanExpiredCache() {
    const nonFavorites = await listNonFavoriteRecords();
    for (const record of nonFavorites) {
      if (!isCacheFresh(record)) {
        await deletePriceRecord(record.rjCode);
      }
    }
  }

  function waitForElement(url) {
    const checker = isProductPage(url)
      ? () => hasProductContainer()
      : isFavoritePage(url)
        ? () => hasWishlistContainer()
        : isCartPage(url)
          ? () => hasCartContainer()
          : null;
    if (!checker) return Promise.resolve();

    return new Promise((resolve) => {
      if (checker()) {
        resolve();
        return;
      }

      const observer = new MutationObserver(() => {
        if (checker()) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000);
    });
  }

  async function bootstrap() {
    const url = location.href;
    document.querySelector(".dltracker-deal-planner")?.remove();
    if (isProductPage(url) || isCartPage(url)) {
      document.querySelector(".dltracker-browse-controls")?.remove();
      for (const node of document.querySelectorAll(".dltracker-browse-filtered-out")) {
        node.hidden = false;
        node.classList.remove("dltracker-browse-filtered-out");
      }
    }
    try {
      localStorage.removeItem(DEAL_PLANNER_STORAGE_KEY);
    } catch {
    }
    if (!isProductPage(url) && !isCartPage(url)) {
      // 不等待优惠券、购物车快照或史低请求，作品一览先显示控件。
      injectBrowseControls(false);
    }
    if (isProductPage(url)) {
      await enhanceProductPage();
    }
    if (isFavoritePage(url)) {
      if (ENABLE_WISHLIST_ACTION_PANEL) {
        injectFavoriteImportBox();
      } else {
        removeFavoriteImportBox();
      }
      await enhanceWishlistCards();
    }
    if (isCartPage(url)) {
      document.querySelector(".dltracker-cart-diagnostic")?.remove();
      if (ENABLE_CART_DIAGNOSTIC_PANEL) injectCartDiagnosticPanel();
      if (!lastCartSnapshotFingerprint) {
        lastCartSnapshotFingerprint = cartSnapshotFingerprint(
          cartSnapshotFromRoot(document),
        );
      }
      await enhanceCartItems();
    }
    await enhanceDealInsights();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.${UI_CLASSNAME} {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  max-width: 100%;
  box-sizing: border-box;
}

.${UI_CLASSNAME}.dltracker-product-wide {
  width: 100%;
  align-items: stretch;
}

.${UI_CLASSNAME}.dltracker-product-wide .dltracker-chip,
.${UI_CLASSNAME}.dltracker-product-wide .dltracker-btn {
  width: 100%;
  justify-content: center;
  text-align: center;
  box-sizing: border-box;
}

.${UI_CLASSNAME}.dltracker-wishlist-inline {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  margin-top: -10px;
  margin-bottom: 10px;
}

.${UI_CLASSNAME}.dltracker-wishlist-inline .dltracker-chip,
.${UI_CLASSNAME}.dltracker-wishlist-inline .dltracker-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}

.${UI_CLASSNAME}.dltracker-cart-inline {
  flex-direction: column;
  align-items: flex-start;
  flex-wrap: nowrap;
  margin-top: 6px;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip,
.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-btn {
  flex: 0 0 auto;
  width: fit-content;
  max-width: 100%;
  white-space: nowrap;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-current {
  width: 100%;
  align-self: stretch;
  justify-content: center;
  text-align: center;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-normal,
.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-hot {
  width: 100%;
  align-self: stretch;
  box-sizing: border-box;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-normal {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-hot {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-normal .dltracker-chip-text,
.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-chip-hot .dltracker-chip-text {
  width: 100%;
  text-align: center;
}

.${UI_CLASSNAME}.dltracker-cart-inline .dltracker-off-badge {
  margin-top: 0;
}

.${UI_CLASSNAME} .dltracker-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  padding: 4px 4px 4px 2px;
  border-radius: 6px;
  color: #fff;
  background: #2f7e49;
  box-sizing: border-box;
  word-break: break-word;
}

.${UI_CLASSNAME} .dltracker-chip-hot {
  background: #d4571a;
}

.${UI_CLASSNAME} .dltracker-chip-current {
  background: #4c6379;
}

.${UI_CLASSNAME} .dltracker-chip-normal {
  background: #2f7e49;
}

.${UI_CLASSNAME} .dltracker-chip-text {
  line-height: 1.25;
}

.${UI_CLASSNAME} .dltracker-off-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  font-size: 11px;
  letter-spacing: 0.2px;
  line-height: 1.2;
  white-space: nowrap;
}

.${UI_CLASSNAME} .dltracker-best-reach-badge {
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
  cursor: pointer;
}

.dltracker-single-buy-badge {
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 999px;
  background: #dff4e7;
  color: #24623b;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.3;
  box-sizing: border-box;
}

.${UI_CLASSNAME} .dltracker-best-reach-gold {
  background: #e4ad2f;
  color: #4b2d00;
}

.${UI_CLASSNAME} .dltracker-best-reach-gold .dltracker-off-badge {
  background: rgba(95, 57, 0, 0.18);
}

.${UI_CLASSNAME} .dltracker-best-reach-bluegray {
  background: #587187;
  color: #fff;
}

.${UI_CLASSNAME}.dltracker-wishlist-inline > .dltracker-best-reach-badge {
  flex-basis: 100%;
}

.${UI_CLASSNAME}.dltracker-product-wide > .dltracker-best-reach-badge {
  width: 100%;
  justify-content: center;
}

.${UI_CLASSNAME}.dltracker-product-wide > .dltracker-single-buy-badge {
  width: 100%;
  text-align: center;
}

.dltracker-jpy-price {
  display: inline-block;
  margin-left: 5px;
  color: #666;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.dltracker-voice-actors {
  margin-top: 3px;
  color: #59666e;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.dltracker-voice-label {
  margin-right: 2px;
  color: #59666e;
  font-size: 11px;
}

.dltracker-browse-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  width: 100%;
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px solid #d8e0e5;
  border-radius: 8px;
  background: #f8fafb;
  box-sizing: border-box;
  color: #55636c;
  font-size: 12px;
}

.dltracker-browse-controls label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dltracker-browse-controls select {
  max-width: min(68vw, 290px);
  height: 28px;
  border: 1px solid #bdc9d0;
  border-radius: 6px;
  background: #fff;
  color: #34434c;
  font-size: 12px;
}

.dltracker-account-info-button,
.dltracker-hide-purchased-button,
.dltracker-hide-carted-button,
.dltracker-account-refresh,
.dltracker-language-entry-button,
.dltracker-language-table button,
.dltracker-language-retry {
  border: 1px solid #aebdc6;
  border-radius: 6px;
  background: #fff;
  color: #344b58;
  cursor: pointer;
  font: inherit;
}

.dltracker-account-info-button {
  min-height: 28px;
  padding: 3px 10px;
}

.dltracker-hide-purchased-button,
.dltracker-hide-carted-button {
  min-height: 28px;
  padding: 3px 10px;
}

.dltracker-account-info-button:hover,
.dltracker-account-refresh:hover,
.dltracker-language-entry-button:hover,
.dltracker-language-table button:hover,
.dltracker-language-retry:hover {
  border-color: #52758a;
  background: #f2f7fa;
}

.dltracker-account-info-button:disabled,
.dltracker-account-refresh:disabled,
.dltracker-language-entry-button:disabled,
.dltracker-language-table button:disabled {
  cursor: default;
  opacity: 0.58;
}

.dltracker-browse-filtered-out {
  display: none !important;
}

.${DEAL_INSIGHT_CLASSNAME} {
  width: 100%;
  margin-top: 5px;
  box-sizing: border-box;
  color: #444;
  font-size: 11px;
  line-height: 1.45;
}

.dltracker-browse-analysis-host {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  clear: both;
  container-type: inline-size;
  overflow: hidden;
}

.n_work_item > .dltracker-browse-analysis-host,
dl > .dltracker-browse-analysis-host {
  grid-column: 1 / -1;
  width: auto;
  max-width: 100%;
  align-self: stretch;
}

.${UI_CLASSNAME}.dltracker-browse-analysis {
  width: 100%;
  max-width: 100%;
  margin: 5px 0 0;
  gap: 4px;
  color: #40515b;
  font-size: 8px;
}

.dltracker-account-reminders {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
  margin-bottom: 3px;
}

.dltracker-account-reminder {
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid #bcc9d0;
  border-radius: 6px;
  background: #f6f8f9;
  color: #43535c;
  cursor: pointer;
  font: inherit;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: left;
}

.dltracker-browse-analysis.is-account-purchased {
  padding: 5px;
  border: 1px solid #c8ced2;
  border-radius: 7px;
  background: #f0f1f2;
  filter: grayscale(0.38);
}

.dltracker-language-entry {
  display: flex;
  width: 100%;
  margin: 4px 0;
  box-sizing: border-box;
}

.dltracker-language-entry-button {
  width: 100%;
  min-height: 27px;
  padding: 4px 8px;
  font-size: 11px;
  line-height: 1.3;
}

.dltracker-language-entry-cart {
  width: auto;
  justify-content: flex-start;
}

.dltracker-language-entry-cart.is-desktop-button .dltracker-language-entry-button {
  width: auto;
  min-height: 0;
  padding: 2px 7px;
  box-sizing: border-box;
  font-size: 10px;
  line-height: 1.25;
  overflow: hidden;
  white-space: nowrap;
}

.dltracker-language-entry-cart.is-mobile-text {
  display: inline-flex;
  width: auto;
  margin: 0 8px 0 0;
  padding: 0;
  vertical-align: baseline;
}

.dltracker-language-entry-cart.is-mobile-text .dltracker-language-entry-button,
.dltracker-language-entry-cart.is-mobile-text .dltracker-language-entry-button:hover {
  width: auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  appearance: none;
  cursor: pointer;
  white-space: nowrap;
}

.dltracker-language-entry-detail {
  margin-top: 7px;
}

.dltracker-browse-analysis-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) max-content;
  align-items: stretch;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.dltracker-browse-analysis-frame {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  min-height: 23px;
  padding: 2px 3px;
  border: 1px solid #d4dee4;
  border-radius: 5px;
  box-sizing: border-box;
  color: #40515b;
  background: #fff;
  font: inherit;
  line-height: 1.15;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
}

.${UI_CLASSNAME}.dltracker-browse-analysis.is-stacked {
  margin: 2px 0 12px;
}

.dltracker-browse-analysis.is-stacked .dltracker-browse-analysis-grid {
  grid-template-columns: minmax(0, 1fr);
}

.dltracker-browse-analysis.is-stacked .dltracker-browse-analysis-frame {
  width: 100%;
}

.dltracker-browse-analysis-trend {
  padding-inline: 5px;
}

button.dltracker-browse-analysis-frame,
a.dltracker-browse-analysis-frame {
  cursor: pointer;
}

.dltracker-browse-analysis-frame strong,
.dltracker-browse-analysis-price,
.dltracker-browse-analysis-off {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dltracker-browse-analysis-amount {
  display: none;
}

@container (min-width: 320px) {
  .dltracker-browse-analysis-amount {
    display: inline;
  }
}

.dltracker-browse-analysis-off {
  flex: 0 0 auto;
  padding: 1px 3px;
  border-radius: 999px;
  color: #51616b;
  background: #edf2f5;
  font-weight: 800;
}

.dltracker-browse-analysis-frame.dltracker-browse-analysis-best {
  border-color: #dfb84f;
  color: #4b3a12;
  background: #fffdf6;
}

.dltracker-browse-analysis-frame.dltracker-browse-analysis-best .dltracker-browse-analysis-off {
  color: #6d4700;
  background: #ffd75a;
}

.dltracker-browse-analysis-frame.is-disabled {
  color: #89959b;
  background: #f5f7f8;
}

.dltracker-browse-analysis-offers {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 2px 8px;
  width: 100%;
  padding: 3px 5px;
  border-radius: 5px;
  box-sizing: border-box;
  color: #80500d;
  background: #fff4de;
  font-size: 9px;
  line-height: 1.3;
  overflow-wrap: normal;
}

.dltracker-browse-analysis-offer-group {
  display: inline-flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  max-width: 100%;
  min-width: 0;
  gap: 1px 4px;
}

.dltracker-browse-analysis-offer-group strong,
.dltracker-browse-analysis-offer-item {
  max-width: 100%;
  min-width: 0;
  white-space: normal;
  overflow-wrap: break-word;
  overflow-wrap: anywhere;
}

.dltracker-deal-compact {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.dltracker-deal-row {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 5px;
  box-sizing: border-box;
}

.dltracker-activity-row {
  background: #e8f5ed;
  color: #22603a;
}

.dltracker-coupon-row {
  background: #fff4de;
  color: #80500d;
}

.dltracker-deal-row.dltracker-coupon-row {
  flex-direction: column;
  align-items: flex-start;
}

.dltracker-coupon-compact-line {
  display: block;
}

.dltracker-deal-detail {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

.dltracker-deal-section {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 5px 7px;
  border-radius: 6px;
}

.dltracker-deal-section strong {
  font-size: 12px;
}

.dltracker-coupon-line + .dltracker-coupon-line {
  padding-top: 3px;
  border-top: 1px dashed rgba(128, 80, 13, 0.25);
}

.dltracker-deal-partial {
  color: #a14716;
  font-size: 10px;
}

.dltracker-reach-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.5);
  box-sizing: border-box;
  overscroll-behavior: none;
}

.dltracker-reach-dialog {
  width: min(560px, 100%);
  max-height: min(760px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 13px;
  background: #fff;
  color: #263238;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.32);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.dltracker-reach-dialog > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  background: #3f6074;
  color: #fff;
  font-size: 14px;
}

.dltracker-reach-dialog > header button {
  border: 0;
  padding: 0 3px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 24px;
  line-height: 1;
}

.dltracker-reach-dialog-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
}

.dltracker-account-dialog {
  width: min(520px, 100%);
}

.dltracker-account-info-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dltracker-account-info-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 9px;
  border-radius: 7px;
  background: #f4f7f9;
}

.dltracker-account-info-summary span {
  white-space: nowrap;
}

.dltracker-account-refresh {
  align-self: flex-start;
  padding: 6px 10px;
}

.dltracker-language-dialog {
  width: min(1100px, 100%);
}

.dltracker-language-conclusion {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #eef5f8;
  color: #294c60;
  font-weight: 700;
}

.dltracker-language-table-wrap {
  width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.dltracker-language-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}

.dltracker-language-table th,
.dltracker-language-table td {
  padding: 7px 8px;
  border: 1px solid #d9e1e5;
  vertical-align: middle;
  text-align: left;
  white-space: nowrap;
}

.dltracker-language-table th {
  background: #edf3f6;
  color: #40545f;
}

.dltracker-language-table tr.is-best:not(.is-muted) td {
  background: #fff3c4;
}

.dltracker-language-table tr.is-muted td {
  background: #eceff1;
  color: #68757c;
}

.dltracker-language-table td small {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 4px;
  border-radius: 999px;
  background: #d7e6ee;
  color: #36586b;
  font-size: 9px;
}

.dltracker-language-table tr.is-muted td small {
  background: #fff0b0;
  color: #6c5200;
}

.dltracker-language-table button,
.dltracker-language-table select {
  min-height: 25px;
  padding: 3px 7px;
  font-size: 11px;
}

.dltracker-language-price-button,
.dltracker-language-discount-button {
  white-space: nowrap;
}

.dltracker-language-best-rate {
  color: #a14800;
  font-weight: 800;
}

.dltracker-language-retry {
  margin-top: 9px;
  padding: 5px 9px;
}

.dltracker-language-account-details {
  margin-top: 10px;
  padding: 7px 9px;
  border: 1px solid #dce4e8;
  border-radius: 7px;
  background: #fafcfd;
}

.dltracker-language-account-details summary {
  cursor: pointer;
  font-weight: 700;
}

.dltracker-language-account-details .dltracker-account-info-panel {
  margin-top: 9px;
}

.dltracker-reach-section + .dltracker-reach-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #e1e7eb;
}

.dltracker-reach-section h3,
.dltracker-reach-section h4 {
  margin: 0 0 7px;
  color: #263238;
}

.dltracker-reach-section h3 {
  font-size: 14px;
}

.dltracker-reach-section h4 {
  margin-top: 10px;
  font-size: 12px;
}

.dltracker-reach-work-formula,
.dltracker-reach-formula {
  margin: 5px 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f3f7f9;
  word-break: break-word;
}

.dltracker-reach-work-step + .dltracker-reach-work-step {
  margin-top: 4px;
}

.dltracker-reach-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 5px;
}

.dltracker-reach-row span {
  text-align: right;
}

.dltracker-reach-row.is-current-best {
  color: #24623b;
}

.dltracker-reach-muted,
.dltracker-reach-warning {
  margin: 5px 0;
  color: #69757d;
  font-size: 11px;
}

.dltracker-reach-warning {
  color: #9a5b13;
}

.dltracker-reach-order,
.dltracker-reach-recommendation,
.dltracker-reach-alternatives,
.dltracker-reach-disclaimer {
  margin-top: 7px;
  padding: 7px 8px;
  border: 1px solid #dbe4e9;
  border-radius: 7px;
  background: #fbfcfd;
}

.dltracker-reach-order summary,
.dltracker-reach-recommendation summary,
.dltracker-reach-alternatives summary,
.dltracker-reach-disclaimer summary {
  cursor: pointer;
  font-weight: 700;
}

.dltracker-reach-recommendation-table-wrap {
  margin-top: 7px;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
}

.dltracker-reach-recommendation-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
  border-collapse: collapse;
  color: #34434c;
  font-size: clamp(9px, 1.7vw, 11px);
}

.dltracker-reach-recommendation-table th,
.dltracker-reach-recommendation-table td {
  padding: clamp(3px, 0.8vw, 6px);
  border: 1px solid #dbe4e9;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow-wrap: normal;
  line-height: 1.35;
}

.dltracker-reach-recommendation-table th:first-child {
  text-align: left;
}

.dltracker-reach-recommendation-table thead th {
  background: #eef4f7;
}

.dltracker-reach-recommendation-discounts {
  letter-spacing: -0.02em;
  overflow-wrap: normal !important;
  word-break: keep-all;
}

.dltracker-reach-recommendation-discounts .is-strongest {
  padding: 1px 2px;
  border-radius: 3px;
  color: #6d4700;
  background: #ffd75a;
  font-weight: 800;
}

.dltracker-reach-recommendation-summary {
  margin-top: 7px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f3f7f9;
}

.dltracker-reach-recommendation-toggle {
  margin-top: 7px;
  padding: 5px 9px;
  border: 1px solid #bccbd3;
  border-radius: 6px;
  color: #3f5967;
  background: #fff;
  cursor: pointer;
  font-size: 11px;
}

.dltracker-reach-recommendation-action-cell {
  text-align: left !important;
  vertical-align: middle !important;
}

.dltracker-reach-recommendation-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 4px 8px;
  border: 1px solid #b8cbd5;
  border-radius: 5px;
  box-sizing: border-box;
  color: #315f7d;
  background: #fff;
  font: inherit;
  font-weight: 700;
  line-height: 1.2;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.dltracker-reach-recommendation-action:disabled {
  color: #8a979e;
  background: #f2f5f6;
  cursor: default;
}

.dltracker-reach-alternatives h5 {
  margin: 9px 0 0;
  color: #52616b;
  font-size: 11px;
}

.dltracker-reach-order ul,
.dltracker-reach-recommendation ul,
.dltracker-reach-disclaimer ul {
  margin: 7px 0 0;
  padding-left: 20px;
}

.dltracker-reach-disclaimer {
  margin-top: 12px;
  color: #5f6b72;
  font-size: 11px;
}

.dltracker-deal-toast {
  position: fixed;
  left: 50%;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  z-index: 2147483646;
  max-width: min(88vw, 520px);
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(34, 96, 58, 0.96);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  opacity: 0;
  transform: translate(-50%, 8px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
}

.dltracker-deal-toast.is-visible {
  opacity: 1;
  transform: translate(-50%, 0);
}

.dltracker-deal-toast.is-error {
  background: rgba(178, 45, 45, 0.97);
}

.${UI_CLASSNAME} .dltracker-btn {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  color: #fff;
  background: #2463eb;
  cursor: pointer;
  box-sizing: border-box;
}

.${UI_CLASSNAME} .dltracker-error {
  background: #cb2f2f;
}

.dltracker-inline-host {
  margin-top: 6px;
}

.dltracker-wishlist-host {
  margin-top: 6px;
  width: 100%;
  box-sizing: border-box;
  clear: both;
}

.dltracker-cart-host {
  margin-top: 6px;
  width: 100%;
  box-sizing: border-box;
}

.${UI_CLASSNAME}.dltracker-cart-layout {
  width: 100%;
  max-width: 100%;
  margin: 7px 0 0;
  gap: 7px;
  color: #34434c;
  font-size: 11px;
}

.dltracker-cart-deal-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) max-content max-content;
  align-items: stretch;
  gap: 5px;
  width: 100%;
  min-width: 0;
}

.dltracker-cart-deal-frame {
  min-width: 0;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 0;
  padding: 5px 7px;
  border: 1px solid #d5dfe5;
  border-radius: 7px;
  box-sizing: border-box;
  color: #34434c;
  background: #fff;
  font: inherit;
  line-height: 1.25;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
}

button.dltracker-cart-deal-frame,
a.dltracker-cart-deal-frame {
  cursor: pointer;
}

button.dltracker-cart-deal-frame:focus-visible,
a.dltracker-cart-deal-frame:focus-visible {
  outline: 2px solid #4f7f9d;
  outline-offset: 1px;
}

.dltracker-cart-price-frame strong {
  flex: 0 0 auto;
  font-size: 10px;
}

.dltracker-cart-deal-price {
  min-width: 0;
  font-size: 10px;
}

.dltracker-cart-deal-off {
  flex: 0 0 auto;
  padding: 1px 4px;
  border-radius: 999px;
  color: #51616b;
  background: #edf2f5;
  font-size: 10px;
  font-weight: 800;
}

.dltracker-cart-price-frame.dltracker-best-reach-gold {
  border-color: #dfb84f;
  color: #4b3a12;
  background: #fffdf6;
}

.dltracker-cart-price-frame.dltracker-best-reach-gold .dltracker-cart-deal-off {
  color: #6d4700;
  background: #ffd75a;
}

.dltracker-cart-price-frame.dltracker-best-reach-bluegray {
  border-color: #9aabb8;
  color: #34434c;
  background: #f8fafb;
}

.dltracker-cart-price-frame.dltracker-best-reach-bluegray .dltracker-cart-deal-off {
  color: #fff;
  background: #587187;
}

.dltracker-cart-status {
  padding-inline: 10px;
  font-weight: 800;
}

.dltracker-cart-status.is-needs {
  border-color: #e6bd72;
  color: #81500b;
  background: #fff4de;
}

.dltracker-cart-status.is-met,
.dltracker-cart-status.is-single {
  border-color: #9bc9aa;
  color: #24623b;
  background: #e8f5ed;
}

.dltracker-cart-status.is-loading,
.dltracker-cart-status:disabled,
.dltracker-cart-layout-loading .dltracker-cart-deal-frame {
  cursor: default;
  color: #78868e;
  background: #f5f7f8;
}

.dltracker-cart-trend {
  padding-inline: 10px;
  color: #315f7d;
  font-weight: 700;
}

.dltracker-cart-offer-section {
  width: 100%;
  min-width: 0;
}

.dltracker-cart-offer-section h4 {
  margin: 0 0 4px;
  color: #485963;
  font-size: 11px;
}

.dltracker-cart-offer-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
}

.dltracker-cart-offer-table {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  color: #3f4e56;
  background: #fff;
  font-size: 10px;
}

.dltracker-cart-offer-table th,
.dltracker-cart-offer-table td {
  padding: 4px 6px;
  border: 1px solid #dbe4e9;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

.dltracker-cart-offer-table th {
  color: #53636c;
  background: #f1f5f7;
  font-weight: 700;
}

.dltracker-cart-coupon-section .dltracker-cart-offer-table td:first-child {
  color: #80500d;
  font-weight: 800;
}

.dltracker-cart-activity-section .dltracker-cart-offer-table td:first-child {
  color: #22603a;
  font-weight: 800;
}

.dltracker-cart-coupon-toggle {
  margin-top: 4px;
  padding: 0;
  border: 0;
  color: #315f7d;
  background: transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.dltracker-cart-coupon-extra[hidden] {
  display: none !important;
}

.dltracker-cart-diagnostic {
  position: fixed;
  z-index: 2147483000;
  right: max(12px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  display: flex;
  align-items: stretch;
  flex-direction: column;
  gap: 7px;
  width: min(210px, calc(100vw - 24px));
  margin: 0;
  padding: 10px;
  color: #52616b;
  background: rgba(245, 248, 250, .98);
  border: 1px solid #d6e0e5;
  border-radius: 9px;
  box-shadow: 0 5px 22px rgba(25, 39, 47, .24);
  font-size: 12px;
  box-sizing: border-box;
}

.dltracker-cart-diagnostic button {
  padding: 6px 10px;
  color: #fff;
  background: #435a66;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.dltracker-cart-diagnostic button:disabled {
  opacity: .55;
  cursor: wait;
}

.dltracker-cart-diagnostic span {
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.dltracker-mobile-product-host {
  margin: 0 0 10px;
  display: block;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  clear: both;
}

.dltracker-mobile-product-host .${UI_CLASSNAME} {
  margin-top: 0;
}

.dltracker-buy-later-subtitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.dltracker-buy-later-mobile-subtitle {
  width: 100%;
  box-sizing: border-box;
}

.dltracker-buy-later-controls {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  margin-left: auto;
  flex-wrap: wrap;
}

.dltracker-buy-later-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #666;
  user-select: none;
  white-space: nowrap;
}

.dltracker-buy-later-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
}

.dltracker-buy-later-mode,
.dltracker-buy-later-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  margin-left: auto;
}

.dltracker-buy-later-mode.is-disabled {
  opacity: 0.55;
}

.dltracker-buy-later-mode .dltracker-buy-later-mode-select,
.dltracker-buy-later-filter .dltracker-buy-later-filter-select {
  height: 22px;
  max-width: min(68vw, 290px);
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid #c9c9c9;
  background: #fff;
  color: #444;
  font-size: 12px;
}

.dltracker-buy-later-filtered-out {
  display: none !important;
}

.dltracker-browse-account-hidden {
  display: none !important;
}

.dltracker-buy-later-mobile-section > h2.sub_lead_01,
.dltracker-buy-later-mobile-section > h2 {
  width: 100%;
}

.dltracker-buy-later-mobile-section > .dltracker-buy-later-controls {
  width: 100%;
  margin: 8px 0 0;
  margin-left: 0;
  padding: 0 10px;
  box-sizing: border-box;
  justify-content: space-between;
}

.dltracker-import-box {
  margin: 10px 0 14px;
  padding: 10px 16px;
  border: 1px solid #a3cd8d;
  border-radius: 10px;
  background: #fbf1d7;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
  color: #3d6e2a;
  width: 100%;
  box-sizing: border-box;
  overflow: visible;
}

.dltracker-import-box .dltracker-import-title {
  flex: 1 1 100%;
  width: 100%;
  line-height: 1.4;
}

.dltracker-import-box button {
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  background: #73ae52;
  font-size: 13px;
  white-space: nowrap;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}

.dltracker-import-box button:hover {
  background: #5e9741;
}

.dltracker-import-box button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dltracker-import-box .dltracker-import-status {
  flex: 1 1 100%;
  width: 100%;
  margin-top: 2px;
  color: #666;
  font-size: 12px;
}

.dltracker-deal-planner {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #2d3748;
}

.dltracker-planner-launcher,
.dltracker-planner-primary,
.dltracker-planner-secondary,
.dltracker-planner-danger,
.dltracker-planner-close,
.dltracker-planner-link-button {
  cursor: pointer;
}

.dltracker-planner-launcher {
  float: right;
  border: none;
  border-radius: 999px;
  padding: 11px 19px;
  background: #2f855a;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 7px 24px rgba(0, 0, 0, 0.2);
}

.dltracker-planner-panel[hidden] {
  display: none !important;
}

.dltracker-planner-panel {
  width: min(720px, calc(100vw - 32px));
  max-height: min(820px, calc(100vh - 90px));
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e0;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
}

.dltracker-planner-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  background: #276749;
  color: #fff;
  font-size: 15px;
}

.dltracker-planner-close {
  border: 0;
  padding: 0 4px;
  background: transparent;
  color: #fff;
  font-size: 25px;
  line-height: 1;
}

.dltracker-planner-body,
.dltracker-planner-result {
  padding: 14px 16px;
  overflow-y: auto;
}

.dltracker-planner-body {
  border-bottom: 1px solid #e2e8f0;
}

.dltracker-planner-result:empty {
  display: none;
}

.dltracker-planner-section-title {
  margin: 5px 0 9px;
  font-size: 14px;
  font-weight: 700;
}

.dltracker-planner-item,
.dltracker-planner-coupon,
.dltracker-planner-order {
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  background: #f8fafc;
}

.dltracker-planner-item-name {
  margin-bottom: 7px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dltracker-planner-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.dltracker-planner-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 11px;
  color: #4a5568;
}

.dltracker-planner-input {
  width: 100%;
  min-width: 0;
  height: 31px;
  box-sizing: border-box;
  border: 1px solid #cbd5e0;
  border-radius: 5px;
  padding: 4px 7px;
  background: #fff;
  color: #1a202c;
  font-size: 12px;
}

.dltracker-planner-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dltracker-planner-coupon-name {
  flex: 1;
  margin-bottom: 8px;
  font-weight: 650;
}

.dltracker-planner-coupon-name-wrap {
  flex: 1;
  min-width: 0;
}

.dltracker-planner-source-badge {
  display: inline-block;
  margin: 0 0 8px 7px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #bee3f8;
  color: #2c5282;
  font-size: 10px;
  vertical-align: middle;
}

.dltracker-planner-secondary,
.dltracker-planner-danger,
.dltracker-planner-primary {
  border: 0;
  border-radius: 6px;
  padding: 7px 12px;
  color: #fff;
  font-size: 12px;
}

.dltracker-planner-secondary {
  background: #4a5568;
}

.dltracker-planner-danger {
  align-self: flex-start;
  background: #c53030;
}

.dltracker-planner-primary {
  width: 100%;
  margin-top: 5px;
  padding: 10px;
  background: #2f855a;
  font-weight: 700;
}

.dltracker-planner-primary:disabled,
.dltracker-planner-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dltracker-planner-link-button {
  margin-top: 6px;
  border: 0;
  padding: 0;
  background: transparent;
  color: #2b6cb0;
  font-size: 11px;
}

.dltracker-planner-eligibility-title {
  margin: 9px 0 5px;
  font-size: 11px;
  font-weight: 650;
}

.dltracker-planner-checkboxes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 10px;
}

.dltracker-planner-checkboxes label {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
}

.dltracker-planner-checkboxes span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dltracker-planner-result-summary {
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 8px;
  background: #c6f6d5;
  color: #22543d;
  font-size: 14px;
  font-weight: 750;
}

.dltracker-planner-order ul {
  margin: 7px 0;
  padding-left: 20px;
  font-size: 11px;
}

.dltracker-planner-order-total {
  text-align: right;
  font-size: 12px;
  font-weight: 700;
}

.dltracker-planner-warning,
.dltracker-planner-muted {
  margin: 8px 0;
  color: #975a16;
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .dltracker-cart-deal-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    grid-template-rows: auto auto;
    column-gap: 4px;
    row-gap: 1px;
    padding: 3px 0;
    border-top: 1px solid #edf1f3;
    border-bottom: 1px solid #edf1f3;
  }

  .dltracker-cart-reach {
    grid-column: 1 / 4;
    grid-row: 1;
  }

  .dltracker-cart-history {
    grid-column: 1 / 4;
    grid-row: 2;
  }

  .dltracker-cart-platform {
    grid-column: 4 / 7;
    grid-row: 2;
    border-left: 1px solid #e5ebee;
  }

  .dltracker-cart-status {
    grid-column: 4 / 6;
    grid-row: 1;
  }

  .dltracker-cart-trend {
    grid-column: 6;
    grid-row: 1;
  }

  .dltracker-cart-deal-frame {
    width: 100%;
    min-height: 25px;
    justify-content: flex-start;
    gap: 3px;
    padding: 3px 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
    overflow: hidden;
  }

  button.dltracker-cart-reach,
  .dltracker-cart-status {
    border-radius: 5px;
    background: #f5f8f9;
  }

  .dltracker-cart-price-frame.dltracker-best-reach-gold,
  .dltracker-cart-price-frame.dltracker-best-reach-bluegray {
    border: 0;
    background: transparent;
  }

  .dltracker-cart-status.is-needs {
    color: #81500b;
    background: #fff7e8;
  }

  .dltracker-cart-status.is-met,
  .dltracker-cart-status.is-single {
    color: #24623b;
    background: #edf7f0;
  }

  .dltracker-cart-trend {
    justify-content: flex-end;
    padding-inline: 2px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .dltracker-cart-deal-price {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dltracker-cart-price-frame strong,
  .dltracker-cart-deal-price,
  .dltracker-cart-deal-off {
    font-size: 9px;
  }

  .dltracker-cart-status,
  .dltracker-cart-trend {
    font-size: 10px;
  }
}

@media (max-width: 768px) {
  .${UI_CLASSNAME} {
    margin-top: 6px;
    gap: 5px;
    font-size: 12px;
  }

  .dltracker-mobile-product-host .${UI_CLASSNAME} .dltracker-chip,
  .dltracker-mobile-product-host .${UI_CLASSNAME} .dltracker-btn {
    width: 100%;
    justify-content: center;
  }

  .dltracker-cart-host .${UI_CLASSNAME} .dltracker-chip,
  .dltracker-cart-host .${UI_CLASSNAME} .dltracker-btn {
    width: 100%;
    justify-content: center;
    text-align: center;
    box-sizing: border-box;
  }

  .dltracker-cart-host .${UI_CLASSNAME} .dltracker-chip-current {
    width: 100%;
    align-self: stretch;
  }

  .dltracker-cart-host .${UI_CLASSNAME} .dltracker-chip-text {
    width: auto;
    flex: 0 0 auto;
    text-align: center;
  }

  .dltracker-cart-host .${UI_CLASSNAME} .dltracker-off-badge {
    flex: 0 0 auto;
  }

  .dltracker-import-box {
    margin: 8px 0 10px;
    padding: 8px 10px;
    gap: 8px;
    border-radius: 8px;
  }

  .dltracker-wishlist-host {
    margin-top: 8px;
  }

  .dltracker-cart-host {
    margin-top: 8px;
  }

  .dltracker-mobile-product-host {
    margin: 0 0 8px;
  }

  .dltracker-buy-later-subtitle {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 6px;
  }

  .dltracker-buy-later-controls {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }

  .dltracker-buy-later-mobile-section > .dltracker-buy-later-controls {
    justify-content: space-between;
  }

  .dltracker-import-box button {
    flex: 1 1 auto;
    min-width: 92px;
    padding: 8px 10px;
    font-size: 14px;
  }

  .dltracker-import-box .dltracker-import-title,
  .dltracker-import-box .dltracker-import-status {
    font-size: 12px;
  }

  .dltracker-deal-planner {
    right: 10px;
    bottom: 10px;
  }

  .dltracker-planner-panel {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 70px);
  }

  .dltracker-planner-grid,
  .dltracker-planner-checkboxes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
    document.head.appendChild(style);
  }

  let lastUrl = location.href;

  function onUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    resetBrowseOriginalOrder();
    waitForElement(currentUrl).then(() => {
      void bootstrap();
    });
  }

  function restoreBrowseStateOnPageShow(event) {
    if (!event?.persisted) return;
    const currentUrl = location.href;
    lastUrl = currentUrl;
    resetBrowseOriginalOrder();
    waitForElement(currentUrl)
      .then(async () => {
        await bootstrap();
        await applyBrowseSortAndFilter();
      })
      .catch((error) => {
        console.warn(`[${APP_NAME}] restore browse state failed:`, error);
      });
  }

  function mutationIsInsideReachDialog(mutation) {
    const target = mutation?.target;
    const element = target instanceof Element
      ? target
      : target?.parentElement;
    if (element?.closest?.(".dltracker-reach-overlay")) return true;
    if (mutation?.type !== "childList") return false;
    const changedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]
      .filter((node) => node.nodeType === Node.ELEMENT_NODE);
    return changedNodes.length > 0 && changedNodes.every((node) =>
      node.matches?.(".dltracker-reach-overlay") ||
      node.closest?.(".dltracker-reach-overlay"));
  }

  function mutationIsInsideTrackerUi(mutation) {
    if (mutationIsInsideReachDialog(mutation)) return true;
    const trackerSelector = "[class^='dltracker-'], [class*=' dltracker-']";
    const target = mutation?.target;
    const element = target instanceof Element
      ? target
      : target?.parentElement;
    if (element?.matches?.(trackerSelector) || element?.closest?.(trackerSelector)) {
      return true;
    }
    if (mutation?.type !== "childList") return false;
    const changedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]
      .filter((node) => node.nodeType === Node.ELEMENT_NODE);
    return changedNodes.length > 0 && changedNodes.every((node) =>
      node.matches?.(trackerSelector) || node.closest?.(trackerSelector));
  }

  function installSpaListeners() {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      originalPushState(...args);
      onUrlChange();
    };

    history.replaceState = function (...args) {
      originalReplaceState(...args);
      onUrlChange();
    };

    window.addEventListener("popstate", () => onUrlChange());
    window.addEventListener("pageshow", restoreBrowseStateOnPageShow);
    setInterval(() => onUrlChange(), 500);

    let domDebounceTimer = null;
    const domObserver = new MutationObserver((mutations) => {
      // 助手自身的弹窗、卡片分析和账号提醒变动不代表 DLsite 页面数据变了。
      // 忽略这些变动，避免反复启动整页增强与异步提醒重算。
      if (mutations.length && mutations.every(mutationIsInsideTrackerUi)) return;
      if (domDebounceTimer) return;
      domDebounceTimer = setTimeout(() => {
        domDebounceTimer = null;
        const currentUrl = location.href;
        maybeConfirmPendingCartAdd();

        if (browseNativeSortPending) {
          browseNativeSortPending = false;
          resetBrowseOriginalOrder();
          void bootstrap();
          return;
        }

        if (isProductPage(currentUrl)) {
          const host = findProductRenderHost();
          const currentMatch = location.pathname.match(/product_id\/([RBV]J\d{6,})/i);
          const id = currentMatch
            ? currentMatch[1].toUpperCase()
            : productIdFromNode(document.body);
          if (host &&
            (!host.querySelector(`.${UI_CLASSNAME}`) ||
              needsDealProcessing(host, id))) {
            void bootstrap();
          }
          return;
        }

        if (maybeBootstrapForWishlistMutation(currentUrl)) return;
        if (maybeBootstrapForCartMutation(currentUrl)) return;

        if (hasCartContainer() || hasWishlistContainer()) {
          scheduleCartBootstrap();
          return;
        }

        const browseCards = collectBrowseCards();
        if (browseCards.length &&
          !document.querySelector(".dltracker-browse-controls")) {
          const hasInsights = browseCards.some(({ id }) =>
            dealInsightById.has(String(id).toUpperCase()));
          injectBrowseControls(hasInsights);
        }
        if (browseCards.some(({ id, node }) => needsDealProcessing(node, id))) {
          void bootstrap();
        }
      }, 300);
    });
    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id", "data-cart-area", "data-area", "style"],
    });
  }

  async function start() {
    try {
      injectStyle();
      showUpdateNoticeIfNeeded();
      await cleanExpiredCache();
      await restoreLanguageDialogAfterReload({ deferRender: true });
      await bootstrap();
      installDealEventListeners();
      installSpaListeners();
      console.log(`[${APP_NAME}] userscript started (${APP_VERSION})`);
    } catch (error) {
      console.error(`[${APP_NAME}] startup failed:`, error);
    }
  }

  void start();
})();
