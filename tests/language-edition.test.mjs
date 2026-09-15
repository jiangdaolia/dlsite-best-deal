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
  const metadata = Object.fromEntries(Array.from({ length: 41 }, (_, index) => [
    `RJ${String(index).padStart(8, "0")}`,
    { fetchedAt: index + 1, raw: { value: "x".repeat(50) } },
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
    let accountIndexRuntimeError = "";
    ${functionSource("storageQuotaExceeded")}
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
  assert.match(source, /stopRequestSession\("account", `\$\{label\} HTTP \$\{response\.status\}`\)/);
  assert.match(source, /account index requests stopped/);
  assert.doesNotMatch(functionSource("fetchSameOriginJson"), /dealSessionStopped/);
  assert.doesNotMatch(functionSource("refreshAccountIndex"), /dealSessionStopped/);
  assert.match(
    functionSource("refreshAccountIndex"),
    /pausedReason: accountIndexSessionStopReason \|\| accountIndexRuntimeError/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /if \(!acquireAccountIndexLock\(\)\)[\s\S]*?另一个 DLsite 页面正在读取账号索引/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /stage: "读取账号购物车信息"[\s\S]*?stage: "读取已购清单"[\s\S]*?stage: `读取作品信息/,
  );
  assert.match(
    functionSource("refreshAccountIndex"),
    /\.finally\(\(\) => \{\s*releaseAccountIndexLock\(\)/,
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
  assert.match(source, /window\.addEventListener\("pagehide", releaseAccountIndexLock\)/);
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
  assert.match(source, /await restoreLanguageDialogAfterReload\(\{ deferRender: true \}\);\s*await bootstrap\(\)/);
  assert.match(source, /const initialRender = !state\.rows\.length \|\| !body\.firstElementChild;\s*if \(initialRender\) body\.textContent/);
  assert.match(source, /button\.style\.inlineSize = `\$\{rect\.width\}px`;\s*button\.style\.blockSize = `\$\{rect\.height\}px`;/);
  assert.match(source, /entry\.style\.marginInlineStart = `\$\{Math\.max\(0, rect\.left - contentLeft\)\}px`;/);
  assert.match(source, /mobileText \? "is-mobile-text" : "is-desktop-button"/);
  assert.match(source, /nativeHost\.insertBefore\(entry, nativeAction\)/);
  assert.doesNotMatch(source, /nativeHost\.parentElement\.insertBefore\(entry, nativeHost\)/);
  assert.doesNotMatch(source, /\.dltracker-language-entry-cart\.is-desktop-button\s*\{\s*width:\s*100%/);
  assert.match(source, /\.dltracker-language-entry-cart\.is-mobile-text \.dltracker-language-entry-button,[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(source, /读取账号信息（优惠券、购物车、已购清单）/);
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
