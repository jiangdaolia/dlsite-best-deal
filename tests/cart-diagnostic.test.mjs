import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);

function functionSource(name) {
  const matched = source.match(new RegExp(
    `  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`,
  ));
  if (!matched) throw new Error(`${name} not found`);
  return matched[0];
}

test("购物车诊断元素只导出白名单属性", () => {
  const sandbox = {};
  vm.runInNewContext(
    `${functionSource("cartDiagnosticElementSummary")}
    globalThis.summary = cartDiagnosticElementSummary;`,
    sandbox,
  );
  const attributes = {
    "data-workno": "RJ123456",
    "data-price": "385",
    "data-account-id": "SECRET-ACCOUNT",
    "data-email": "person@example.com",
  };
  const result = sandbox.summary({
    tagName: "LI",
    id: "buy_later_RJ123456",
    className: "cart_list_item buy_later",
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  });
  assert.equal(result.attributes["data-workno"], "RJ123456");
  assert.equal(result.attributes["data-price"], "385");
  assert.equal(result.attributes["data-account-id"], undefined);
  assert.equal(result.attributes["data-email"], undefined);
  assert.doesNotMatch(JSON.stringify(result), /SECRET-ACCOUNT|person@example\.com/);
});

test("购物车诊断作品不导出标题或账号字段", () => {
  const sandbox = {
    dealNumber(value, fallback = 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
  vm.runInNewContext(
    `${functionSource("cartDiagnosticProduct")}
    globalThis.product = cartDiagnosticProduct;`,
    sandbox,
  );
  const result = sandbox.product({
    id: "RJ123456",
    price: 385,
    officialPrice: 770,
    bulkbuyKey: "set-key",
    title: "PRIVATE TITLE",
    accountId: "SECRET-ACCOUNT",
  });
  assert.deepEqual(Object.keys(result), [
    "id",
    "price",
    "officialPrice",
    "bulkbuyKey",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE TITLE|SECRET-ACCOUNT/);
});

test("诊断构建器不读取整页 HTML、Cookie 或请求头", () => {
  const diagnosticSource = functionSource("buildCartDiagnostic");
  assert.doesNotMatch(diagnosticSource, /outerHTML|innerHTML|document\.cookie/i);
  assert.doesNotMatch(diagnosticSource, /fetch\s*\(|GM_xmlhttpRequest/i);
});

test("微信分享使用系统文件分享面板", () => {
  const shareSource = functionSource("shareCartDiagnosticPayload");
  assert.match(shareSource, /new File\s*\(/);
  assert.match(shareSource, /files:\s*\[file\]/);
  assert.match(shareSource, /navigator\.canShare/);
  assert.match(shareSource, /navigator\.share\s*\(/);
});

test("购物车诊断面板固定悬浮在 body 右下角", () => {
  const panelSource = functionSource("injectCartDiagnosticPanel");
  assert.match(panelSource, /document\.body\s*\|\|\s*document\.documentElement/);
  assert.match(panelSource, /\.appendChild\(panel\)/);
  assert.doesNotMatch(panelSource, /insertBefore\(panel/);
  assert.match(
    source,
    /\.dltracker-cart-diagnostic\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:[\s\S]*?bottom:/,
  );
});
