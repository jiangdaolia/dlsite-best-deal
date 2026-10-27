import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);

function functionSource(name) {
  const matched = source.match(new RegExp(
    `  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`,
  ));
  if (!matched) throw new Error(`${name} not found`);
  return matched[0];
}

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test("收藏夹卡片并入统一浏览分析管线", () => {
  const collectSource = functionSource("collectBrowseCards");
  // 仅在收藏夹页用 getWishlistCards 并入卡片，复用史低/本次可到/趋势与优惠助手筛选。
  assert.match(collectSource, /isFavoritePage\(location\.href\)/);
  assert.match(collectSource, /getWishlistCards\(\)/);
  // 并入时按节点与包含关系去重，避免与通用兜底重复采集。
  assert.match(collectSource, /node\.contains\(entry\.node\)/);
});

test("findBrowsePrimaryList 识别收藏夹容器", () => {
  const listSource = functionSource("findBrowsePrimaryList");
  assert.match(listSource, /#wishlist_work/);
  assert.match(listSource, /\.wishlist_work/);
  assert.match(listSource, /\[id\*="wishlist"\]/);
});

test("bootstrap 不再单独渲染收藏夹卡片（避免与统一管线重复 UI）", () => {
  const bootstrapSource = functionSource("bootstrap");
  // 收藏夹分支不再调用 enhanceWishlistCards，改由 enhanceGenericBrowseCards 接管。
  assert.doesNotMatch(bootstrapSource, /enhanceWishlistCards/);
  // 统一浏览分析管线负责收藏夹卡片的史低/本次可到/趋势与筛选排序。
  assert.match(functionSource("enhanceGenericBrowseCards"), /collectBrowseCards\(\)/);
});

test("新增收藏夹排序常量", () => {
  assert.match(
    source,
    /const BROWSE_SORT_MODE_FAVORITE_STORAGE_KEY = "dltracker-browse-sort-mode-favorite"/,
  );
});

test("收藏夹页排序默认保持 DLsite 原顺序，可手动开启", () => {
  const localStorage = makeLocalStorage();
  const sandbox = {
    location: { href: "https://www.dlsite.com/girls/mypage/wishlist" },
    localStorage,
    BROWSE_SORT_MODE_NATIVE: "native",
    BUY_LATER_SORT_MODE_REACH: "reach",
    BUY_LATER_SORT_MODE_PRICE: "price",
    BUY_LATER_SORT_MODE_PLATFORM_EXPIRY: "platform-expiry",
    BROWSE_SORT_MODE_STORAGE_KEY: "dltracker-browse-sort-mode",
    BROWSE_SORT_MODE_FAVORITE_STORAGE_KEY: "dltracker-browse-sort-mode-favorite",
  };
  vm.runInNewContext(
    `var browseSortModeRuntime = null;
     ${functionSource("isFavoritePage")}
     ${functionSource("normalizeBrowseSortMode")}
     ${functionSource("getBrowseSortMode")}
     ${functionSource("setBrowseSortMode")}
     globalThis.getMode = getBrowseSortMode;
     globalThis.setMode = setBrowseSortMode;`,
    sandbox,
  );
  // 收藏夹默认保持原顺序（native），不重排用户精选列表。
  assert.equal(sandbox.getMode(), "native");
  // 用户手动选了理论低价后，收藏夹单独记住该选择。
  sandbox.setMode("price");
  assert.equal(sandbox.getMode(), "price");
  assert.equal(
    localStorage.getItem("dltracker-browse-sort-mode-favorite"),
    "price",
  );
});

test("非收藏夹页排序默认仍是最高可达到折扣", () => {
  const localStorage = makeLocalStorage();
  const sandbox = {
    location: { href: "https://www.dlsite.com/girls/search/=/keyword/RJ" },
    localStorage,
    BROWSE_SORT_MODE_NATIVE: "native",
    BUY_LATER_SORT_MODE_REACH: "reach",
    BUY_LATER_SORT_MODE_PRICE: "price",
    BUY_LATER_SORT_MODE_PLATFORM_EXPIRY: "platform-expiry",
    BROWSE_SORT_MODE_STORAGE_KEY: "dltracker-browse-sort-mode",
    BROWSE_SORT_MODE_FAVORITE_STORAGE_KEY: "dltracker-browse-sort-mode-favorite",
  };
  vm.runInNewContext(
    `var browseSortModeRuntime = null;
     ${functionSource("isFavoritePage")}
     ${functionSource("normalizeBrowseSortMode")}
     ${functionSource("getBrowseSortMode")}
     globalThis.getMode = getBrowseSortMode;`,
    sandbox,
  );
  assert.equal(sandbox.getMode(), "reach");
});
