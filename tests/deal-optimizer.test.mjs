import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);
const matched = source.match(
  /\/\/ <deal-optimizer-core>([\s\S]*?)\/\/ <\/deal-optimizer-core>/,
);
if (!matched) throw new Error("deal optimizer core markers not found");
const couponImportMatched = source.match(
  /\/\/ <coupon-import-core>([\s\S]*?)\/\/ <\/coupon-import-core>/,
);
if (!couponImportMatched) throw new Error("coupon import core markers not found");

const sandbox = {};
vm.runInNewContext(
  `
  const DEAL_PLANNER_MAX_ITEMS = 12;
  const DEAL_PLANNER_MAX_COUPONS = 8;
  function parseNumberish(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, "").trim());
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
  ${matched[1]}
  const RJ_CODE_REGEX = /\\b([RB]J\\d{6,})\\b/i;
  ${couponImportMatched[1]}
  globalThis.optimizer = {
    optimizeDealPlan,
    quoteBestSingleOrder,
    normalizePlannerItems,
    normalizeDlsiteCoupon,
    couponArrayFromPayload,
  };
  `,
  sandbox,
);

const {
  optimizeDealPlan,
  quoteBestSingleOrder,
  normalizeDlsiteCoupon,
  couponArrayFromPayload,
} = sandbox.optimizer;

test("DLsite 指定作品券可直接从结构化条件导入，无需爬适用作品链接", () => {
  const coupon = normalizeDlsiteCoupon(
    {
      coupon_id: "CP1",
      coupon_name: "期间中何度でも 50%OFF",
      discount: 50,
      discount_type: "rate",
      limit_date: 2_000_000_000,
      condition_type: "id_all",
      conditions: { product_all: ["RJ123456", "RJ234567"] },
    },
    0,
  );

  assert.equal(coupon.type, "percent");
  assert.equal(coupon.repeatable, true);
  assert.deepEqual(Array.from(coupon.eligibleIds), ["RJ123456", "RJ234567"]);
  assert.equal(coupon.allEligible, false);
});

test("DLsite 满减券会从名称和响应字段识别门槛与固定减免", () => {
  const coupon = normalizeDlsiteCoupon(
    {
      coupon_id: "CP2",
      coupon_name: "1,200円以上で400円OFF（一回のみ）",
      discount: 400,
      discount_type: "price",
      condition_type: "all",
      conditions: {},
    },
    0,
  );

  assert.equal(coupon.type, "fixed");
  assert.equal(coupon.value, 400);
  assert.equal(coupon.minSpend, 1200);
  assert.equal(coupon.repeatable, false);
  assert.equal(coupon.allEligible, true);
  assert.equal(coupon.autoWarnings.length, 0);
});

test("优惠券接口常见包裹格式可以提取数组", () => {
  const coupons = [{ coupon_id: "A" }];
  assert.equal(couponArrayFromPayload({ data: coupons }), coupons);
});

test("三部达到门槛后采用三件折后价", () => {
  const result = optimizeDealPlan(
    ["A", "B", "C"].map((id) => ({
      id,
      regularPrice: 1000,
      setPrice: 400,
      setGroup: "3x60",
      setMinCount: 3,
    })),
    [],
  );

  assert.equal(result.baseline, 1200);
  assert.equal(result.total, 1200);
  assert.ok(result.orders[0].lines.every((line) => line.dealApplied));
});

test("优惠券可叠加当前平台价与三件活动价，且一单只记录一张券", () => {
  const result = optimizeDealPlan(
    ["A", "B", "C"].map((id) => ({
      id,
      regularPrice: 800,
      setPrice: 400,
      setGroup: "3x60",
      setMinCount: 3,
    })),
    [
      {
        id: "STACK50",
        type: "percent",
        value: 50,
        scope: "all",
        allEligible: true,
      },
    ],
  );

  assert.equal(result.baseline, 1200);
  assert.equal(result.total, 600);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].couponId, "STACK50");
  assert.ok(result.orders[0].lines.every((line) => line.dealApplied));
});

