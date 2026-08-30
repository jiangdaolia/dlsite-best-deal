import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../userscript/dl-price-tracker.user.js", import.meta.url),
  "utf8",
);
const matched = source.match(
  /\/\/ <language-account-core>([\s\S]*?)\/\/ <\/language-account-core>/,
);
if (!matched) throw new Error("language account core markers not found");

function functionSource(name) {
  const result = source.match(new RegExp(
    `  (?:async )?function ${name}\\([\\s\\S]*?(?=\\n  (?:async )?function )`,
  ));
  if (!result) throw new Error(`${name} not found`);
  return result[0];
}

const sandbox = {
  URL,
  dealPlainText(value) {
    return String(value || "").replace(/<[^>]+>/g, " ").trim();
  },
  dealNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  dealTokens(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(sandbox.dealTokens);
    if (typeof value === "object") return Object.values(value).flatMap(sandbox.dealTokens);
    return [String(value)];
  },
  isValidProductCode(value) {
    return /^[RBV]J\d{6,}$/i.test(String(value || ""));
  },
};

vm.runInNewContext(
  `${matched[1]}
  ${functionSource("sortLanguageComparisonRows")}
  ${functionSource("languageWinnerRows")}
  globalThis.languageEditionCore = {
    normalizedLanguageCode,
    languageDisplayName,
    productLanguageIdentity,
    cartSkuFromSignals,
    accountEntryFromProduct,
    cartIdsFromMemberStatus,
    languageEditionsFromDocument,
    sortLanguageComparisonRows,
    languageWinnerRows,
  };`,
  sandbox,
);

const {
  languageDisplayName,
  productLanguageIdentity,
  cartSkuFromSignals,
  accountEntryFromProduct,
  cartIdsFromMemberStatus,
  languageEditionsFromDocument,
  sortLanguageComparisonRows,
  languageWinnerRows,
} = sandbox.languageEditionCore;

test("翻译子 SKU 归并到语言母作品与日文原作家族", () => {
  const product = {
    id: "RJ01094726",
    translationInfo: {
      is_child: true,
      original_workno: "RJ01076373",
      parent_workno: "RJ01089295",
      lang: "CHI_HANS",
    },
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(productLanguageIdentity(product))),
    {
      id: "RJ01094726",
      parentId: "RJ01089295",
      familyId: "RJ01076373",
      lang: "CHI_HANS",
    },
  );
  assert.equal(accountEntryFromProduct(product.id, product).language, "简体中文");
});

test("语言选择器一次给出父编号、中文语言名和 DLsite 顺序", () => {
  const payload = JSON.stringify([
    { workno: "RJ01076373", lang: "JPN", display_label: "日本語", display_order: 1, price: 1760 },
    { workno: "RJ01089295", lang: "CHI_HANS", display_label: "简体中文", display_order: 5, price: 1540 },
  ]);
  const doc = {
    querySelector() {
      return { getAttribute: () => payload };
    },
  };
  const editions = languageEditionsFromDocument(doc);
  assert.equal(editions.length, 2);
  assert.equal(editions[0].language, "日语");
  assert.equal(editions[1].language, "简体中文");
  assert.equal(editions[1].parentId, "RJ01089295");
  assert.equal(editions[1].displayOrder, 5);
});

