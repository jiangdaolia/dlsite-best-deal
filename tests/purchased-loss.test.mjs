import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);

function functionSource(name) {
  const result = source.match(new RegExp(
    `  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`,
  ));
  if (!result) throw new Error(`${name} not found`);
  return result[0];
}

// 单行 const 直接抽出来（多行常量用 functionSource 抽会被相邻函数吞进去）。
function constantSource(name) {
  const result = source.match(new RegExp(`^  const ${name} = .*;$`, "m"));
  if (!result) throw new Error(`${name} not found`);
  return result[0];
}

function makeSandbox(extraSource = "") {
  const sandbox = {
    console: { warn() {} },
    toYen(value) {
      return `${Math.round(value).toLocaleString("ja-JP")}円`;
    },
  };
  vm.runInNewContext(
    `${extraSource}
    globalThis.parseYenAmount = parseYenAmount;
    globalThis.parseAmountInfo = parseAmountInfo;
    globalThis.purchasedLossSummary = purchasedLossSummary;
    globalThis.purchasedCellText = purchasedCellText;
    globalThis.purchasedRowsFromRoot = purchasedRowsFromRoot;
    globalThis.purchasedWorkTypeLabel = purchasedWorkTypeLabel;
    globalThis.purchasedWorkTypeOf = purchasedWorkTypeOf;`,
    sandbox,
  );
  return sandbox;
}

const coreSource = () =>
  [
    'const PURCHASED_PRICE_HEADER_RE = /価格|价格|價格|料金|price/i;',
    constantSource("PURCHASED_WORK_TYPE_LABELS"),
    functionSource("parseAmountInfo"),
    functionSource("parseYenAmount"),
    functionSource("purchasedPaidToYen"),
    functionSource("purchasedLowestFor"),
    functionSource("purchasedLowChipText"),
    functionSource("purchasedLossSummary"),
    functionSource("purchasedPriceTable"),
    functionSource("purchasedHeaderCells"),
    functionSource("purchasedPriceColumnIndex"),
    functionSource("purchasedPriceHeaderCell"),
    functionSource("purchasedAmountFromText"),
    functionSource("purchasedCurrencyHint"),
    functionSource("purchasedRowPriceCell"),
    functionSource("purchasedCellText"),
    functionSource("purchasedWorkTypeLabel"),
    functionSource("purchasedWorkTypeOf"),
    functionSource("purchasedRowsFromRoot"),
  ].join("\n");

test("已购页从价格（含税）列解析实付金额", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();`);
  const parse = sandbox.parseYenAmount;
  assert.equal(parse("1,980円"), 1980);
  assert.equal(parse("￥2,530"), 2530);
  assert.equal(parse("0円"), 0);
  assert.equal(parse("1,980 日元"), 1980);
  assert.equal(parse("2,530 JPY"), 2530);
  // 一格里有原价和实付时取最后一个（实付）。
  assert.equal(parse("通常 2,530円 → 1,980円"), 1980);
  assert.equal(parse("-"), null);
  assert.equal(parse(""), null);
  assert.equal(parse(null), null);
});

test("已购页把人民币显示的价格也认出来，并折算成日元比较", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    let rateValue = 0.05;
    function purchasedCnyRate() {
      return rateValue;
    }
    globalThis.paidToYen = purchasedPaidToYen;
    globalThis.setRate = (next) => { rateValue = next; };`);
  const info = sandbox.parseAmountInfo;
  // 中文界面（currency=CNY）会带两位小数，或者干脆写成「62.00元 / CNY 62.00」。
  assert.deepEqual(
    [info("¥62.00").amount, info("¥62.00").currency],
    [62, "CNY"],
  );
  assert.deepEqual(
    [info("62.00 元").amount, info("62.00 元").currency],
    [62, "CNY"],
  );
  assert.deepEqual(
    [info("CNY 1,234.50").amount, info("CNY 1,234.50").currency],
    [1234.5, "CNY"],
  );
  // 日文界面的整数写法仍然是日元。
  assert.equal(info("￥2,530").currency, "JPY");
  assert.equal(info("1,980円").currency, "JPY");
  // 人民币按本地比例折成日元：62 / 0.05 = 1240。
  const converted = sandbox.paidToYen(62, "CNY");
  assert.equal(converted.cny, 62);
  assert.equal(converted.yen, 1240);
  // 没有汇率时不要瞎算：金额留空，但人民币原值还在，弹窗可以解释。
  sandbox.setRate(null);
  const noRate = sandbox.paidToYen(62, "CNY");
  assert.equal(noRate.yen, null);
  assert.equal(noRate.cny, 62);
  // 日元金额原样返回。
  assert.deepEqual(
    [sandbox.paidToYen(1980, "JPY").yen, sandbox.paidToYen(1980, "JPY").cny],
    [1980, null],
  );
});

