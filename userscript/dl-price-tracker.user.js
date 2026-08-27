// ==UserScript==
// @name         DLsite 最优买法 + 史低
// @namespace    https://github.com/jiangdaolia/dlsite-best-deal
// @version      0.3.1
// @description  在 DLsite 页面显示史低价格，自动读取优惠券并计算最优拆单方案
// @author       Syoius & Cassandra-fox; deal planner maintained by jiangdaolia
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
  const APP_VERSION = "0.3.1";

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
  const BUY_LATER_SORT_MODE_PRICE = "price";
  const BUY_LATER_SORT_MODE_DISCOUNT = "discount";
  const UPDATE_NOTICE_SEEN_VERSION_KEY = "dltracker-update-notice-seen-version";
  const DEAL_PLANNER_STORAGE_KEY = "dltracker-deal-planner-v1";
  const DEAL_PLANNER_MAX_ITEMS = 12;
  const DEAL_PLANNER_MAX_COUPONS = 8;
  const DLSITE_COUPON_API_PATH = "/books/mypage/coupon/list/ajax";
  const DLSITE_PRODUCT_INFO_PATH = "/maniax/product/info/ajax";
  const COUPON_IMPORT_TTL_MS = 5 * 60 * 1000;
  const RELEASE_NOTES = {
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

  let dbPromise = null;
  const recordInFlight = new Map();
  const canonicalRjCache = new Map();
  let couponImportInFlight = null;
  let importedCouponPageUrl = "";

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

  function quotePlannerOrder(items, mask, coupon = null) {
    const selected = selectedPlannerIndexes(mask, items.length);
    if (!selected.length) return null;

    const eligible = coupon
      ? selected.filter(
          (index) =>
            coupon.allEligible ||
            coupon.eligibleIds.includes(items[index].id),
        )
      : [];
    if (coupon && !eligible.length) return null;

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

  function betterPlannerPlan(candidate, current) {
    if (!current) return true;
    if (candidate.total !== current.total) return candidate.total < current.total;
    if (candidate.orders.length !== current.orders.length) {
      return candidate.orders.length < current.orders.length;
    }
    return candidate.discount > current.discount;
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

    const oneTimeIndexes = [];
    const repeatableIndexes = [];
    coupons.forEach((coupon, index) => {
      (coupon.repeatable ? repeatableIndexes : oneTimeIndexes).push(index);
    });

    // 可重复券可以用于不同订单，但每次报价仍只包含一张券。
    // minimumPosition 强制券序非递减，去掉等价的拆单排列。
    const repeatableMemo = new Map();
    const solveRepeatable = (minimumPosition, remainingMask) => {
      const key = `${minimumPosition}:${remainingMask}`;
      if (repeatableMemo.has(key)) return repeatableMemo.get(key);
      const base = getBaseQuote(remainingMask);
      let best = {
        total: base?.total || 0,
        discount: 0,
        orders: base ? [base] : [],
      };
      for (
        let position = minimumPosition;
        position < repeatableIndexes.length;
        position += 1
      ) {
        const couponIndex = repeatableIndexes[position];
        for (
          let orderMask = remainingMask;
          orderMask > 0;
          orderMask = (orderMask - 1) & remainingMask
        ) {
          const quote = getCouponQuote(couponIndex, orderMask);
          if (!quote || quote.discount <= 0) continue;
          const rest = solveRepeatable(
            position,
            remainingMask ^ orderMask,
          );
          const candidate = {
            total: quote.total + rest.total,
            discount: quote.discount + rest.discount,
            orders: [quote, ...rest.orders],
          };
          if (betterPlannerPlan(candidate, best)) best = candidate;
        }
      }
      repeatableMemo.set(key, best);
      return best;
    };

    const memo = new Map();
    const solve = (couponPosition, remainingMask) => {
      const key = `${couponPosition}:${remainingMask}`;
      if (memo.has(key)) return memo.get(key);
      if (couponPosition >= oneTimeIndexes.length) {
        const result = solveRepeatable(0, remainingMask);
        memo.set(key, result);
        return result;
      }

      const couponIndex = oneTimeIndexes[couponPosition];
      let best = solve(couponPosition + 1, remainingMask);
      for (
        let orderMask = remainingMask;
        orderMask > 0;
        orderMask = (orderMask - 1) & remainingMask
      ) {
        const quote = getCouponQuote(couponIndex, orderMask);
        if (!quote || quote.discount <= 0) continue;
        const rest = solve(couponPosition + 1, remainingMask ^ orderMask);
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
    const best = solve(0, fullMask);
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
    return /\/product_id\/[RB]J\d+/i.test(url);
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
    if (fromData && isValidRjCode(fromData)) return fromData.toUpperCase();

    const link = item.querySelector('a[href*="product_id/"]');
    const href = link?.getAttribute("href") || "";
    const matched = href.match(/product_id\/([RB]J\d{6,})/i);
    return matched ? matched[1].toUpperCase() : null;
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
    if (ownerItem.classList?.contains("_removed")) return false;
    if (ownerItem.getAttribute("style")?.includes("display:none")) return false;
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
          .filter((id) => RJ_CODE_REGEX.test(id))
      : [];
    const unrestricted = ["", "all", "all_product", "product_all"].includes(
      conditionType,
    );
    const repeatable = inferRepeatableCoupon(raw, combinedText);
    const warnings = [];
    if (
      !unrestricted &&
      !["id_all", "custom_genre", "site_ids", "worktype"].includes(
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

  function renderCouponImportStatus(status, isError = false) {
    let box = document.querySelector(".dltracker-coupon-import-status");
    if (!box) {
      box = document.createElement("div");
      box.className = "dltracker-coupon-import-status";
      (document.querySelector("#main_inner, main") || document.body).prepend(box);
    }
    box.classList.toggle("is-error", isError);
    box.textContent = status;
  }

  async function importDlsiteCoupons() {
    if (couponImportInFlight) return couponImportInFlight;
    couponImportInFlight = (async () => {
      renderCouponImportStatus("最优买法：正在从当前账号读取优惠券…");
      const response = await fetch(
        new URL(DLSITE_COUPON_API_PATH, location.origin),
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(`优惠券接口返回 HTTP ${response.status}`);
      }
      const payload = await response.json();
      const now = Date.now();
      const imported = couponArrayFromPayload(payload)
        .map(normalizeDlsiteCoupon)
        .filter(Boolean)
        .filter((coupon) => !coupon.expiresAt || Date.parse(coupon.expiresAt) > now);
      const state = getPlannerState();
      const manual = state.coupons.filter((coupon) => coupon?.source !== "dlsite");
      state.coupons = [...manual, ...imported];
      state.lastCouponImport = {
        at: nowIso(),
        count: imported.length,
        repeatableCount: imported.filter((coupon) => coupon.repeatable).length,
      };
      savePlannerState(state);
      renderCouponImportStatus(
        `最优买法：已自动导入 ${imported.length} 张有效优惠券` +
          (state.lastCouponImport.repeatableCount
            ? `，其中 ${state.lastCouponImport.repeatableCount} 张期限内可重复使用`
            : "") +
          "。无需打开“适用作品”长列表。",
      );
      return imported;
    })().catch((error) => {
      console.warn(`[${APP_NAME}] import coupons failed:`, error);
      renderCouponImportStatus(
        `最优买法：自动读取失败（${error instanceof Error ? error.message : String(error)}）。请确认已登录后刷新本页。`,
        true,
      );
      return [];
    }).finally(() => {
      couponImportInFlight = null;
    });
    return couponImportInFlight;
  }

  async function ensureDlsiteCoupons(force = false) {
    const lastImport = getPlannerState().lastCouponImport;
    const importedAt = Date.parse(lastImport?.at || "");
    if (
      !force &&
      Number.isFinite(importedAt) &&
      Date.now() - importedAt < COUPON_IMPORT_TTL_MS
    ) {
      return getPlannerState().coupons.filter(
        (coupon) => coupon?.source === "dlsite",
      );
    }
    return importDlsiteCoupons();
  }

  async function enhanceCouponPage() {
    if (!isCouponPage(location.href)) return;
    if (importedCouponPageUrl === location.href) return;
    importedCouponPageUrl = location.href;
    await ensureDlsiteCoupons(true);
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
    return false;
  }

  async function resolveImportedCouponEligibility(items, coupons) {
    const dynamicTypes = new Set(["custom_genre", "site_ids", "worktype"]);
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
      if (raw === BUY_LATER_SORT_MODE_DISCOUNT) {
        return BUY_LATER_SORT_MODE_DISCOUNT;
      }
      return BUY_LATER_SORT_MODE_PRICE;
    } catch {
      return BUY_LATER_SORT_MODE_PRICE;
    }
  }

  function setBuyLaterSortMode(mode) {
    const normalized =
      mode === BUY_LATER_SORT_MODE_DISCOUNT
        ? BUY_LATER_SORT_MODE_DISCOUNT
        : BUY_LATER_SORT_MODE_PRICE;
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
      text.textContent = "优先显示史低作品";

      toggle.appendChild(input);
      toggle.appendChild(text);

      const modeWrap = document.createElement("label");
      modeWrap.className = "dltracker-buy-later-mode";

      const modeLabel = document.createElement("span");
      modeLabel.textContent = "次级排序";

      const modeSelect = document.createElement("select");
      modeSelect.className = "dltracker-buy-later-mode-select";
      modeSelect.innerHTML = `
        <option value="${BUY_LATER_SORT_MODE_PRICE}">低价优先</option>
        <option value="${BUY_LATER_SORT_MODE_DISCOUNT}">折扣优先</option>
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

  function isBuyLaterCartItem(item) {
    const owner = getCartOwnerItem(item);
    const ownerId = String(owner?.id || "");
    if (/^buy_later_/i.test(ownerId)) return true;
    if (owner?.matches?.(".__buy_later_target")) return true;
    if (owner?.querySelector?.(".__buy_later_target")) return true;
    return false;
  }

  function getRecordCompareCurrentPrice(record) {
    return (
      safeNumber(record?.dlwatcherCurrentPrice) ??
      safeNumber(record?.currentPrice)
    );
  }

  function getRecordDiscountScore(record) {
    const discountRate = safeNumber(record?.discountRate);
    if (typeof discountRate === "number" && discountRate > 0) {
      return discountRate;
    }

    const regularPrice = safeNumber(record?.regularPrice);
    const lowestPrice = safeNumber(record?.lowestPrice);
    if (
      typeof regularPrice === "number" &&
      typeof lowestPrice === "number" &&
      regularPrice > 0
    ) {
      return Math.max(0, (1 - lowestPrice / regularPrice) * 100);
    }

    return 0;
  }

  function isRecordNewLowest(record) {
    const compareCurrent = getRecordCompareCurrentPrice(record);
    const lowestPrice = safeNumber(record?.lowestPrice);
    if (typeof compareCurrent !== "number" || typeof lowestPrice !== "number") {
      return false;
    }
    return (
      hasEffectiveDiscount(record) &&
      Math.abs(compareCurrent - lowestPrice) < 0.01
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
      const isNewLowest = isRecordNewLowest(record);
      const compareCurrent = getRecordCompareCurrentPrice(record);
      const currentRank =
        typeof compareCurrent === "number"
          ? compareCurrent
          : Number.POSITIVE_INFINITY;
      const discountRank = getRecordDiscountScore(record);

      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push({
        node: owner,
        isNewLowest,
        currentRank,
        discountRank,
        order: grouped.get(parent).length,
      });
    }

    for (const [parent, entries] of grouped.entries()) {
      entries.sort((a, b) => {
        if (a.isNewLowest !== b.isNewLowest) {
          return a.isNewLowest ? -1 : 1;
        }
        if (sortMode === BUY_LATER_SORT_MODE_DISCOUNT) {
          if (a.discountRank !== b.discountRank) {
            return b.discountRank - a.discountRank;
          }
          if (a.currentRank !== b.currentRank) {
            return a.currentRank - b.currentRank;
          }
        } else {
          if (a.currentRank !== b.currentRank) {
            return a.currentRank - b.currentRank;
          }
          if (a.discountRank !== b.discountRank) {
            return b.discountRank - a.discountRank;
          }
        }
        return a.order - b.order;
      });

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
      if (cached) {
        fetched = {
          rjCode: code,
          title: cached.title,
          dlwatcherCurrentPrice: cached.dlwatcherCurrentPrice,
          lowestPrice: cached.lowestPrice,
          regularPrice: cached.regularPrice,
          discountRate: cached.discountRate,
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
        if (cached) {
          fetched = {
            rjCode: resolved,
            title: cached.title,
            dlwatcherCurrentPrice: cached.dlwatcherCurrentPrice,
            lowestPrice: cached.lowestPrice,
            regularPrice: cached.regularPrice,
            discountRate: cached.discountRate,
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
        if (cacheReusable && hasUsableLowestPrice(existing)) {
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
    if (isProductPage(location.href)) {
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
    chip.className = "dltracker-chip";

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

    if (typeof compareCurrent === "number" && !isAtLowest) {
      const currentChip = document.createElement("span");
      currentChip.className = "dltracker-chip dltracker-chip-current";
      currentChip.textContent = `当前 ${toYen(compareCurrent)}`;
      card.appendChild(currentChip);
    }

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
    if (!rjCode) return;

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
    injectDealPlanner();
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
    const items = getCartItems();
    if (
      items.some(
        (item) =>
          isRenderableCartItem(item) && !item.querySelector(`.${UI_CLASSNAME}`),
      )
    ) {
      scheduleCartBootstrap();
    }
    return true;
  }

  function maybeBootstrapForWishlistMutation(currentUrl) {
    if (!isFavoritePage(currentUrl)) return false;
    const cards = getWishlistCards();
    if (cards.some((card) => !card.querySelector(`.${UI_CLASSNAME}`))) {
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
    if (!isCartPage(url)) {
      document.querySelector(".dltracker-deal-planner")?.remove();
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
      await enhanceCartItems();
    }
    if (isCouponPage(url)) {
      await enhanceCouponPage();
    }
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
  flex-wrap: nowrap;
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

.dltracker-coupon-import-status {
  margin: 12px 0;
  padding: 10px 13px;
  border: 1px solid #9ae6b4;
  border-radius: 8px;
  background: #f0fff4;
  color: #22543d;
  font-size: 13px;
  line-height: 1.5;
}

.dltracker-coupon-import-status.is-error {
  border-color: #feb2b2;
  background: #fff5f5;
  color: #9b2c2c;
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

        if (isProductPage(currentUrl)) {
          const host = findProductRenderHost();
          if (host && !host.querySelector(`.${UI_CLASSNAME}`)) {
            void bootstrap();
          }
          return;
        }

        if (maybeBootstrapForWishlistMutation(currentUrl)) return;
        if (maybeBootstrapForCartMutation(currentUrl)) return;

        if (hasCartContainer() || hasWishlistContainer()) {
          scheduleCartBootstrap();
        }
      }, 300);
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function start() {
    try {
      injectStyle();
      showUpdateNoticeIfNeeded();
      await cleanExpiredCache();
      await bootstrap();
      installSpaListeners();
      console.log(`[${APP_NAME}] userscript started (${APP_VERSION})`);
    } catch (error) {
      console.error(`[${APP_NAME}] startup failed:`, error);
    }
  }

  void start();
})();
