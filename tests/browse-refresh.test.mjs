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

test("平台活动和优惠券可以各选一种并按交集筛选", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("browseCardMatchesOfferFilters")}
    globalThis.matches = browseCardMatchesOfferFilters;`,
    sandbox,
  );
  const insight = {
    product: { bulkbuyKey: "three-works" },
    bulkRule: { minCount: 3, discountRate: 60 },
    couponOptions: [
      { groupKey: "no-threshold", minCount: 1 },
      { groupKey: "spend", minSpend: 1200 },
    ],
  };
  assert.equal(sandbox.matches(insight, { activity: "", coupon: "" }), true);
  assert.equal(sandbox.matches(insight, {
    activity: "activity:three-works",
    coupon: "coupon:no-threshold",
  }), true);
  assert.equal(sandbox.matches(insight, {
    activity: "activity:missing",
    coupon: "coupon:no-threshold",
  }), false);
  assert.equal(sandbox.matches(insight, {
    activity: "activity:three-works",
    coupon: "coupon:missing",
  }), false);

  const dialogSource = functionSource("openBrowseOfferFilterDialog");
  assert.match(dialogSource, /不选择平台活动/);
  assert.match(dialogSource, /不选择优惠券/);
  assert.match(dialogSource, /setBrowseOfferFilters\(activityField\.select\.value, couponField\.select\.value\)/);
  assert.match(functionSource("injectBrowseControls"), /dltracker-offer-filter-button/);
  assert.match(functionSource("injectBuyLaterSortToggle"), /dltracker-offer-filter-button/);
});

test("具体优惠券和平台活动按优惠力度降序且同力度稳定", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("sortBrowseOfferFilterOptions")}
    globalThis.sortOptions = sortBrowseOfferFilterOptions;`,
    sandbox,
  );
  const sorted = sandbox.sortOptions([
    { value: "coupon:30", rate: 30, order: 0 },
    { value: "activity:60", rate: 60, order: 1 },
    { value: "coupon:50-a", rate: 50, order: 2 },
    { value: "coupon:50-b", rate: 50, order: 3 },
  ]);
  assert.deepEqual(
    Array.from(sorted, (option) => option.value),
    ["activity:60", "coupon:50-a", "coupon:50-b", "coupon:30"],
  );
  assert.match(
    functionSource("browseOfferFilterChoices"),
    /const sorted = sortBrowseOfferFilterOptions\(offerOptions\)/,
  );
});