test("算算亏了多少按钮不再因为解析不到金额而被禁用", () => {
  const toolbar = functionSource("ensurePurchasedToolbar");
  // 一旦按「有没有实付金额」禁用，价格列换格式就会变成点不动的灰按钮。
  assert.doesNotMatch(toolbar, /button\.disabled = !withPaid/);
  assert.match(toolbar, /button\.disabled = false/);
  const run = functionSource("runPurchasedLowestComparison");
  // 异常后也要恢复可点，否则一次失败就永久卡死。
  assert.match(run, /if \(current\) current\.disabled = false/);
});

test("已购页结算区分买贵、买便宜、持平与缺少史低", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();`);
  const rows = [
    { id: "RJ00000001", paid: 2500 },
    { id: "RJ00000002", paid: 990 },
    { id: "RJ00000003", paid: 1500 },
    { id: "RJ00000004", paid: 3000 },
    { id: "RJ00000005", paid: null },
  ];
  const lowest = {
    RJ00000001: 990,
    RJ00000002: 1980,
    RJ00000003: 1500,
    RJ00000004: null,
  };
  const summary = sandbox.purchasedLossSummary(rows, (row) => (
    Object.prototype.hasOwnProperty.call(lowest, row.id) ? lowest[row.id] : null
  ));
  // RJ00000005 没有实付金额，直接跳过；RJ00000004 没读到史低，单独列出。
  assert.equal(summary.compared.length, 3);
  assert.deepEqual([...summary.missing].map((row) => row.id), ["RJ00000004"]);
  assert.equal(summary.overpaidCount, 1);
  assert.equal(summary.cheaperCount, 1);
  assert.equal(summary.evenCount, 1);
  assert.equal(summary.overpaidTotal, 1510);
  assert.equal(summary.savedTotal, 990);
  assert.equal(summary.totalPaid, 4990);
  assert.equal(summary.totalLowest, 4470);
  assert.equal(summary.netDiff, 520);
  // 按「亏得最多」排序，买便宜的排在最后。
  assert.deepEqual([...summary.compared].map((row) => row.id), [
    "RJ00000001",
    "RJ00000003",
    "RJ00000002",
  ]);
  assert.equal(summary.compared[2].diff, -990);
});

test("已购页从表格定位价格列并读出每一行的编号与实付", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();`);
  const cell = (tagName, textContent) => ({ tagName, textContent });
  const header = {
    cells: [cell("TH", "作品名"), cell("TH", "价格（含税）"), cell("TH", "购入日")],
    querySelector: () => null,
  };
  const row = (href, title, price) => ({
    cells: [cell("TD", title), cell("TD", price), cell("TD", "2026-10-01")],
    getAttribute: () => null,
    setAttribute() {},
    querySelector: (selector) => (selector.includes("product_id") && href
      ? { getAttribute: () => href, textContent: title, href: `https://www.dlsite.com${href}` }
      : null),
  });
  const rows = [
    header,
    row("/girls/work/=/product_id/RJ01234567.html", "作品甲", "1,980円"),
    row("/girls/work/=/product_id/BJ000123.html", "作品乙", "￥550"),
    row(null, "广告位", "0円"),
  ];
  const table = {
    rows,
    parentElement: null,
    querySelectorAll(selector) {
      if (selector === "tr") return rows;
      if (selector.includes("product_id/")) return [rows[1], rows[2]];
      return [];
    },
  };
  const root = {
    querySelectorAll: (selector) => (selector === "table" ? [table] : []),
  };
  const result = sandbox.purchasedRowsFromRoot(root);
  assert.equal(result.priceIndex, 1);
  assert.deepEqual([...result.rows].map((item) => item.id), ["RJ01234567", "BJ000123"]);
  assert.deepEqual([...result.rows].map((item) => item.paid), [1980, 550]);
  assert.equal(result.rows[0].title, "作品甲");
  assert.equal(result.rows[0].href, "https://www.dlsite.com/girls/work/=/product_id/RJ01234567.html");
});

