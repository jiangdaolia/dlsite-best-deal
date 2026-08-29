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

test("手机版控件挂到作品一览而不是页顶排行", () => {
  const collectSource = functionSource("collectBrowseCards");
  const enhanceSource = functionSource("enhanceGenericBrowseCards");
  assert.match(collectSource, /form#works \.n_work_list_container/);
  assert.match(collectSource, /const scope = primaryList \|\| document/);
  assert.match(collectSource, /scope\.querySelectorAll/);
  assert.match(enhanceSource, /injectBrowseControls\(false\)/);
  assert.match(functionSource("bootstrap"), /injectBrowseControls\(false\)/);
  assert.match(functionSource("installSpaListeners"), /!document\.querySelector\("\.dltracker-browse-controls"\)/);
});
