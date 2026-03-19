// ==UserScript==
// @name         DL Price Tracker (Userscript)
// @namespace    https://github.com/Cassandra-fox/dlTracker
// @version      0.1.1-us
// @description  在 DLsite 页面显示史低价格，并支持导入收藏进行本地追踪
// @author       Cassandra-fox
// @match        https://www.dlsite.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      dlwatcher.com
// ==/UserScript==

(function () {
  'use strict';

  const APP_NAME = 'DL Price Tracker';
  const APP_VERSION = '0.1.1-us';

  const DLWATCHER_BASE = 'https://dlwatcher.com/product';
  const FAVORITE_API_PATH = '/girls/load/favorite/product';

  const BATCH_SIZE = 10;
  const BATCH_INTERVAL_MS = 1000;
  const REQUEST_TIMEOUT_MS = 10000;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_FAVORITES = 500;

  const RJ_CODE_REGEX = /\b([RB]J\d{6,})\b/i;
  const UI_CLASSNAME = 'dltracker-lowest-price-card';
  const STYLE_ID = 'dltracker-userscript-style';

  const DB_NAME = 'dltracker-userscript';
  const DB_VERSION = 1;
  const STORE_PRICES = 'prices';
  const STORE_FAVORITES = 'favorites';

  let dbPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function toYen(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return `${Math.round(value).toLocaleString('ja-JP')}円`;
  }

  function safeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  function toCsvCell(raw) {
    if (raw === undefined || raw === null) return '';
    const value = String(raw);
    const formulaPrefix = /^[=+\-@\t\r]/.test(value) ? "'" : '';
    if (formulaPrefix || value.includes(',') || value.includes('"') || value.includes('\n')) {
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

  function parseCurrentPrice() {
    const target = document.querySelector('#work_price')?.textContent;
    if (!target) return undefined;
    const cleaned = target.replace(/,/g, '');
    const matched = cleaned.match(/(\d{2,6})\s*円/);
    return matched ? Number(matched[1]) : undefined;
  }

  function parseTitle() {
    const h1 = document.querySelector('h1')?.textContent?.trim();
    return h1 || document.title;
  }

  function isValidRjCode(code) {
    return typeof code === 'string' && /^[RB]J\d{6,}$/i.test(code);
  }

  function isCacheFresh(record) {
    if (!record?.lastChecked) return false;
    const checkedAt = new Date(record.lastChecked).getTime();
    return Number.isFinite(checkedAt) && Date.now() - checkedAt < CACHE_TTL_MS;
  }

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PRICES)) {
          db.createObjectStore(STORE_PRICES, { keyPath: 'rjCode' });
        }
        if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
          db.createObjectStore(STORE_FAVORITES, { keyPath: 'rjCode' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });

    return dbPromise;
  }

  async function storeGet(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`IDB get failed: ${storeName}`));
    });
  }

  async function storePut(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`IDB put failed: ${storeName}`));
    });
  }

  async function storeDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`IDB delete failed: ${storeName}`));
    });
  }

  async function storeGetAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error(`IDB getAll failed: ${storeName}`));
    });
  }

  async function storeGetAllKeys(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => {
        const keys = Array.isArray(request.result) ? request.result : [];
        resolve(keys.map((x) => String(x)));
      };
      request.onerror = () => reject(request.error || new Error(`IDB getAllKeys failed: ${storeName}`));
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
      const safeLowest = typeof input.lowestPrice === 'number' ? input.lowestPrice : existing.lowestPrice;
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
        await upsertPriceRecord({ ...record, isFavorite: false, updatedAt: now });
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

  function gmRequestJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is unavailable'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
        },
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error instanceof Error ? error : new Error('JSON parse failed'));
          }
        },
        ontimeout: () => reject(new Error('Request timeout')),
        onerror: () => reject(new Error('Request failed')),
      });
    });
  }

  async function fetchPriceFromDlwatcher(rjCode) {
    try {
      const json = await gmRequestJson(buildApiUrl(rjCode), REQUEST_TIMEOUT_MS);
      const lowestPrice = safeNumber(json?.lowestPrice?.priceInfo?.price) ?? null;
      return {
        rjCode,
        title: typeof json?.productName === 'string' ? json.productName : undefined,
        lowestPrice,
        regularPrice: safeNumber(json?.lowestPrice?.priceInfo?.regularPrice),
        discountRate: safeNumber(json?.lowestPrice?.priceInfo?.discountRate),
        dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
      };
    } catch (error) {
      console.warn(`[${APP_NAME}] fetch ${rjCode} failed:`, error);
      return {
        rjCode,
        lowestPrice: null,
        dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
      };
    }
  }

  async function batchFetchPrices(rjCodes) {
    const result = new Map();
    for (let i = 0; i < rjCodes.length; i += BATCH_SIZE) {
      const batch = rjCodes.slice(i, i + BATCH_SIZE);
      const prices = await Promise.all(batch.map((code) => fetchPriceFromDlwatcher(code)));
      for (const item of prices) result.set(item.rjCode, item);
      if (i + BATCH_SIZE < rjCodes.length) {
        await sleep(BATCH_INTERVAL_MS);
      }
    }
    return result;
  }

  async function syncCurrentPrice(existing, currentPrice) {
    if (typeof currentPrice !== 'number') return existing;
    if (currentPrice === existing.currentPrice) return existing;

    const next = { ...existing, currentPrice, updatedAt: nowIso() };
    await upsertPriceRecord(next);
    return next;
  }

  async function fetchRemoteAndPersist(rjCode, title, currentPrice, existing, forcePersist) {
    const fetched = await fetchPriceFromDlwatcher(rjCode);
    if (fetched.lowestPrice === null) {
      if (existing) {
        const next = { ...existing, lastChecked: nowIso(), updatedAt: nowIso() };
        await upsertPriceRecord(next);
        return next;
      }
      return null;
    }

    const favoriteSet = new Set(await listFavoriteCodes());
    const record = {
      rjCode,
      title: existing?.title && existing.title !== rjCode ? existing.title : fetched.title || title || rjCode,
      currentPrice,
      lowestPrice: existing ? Math.min(existing.lowestPrice, fetched.lowestPrice) : fetched.lowestPrice,
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
    const {
      rjCode,
      title = rjCode,
      currentPrice,
      forceFetch = false,
      forcePersist = false,
    } = params;

    const existing = await getPriceRecord(rjCode);
    if (forceFetch) {
      return fetchRemoteAndPersist(rjCode, title, currentPrice, existing, forcePersist);
    }

    if (existing) {
      if (existing.isFavorite || isCacheFresh(existing)) {
        return syncCurrentPrice(existing, currentPrice);
      }
    }

    return fetchRemoteAndPersist(rjCode, title, currentPrice, existing, forcePersist);
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
          await upsertPriceRecord({ ...rec, lastChecked: nowIso(), updatedAt: nowIso() });
        }
        continue;
      }

      const existing = await getPriceRecord(rjCode);
      const record = {
        rjCode,
        title: existing?.title && existing.title !== rjCode ? existing.title : fetched.title || rjCode,
        currentPrice: existing?.currentPrice,
        lowestPrice: existing ? Math.min(existing.lowestPrice, fetched.lowestPrice) : fetched.lowestPrice,
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
      'RJ/BJ',
      'Title',
      'CurrentPrice',
      'LowestPrice',
      'RegularPrice',
      'DiscountRate',
      'LastChecked',
      'DlwatcherUrl',
      'IsFavorite',
      'FavoriteAddedAt',
      'UpdatedAt',
    ];

    const lines = [header.map(toCsvCell).join(',')];
    for (const record of records) {
      lines.push(
        [
          record.rjCode,
          record.title || '',
          record.currentPrice,
          record.lowestPrice,
          record.regularPrice,
          record.discountRate,
          record.lastChecked || '',
          record.dlwatcherUrl || '',
          record.isFavorite ? '1' : '0',
          record.favoriteAddedAt || '',
          record.updatedAt || '',
        ]
          .map(toCsvCell)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderPriceCard(record, host) {
    const existed = host.querySelector(`.${UI_CLASSNAME}`);
    if (existed) existed.remove();

    const card = document.createElement('div');
    card.className = UI_CLASSNAME;

    const chip = document.createElement('span');
    chip.className = 'dltracker-chip';

    if (!record) {
      chip.classList.add('dltracker-error');
      chip.textContent = '史低获取失败';
      card.appendChild(chip);
      host.appendChild(card);
      return;
    }

    const discountText =
      typeof record.discountRate === 'number' ? ` (${record.discountRate.toFixed(1)}%OFF)` : '';
    chip.textContent = `史低：${toYen(record.lowestPrice)}${discountText}`;

    const button = document.createElement('a');
    button.className = 'dltracker-btn';
    button.textContent = '查看价格趋势';
    button.href = record.dlwatcherUrl;
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.addEventListener('click', (event) => event.stopPropagation());

    card.appendChild(chip);
    card.appendChild(button);
    host.appendChild(card);
  }

  function renderLoadingCard(host) {
    const existed = host.querySelector(`.${UI_CLASSNAME}`);
    if (existed) existed.remove();

    const card = document.createElement('div');
    card.className = UI_CLASSNAME;

    const chip = document.createElement('span');
    chip.className = 'dltracker-chip';
    chip.textContent = '史低获取中...';

    card.appendChild(chip);
    host.appendChild(card);
  }

  async function enhanceProductPage() {
    const pathMatch = location.pathname.match(/product_id\/([RB]J\d{6,})/i);
    const rjCode = pathMatch ? pathMatch[1].toUpperCase() : extractRjCodeFromUrl(location.href);
    if (!rjCode) return;

    const host = document.querySelector('#work_price .work_buy_container') || document.querySelector('#work_price');
    if (!host) return;

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
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`收藏接口返回异常: ${response.status}`);
    }

    const data = await response.json();
    const favorites = Array.isArray(data?.favorites) ? data.favorites : [];
    return favorites
      .map((x) => (typeof x === 'string' ? x.toUpperCase() : ''))
      .filter((x) => RJ_CODE_REGEX.test(x));
  }

  function parseFavoriteCodesFromDom() {
    const links = document.querySelectorAll('a[href*="product_id/"]');
    const codeSet = new Set();
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const matched = href.match(/product_id\/([RB]J\d{6,})/i);
      if (matched) codeSet.add(matched[1].toUpperCase());
    }
    return [...codeSet];
  }

  function createActionButton(text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    return button;
  }

  function injectFavoriteImportBox() {
    if (document.querySelector('.dltracker-import-box')) return;

    const baseTitle = document.querySelector('#main_inner > div.base_title');
    const anchor = baseTitle?.parentElement || document.body;

    const box = document.createElement('div');
    box.className = 'dltracker-import-box';

    const text = document.createElement('span');
    text.textContent = `${APP_NAME}：可导入收藏并抓取史低价`;

    const importBtn = createActionButton('导入收藏');
    const updateBtn = createActionButton('更新收藏价');
    const exportBtn = createActionButton('导出CSV');

    const status = document.createElement('span');
    status.className = 'dltracker-import-status';

    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      status.textContent = '正在获取收藏列表...';

      try {
        let codes = parseFavoriteCodesFromDom();
        if (!codes.length) {
          codes = await fetchFavoriteCodesFromApi();
        }

        if (!codes.length) {
          status.textContent = '未获取到收藏作品';
          return;
        }

        status.textContent = `已获取 ${codes.length} 个收藏，正在同步史低...`;
        const result = await handleImportFavorites(codes, false);
        status.textContent = `导入完成：成功同步 ${result.imported} 条`;
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        status.textContent = `导入失败：${message}`;
      } finally {
        importBtn.disabled = false;
      }
    });

    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      status.textContent = '正在更新全部收藏...';

      try {
        const favoriteCodes = await listFavoriteCodes();
        if (!favoriteCodes.length) {
          status.textContent = '本地暂无收藏记录，请先导入收藏';
          return;
        }

        const result = await handleImportFavorites(favoriteCodes, true);
        status.textContent = `更新完成：成功同步 ${result.imported} 条`;
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        status.textContent = `更新失败：${message}`;
      } finally {
        updateBtn.disabled = false;
      }
    });

    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      status.textContent = '正在导出 CSV...';

      try {
        const records = (await listPriceRecords())
          .filter((record) => record.isFavorite)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

        const csv = recordsToCsv(records);
        const fileName = `dltracker-userscript-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadText(fileName, csv, 'text/csv;charset=utf-8;');
        status.textContent = `CSV 导出完成：${records.length} 条`;
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
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

    if (baseTitle && baseTitle.nextSibling) {
      anchor.insertBefore(box, baseTitle.nextSibling);
    } else if (baseTitle) {
      anchor.appendChild(box);
    } else {
      anchor.prepend(box);
    }
  }

  async function enhanceWishlistCards() {
    const cards = document.querySelectorAll('#wishlist_work article');
    if (!cards.length) return;

    for (const card of cards) {
      const priceHost = card.querySelector('div.primary dl dd.work_price_wrap');
      if (!priceHost) continue;
      if (priceHost.querySelector(`.${UI_CLASSNAME}`)) continue;

      const link = card.querySelector('a[href*="product_id/"]');
      const href = link?.getAttribute('href') || '';
      const matched = href.match(/product_id\/([RB]J\d{6,})/i);
      if (!matched) continue;

      const rjCode = matched[1].toUpperCase();
      const title = link?.textContent?.trim() || rjCode;

      renderLoadingCard(priceHost);

      void buildOrUpdateRecord({
        rjCode,
        title,
        forceFetch: false,
      }).then((record) => renderPriceCard(record, priceHost));
    }
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
    const selector = isProductPage(url) ? '#work_price' : isFavoritePage(url) ? '#wishlist_work' : null;
    if (!selector) return Promise.resolve();

    return new Promise((resolve) => {
      if (document.querySelector(selector)) {
        resolve();
        return;
      }

      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
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
      injectFavoriteImportBox();
      await enhanceWishlistCards();
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.${UI_CLASSNAME} {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.${UI_CLASSNAME} .dltracker-chip {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 6px;
  color: #fff;
  background: #1f8f4e;
  font-weight: 700;
}

.${UI_CLASSNAME} .dltracker-btn {
  display: inline-flex;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  color: #fff;
  background: #2463eb;
  cursor: pointer;
}

.${UI_CLASSNAME} .dltracker-error {
  background: #cb2f2f;
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
  color: #666;
  font-size: 12px;
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

    window.addEventListener('popstate', () => onUrlChange());
    setInterval(() => onUrlChange(), 500);

    let domDebounceTimer = null;
    const domObserver = new MutationObserver(() => {
      if (domDebounceTimer) return;
      domDebounceTimer = setTimeout(() => {
        domDebounceTimer = null;
        if (!isProductPage(location.href)) return;
        const host = document.querySelector('#work_price .work_buy_container') || document.querySelector('#work_price');
        if (host && !host.querySelector(`.${UI_CLASSNAME}`)) {
          void bootstrap();
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
