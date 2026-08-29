// ==UserScript==
// @name         DLsite 最优买法 + 史低
// @namespace    https://github.com/jiangdaolia/dlsite-best-deal
// @version      0.6.6
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
  const APP_VERSION = "0.6.6";

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
  const BUY_LATER_SORT_STORAGE_KEY = "dltracker-buy-later-sort-enabled";
  const BUY_LATER_SORT_MODE_STORAGE_KEY = "dltracker-buy-later-sort-mode";
  const BUY_LATER_SORT_MODE_LOWEST = "lowest";
  const BUY_LATER_SORT_MODE_REACH = "reach";
  const BUY_LATER_SORT_MODE_PRICE = "price";
  const BROWSE_SORT_MODE_STORAGE_KEY = "dltracker-browse-sort-mode";
  const BROWSE_FILTER_STORAGE_KEY = "dltracker-browse-bundle-filter";
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
  const PRODUCT_CODE_REGEX = /\b([RBV]J\d{6,})\b/i;
  const DEAL_INSIGHT_CLASSNAME = "dltracker-deal-insight";
  const DEAL_PROCESSED_ATTRIBUTE = "data-dltracker-deal-processed";
  const MAX_PRODUCT_METADATA_BATCH = 100;
  const RELEASE_NOTES = {
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
  let couponImportInFlight = null;
  let dealCouponFetchInFlight = null;
  let importedCouponPageUrl = "";
  let dealSessionStopped = false;
  let insightBootstrapInFlight = null;
  const dealInsightById = new Map();
  const browseRecordById = new Map();
  let latestDealContext = {
    coupons: [],
    cartSnapshot: { loaded: false, active: [], later: [], updatedAt: 0 },
    partial: false,
  };
  let openReachProductId = "";
  let openReachRenderToken = 0;
  let browseNativeSortPending = false;
  let pendingCartAdd = null;
  let cartRefreshInFlight = null;
  let dealToastTimer = null;
  let lastCartSnapshotFingerprint = "";

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
      return {
        id: String(raw?.id || `COUPON-${index + 1}`),
        name: String(raw?.name || `优惠券 ${index + 1}`),
        type: raw?.type === "fixed" ? "fixed" : "percent",
        value: plannerYen(raw?.value),
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

  function ensureCartRenderHost(item) {
    const existed = item.querySelector(".dltracker-cart-host");
    let priceHost = findCartPriceHost(item);
    if (priceHost?.tagName === "SPAN" && priceHost.parentElement) {
      priceHost = priceHost.parentElement;
    }
    if (existed) {
      if (priceHost && existed.parentElement !== priceHost) {
        priceHost.appendChild(existed);
      }
      return existed;
    }

    const host = document.createElement("div");
    host.className = "dltracker-cart-host";

    if (priceHost?.parentElement) {
      // 放在 work_price 内，和价格同一列纵向排列，避免横向挤压布局。
      priceHost.appendChild(host);
      return host;
    }

    const inner =
      item.querySelector(".__buy_now_target .cart_list_item_inner") ||
      item.querySelector(".__buy_later_target .cart_list_item_inner") ||
      item.querySelector(".cart_list_item_inner");
    if (inner) {
      inner.appendChild(host);
      return host;
    }

    item.appendChild(host);
    return host;
  }

  function extractRjCodeFromCartItem(item) {
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

  function buildDealCouponOptions(coupons, product, cartProducts = []) {
    const cart = Array.isArray(cartProducts) ? cartProducts : [];
    const cartSubtotal = cart.reduce(
      (sum, item) => sum + Math.max(0, dealNumber(item?.price)),
      0,
    );
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
    console.warn(`[${APP_NAME}] DLsite deal requests stopped for this page: ${reason}`);
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

  async function fetchSameOriginText(url, label) {
    if (dealSessionStopped) throw new Error("本页请求已因风控信号停止");
    const response = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json, text/html;q=0.9" },
    });
    const text = await response.text();
    if (response.status === 403 || response.status === 429) {
      stopDealRequests(`${label} HTTP ${response.status}`);
      throw new Error(`${label}返回 HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`${label}返回 HTTP ${response.status}`);
    if (/captcha|reCAPTCHA|認証|验证|アクセスが集中/i.test(text) &&
      /^\s*</.test(text)) {
      stopDealRequests(`${label}返回验证页`);
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
      siteId: String(raw?.site_id || location.pathname.split("/")[1] || ""),
      workType: String(raw?.work_type || ""),
      customGenres: dealTokens(raw?.custom_genres),
      bulkbuyKey: String(raw?.bulkbuy_key || ""),
      alternateIds: dealTokens([
        translationInfo?.parent_workno,
        translationInfo?.original_workno,
        raw?.parent_workno,
      ]).map((value) => String(value).toUpperCase()),
      raw,
    };
  }

  async function ensureProductMetadata(ids) {
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
    if (!missing.length || dealSessionStopped) return result;
    // 无限滚动会在同一 URL 下追加作品；每次只读未缓存的下一批。
    const batch = missing.slice(0, MAX_PRODUCT_METADATA_BATCH);

    const url = new URL(DLSITE_PRODUCT_INFO_PATH, location.origin);
    url.searchParams.set("product_id", batch.join(","));
    try {
      const text = await fetchSameOriginText(url, "作品信息接口");
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        if (/^\s*</.test(text)) stopDealRequests("作品信息接口返回网页");
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

  async function ensureProductMetadataBatches(ids) {
    const unique = [...new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id).toUpperCase())
      .filter((id) => /^[RBV]J\d{6,}$/i.test(id)))];
    const result = new Map();
    for (let start = 0; start < unique.length; start += MAX_PRODUCT_METADATA_BATCH) {
      const batch = await ensureProductMetadata(
        unique.slice(start, start + MAX_PRODUCT_METADATA_BATCH),
      );
      for (const [id, product] of batch.entries()) result.set(id, product);
      if (dealSessionStopped) break;
    }
    return result;
  }

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
      const cnyMatch = priceText.replace(/,/g, "").match(
        /(?:RMB|CNY|CN\s*[¥￥]|人民币|[¥￥])\s*(\d{1,8}(?:\.\d{1,2})?)/i,
      );
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
        cnyPrice: cnyMatch ? Number(cnyMatch[1]) : 0,
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

  function collectBrowseCards() {
    if (/\/mypage\/(?:order|purchase|library|download)/i.test(location.pathname)) return [];
    const selectors = [
      "li.search_result_img_box_inner[data-workno]",
      ".search_result_img_box_inner[data-workno]",
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
      if (isCartPage(location.href) && !isRenderableCartItem(node)) return;
      const id = productIdFromNode(node);
      if (!id ||
        id === currentId ||
        cards.some((entry) => entry.id === id &&
          (entry.node.contains(node) || node.contains(entry.node))) ||
        node.closest("#work_buy, .c-purchaseBox")) return;
      seen.add(node);
      cards.push({ id, node });
    };
    for (const node of document.querySelectorAll(selectors.join(","))) {
      addCard(node);
    }
    for (const link of document.querySelectorAll('a[href*="product_id/"]')) {
      const node = link.closest([
        "li",
        "article",
        ".search_result_img_box_inner",
        ".product-item",
        ".n_worklist_item",
        ".work",
      ].join(","));
      if (!node || !findBrowsePriceHost(node)) continue;
      addCard(node);
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
      return [BROWSE_SORT_MODE_NATIVE, BUY_LATER_SORT_MODE_REACH, BUY_LATER_SORT_MODE_PRICE]
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
      node.hidden = !browseCardMatchesFilter(insight, filter);
      node.classList.toggle("dltracker-browse-filtered-out", node.hidden);
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
        return { parent: group.parentElement, before: group.nextSibling };
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

  function injectBrowseControls() {
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
      controls.append(sortLabel, filterLabel);
    }
    if (controls.parentElement !== anchor.parent || controls.nextSibling !== anchor.before) {
      anchor.parent.insertBefore(controls, anchor.before);
    }
    const sort = controls.querySelector(".dltracker-browse-sort");
    if (sort) sort.value = getBrowseSortMode();
    const filter = controls.querySelector(".dltracker-browse-filter");
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
    } else {
      filter.value = "all";
      setBrowseBundleFilter("all");
      showDealToast("已选凑单优惠已失效，已恢复全部作品", false, 5000);
    }
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

  function median(values) {
    const sorted = values
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function currencyRateFromProducts(products) {
    return median((Array.isArray(products) ? products : []).map((product) => {
      const yen = dealNumber(product?.price);
      const cny = dealNumber(product?.cnyPrice);
      return yen > 0 && cny > 0 ? cny / yen : NaN;
    }));
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
      result.push({
        id: coupon.groupKey || coupon.id,
        name: compactCouponListLabel({
          ...coupon,
          equivalentRate: couponEquivalentRate(coupon, products[0]),
        }),
        type: coupon.discountType,
        value: coupon.discount,
        minSpend: theoretical ? 0 : coupon.minSpend,
        minEligibleCount: theoretical ? 1 : coupon.minCount,
        maxDiscount: coupon.maxDiscount || 0,
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
    for (const [key, rule] of rules.entries()) {
      const eligible = active.filter((product) => product.bulkbuyKey === key);
      const missing = Math.max(0, dealNumber(rule.minCount, 3) - eligible.length);
      if (missing > 0) {
        offers.push({ type: "activity", key, rule, missing, eligible });
      }
    }
    for (const coupon of Array.isArray(coupons) ? coupons : []) {
      if (coupon.minCount <= 1) continue;
      const eligible = active.filter((product) => couponMatchesDealProduct(coupon, product));
      const missing = Math.max(0, coupon.minCount - eligible.length);
      if (missing > 0) {
        offers.push({
          type: "coupon",
          key: coupon.groupKey || coupon.id,
          coupon,
          missing,
          eligible,
        });
      }
    }
    return offers;
  }

  function limitedCombinations(items, count, limit = 30) {
    if (count <= 0) return [[]];
    const result = [];
    const pick = (start, chosen) => {
      if (result.length >= limit) return;
      if (chosen.length === count) {
        result.push([...chosen]);
        return;
      }
      for (let index = start; index < items.length; index += 1) {
        chosen.push(items[index]);
        pick(index + 1, chosen);
        chosen.pop();
        if (result.length >= limit) return;
      }
    };
    pick(0, []);
    return result;
  }

  function productsReachingOwnBest(products, coupons, rules) {
    const combined = Array.isArray(products) ? products : [];
    return combined.filter((product) => {
      const rule = rules.get(String(product.bulkbuyKey || ""));
      const options = buildDealCouponOptions(coupons, product, combined);
      const reach = calculateBestReach(product, options, rule);
      const bulkReady = !(reach.bulkRate > reach.saleRate + 0.001) ||
        combined.filter((item) => item.bulkbuyKey === product.bulkbuyKey).length >=
          dealNumber(rule?.minCount, 3);
      const couponReady = !reach.bestCoupon || Boolean(reach.bestCoupon.ready);
      return bulkReady && couponReady;
    });
  }

  async function buildBundleRecommendations(active, later, coupons, rules) {
    const recommendations = [];
    for (const offer of unmetBundleOffers(active, coupons, rules)) {
      const candidates = later.filter((product) => offer.type === "activity"
        ? product.bulkbuyKey === offer.key
        : couponMatchesDealProduct(offer.coupon, product));
      if (candidates.length < offer.missing) continue;
      const rankedCandidates = [];
      for (let order = 0; order < candidates.length; order += 1) {
        const product = candidates[order];
        const record = await getPriceRecord(String(product.id).toUpperCase());
        const atLowest = isRecordNewLowest(record, product.price);
        const insight = dealInsightById.get(String(product.id).toUpperCase());
        rankedCandidates.push({
          ...product,
          order,
          atLowest,
          reachRank: dealNumber(insight?.bestReach?.totalRate, -1),
        });
      }
      rankedCandidates.sort((a, b) =>
        Number(b.atLowest) - Number(a.atLowest) ||
        b.reachRank - a.reachRank ||
        dealNumber(a.price) - dealNumber(b.price) ||
        a.order - b.order);
      const pool = rankedCandidates.slice(0, 10);
      for (const added of limitedCombinations(pool, offer.missing)) {
        const combined = [...active, ...added];
        const calculation = await calculateCartPlans(combined, coupons);
        if (!calculation.exact) continue;
        const reachedIds = new Set(productsReachingOwnBest(
          combined,
          coupons,
          calculation.rules,
        ).map((product) => String(product.id).toUpperCase()));
        recommendations.push({
          offer,
          added,
          reachedCount: reachedIds.size,
          addedReachedCount: added.filter((product) =>
            reachedIds.has(String(product.id).toUpperCase())).length,
          historyHits: added.filter((product) => product.atLowest).length,
          total: calculation.currentBestTotal,
          calculation,
        });
      }
    }
    recommendations.sort((a, b) =>
      b.reachedCount - a.reachedCount ||
      b.addedReachedCount - a.addedReachedCount ||
      b.historyHits - a.historyHits ||
      a.total - b.total ||
      Math.min(...a.added.map((item) => item.order)) -
        Math.min(...b.added.map((item) => item.order)));
    return recommendations.slice(0, 3);
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
      `原价 ${dealMoney(officialPrice, cnyRate)}`,
      `${platformLabel}后 ${dealMoney(platformPrice, cnyRate)}`,
    ];
    if (reach.bestCoupon) {
      const couponPrice = calculateHypotheticalPrice(product, reach);
      lines.push(`${compactCouponListLabel(reach.bestCoupon)}后 ${dealMoney(couponPrice, cnyRate)}`);
    }
    lines.push(`${insight.partial ? "当前已知可到" : "本次可到"} ${dealMoney(calculateHypotheticalPrice(product, reach), cnyRate)}｜${compactOff(reach.totalRate)}`);
    return lines;
  }

  async function renderReachDialog(insight, lowestPrice) {
    const renderToken = ++openReachRenderToken;
    const overlay = document.querySelector(".dltracker-reach-overlay");
    const body = overlay?.querySelector(".dltracker-reach-dialog-body");
    if (!body || !insight) return;
    body.replaceChildren();
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
    appendReachRow(work, "还可节省", dealMoney(Math.max(0, currentPrice - targetPrice), cnyRate));
    if (insight.bulkRule) {
      const count = active.filter((item) => item.bulkbuyKey === insight.product.bulkbuyKey).length;
      const missing = Math.max(0, insight.bulkRule.minCount - count);
      appendReachRow(work, "活动门槛", missing ? `还差${missing}件` : "已满足");
    }
    if (insight.bestReach.bestCoupon) {
      const coupon = insight.bestReach.bestCoupon;
      const missing = [];
      if (coupon.countShortfall > 0) missing.push(`还差${coupon.countShortfall}部`);
      if (coupon.spendShortfall > 0) missing.push(`还差${toYen(coupon.spendShortfall)}`);
      appendReachRow(work, "优惠券门槛", missing.join("｜") || "已满足");
    }
    if (Number.isFinite(lowestPrice)) {
      appendReachRow(work, "史低对比", targetPrice <= lowestPrice ? "本次可到不高于史低" : `比史低高${toYen(targetPrice - lowestPrice)}`);
    }
    body.appendChild(work);

    const cart = document.createElement("section");
    cart.className = "dltracker-reach-section";
    const cartTitle = document.createElement("h3");
    cartTitle.textContent = "购物车计算";
    cart.appendChild(cartTitle);
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
      appendReachRow(cart, "当前平台价合计", dealMoney(calculation.platformTotal, cnyRate));
      appendReachRow(cart, partialData ? "当前已知可结算最低" : "当前可结算最低", dealMoney(calculation.currentBestTotal, cnyRate), "is-current-best");
      appendReachRow(cart, partialData ? "当前已知理论最低" : "理论最低", dealMoney(calculation.theoreticalTotal, cnyRate));
      appendReachRow(cart, "距离理论最低", dealMoney(Math.max(0, calculation.currentBestTotal - calculation.theoreticalTotal), cnyRate));
      const shortfalls = unmetBundleOffers(
        active,
        latestDealContext.coupons,
        calculation.rules,
      ).map((offer) => offer.type === "activity"
        ? `${offer.rule.minCount}件${compactOff(offer.rule.discountRate)}还差${offer.missing}件`
        : `${compactOff(couponEquivalentRate(offer.coupon, active[0] || { price: 1 }), "券")}还差${offer.missing}部`);
      for (const coupon of latestDealContext.coupons) {
        if (!(coupon.minSpend > calculation.platformTotal) ||
          !active.some((product) => couponMatchesDealProduct(coupon, product))) continue;
        shortfalls.push(`${compactOff(couponEquivalentRate(coupon, active[0] || { price: 1 }), "券")}还差${toYen(coupon.minSpend - calculation.platformTotal)}`);
      }
      if (shortfalls.length) {
        appendReachRow(cart, "还差条件", shortfalls.slice(0, 3).join("｜"));
      }
      if (!calculation.exact) {
        const warning = document.createElement("div");
        warning.className = "dltracker-reach-warning";
        warning.textContent = "组合规模过大，未进行精确拆单";
        cart.appendChild(warning);
      }
      if (calculation.splitPlan) {
        const splitTitle = document.createElement("h4");
        splitTitle.textContent = `拆单可再省 ${dealMoney(calculation.singleQuote.total - calculation.splitPlan.total, cnyRate)}`;
        cart.appendChild(splitTitle);
        calculation.splitPlan.orders.forEach((order, index) =>
          appendOrderDetails(cart, order, index, cnyRate));
      } else if (calculation.singleQuote) {
        appendOrderDetails(cart, calculation.singleQuote, 0, cnyRate);
      }
      if (calculation.theoreticalTotal < calculation.currentBestTotal) {
        const note = document.createElement("div");
        note.className = "dltracker-reach-warning";
        note.textContent = "理论总价未计入尚未加入的凑单作品价格";
        cart.appendChild(note);
      }
      if (calculation.exact && later.length) {
        const recommendations = await buildBundleRecommendations(
          active,
          later,
          latestDealContext.coupons,
          calculation.rules,
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
            summary.textContent = index === 0 ? "最佳方案" : `备选方案 ${index}`;
            const list = document.createElement("ul");
            recommendation.added.forEach((product) => {
              const item = document.createElement("li");
              item.textContent = `${product.title || product.id}｜${dealMoney(product.price, cnyRate)}${product.atLowest ? "｜当前已达史低" : ""}`;
              list.appendChild(item);
            });
            const total = document.createElement("div");
            total.className = "dltracker-reach-formula";
            const addedCost = recommendation.added.reduce(
              (sum, product) => sum + dealNumber(product.price),
              0,
            );
            const delta = recommendation.total - calculation.currentBestTotal;
            const deltaText = Math.abs(delta) < 0.01
              ? "总支出不变"
              : `总支出${delta > 0 ? "增加" : "减少"} ${dealMoney(Math.abs(delta), cnyRate)}`;
            total.textContent = `新增作品平台价 ${dealMoney(addedCost, cnyRate)}｜加入后预计 ${dealMoney(recommendation.total, cnyRate)}｜${deltaText}｜${recommendation.reachedCount}/${active.length + recommendation.added.length}部可达各自最优`;
            details.append(summary, list, total);
            parent.appendChild(details);
          };
          renderRecommendation(recommendations[0], 0, cart);
          if (recommendations.length > 1) {
            const alternatives = document.createElement("details");
            alternatives.className = "dltracker-reach-alternatives";
            const alternativesSummary = document.createElement("summary");
            alternativesSummary.textContent = `查看其他方案（${recommendations.length - 1}）`;
            alternatives.appendChild(alternativesSummary);
            recommendations.slice(1, 3).forEach((recommendation, index) =>
              renderRecommendation(recommendation, index + 1, alternatives));
            cart.appendChild(alternatives);
          }
        }
      }
    }
    body.appendChild(cart);

    const disclaimer = document.createElement("details");
    disclaimer.className = "dltracker-reach-disclaimer";
    const disclaimerSummary = document.createElement("summary");
    disclaimerSummary.textContent = "价格与方案仅供参考，以 DLsite 实际结算为准｜查看计算说明";
    const notes = document.createElement("ul");
    [
      "本次可到可能依赖尚未满足的件数或金额门槛。",
      "新增凑单作品的价格不计入未完成方案的理论总价。",
      "每笔订单最多使用一张优惠券。",
      "当前平台折扣与多件活动二选一，优惠券可与其中一项叠加。",
      "人民币金额按 DLsite 当页比例估算。",
    ].forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      notes.appendChild(item);
    });
    disclaimer.append(disclaimerSummary, notes);
    body.appendChild(disclaimer);
  }

  function closeReachDialog() {
    openReachRenderToken += 1;
    document.querySelector(".dltracker-reach-overlay")?.remove();
    openReachProductId = "";
  }

  function openReachDialog(insight, lowestPrice) {
    closeReachDialog();
    openReachProductId = String(insight?.product?.id || "").toUpperCase();
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
    title.textContent = "本次可到计算";
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
    dialog.focus({ preventScroll: true });
    void renderReachDialog(insight, lowestPrice).catch((error) => {
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
    void renderReachDialog(insight, Number.isFinite(lowestPrice) ? lowestPrice : undefined);
  }

  function createSingleBuyBadge() {
    const badge = document.createElement("div");
    badge.className = "dltracker-single-buy-badge";
    badge.textContent = "单买即最优";
    return badge;
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
    host.appendChild(box);
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
    host.appendChild(box);
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
    const options = buildDealCouponOptions(coupons, product, cartProducts);
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
    const metadata = await ensureProductMetadataBatches(cards.map((entry) => entry.id));
    const enrichedCartProducts = cartProducts.map((item) => ({
      ...item,
      ...(metadata.get(item.id) || {}),
      id: item.id,
      price: item.price || metadata.get(item.id)?.price || 0,
    }));
    // 活动页同源请求也保持串行，避免列表上出现并发访问。
    await mapWithConcurrency(cards, 1, async ({ id, node }) => {
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
      appendJpyPrice(priceHost, product);
      renderBrowseVoiceActors(node, product);
      const insight = await buildInsight(product, usableCoupons, enrichedCartProducts, partial);
      if (isCartPage(location.href)) {
        renderDetailInsight(priceHost, insight);
      }

      if (/^[RB]J/i.test(id) && !node.querySelector(`.${UI_CLASSNAME}`)) {
        const historyHost = document.createElement("div");
        historyHost.className = "dltracker-inline-host";
        priceHost.appendChild(historyHost);
        renderLoadingCard(historyHost);
        const link = node.querySelector('a[href*="product_id/"]');
        const record = await buildOrUpdateRecord({
          rjCode: id,
          title: link?.textContent?.trim() || id,
          currentPrice: product.price || undefined,
          forceFetch: false,
        });
        browseRecordById.set(String(id).toUpperCase(), record);
        if (record?.voiceActors?.length) {
          renderBrowseVoiceActors(node, {
            ...product,
            voiceActors: extractVoiceActorNames([
              product.voiceActors || [],
              record.voiceActors,
            ]),
          });
        }
        renderPriceCard(record, historyHost);
      }
      if (!isCartPage(location.href)) {
        renderCompactInsight(priceHost, insight);
      }
      markDealProcessed(node, id);
    });
    injectBrowseControls();
    await applyBrowseSortAndFilter();
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
        officialPrice: item.officialPrice ||
          cartMetadata.get(String(item.id).toUpperCase())?.officialPrice || item.price || 0,
        title: item.title || cartMetadata.get(String(item.id).toUpperCase())?.title || item.id,
        cnyPrice: item.cnyPrice || cartMetadata.get(String(item.id).toUpperCase())?.cnyPrice || 0,
      });
      const cartSnapshot = {
        ...rawCartSnapshot,
        active: (rawCartSnapshot.active || rawCartSnapshot.products || []).map(enrich),
        later: (rawCartSnapshot.later || []).map(enrich),
      };
      cartSnapshot.products = cartSnapshot.active;
      latestDealContext = {
        coupons,
        cartSnapshot,
        partial: dealDataPartial || !rawCartSnapshot.loaded,
      };
      const cartProducts = cartSnapshot.loaded ? cartSnapshot.active : [];
      if (isProductPage(location.href)) {
        await enhanceProductDealDetail(coupons, cartProducts);
      }
      await enhanceGenericBrowseCards(coupons, cartProducts);
      if (isCartPage(location.href)) await sortBuyLaterItems();
      refreshOpenReachDialog();
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

      controls.appendChild(toggle);
      controls.appendChild(modeWrap);
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
    if (!isBuyLaterSortEnabled()) return;

    stampBuyLaterOriginalOrder();
    const ownerItems = getBuyLaterOwnerItems();
    if (!ownerItems.length) return;
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
      const originalOrder = Number(owner.dataset.dltrackerBuyLaterOrder);

      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push({
        node: owner,
        isNewLowest,
        reachRank,
        hypotheticalPrice,
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
        renderPriceCard(record, task.renderHost);
      } catch (error) {
        console.warn(`[${APP_NAME}] cart render failed:`, error);
        renderPriceCard(null, task.renderHost);
      }
    });

    await sortBuyLaterItems();
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
    if (shouldSave) saveCartSnapshot(cartSnapshot);
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
      injectCartDiagnosticPanel();
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
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
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

.dltracker-buy-later-mode {
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

.dltracker-buy-later-mode .dltracker-buy-later-mode-select {
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid #c9c9c9;
  background: #fff;
  color: #444;
  font-size: 12px;
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
    setInterval(() => onUrlChange(), 500);

    let domDebounceTimer = null;
    const domObserver = new MutationObserver(() => {
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
