export const APP_NAME = 'DL Price Tracker';

export const DLWATCHER_BASE = 'https://dlwatcher.com/product';

/** girls 分区收藏 API 路径（girls-drama 共用同一个收藏系统） */
export const FAVORITE_API_PATH = '/girls/load/favorite/product';

export const BATCH_SIZE = 10;
export const BATCH_INTERVAL_MS = 1000;
export const REQUEST_TIMEOUT_MS = 10000;

/** 收藏作品导入数量上限 */
export const MAX_FAVORITES = 500;

/** 匹配 RJ（同人/girls）和 BJ（girls-drama）作品编号 */
export const RJ_CODE_REGEX = /\b([RB]J\d{6,})\b/i;

export const UI_CLASSNAME = 'dltracker-lowest-price-card';
