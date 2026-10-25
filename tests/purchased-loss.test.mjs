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
    globalThis.purchasedLossSummary = purchasedLossSummary;
    globalThis.purchasedRowsFromRoot = purchasedRowsFromRoot;`,
    sandbox,
  );
  return sandbox;
}

const coreSource = () =>
  [
    functionSource("parseYenAmount"),
    functionSource("purchasedLowestFor"),
    functionSource("purchasedLowChipText"),
    functionSource("purchasedLossSummary"),
    functionSource("purchasedPriceTable"),
    functionSource("purchasedPriceColumnIndex"),
    functionSource("purchasedRowsFromRoot"),
  ].join("\n");

test("已购页从价格（含税）列解析实付金额", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
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

test("已购页结算区分买贵、买便宜、持平与缺少史低", () => {
  const sandbox = makeSandbox(`${coreSource()}
    const PURCHASED_PAID_ATTRIBUTE = "data-dltracker-purchased-paid";
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