test("两张指定作品券会分配给各自适用的作品并拆单", () => {
  const result = optimizeDealPlan(
    [
      { id: "A", regularPrice: 1000 },
      { id: "B", regularPrice: 800 },
    ],
    [
      {
        id: "CA",
        name: "A 30%",
        type: "percent",
        value: 30,
        eligibleIds: ["A"],
      },
      {
        id: "CB",
        name: "B 50%",
        type: "percent",
        value: 50,
        eligibleIds: ["B"],
      },
    ],
  );

  assert.equal(result.total, 1100);
  assert.equal(result.savings, 700);
  assert.equal(result.orders.length, 2);
  assert.deepEqual(
    Array.from(result.orders, (order) => order.targetIds[0]).sort(),
    ["A", "B"],
  );
});

test("1200-400 可以加入不适用作品凑整单门槛", () => {
  const result = optimizeDealPlan(
    [
      { id: "A", regularPrice: 800 },
      { id: "B", regularPrice: 500 },
    ],
    [
      {
        id: "C400",
        name: "1200-400",
        type: "fixed",
        value: 400,
        minSpend: 1200,
        minSpendScope: "order",
        eligibleIds: ["A"],
      },
    ],
  );

  assert.equal(result.total, 900);
  assert.deepEqual(
    Array.from(result.orders[0].lines, (line) => line.id).sort(),
    ["A", "B"],
  );
  assert.deepEqual(Array.from(result.orders[0].targetIds), ["A"]);
});

test("理论满1200减400按等效折扣计算而不会把385円减成0", () => {
  const result = quoteBestSingleOrder(
    [{ id: "A", regularPrice: 385 }],
    [{
      id: "C400-THEORETICAL",
      type: "percent",
      value: 400 / 1200 * 100,
      maxDiscount: 400,
      allEligible: true,
    }],
  );

  assert.equal(result.total, 257);
  assert.equal(result.discount, 128);
});

test("用券作品不计入三件时，求解器会避免破坏更便宜的整组折扣", () => {
  const items = ["A", "B", "C"].map((id) => ({
    id,
    regularPrice: 1000,
    setPrice: 400,
    setGroup: "3x60",
    setMinCount: 3,
  }));
  const result = optimizeDealPlan(items, [
    {
      id: "A70",
      name: "A 70%",
      type: "percent",
      value: 70,
      eligibleIds: ["A"],
      stackMode: "exclude-target",
    },
  ]);

  assert.equal(result.total, 1200);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].couponId, null);
});

test("仅目标作品恢复普通价时可保留其余作品的三件折扣", () => {
  const items = ["A", "B", "C"].map((id) => ({
    id,
    regularPrice: 1000,
    setPrice: 400,
    setGroup: "3x60",
    setMinCount: 3,
  }));
  const result = optimizeDealPlan(items, [
    {
      id: "A70",
      name: "A 70%",
      type: "percent",
      value: 70,
      eligibleIds: ["A"],
      stackMode: "replace-target",
    },
  ]);

  assert.equal(result.total, 1100);
  assert.equal(result.orders[0].discount, 700);
});

test("仅优惠一部时自动选择可省最多的适用作品", () => {
  const result = optimizeDealPlan(
    [
      { id: "A", regularPrice: 1200 },
      { id: "B", regularPrice: 600 },
    ],
    [
      {
        id: "ONE50",
        name: "一部 50%",
        type: "percent",
        value: 50,
        scope: "one",
        eligibleIds: ["A", "B"],
      },
    ],
  );

  assert.equal(result.total, 1200);
  assert.deepEqual(Array.from(result.orders[0].targetIds), ["A"]);
});