test("已购页史低标签写成「史低N JPY / M RMB」", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map([
      ["RJ00000001", { lowest: 990 }],
      ["RJ00000002", { lowest: 1980 }],
      ["RJ00000003", { lowest: 1500 }],
      ["RJ00000004", { lowest: null }],
    ]);
    const purchasedCnyRate = () => 0.0426;`);
  const chip = (id, paid) => {
    const state = sandbox.purchasedLowChipText({ id, paid });
    return [state.text, state.tone];
  };
  // 990 JPY × 0.0426 ≈ 42.17 RMB；标签里只给金额，贵/省由色调和悬浮提示表达。
  assert.deepEqual(chip("RJ00000001", 1980), ["史低990 JPY / 42.17 RMB", "loss"]);
  assert.deepEqual(chip("RJ00000002", 990), ["史低1980 JPY / 84.35 RMB", "win"]);
  assert.deepEqual(chip("RJ00000003", 1500), ["史低1500 JPY / 63.90 RMB", "even"]);
  assert.deepEqual(chip("RJ00000004", 1500), ["无史低数据", "unknown"]);
  assert.deepEqual(chip("RJ00000009", 1500), ["史低读取中…", "pending"]);
});

test("已购页算不出人民币汇率时史低只显示日元", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map([["RJ00000001", { lowest: 379 }]]);`);
  const state = sandbox.purchasedLowChipText({ id: "RJ00000001", paid: 1980 });
  assert.equal(state.text, "史低379 JPY");
  assert.equal(state.tone, "loss");
  // 直接传入汇率时也按传入值换算。
  const withRate = sandbox.purchasedLowChipText({ id: "RJ00000001", paid: 1980 }, 0.0426);
  assert.equal(withRate.text, "史低379 JPY / 16.15 RMB");
});

