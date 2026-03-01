import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FavoriteRecord, PriceRecord, SettingRecord } from '@/shared/types';

interface DlTrackerDB extends DBSchema {
  prices: {
    key: string;
    value: PriceRecord;
    indexes: {
      'by-lastChecked': string;
      'by-lowestPrice': number;
      'by-isFavorite': number;
      'by-updatedAt': string;
    };
  };
  favorites: {
    key: string;
    value: FavoriteRecord;
    indexes: {
      'by-addedAt': string;
    };
  };
  settings: {
    key: string;
    value: SettingRecord;
    indexes: {
      'by-updatedAt': string;
    };
  };
}

const DB_NAME = 'dltracker';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<DlTrackerDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<DlTrackerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DlTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const prices = db.createObjectStore('prices', { keyPath: 'rjCode' });
          prices.createIndex('by-lastChecked', 'lastChecked');
          prices.createIndex('by-lowestPrice', 'lowestPrice');
          prices.createIndex('by-isFavorite', 'isFavorite');
        }

        if (oldVersion < 2) {
          const prices = transaction.objectStore('prices');
          if (!prices.indexNames.contains('by-updatedAt')) {
            prices.createIndex('by-updatedAt', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('favorites')) {
            const favorites = db.createObjectStore('favorites', { keyPath: 'rjCode' });
            favorites.createIndex('by-addedAt', 'addedAt');
          }
          if (!db.objectStoreNames.contains('settings')) {
            const settings = db.createObjectStore('settings', { keyPath: 'key' });
            settings.createIndex('by-updatedAt', 'updatedAt');
          }
        }
      },
    });
  }

  return dbPromise;
}