test("浏览排序控件已在原生排序区后方时不重复插入自身", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("browseControlsInsertionBefore")}
    globalThis.insertionBefore = browseControlsInsertionBefore;`,
    sandbox,
  );
  const afterControls = { id: "list" };
  const controls = { id: "controls", nextSibling: afterControls };
  const nativeGroup = { nextSibling: controls };

  assert.equal(sandbox.insertionBefore(nativeGroup, controls), afterControls);
  assert.match(
    functionSource("injectBrowseControls"),
    /anchor\.before !== controls/,
  );
});

test("稍后再买复用浏览列表的活动与优惠券按钮筛选", () => {
  const controlsSource = functionSource("injectBuyLaterSortToggle");
  const filterSource = functionSource("applyBuyLaterBundleFilter");
  const sortSource = functionSource("sortBuyLaterItems");
  assert.match(controlsSource, /dltracker-offer-filter-button/);
  assert.match(filterSource, /syncBrowseOfferFilterButtons\(cards\)/);
  assert.match(filterSource, /browseCardMatchesOfferFilters\(insight, selected\)/);
  assert.match(filterSource, /dltracker-buy-later-filtered-out/);
  assert.match(sortSource, /applyBuyLaterBundleFilter\(ownerItems\)/);
  assert.match(source, /\.dltracker-buy-later-filtered-out \{\s*display: none !important;/);
});

test("浏览列表与稍后再买提供平台折扣失效时间排序", () => {
  const browseSource = functionSource("injectBrowseControls");
  const laterControls = functionSource("injectBuyLaterSortToggle");
  const browseSort = functionSource("applyBrowseSortAndFilter");
  const laterSort = functionSource("sortBuyLaterItems");
  assert.match(browseSource, /平台折扣失效时间/);
  assert.match(laterControls, /平台折扣失效时间/);
  assert.match(browseSort, /platformDiscountExpiry: platformDiscountExpiryMillis\(insight\?\.product\)/);
  assert.match(laterSort, /platformDiscountExpiry = platformDiscountExpiryMillis\(insight\?\.product\)/);
});

test("浏览控制区可以持久隐藏已购买作品并与凑单筛选合并", () => {
  const controlsSource = functionSource("injectBrowseControls");
  const visibilitySource = functionSource("syncBrowseCardVisibility");
  const delegatedSource = functionSource("installDealEventListeners");
  const reminderSource = functionSource("renderAccountReminderForCard");
  assert.match(source, /隐藏已购买/);
  assert.match(source, /显示已购买/);
  assert.match(delegatedSource, /dltracker-hide-purchased-button[\s\S]*?toggleBrowseAccountVisibility/);
  assert.match(functionSource("toggleBrowseAccountVisibility"), /setBrowseHidePurchased\(!getBrowseHidePurchased\(\)\)/);
  assert.match(visibilitySource, /bundleHidden \|\| purchasedHidden \|\| cartedHidden/);
  assert.match(reminderSource, /dltracker-browse-purchased-card/);
  assert.match(source, /\.dltracker-browse-account-hidden \{\s*display: none !important;/);
});

test("浏览控制区可单独隐藏购物车或稍后再买的语言家族", () => {
  assert.match(functionSource("injectBrowseControls"), /dltracker-hide-carted-button/);
  assert.match(source, /隐藏购物车\/稍后再买/);
  assert.match(source, /显示购物车\/稍后再买/);
  assert.match(
    functionSource("accountReminderData"),
    /const carted = activeGroups\.size > 0 \|\| laterGroups\.size > 0/,
  );
  assert.match(
    functionSource("renderAccountReminderForCard"),
    /dltracker-browse-carted-card", Boolean\(data\.hideCarted\)/,
  );
});

test("只隐藏理论价不低于购物车或稍后再买版本的卡片", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("shouldHideCartedCard")}
    globalThis.shouldHide = shouldHideCartedCard;`,
    sandbox,
  );
  assert.equal(sandbox.shouldHide(100, [100]), true);
  assert.equal(sandbox.shouldHide(120, [100]), true);
  assert.equal(sandbox.shouldHide(80, [100]), false);
  assert.equal(sandbox.shouldHide(120, [100, 90]), true);
  assert.equal(sandbox.shouldHide(120, [100, null]), false);
  assert.equal(sandbox.shouldHide(null, [100]), false);
  assert.match(
    functionSource("accountReminderData"),
    /evaluateCartVisibility[\s\S]*?shouldHideCartedCard[\s\S]*?cartPrices\.map/,
  );
  assert.match(
    functionSource("accountReminderData"),
    /activeGroups\.has\(identity\.lang\) \|\| laterGroups\.has\(identity\.lang\)[\s\S]*?hideCarted = true/,
  );
});

test("浏览优惠区重绘时迁移已有购买状态而不是先删除", () => {
  const renderSource = functionSource("renderBrowseCardAnalysis");
  assert.match(renderSource, /existingReminders = previousLayout\?\.querySelector/);
  assert.match(renderSource, /purchased \? " is-account-purchased" : ""/);
  assert.match(renderSource, /if \(existingReminders\) layout\.appendChild\(existingReminders\)/);
  assert.ok(
    renderSource.indexOf("layout.appendChild(existingReminders)") <
      renderSource.indexOf("host.replaceChildren(layout)"),
  );
});

