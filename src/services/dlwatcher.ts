import {
  BATCH_INTERVAL_MS,
  BATCH_SIZE,
  DLWATCHER_BASE,
  REQUEST_TIMEOUT_MS,
} from '@/shared/constants';
import type { DlWatcherPriceResponse, FetchPriceResult } from '@/shared/types';
import { safeNumber, sleep } from '@/shared/utils';

function buildApiUrl(rjCode: string): string {
  return `${DLWATCHER_BASE}/${rjCode}.json`;
}

export function buildDlwatcherPageUrl(rjCode: string): string {
  return `${DLWATCHER_BASE}/${rjCode}/`;
}

export async function fetchPriceFromDlwatcher(rjCode: string): Promise<FetchPriceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildApiUrl(rjCode), {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[DLTracker] fetch ${rjCode} HTTP ${response.status}`);
      return {
        rjCode,
        lowestPrice: null,
        dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
      };
    }

    const json = (await response.json()) as DlWatcherPriceResponse;
    const lowestPrice = safeNumber(json.lowestPrice?.priceInfo?.price) ?? null;
    console.log(`[DLTracker] fetch ${rjCode} → lowestPrice=${lowestPrice}`);

    return {
      rjCode,
      title: json.productName || undefined,
      lowestPrice,
      regularPrice: safeNumber(json.lowestPrice?.priceInfo?.regularPrice),
      discountRate: safeNumber(json.lowestPrice?.priceInfo?.discountRate),
      dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
    };
  } catch (err) {
    console.error(`[DLTracker] fetch ${rjCode} error:`, err);
    return {
      rjCode,
      lowestPrice: null,
      dlwatcherUrl: buildDlwatcherPageUrl(rjCode),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function batchFetchPrices(
  rjCodes: string[],
  options?: {
    onProgress?: (completed: number, total: number) => void;
    keepAlive?: () => void;
  },
): Promise<Map<string, FetchPriceResult>> {
  const total = rjCodes.length;
  const result = new Map<string, FetchPriceResult>();
  let completed = 0;

  for (let i = 0; i < rjCodes.length; i += BATCH_SIZE) {
    const batch = rjCodes.slice(i, i + BATCH_SIZE);
    const prices = await Promise.all(batch.map((code) => fetchPriceFromDlwatcher(code)));

    for (const item of prices) {
      result.set(item.rjCode, item);
      completed += 1;
      options?.onProgress?.(completed, total);
    }

    // 每批完成后 keepAlive，防止 MV3 service worker 被终止
    options?.keepAlive?.();

    if (i + BATCH_SIZE < rjCodes.length) {
      await sleep(BATCH_INTERVAL_MS);
    }
  }

  return result;
}
