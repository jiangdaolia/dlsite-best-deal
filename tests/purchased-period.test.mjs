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

function constantSource(name) {
  const result = source.match(new RegExp(`  const ${name} =[\\s\\S]*?;\\n`));
  if (!result) throw new Error(`${name} not found`);
  return result[0].trimEnd();
}

// ---- 最小 DOM 桩：只实现被测函数用到的选择器 ----
function makeSelect({ name = "", id = "", value = "", options = [] } = {}) {
  return {
    getAttribute: (attr) => (attr === "name" ? name || null : attr === "id" ? id || null : null),
    value,
    options: options.map((option) => ({
      value: option.value,
      textContent: option.label,
      selected: Boolean(option.selected),
    })),
    querySelectorAll: () => [],
  };
}

function makeLink({ text, href, className = "" }) {
  return {
    textContent: text,
    className,
    getAttribute: (attr) => (attr === "href" ? href : null),
  };
}

function makePageDoc({ selects = [], links = [], ids = [] } = {}) {
  return {
    ids,
    querySelectorAll(selector) {
      if (selector === "select") return selects;
      if (selector === "a[href]") return links;
      if (selector === 'a[href*="userbuy"]') return links;
      return [];
    },
  };
}

function makeSandbox() {
  const sandbox = { console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(`
    var location = { origin: "https://www.dlsite.com", href: "https://www.dlsite.com/maniax/mypage/userbuy" };
    function currentDlsiteSection() { return "maniax"; }
    const PURCHASED_FILTER_PATH_RE = ${constantSource("PURCHASED_FILTER_PATH_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_PERIOD_FIELD_RE = ${constantSource("PURCHASED_PERIOD_FIELD_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_PERIOD_LABEL_RE = ${constantSource("PURCHASED_PERIOD_LABEL_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_ALL_PERIOD_TEXT_RE = ${constantSource("PURCHASED_ALL_PERIOD_TEXT_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    ${functionSource("isPurchasedWorksPage")}
    ${functionSource("purchasedPageIsUnfiltered")}
    ${functionSource("purchasedPageBaseUrl")}
    ${functionSource("purchasedPeriodFilterLabel")}
    ${functionSource("purchasedAllPeriodUrl")}
    globalThis.unfilteredForTest = purchasedPageIsUnfiltered;
    globalThis.baseUrlForTest = purchasedPageBaseUrl;
    globalThis.periodLabelForTest = purchasedPeriodFilterLabel;
    globalThis.allPeriodUrlForTest = purchasedAllPeriodUrl;
  `, sandbox);
  return sandbox;
}

test("带月份筛选的已购页地址不算「未筛选」（筛选在路径段里，不在查询串里）", () => {
  const sandbox = makeSandbox();
  const isUnfiltered = sandbox.unfilteredForTest;
  // 用户遇到的地址：只看 2026 年 10 月，页面只有 3 部。
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/mypage/userbuy/=/year/2026/month/10/"), false);
  // 裸地址与仅尾斜杠才算全量。
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/mypage/userbuy"), true);
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/mypage/userbuy/"), true);
  // 查询串、锚点、页码都是筛选的另一种写法。
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/mypage/userbuy?page=2"), false);
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/mypage/userbuy#top"), false);
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/mypage/userbuy/=/page/2/"), false);
  // 不是已购买页。
  assert.equal(isUnfiltered("https://www.dlsite.com/maniax/"), false);
});

test("读取账号信息一律从未筛选的已购页开始，不继承当前筛选", () => {
  const sandbox = makeSandbox();
  assert.equal(
    sandbox.baseUrlForTest(),
    "https://www.dlsite.com/maniax/mypage/userbuy",
  );
});

test("能认出页面停在某个月，也不会把排序下拉当成月份筛选", () => {
  const sandbox = makeSandbox();
  const monthSelect = makeSelect({
    name: "month",
    value: "10",
    options: [
      { value: "", label: "全期間" },
      { value: "10", label: "2026年10月", selected: true },
    ],
  });
  const sortSelect = makeSelect({
    name: "sort",
    value: "new",
    options: [{ value: "new", label: "新しい順", selected: true }],
  });
  assert.equal(
    sandbox.periodLabelForTest(makePageDoc({ selects: [sortSelect, monthSelect] })),
    "2026年10月",
  );
  // 只有排序下拉：不是月份筛选。
  assert.equal(sandbox.periodLabelForTest(makePageDoc({ selects: [sortSelect] })), "");
  // 月份下拉停在「全期間」：不是筛选。
  const allSelect = makeSelect({
    name: "month",
    value: "",
    options: [
      { value: "", label: "全期間", selected: true },
      { value: "10", label: "2026年10月" },
    ],
  });
  assert.equal(sandbox.periodLabelForTest(makePageDoc({ selects: [allSelect] })), "");
});

test("能找到「全期間」链接，带年月的筛选链接不算", () => {
  const sandbox = makeSandbox();
  const base = "https://www.dlsite.com/maniax/mypage/userbuy/=/year/2026/month/10/";
  const doc = makePageDoc({
    links: [
      makeLink({
        text: "2026年9月",
        href: "/maniax/mypage/userbuy/=/year/2026/month/09/",
        className: "is-active",
      }),
      makeLink({ text: "全期間", href: "/maniax/mypage/userbuy/" }),
    ],
  });
  assert.equal(
    sandbox.allPeriodUrlForTest(doc, base),
    "https://www.dlsite.com/maniax/mypage/userbuy/",
  );
  // 只有月份链接时返回空，调用方不会乱跳。
  assert.equal(
    sandbox.allPeriodUrlForTest(
      makePageDoc({ links: [makeLink({ text: "2026年9月", href: "/maniax/mypage/userbuy/=/year/2026/month/09/" })] }),
      base,
    ),
    "",
  );
});

// ---- fetchBoughtPageSnapshot：第一页若停在某个月，改读「全期間」 ----
function makeSnapshotSandbox(pagesByUrl) {
  const sandbox = {
    console, URL, setTimeout, clearTimeout, pagesByUrl, FormData, URLSearchParams,
  };
  vm.runInNewContext(`
    var location = { origin: "https://www.dlsite.com", href: "https://www.dlsite.com/maniax/mypage/userbuy" };
    function currentDlsiteSection() { return "maniax"; }
    function purchasedMoreControl() { return null; }
    function pageFilterSummary() { return []; }
    function purchasedPageTotalText(doc) { return doc.totalText || ""; }
    function purchasedPageIds(doc) { return doc.ids || []; }
    function expandPurchasedListFully() { return { clicks: 0, rows: 0, stopped: "" }; }
    // 用「URL 当查表键」代替真正的 HTML 解析，测试只关心取了哪一页。
    class DOMParser { parseFromString(key) { return globalThis.pagesByUrl[key]; } }
    globalThis.fetched = [];
    async function fetchSameOriginText(url) {
      globalThis.fetched.push(url);
      if (!(url in globalThis.pagesByUrl)) throw new Error("404 " + url);
      return url;
    }
    const PURCHASED_FILTER_PATH_RE = ${constantSource("PURCHASED_FILTER_PATH_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_PERIOD_FIELD_RE = ${constantSource("PURCHASED_PERIOD_FIELD_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_PERIOD_LABEL_RE = ${constantSource("PURCHASED_PERIOD_LABEL_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_ALL_PERIOD_TEXT_RE = ${constantSource("PURCHASED_ALL_PERIOD_TEXT_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    const PURCHASED_SUBMIT_TEXT_RE = ${constantSource("PURCHASED_SUBMIT_TEXT_RE").replace(/^ {2}const [A-Z_]+ = /, "")}
    ${functionSource("isPurchasedWorksPage")}
    ${functionSource("purchasedPageIsUnfiltered")}
    ${functionSource("purchasedPageBaseUrl")}
    ${functionSource("purchasedPeriodFilterLabel")}
    ${functionSource("purchasedAllPeriodUrl")}
    ${functionSource("purchasedAllPeriodFormUrl")}
    ${functionSource("purchasedUrlHasPeriodFilter")}
    ${functionSource("followAllPeriodPage")}
    ${functionSource("fetchBoughtPageSnapshot")}
    globalThis.snapshotForTest = fetchBoughtPageSnapshot;
    globalThis.formUrlForTest = purchasedAllPeriodFormUrl;
  `, sandbox);
  return sandbox;
}

function monthSelect() {
  return makeSelect({
    name: "month",
    value: "10",
    options: [{ value: "10", label: "2026年10月", selected: true }],
  });
}

test("页面停在 10 月时自动改读「全期間」，不会只拿到当月 3 部", async () => {
  const filtered = makePageDoc({
    selects: [monthSelect()],
    links: [makeLink({ text: "全期間", href: "/maniax/mypage/userbuy/" })],
    ids: ["RJ00000001", "RJ00000002", "RJ00000003"],
  });
  filtered.totalText = "全 3 件";
  const all = makePageDoc({
    selects: [],
    links: [],
    ids: ["RJ00000001", "RJ00000002", "RJ00000003", "RJ00000004", "RJ00000005"],
  });
  all.totalText = "全 39 件";
  const pagesByUrl = {
    "https://www.dlsite.com/maniax/mypage/userbuy": filtered,
    "https://www.dlsite.com/maniax/mypage/userbuy/": all,
  };
  const sandbox = makeSnapshotSandbox(pagesByUrl);
  const snapshot = await sandbox.snapshotForTest({});
  assert.deepEqual([...snapshot.ids], [
    "RJ00000001", "RJ00000002", "RJ00000003", "RJ00000004", "RJ00000005",
  ]);
  assert.equal(snapshot.followedAllPeriod, true);
  assert.equal(snapshot.periodFiltered, false);
  // 总数要取「全期間」那一页的，不能留当月那页写的「全 3 件」。
  assert.equal(snapshot.totalText, "全 39 件");
  assert.deepEqual([...sandbox.fetched], [
    "https://www.dlsite.com/maniax/mypage/userbuy",
    "https://www.dlsite.com/maniax/mypage/userbuy/",
  ]);
});

test("找不到「全期間」时如实标出页面停在某个月，交给调用方兜底", async () => {
  const filtered = makePageDoc({
    selects: [monthSelect()],
    links: [],
    ids: ["RJ00000001", "RJ00000002", "RJ00000003"],
  });
  const sandbox = makeSnapshotSandbox({
    "https://www.dlsite.com/maniax/mypage/userbuy": filtered,
  });
  const snapshot = await sandbox.snapshotForTest({});
  assert.equal(snapshot.ids.length, 3);
  assert.equal(snapshot.followedAllPeriod, false);
  assert.equal(snapshot.periodFiltered, true);
  assert.equal(snapshot.periodLabel, "2026年10月");
});

// ---- 「切到全部后还要点一次显示」：把那次提交的地址算出来 ----
function makeFilterForm() {
  const monthSelectEl = makeSelect({
    name: "month",
    value: "10",
    options: [
      { value: "", label: "全期間", selected: false },
      { value: "10", label: "2026年10月", selected: true },
    ],
  });
  const submitter = {
    name: "go",
    value: "表示",
    textContent: "表示",
    formAction: "https://www.dlsite.com/maniax/mypage/userbuy/",
  };
  const form = {
    method: "get",
    action: "https://www.dlsite.com/maniax/mypage/userbuy/",
    getAttribute: () => "https://www.dlsite.com/maniax/mypage/userbuy/",
    querySelectorAll: (selector) => (selector.includes("submit") ? [submitter] : []),
    // 提交时浏览器会带上：当前月份（可能被改成全期間）+ 其它隐藏字段。
    fields: { month: () => monthSelectEl.value, type: "all" },
  };
  monthSelectEl.form = form;
  monthSelectEl.closest = () => form;
  return { monthSelectEl, form, submitter };
}

test("切到「全部」后要再点「显示」：算出提交地址给脚本去抓", () => {
  const sandbox = makeSnapshotSandbox({});
  // 用能读到 DOM 当前值的 FormData 桩替掉真的 FormData。
  vm.runInNewContext(`
    class FakeFormData {
      constructor(form) {
        this.list = Object.entries(form.fields).map(([key, value]) => [
          key, typeof value === "function" ? value() : value,
        ]);
      }
      entries() { return this.list[Symbol.iterator](); }
    }
    globalThis.FormData = FakeFormData;
  `, sandbox);
  const { monthSelectEl } = makeFilterForm();
  const doc = makePageDoc({ selects: [monthSelectEl], links: [], ids: ["RJ00000001"] });
  // 月份被这次「提交」清空，其它字段保留 → 等于点了「显示」。
  assert.equal(
    sandbox.formUrlForTest(doc),
    "https://www.dlsite.com/maniax/mypage/userbuy/?type=all",
  );
  // 算完必须把下拉还原，不能让用户看到「全期間」但列表没变。
  assert.equal(monthSelectEl.value, "10");
});

test("没有「全期間」链接时也能靠表单提交拿到全量", async () => {
  const { monthSelectEl } = makeFilterForm();
  const filtered = makePageDoc({
    selects: [monthSelectEl],
    links: [],
    ids: ["RJ00000001", "RJ00000002", "RJ00000003"],
  });
  filtered.totalText = "全 3 件";
  const all = makePageDoc({ selects: [], links: [], ids: ["RJ00000001", "RJ00000004"] });
  all.totalText = "全 39 件";
  const allUrl = "https://www.dlsite.com/maniax/mypage/userbuy/?type=all";
  const sandbox = makeSnapshotSandbox({
    "https://www.dlsite.com/maniax/mypage/userbuy": filtered,
    [allUrl]: all,
  });
  vm.runInNewContext(`
    class FakeFormData {
      constructor(form) {
        this.list = Object.entries(form.fields).map(([key, value]) => [
          key, typeof value === "function" ? value() : value,
        ]);
      }
      entries() { return this.list[Symbol.iterator](); }
    }
    globalThis.FormData = FakeFormData;
  `, sandbox);
  const snapshot = await sandbox.snapshotForTest({});
  assert.equal(snapshot.followedAllPeriod, true);
  assert.equal(snapshot.periodFiltered, false);
  assert.deepEqual([...snapshot.ids], ["RJ00000001", "RJ00000004"]);
  assert.equal(snapshot.totalText, "全 39 件");
});
