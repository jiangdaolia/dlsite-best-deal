import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);
const matched = source.match(
  /\/\/ <deal-insight-core>([\s\S]*?)\/\/ <\/deal-insight-core>/,
);
if (!matched) throw new Error("deal insight core markers not found");

const sandbox = {};
vm.runInNewContext(
  `${matched[1]}
  globalThis.dealInsightCore = {
    normalizeDealCoupon,
    groupDealCoupons,
    couponMatchesDealProduct,
    couponEquivalentRate,
    buildDealCouponOptions,
    calculateBestReach,
  };`,
  sandbox,
);

const {
  groupDealCoupons,
  couponMatchesDealProduct,
  buildDealCouponOptions,
  calculateBestReach,
} = sandbox.dealInsightCore;

const future = Math.floor(Date.parse("2026-10-01T00:00:00+08:00") / 1000);
const now = Date.parse("2026-08-28T20:00:00+08:00");

function paymentCoupon(index) {
  return {
    coupon_id: `PAY-${index}`,
    coupon_name: `来源不同 ${index}`,
    info: "최소 구매 금액: 1,200엔 회원당 1회만 사용 가능.",
    discount_type: "price",
    discount: "400",
    condition_type: "payment",
    conditions: { price_sum: [1200] },
    distribute_targets: ["home", "girls", "maniax"],
    is_multiple_use: false,
    is_static_limit: false,
    limit_date: future - index,
  };
}

test("信息语义相同的 15 张 1200-400 券归为一组并折算 33%", () => {
  const groups = groupDealCoupons(
    Array.from({ length: 15 }, (_, index) => paymentCoupon(index)),
    now,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].instances, 15);
  assert.equal(groups[0].minSpend, 1200);

  const product = { id: "RJ123456", price: 600, officialPrice: 1000 };
  const [option] = buildDealCouponOptions(groups, product, []);
  assert.ok(Math.abs(option.equivalentRate - 100 / 3) < 0.001);
  assert.equal(option.spendShortfall, 1200);
});

test("三件 60% 与一张 50% 券按乘法叠加为 80% OFF", () => {
  const [coupon] = groupDealCoupons([{
    coupon_id: "ID-50",
    coupon_name: "三部 50%",
    discount_type: "rate",
    discount: 50,
    condition_type: "id_all",
    conditions: {
      product_all: ["RJ123456", "RJ234567", "RJ345678"],
      post_condition: { count: 3, price: 1 },
    },
    is_multiple_use: true,
    limit_date: future,
  }], now);
  const product = {
    id: "RJ123456",
    price: 1000,
    officialPrice: 1000,
    bulkbuyKey: "set-test",
  };
  const options = buildDealCouponOptions(coupon ? [coupon] : [], product, []);
  const best = calculateBestReach(product, options, {
    discountRate: 60,
    minCount: 3,
  });
  assert.equal(best.totalRate, 80);
  assert.equal(options[0].countShortfall, 3);
});

test("三件 60% 与 1200-400 的理论值约为 73%", () => {
  const groups = groupDealCoupons([paymentCoupon(1)], now);
  const product = {
    id: "RJ123456",
    price: 700,
    officialPrice: 1000,
    bulkbuyKey: "set-test",
  };
  const options = buildDealCouponOptions(groups, product, [{
    id: "RJ999999",
    price: 800,
  }]);
  const best = calculateBestReach(product, options, { discountRate: 60 });
  assert.ok(Math.abs(best.totalRate - 73.3333333333) < 0.001);
  assert.equal(best.fixedOrderApproximation, true);
  assert.equal(options[0].spendShortfall, 400);
});

test("指定作品、社团、站点与隐藏分类分别匹配", () => {
  const raw = [
    ["id_all", { product_all: ["VJ01000001"] }],
    ["common", { maker_id: ["VG1"] }],
    ["site_ids", { site_ids: ["girls", "girlstouch"] }],
    ["custom_genre", { custom_genre: ["campaign50"] }],
  ].map(([condition_type, conditions], index) => ({
    coupon_id: `C-${index}`,
    coupon_name: condition_type,
    discount_type: "rate",
    discount: 25,
    condition_type,
    conditions,
    is_multiple_use: true,
    limit_date: future,
  }));
  const groups = groupDealCoupons(raw, now);
  const product = {
    id: "VJ01000001",
    price: 500,
    makerId: "VG1",
    siteId: "girls-touch",
    customGenres: ["campaign50"],
  };
  assert.equal(groups.filter((coupon) => couponMatchesDealProduct(coupon, product)).length, 4);
});
