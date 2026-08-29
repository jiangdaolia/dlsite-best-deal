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
  compactCouponListLabel() {
    return "";
  },
};
vm.runInNewContext(
  `${functionSource("safeNumber")}
  ${functionSource("toYen")}
  ${functionSource("dealNumber")}
  ${functionSource("dealTokens")}
  ${functionSource("dealNormalizedSite")}
  ${functionSource("dealProductIds")}
  ${functionSource("couponMatchesDealProduct")}
  ${functionSource("couponEquivalentRate")}
  ${functionSource("currencyRateFromProducts")}
  ${functionSource("dealMoney")}
  ${functionSource("compareRecommendationOrder")}
  ${functionSource("recommendationCombinationFinalTotal")}
  ${functionSource("recommendationCombinationRate")}
  ${functionSource("spendThresholdCombinations")}
  ${functionSource("couponIsCurrent")}
  ${functionSource("highestRecommendationCoupons")}
  ${functionSource("recommendationCouponEligibility")}
  ${functionSource("targetRecommendationOffers")}
  ${functionSource("recommendationCandidateMatchesOffer")}
  ${functionSource("sortRecommendationCandidates")}
  ${functionSource("recommendationFinalPriceMap")}
  ${functionSource("recommendationStrongestDiscountRate")}
  ${functionSource("isRecordNewLowest")}
  ${functionSource("plannerCouponsFromDeals")}
  globalThis.reachRecommendation = {
    currencyRateFromProducts,
    dealMoney,
    spendThresholdCombinations,
    recommendationCouponEligibility,
    targetRecommendationOffers,
    recommendationCandidateMatchesOffer,
    sortRecommendationCandidates,
    recommendationFinalPriceMap,
    recommendationStrongestDiscountRate,
    isRecordNewLowest,
    plannerCouponsFromDeals,
  };`,
  sandbox,
);

const {
  currencyRateFromProducts,
  dealMoney,
  spendThresholdCombinations,
  recommendationCouponEligibility,
  targetRecommendationOffers,
  recommendationCandidateMatchesOffer,
  sortRecommendationCandidates,
  recommendationFinalPriceMap,
  recommendationStrongestDiscountRate,
  isRecordNewLowest,
  plannerCouponsFromDeals,
} = sandbox.reachRecommendation;

test("三种折扣只把力度最大的数值作为高亮基准", () => {
  assert.equal(recommendationStrongestDiscountRate([33, 30, 30]), 33);
  assert.equal(recommendationStrongestDiscountRate([53.1, 30, 30]), 53.1);
});

test("推荐表现在折扣按最终结算价相对原价计算", () => {
  const currentRate = (1 - 155 / 330) * 100;
  assert.ok(currentRate > 53 && currentRate < 54);
  assert.equal(recommendationStrongestDiscountRate([currentRate, 30, 30]), currentRate);
});

function coupon(overrides = {}) {
  return {
    id: "C33",
    groupKey: "C33",
    conditionType: "all",
    discountType: "percent",
    discount: 33,
    maxDiscount: 0,
    minSpend: 0,
    minCount: 2,
    maxPrice: 0,
    productIds: [],
    makerIds: [],
    siteIds: [],
    customGenres: [],
    workTypes: [],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

test("385日元对16.23元时统一使用当页换算比例", () => {
  const rate = currencyRateFromProducts([{
    price: 385,
    cnyPrice: 16.23,
  }, {
    price: 990,
    cnyPrice: 41.83,
  }]);

  assert.ok(Math.abs(rate - 16.23 / 385) < 1e-12);
  assert.equal(dealMoney(385, rate), "385円｜约16.23元");
});

test("人民币换算优先当前作品，缺失时才回退购物车样本", () => {
  const current = { price: 385, cnyPrice: 16.23 };
  const cart = { price: 990, cnyPrice: 41.83 };
  assert.equal(currencyRateFromProducts([current, cart]), 16.23 / 385);
  assert.equal(currencyRateFromProducts([{ price: 385, cnyPrice: 0 }, cart]), 41.83 / 990);
});

test("购物车结构化人民币价优先于可能含划线原价的DOM文本", () => {
  const enrichSource = functionSource("enhanceDealInsights");
  assert.match(
    enrichSource,
    /cartMetadata\.get\(String\(item\.id\)\.toUpperCase\(\)\)\?\.cnyPrice \|\|\s*item\.cnyPrice/,
  );
  assert.match(
    enrichSource,
    /officialPrice: cartMetadata\.get\(String\(item\.id\)\.toUpperCase\(\)\)\?\.officialPrice \|\|\s*item\.officialPrice/,
  );
});

test("满额组合先少超额，超额相同时优先更多作品", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 700, recommendationPrice: 460, order: 0 },
    { id: "B", price: 200, recommendationPrice: 132, order: 1 },
    { id: "C", price: 200, recommendationPrice: 132, order: 2 },
    { id: "D", price: 400, recommendationPrice: 264, order: 3 },
  ], 400);

  assert.deepEqual(Array.from(combinations[0], (item) => item.id).sort(), ["B", "C"]);
  assert.deepEqual(Array.from(combinations[1], (item) => item.id), ["D"]);
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