test("浏览优惠区完成后不退回读取中且相同结果不重复替换", () => {
  const renderSource = functionSource("renderBrowseCardAnalysis");
  const enhanceSource = functionSource("enhanceGenericBrowseCards");
  assert.match(
    renderSource,
    /!insight && previousLayout\?\.dataset\.analysisComplete === "true"/,
  );
  assert.match(renderSource, /previousLayout\?\.dataset\.analysisSignature === signature/);
  assert.match(renderSource, /layout\.dataset\.analysisComplete = insight \? "true" : "false"/);
  assert.match(enhanceSource, /finally \{\s*markDealProcessed\(card\.node, card\.id\)/);
  assert.match(
    enhanceSource,
    /local browse analysis failed[\s\S]*?markDealProcessed\(card\.node, card\.id\)/,
  );
  assert.match(
    enhanceSource,
    /collectBrowseCards\(\)\.filter\(\(\{ id, node \}\) =>[\s\S]*?cartPage \|\|[\s\S]*?needsDealProcessing\(node, id\)/,
  );
});

test("账号提醒同时覆盖购物车卡片并复用当页语言元数据", () => {
  const dataSource = functionSource("accountReminderData");
  const reminderSource = functionSource("renderAccountReminderForCard");
  const refreshSource = functionSource("refreshAllAccountReminders");
  const cartLayoutSource = functionSource("renderCartDealLayout");
  assert.match(
    dataSource,
    /dealInsightById\.get\(id\)\?\.product \|\|\s*metadataProductFromCache\(id, context\?\.dealCache\)/,
  );
  assert.match(reminderSource, /\.dltracker-cart-host \.dltracker-cart-layout/);
  assert.doesNotMatch(refreshSource, /filter\(\(\{ cartItem \}\) => !cartItem\)/);
  assert.match(cartLayoutSource, /preservedReminders = previousLayout\?\.querySelector/);
  assert.match(cartLayoutSource, /if \(preservedReminders\) card\.prepend\(preservedReminders\)/);
  assert.match(source, /\.dltracker-cart-layout\.is-account-purchased \{\s*filter: grayscale\(0\.38\);/);
});

test("浏览卡并行补全史低且账号提醒复用整页缓存快照", () => {
  const enhanceSource = functionSource("enhanceGenericBrowseCards");
  const preloadSource = functionSource("preloadBrowseBulkRules");
  const refreshSource = functionSource("refreshAllAccountReminders");
  const contextSource = functionSource("createAccountReminderContext");
  const dataSource = functionSource("accountReminderData");
  assert.match(enhanceSource, /preloadBrowseBulkRules\(\[\.\.\.metadata\.values\(\)\]\)/);
  assert.match(
    enhanceSource,
    /mapWithConcurrency\(\s*preparedCards\.filter\(\(card\) => !card\.failed\),\s*BROWSE_RENDER_CONCURRENCY/,
  );
  assert.ok(
    enhanceSource.indexOf("renderBrowseCardAnalysis(analysisHost, { rjCode: id }, null)") <
      enhanceSource.indexOf("await preloadBrowseBulkRules"),
  );
  assert.match(preloadSource, /for \(const product of products \|\| \[\]\)[\s\S]*?await ensureBulkRule\(product\)/);
  assert.match(contextSource, /index: loadAccountIndex\(\)[\s\S]*?languageCache: loadLanguageFamilyCache\(\)[\s\S]*?dealCache: loadDealCache\(\)/);
  assert.match(refreshSource, /createAccountReminderContext\(\{ cacheOnly: true \}\)/);
  assert.match(refreshSource, /mapWithConcurrency\(cards, BROWSE_RENDER_CONCURRENCY/);
  assert.match(dataSource, /productNeedsLanguageFamilyLookup[\s\S]*?!context\?\.cacheOnly/);
});

test("无优惠作品也会留下已处理标记供观察器识别", () => {
  assert.match(functionSource("enhanceGenericBrowseCards"), /markDealProcessed\(node, id\)/);
  assert.match(functionSource("installSpaListeners"), /needsDealProcessing\(node, id\)/);
});

test("浏览排序只在实际顺序变化时移动作品节点", () => {
  const sortSource = functionSource("applyBrowseSortAndFilter");
  assert.match(sortSource, /currentNodes\[index\] !== node/);
  assert.match(sortSource, /sortedNodes\.forEach\(\(node\) => parent\.appendChild\(node\)\)/);
});

test("从详情页返回列表时恢复已选筛选和排序", () => {
  const restoreSource = functionSource("restoreBrowseStateOnPageShow");
  const listenerSource = functionSource("installSpaListeners");
  assert.match(restoreSource, /if \(!event\?\.persisted\) return/);
  assert.match(restoreSource, /lastUrl = currentUrl/);
  assert.match(restoreSource, /resetBrowseOriginalOrder\(\)/);
  assert.match(restoreSource, /await bootstrap\(\)/);
  assert.match(restoreSource, /await applyBrowseSortAndFilter\(\)/);
  assert.match(
    listenerSource,
    /window\.addEventListener\("pageshow", restoreBrowseStateOnPageShow\)/,
  );
  assert.match(
    functionSource("installDealEventListeners"),
    /dltracker-account-info-button[\s\S]*?openAccountInformationDialog\(\)/,
  );
});

test("手机版控件挂到作品一览而不是页顶排行", () => {
  const collectSource = functionSource("collectBrowseCards");
  const enhanceSource = functionSource("enhanceGenericBrowseCards");
  assert.match(functionSource("findBrowsePrimaryList"), /form#works \.n_work_list_container/);
  assert.match(collectSource, /const scope = primaryList \|\| document/);
  assert.match(collectSource, /scope\.querySelectorAll/);
  assert.match(enhanceSource, /injectBrowseControls\(false\)/);
  assert.match(functionSource("bootstrap"), /injectBrowseControls\(false\)/);
  assert.match(functionSource("installSpaListeners"), /!document\.querySelector\("\.dltracker-browse-controls"\)/);
});

test("指定条件搜索跳过加载骨架并采集横向表格作品", () => {
  const primarySource = functionSource("findBrowsePrimaryList");
  const collectSource = functionSource("collectBrowseCards");
  assert.match(primarySource, /querySelectorAll\(selector\)/);
  assert.match(primarySource, /search_skeleton_box/);
  assert.match(primarySource, /data-list_item_product_id/);
  assert.match(collectSource, /tr\[data-list_item_product_id\]/);
  assert.match(functionSource("productIdFromNode"), /data-list_item_product_id/);
  assert.match(functionSource("findBrowseTagAnchor"), /\.search_tag/);
});

test("购物车不用普通浏览页的主列表限域", () => {
  const collectSource = functionSource("collectBrowseCards");
  assert.match(
    collectSource,
    /isCartPage\(location\.href\) \|\| isProductPage\(location\.href\)\s*\? null/,
  );
  assert.match(collectSource, /const cartItem = cartPage && isRenderableCartItem\(node\)/);
  assert.match(collectSource, /const cartRecommendation = cartPage && isCartRecommendationCard\(node\)/);
  assert.match(collectSource, /if \(cartPage && !cartItem && !cartRecommendation\) return/);
  assert.match(collectSource, /for \(const item of getCartItems\(\)\)/);
});

test("购物车底部推荐卡显示分析但不作为购物车作品", () => {
  const collectSource = functionSource("collectBrowseCards");
  const enhanceSource = functionSource("enhanceGenericBrowseCards");
  const mutationSource = functionSource("maybeBootstrapForCartMutation");
  assert.match(
    functionSource("isCartRecommendationCard"),
    /\.__cart_recommend, \.recommend_list/,
  );
  assert.match(collectSource, /cards\.push\(\{ id, node, cartItem, cartRecommendation \}\)/);
  assert.match(enhanceSource, /for \(const \{ id, node, cartItem \} of cards\)/);
  assert.match(enhanceSource, /card\.cartHost = card\.cartItem/);
  assert.match(enhanceSource, /const analysisHost = cartItem \? null : ensureBrowseAnalysisHost\(node\)/);
  assert.match(enhanceSource, /renderBrowseCardAnalysis\(card\.analysisHost, record, card\.insight\)/);
  assert.match(mutationSource, /\(\{ cartRecommendation \}\) => cartRecommendation/);
  assert.match(mutationSource, /scheduleCartBootstrap\(\)/);
  assert.doesNotMatch(functionSource("cartProductsFromRoot"), /cartRecommendation/);
});

test("普通作品卡在标签后使用三框和简洁优惠行", () => {
  const hostSource = functionSource("ensureBrowseAnalysisHost");
  const renderSource = functionSource("renderBrowseCardAnalysis");
  const frameSource = functionSource("createBrowseAnalysisFrame");
  const stackSource = functionSource("shouldStackBrowseAnalysis");
  assert.match(functionSource("findBrowseTagAnchor"), /\.work_genre/);
  assert.match(functionSource("findBrowseTagAnchor"), /\.work_labels/);
  assert.match(hostSource, /anchor\.insertAdjacentElement\("afterend", host\)/);
  assert.match(hostSource, /parent\.appendChild\(host\)/);
  assert.match(renderSource, /label: "本次可到"/);
  assert.match(renderSource, /label: "史低"/);
  assert.match(renderSource, /label: "趋势"/);
  assert.match(renderSource, /cartLocalizedMoney\(reachPrice, cnyRate\)/);
  assert.match(renderSource, /cartLocalizedMoney\(lowestPrice, cnyRate\)/);
  assert.match(renderSource, /dltracker-browse-analysis-amount/);
  assert.match(renderSource, /可用优惠券：/);
  assert.match(renderSource, /平台活动：/);
  assert.match(renderSource, /dltracker-browse-analysis-offer-group/);
  assert.match(renderSource, /dltracker-browse-analysis-offer-item/);
  assert.match(renderSource, /const stacked = shouldStackBrowseAnalysis\(\)/);
  assert.match(renderSource, /stacked \? " is-stacked" : ""/);
  assert.match(stackSource, /isTouchPath\(location\.href\)/);
  assert.match(stackSource, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(stackSource, /maxTouchPoints/);
  assert.match(frameSource, /dltracker-browse-analysis-frame/);
  assert.match(
    source,
    /\.dltracker-browse-analysis-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) max-content/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis \{[\s\S]*?font-size: 8px/,
  );
  assert.match(source, /\.dltracker-browse-analysis-trend \{\s*padding-inline: 5px/);
  assert.match(source, /\.dltracker-browse-analysis-host \{[\s\S]*?container-type: inline-size/);
  assert.match(source, /\.dltracker-browse-analysis-host \{[\s\S]*?overflow: hidden/);
  const hostLayoutRule = source.match(
    /\.n_work_item > \.dltracker-browse-analysis-host,\s*dl > \.dltracker-browse-analysis-host \{([^}]*)\}/,
  )?.[1] || "";
  assert.match(hostLayoutRule, /width: auto/);
  assert.match(hostLayoutRule, /align-self: stretch/);
  assert.doesNotMatch(hostLayoutRule, /margin-(?:left|right)/);
  assert.doesNotMatch(hostLayoutRule, /padding-(?:left|right)/);
  assert.match(source, /\.dltracker-browse-analysis-amount \{\s*display: none/);
  assert.match(
    source,
    /@container \(min-width: 320px\) \{\s*\.dltracker-browse-analysis-amount \{\s*display: inline/,
  );
  assert.match(
    source,
    /\.\$\{UI_CLASSNAME\}\.dltracker-browse-analysis\.is-stacked \{\s*margin: 2px 0 12px/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis\.is-stacked \.dltracker-browse-analysis-grid \{\s*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis-offers \{[\s\S]*?flex-wrap: wrap[\s\S]*?overflow-wrap: normal/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis-offer-group \{[\s\S]*?flex-wrap: wrap/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis-offer-group strong,\s*\.dltracker-browse-analysis-offer-item \{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere/,
  );
});

test("移动作品卡布局按路由和输入方式判断而不是固定像素", () => {
  const sandbox = {
    location: { href: "https://www.dlsite.com/maniax-touch/fsr/" },
    window: {
      matchMedia: () => ({ matches: false }),
      navigator: { maxTouchPoints: 0 },
    },
  };
  vm.runInNewContext(
    `${functionSource("isTouchPath")}
    ${functionSource("shouldStackBrowseAnalysis")}
    globalThis.shouldStack = shouldStackBrowseAnalysis;`,
    sandbox,
  );
  assert.equal(sandbox.shouldStack(), true);

  sandbox.location.href = "https://www.dlsite.com/maniax/fsr/";
  sandbox.window.matchMedia = (query) => {
    assert.equal(query, "(hover: none) and (pointer: coarse)");
    return { matches: true };
  };
  assert.equal(sandbox.shouldStack(), true);

  sandbox.window.matchMedia = () => ({ matches: false });
  assert.equal(sandbox.shouldStack(), false);

  sandbox.window.matchMedia = () => {
    throw new Error("unsupported");
  };
  sandbox.window.navigator.maxTouchPoints = 2;
  assert.equal(sandbox.shouldStack(), true);
});