test("已购页史低只在点击按钮后才读取", () => {
  const enhance = functionSource("enhancePurchasedWorksPage");
  // 进页面只挂按钮，绝不发起史低请求、也不往价格列写标签。
  assert.doesNotMatch(enhance, /ensurePurchasedLowestPrices/);
  assert.doesNotMatch(enhance, /renderPurchasedLowChip\(/);
  assert.match(enhance, /purchasedLowStartedFor === table/);
  // 按钮点击进入统一入口，由入口去取史低并写标签。
  assert.match(functionSource("ensurePurchasedToolbar"), /runPurchasedLowestComparison\(\)/);
  const run = functionSource("runPurchasedLowestComparison");
  assert.match(run, /ensurePurchasedLowestPrices\(/);
  assert.match(run, /renderPurchasedLowChips\(rows\)/);
  assert.match(run, /openPurchasedLossDialog\(\)/);
});

test("已购页对比只取主表格的作品编号，不把推荐位算进来", () => {
  const sandbox = makeSandbox(`${functionSource("pageProductIds")}
    ${functionSource("purchasedPageIds")}
    ${functionSource("purchasedPageTotalText")}
    ${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    globalThis.purchasedPageIds = purchasedPageIds;
    globalThis.purchasedPageTotalText = purchasedPageTotalText;`);
  const cell = (tagName, textContent) => ({ tagName, textContent });
  const header = { cells: [cell("TH", "作品名"), cell("TH", "価格（税込）")], querySelector: () => null };
  const row = (href, price) => ({
    cells: [cell("TD", "作品"), cell("TD", price)],
    getAttribute: () => null,
    setAttribute() {},
    querySelector: (selector) => (selector.includes("product_id") && href
      ? { getAttribute: () => href, textContent: "作品", href }
      : null),
  });
  const rows = [header, row("/girls/work/=/product_id/RJ00000001.html", "1,980円"),
    row("/girls/work/=/product_id/RJ00000002.html", "990円")];
  const table = {
    rows,
    querySelectorAll: (selector) => {
      if (selector === "tr") return rows;
      if (selector.includes("product_id/")) return [rows[1], rows[2]];
      return [];
    },
  };
  const recommendation = [
    { getAttribute: () => "/girls/work/=/product_id/RJ99999999.html" },
  ];
  const doc = {
    body: { textContent: "購入済み作品 全 38 件 1 2 次へ" },
    querySelectorAll: (selector) => {
      if (selector === "table") return [table];
      if (selector.includes("product_id/")) return recommendation;
      return [];
    },
  };
  // 推荐位里的 RJ99999999 不能被算进清单。
  assert.deepEqual([...sandbox.purchasedPageIds(doc)], ["RJ00000001", "RJ00000002"]);
  assert.equal(sandbox.purchasedPageTotalText(doc), "全 38 件");
});

test("已购页数量对比文本列出接口有而页面没有的编号", () => {
  const sandbox = makeSandbox(`${coreSource()}
    ${functionSource("purchasedDiffTitle")}
    ${functionSource("purchasedDiffReasonText")}
    ${functionSource("purchasedDiffText")}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    function normalizedMetadataProduct(id, raw) {
      return {
        id,
        title: String(raw?.title || id),
        siteId: String(raw?.site_id || ""),
        price: Number.isFinite(Number(raw?.price)) ? Number(raw.price) : null,
      };
    }
    globalThis.purchasedDiffText = purchasedDiffText;`);
  const cache = {
    metadata: {
      RJ00000003: { raw: { title: "作品丙", site_id: "girls", price: 1980 } },
    },
  };
  const text = sandbox.purchasedDiffText({
    apiIds: ["RJ00000001", "RJ00000002", "RJ00000003"],
    pageIds: ["RJ00000001"],
    missingOnPage: ["RJ00000002", "RJ00000003"],
    extraOnPage: [],
    filters: [{ name: "month", selected: "2026-10", options: 13 }],
    totalText: "全 38 件",
    pages: 2,
    cache,
  });
  assert.match(text, /接口清单 3 条｜本页（含翻页 2 页）1 部｜差 2 条/);
  assert.match(text, /页面自称总数：全 38 件/);
  assert.match(text, /页面筛选：month=2026-10/);
  assert.match(text, /接口有但页面没有（2）/);
  assert.match(text, /RJ00000002/);
  assert.match(text, /RJ00000003｜作品丙｜girls｜1980円/);
});

test("已购页数量对比标出每条的差异原因与同作品多编号", () => {
  const sandbox = makeSandbox(`${coreSource()}
    ${functionSource("purchasedDiffTitle")}
    ${functionSource("purchasedDiffReasonText")}
    ${functionSource("purchasedDiffText")}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    function normalizedMetadataProduct(id, raw) {
      return { id, title: String(raw?.title || id), siteId: "", price: null };
    }
    function loadDealCache() {
      return { metadata: {} };
    }
    globalThis.purchasedDiffText = purchasedDiffText;`);
  const text = sandbox.purchasedDiffText({
    apiIds: ["RJ01010333", "RJ01011067", "RJ01011068"],
    pageIds: ["RJ01011067"],
    missingOnPage: ["RJ01010333", "RJ01011068"],
    extraOnPage: ["RJ01011067"],
    workCount: 1,
    duplicateWorks: [{
      ids: ["RJ01010333", "RJ01011067", "RJ01011068"],
      title: "あなたが私を買った理由",
    }],
    reasons: new Map([
      ["RJ01011068", {
        kind: "alias",
        target: "RJ01011067",
        text: "同一作品换号/语言版，页面显示 RJ01011067（本页已列出）",
      }],
      ["RJ01010333", {
        kind: "gone",
        text: "销售页已下架（404）；购买记录仍在「購入履歴」里，可尝试再下载",
      }],
    ]),
    pages: 1,
  });
  // 编号数与作品数分开写，43 与 39 的差才解释得清。
  assert.match(text, /按作品归组：3 条编号 = 1 部作品（1 部作品有多个编号）/);
  assert.match(text, /RJ01011068｜同一作品换号\/语言版，页面显示 RJ01011067（本页已列出）/);
  assert.match(text, /RJ01010333｜销售页已下架（404）/);
  assert.match(text, /同一部作品的多个编号（1 部）/);
  assert.match(text, /RJ01010333 \/ RJ01011067 \/ RJ01011068｜あなたが私を買った理由/);
  // 没有原因数据时退化成原来的输出，不出现空的原因列。
  const plain = sandbox.purchasedDiffText({
    apiIds: ["RJ00000001"],
    pageIds: [],
    missingOnPage: ["RJ00000001"],
  });
  assert.doesNotMatch(plain, /undefined/);
});

test("差异原因按作品页探测结果归类", () => {
  const sandbox = {};
  vm.runInNewContext(`
    ${functionSource("purchasedDiffReasonOf")}
    globalThis.reasonForTest = purchasedDiffReasonOf;
  `, sandbox);
  const reason = sandbox.reasonForTest;
  const alias = reason("RJ00000001", { status: 302, target: "RJ00000002" },
    new Set(["RJ00000002"]));
  assert.equal(alias.kind, "alias");
  assert.match(alias.text, /RJ00000002.*本页已列出/);
  // 换号目标不在页面上时不能谎称「已列出」。
  assert.doesNotMatch(
    reason("RJ00000001", { status: 302, target: "RJ00000002" }, new Set()).text,
    /本页已列出/,
  );
  assert.equal(
    reason("RJ00000001", { status: 404, target: "" }, new Set()).kind,
    "gone",
  );
  assert.equal(
    reason("RJ00000001", { status: 200, target: "RJ00000001" }, new Set()).kind,
    "same",
  );
  assert.equal(
    reason("RJ00000001", { status: 503, target: "RJ00000001" }, new Set()).kind,
    "error",
  );
  assert.equal(reason("RJ00000001", null, new Set()).kind, "unknown");
});

test("原版销售页 404 时说明同作品仍在售，而不是说作品被删", () => {
  const sandbox = {};
  vm.runInNewContext(`
    ${functionSource("purchasedDiffSiblingOf")}
    ${functionSource("purchasedDiffReasonOf")}
    globalThis.siblingForTest = purchasedDiffSiblingOf;
    globalThis.reasonForTest = purchasedDiffReasonOf;
  `, sandbox);
  const reason = sandbox.reasonForTest;
  const siblingOf = sandbox.siblingForTest;
  // 原版与简中版标题只差一个前缀，去掉后键相同 → 认成同一部作品。
  const titles = new Map([
    ["RJ01010333", "あなたが私を買った理由|girls"],
    ["RJ01011067", "あなたが私を買った理由|girls"],
  ]);
  const titleKeyOf = (id) => titles.get(id) || "";
  assert.equal(
    siblingOf("RJ01010333", { titleKeyOf, pageIds: ["RJ01011067"] }),
    "RJ01011067",
  );
  // 页面优先于接口：告诉用户「你手上还有一个能用的编号」。
  assert.equal(
    siblingOf("RJ01010333", {
      titleKeyOf,
      pageIds: ["RJ01011067"],
      apiIds: ["RJ01010333", "RJ01011067"],
    }),
    "RJ01011067",
  );
  assert.equal(siblingOf("RJ01010333", { titleKeyOf, pageIds: [] }), "");
  const removed = reason("RJ01010333", { status: 404, target: "" }, new Set(), {
    siblingOf: (id) => siblingOf(id, { titleKeyOf, pageIds: ["RJ01011067"] }),
  });
  assert.equal(removed.kind, "alias-removed");
  assert.match(removed.text, /RJ01011067 仍在售/);
  assert.match(removed.text, /购买记录不受影响/);
  // 找不到同作品编号时也不能说「作品被删」，只提示去購入履歴再下载。
  const gone = reason("RJ01010333", { status: 404, target: "" }, new Set(), {
    siblingOf: () => "",
  });
  assert.equal(gone.kind, "gone");
  assert.match(gone.text, /購入履歴/);
  assert.doesNotMatch(gone.text, /删除/);
});

test("已购页工具栏提供数量对比按钮，且对比沿用当前筛选地址", () => {
  const toolbar = functionSource("ensurePurchasedToolbar");
  assert.match(toolbar, /openPurchasedDiffDialog\(\)/);
  assert.match(toolbar, /数量对不上？/);
  const collect = functionSource("collectPurchasedDiff");
  // 用当前地址当起点，页面已选的月份/类型筛选才会带进翻页对比。
  assert.match(collect, /startUrl: location\.href/);
  assert.match(collect, /seedDoc: document/);
  assert.match(functionSource("fetchBoughtPageSnapshot"), /seedDoc && !pages/);
});

test("价格格里已有史低标签时，二次解析不会把标签当成实付", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();`);
  const text = (value) => ({ nodeType: 3, textContent: value });
  const chip = (value) => ({
    nodeType: 1,
    textContent: value,
    classList: { contains: (name) => name === "dltracker-purchased-low" },
  });
  const polluted = {
    childNodes: [text("¥62.00"), chip("史低379 JPY / 16.16 RMB")],
    textContent: "¥62.00史低379 JPY / 16.16 RMB",
  };
  // 注入标签之后单元格文本变成「¥62.00史低379…」，直接解析会取到 379。
  assert.equal(sandbox.parseAmountInfo(polluted.textContent).amount, 379);
  // 排除标签后仍然是实付的 62 元。
  assert.equal(sandbox.purchasedCellText(polluted), "¥62.00");
  // 没有 childNodes 时退回整体文本，并把标签文本剪掉。
  const flat = {
    textContent: "¥62.00 史低379 JPY / 16.16 RMB",
    querySelector: () => ({ textContent: "史低379 JPY / 16.16 RMB" }),
  };
  assert.equal(sandbox.purchasedCellText(flat), "¥62.00");
  assert.equal(sandbox.purchasedCellText(null), "");
});

test("明细差额之和与合计差额一致（金额先取整再累加）", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();`);
  // 人民币折算出来的金额是带小数的，正是旧版「表格加起来和合计对不上」的来源。
  const rows = [
    { id: "RJ00000001", paid: 1455.39, currency: "CNY", paidCny: 62, paidRaw: "¥62.00" },
    { id: "RJ00000002", paid: 1234.567, currency: "CNY", paidCny: 52.6, paidRaw: "¥52.60" },
    { id: "RJ00000003", paid: 2420 },
    { id: "RJ00000004", paid: 880, currency: "JPY" },
    { id: "RJ00000005", paid: 1500 },
    { id: "RJ00000006", paid: null },
  ];
  const lowest = {
    RJ00000001: 379.4,
    RJ00000002: 1234.567,
    RJ00000003: 1980.6,
    RJ00000004: null,
    RJ00000005: 1500,
    RJ00000006: 900,
  };
  const summary = sandbox.purchasedLossSummary(rows, (row) => (
    Object.prototype.hasOwnProperty.call(lowest, row.id) ? lowest[row.id] : null
  ));
  // 每一行都是整数円，表格里显示的数就是参与计算的数。
  assert.equal(summary.compared.every((row) => Number.isInteger(row.paid)), true);
  assert.equal(summary.compared.every((row) => Number.isInteger(row.lowest)), true);
  const diffSum = summary.compared.reduce((sum, row) => sum + row.diff, 0);
  assert.equal(diffSum, summary.netDiff);
  assert.equal(summary.diffSum, summary.netDiff);
  assert.equal(summary.selfCheckOk, true);
  assert.equal(
    summary.compared.reduce((sum, row) => sum + row.paid, 0),
    summary.totalPaid,
  );
  assert.equal(
    summary.compared.reduce((sum, row) => sum + row.lowest, 0),
    summary.totalLowest,
  );
  // 本页 = 计入 + 无史低 + 未解析，行数不能凭空少。
  assert.equal(summary.rowsTotal, rows.length);
  assert.equal(
    summary.countedCount + summary.missing.length + summary.unparsed.length,
    summary.rowsTotal,
  );
  assert.deepEqual([...summary.missing].map((row) => row.id), ["RJ00000004"]);
  assert.deepEqual([...summary.unparsed].map((row) => row.id), ["RJ00000006"]);
});

