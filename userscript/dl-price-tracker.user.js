// ==UserScript==
// @name         DL Price Tracker
// @namespace    https://github.com/syoius/dlTracker4TamperMonkey
// @version      0.1.1.1
// @description  在 DLsite 页面显示史低价格，并支持导入收藏进行本地追踪
// @author       Syoius & Cassandra-fox
// @match        https://www.dlsite.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      dlwatcher.com
// @updateURL    https://github.com/syoius/dlTracker4TamperMonkey/raw/refs/heads/main/userscript/dl-price-tracker.user.js
// @downloadURL  https://github.com/syoius/dlTracker4TamperMonkey/raw/refs/heads/main/userscript/dl-price-tracker.user.js
// ==/UserScript==

(function () {
  "use strict";

  const APP_NAME = "DL Price Tracker";
  const APP_VERSION = "0.1.1.1";

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

  function nowIso() {
    return new Date().toISOString();
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
    const showOffBadge =
      discounted &&
      (!isCartContext || isAtLowest || isMobileCartContext);
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

    if (!tasks.length) return;

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
  justify-content: center;
  text-align: center;
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
