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
    functionSource("injectBrowseControls"),
    /if \(!browseSelectOptionsMatch\(filter, options\)\)/,
  );
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
