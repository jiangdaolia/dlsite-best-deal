import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);
const matched = source.match(
  /\/\/ <language-account-core>([\s\S]*?)\/\/ <\/language-account-core>/,
);
if (!matched) throw new Error("language account core markers not found");

function functionSource(name) {
  const result = source.match(new RegExp(
    `  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`,
  ));
  if (!result) throw new Error(`${name} not found`);
  return result[0];
}

// 抽取模块级常量声明（单行、多行 new RegExp(...)、多行正则字面量都能取到）。
function constantSource(name) {
  const result = source.match(new RegExp(`  const ${name} =[\\s\\S]*?;\\n`));
  if (!result) throw new Error(`${name} not found`);
  return result[0].trimEnd();
}

const sandbox = {
  URL,
  dealPlainText(value) {
    return String(value || "").replace(/<[^>]+>/g, " ").trim();
  },
  dealNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  dealTokens(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(sandbox.dealTokens);
    if (typeof value === "object") return Object.values(value).flatMap(sandbox.dealTokens);
    return [String(value)];
  },
  isValidProductCode(value) {
    return /^[RBV]J\d{6,}$/i.test(String(value || ""));
  },
};

vm.runInNewContext(
  `${matched[1]}
  ${constantSource("WORK_EDITION_WORD")}
  ${constantSource("WORK_TITLE_EDITION_PREFIX")}
  ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
  ${functionSource("boughtWorkTitleKey")}
  ${functionSource("sortLanguageComparisonRows")}
  ${functionSource("languageWinnerRows")}
  ${functionSource("translationChildrenFromMetadata")}
  globalThis.languageEditionCore = {
    normalizedLanguageCode,
    languageDisplayName,
    productLanguageIdentity,
    productNeedsLanguageFamilyLookup,
    historicalPurchasedSkuLanguage,
    productLooksLikeHistoricalPurchasedSku,
    matchingMakerWorkIds,
    languageFamilyIdFromEditions,
    cartSkuFromSignals,
    accountEntryFromProduct,
    cartIdsFromMemberStatus,
    boughtIdsFromPayload,
    languageEditionsFromDocument,
    sortLanguageComparisonRows,
    languageWinnerRows,
    translationChildrenFromMetadata,
  };`,
  sandbox,
);

const {
  languageDisplayName,
  productLanguageIdentity,
  productNeedsLanguageFamilyLookup,
  historicalPurchasedSkuLanguage,
  productLooksLikeHistoricalPurchasedSku,
  matchingMakerWorkIds,
  languageFamilyIdFromEditions,
  cartSkuFromSignals,
  accountEntryFromProduct,
  cartIdsFromMemberStatus,
  boughtIdsFromPayload,
  languageEditionsFromDocument,
  sortLanguageComparisonRows,
  languageWinnerRows,
  translationChildrenFromMetadata,
} = sandbox.languageEditionCore;

test("翻译子 SKU 归并到语言母作品与日文原作家族", () => {
  const product = {
    id: "RJ01094726",
    translationInfo: {
      is_child: true,
      original_workno: "RJ01076373",
      parent_workno: "RJ01089295",
      lang: "CHI_HANS",
    },
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(productLanguageIdentity(product))),
    {
      id: "RJ01094726",
      parentId: "RJ01089295",
      familyId: "RJ01076373",
      lang: "CHI_HANS",
    },
  );
  assert.equal(accountEntryFromProduct(product.id, product).language, "简体中文");
});

test("RJ01285872这类非日语原作标记改用详情页日语版本作为家族", () => {
  const product = {
    id: "RJ01285872",
    raw: { options: "SND#CHI#CHI_HANS#REV" },
    translationInfo: {
      is_original: true,
      original_workno: null,
      parent_workno: null,
      lang: null,
    },
  };
  const identity = productLanguageIdentity(product);
  assert.equal(identity.lang, "CHI_HANS");
  assert.equal(identity.familyId, "RJ01285872");
  assert.equal(productNeedsLanguageFamilyLookup(product), true);
  const family = {
    familyId: languageFamilyIdFromEditions(identity, [
      { parentId: "RJ421140", lang: "JPN", language: "日语" },
      { parentId: "RJ01285872", lang: "CHI_HANS", language: "简体中文" },
    ]),
    editions: [
      { parentId: "RJ421140", lang: "JPN", language: "日语" },
      { parentId: "RJ01285872", lang: "CHI_HANS", language: "简体中文" },
    ],
  };
  assert.equal(family.familyId, "RJ421140");
  assert.deepEqual(
    JSON.parse(JSON.stringify(accountEntryFromProduct(product.id, product, family))),
    {
      id: "RJ01285872",
      skuId: "RJ01285872",
      parentId: "RJ01285872",
      familyId: "RJ421140",
      lang: "CHI_HANS",
      language: "简体中文",
      // 没有标题时作品键为空，按作品计数会退回语言家族。
      workKey: "",
      identitySource: "metadata",
    },
  );
});

