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

const headerOf = (name) => {
  const result = source.match(new RegExp(`^// @${name}\\s+(\\S+)$`, "m"));
  assert.ok(result, `@${name} 不存在`);
  return result[1];
};

// v0.6.89/v0.6.90 踩过的坑：把 @updateURL 钉成 @v0.6.90 之后，脚本里记的
// 更新地址永远指向那一版自己，检查更新只会看到同一版本，之后再也收不到新版。
test("更新地址必须是会移动的 @latest，不能钉死版本 tag", () => {
  const updateUrl = headerOf("updateURL");
  const downloadUrl = headerOf("downloadURL");
  assert.match(updateUrl, /^https:\/\/cdn\.jsdelivr\.net\/gh\/jiangdaolia\/dlsite-best-deal@latest\//);
  assert.match(downloadUrl, /^https:\/\/cdn\.jsdelivr\.net\/gh\/jiangdaolia\/dlsite-best-deal@latest\//);
  // 固定 tag（@v1.2.3）和分支引用（@main）都不行：前者自我锁定，后者缓存不刷新。
  for (const url of [updateUrl, downloadUrl]) {
    assert.doesNotMatch(url, /@v\d+\.\d+\.\d+\//);
    assert.doesNotMatch(url, /@main\//);
  }
});

test("脚本版本号三处保持一致", () => {
  const version = headerOf("version");
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(source, new RegExp(`const APP_VERSION = "${version.replace(/\./g, "\\.")}";`));
  assert.match(source, new RegExp(`^    "${version.replace(/\./g, "\\.")}": \\[$`, "m"));
});

// 自检提示里的安装链接必须钉到具体版本：@latest 会命中 tag 解析缓存，
// 用户点「去更新」有可能又装回旧版；@vX.Y.Z 一定取到那一版。
test("自检提示的安装链接钉到具体版本，版本比较按数字逐段比", () => {
  const sandbox = { console: { warn() {} } };
  vm.runInNewContext(
    `
    const UPDATE_REPO = "jiangdaolia/dlsite-best-deal";
    ${functionSource("versionTuple")}
    ${functionSource("versionIsNewer")}
    ${functionSource("updateInstallUrl")}
    globalThis.versionIsNewer = versionIsNewer;
    globalThis.updateInstallUrl = updateInstallUrl;`,
    sandbox,
  );
  const newer = sandbox.versionIsNewer;
  assert.equal(newer("0.6.92", "0.6.91"), true);
  assert.equal(newer("0.6.100", "0.6.99"), true);
  assert.equal(newer("v0.7.0", "0.6.92"), true);
  assert.equal(newer("0.6.91", "0.6.92"), false);
  assert.equal(newer("0.6.92", "0.6.92"), false);
  assert.equal(newer("", "0.6.92"), false);

  const url = sandbox.updateInstallUrl("0.6.92");
  assert.equal(
    url,
    "https://cdn.jsdelivr.net/gh/jiangdaolia/dlsite-best-deal@v0.6.92/userscript/dl-price-tracker.user.js",
  );
  assert.doesNotMatch(url, /@latest/);
});