test("官方账号状态按 status 区分立即购买与稍后再买", () => {
  const result = cartIdsFromMemberStatus({
    cart: [
      { product_id: "RJ01094726", status: 1 },
      { product_id: "RJ01111460", status: 2 },
      { product_id: "bad", status: 1 },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    active: ["RJ01094726"],
    later: ["RJ01111460"],
  });
});

test("未知语言使用官方标签，已知语言统一显示中文", () => {
  assert.equal(languageDisplayName("KO_KR", "한국어"), "韩语");
  assert.equal(languageDisplayName("NEW_LANG", "测试语言"), "测试语言");
});

test("购物车操作优先识别实际翻译 SKU，不把语言母作品当成同一商品", () => {
  assert.equal(cartSkuFromSignals({
    detailHref: "/girls/work/=/product_id/RJ01089295.html/?translation=RJ01094726",
    dataWorkno: "RJ01089295",
  }), "RJ01094726");
  assert.equal(cartSkuFromSignals({
    actionHref: "/girls/cart/delete?product_id=RJ01111460",
    detailHref: "/girls/work/=/product_id/RJ01089295.html/?translation=RJ01094726",
  }), "RJ01111460");
  assert.equal(cartSkuFromSignals({
    detailHref: "/girls/work/=/product_id/RJ01089295.html",
  }), "RJ01089295");
});

test("当前语言固定第一行，最优惠按理论日元价允许并列", () => {
  const rows = [
    { parentId: "RJ00000001", current: false, theoreticalPrice: 120, displayOrder: 1, stopped: false },
    { parentId: "RJ00000002", current: true, theoreticalPrice: 200, displayOrder: 5, stopped: false },
    { parentId: "RJ00000003", current: false, theoreticalPrice: 120, displayOrder: 3, stopped: false },
  ];
  const sorted = sortLanguageComparisonRows(rows);
  assert.equal(sorted[0].parentId, "RJ00000002");
  assert.deepEqual(
    JSON.parse(JSON.stringify(languageWinnerRows(rows).map((row) => row.parentId))),
    ["RJ00000001", "RJ00000003"],
  );
});

test("语言比较使用七列表、账号冷却与官方单件购物车请求", () => {
  assert.match(source, /"语言", "作品", "人民币\/日元", "现在\/平台\/史低", "备注", "看详情", "购物车"/);
  assert.match(source, /ACCOUNT_REFRESH_COOLDOWN_MS = 60 \* 1000/);
  assert.match(source, /loaded: true,[\s\S]*?total: ids\.length,[\s\S]*?refreshAccountInformationPanels\(\);[\s\S]*?for \(let start = 0; start < ids\.length/);
  assert.match(source, /\["状态", index\.loaded \? "正在重新读取…" : "正在读取购物车和已购清单…"\]/);
  assert.match(source, /\["状态", `读取失败：\$\{accountIndexRuntimeError\}`\]/);
  assert.match(source, /mode: "cart"[\s\S]*obj_nocheck: "1"[\s\S]*product_id:/);
  assert.match(source, /a\.link_delete/);
  assert.match(source, /a\.link_move_cart/);
  assert.match(source, /concreteCartProductId\(item\) === target/);
  assert.match(source, /确认从购物车永久移出【\$\{row\.language\}】版本吗/);
  assert.match(source, /saveLanguageDialogRestoreState\(openLanguageDialogState\);\s*location\.reload\(\)/);
  assert.match(source, /await restoreLanguageDialogAfterReload\(\{ deferRender: true \}\);\s*await bootstrap\(\)/);
  assert.match(source, /const initialRender = !state\.rows\.length \|\| !body\.firstElementChild;\s*if \(initialRender\) body\.textContent/);
  assert.match(source, /button\.style\.inlineSize = `\$\{rect\.width\}px`;\s*button\.style\.blockSize = `\$\{rect\.height\}px`;/);
  assert.match(source, /entry\.style\.marginInlineStart = `\$\{Math\.max\(0, rect\.left - contentLeft\)\}px`;/);
  assert.match(source, /mobileText \? "is-mobile-text" : "is-desktop-button"/);
  assert.match(source, /nativeHost\.insertBefore\(entry, nativeAction\)/);
  assert.doesNotMatch(source, /nativeHost\.parentElement\.insertBefore\(entry, nativeHost\)/);
  assert.doesNotMatch(source, /\.dltracker-language-entry-cart\.is-desktop-button\s*\{\s*width:\s*100%/);
  assert.match(source, /\.dltracker-language-entry-cart\.is-mobile-text \.dltracker-language-entry-button,[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(source, /读取购物车和已购清单（请勿频繁读取）/);
});
