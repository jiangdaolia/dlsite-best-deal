import type { RuntimeRequest, RuntimeResponse, PriceRecord } from '@/shared/types';
import { MAX_FAVORITES } from '@/shared/constants';
import { extractRjCodeFromUrl, nowIso } from '@/shared/utils';
import {
  clearFavoriteFlagForMissing,
  getPriceRecord,
  listFavoriteCodes,
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
  if (existing && !forceFetch) {
    if (typeof currentPrice === 'number' && currentPrice < existing.lowestPrice) {
      const next: PriceRecord = {
        ...existing,
        currentPrice,
        lowestPrice: currentPrice,
        lastChecked: nowIso(),
        updatedAt: nowIso(),
      };
      await upsertPriceRecord(next);
      return next;
    }

    if (typeof currentPrice === 'number' && currentPrice !== existing.currentPrice) {
      await upsertPriceRecord({
        ...existing,
        currentPrice,
        lastChecked: nowIso(),
        updatedAt: nowIso(),
      });
    }

    return existing;
  }

  const fetched = await fetchPriceFromDlwatcher(rjCode);
  if (fetched.lowestPrice === null) {
    return existing ?? null;
  }

  const favoriteSet = new Set(await listFavoriteCodes());
  const shouldPersist = forcePersist || favoriteSet.has(rjCode) || Boolean(existing);

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

  if (shouldPersist) {
    await upsertPriceRecord(record);
  }

  return record;
}

async function handleImportFavorites(rjCodes: string[]): Promise<RuntimeResponse<{ imported: number }>> {
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
    console.log(`[DLTracker] batchFetch start, total=${codes.length}`);
    const prices = await batchFetchPrices(codes, {
      keepAlive: () => void chrome.runtime.getPlatformInfo(),
    });
    const successCount = [...prices.values()].filter((p) => p.lowestPrice !== null).length;
    const failCount = prices.size - successCount;
    console.log(`[DLTracker] batchFetch done, map.size=${prices.size}, success=${successCount}, fail=${failCount}`);

    for (const rjCode of codes) {
    const fetched = prices.get(rjCode);
    if (!fetched || fetched.lowestPrice === null) {
      console.warn(`[DLTracker] skip ${rjCode}: no price data`);
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
        const record = await buildOrUpdateRecord({
          rjCode,
          title,
          currentPrice,
          forceFetch: false,
        });
        sendResponse(responseOk(record));
        return;
      }

      if (request.type === 'IMPORT_FAVORITES') {
        const result = await handleImportFavorites(request.payload.rjCodes);
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
        const updated = await buildOrUpdateRecord({
          rjCode,
          forceFetch: true,
          forcePersist: true,
        });
        sendResponse(responseOk(updated));
        return;
      }

      if (request.type === 'UPDATE_ALL_FAVORITES') {
        const favoriteCodes = await listFavoriteCodes();
        const result = await handleImportFavorites(favoriteCodes);
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

  const rjCode = extractRjCodeFromUrl(tab.url);
  if (!rjCode) {
    return;
  }

  void buildOrUpdateRecord({
    rjCode,
    forceFetch: false,
  });
});
