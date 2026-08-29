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

const sandbox = {
  couponMatchesDealProduct() {
    return true;
  },
  compactCouponListLabel() {
    return "";
  },
  couponEquivalentRate() {
    return 0;
  },
};
vm.runInNewContext(
  `${functionSource("dealNumber")}
  ${functionSource("compareSpendCombinationTie")}
  ${functionSource("spendThresholdCombinations")}
  ${functionSource("bundleRecommendationKey")}
  ${functionSource("bundleRecommendationAddedCost")}
  ${functionSource("selectBundleRecommendations")}
  ${functionSource("recommendationFinalPriceMap")}
  ${functionSource("plannerCouponsFromDeals")}
  globalThis.reachRecommendation = {
    spendThresholdCombinations,
    selectBundleRecommendations,
    recommendationFinalPriceMap,
    plannerCouponsFromDeals,
  };`,
  sandbox,
);

const {
  spendThresholdCombinations,
  selectBundleRecommendations,
  recommendationFinalPriceMap,
  plannerCouponsFromDeals,
} = sandbox.reachRecommendation;

test("满1200凑单优先一部达标也保留多部合计方案", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 300, order: 0 },
    { id: "B", price: 300, order: 1 },
    { id: "C", price: 300, order: 2 },
    { id: "D", price: 900, order: 3 },
    { id: "E", price: 825, order: 4 },
  ], 815);

  assert.ok(combinations.length > 0);
  assert.equal(combinations[0].length, 1);
  assert.equal(combinations[0][0].id, "E");
  assert.ok(combinations.some((combination) => combination.length > 1));
});

test("没有单部能补满时才推荐最少数量的组合", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 500, order: 0 },
    { id: "B", price: 400, order: 1 },
    { id: "C", price: 300, order: 2 },
    { id: "D", price: 250, order: 3 },
  ], 815);

  assert.equal(combinations[0].length, 2);
  assert.deepEqual(Array.from(combinations[0], (item) => item.id).sort(), ["A", "B"]);
});

test("同时有件数和金额门槛时可用多部作品合计补齐", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 900, order: 0 },
    { id: "B", price: 500, order: 1 },
    { id: "C", price: 350, order: 2 },
  ], 800, 30, 2);

  assert.ok(combinations.length > 0);
  assert.ok(combinations.every((combination) => combination.length >= 2));
  assert.ok(combinations.every((combination) =>
    combination.reduce((sum, item) => sum + item.price, 0) >= 800));
  assert.match(
    functionSource("buildBundleRecommendations"),
    /calculationUsesCoupon\(calculation, offer\.key\)/,
  );
});

test("拼单分别选择全员最优和预计总价最低方案", () => {
  const selected = selectBundleRecommendations([
    {
      added: [{ id: "ALL", price: 500, order: 0 }],
      reachedCount: 2,
      historyHits: 0,
      spendOverage: 0,
      total: 900,
    },
    {
      added: [{ id: "LOW", price: 200, order: 1 }],
      reachedCount: 1,
      historyHits: 0,
      spendOverage: 0,
      total: 700,
    },
  ], 1);

  assert.deepEqual(Array.from(selected, (item) => item.recommendationKind), [
    "all-optimal",
    "lowest",
  ]);
});

test("推荐表格按优惠对象分摊券额且加总不变", () => {
  const prices = recommendationFinalPriceMap({
    currentPlan: {
      orders: [{
        discount: 400,
        lines: [
          { id: "A", price: 500, couponTarget: true },
          { id: "B", price: 700, couponTarget: true },
          { id: "C", price: 300, couponTarget: false },
        ],
      }],
    },
  });

  assert.equal(prices.get("A") + prices.get("B") + prices.get("C"), 1100);
  assert.equal(prices.get("C"), 300);
  assert.match(functionSource("appendRecommendationTable"), /推荐凑单作品/);
  assert.match(functionSource("appendRecommendationTable"), /史低折扣/);
  assert.match(functionSource("appendRecommendationTable"), /优惠前/);
  assert.match(functionSource("appendRecommendationTable"), /优惠后/);
});

test("满额固定减免券的理论计算改用门槛等效折扣", () => {
  const coupons = plannerCouponsFromDeals([{
    id: "C400",
    groupKey: "C400",
    discountType: "fixed",
    discount: 400,
    minSpend: 1200,
    minCount: 1,
    maxDiscount: 0,
    repeatable: false,
    instances: 1,
  }], [{ id: "RJ123456", price: 385 }], true);

  assert.equal(coupons[0].type, "percent");
  assert.equal(coupons[0].minSpend, 0);
  assert.equal(coupons[0].maxDiscount, 400);
  assert.ok(Math.abs(coupons[0].value - 100 / 3) < 0.001);
});

test("当前作品弹窗过滤不适用券并锁定背景滚动", () => {
  assert.match(
    functionSource("renderReachDialog"),
    /couponMatchesDealProduct\(offer\.coupon, insight\.product\)/,
  );
  assert.match(functionSource("openReachDialog"), /lockReachDialogScroll\(\)/);
  assert.match(functionSource("closeReachDialog"), /unlockReachDialogScroll\(\)/);
  assert.match(functionSource("lockReachDialogScroll"), /body\.style\.position = "fixed"/);
});