test("期限内可重复券可以在不同订单重复使用，但每单仍只有一张券", () => {
  const result = optimizeDealPlan(
    [
      { id: "A", regularPrice: 1000 },
      { id: "B", regularPrice: 1000 },
    ],
    [
      {
        id: "REPEAT50",
        name: "每单一部 50%",
        type: "percent",
        value: 50,
        scope: "one",
        repeatable: true,
        eligibleIds: ["A", "B"],
      },
    ],
  );

  assert.equal(result.total, 1000);
  assert.equal(result.orders.length, 2);
  assert.ok(result.orders.every((order) => order.couponId === "REPEAT50"));
});

test("同一张一次性券不会跨两个订单重复使用", () => {
  const result = optimizeDealPlan(
    [
      { id: "A", regularPrice: 1000 },
      { id: "B", regularPrice: 1000 },
    ],
    [
      {
        id: "ONCE50",
        type: "percent",
        value: 50,
        scope: "one",
        eligibleIds: ["A", "B"],
      },
    ],
  );

  assert.equal(result.total, 1500);
  assert.equal(
    result.orders.filter((order) => order.couponId === "ONCE50").length,
    1,
  );
});

test("两张同类一次性券最多可用两单", () => {
  const result = optimizeDealPlan(
    ["A", "B", "C"].map((id) => ({ id, regularPrice: 1000 })),
    [{
      id: "TWICE50",
      type: "percent",
      value: 50,
      scope: "one",
      maxUses: 2,
      eligibleIds: ["A", "B", "C"],
    }],
  );
  assert.equal(result.total, 2000);
  assert.equal(result.orders.filter((order) => order.couponId === "TWICE50").length, 2);
});

test("单笔报价不会为了使用多张券自动拆单", () => {
  const quote = quoteBestSingleOrder(
    [
      { id: "A", regularPrice: 1000 },
      { id: "B", regularPrice: 800 },
    ],
    [
      { id: "CA", type: "percent", value: 30, eligibleIds: ["A"] },
      { id: "CB", type: "percent", value: 50, eligibleIds: ["B"] },
    ],
  );
  assert.equal(quote.total, 1400);
  assert.equal(quote.couponId, "CB");
});

test("明确的空适用列表不会被误认为全作品适用", () => {
  const result = optimizeDealPlan(
    [{ id: "A", regularPrice: 1000 }],
    [
      {
        id: "NONE",
        type: "percent",
        value: 90,
        allEligible: false,
        eligibleIds: [],
      },
    ],
  );

  assert.equal(result.total, 1000);
});

test("至少三部适用作品券不会在只有两部时误用", () => {
  const coupon = {
    id: "THREE50",
    type: "percent",
    value: 50,
    minEligibleCount: 3,
    eligibleIds: ["A", "B", "C"],
    repeatable: true,
  };
  const two = optimizeDealPlan([
    { id: "A", regularPrice: 1000 },
    { id: "B", regularPrice: 1000 },
  ], [coupon]);
  assert.equal(two.total, 2000);

  const three = optimizeDealPlan([
    { id: "A", regularPrice: 1000 },
    { id: "B", regularPrice: 1000 },
    { id: "C", regularPrice: 1000 },
  ], [coupon]);
  assert.equal(three.total, 1500);
});

test("超过精确拆单上限时仍可安全计算大购物车单笔价", () => {
  const items = Array.from({ length: 36 }, (_, index) => ({
    id: `L${index}`,
    regularPrice: 100,
  }));
  const quote = quoteBestSingleOrder(items, [{
    id: "ALL10",
    type: "percent",
    value: 10,
    allEligible: true,
  }]);
  assert.equal(quote.total, 3240);
  assert.equal(quote.lines.length, 36);
});

test("上限规模的购物车和优惠券可以完成精确计算", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `I${index}`,
    regularPrice: 500 + index * 100,
  }));
  const coupons = Array.from({ length: 8 }, (_, index) => ({
    id: `C${index}`,
    type: "percent",
    value: 10 + index,
    scope: "one",
    eligibleIds: [items[index].id],
  }));

  const result = optimizeDealPlan(items, coupons);
  assert.ok(result.total < result.baseline);
  assert.ok(result.orders.length <= 9);
});