test("文本版把未计入的行也列出来，并带上自检结果", () => {
  const sandbox = makeSandbox(`${coreSource()}
    ${functionSource("purchasedLossText")}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    globalThis.purchasedLossText = purchasedLossText;`);
  const rows = [
    { id: "RJ00000001", paid: 1455.39, currency: "CNY", paidCny: 62, paidRaw: "¥62.00", typeLabel: "音声" },
    { id: "RJ00000002", paid: 990, typeLabel: "漫画" },
    { id: "RJ00000003", paid: null, paidRaw: "无料", typeLabel: "游戏" },
  ];
  const summary = sandbox.purchasedLossSummary(rows, (row) => (
    row.id === "RJ00000002" ? 1980 : row.id === "RJ00000001" ? 379 : null
  ));
  const text = sandbox.purchasedLossText(summary);
  assert.match(text, /本页 3 部｜计入合计 2 部｜未计入 1 部/);
  // 每行带类型，结算列表里能分清音声/漫画/游戏。
  assert.match(text, /编号｜类型｜实付｜史低｜差额/);
  // 人民币原值必须写出来，否则和页面上的「¥62.00」对不上。
  assert.match(text, /RJ00000001｜音声｜¥62\.00（≈1,455円）｜379円｜\+1,076円/);
  assert.match(text, /RJ00000002｜漫画｜990円｜1,980円｜-990円/);
  assert.match(text, /自检：明细差额之和 .*（与合计差额一致）/);
  assert.match(text, /价格未解析（未计入）：/);
  assert.match(text, /RJ00000003｜游戏｜无料/);
});

