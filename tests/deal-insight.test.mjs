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
const formatMatched = source.match(
  /\/\/ <deal-insight-format-core>([\s\S]*?)\/\/ <\/deal-insight-format-core>/,
);
if (!formatMatched) throw new Error("deal insight format core markers not found");
const campaignMatched = source.match(
  /\/\/ <campaign-time-core>([\s\S]*?)\/\/ <\/campaign-time-core>/,
);
if (!campaignMatched) throw new Error("campaign time core markers not found");

const sandbox = {};
vm.runInNewContext(
  `${matched[1]}
  ${formatMatched[1]}
  ${campaignMatched[1]}
  globalThis.dealInsightCore = {
    normalizeDealCoupon,
    groupDealCoupons,
    couponMatchesDealProduct,
    couponEquivalentRate,
    buildDealCouponOptions,
    calculateBestReach,
    calculateHypotheticalPrice,
    isSingleBuyOptimal,
    extractVoiceActorNames,
    mergeBrowseVoiceActorNames,
    compareDealSortEntries,
    activeCartFingerprint,
    cartSnapshotFingerprint,
    cartAreaFromMarkerText,
    dealDateMillis,
    lastYenPriceFromText,
    compactCouponCondition,
    compactCouponExpiry,
    compactCouponUsage,
    compactCouponListLabel,
    bestReachColorClass,
    campaignEndFromHtml,
  };`,
  sandbox,
);

