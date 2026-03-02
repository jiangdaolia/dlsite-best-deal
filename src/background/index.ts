import type { RuntimeRequest, RuntimeResponse, PriceRecord } from '@/shared/types';
import { CACHE_TTL_MS, MAX_FAVORITES } from '@/shared/constants';
import { extractRjCodeFromUrl, nowIso } from '@/shared/utils';

/** 运行时验证 RJ/BJ 编号格式，防止注入 */
function isValidRjCode(code: unknown): code is string {
  return typeof code === 'string' && /^[RB]J\d{6,}$/i.test(code);
}

/** 判断缓存记录是否在 TTL（24h）内，无需重新请求 DLwatcher */
function isCacheFresh(record: PriceRecord): boolean {
  if (!record.lastChecked) return false;
  const checkedAt = new Date(record.lastChecked).getTime();
  return Date.now() - checkedAt < CACHE_TTL_MS;
}
import {
  clearFavoriteFlagForMissing,
  deletePriceRecord,
  getPriceRecord,
  listFavoriteCodes,
  listNonFavoriteRecords,
  listPriceRecords,
  markFavorites,
  upsertPriceRecord,
} from '@/db/repository';
import { batchFetchPrices, fetchPriceFromDlwatcher } from '@/services/dlwatcher';
import { recordsToCsv } from './csv';

// ---- MV3 Service Worker 保活 ----
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepAlive(): void {
  if (keepAliveInterval) return;
  // 每 25 秒触发一次轻量 API 调用，防止 worker 被回收
  keepAliveInterval = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 25_000);
}

function stopKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function buildOrUpdateRecord(params: {
  rjCode: string;
  title?: string;
  currentPrice?: number;
  forceFetch: boolean;
  forcePersist?: boolean;
}): Promise<PriceRecord | null> {
  const { rjCode, title = rjCode, currentPrice, forceFetch, forcePersist = false } = params;

  const existing = await getPriceRecord(rjCode);

  // ── 强制刷新（管理页「更新」按钮）──
  // 直接向 DLwatcher 请求，不论缓存状态
  if (forceFetch) {
    return await fetchRemoteAndPersist(rjCode, title, currentPrice, existing, forcePersist);
  }

  // ── 非强制模式（浏览作品页 / tabs.onUpdated）──
  if (existing) {
    // 收藏作品（永久存储）：永远使用本地数据，仅同步页面当前价
    // 只通过「更新收藏」按钮手动刷新
    if (existing.isFavorite) {
      return await syncCurrentPrice(existing, currentPrice);
    }

    // 非收藏作品（24h 缓存）：TTL 内直接返回缓存
    if (isCacheFresh(existing)) {
      return await syncCurrentPrice(existing, currentPrice);
    }

    // 缓存过期 → 重新从 DLwatcher 获取（fall through）
  }

  // 无本地数据 或 非收藏缓存过期：请求 DLwatcher 并存储
  return await fetchRemoteAndPersist(rjCode, title, currentPrice, existing, forcePersist);
}

/** 同步页面当前价到本地记录，不触发远程请求，不更新 lastChecked */
async function syncCurrentPrice(existing: PriceRecord, currentPrice?: number): Promise<PriceRecord> {
  if (typeof currentPrice !== 'number') return existing;

  // 当前价变化：同步
  if (currentPrice !== existing.currentPrice) {
    const next: PriceRecord = { ...existing, currentPrice, updatedAt: nowIso() };
    await upsertPriceRecord(next);
    return next;
  }

  return existing;
}

/** 从 DLwatcher 获取数据并写入 IndexedDB */
async function fetchRemoteAndPersist(
  rjCode: string,
  title: string,
  currentPrice: number | undefined,
  existing: PriceRecord | undefined,
  forcePersist: boolean,
): Promise<PriceRecord | null> {
  const fetched = await fetchPriceFromDlwatcher(rjCode);
  if (fetched.lowestPrice === null) {
    // DLwatcher 无数据也更新 lastChecked，表示已尝试检查
    if (existing) {
      const next: PriceRecord = { ...existing, lastChecked: nowIso(), updatedAt: nowIso() };
      await upsertPriceRecord(next);
      return next;
    }
    return null;
  }

  const favoriteSet = new Set(await listFavoriteCodes());

  const record: PriceRecord = {
    rjCode,
    title: existing?.title && existing.title !== rjCode ? existing.title : (fetched.title || title),
    currentPrice,
    lowestPrice: existing ? Math.min(existing.lowestPrice, fetched.lowestPrice) : fetched.lowestPrice,
    regularPrice: fetched.regularPrice,
    discountRate: fetched.discountRate,
    lastChecked: nowIso(),
    dlwatcherUrl: fetched.dlwatcherUrl,
    isFavorite: existing?.isFavorite || favoriteSet.has(rjCode),
    favoriteAddedAt: existing?.favoriteAddedAt,
    tags: existing?.tags || [],
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };

  // 收藏作品 / 已有记录 / 强制持久化：当然写入
  // 非收藏浏览：也写入，作为 24h 缓存
  await upsertPriceRecord(record);

  return record;
}

