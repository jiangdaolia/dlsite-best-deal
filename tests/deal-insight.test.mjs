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
  const BULK_RULE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
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
    platformDiscountExpiryMillis,
    activeCartFingerprint,
    cartSnapshotFingerprint,
    cartAreaFromMarkerText,
    dealDateMillis,
    lastYenPriceFromText,
    lastCnyPriceFromText,
    compactCouponCondition,
    compactCouponExpiry,
    compactCouponUsage,
    compactCouponListLabel,
    compactCouponBenefitLabel,
    couponCategoryLabels,
    bestReachColorClass,
    campaignEndFromHtml,
    bulkRuleIsActive,
    cachedBulkRuleDecision,
    bulkRuleFromHtml,
    bulkRuleKind,
    bulkRuleBundle,
    bulkRuleUnitPrice,
    bulkRuleGroupTotal,
    bulkRuleLabel,
    campaignPageIsClosed,
    mergeSameCouponRecords,
    couponScopeLabel,
    couponConditionLabel,
    disambiguateCouponOptionLabels,
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
  platformDiscountExpiryMillis,
  activeCartFingerprint,
  cartSnapshotFingerprint,
  cartAreaFromMarkerText,
  dealDateMillis,
  lastYenPriceFromText,
  lastCnyPriceFromText,
  compactCouponCondition,
  compactCouponExpiry,
  compactCouponUsage,
  compactCouponListLabel,
  compactCouponBenefitLabel,
  couponCategoryLabels,
  bestReachColorClass,
  campaignEndFromHtml,
  bulkRuleIsActive,
  cachedBulkRuleDecision,
  bulkRuleFromHtml,
  bulkRuleKind,
  bulkRuleBundle,
  bulkRuleUnitPrice,
  bulkRuleGroupTotal,
  bulkRuleLabel,
  campaignPageIsClosed,
  mergeSameCouponRecords,
  couponScopeLabel,
  couponConditionLabel,
  disambiguateCouponOptionLabels,
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