const {
  groupDealCoupons,
  couponMatchesDealProduct,
  buildDealCouponOptions,
  calculateBestReach,
  calculateHypotheticalPrice,
  isSingleBuyOptimal,
  extractVoiceActorNames,
  mergeBrowseVoiceActorNames,
  compareDealSortEntries,
  activeCartFingerprint,
  cartSnapshotFingerprint,
  cartAreaFromMarkerText,
  dealDateMillis,
  lastYenPriceFromText,
  compactCouponCondition,
  compactCouponExpiry,
  compactCouponUsage,
  compactCouponListLabel,
  bestReachColorClass,
  campaignEndFromHtml,
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

test("折扣上限不同的百分比券不会被错误合并", () => {
  const base = {
    coupon_name: "50% OFF",
    discount_type: "rate",
    discount: 50,
    condition_type: "id_all",
    conditions: { product_all: ["RJ123456"] },
    is_multiple_use: false,
    limit_date: future,
  };
  const groups = groupDealCoupons([
    { ...base, coupon_id: "CAP-100", maximum_discount_price: 100 },
    { ...base, coupon_id: "CAP-500", maximum_discount_price: 500 },
  ], now);
  assert.equal(groups.length, 2);
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

test("日本时间到期字段会转换为绝对时间并可按中国时间显示", () => {
  const value = dealDateMillis("2026-09-13 23:59:00");
  assert.equal(new Date(value).toISOString(), "2026-09-13T14:59:00.000Z");
});

test("购物车价格文字同时含原价和现价时取最后的日元现价", () => {
  assert.equal(lastYenPriceFromText("1,320円 70%OFF 385円"), 385);
  assert.equal(lastYenPriceFromText("RMB 18.72｜396 JPY"), 396);
  assert.equal(lastYenPriceFromText("RMB 18.72"), null);
});

test("活动优先读取结构化结束时间且不为纯日期虚构 23:59", () => {
  const structured = campaignEndFromHtml(
    "終了 2026年9月2日 10:00",
    { period_end: "2026-09-03 13:59:00" },
  );
  assert.equal(new Date(structured).toISOString(), "2026-09-03T04:59:00.000Z");
  assert.match(compactCouponExpiry({
    originals: [{ expiresAt: structured }],
    earliestExpiry: structured,
  }), /9月3日 12:59中国时间到期/);
  assert.equal(campaignEndFromHtml("終了 2026年9月3日", null), null);
  assert.equal(campaignEndFromHtml("", { period_end: "2026-09-03" }), null);
});

test("两种新排序都在主字段相同时优先当前史低", () => {
  const entries = [
    { id: "A", isNewLowest: false, reachRank: 80, hypotheticalPrice: 300, order: 0 },
    { id: "B", isNewLowest: true, reachRank: 60, hypotheticalPrice: 200, order: 1 },
    { id: "C", isNewLowest: true, reachRank: 80, hypotheticalPrice: 400, order: 2 },
  ];
  assert.deepEqual(
    entries.toSorted((a, b) => compareDealSortEntries(a, b, "reach")).map((x) => x.id),
    ["C", "A", "B"],
  );
  assert.deepEqual(
    entries.toSorted((a, b) => compareDealSortEntries(a, b, "price")).map((x) => x.id),
    ["B", "A", "C"],
  );
});

test("低价优先使用本次可到后的假设价格", () => {
  assert.equal(
    calculateHypotheticalPrice({ officialPrice: 1000 }, { totalRate: 80 }),
    200,
  );
});

test("单部无门槛券可标单买即最优，三件活动不可", () => {
  const product = { id: "RJ123456", price: 800, officialPrice: 1000 };
  const options = [{ equivalentRate: 50, minCount: 1, minSpend: 0 }];
  const best = calculateBestReach(product, options, null);
  assert.equal(isSingleBuyOptimal(product, options, null, best), true);

  const bulkProduct = { ...product, bulkbuyKey: "set" };
  const bulkRule = { discountRate: 60, minCount: 3 };
  const bulkBest = calculateBestReach(bulkProduct, [], bulkRule);
  assert.equal(isSingleBuyOptimal(bulkProduct, [], bulkRule, bulkBest), false);
});

test("批量作品数据可从常见结构归一化声优", () => {
  assert.deepEqual(
    Array.from(extractVoiceActorNames({
      creaters: {
        voice_actor: [{ name: "甲" }, { creater_name: "乙" }],
        voice_by: [{ creator_name: "丙" }],
      },
    })),
    ["甲", "乙", "丙"],
  );
  assert.deepEqual(
    Array.from(extractVoiceActorNames({
      creators: [
        { name: "花岩香奈", role: "声優" },
        { name: "某画师", role: "イラスト" },
      ],
    })),
    ["花岩香奈"],
  );
});

test("音声作品使用列表 author 作为声优数据源", () => {
  assert.deepEqual(
    Array.from(mergeBrowseVoiceActorNames("SOU", [], ["甲", "乙"])),
    ["甲", "乙"],
  );
  assert.deepEqual(
    Array.from(mergeBrowseVoiceActorNames("MNG", [], ["漫画作者"])),
    [],
  );
  assert.deepEqual(
    Array.from(mergeBrowseVoiceActorNames("SOU", ["甲"], ["甲", "丙"])),
    ["甲", "丙"],
  );
});

test("本次可到价不高于史低用金黄，高于史低用蓝灰", () => {
  assert.equal(bestReachColorClass(799, 800), "dltracker-best-reach-gold");
  assert.equal(bestReachColorClass(800, 800), "dltracker-best-reach-gold");
  assert.equal(bestReachColorClass(801, 800), "dltracker-best-reach-bluegray");
});

test("立即购买集合的作品、价格或活动变化会改变门槛指纹", () => {
  const first = activeCartFingerprint([
    { id: "RJ2", price: 800, bulkbuyKey: "B" },
    { id: "RJ1", price: 500, bulkbuyKey: "A" },
  ]);
  assert.equal(first, activeCartFingerprint([
    { id: "RJ1", price: 500, bulkbuyKey: "A" },
    { id: "RJ2", price: 800, bulkbuyKey: "B" },
  ]));
  assert.notEqual(first, activeCartFingerprint([
    { id: "RJ1", price: 500, bulkbuyKey: "A" },
  ]));
  assert.notEqual(first, activeCartFingerprint([
    { id: "RJ1", price: 500, bulkbuyKey: "A" },
    { id: "RJ2", price: 700, bulkbuyKey: "B" },
  ]));
});

test("稍后再买变化也会改变购物车快照指纹", () => {
  const first = cartSnapshotFingerprint({
    active: [{ id: "RJ1", price: 500 }],
    later: [{ id: "RJ2", price: 800 }],
  });
  const second = cartSnapshotFingerprint({
    active: [{ id: "RJ1", price: 500 }],
    later: [{ id: "RJ3", price: 800 }],
  });
  assert.notEqual(first, second);
});

test("购物车区域标记严格区分立即购买和稍后再买", () => {
  assert.equal(cartAreaFromMarkerText("buy_now cart_list"), "active");
  assert.equal(cartAreaFromMarkerText("buy_later cart_list"), "later");
  assert.equal(cartAreaFromMarkerText("cart_hold"), "later");
  assert.equal(cartAreaFromMarkerText("cart_list_item"), "unknown");
  assert.equal(
    cartAreaFromMarkerText("buy_now __buy_later_target"),
    "later",
  );
});

test("列表与详情使用最终确认的紧凑券文案", () => {
  const option = {
    equivalentRate: 50,
    minCount: 3,
    minSpend: 0,
    countShortfall: 2,
    spendShortfall: 0,
    repeatable: true,
    instances: 1,
    usageLimit: 0,
    originals: [{ expiresAt: Date.parse("2026-09-13T14:59:00Z") }],
    earliestExpiry: Date.parse("2026-09-13T14:59:00Z"),
  };
  assert.equal(compactCouponListLabel(option), "券50OFF·3部起用");
  assert.equal(compactCouponCondition(option, true), "3部起用（还差2部）");
  assert.equal(compactCouponUsage(option), "无限使用");
  assert.equal(
    compactCouponExpiry(option),
    "9月13日 22:59中国时间到期",
  );
});

test("同类单次券显示张数和最早到期", () => {
  const first = Date.parse("2026-09-02T08:17:00Z");
  const later = Date.parse("2026-09-03T08:17:00Z");
  const option = {
    equivalentRate: 100 / 3,
    minCount: 1,
    minSpend: 1200,
    countShortfall: 0,
    spendShortfall: 400,
    repeatable: false,
    instances: 15,
    usageLimit: 0,
    originals: [{ expiresAt: first }, { expiresAt: later }],
    earliestExpiry: first,
  };
  assert.equal(compactCouponListLabel(option), "券33OFF·满1200");
  assert.equal(compactCouponCondition(option, true), "满1,200日元（还差400日元）");
  assert.equal(compactCouponUsage(option), "15张，每张1次");
  assert.match(compactCouponExpiry(option), /^最早/);
});