async function handleImportFavorites(rjCodes: string[], skipCache = false): Promise<RuntimeResponse<{ imported: number }>> {
  if (!rjCodes.length) {
    return { ok: true, data: { imported: 0 } };
  }

  // 上限截断
  const codes = rjCodes.slice(0, MAX_FAVORITES);

  await markFavorites(codes);
  await clearFavoriteFlagForMissing(new Set(codes));

  startKeepAlive();
  let imported = 0;

  try {
    // 过滤掉 24h 内已请求过的作品，减少对 DLwatcher 的请求
    // skipCache=true 时（用户手动触发「更新收藏」）跳过 TTL 过滤
    const staleCodes: string[] = [];
    for (const code of codes) {
      if (skipCache) {
        staleCodes.push(code);
        continue;
      }
      const cached = await getPriceRecord(code);
      if (cached && isCacheFresh(cached)) {
        imported += 1; // 缓存有效，直接计入
      } else {
        staleCodes.push(code);
      }
    }
    console.log(`[DLTracker] import: ${codes.length} total, ${staleCodes.length} need fetch, ${imported} cached`);

    if (staleCodes.length === 0) {
      return { ok: true, data: { imported } };
    }

    const prices = await batchFetchPrices(staleCodes, {
      keepAlive: () => void chrome.runtime.getPlatformInfo(),
    });
    const successCount = [...prices.values()].filter((p) => p.lowestPrice !== null).length;
    const failCount = prices.size - successCount;
    console.log(`[DLTracker] batchFetch done, map.size=${prices.size}, success=${successCount}, fail=${failCount}`);

    for (const rjCode of staleCodes) {
    const fetched = prices.get(rjCode);
    if (!fetched || fetched.lowestPrice === null) {
      console.warn(`[DLTracker] skip ${rjCode}: no price data`);
      // DLwatcher 无数据也更新 lastChecked，表示已尝试检查
      const rec = await getPriceRecord(rjCode);
      if (rec) {
        await upsertPriceRecord({ ...rec, lastChecked: nowIso(), updatedAt: nowIso() });
      }
      continue;
    }

    const existing = await getPriceRecord(rjCode);
    const record: PriceRecord = {
      rjCode,
      title: existing?.title && existing.title !== rjCode ? existing.title : (fetched.title || rjCode),
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
  } finally {
    stopKeepAlive();
  }

  return { ok: true, data: { imported } };
}

function responseOk<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function responseError(message: string): RuntimeResponse {
  return { ok: false, error: message };
}

chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  void (async () => {
    try {
      if (request.type === 'GET_OR_FETCH_PRICE') {
        const { rjCode, title, currentPrice } = request.payload;
        if (!isValidRjCode(rjCode)) {
          sendResponse(responseError('无效的作品编号'));
          return;
        }
        const record = await buildOrUpdateRecord({
          rjCode: rjCode.toUpperCase(),
          title,
          currentPrice,
          forceFetch: false,
        });
        sendResponse(responseOk(record));
        return;
      }

      if (request.type === 'IMPORT_FAVORITES') {
        const validCodes = request.payload.rjCodes.filter(isValidRjCode).map((c) => c.toUpperCase());
        const result = await handleImportFavorites(validCodes);
        sendResponse(result);
        return;
      }

      if (request.type === 'LIST_RECORDS') {
        const records = await listPriceRecords();
        sendResponse(responseOk(records));
        return;
      }

      if (request.type === 'UPDATE_ONE') {
        const { rjCode } = request.payload;
        if (!isValidRjCode(rjCode)) {
          sendResponse(responseError('无效的作品编号'));
          return;
        }
        const updated = await buildOrUpdateRecord({
          rjCode: rjCode.toUpperCase(),
          forceFetch: true,
          forcePersist: true,
        });
        sendResponse(responseOk(updated));
        return;
      }

      if (request.type === 'UPDATE_ALL_FAVORITES') {
        const favoriteCodes = await listFavoriteCodes();
        const result = await handleImportFavorites(favoriteCodes, true);
        sendResponse(result);
        return;
      }

      if (request.type === 'GET_STATS') {
        const records = await listPriceRecords();
        const favorites = records.filter((r) => r.isFavorite);
        const discounted = records.filter(
          (r) => typeof r.currentPrice === 'number' && r.currentPrice <= r.lowestPrice,
        );
        sendResponse(
          responseOk({
            total: records.length,
            favorites: favorites.length,
            discounted: discounted.length,
          }),
        );
        return;
      }

      if (request.type === 'EXPORT_CSV') {
        const records = await listPriceRecords();
        const csv = recordsToCsv(records);
        sendResponse(responseOk({ csv }));
        return;
      }

      sendResponse(responseError('未知请求类型'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '后台处理失败';
      sendResponse(responseError(message));
    }
  })();

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) {
    return;
  }

  // 仅处理 DLsite 域名，避免向外部泄露浏览信息
  if (!tab.url.startsWith('https://www.dlsite.com/')) {
    return;
  }

  const rjCode = extractRjCodeFromUrl(tab.url);
  if (!rjCode) {
    return;
  }

  void buildOrUpdateRecord({
    rjCode,
    forceFetch: false,
  });
});

// ---- 缓存清理：删除过期的非收藏记录 ----
async function cleanExpiredCache(): Promise<void> {
  const nonFavorites = await listNonFavoriteRecords();
  let cleaned = 0;

  for (const record of nonFavorites) {
    if (!isCacheFresh(record)) {
      await deletePriceRecord(record.rjCode);
      cleaned += 1;
    }
  }

  if (cleaned > 0) {
    console.log(`[DLTracker] cleaned ${cleaned} expired cache entries`);
  }
}

// Service Worker 启动时执行一次缓存清理
void cleanExpiredCache();
