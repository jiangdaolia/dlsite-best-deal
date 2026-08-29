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
  ${functionSource("plannerCouponsFromDeals")}
  globalThis.reachRecommendation = {
    spendThresholdCombinations,
    selectBundleRecommendations,
    plannerCouponsFromDeals,
  };`,
  sandbox,
);

const {
  spendThresholdCombinations,
  selectBundleRecommendations,
  plannerCouponsFromDeals,
} = sandbox.reachRecommendation;

test("满1200凑单优先一部达到门槛并减少超额", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 300, order: 0 },
    { id: "B", price: 300, order: 1 },
    { id: "C", price: 300, order: 2 },
    { id: "D", price: 900, order: 3 },
    { id: "E", price: 825, order: 4 },
  ], 815);

  assert.ok(combinations.length > 0);
  assert.ok(combinations.every((combination) => combination.length === 1));
  assert.equal(combinations[0][0].id, "E");
});

test("没有单部能补满时才推荐最少数量的组合", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 500, order: 0 },
    { id: "B", price: 400, order: 1 },
    { id: "C", price: 300, order: 2 },
    { id: "D", price: 250, order: 3 },
  ], 815);

  assert.ok(combinations.every((combination) => combination.length === 2));
  assert.deepEqual(Array.from(combinations[0], (item) => item.id).sort(), ["A", "B"]);
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
