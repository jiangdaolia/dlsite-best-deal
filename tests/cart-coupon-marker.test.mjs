import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../userscript/dlsite-coupon-reader.user.js", import.meta.url),
  "utf8",
);
const matched = source.match(
  /\/\/ <cart-coupon-core>([\s\S]*?)\/\/ <\/cart-coupon-core>/,
);
if (!matched) throw new Error("cart coupon core markers not found");

const sandbox = {};
vm.runInNewContext(
  `
  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  ${matched[1]}
  globalThis.cartCouponCore = {
    normalizeCartCoupon,
    groupCartCoupons,
    couponMatchesCartProduct,
    buildCartCouponOptions,
  };
  `,
  sandbox,
);

const {
  normalizeCartCoupon,
  groupCartCoupons,
  couponMatchesCartProduct,
  buildCartCouponOptions,
} = sandbox.cartCouponCore;

const futureLimit = Math.floor(Date.parse("2026-09-03T00:20:00+08:00") / 1000);
const now = Date.parse("2026-08-28T20:00:00+08:00");

function paymentCoupon(index) {
  return {
    coupon_id: `PAY-${index}`,
    coupon_name: `来源 ${index}：400엔 할인 쿠폰`,
    discount_type: "price",
    discount: "400",
    condition_type: "payment",
    conditions: { price_sum: [1200] },
    condition_info: "이 쿠폰은 모든 작품에 사용할 수 있으며, 사용 기한은 10일입니다.",
    info: "최소 구매 금액: 1,200엔 회원당 1회만 사용 가능.",
    distribute_targets: ["girls", "maniax"],
    is_multiple_use: false,
    is_static_limit: false,
    is_affect_to_payment: true,
    is_limited_exceeded: false,
    start_date: "2026-07-01 00:00:00",
    limit_date: futureLimit - index,
  };
}

test("15 张来源名和到期秒数不同的 1200-400 券归为一种", () => {
  const groups = groupCartCoupons(
    Array.from({ length: 15 }, (_, index) => paymentCoupon(index)),
    now,
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].instances.length, 15);
  assert.equal(groups[0].names.length, 15);
  assert.equal(groups[0].displayName, "满1,200日元减400日元");
  assert.ok(Math.abs(groups[0].equivalentRate - 100 / 3) < 0.001);
  assert.equal(groups[0].validityPolicy, "relative:10");
});

test("购物车内按 50%、等效 33.3%、30% 的优惠力度排序", () => {
  const rawCoupons = [
    ...Array.from({ length: 15 }, (_, index) => paymentCoupon(index)),
    {
      coupon_id: "GENRE-50",
      coupon_name: "指定分类 50%",
      discount_type: "rate",
      discount: "50",
      condition_type: "custom_genre",
      conditions: { custom_genre: ["campaign50"] },
      distribute_targets: ["girls"],
      is_multiple_use: true,
      is_static_limit: true,
      is_affect_to_payment: false,
      start_date: "2026-08-01 00:00:00",
      limit_date: futureLimit,
    },
    {
      coupon_id: "ID-30",
      coupon_name: "指定作品 30%",
      discount_type: "rate",
      discount: "30",
      condition_type: "id_all",
      conditions: { product_all: ["RJ123456"] },
      distribute_targets: ["girls"],
      is_multiple_use: true,
      is_static_limit: true,
      is_affect_to_payment: false,
      start_date: "2026-08-01 00:00:00",
      limit_date: futureLimit,
    },
  ];
  const groups = groupCartCoupons(rawCoupons, now);
  const items = [
    { id: "RJ123456", price: 800 },
    { id: "RJ654321", price: 500 },
  ];
  const metadata = new Map([
    ["RJ123456", { custom_genres: ["campaign50"], price: 800 }],
    ["RJ654321", { custom_genres: [], price: 500 }],
  ]);

  const options = buildCartCouponOptions(items, groups, metadata, 1300);

  assert.deepEqual(
    Array.from(options.get("RJ123456"), (option) => Math.round(option.equivalentRate * 10) / 10),
    [50, 33.3, 30],
  );
  assert.equal(options.get("RJ123456")[1].instances.length, 15);
  assert.deepEqual(
    Array.from(options.get("RJ654321"), (option) => Math.round(option.equivalentRate * 10) / 10),
    [33.3],
  );
});

test("未满足满减金额或适用作品数量时显示为暂不可用", () => {
  const groups = groupCartCoupons(
    [
      paymentCoupon(0),
      {
        coupon_id: "THREE-50",
        coupon_name: "三部 50%",
        discount_type: "rate",
        discount: "50",
        condition_type: "id_all",
        conditions: {
          product_all: ["RJ100001", "RJ100002", "RJ100003"],
          post_condition: { count: 3, price: 1 },
        },
        distribute_targets: ["pro"],
        is_multiple_use: true,
        is_static_limit: true,
        start_date: "2026-08-01 00:00:00",
        limit_date: futureLimit,
      },
    ],
    now,
  );
  const items = [
    { id: "RJ100001", price: 500 },
    { id: "RJ100002", price: 400 },
  ];
  const options = buildCartCouponOptions(items, groups, new Map(), 900).get("RJ100001");

  assert.equal(options.length, 2);
  assert.ok(options.every((option) => !option.usableNow));
  assert.ok(options.some((option) => /还差 1 部/.test(option.blockedReason)));
  assert.ok(options.some((option) => /还差 300日元/.test(option.blockedReason)));
});

test("分类、社团和站点价格上限使用作品元数据判断", () => {
  const item = { id: "RJ777777", price: 660 };
  const metadata = {
    custom_genres: ["genre-a"],
    maker_id: "MAKER-1",
    site_id: "SITE-GIRLS",
    price: 660,
  };
  const base = {
    distribute_targets: ["girls"],
    discount_type: "rate",
    discount: 20,
    is_multiple_use: true,
    is_static_limit: true,
    limit_date: futureLimit,
  };
  const genre = normalizeCartCoupon({
    ...base,
    coupon_id: "G",
    condition_type: "custom_genre",
    conditions: { custom_genre: ["genre-a"] },
  }, 0);
  const maker = normalizeCartCoupon({
    ...base,
    coupon_id: "M",
    condition_type: "common",
    conditions: { maker_id: ["MAKER-1"] },
  }, 0);
  const site = normalizeCartCoupon({
    ...base,
    coupon_id: "S",
    condition_type: "site_ids",
    conditions: {
      site_ids: ["SITE-GIRLS"],
      maximum_applicable_price: "660",
    },
  }, 0);

  assert.equal(couponMatchesCartProduct(genre, item, metadata), true);
  assert.equal(couponMatchesCartProduct(maker, item, metadata), true);
  assert.equal(couponMatchesCartProduct(site, item, metadata), true);
  assert.equal(
    couponMatchesCartProduct(site, item, { ...metadata, price: 661 }),
    false,
  );
});