// 用户实际遇到的情况：史低标签被塞进了「支付方式」列，价格列反而是空的。
// 根因是列号只按表头文字猜，而数据行的列序和表头不一致（错开一格）。
test("数据行列序和表头不一致时，史低标签仍落在含金额的价格格", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    const purchasedCnyRate = () => 0.05;`);
  const cell = (tagName, textContent) => ({ tagName, textContent });
  // 表头把「价格」写在「支付方式」前面，数据行却是支付方式在前、价格在后。
  const header = {
    cells: [cell("TH", "作品名"), cell("TH", "价格（含税）"), cell("TH", "支付方式")],
    querySelector: () => null,
  };
  const row = (href, title, payment, price) => ({
    cells: [cell("TD", title), cell("TD", payment), cell("TD", price)],
    getAttribute: () => null,
    setAttribute() {},
    querySelector: (selector) => (selector.includes("product_id") && href
      ? { getAttribute: () => href, textContent: title, href: `https://www.dlsite.com${href}` }
      : null),
  });
  const rows = [
    header,
    row("/girls/work/=/product_id/RJ00000001.html", "作品甲", "クレジットカード", "¥62.00"),
    row("/girls/work/=/product_id/RJ00000002.html", "作品乙", "PayPay", "¥52.60"),
  ];
  const table = {
    rows,
    parentElement: null,
    querySelectorAll: (selector) => {
      if (selector === "tr") return rows;
      if (selector.includes("product_id/")) return [rows[1], rows[2]];
      return [];
    },
  };
  const result = sandbox.purchasedRowsFromRoot({ querySelectorAll: () => [table] });
  // 金额只出现在第 3 列，列号必须跟着金额走，而不是跟着表头文字。
  assert.equal(result.priceIndex, 2);
  assert.deepEqual([...result.rows].map((item) => item.cell.textContent), ["¥62.00", "¥52.60"]);
  assert.deepEqual([...result.rows].map((item) => item.paidRaw), ["¥62.00", "¥52.60"]);
  // 人民币折算成日元后才有可比性：62 / 0.05 = 1240。
  assert.deepEqual([...result.rows].map((item) => Math.round(item.paid)), [1240, 1052]);
});

