import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../userscript/dl-price-tracker.user.js", import.meta.url), "utf8");
function functionSource(name) {
  const result = source.match(new RegExp(`  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`));
  assert.ok(result, name);
  return result[0];
}
const id = "RJ01127138";
const time = Date.parse("2026-11-16T00:00:00Z");
function rawLog(start, end, next, price = 800) {
  return { start, end, nextRegulerPriceDate: next, priceInfo: { price, regularPrice: 1000 } };
}
function raw(logs = []) {
  return {
    productId: id, productName: "作品", releaseDate: "2024-01-20T00:00:00Z",
    discountDaysOfLastYear: 204, recentSalePriceLog: logs,
    lowestPrice: { priceInfo: { price: 500, regularPrice: 1000 } },
  };
}
function sandbox(extra = {}) {
  const box = {
    console, CACHE_TTL_MS: 86400000, REQUEST_TIMEOUT_MS: 10000,
    isValidRjCode: (code) => /^[RB]J\d{6,}$/.test(code || ""),
    buildApiUrl: (code) => `https://dlwatcher.com/product/${code}.json`,
    ...extra,
  };
  vm.runInNewContext(`const saleHistoryRequests = new Map();
    ${["saleHistoryDate", "extractSaleHistory", "summarizeSaleHistory", "getSaleHistory", "upsertPriceRecord"]
      .map(functionSource).join("\n")}
    globalThis.api = { extractSaleHistory, summarizeSaleHistory, getSaleHistory, upsertPriceRecord };`, box);
  return box.api;
}

test("规范化年度天数、零价促销、去重及坏日期；严格匹配当前编号", () => {
  const api = sandbox();
  const log = rawLog("2026-01-01", "2026-01-10", "2026-01-11", 0);
  const history = api.extractSaleHistory(raw([log, log,
    rawLog("bad", "2026-01-10"), rawLog("2026-02-01", "2026-01-01"),
    rawLog("2026-03-01", "2026-03-02", null, 1000)]), id, time);
  assert.equal(history.logs.length, 1);
  assert.equal(history.logs[0].price, 0);
  assert.equal(history.annualDays, 204);
  assert.equal(api.extractSaleHistory(raw(), "RJ999999", time), null);
  assert.equal(api.extractSaleHistory({ ...raw(), discountDaysOfLastYear: -1 }, id).annualDays, null);
});

test("连续折扣改变力度算同一轮，只计算确认恢复原价的开始到开始间隔", () => {
  const api = sandbox();
  const history = api.extractSaleHistory(raw([
    rawLog("2026-01-01", "2026-01-06", "2026-01-11"),
    rawLog("2026-01-05", "2026-01-10", "2026-01-11", 500),
    rawLog("2026-02-01", "2026-02-10", "2026-02-11"),
    rawLog("2026-03-01", "2026-03-10"),
  ]), id, time);
  const summary = api.summarizeSaleHistory(history, time);
  assert.equal(summary.intervalSamples, 2);
  assert.equal(summary.intervalDays, 30); // 31 与 28 天的中位数，取整。
  assert.equal(summary.annualPercent, 56);
  assert.equal(history.logs.length, 4); // 汇总不改写展示用的原始记录。
});

test("样本不足、未确认恢复原价、发行不足一年时不编造频率或全年占比", () => {
  const api = sandbox();
  const history = api.extractSaleHistory({ ...raw([
    rawLog("2026-09-01", "2026-09-10"),
    rawLog("2026-10-01", "2026-10-10"),
    rawLog("2026-11-01", "2026-11-10"),
  ]), releaseDate: "2026-08-01" }, id, time);
  const summary = api.summarizeSaleHistory(history, time);
  assert.equal(summary.intervalDays, null);
  assert.equal(summary.intervalSamples, 0);
  assert.equal(summary.annualPercent, null);
  assert.equal(api.summarizeSaleHistory(api.extractSaleHistory(raw(), id, time), time).intervalDays, null);
  const oldLogs = api.extractSaleHistory({ ...raw([
    rawLog("2024-02-01", "2024-02-10"),
  ]), discountDaysOfLastYear: 0 }, id, time);
  assert.equal(api.summarizeSaleHistory(oldLogs, time).annualPercent, 0);
});

