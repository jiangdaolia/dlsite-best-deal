export interface PriceRecord {
  rjCode: string;
  title: string;
  currentPrice?: number;
  lowestPrice: number;
  regularPrice?: number;
  discountRate?: number;
  lastChecked: string;
  dlwatcherUrl: string;
  isFavorite: boolean;
  favoriteAddedAt?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteRecord {
  rjCode: string;
  addedAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface DlWatcherPriceResponse {
  productName?: string;
  lowestPrice?: {
    priceInfo?: {
      price?: number;
      regularPrice?: number;
      discountRate?: number;
    };
    end?: string;
  };
}

export interface FetchPriceResult {
  rjCode: string;
  title?: string;
  lowestPrice: number | null;
  regularPrice?: number;
  discountRate?: number;
  dlwatcherUrl: string;
}

export type RuntimeRequest =
  | {
      type: 'GET_OR_FETCH_PRICE';
      payload: {
        rjCode: string;
        title: string;
        currentPrice?: number;
      };
    }
  | {
      type: 'IMPORT_FAVORITES';
      payload: {
        rjCodes: string[];
      };
    }
  | {
      type: 'LIST_RECORDS';
    }
  | {
      type: 'UPDATE_ONE';
      payload: {
        rjCode: string;
      };
    }
  | {
      type: 'UPDATE_ALL_FAVORITES';
    }
  | {
      type: 'GET_STATS';
    }
  | {
      type: 'EXPORT_CSV';
    };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
