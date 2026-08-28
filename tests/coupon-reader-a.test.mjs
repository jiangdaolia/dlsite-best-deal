import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../userscript/dlsite-coupon-reader.user.js", import.meta.url),
  "utf8",
);

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.className = "";
    this.id = "";
    this.textContent = "";
    this.innerText = "";
    this.style = {};
    this.disabled = false;
    this.listeners = new Map();
    this.classList = {
      add: (...names) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) current.add(name);
        this.className = [...current].join(" ");
      },
      [Symbol.iterator]: function* iterator() {},
    };
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  prepend(child) {
    this.children.unshift(child);
    child.parentElement = this;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(
      (child) => child !== this,
    );
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  querySelectorAll() {
    return [];
  }

  click() {
    this.listeners.get("click")?.();
  }

  select() {}

  setSelectionRange() {}
}

function walk(root) {
  return [root, ...root.children.flatMap(walk)];
}

function makeHarness({
  status = 200,
  payload = [],
  bodyText = null,
  contentType = "application/json; charset=utf-8",
} = {}) {
  const body = new FakeElement("body");
  const head = new FakeElement("head");
  const documentElement = new FakeElement("html");
  documentElement.lang = "zh-cn";
  const document = {
    body,
    head,
    documentElement,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) =>
      [...walk(body), ...walk(head)].find((node) => node.id === id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    execCommand: () => true,
  };

  let fetchCount = 0;
  let copiedText = "";
  const fetch = async (url) => {
    fetchCount += 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      redirected: false,
      url: String(url),
      headers: { get: () => contentType },
      text: async () => bodyText ?? JSON.stringify(payload),
    };
  };

  const location = {
    href: "https://www.dlsite.com/maniax/mypage/coupon/list",
    origin: "https://www.dlsite.com",
    reload() {},
  };
  class FakeDOMParser {
    parseFromString(html) {
      const parsedBody = new FakeElement("body");
      parsedBody.outerHTML = html;
      parsedBody.innerHTML = html;
      parsedBody.textContent = html.replace(/<[^>]+>/g, " ");
      parsedBody.innerText = parsedBody.textContent;
      return {
        body: parsedBody,
        documentElement: parsedBody,
        querySelectorAll: () => [],
      };
    }
  }
  const context = {
    AbortController,
    Blob,
    DOMException,
    DOMParser: FakeDOMParser,
    TextEncoder,
    URL,
    WeakSet,
    clearTimeout,
    console,
    document,
    fetch,
    location,
    navigator: {
      language: "zh-CN",
      userAgent: "Via test harness",
      clipboard: {
        writeText: async (text) => {
          copiedText = text;
        },
      },
    },
    performance,
    setTimeout,
    window: { confirm: () => true },
  };

  return {
    context,
    get fetchCount() {
      return fetchCount;
    },
    get copiedText() {
      return copiedText;
    },
    nodes: () => walk(body),
  };
}

async function runHarness(harness) {
  vm.runInNewContext(source, harness.context, {
    filename: "dlsite-coupon-reader.user.js",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("即使响应头误写 text/html，也会按正文识别 JSON 且只请求一次", async () => {
  const harness = makeHarness({
    contentType: "text/html; charset=UTF-8",
    payload: [
      {
        coupon_id: "REAL-1",
        coupon_name: "测试券",
        discount_type: "rate",
        discount: 20,
        conditions: { product_all: ["RJ123456"] },
      },
    ],
  });

  await runHarness(harness);

  assert.equal(harness.fetchCount, 1);
  const status = harness.nodes().find((node) =>
    node.className.includes("dlcr-status"),
  );
  assert.match(status.textContent, /接口识别到 1 张/);
  const requestFact = harness.nodes().find((node) => node.textContent === "1 / 1");
  assert.ok(requestFact);
});

test("HTTP 风控错误会停止且不会自动重试", async () => {
  const harness = makeHarness({ status: 429, payload: { error: "rate limit" } });

  await runHarness(harness);

  assert.equal(harness.fetchCount, 1);
  const status = harness.nodes().find((node) =>
    node.className.includes("dlcr-status"),
  );
  assert.match(status.textContent, /风控状态/);
  assert.match(status.textContent, /不会自动重试/);
});

test("诊断导出移除认证和账号字段但保留真实优惠券 ID", async () => {
  const harness = makeHarness({
    payload: [
      {
        coupon_id: "REAL-COUPON-ID",
        coupon_name: "20% OFF",
        email: "person@example.com",
        cookie: "secret-cookie",
        authorization: "Bearer secret",
        user: { id: "member-1", name: "某用户" },
        conditions: { product_all: ["RJ123456", "RJ654321"] },
      },
    ],
  });

  await runHarness(harness);
  const copyButton = harness.nodes().find(
    (node) => node.textContent === "复制诊断 JSON",
  );
  assert.equal(copyButton.disabled, false);
  copyButton.click();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const exported = JSON.parse(harness.copiedText);
  assert.equal(exported.rawPayload[0].coupon_id, "REAL-COUPON-ID");
  assert.equal(exported.rawPayload[0].coupon_name, "20% OFF");
  assert.equal(exported.rawPayload[0].email, "[已移除]");
  assert.equal(exported.rawPayload[0].cookie, "[已移除]");
  assert.equal(exported.rawPayload[0].authorization, "[已移除]");
  assert.equal(exported.rawPayload[0].user, "[已移除]");
  assert.deepEqual(
    exported.rawPayload[0].conditions.product_all,
    ["RJ123456", "RJ654321"],
  );
});

test("200 HTML 优惠券片段会被本地分析而不是误判成退出登录", async () => {
  const harness = makeHarness({
    contentType: "text/html; charset=UTF-8",
    bodyText:
      '<body><section class="coupon-list">coupon REAL-2 person@example.com</section></body>',
  });

  await runHarness(harness);

  assert.equal(harness.fetchCount, 1);
  const status = harness.nodes().find((node) =>
    node.className.includes("dlcr-status"),
  );
  assert.match(status.textContent, /正常 HTML 片段/);
  assert.doesNotMatch(status.textContent, /退出登录/);

  const copyButton = harness.nodes().find(
    (node) => node.textContent === "复制诊断 JSON",
  );
  copyButton.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const exported = JSON.parse(harness.copiedText);
  assert.equal(exported.analysis.responseKind, "html");
  assert.equal(exported.error, null);
  assert.match(exported.rawPayload.sanitizedHtml, /REAL-2/);
  assert.doesNotMatch(exported.rawPayload.sanitizedHtml, /person@example\.com/);
});