test("24小时缓存可复用，旧缓存和其他编号缓存按需补取，同页连点只发一次请求", async () => {
  let calls = 0;
  let saved;
  let cache;
  const api = sandbox({
    getPriceRecord: async () => cache,
    gmRequestJson: async () => { calls++; return raw(); },
    storePut: async (_store, data) => { saved = data; cache = data; },
    STORE_PRICES: "prices", nowIso: () => new Date().toISOString(),
  });
  await Promise.all([api.getSaleHistory(id), api.getSaleHistory(id)]);
  assert.equal(calls, 1);
  assert.equal(saved.saleHistory.rjCode, id);
  await api.getSaleHistory(id);
  assert.equal(calls, 1);
  cache.saleHistory.fetchedAt -= 86400001;
  await api.getSaleHistory(id);
  assert.equal(calls, 2);
  cache.saleHistory.rjCode = "RJ999999";
  await api.getSaleHistory(id);
  assert.equal(calls, 3);
});

test("请求失败不自动重试、不写成功缓存，下次主动点击可以再读", async () => {
  let calls = 0;
  const api = sandbox({
    getPriceRecord: async () => null,
    gmRequestJson: async () => { calls++; throw new Error("HTTP 429"); },
  });
  await assert.rejects(api.getSaleHistory(id), /HTTP 429/);
  assert.equal(calls, 1);
  await assert.rejects(api.getSaleHistory(id), /HTTP 429/);
  assert.equal(calls, 2);
  await assert.rejects(api.getSaleHistory("VJ123456"), /暂不支持/);
  assert.equal(calls, 2);
});

test("支持跨标签锁，获取锁后重新检查共享缓存", async () => {
  let calls = 0;
  let cache = null;
  let locked = false;
  const api = sandbox({
    navigator: { locks: { request: async (name, read) => {
      assert.equal(name, `dltracker-sale-history-${id}`);
      locked = true;
      cache = { saleHistory: api.extractSaleHistory(raw(), id) };
      return read();
    } } },
    getPriceRecord: async () => { assert.ok(locked); return cache; },
    gmRequestJson: async () => { calls++; return raw(); },
  });
  await api.getSaleHistory(id);
  assert.equal(calls, 0);
});

test("只存历史的记录日后补价不会变NaN，也不覆盖收藏状态", async () => {
  let record = { rjCode: id, saleHistory: { version: 1 }, isFavorite: true };
  const api = sandbox({
    getPriceRecord: async () => record,
    storePut: async (_store, value) => { record = value; },
    STORE_PRICES: "prices", nowIso: () => "2026-11-16",
  });
  await api.upsertPriceRecord({ rjCode: id, lowestPrice: 500 });
  assert.equal(record.lowestPrice, 500);
  assert.equal(record.isFavorite, true);
  await api.upsertPriceRecord({ rjCode: id, saleHistory: { version: 1, annualDays: 0 } });
  assert.equal(record.lowestPrice, 500);
});

test("各入口使用可点击按钮，正常史低和已购补价都会保存历史", () => {
  assert.match(functionSource("renderBrowseCardAnalysis"), /onActivate: \(\) => openSaleHistoryDialog\(id, record\)/);
  assert.match(functionSource("renderCartDealLayout"), /onActivate: \(\) => openSaleHistoryDialog/);
  assert.match(functionSource("renderPriceCard"), /chip\.type = "button"[\s\S]*openSaleHistoryDialog/);
  assert.match(functionSource("fetchPriceFromDlwatcher"), /saleHistory: extractSaleHistory/);
  assert.match(functionSource("persistPurchasedLowest"), /input\.saleHistory = item\.saleHistory/);
  assert.match(functionSource("renderSaleHistory"), /不代表全年次数/);
  assert.match(functionSource("openSaleHistoryDialog"), /overlay\.isConnected/);
});