test("工具栏按钮挂在表头「价格」那一格，不会落在别的列", () => {
  const sandbox = makeSandbox(`${coreSource()}
    globalThis.headerCell = purchasedPriceHeaderCell;`);
  const cell = (tagName, textContent) => ({ tagName, textContent });
  const priceCell = cell("TH", "价格（含税）");
  const table = {
    rows: [{ cells: [cell("TH", "作品名"), cell("TH", "支付方式"), priceCell] }],
  };
  // 列号是从别处算出来的（这里故意给 1），也要按表头文字挂到价格列。
  assert.equal(sandbox.headerCell(table, 1), priceCell);
  assert.equal(sandbox.headerCell(table, -1), priceCell);
  // 表头没有「价格」字样时才退回列号。
  const bare = { rows: [{ cells: [cell("TH", "作品名"), cell("TH", "金額")] }] };
  assert.equal(sandbox.headerCell(bare, 1)?.textContent, "金額");
});

test("价格格只剩裸数字时也能认出来，且不把支付方式当金额", () => {
  const sandbox = makeSandbox(`${coreSource()}
    globalThis.amountFromText = purchasedAmountFromText;`);
  const parse = sandbox.amountFromText;
  // 没有币种符号时按写法判断：整数当日元，两位小数当人民币。
  assert.deepEqual([parse("1,980").amount, parse("1,980").currency], [1980, "JPY"]);
  assert.deepEqual([parse("62.00").amount, parse("62.00").currency], [62, "CNY"]);
  // 页面已经指定货币时以页面为准。
  assert.deepEqual([parse("62.00", "JPY").amount, parse("62.00", "JPY").currency], [62, "JPY"]);
  // 支付方式、日期这类文本不能被当成金额。
  assert.equal(parse("クレジットカード").amount, null);
  assert.equal(parse("2024/05/01").amount, null);
  assert.equal(parse("").amount, null);
});

