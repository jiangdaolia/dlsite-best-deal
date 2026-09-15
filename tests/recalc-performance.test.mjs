import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);

function functionBody(name) {
  const matched = source.match(
    new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}\\n`),
  );
  if (!matched) throw new Error(`${name} not found in source`);
  return matched[0];
}

function constantNumber(name) {
  const matched = source.match(new RegExp(`const ${name} = (\\d+)`));
  if (!matched) throw new Error(`${name} not found in source`);
  return Number(matched[1]);
}

test("同源 fetch 带超时", () => {
  for (const name of ["fetchSameOriginText", "fetchSameOriginJson"]) {
    const body = functionBody(name);
    assert.match(body, /AbortController/);
    assert.match(body, /setTimeout/);
    assert.match(body, /Promise\.race/);
    assert.match(body, /请求超时/);
    assert.match(body, /clearTimeout\(abortTimer\)/);
    assert.match(body, /timeoutMs/);
  }
  assert.match(source, /const SAME_ORIGIN_TIMEOUT_MS = 15000/);
});

test("deal 缓存与账号索引解析结果记忆化", () => {
  assert.match(source, /let dealCacheMemo = \{ raw: null, value: null \}/);
  assert.match(source, /let accountIndexMemo = \{ raw: null, value: null \}/);

  const loadDealCache = functionBody("loadDealCache");
  assert.match(loadDealCache, /dealCacheMemo\.raw === raw/);
  assert.match(loadDealCache, /dealCacheMemo = \{ raw, value \}/);

  const saveDealCache = functionBody("saveDealCache");
  assert.match(saveDealCache, /dealCacheMemo = \{ raw: serialized, value: cache \}/);

  const loadAccountIndex = functionBody("loadAccountIndex");
  assert.match(loadAccountIndex, /accountIndexMemo\.raw === raw/);
  assert.match(loadAccountIndex, /accountIndexMemo = \{ raw, value \}/);

  const saveAccountIndex = functionBody("saveAccountIndex");
  assert.match(saveAccountIndex, /accountIndexMemo = \{ raw: serialized, value: index \}/);
});

test("重算循环延迟渲染且复用已查活动规则", () => {
  const buildInsight = functionBody("buildInsight");
  assert.match(buildInsight, /!buildOptions\.deferRender/);
  assert.match(buildInsight, /refreshHistoryReachBadges/);

  const recalc = functionBody("recalculateVisibleDealInsights");
  assert.match(recalc, /deferRender: true/);
  assert.doesNotMatch(recalc, /refreshHistoryReachBadges/);
  assert.match(recalc, /accountReadStopRequested/);
  assert.match(recalc, /bulkRules\.get\(key\)/);
  assert.match(recalc, /attemptedKeys\?\.has\(key\)/);
  assert.match(recalc, /await sleep\(0\)/);
});

test("活动规则并发读取且可停止", () => {
  const body = functionBody("bulkRuleMapForProducts");
  assert.match(body, /mapWithConcurrency/);
  assert.match(body, /BULK_RULE_FETCH_CONCURRENCY/);
  assert.match(body, /shouldStop\(\)/);
  assert.match(body, /requestSessionStopped\(\)/);
  assert.match(body, /attemptedKeys\?\.add\(key\)/);
  assert.match(body, /onProgress\?\./);
  assert.ok(
    constantNumber("BULK_RULE_FETCH_CONCURRENCY") <=
      constantNumber("BROWSE_RENDER_CONCURRENCY"),
    "bulk rule concurrency must not exceed browse render concurrency",
  );
});

test("重算上下文停止信号与已尝试规则集合", () => {
  const rebuild = functionBody("rebuildDealContextFromAccountData");
  assert.match(rebuild, /shouldStop: \(\) => accountReadStopRequested/);
  assert.match(rebuild, /attemptedKeys: bulkRuleAttempts/);
  assert.match(rebuild, /bulkRuleAttempts,/);

  const batches = functionBody("ensureProductMetadataBatches");
  assert.match(batches, /options\.shouldStop\?\.\(\)/);
});

test("重算阶段可停止且子进度可见", () => {
  const pipeline = functionBody("recalculateAccountDealInsights");
  assert.match(pipeline, /accountReadStopRequested/);
  assert.match(pipeline, /recalcFraction/);
  assert.match(pipeline, /刷新账号提醒/);

  const stageText = functionBody("accountReadStageText");
  assert.match(stageText, /accountReadRuntime\.detail \|\| "重算优惠金额"/);

  const fraction = functionBody("accountReadProgressFraction");
  assert.match(fraction, /accountReadRuntime\.recalcFraction/);

  const flow = functionBody("runAccountReadFlow");
  assert.match(flow, /accountReadStopRequested = false/);
});

test("列表排序批量读取价格记录", () => {
  const sortLater = functionBody("sortBuyLaterItems");
  assert.match(sortLater, /listPriceRecords\(\)/);
  assert.doesNotMatch(sortLater, /await getPriceRecord/);

  const browseSort = functionBody("applyBrowseSortAndFilter");
  assert.match(browseSort, /listPriceRecords\(\)/);
  assert.doesNotMatch(browseSort, /await getPriceRecord/);
});
