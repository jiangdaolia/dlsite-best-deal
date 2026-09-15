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

function constSource(name) {
  const matched = source.match(new RegExp(
    `  const ${name} = (?:\\{[\\s\\S]*?\\}|\\[[^\\]]*\\]|[^;\\n]*);`,
  ));
  if (!matched) throw new Error(`${name} not found`);
  return matched[0];
}

function loadMoneySandbox() {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("toYen")}
    ${functionSource("dealNumber")}
    ${functionSource("safeNumber")}
    ${functionSource("hasEffectiveDiscount")}
    ${functionSource("cartLocalizedMoney")}
    ${functionSource("cartFrameLocalizedMoney")}
    ${functionSource("dealMoney")}
    ${functionSource("historyChipLabel")}
    globalThis.format = {
      cartLocalizedMoney,
      cartFrameLocalizedMoney,
      dealMoney,
      historyChipLabel,
    };`,
    sandbox,
  );
  return sandbox.format;
}

function loadReasonSandbox() {
  const sandbox = {};
  vm.runInNewContext(
    `${constSource("PARTIAL_REASON_ORDER")}
    ${constSource("PARTIAL_REASON_LABELS")}
    ${constSource("PARTIAL_REASON_HINTS")}
    ${functionSource("insightPartialReasonKeys")}
    ${functionSource("partialReasonLabels")}
    ${functionSource("partialReasonText")}
    ${functionSource("partialReasonTitle")}
    globalThis.reason = {
      insightPartialReasonKeys,
      partialReasonLabels,
      partialReasonText,
      partialReasonTitle,
    };`,
    sandbox,
  );
  return sandbox.reason;
}

test("所有金额格式化统一为 人民币/日元 斜杠格式", () => {
  const format = loadMoneySandbox();
  const rate = 16.23 / 385;
  assert.equal(format.dealMoney(385, rate), "16.23元/385円");
  assert.equal(format.cartLocalizedMoney(1078, 45.43 / 1078), "45.43元/1,078円");
  assert.equal(format.cartFrameLocalizedMoney(1078, 45.43 / 1078), "45.43元/1,078円");
  assert.equal(format.dealMoney(385), "385円");
  assert.equal(format.cartLocalizedMoney(1078), "1,078円");
  assert.doesNotMatch(functionSource("cartLocalizedMoney"), /元（/);
  assert.doesNotMatch(functionSource("dealMoney"), /円｜/);
});

test("史低 chip 输出 标签 人民币/日元，缺汇率时降级为日元", () => {
  const format = loadMoneySandbox();
  const record = { lowestPrice: 79, regularPrice: 110, discountRate: 28 };
  const rate = 3.44 / 79;
  assert.equal(format.historyChipLabel(record, rate), "史低 3.44元/79円");
  assert.equal(format.historyChipLabel(record), "史低 79円");
  assert.equal(
    format.historyChipLabel({ ...record, dlwatcherCurrentPrice: 79 }, rate),
    "新史低 3.44元/79円",
  );
  assert.equal(format.historyChipLabel({ lowestPrice: 79 }), "无折扣记录");
});

test("史低 chip 在 insight 到达后原位补人民币", () => {
  const refreshSource = functionSource("refreshHistoryReachBadges");
  assert.match(
    refreshSource,
    /\.dltracker-history-chip \.dltracker-chip-text/,
  );
  assert.match(refreshSource, /historyChipLabel\(/);
  assert.match(refreshSource, /currencyRateFromProducts\(\[insight\?\.product\]\)/);
  const renderSource = functionSource("renderPriceCard");
  assert.match(renderSource, /historyChipLabel\(/);
  assert.match(renderSource, /browseRecordById\.set\(String\(record\.rjCode\)/);
});

test("本次徽章使用 人民币/日元 价格", () => {
  const badgeSource = functionSource("createBestReachBadge");
  assert.match(badgeSource, /currencyRateFromProducts\(\[insight\?\.product\]\)/);
  assert.match(badgeSource, /cartFrameLocalizedMoney\(price, cnyRate\)/);
});

test("价格框只在有折扣时渲染 OFF", () => {
  const frameSource = functionSource("createCartDealPriceFrame");
  assert.match(
    frameSource,
    /Number\.isFinite\(rate\) && rate > 0/,
  );
  assert.doesNotMatch(frameSource, /无折扣/);
});

test("partialReasonText 按固定顺序列出具体原因并回退", () => {
  const reason = loadReasonSandbox();
  const insight = { partial: true, partialReasons: ["activity", "coupon"] };
  assert.equal(
    reason.partialReasonText(insight),
    "部分优惠未确认：优惠券、平台活动",
  );
  assert.equal(
    reason.partialReasonText({ partial: true }, ["cart", "metadata"]),
    "部分优惠未确认：购物车快照、作品信息",
  );
  assert.equal(
    reason.partialReasonText({ partial: true }),
    "部分优惠未确认",
  );
  assert.match(
    reason.partialReasonTitle(insight),
    /优惠券：列表读取失败/,
  );
  assert.match(
    reason.partialReasonTitle(insight),
    /平台活动：存在多件活动但规则未读到/,
  );
});

test("buildInsight 汇总调用方与上下文原因并标记活动缺失", () => {
  const body = functionSource("buildInsight");
  assert.match(body, /partialReasons = \[\]/);
  assert.match(body, /latestDealContext\.partialReasons/);
  assert.match(body, /reasonSet\.add\("activity"\)/);
  assert.match(body, /partial: reasonSet\.size > 0/);
  assert.match(
    body,
    /partialReasons: PARTIAL_REASON_ORDER\.filter/,
  );
});

test("各来源写入对应的 partialReasons", () => {
  assert.match(
    functionSource("enhanceDealInsights"),
    /dealDataPartial \? \["coupon"\] : \[\]/,
  );
  assert.match(
    functionSource("enhanceDealInsights"),
    /rawCartSnapshot\.loaded \? \[\] : \["cart"\]/,
  );
  assert.match(
    functionSource("enhanceGenericBrowseCards"),
    /partialReasons = partial \? \["metadata"\] : \[\]/,
  );
  assert.match(
    functionSource("enhanceProductDealDetail"),
    /partial \? \["metadata"\] : \[\]/,
  );
  assert.match(
    functionSource("recalculateVisibleDealInsights"),
    /previous\.partialReasons/,
  );
});

test("五处部分优惠未确认提示均渲染具体原因", () => {
  for (const name of [
    "renderBrowseCardAnalysis",
    "renderCompactInsight",
    "renderDetailInsight",
    "renderCartDealLayout",
  ]) {
    assert.match(functionSource(name), /applyPartialReasonText\(/, name);
  }
  const dialogSource = functionSource("renderReachDialog");
  assert.match(dialogSource, /部分优惠未确认（\$\{labels\}）/);
  assert.match(dialogSource, /contextPartialExtraReasons\(snapshot\)/);
});

test("签名包含 partialReasons 避免原因变化时跳过重绘", () => {
  assert.match(
    functionSource("browseAnalysisSignature"),
    /partialReasons: insight\.partialReasons/,
  );
  assert.match(
    functionSource("reachDialogDataSignature"),
    /partialReasons: partialReasonLabels\(insight/,
  );
});
