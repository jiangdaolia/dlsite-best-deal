import { getDb } from './index';
import type { FavoriteRecord, PriceRecord } from '@/shared/types';
import { nowIso } from '@/shared/utils';

export async function getPriceRecord(rjCode: string): Promise<PriceRecord | undefined> {
  const db = await getDb();
  return db.get('prices', rjCode);
}

export async function listPriceRecords(): Promise<PriceRecord[]> {
  const db = await getDb();
  return db.getAll('prices');
}

export async function listFavoriteCodes(): Promise<string[]> {
  const db = await getDb();
  const favorites = await db.getAllKeys('favorites');
  return favorites as string[];
}

export async function upsertPriceRecord(input: PriceRecord): Promise<void> {
  const db = await getDb();
  const existing = await db.get('prices', input.rjCode);

  const merged: PriceRecord = existing
    ? {
        ...existing,
        ...input,
        lowestPrice: Math.min(existing.lowestPrice, input.lowestPrice),
        updatedAt: nowIso(),
      }
    : {
        ...input,
        createdAt: input.createdAt || nowIso(),
        updatedAt: input.updatedAt || nowIso(),
      };

  await db.put('prices', merged);
}

export async function markFavorites(rjCodes: string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['favorites', 'prices'], 'readwrite');
  const now = nowIso();

  for (const rjCode of rjCodes) {
    const favorite: FavoriteRecord = { rjCode, addedAt: now };
    await tx.objectStore('favorites').put(favorite);

    const existing = await tx.objectStore('prices').get(rjCode);
    if (existing) {
      await tx.objectStore('prices').put({ ...existing, isFavorite: true, favoriteAddedAt: now, updatedAt: now });
    }
  }

  await tx.done;
}

export async function clearFavoriteFlagForMissing(nextFavoriteSet: Set<string>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('prices', 'readwrite');
  const all = await tx.store.getAll();
  const now = nowIso();

  for (const record of all) {
    if (!nextFavoriteSet.has(record.rjCode) && record.isFavorite) {
      await tx.store.put({ ...record, isFavorite: false, updatedAt: now });
    }
  }

  await tx.done;
}

/** 删除单条记录（用于缓存清理） */
export async function deletePriceRecord(rjCode: string): Promise<void> {
  const db = await getDb();
  await db.delete('prices', rjCode);
}

/** 返回所有非收藏记录（缓存条目） */
export async function listNonFavoriteRecords(): Promise<PriceRecord[]> {
  const db = await getDb();
  const all = await db.getAll('prices');
  return all.filter((r) => !r.isFavorite);
}