test("同超额同件数时按结算价、综合OFF和原顺序排序", () => {
  const combinations = spendThresholdCombinations([
    { id: "A", price: 200, officialPrice: 400, recommendationPrice: 100, order: 0 },
    { id: "B", price: 200, officialPrice: 400, recommendationPrice: 120, order: 1 },
    { id: "C", price: 200, officialPrice: 300, recommendationPrice: 100, order: 2 },
  ], 200);

  assert.equal(combinations[0][0].id, "A");
});

test("推荐明细按优惠对象分摊券额且总计不画表格", () => {
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
  assert.match(functionSource("appendRecommendationTable"), /人民币（日元）/);
  assert.match(functionSource("appendRecommendationTable"), /现在折扣\/平台折扣\/史低折扣/);
  assert.match(functionSource("appendRecommendationTable"), /本单适用优惠券/);
  assert.match(functionSource("appendRecommendationTable"), /本单适用平台活动/);
  assert.match(functionSource("appendRecommendationTable"), /备注/);
  assert.match(functionSource("appendRecommendationTable"), /product\.id \|\| product\.title/);
  assert.match(functionSource("appendRecommendationTable"), /recommendationMoneyLines/);
  assert.match(functionSource("appendRecommendationTable"), /appendRecommendationDiscounts/);
  assert.doesNotMatch(functionSource("appendRecommendationTable"), /`现在 /);
  assert.match(functionSource("appendRecommendationDiscounts"), /is-strongest/);
  assert.match(source, /table-layout: fixed/);
  assert.match(source, /min-width: 0/);
  assert.match(functionSource("appendRecommendationTable"), /优惠前/);
  assert.match(functionSource("appendRecommendationTable"), /优惠后/);
  assert.doesNotMatch(
    functionSource("appendRecommendationTable"),
    /dltracker-reach-recommendation-totals/,
  );
  assert.match(
    functionSource("appendRecommendationTable"),
    /dltracker-reach-recommendation-summary/,
  );
});

test("拼单候选必须当前已达或低于史低", () => {
  const recommendationSource = functionSource("buildBundleRecommendations");
  assert.match(recommendationSource, /if \(!isRecordNewLowest\(record, product\.price\)\) return null/);
});

test("缺少史低或当前价高于史低都不合格", () => {
  assert.equal(isRecordNewLowest(null, 100), false);
  assert.equal(isRecordNewLowest({ lowestPrice: null }, 100), false);
  assert.equal(isRecordNewLowest({ lowestPrice: 99 }, 100), false);
  assert.equal(isRecordNewLowest({ lowestPrice: 100 }, 100), true);
});

test("目标券候选排除更高券但允许同档券", () => {
  const target = coupon();
  const same = coupon({ id: "SAME", groupKey: "SAME" });
  const higher = coupon({ id: "HIGH", groupKey: "HIGH", discount: 50 });
  const product = { id: "RJ123456", price: 600 };

  assert.equal(
    recommendationCouponEligibility(target, [target, same], product).eligible,
    true,
  );
  assert.equal(
    recommendationCouponEligibility(target, [target, higher], product).eligible,
    false,
  );
});

test("当前作品的并列最高券分别生成推荐组", () => {
  const first = coupon({ id: "FIRST", groupKey: "FIRST" });
  const second = coupon({ id: "SECOND", groupKey: "SECOND" });
  const lower = coupon({ id: "LOW", groupKey: "LOW", discount: 20 });
  const offers = targetRecommendationOffers(
    [],
    [first, second, lower],
    new Map(),
    { id: "RJ123456", price: 600, officialPrice: 600 },
  );

  assert.deepEqual(Array.from(offers, (offer) => offer.key), ["FIRST", "SECOND"]);
});

test("平台活动候选不因存在更高优惠券而排除", () => {
  const higher = coupon({ discount: 50 });
  const offer = {
    coupon: null,
    needsActivity: true,
    activityKey: "BULK-1",
  };
  assert.equal(recommendationCandidateMatchesOffer(
    { id: "RJ123456", price: 500, bulkbuyKey: "BULK-1" },
    offer,
    [higher],
  ), true);
});

test("限定范围券只推荐范围内作品", () => {
  const target = coupon({
    conditionType: "id_all",
    productIds: ["RJ111111"],
  });
  assert.equal(recommendationCouponEligibility(
    target,
    [target],
    { id: "RJ111111", price: 500 },
  ).eligible, true);
  assert.equal(recommendationCouponEligibility(
    target,
    [target],
    { id: "RJ222222", price: 500 },
  ).eligible, false);
});

test("双条件推荐要求每部候选同时命中活动和目标券", () => {
  const target = coupon({
    conditionType: "id_all",
    productIds: ["RJ111111"],
  });
  const offer = {
    coupon: target,
    needsActivity: true,
    activityKey: "BULK-1",
  };
  assert.equal(recommendationCandidateMatchesOffer(
    { id: "RJ111111", price: 500, bulkbuyKey: "BULK-1" }, offer, [target],
  ), true);
  assert.equal(recommendationCandidateMatchesOffer(
    { id: "RJ111111", price: 500, bulkbuyKey: "OTHER" }, offer, [target],
  ), false);
  assert.equal(recommendationCandidateMatchesOffer(
    { id: "RJ222222", price: 500, bulkbuyKey: "BULK-1" }, offer, [target],
  ), false);
});

test("件数候选按综合OFF、结算价和原顺序排列", () => {
  const sorted = sortRecommendationCandidates([
    { id: "A", totalRate: 70, recommendationPrice: 300, order: 0 },
    { id: "B", totalRate: 80, recommendationPrice: 400, order: 1 },
    { id: "C", totalRate: 80, recommendationPrice: 200, order: 2 },
  ]);
  assert.deepEqual(Array.from(sorted, (item) => item.id), ["C", "B", "A"]);
});

test("候选超过10部时保留全量并提供展开按钮", () => {
  const tableSource = functionSource("appendRecommendationTable");
  assert.match(tableSource, /index >= options\.collapseAfter/);
  assert.match(tableSource, /查看全部 \$\{products\.length\} 部/);
  assert.match(tableSource, /收起到前 10 部/);
});

test("满额固定减免券的理论计算改用门槛等效折扣", () => {
  const coupons = plannerCouponsFromDeals([coupon({
    id: "C400",
    groupKey: "C400",
    discountType: "fixed",
    discount: 400,
    minSpend: 1200,
    minCount: 1,
    maxDiscount: 0,
    repeatable: false,
    instances: 1,
  })], [{ id: "RJ123456", price: 385 }], true);

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

test("本次可到弹窗原子更新并忽略自身 DOM 变动", () => {
  const renderSource = functionSource("renderReachDialog");
  const observerSource = functionSource("installSpaListeners");
  assert.match(renderSource, /reachDialogDataSignature\(insight, lowestPrice\)/);
  assert.match(renderSource, /dltrackerReachPending === signature/);
  assert.match(renderSource, /const renderRoot = document\.createElement\("div"\)/);
  assert.match(renderSource, /body\.replaceChildren\(\.\.\.renderRoot\.childNodes\)/);
  assert.doesNotMatch(renderSource, /body\.replaceChildren\(\)/);
  assert.match(
    observerSource,
    /mutations\.length && mutations\.every\(mutationIsInsideReachDialog\)/,
  );
});