test("RJ01212161这类历史购买SKU保留中文身份而不默认日语", () => {
  const product = {
    id: "RJ01212161",
    title: "【癒されえっち】隣のスパダリな年下クン",
    price: 0,
    officialPrice: 0,
    onSale: false,
    makerId: "RG01004470",
    raw: {
      options: "OTM#SND#JPN#ENG#CHI_HANT#CHI_HANS#KO_KR#CHI",
      regist_date: null,
    },
    translationInfo: {
      is_original: true,
      original_workno: null,
      parent_workno: null,
      lang: null,
    },
  };
  const identity = productLanguageIdentity(product);
  assert.equal(identity.lang, "JPN");
  assert.equal(historicalPurchasedSkuLanguage(product), "CHI");
  assert.equal(productLooksLikeHistoricalPurchasedSku(product), true);
  assert.equal(productNeedsLanguageFamilyLookup(product), false);
  const family = {
    familyId: "RJ01200697",
    editions: [
      { parentId: "RJ01200697", lang: "JPN", language: "日语" },
      { parentId: "RJ01213700", lang: "CHI_HANS", language: "简体中文" },
    ],
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(accountEntryFromProduct(product.id, product, family, {
      familyId: "RJ01200697",
      parentId: "RJ01200697",
      lang: "CHI",
      language: "中文",
    }))),
    {
      id: "RJ01212161",
      skuId: "RJ01212161",
      parentId: "RJ01200697",
      familyId: "RJ01200697",
      lang: "CHI",
      language: "中文",
      // 标题没有语言版前缀，作品键就是标题本身（无站点信息时站点段为空）。
      workKey: "【癒されえっち】隣のスパダリな年下クン|",
      identitySource: "historical-purchase",
    },
  );
});

test("历史购买SKU可从同社团作品列表按完整标题找回原作", () => {
  const candidates = [
    {
      getAttribute: () => "RJ01200697",
      querySelector: () => ({
        getAttribute: () => "【癒されえっち】隣のスパダリな年下クン",
        textContent: "",
      }),
    },
    {
      getAttribute: () => "RJ09999999",
      querySelector: () => ({ getAttribute: () => "别的作品", textContent: "" }),
    },
  ];
  const doc = { querySelectorAll: () => candidates };
  assert.deepEqual(
    JSON.parse(JSON.stringify(matchingMakerWorkIds(doc, {
      id: "RJ01212161",
      title: "【癒されえっち】 隣のスパダリな年下クン",
    }))),
    ["RJ01200697"],
  );
});

test("语言选择器一次给出父编号、中文语言名和 DLsite 顺序", () => {
  const payload = JSON.stringify([
    { workno: "RJ01076373", lang: "JPN", display_label: "日本語", display_order: 1, price: 1760 },
    { workno: "RJ01089295", lang: "CHI_HANS", display_label: "简体中文", display_order: 5, price: 1540 },
  ]);
  const doc = {
    querySelector() {
      return { getAttribute: () => payload };
    },
  };
  const editions = languageEditionsFromDocument(doc);
  assert.equal(editions.length, 2);
  assert.equal(editions[0].language, "日语");
  assert.equal(editions[1].language, "简体中文");
  assert.equal(editions[1].parentId, "RJ01089295");
  assert.equal(editions[1].displayOrder, 5);
});

test("官方账号状态按 status 区分立即购买与稍后再买", () => {
  const result = cartIdsFromMemberStatus({
    cart: [
      { product_id: "RJ01094726", status: 1 },
      { product_id: "RJ01111460", status: 2 },
      { product_id: "bad", status: 1 },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    active: ["RJ01094726"],
    later: ["RJ01111460"],
  });
});

test("官方已购响应从 bought.boughts 读取并兼容对象作品编号", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(boughtIdsFromPayload({
      bought: {
        boughts: ["RJ01094726", { product_id: "RJ01111460" }, "bad"],
        rentals: [],
      },
    }))),
    ["RJ01094726", "RJ01111460"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(boughtIdsFromPayload({ boughts: ["RJ01257758"] }))),
    ["RJ01257758"],
  );
});

test("未知语言使用官方标签，已知语言统一显示中文", () => {
  assert.equal(languageDisplayName("KO_KR", "한국어"), "韩语");
  assert.equal(languageDisplayName("NEW_LANG", "测试语言"), "测试语言");
});

test("购物车操作优先识别实际翻译 SKU，不把语言母作品当成同一商品", () => {
  assert.equal(cartSkuFromSignals({
    detailHref: "/girls/work/=/product_id/RJ01089295.html/?translation=RJ01094726",
    dataWorkno: "RJ01089295",
  }), "RJ01094726");
  assert.equal(cartSkuFromSignals({
    actionHref: "/girls/cart/delete?product_id=RJ01111460",
    detailHref: "/girls/work/=/product_id/RJ01089295.html/?translation=RJ01094726",
  }), "RJ01111460");
  assert.equal(cartSkuFromSignals({
    detailHref: "/girls/work/=/product_id/RJ01089295.html",
  }), "RJ01089295");
});

test("当前语言固定第一行，最优惠按理论日元价允许并列", () => {
  const rows = [
    { parentId: "RJ00000001", current: false, theoreticalPrice: 120, displayOrder: 1, stopped: false },
    { parentId: "RJ00000002", current: true, theoreticalPrice: 200, displayOrder: 5, stopped: false },
    { parentId: "RJ00000003", current: false, theoreticalPrice: 120, displayOrder: 3, stopped: false },
  ];
  const sorted = sortLanguageComparisonRows(rows);
  assert.equal(sorted[0].parentId, "RJ00000002");
  assert.deepEqual(
    JSON.parse(JSON.stringify(languageWinnerRows(rows).map((row) => row.parentId))),
    ["RJ00000001", "RJ00000003"],
  );
});

