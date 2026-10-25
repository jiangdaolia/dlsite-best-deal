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

function makeSandbox(extra = "") {
  const sandbox = {
    console,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
  vm.runInNewContext(`
    ${constantSource("PURCHASED_MORE_TEXT_RE")}
    ${constantSource("PURCHASED_EXPAND_MAX_CLICKS")}
    ${constantSource("PURCHASED_EXPAND_STEP_TIMEOUT_MS")}
    ${constantSource("PURCHASED_EXPAND_TOTAL_TIMEOUT_MS")}
    ${constantSource("PURCHASED_TOOLBAR_CLASSNAME")}
    ${functionSource("purchasedPriceTable")}
    ${functionSource("purchasedMoreControl")}
    ${functionSource("purchasedVisibleRowCount")}
    ${functionSource("waitForPurchasedRows")}
    ${functionSource("expandPurchasedListFully")}
    globalThis.expandForTest = expandPurchasedListFully;
    globalThis.moreControlForTest = purchasedMoreControl;
    ${extra}
  `, sandbox);
  return sandbox;
}

class FakeMouseEvent {
  constructor(type, init) {
    this.type = type;
    this.bubbles = Boolean(init?.bubbles);
    this.cancelable = Boolean(init?.cancelable);
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

// 模拟一种「もっと見る」按钮：每点一次追加 batch 行，到 maxRows 后不再增长。
function makeDoc({ initial = 2, batch = 2, maxRows = 6 } = {}) {
  const rows = Array.from({ length: initial }, (_, index) => ({ id: index }));
  const events = [];
  const more = {
    textContent: "もっと見る",
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    dispatchEvent(event) {
      events.push(event);
      if (rows.length < maxRows) {
        for (let i = 0; i < batch && rows.length < maxRows; i += 1) {
          rows.push({ id: rows.length });
        }
      }
      return true;
    },
  };
  const doc = {
    defaultView: { MouseEvent: FakeMouseEvent },
    querySelectorAll(selector) {
      if (selector === "a, button") return rows.length < maxRows ? [more] : [];
      if (selector === 'a[href*="product_id/"]') return rows;
      return [];
    },
  };
  return { doc, rows, events, more };
}

test("购买历史会一直点「もっと見る」直到没有新行", async () => {
  const sandbox = makeSandbox();
  const { doc, rows, events } = makeDoc({ initial: 2, batch: 2, maxRows: 6 });
  const progress = [];
  const result = await sandbox.expandForTest(doc, {
    onProgress: (clicks, count) => progress.push([clicks, count]),
  });
  assert.equal(rows.length, 6);
  assert.equal(result.rows, 6);
  assert.equal(result.clicks, 2);
  assert.deepEqual(progress, [[1, 4], [2, 6]]);
});

test("点击时先 preventDefault，链到下一页的链接不会把整页带走", async () => {
  const sandbox = makeSandbox();
  const { doc, events } = makeDoc({ initial: 1, batch: 1, maxRows: 3 });
  await sandbox.expandForTest(doc);
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.defaultPrevented === true));
});

test("点了没长出新行就立刻收手，不会无限点", async () => {
  const sandbox = makeSandbox();
  const stopped = {
    textContent: "もっと見る",
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    dispatchEvent: () => true,
  };
  let clicks = 0;
  const doc = {
    defaultView: { MouseEvent: FakeMouseEvent },
    querySelectorAll(selector) {
      if (selector === "a, button") return [stopped];
      if (selector === 'a[href*="product_id/"]') return [{ id: 0 }];
      return [];
    },
  };
  const original = stopped.dispatchEvent;
  stopped.dispatchEvent = (event) => {
    clicks += 1;
    return original(event);
  };
  const result = await sandbox.expandForTest(doc, { totalTimeoutMs: 800 });
  assert.equal(clicks, 1);
  assert.equal(result.stopped, "no-growth");
});

test("工具栏自己的按钮与导航里的同名链接不算「加载更多」", () => {
  const sandbox = makeSandbox();
  const toolbarButton = {
    textContent: "もっと見る",
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => ({}), // 落在工具栏里
  };
  const navLink = {
    textContent: "もっと見る",
    getAttribute: (name) => (name === "href" ? "/maniax/fsr/=/keyword/x" : null),
    hasAttribute: () => false,
    closest: () => null,
  };
  const realButton = {
    textContent: "もっと見る",
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
  };
  const doc = {
    querySelectorAll: (selector) =>
      (selector === "a, button" ? [toolbarButton, navLink, realButton] : []),
  };
  assert.equal(sandbox.moreControlForTest(doc), realButton);
});
