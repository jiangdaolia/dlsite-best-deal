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

test("筛选选项未变化时不重建 select", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("browseSelectOptionsMatch")}
    globalThis.matches = browseSelectOptionsMatch;`,
    sandbox,
  );
  const select = {
    options: [
      { value: "all", textContent: "全部作品" },
      { value: "bundle", textContent: "所有需要凑单的优惠" },
    ],
  };
  const options = [
    { value: "all", label: "全部作品" },
    { value: "bundle", label: "所有需要凑单的优惠" },
  ];
  assert.equal(sandbox.matches(select, options), true);
  assert.equal(sandbox.matches(select, [...options, { value: "x", label: "X" }]), false);
  assert.match(
    functionSource("syncBundleFilterSelect"),
    /if \(!browseSelectOptionsMatch\(filter, options\)\)/,
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

test("稍后再买复用浏览列表的凑单筛选", () => {
  const controlsSource = functionSource("injectBuyLaterSortToggle");
  const filterSource = functionSource("applyBuyLaterBundleFilter");
  const sortSource = functionSource("sortBuyLaterItems");
  assert.match(controlsSource, /dltracker-buy-later-filter-select/);
  assert.match(controlsSource, /setBrowseBundleFilter\(filterSelect\.value\)/);
  assert.match(filterSource, /syncBundleFilterSelect\(filter, cards\)/);
  assert.match(filterSource, /browseCardMatchesFilter\(insight, selected\)/);
  assert.match(filterSource, /dltracker-buy-later-filtered-out/);
  assert.match(sortSource, /applyBuyLaterBundleFilter\(ownerItems\)/);
  assert.match(source, /\.dltracker-buy-later-filtered-out \{\s*display: none !important;/);
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
  assert.match(enhanceSource, /async \(\{ id, node, cartItem \}\)/);
  assert.match(enhanceSource, /const cartHost = cartItem/);
  assert.match(enhanceSource, /const analysisHost = cartItem \? null : ensureBrowseAnalysisHost\(node\)/);
  assert.match(enhanceSource, /renderBrowseCardAnalysis\(analysisHost, record, insight\)/);
  assert.match(mutationSource, /\(\{ cartRecommendation \}\) => cartRecommendation/);
  assert.match(mutationSource, /scheduleCartBootstrap\(\)/);
  assert.doesNotMatch(functionSource("cartProductsFromRoot"), /cartRecommendation/);
});

test("普通作品卡在标签后使用三框和简洁优惠行", () => {
  const hostSource = functionSource("ensureBrowseAnalysisHost");
  const renderSource = functionSource("renderBrowseCardAnalysis");
  const frameSource = functionSource("createBrowseAnalysisFrame");
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
  assert.match(source, /\.dltracker-browse-analysis-amount \{\s*display: none/);
  assert.match(
    source,
    /@container \(min-width: 320px\) \{\s*\.dltracker-browse-analysis-amount \{\s*display: inline/,
  );
  assert.match(
    source,
    /@media \(max-width: 768px\)[\s\S]*?\.\$\{UI_CLASSNAME\}\.dltracker-browse-analysis \{\s*margin: 2px 0 12px/,
  );
  assert.match(
    source,
    /@media \(max-width: 768px\)[\s\S]*?\.dltracker-browse-analysis-grid \{\s*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis-offers \{[\s\S]*?flex-wrap: wrap[\s\S]*?overflow-wrap: normal/,
  );
  assert.match(
    source,
    /\.dltracker-browse-analysis-offer-group \{[\s\S]*?flex-wrap: wrap/,
  );
});