test("RJ01437715 的平台30OFF与券33OFF叠加后约为155日元", () => {
  const product = { id: "RJ01437715", price: 231, officialPrice: 330 };
  const reach = calculateBestReach(product, [{
    id: "C33",
    discountType: "percent",
    discount: 33,
    maxDiscount: 0,
    equivalentRate: 33,
  }], null);

  assert.ok(Math.abs(reach.saleRate - 30) < 0.001);
  assert.ok(Math.abs(reach.totalRate - 53.1) < 0.001);
  assert.equal(calculateHypotheticalPrice(product, reach), 155);
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

test("人民币价格忽略含糊的整数日元符号并取最后的明确现价", () => {
  assert.equal(lastCnyPriceFromText("¥1100 RMB 18.72 RMB 16.23"), 16.23);
  assert.equal(lastCnyPriceFromText("¥1100 ￥16.23"), 16.23);
  assert.equal(lastCnyPriceFromText("¥1100"), null);
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

test("同一平台活动24小时内不重复读取且到期后立即停用", () => {
  const readAt = Date.parse("2026-08-30T08:00:00Z");
  const cacheUntil = readAt + 24 * 60 * 60 * 1000;
  const active = {
    fetchedAt: readAt,
    cacheUntil: readAt + 2 * 60 * 60 * 1000,
    expiresAt: readAt + 2 * 60 * 60 * 1000,
  };
  assert.equal(cachedBulkRuleDecision(active, readAt + 60 * 60 * 1000), active);
  assert.equal(cachedBulkRuleDecision(active, readAt + 3 * 60 * 60 * 1000), null);
  assert.equal(cachedBulkRuleDecision(active, cacheUntil), undefined);
  assert.equal(bulkRuleIsActive(active, readAt + 3 * 60 * 60 * 1000), false);
  assert.match(source, /cacheUntil: fetchedAt \+ BULK_RULE_REFRESH_INTERVAL_MS/);
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

test("平台折扣失效时间按日本时间解析并把最早失效排在前面", () => {
  const reference = Date.parse("2026-08-30T00:00:00Z");
  const early = platformDiscountExpiryMillis({
    price: 700,
    officialPrice: 1000,
    raw: { is_discount: true, discount_end_date: "09/14 13:59" },
  }, reference);
  const later = platformDiscountExpiryMillis({
    price: 800,
    officialPrice: 1000,
    raw: { is_discount: true, discount_end_date: "09/20 13:59" },
  }, reference);
  assert.equal(early, Date.parse("2026-09-14T04:59:00Z"));
  const entries = [
    { id: "none", platformDiscountExpiry: Infinity, order: 0 },
    { id: "later", platformDiscountExpiry: later, order: 1 },
    { id: "early", platformDiscountExpiry: early, order: 2 },
  ];
  assert.deepEqual(
    entries.toSorted((a, b) => compareDealSortEntries(a, b, "platform-expiry"))
      .map((entry) => entry.id),
    ["early", "later", "none"],
  );
  assert.equal(platformDiscountExpiryMillis({
    price: 1000,
    officialPrice: 1000,
    raw: { discount_end_date: "09/14 13:59" },
  }, reference), Infinity);
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

test("筛选优惠券按「券·分区｜力度·条件｜进度」紧凑显示", () => {
  assert.equal(compactCouponBenefitLabel({
    conditionType: "payment",
    discountType: "fixed",
    discount: 400,
    minSpend: 1200,
    minCount: 1,
  }), "满1,200减400日元");
  assert.equal(compactCouponBenefitLabel({
    conditionType: "id_all",
    discountType: "percent",
    discount: 50,
    equivalentRate: 50,
    minSpend: 0,
    minCount: 3,
    maxDiscount: 0,
  }), "50OFF·3部起用");
});

test("优惠券类别标签优先取站点限制，未收录分区码原样大写", () => {
  assert.equal(couponCategoryLabels({
    siteIds: ["comic"],
    distributeTargets: ["maniax"],
  }).join("/"), "漫画");
  assert.equal(couponCategoryLabels({
    distributeTargets: ["girls", "maniax", "girls-pro"],
  }).join("/"), "女性向/同人");
  assert.equal(couponCategoryLabels({
    distributeTargets: ["appx", "pro", "comic", "bl"],
  }).join("/"), "手机游戏/游戏/漫画/女性向");
  assert.equal(couponCategoryLabels({
    distributeTargets: ["new-site-2027"],
  }).join("/"), "NEWSITE2027");
  assert.equal(couponCategoryLabels({}).join("/"), "");
});

const FIX_CAMPAIGN_HTML = `<!doctype html><html><head>
<title>ボイス・ASMR・音楽 3本999円まとめ買い【2026年10月】特設ページ</title>
<meta name="description" content="ボイス・ASMR・音楽 3本999円まとめ買い【2026年10月】開催中！　～10/29 13:59">
</head><body>
<h2><span class="subcopy">ボイス・ASMR・音楽</span> <span class="maincopy">3本999円まとめ買い</span></h2>
<h3 class="cp_date">10/29 (木) 13:59まで</h3>
<script>window['97e4bcb5ad306cb8aa8e6e721c767bda_product'] = {"products":[],"type":"fix","discount_rate":null,"per_item":3,"bulkbuy_key":"matome20261023voice","limit_items":0,"required_worknos":[]};</script>
</body></html>`;

const RATE_CAMPAIGN_HTML = `<!doctype html><html><head><title>3作品以上30%OFF</title></head><body>
<h3 class="cp_date">11/05 13:59まで</h3>
<script>window['abc_product'] = {"products":[],"type":"rate","discount_rate":30,"per_item":3,"bulkbuy_key":"demo-rate"};</script>
</body></html>`;

const CLOSED_CAMPAIGN_HTML = `<!doctype html><html><head>
<title>キャンペーン終了のお知らせ</title></head><body><p>このキャンペーンは終了しました。</p></body></html>`;

test("定额型活动按「3件999円」解析，而不是当成无折扣", () => {
  const rule = bulkRuleFromHtml(FIX_CAMPAIGN_HTML, "matome20261023voice");
  assert.equal(bulkRuleKind(rule), "fix");
  assert.deepEqual({ ...bulkRuleBundle(rule) }, { size: 3, total: 999 });
  assert.equal(rule.discountRate, 0);
  assert.equal(rule.minCount, 3);
  assert.equal(bulkRuleLabel(rule), "3件999円");
  const now = new Date();
  const expected = [0, 1].map((offset) => Date.UTC(
    now.getFullYear() + offset, 9, 29, 13 - 9, 59, 0,
  )).find((value) => value >= Date.now() - 24 * 60 * 60 * 1000);
  assert.equal(rule.expiresAt, expected);
});

test("比例型活动解析保持不变", () => {
  const rule = bulkRuleFromHtml(RATE_CAMPAIGN_HTML, "demo-rate");
  assert.equal(bulkRuleKind(rule), "rate");
  assert.equal(rule.discountRate, 30);
  assert.equal(rule.minCount, 3);
  assert.equal(rule.fixedTotal, 0);
  assert.equal(bulkRuleBundle(rule), null);
  assert.equal(bulkRuleLabel(rule), "3件30OFF");
});

test("活动结束页不产出规则，并识别为已结束以便负缓存", () => {
  assert.equal(bulkRuleFromHtml(CLOSED_CAMPAIGN_HTML, "closed"), null);
  assert.equal(campaignPageIsClosed(CLOSED_CAMPAIGN_HTML), true);
  assert.equal(campaignPageIsClosed(FIX_CAMPAIGN_HTML), false);
  const negative = {
    key: "closed",
    unavailable: true,
    fetchedAt: Date.now(),
    ttlMs: 24 * 60 * 60 * 1000,
  };
  assert.equal(bulkRuleIsActive(negative), false);
  assert.equal(cachedBulkRuleDecision(negative), null);
  assert.equal(
    cachedBulkRuleDecision({ ...negative, fetchedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    undefined,
  );
});

test("定额型活动单件理论价取 999/3，券在平台价之上继续叠加", () => {
  const rule = bulkRuleFromHtml(FIX_CAMPAIGN_HTML, "matome20261023voice");
  const product = { id: "RJ1", bulkbuyKey: "matome20261023voice", price: 880, officialPrice: 880 };
  assert.equal(bulkRuleUnitPrice(rule, product), 333);
  const best = calculateBestReach(product, [], rule);
  assert.ok(Math.abs(best.bulkRate - 62.159) < 0.01);
  assert.equal(calculateHypotheticalPrice(product, best), 333);
  const withCoupon = calculateBestReach(product, [{
    groupKey: "C1",
    discountType: "percent",
    discount: 50,
    minSpend: 0,
    minCount: 1,
    maxDiscount: 0,
    equivalentRate: 50,
  }], rule);
  assert.ok(withCoupon.totalRate > best.totalRate);
  assert.equal(calculateHypotheticalPrice(product, withCoupon), 167);
});

test("定额型活动按整组结算：少于 3 件不生效，余数按原价", () => {
  const rule = bulkRuleFromHtml(FIX_CAMPAIGN_HTML, "matome20261023voice");
  const item = (price) => ({ bulkbuyKey: "matome20261023voice", price, officialPrice: price });
  assert.equal(bulkRuleGroupTotal([item(880), item(880)], rule), 1760);
  assert.equal(bulkRuleGroupTotal([item(880), item(880), item(880)], rule), 999);
  assert.equal(
    bulkRuleGroupTotal([item(880), item(880), item(880), item(880)], rule),
    999 + 880,
  );
  assert.equal(
    bulkRuleGroupTotal(Array.from({ length: 6 }, () => item(880)), rule),
    1998,
  );
  assert.equal(
    bulkRuleGroupTotal([item(200), item(880), item(880)], rule),
    999,
  );
});

test("同一 coupon_id 的多条投放记录合并为一张券，不按范围拆成两张", () => {
  const raw = [
    {
      coupon_id: "GIRLS50",
      coupon_name: "女性向け作品50%OFFクーポン",
      discount_type: "rate",
      discount: 50,
      condition_type: "site_ids",
      conditions: { site_ids: ["girls"] },
      distribute_targets: ["girls"],
      limit_date: future,
    },
    {
      coupon_id: "GIRLS50",
      coupon_name: "女性向け作品50%OFFクーポン",
      discount_type: "rate",
      discount: 50,
      condition_type: "site_ids",
      conditions: { site_ids: ["bl"] },
      distribute_targets: ["bl"],
      limit_date: future,
    },
  ];
  const groups = groupDealCoupons(raw, now);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].instances, 1);
  assert.deepEqual([...groups[0].siteIds].sort(), ["bl", "girls"]);
  assert.deepEqual([...groups[0].distributeTargets].sort(), ["bl", "girls"]);
});

test("不同 coupon_id 但条件完全相同的券仍合并为一种，并计 2 张", () => {
  const raw = ["A", "B"].map((id) => ({
    coupon_id: id,
    coupon_name: `50OFF-${id}`,
    discount_type: "rate",
    discount: 50,
    condition_type: "site_ids",
    conditions: { site_ids: ["girls"] },
    limit_date: future,
  }));
  const groups = groupDealCoupons(raw, now);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].instances, 2);
});

test("同力度同进度的券用适用范围补后缀，避免看起来像重复项", () => {
  const labels = disambiguateCouponOptionLabels([
    { label: "50OFF｜无门槛", scope: "TL" },
    { label: "50OFF｜无门槛", scope: "BL" },
    { label: "30OFF｜无门槛", scope: "TL" },
  ]);
  assert.deepEqual(labels, ["50OFF｜无门槛｜TL", "50OFF｜无门槛｜BL", "30OFF｜无门槛"]);
  assert.equal(couponScopeLabel({
    siteIds: ["girls", "bl"],
    distributeTargets: ["girls"],
  }), "TL/BL");
  assert.equal(couponScopeLabel({ siteIds: [], distributeTargets: ["maniax"] }), "同人");
  assert.equal(couponScopeLabel({}), "");
});

test("范围相同的两张券再用条件区分，不再显示成两条一样的券", () => {
  const labels = disambiguateCouponOptionLabels([
    { label: "50OFF｜无门槛", scope: "TL", condition: "指定站点" },
    { label: "50OFF｜无门槛", scope: "TL", condition: "全作品" },
  ]);
  assert.deepEqual(labels, ["50OFF｜无门槛｜TL·指定站点", "50OFF｜无门槛｜TL·全作品"]);
  assert.equal(couponConditionLabel({ conditionType: "site_ids" }), "指定站点");
  assert.equal(couponConditionLabel({ conditionType: "all" }), "全作品");
  assert.equal(couponConditionLabel({ conditionType: "id_all" }), "指定作品");
  assert.equal(couponConditionLabel({ conditionType: "unknown" }), "");
});