test("结算列表按商品元数据标出作品类型（音声/漫画/游戏）", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
    const PURCHASED_PAID_CURRENCY_ATTRIBUTE = "data-dltracker-purchased-currency";
    const PURCHASED_PAID_RAW_ATTRIBUTE = "data-dltracker-purchased-raw";
    const PURCHASED_LOW_CLASSNAME = "dltracker-purchased-low";
    const purchasedLowCache = new Map();
    function loadDealCache() {
      return {
        metadata: {
          RJ00000001: { raw: { work_type: "SOU" } },
          RJ00000002: { raw: { work_type: "MNG" } },
          RJ00000003: { raw: { work_type: "GAM" } },
          RJ00000004: { raw: {} },
          RJ00000005: { raw: { work_type: "ET3" } },
        },
      };
    }`);
  const label = sandbox.purchasedWorkTypeLabel;
  assert.equal(label("SOU"), "音声");
  assert.equal(label("MNG"), "漫画");
  assert.equal(label("GAM"), "游戏");
  assert.equal(label("sou"), "音声");
  // 不认识的代码原样显示，不吞掉信息。
  assert.equal(label("ET3"), "ET3");
  assert.equal(label(""), "");

  const cell = (tagName, textContent) => ({ tagName, textContent });
  const header = {
    cells: [cell("TH", "作品名"), cell("TH", "价格（含税）")],
    querySelector: () => null,
  };
  const row = (id, price) => ({
    cells: [cell("TD", `作品${id}`), cell("TD", price)],
    getAttribute: () => null,
    setAttribute() {},
    querySelector: (selector) => (selector.includes("product_id")
      ? { getAttribute: () => `/girls/work/=/product_id/${id}.html`, textContent: id, href: "" }
      : null),
  });
  const rows = [
    header,
    row("RJ00000001", "1,980円"),
    row("RJ00000002", "880円"),
    row("RJ00000003", "2,420円"),
    row("RJ00000004", "550円"),
    row("RJ00000005", "1,100円"),
  ];
  const table = {
    rows,
    parentElement: null,
    querySelectorAll: (selector) => {
      if (selector === "tr") return rows;
      if (selector.includes("product_id/")) return rows.slice(1);
      return [];
    },
  };
  const result = sandbox.purchasedRowsFromRoot({ querySelectorAll: () => [table] });
  // 类型来自商品元数据；没有元数据的行留空，弹窗里显示「-」。
  assert.deepEqual(
    [...result.rows].map((item) => item.typeLabel),
    ["音声", "漫画", "游戏", "", "ET3"],
  );
  assert.deepEqual(
    [...result.rows].map((item) => item.typeCode),
    ["SOU", "MNG", "GAM", "", "ET3"],
  );
});