test("RJ01684785这类残留失效译者SKU时保留已取得的在售译者", () => {
  const available = {
    id: "RJ01684786",
    onSale: true,
  };
  const result = translationChildrenFromMetadata(
    ["RJ01684786", "RJ01684788", "RJ01684790"],
    new Map([["RJ01684786", available]]),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    {
      children: [available],
      missingChildIds: ["RJ01684788", "RJ01684790"],
    },
  );
  assert.match(
    functionSource("buildLanguageComparisonRows"),
    /if \(editionChildIds\.length && !children\.length\)/,
  );
  assert.doesNotMatch(
    functionSource("buildLanguageComparisonRows"),
    /editionChildIds\.some\(\(id\) => !childMetadata\.has\(id\)\)/,
  );
  assert.match(
    functionSource("languageRowStatusText"),
    /missingChildIds\.length\}\u4e2a译者信息未取得/,
  );
});

test("账号索引写入超出配额时清理最旧作品元数据并重试", () => {
  const values = new Map();
  const now = Date.now();
  const metadata = Object.fromEntries(Array.from({ length: 41 }, (_, index) => [
    `RJ${String(index).padStart(8, "0")}`,
    { fetchedAt: now - (41 - index) * 1000, raw: { value: "x".repeat(50) } },
  ]));
  values.set("deal-cache", JSON.stringify({
    coupons: { loaded: true, raw: [] },
    metadata,
    bulkRules: {},
  }));
  const quotaSandbox = {
    console: { warn() {} },
    localStorage: {
      getItem(key) {
        return values.get(key) || null;
      },
      setItem(key, value) {
        if (key === "account-index") {
          const cache = JSON.parse(values.get("deal-cache"));
          if (Object.keys(cache.metadata).length > 1) {
            const error = new Error("storage quota reached");
            error.name = "QuotaExceededError";
            throw error;
          }
        }
        values.set(key, value);
      },
    },
    loadDealCache() {
      return JSON.parse(values.get("deal-cache"));
    },
    dealNumber(value, fallback = 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
  vm.runInNewContext(`
    const APP_NAME = "test";
    const DEAL_CACHE_STORAGE_KEY = "deal-cache";
    const ACCOUNT_INDEX_STORAGE_KEY = "account-index";
    const PRODUCT_METADATA_TTL_MS = 30 * 60 * 1000;
    const MAX_PRODUCT_METADATA_ENTRIES = 2000;
    let accountIndexRuntimeError = "";
    ${functionSource("storageQuotaExceeded")}
    ${functionSource("pruneStaleDealCacheMetadata")}
    ${functionSource("retryAccountIndexWriteAfterMetadataPrune")}
    ${functionSource("saveAccountIndex")}
    globalThis.saveAccountIndexForTest = saveAccountIndex;
  `, quotaSandbox);
  quotaSandbox.saveAccountIndexForTest({ indexed: 40 }, { throwOnFailure: true });
  assert.equal(JSON.parse(values.get("account-index")).indexed, 40);
  assert.equal(
    Object.keys(JSON.parse(values.get("deal-cache")).metadata).length,
    1,
  );
});

test("商品缓存自身过大导致写入配额超限时持续裁剪直至可写", () => {
  const values = new Map();
  const now = Date.now();
  const MAX_BYTES = 1200;
  const metadata = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [
    `RJ${String(index).padStart(8, "0")}`,
    { fetchedAt: now - (30 - index) * 1000, raw: { value: "x".repeat(150) } },
  ]));
  values.set("deal-cache", JSON.stringify({
    coupons: { loaded: true, raw: [] },
    metadata,
    bulkRules: {},
  }));
  const totalBytes = () => {
    let total = 0;
    for (const value of values.values()) total += value.length;
    return total;
  };
  const quotaSandbox = {
    console: { warn() {} },
    localStorage: {
      getItem(key) {
        return values.get(key) || null;
      },
      setItem(key, value) {
        const projected = totalBytes() - (values.get(key)?.length || 0) + value.length;
        if (projected > MAX_BYTES) {
          const error = new Error("exceeded the quota");
          error.name = "QuotaExceededError";
          throw error;
        }
        values.set(key, value);
      },
    },
    loadDealCache() {
      return JSON.parse(values.get("deal-cache"));
    },
    dealNumber(value, fallback = 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
  vm.runInNewContext(`
    const APP_NAME = "test";
    const DEAL_CACHE_STORAGE_KEY = "deal-cache";
    const ACCOUNT_INDEX_STORAGE_KEY = "account-index";
    const PRODUCT_METADATA_TTL_MS = 30 * 60 * 1000;
    const MAX_PRODUCT_METADATA_ENTRIES = 2000;
    let accountIndexRuntimeError = "";
    ${functionSource("storageQuotaExceeded")}
    ${functionSource("pruneStaleDealCacheMetadata")}
    ${functionSource("retryAccountIndexWriteAfterMetadataPrune")}
    ${functionSource("saveAccountIndex")}
    globalThis.saveAccountIndexForTest = saveAccountIndex;
  `, quotaSandbox);
  quotaSandbox.saveAccountIndexForTest({ indexed: 40 }, { throwOnFailure: true });
  assert.equal(JSON.parse(values.get("account-index")).indexed, 40);
  assert.ok(
    Object.keys(JSON.parse(values.get("deal-cache")).metadata).length < 30,
    "should have pruned product metadata to fit the quota",
  );
});

test("语言比较使用七列表、账号冷却与官方单件购物车请求", () => {
  assert.match(source, /"语言", "作品", "人民币\/日元", "现在\/平台\/史低", "备注", "看详情", "购物车"/);
  assert.match(source, /ACCOUNT_REFRESH_COOLDOWN_MS = 60 \* 1000/);
  assert.match(source, /ACCOUNT_METADATA_BATCH_SIZE = 40/);
  assert.match(source, /ACCOUNT_METADATA_BATCH_PAUSE_MS = 10 \* 1000/);
  assert.match(source, /ACCOUNT_INDEX_REQUEST_VERSION = 12/);
  assert.match(source, /ACCOUNT_INDEX_LOCK_STORAGE_KEY = "dltracker-account-index-lock-v1"/);
  assert.match(source, /ACCOUNT_INDEX_LOCK_TTL_MS = 60 \* 1000/);
  assert.match(source, /fetchSameOriginText\(url, "作品信息接口", \{\s*anonymous: true/);
  assert.match(source, /credentials: anonymous \? "omit" : "include"/);
  assert.match(source, /anonymous \? \{ referrerPolicy: "no-referrer" \} : \{\}/);
  assert.match(
    functionSource("enhanceDealInsights"),
    /\.finally\(\(\) => \{[\s\S]*?scheduleInitialAccountIndex\(\)/,
  );
  assert.doesNotMatch(
    functionSource("enhanceDealInsights"),
    /\(async \(\) => \{\s*invalidateCouponCacheAfterPurchase\(\);\s*try \{\s*await ensureInitialAccountIndex/,
  );
  assert.match(
    functionSource("scheduleInitialAccountIndex"),
    /setTimeout[\s\S]*?void ensureInitialAccountIndex\(\)[\s\S]*?refreshAllAccountReminders/,
  );
  assert.match(source, /loaded: true,[\s\S]*?total: ids\.length,[\s\S]*?refreshAccountInformationPanels\(\);[\s\S]*?for \(let start = 0; start < pendingIds\.length/);
  assert.match(source, /start \+= ACCOUNT_METADATA_BATCH_SIZE[\s\S]*?pendingIds\.slice\(start, start \+ ACCOUNT_METADATA_BATCH_SIZE\)/);
  assert.match(source, /ids\.length && next\.indexed === 0[\s\S]*?语言索引未取得任何作品信息/);
  // 账号信息只在用户点击时读取：初始加载与断点状态都不再自动发起账号请求。
  assert.doesNotMatch(functionSource("ensureInitialAccountIndex"), /refreshAccountIndex/);
  assert.doesNotMatch(functionSource("ensureInitialAccountIndex"), /fetchSameOrigin/);
  assert.doesNotMatch(functionSource("scheduleInitialAccountIndex"), /refreshAccountIndex|fetchSameOrigin/);
  assert.match(source, /语言索引已暂停：[\s\S]*?剩余\$\{remaining\}项/);
  assert.match(source, /已暂停：\$\{reason\}；剩余\$\{remaining\}项/);
  assert.match(source, /pausedReason: accountIndexSessionStopped \? accountIndexSessionStopReason : ""/);
  assert.match(source, /读取暂停：\$\{index\.pausedReason\}/);
  assert.match(source, /else if \(!accountIndexSessionStopped\) \{[\s\S]*?failedIds\.push\(id\)/);
  assert.match(source, /ensureProductMetadata\(batchIds, \{\s*requestSession: "account"/);
  assert.match(source, /stopRequestSession\("account", `\$\{label\} HTTP \$\{response\.status\}`/);
  assert.match(source, /account index requests stopped/);
  assert.doesNotMatch(functionSource("fetchSameOriginJson"), /dealSessionStopped/);
  assert.doesNotMatch(functionSource("refreshAccountIndex"), /dealSessionStopped/);
  assert.match(
    functionSource("refreshAccountIndex"),
    /pausedReason: accountIndexSessionStopReason \|\| accountIndexRuntimeError/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /const foreignReading = accountIndexForeignReadActive\(\)/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /acquireAccountIndexLock\(\{ takeover: manual && foreignReading \}\)/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /manual && !foreignReading[\s\S]*?请等待 \$\{seconds\} 秒后再读取/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /stage: "读取账号购物车信息"[\s\S]*?stage: "读取已购清单"[\s\S]*?stage: `读取作品信息/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /\.finally\(\(\) => \{\s*releaseAccountIndexLock\(claim\)/,
  );
  assert.match(source, /retryAccountIndexWriteAfterMetadataPrune\(serialized\)/);
  assert.match(source, /saveAccountIndex\(index, \{\s*throwOnFailure: true/);
  assert.match(source, /const bought = boughtIdsFromPayload\(boughtPayload\)/);
  assert.match(source, /productNeedsLanguageFamilyLookup\(product\)[\s\S]*?ensureLanguageFamily\(id, \{[\s\S]*?requestSession: "account"/);
  assert.match(source, /productLooksLikeHistoricalPurchasedSku\(product\)[\s\S]*?resolveHistoricalPurchasedSku\(id, product\)/);
  assert.match(source, /归并历史已购SKU/);
  assert.match(source, /cache\.parents\[String\(id \|\| ""\)\.toUpperCase\(\)\] = family\.familyId/);
  assert.match(source, /fetchSameOriginText\(url, "语言版本详情", \{\s*anonymous: true,/);
  assert.match(source, /stage: `补读作品详情 \$\{id\}`[\s\S]*?ensureLanguageFamily\(id, \{[\s\S]*?knownProduct: fallbackProduct/);
  assert.match(source, /failedIds\.slice\(0, 3\)[\s\S]*?\$\{failed\}项未取得/);
  assert.match(source, /`\$\{label\}请求失败：\$\{error instanceof Error/);
  assert.match(source, /\["状态", index\.loaded \? "正在重新读取…" : "正在读取购物车和已购清单…"\]/);
  assert.match(source, /`读取失败：\$\{accountIndexRuntimeError\}`/);
  assert.match(source, /Boolean\(index\?\.indexing\) && accountIndexLockIsActive\(\)/);
  assert.match(source, /读取中\$\{stage \? `：\$\{stage\}` : ""\}/);
  assert.match(source, /未完成\$\{stage \? `：中断于\$\{stage\}` : ""\}/);
  assert.match(source, /\["语言索引", accountIndexProgressText\(index, reading\)\]/);
  assert.match(source, /window\.addEventListener\("pagehide", \(\) => releaseAccountIndexLock\(\)\)/);
  assert.match(source, /event\.key === ACCOUNT_INDEX_STORAGE_KEY[\s\S]*?refreshAccountInformationPanels\(\)/);
  assert.match(
    source,
    /const data = await accountReminderData\(id, \{[\s\S]*?evaluateCartVisibility: includeCartStatus,[\s\S]*?existing\.replaceWith\(reminders\)/,
  );
  assert.match(source, /existing\?\.dataset\.reminderSignature === signature/);
  assert.doesNotMatch(source, /layout\.querySelector\("\.dltracker-account-reminders"\)\?\.remove\(\);\s*layout\.classList\.remove\("is-account-purchased"\);\s*const data = await accountReminderData/);
  assert.match(source, /mode: "cart"[\s\S]*obj_nocheck: "1"[\s\S]*product_id:/);
  assert.match(source, /a\.link_delete/);
  assert.match(source, /a\.link_move_cart/);
  assert.match(source, /concreteCartProductId\(item\) === target/);
  assert.match(source, /确认从购物车永久移出【\$\{row\.language\}】版本吗/);
  assert.match(source, /saveLanguageDialogRestoreState\(openLanguageDialogState\);\s*location\.reload\(\)/);
  assert.match(source, /await restoreLanguageDialogAfterReload\(\{ deferRender: true \}\);[\s\S]*?await bootstrap\(\)/);
  assert.match(source, /const initialRender = !state\.rows\.length \|\| !body\.firstElementChild;\s*if \(initialRender\) body\.textContent/);
  assert.match(source, /button\.style\.inlineSize = `\$\{rect\.width\}px`;\s*button\.style\.blockSize = `\$\{rect\.height\}px`;/);
  assert.match(source, /entry\.style\.marginInlineStart = `\$\{Math\.max\(0, rect\.left - contentLeft\)\}px`;/);
  assert.match(source, /mobileText \? "is-mobile-text" : "is-desktop-button"/);
  assert.match(source, /nativeHost\.insertBefore\(entry, nativeAction\)/);
  assert.doesNotMatch(source, /nativeHost\.parentElement\.insertBefore\(entry, nativeHost\)/);
  assert.doesNotMatch(source, /\.dltracker-language-entry-cart\.is-desktop-button\s*\{\s*width:\s*100%/);
  assert.match(source, /\.dltracker-language-entry-cart\.is-mobile-text \.dltracker-language-entry-button,[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(source, /读取账号信息（优惠券、购物车、已购清单）/);
  // 手动读取可一键接管另一页面：最新声明获胜，旧页面被立即中断。
  assert.match(source, /ACCOUNT_READ_PREEMPTED_TEXT = "本页读取已被另一页面接管"/);
  assert.match(functionSource("renewAccountIndexLock"), /accountLockRecordIsNewer/);
  assert.match(functionSource("renewAccountIndexLock"), /accountLockClaim !== claim/);
  assert.doesNotMatch(functionSource("renewAccountIndexLock"), /takenAt: Date\.now\(\)/);
  assert.match(functionSource("acquireAccountIndexLock"), /\{ takeover = false \} = \{\}/);
  assert.match(
    functionSource("preemptAccountRead"),
    /abortAccountRequests\(null\)/,
  );
  assert.match(
    functionSource("preemptAccountRead"),
    /accountSessionEpoch = staleEpoch \+ 1/,
  );
  assert.match(functionSource("trackAccountRequest"), /accountRequestControllers\.add/);
  assert.match(functionSource("abortAccountRequests"), /controller\.abort\(\)/);
  assert.match(
    functionSource("fetchSameOriginJson"),
    /trackAccountRequest\(controller, sessionEpoch\)/,
  );
  assert.match(
    functionSource("fetchSameOriginText"),
    /trackAccountRequest\(controller, sessionEpoch\)/,
  );
  assert.match(functionSource("fetchBoughtPageSnapshot"), /requestSession = "deal"/);
  assert.match(functionSource("fetchBoughtPageSnapshot"), /if \(shouldStop\(\)\) break/);
  assert.match(
    source,
    /startUrl: onPurchasedPage \? location\.href : purchasedPageBaseUrl\(\),\s*requestSession: "account"/,
  );
  assert.doesNotMatch(source, /followAllPeriod: false,\s*requestSession/);
  assert.match(functionSource("renderAccountReadFab"), /button\.textContent = "接管读取"/);
  assert.match(functionSource("renderAccountInformationPanel"), /"接管读取"/);
  assert.match(
    source,
    /event\.key === ACCOUNT_INDEX_LOCK_STORAGE_KEY[\s\S]*?preemptAccountRead\(\)/,
  );
  assert.match(
    functionSource("updateAccountIndexCart"),
    /accountIndexForeignReadActive\(\)/,
  );
});

test("账号读取完全手动：悬浮按钮、差分更新、可中断续接与读后重算", () => {
  // 购物车页悬浮按钮只在购物车页注入，未登录禁用。
  assert.match(
    functionSource("ensureAccountReadFab"),
    /isCartPage\(location\.href\)[\s\S]*?dltracker-account-fab/,
  );
  assert.match(
    functionSource("renderAccountReadFab"),
    /未登录 DLsite/,
  );
  assert.match(
    functionSource("renderAccountReadFab"),
    /runAccountReadFlow\(\{ manual: true \}\)/,
  );
  // 手动读取流水线：优惠券走缓存策略，然后读取账号索引，最后重算金额。
  assert.match(
    functionSource("runAccountReadFlow"),
    /ensureDealCoupons\(false\)[\s\S]*?refreshAccountIndex\(\{ manual \}\)[\s\S]*?recalculateAccountDealInsights\(\)/,
  );
  assert.match(
    functionSource("runAccountReadFlow"),
    /phase: "coupons"[\s\S]*?phase: "account"[\s\S]*?phase: "recalc"/,
  );
  // 中断时仍用已读到的数据重算并保留断点。
  assert.match(
    functionSource("runAccountReadFlow"),
    /accountReadStopRequested[\s\S]*?recalculateAccountDealInsights\(\)/,
  );
  assert.match(
    functionSource("runAccountReadFlow"),
    /已停止：/,
  );
  // 停止按钮触发账号会话熔断，断点由 pausedReason 持久化。
  assert.match(
    functionSource("requestAccountReadStop"),
    /stopRequestSession\("account", "已手动停止"\)/,
  );
  assert.match(source, /dltracker-account-stop/);
  // 差分更新：保留仍在清单中的条目，failedIds 重新进入待读队列。
  assert.match(
    functionSource("refreshAccountIndex"),
    /Object\.entries\(retained\.entries \|\| \{\}\)[\s\S]*?retryIds\.has\(id\)[\s\S]*?pendingIds = ids\.filter/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /indexed: keptCount[\s\S]*?complete: pendingIds\.length === 0/,
  );
  // 读后重算：重建 latestDealContext 并覆盖 dealInsightById 旧条目。
  assert.match(
    functionSource("rebuildDealContextFromAccountData"),
    /groupDealCoupons[\s\S]*?latestDealContext = \{[\s\S]*?coupons,[\s\S]*?cartSnapshot,[\s\S]*?bulkRules,/,
  );
  assert.match(
    functionSource("recalculateVisibleDealInsights"),
    /dealInsightById\.entries\(\)[\s\S]*?buildInsight\(/,
  );
  assert.match(
    functionSource("recalculateAccountDealInsights"),
    /rerenderAccountDealLayouts\(\)[\s\S]*?sortBuyLaterItems|applyBrowseSortAndFilter/,
  );
  assert.match(
    functionSource("recalculateAccountDealInsights"),
    /refreshOpenLanguageDialog\(\)[\s\S]*?refreshAllAccountReminders\(\)/,
  );
  // 跨标签页读取完成后本页经 storage 事件重算金额。
  assert.match(
    source,
    /event\.key === ACCOUNT_INDEX_STORAGE_KEY[\s\S]*?lastAccountIndexStorageStamp[\s\S]*?recalculateAccountDealInsights\(\)/,
  );
  // 面板显示优惠券摘要与进度条。
  assert.match(
    functionSource("renderAccountInformationPanel"),
    /\["优惠券", accountCouponSummaryText\(\)\][\s\S]*?createAccountReadProgressBlock\(index\)/,
  );
});

test("已购清单核对区分编号数与作品家族数", () => {
  const index = {
    bought: ["RJ00000001", "RJ00000002", "RJ00000003", "RJ00000004"],
    active: ["RJ00000003"],
    later: [],
    entries: {
      RJ00000001: { id: "RJ00000001", familyId: "RJ00000001", parentId: "RJ00000001", lang: "JPN" },
      RJ00000002: { id: "RJ00000002", familyId: "RJ00000001", parentId: "RJ00000001", lang: "CHI_HANS" },
      RJ00000003: { id: "RJ00000003", familyId: "RJ00000003", parentId: "RJ00000003", lang: "JPN" },
    },
  };
  const diagSandbox = {
    loadAccountIndex: () => index,
    loadLanguageFamilyCache: () => ({ parents: {} }),
  };
  vm.runInNewContext(`
    ${constantSource("WORK_EDITION_WORD")}
    ${constantSource("WORK_TITLE_EDITION_PREFIX")}
    ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
    ${functionSource("boughtWorkTitleKey")}
    ${functionSource("boughtWorkGroups")}
    ${functionSource("boughtCountBreakdown")}
    globalThis.breakdownForTest = boughtCountBreakdown;
  `, diagSandbox);
  const breakdown = diagSandbox.breakdownForTest(index, { parents: {} });
  // 4 个已购编号，其中 RJ00000001/RJ00000002 属于同一作品家族。
  assert.equal(breakdown.bought.length, 4);
  assert.equal(breakdown.familyCount, 3);
  assert.equal(breakdown.multiSkuFamilies.length, 1);
  assert.deepEqual([...breakdown.inActive], ["RJ00000003"]);
  // RJ00000004 没有语言元数据，单独列出，不影响计数。
  assert.deepEqual([...breakdown.missingEntries], ["RJ00000004"]);
});

test("同一作品的原版与简中版编号只算一部作品", () => {
  // 取自真实案例：43 条已购编号里有 4 部作品同时存在原版与【簡体中文版】两个编号。
  const titles = {
    RJ01011068: "【簡体中文版】あなたが私を買った理由",
    RJ01011067: "【簡体中文版】あなたが私を買った理由",
    RJ01010333: "あなたが私を買った理由",
    RJ01213701: "【簡体中文版】【癒されえっち】隣のスパダリな年下クン",
    RJ01213700: "【簡体中文版】【癒されえっち】隣のスパダリな年下クン",
    RJ01354066: "【簡体中文版】【分からせ】椿くん",
    RJ01249857: "【簡体中文版】【分からせ】椿くん [みんなで翻訳]",
  };
  const bought = Object.keys(titles);
  const index = { bought, active: [], later: [], entries: {} };
  const metadataCache = {
    metadata: Object.fromEntries(Object.entries(titles).map(([id, title]) => [
      id,
      { raw: { title, site_id: "girls" } },
    ])),
  };
  const diagSandbox = {
    loadAccountIndex: () => index,
    loadLanguageFamilyCache: () => ({ parents: {} }),
  };
  vm.runInNewContext(`
    ${constantSource("WORK_EDITION_WORD")}
    ${constantSource("WORK_TITLE_EDITION_PREFIX")}
    ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
    function normalizedMetadataProduct(id, raw) {
      return {
        id,
        title: String(raw?.title || id),
        siteId: String(raw?.site_id || ""),
      };
    }
    ${functionSource("boughtWorkTitleKey")}
    ${functionSource("boughtWorkGroups")}
    ${functionSource("boughtCountBreakdown")}
    globalThis.breakdownForTest = boughtCountBreakdown;
  `, diagSandbox);
  const breakdown = diagSandbox.breakdownForTest(index, { parents: {} }, metadataCache);
  assert.equal(breakdown.bought.length, 7);
  // 第 1 部 3 条（原版 + 两个简中编号）、第 2 部 2 条、第 3 部 2 条，共 3 部作品。
  assert.equal(breakdown.workCount, 3);
  assert.equal(breakdown.duplicateWorks.length, 3);
  const first = breakdown.works.find((group) => group.ids.includes("RJ01010333"));
  assert.deepEqual(
    [...first.ids],
    ["RJ01010333", "RJ01011067", "RJ01011068"],
  );
});

test("作品标题键忽略语言版前缀与译者后缀，但区分站点", () => {
  const sandbox = {};
  vm.runInNewContext(`
    ${constantSource("WORK_EDITION_WORD")}
    ${constantSource("WORK_TITLE_EDITION_PREFIX")}
    ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
    ${functionSource("boughtWorkTitleKey")}
    globalThis.keyForTest = boughtWorkTitleKey;
  `, sandbox);
  const key = sandbox.keyForTest;
  assert.equal(
    key("【簡体中文版】ある作品", "girls"),
    key("ある作品", "girls"),
  );
  assert.equal(
    key("【繁體中文版】ある作品 [みんなで翻訳]", "girls"),
    key("ある作品", "girls"),
  );
  assert.equal(
    key(" 【简体中文版】 ある作品 ", "girls"),
    key("ある作品", "girls"),
  );
  // 站点不同视为不同作品（の BL 与 girls 分区互不合并）。
  assert.notEqual(key("ある作品", "girls"), key("ある作品", "bl"));
  // 只是标题里带【】但不是语言版标记时不能误删。
  assert.equal(key("【癒されえっち】ある作品", "girls"), "【癒されえっち】ある作品|girls");
  assert.equal(key("", "girls"), "");
});

test("作品键存进账号索引，元数据缓存过期后仍按作品计数", () => {
  // 商品元数据缓存 30 分钟 TTL 到期会被清掉；workKey 落在账号索引里才能稳定。
  const index = {
    bought: ["RJ01010333", "RJ01011067", "RJ01011068"],
    active: [],
    later: [],
    entries: {
      RJ01010333: { id: "RJ01010333", familyId: "RJ01010333", workKey: "ある作品|girls" },
      RJ01011067: { id: "RJ01011067", familyId: "RJ01011067", workKey: "ある作品|girls" },
      RJ01011068: { id: "RJ01011068", familyId: "RJ01011067", workKey: "ある作品|girls" },
    },
  };
  const diagSandbox = {
    loadAccountIndex: () => index,
    loadLanguageFamilyCache: () => ({ parents: {} }),
  };
  vm.runInNewContext(`
    ${constantSource("WORK_EDITION_WORD")}
    ${constantSource("WORK_TITLE_EDITION_PREFIX")}
    ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
    ${functionSource("boughtWorkTitleKey")}
    ${functionSource("boughtWorkGroups")}
    ${functionSource("boughtCountBreakdown")}
    globalThis.breakdownForTest = boughtCountBreakdown;
  `, diagSandbox);
  const breakdown = diagSandbox.breakdownForTest(
    index, { parents: {} }, { metadata: {} });
  assert.equal(breakdown.bought.length, 3);
  assert.equal(breakdown.workCount, 1);
  assert.equal(breakdown.duplicateWorks.length, 1);
  // 索引缺 workKey 且缓存也没有标题时才退回语言家族（此例 2 组）。
  const legacy = diagSandbox.breakdownForTest(
    {
      bought: ["RJ01010333", "RJ01011067", "RJ01011068"],
      entries: {
        RJ01010333: { id: "RJ01010333", familyId: "RJ01010333" },
        RJ01011067: { id: "RJ01011067", familyId: "RJ01011067" },
        RJ01011068: { id: "RJ01011068", familyId: "RJ01011067" },
      },
    },
    { parents: {} },
    { metadata: {} },
  );
  assert.equal(legacy.workCount, 2);
  assert.equal(legacy.familyCount, 2);
});

test("账号面板的「已购买」按作品显示并附编号数", () => {
  const sandbox = {};
  vm.runInNewContext(`
    ${functionSource("boughtCountLabel")}
    globalThis.labelForTest = boughtCountLabel;
  `, sandbox);
  const label = sandbox.labelForTest;
  assert.equal(label({ bought: new Array(43).fill("X"), workCount: 39 }), "39 部（43 条编号）");
  assert.equal(label({ bought: ["RJ00000001", "RJ00000002"], workCount: 2 }), "2 部");
  assert.equal(label({ bought: ["RJ00000001"] }), "1 部");
  assert.equal(label(null), "0 部");
});

test("已购页对比按 product_id 提取编号并去重", () => {
  const links = [
    { getAttribute: () => "/girls/work/=/product_id/RJ01234567.html" },
    { getAttribute: () => "/girls/work/=/product_id/RJ01234567.html?foo=1" },
    { getAttribute: () => "/girls/work/=/product_id/BJ000123.html" },
    { getAttribute: () => "/girls/fsr/=/keyword/test" },
  ];
  const fakeRoot = { querySelectorAll: () => links };
  const sandbox = {};
  vm.runInNewContext(`
    ${functionSource("pageProductIds")}
    globalThis.pageProductIdsForTest = pageProductIds;
  `, sandbox);
  assert.deepEqual(
    [...sandbox.pageProductIdsForTest(fakeRoot)],
    ["RJ01234567", "BJ000123"],
  );
  // 已购页对比由脚本同源读取页面，不在该页面注入任何界面。
  assert.match(
    functionSource("buildBoughtCountDiagnostic"),
    /fetchBoughtPageSnapshot\(\{[\s\S]*?pageIds = snapshot\.ids/,
  );
  assert.doesNotMatch(
    functionSource("buildBoughtCountDiagnostic"),
    /document\.body\.appendChild/,
  );
});

// 用户要求：读取账号信息时只针对「已购买页面」里有的作品。
// 接口会多返回跨分区、已下架、被 302 到主编号的旧编号，这些不计入「已购买」，
// 否则页面上 39 部、账号信息里 43 条，数字又对不上。
test("已购买数量按已购买作品页口径统计，接口多出来的单独列", () => {
  const scopedSandbox = {};
  vm.runInNewContext(`
    ${constantSource("WORK_EDITION_WORD")}
    ${constantSource("WORK_TITLE_EDITION_PREFIX")}
    ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
    ${functionSource("boughtWorkTitleKey")}
    ${functionSource("boughtWorkGroups")}
    ${functionSource("boughtCountBreakdown")}
    ${functionSource("pageScopedBoughtBreakdown")}
    globalThis.scopedForTest = pageScopedBoughtBreakdown;
  `, scopedSandbox);
  const index = {
    bought: ["RJ00000001", "RJ00000002", "RJ00000003", "RJ00000004"],
    // 页面只列出前三条：第四条是已下架/旧编号，只在接口里存在。
    pageIds: ["RJ00000001", "RJ00000002", "RJ00000003"],
    active: [],
    later: [],
    entries: {},
  };
  const scoped = scopedSandbox.scopedForTest(index, { parents: {} });
  assert.equal(scoped.bought.length, 3);
  assert.equal(scoped.apiBought.length, 4);
  assert.deepEqual([...scoped.offPage], ["RJ00000004"]);
  assert.equal(scoped.scopedByPage, true);
  // 页面数据缺失（未登录/结构变化/读取失败）时退回接口全量，
  // 不能因为页面读不到就把已购算成 0。
  const fallback = scopedSandbox.scopedForTest(
    { ...index, pageIds: [] }, { parents: {} });
  assert.equal(fallback.bought.length, 4);
  assert.equal(fallback.scopedByPage, false);
  assert.equal(fallback.offPage.length, 0);
});

// 用户第二次报「还是只有 3 部」：页面被月份筛选成 3 条时，就算脚本没认出筛选，
// 也不能把「已购买」缩成 3 —— 页面条数明显少于接口就直接按接口全量算。
test("页面只列出全量的一小部分时退回接口全量，不会把已购买缩成几条", () => {
  const sandbox = {};
  vm.runInNewContext(`
    ${constantSource("WORK_EDITION_WORD")}
    ${constantSource("WORK_TITLE_EDITION_PREFIX")}
    ${constantSource("WORK_TITLE_TRANSLATOR_SUFFIX")}
    ${functionSource("boughtWorkTitleKey")}
    ${functionSource("boughtWorkGroups")}
    ${functionSource("boughtCountBreakdown")}
    ${functionSource("pageScopedBoughtBreakdown")}
    globalThis.scopedForTest = pageScopedBoughtBreakdown;
  `, sandbox);
  const many = Array.from({ length: 43 }, (_, index) => `RJ${String(index + 1).padStart(8, "0")}`);
  const index = {
    bought: many,
    pageIds: many.slice(0, 3),
    active: [],
    later: [],
    entries: {},
  };
  const scoped = sandbox.scopedForTest(index, { parents: {} });
  assert.equal(scoped.bought.length, 43);
  assert.equal(scoped.scopedByPage, false);
  assert.equal(scoped.pagePartial, true);
  assert.equal(scoped.offPage.length, 0);
  // 页面只少几条（39 vs 43）时仍以页面为准：那是「接口有、页面没列」，
  // 属于已下架/旧编号，不该把数字改回 43。
  const minor = sandbox.scopedForTest(
    { ...index, bought: many.slice(0, 43), pageIds: many.slice(0, 39) },
    { parents: {} },
  );
  assert.equal(minor.bought.length, 39);
  assert.equal(minor.scopedByPage, true);
  assert.equal(minor.pagePartial, undefined);
});
