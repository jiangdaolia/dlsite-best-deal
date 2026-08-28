// ==UserScript==
// @name         DLsite 优惠券读取器（验证 A 版）
// @namespace    https://github.com/jiangdaolia/dlsite-best-deal
// @version      0.2.2
// @description  读取账号优惠券，在购物车补充日元现价并按优惠力度标记可用券
// @author       Syoius & Cassandra-fox; coupon reader maintained by jiangdaolia
// @license      MIT
// @match        https://www.dlsite.com/*/mypage/coupon*
// @match        https://www.dlsite.com/mypage/coupon*
// @match        https://www.dlsite.com/*/cart*
// @match        https://www.dlsite.com/cart*
// @run-at       document-idle
// @noframes
// @grant        none
// @homepageURL  https://github.com/jiangdaolia/dlsite-best-deal
// @supportURL   https://github.com/jiangdaolia/dlsite-best-deal/issues
// @updateURL    https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dlsite-coupon-reader.user.js
// @downloadURL  https://raw.githubusercontent.com/jiangdaolia/dlsite-best-deal/main/userscript/dlsite-coupon-reader.user.js
// ==/UserScript==

(function () {
  "use strict";

  // This independent reader preserves the requested project lineage:
  // direct source: syoius/dlTracker4TamperMonkey
  // indirect source: Cassandra-fox/dlTracker
  // This script intentionally contains no price-history code and never submits orders.

  const APP_NAME = "DLsite 优惠券读取器";
  const APP_VERSION = "0.2.0";
  const ROOT_ID = "dlsite-coupon-reader-a";
  const STYLE_ID = `${ROOT_ID}-style`;
  const API_PATH = "/books/mypage/coupon/list/ajax";
  const PRODUCT_INFO_PATH = "/maniax/product/info/ajax";
  const REQUEST_TIMEOUT_MS = 30_000;
  const MAX_SCHEMA_ROWS = 300;
  const MAX_SCHEMA_DEPTH = 9;
  const MAX_SCHEMA_ARRAY_SAMPLE = 20;

  const IS_COUPON_PAGE = /\/mypage\/coupon(?:\/|[?#]|$)/i.test(location.href);
  const IS_CART_PAGE = /\/cart(?:\/|[?#]|$)/i.test(location.href);
  if (!IS_COUPON_PAGE && !IS_CART_PAGE) return;

  const startedAt = new Date().toISOString();
  const pageEvidence = IS_COUPON_PAGE
    ? collectPageCountEvidence(document)
    : { resolvedCount: null, resolution: "not-applicable", evidence: [] };
  let requestCount = 0;
  let diagnostic = null;
  let lastDiagnosticText = "";
  let ui = null;

  if (IS_COUPON_PAGE && !document.getElementById(ROOT_ID)) {
    diagnostic = makeInitialDiagnostic();
    ui = mountPanel();
    void readOnce();
  } else if (IS_CART_PAGE && !document.getElementById("dlcr-cart-status")) {
    void enhanceCartCouponMarkers();
  }

  function makeInitialDiagnostic() {
    return {
      format: "dlsite-coupon-reader-diagnostic-v1",
      script: {
        name: APP_NAME,
        version: APP_VERSION,
        stage: "B-reader",
      },
      capturedAt: null,
      environment: {
        pageUrl: sanitizeUrl(location.href),
        language: document.documentElement.lang || navigator.language || "",
        userAgent: navigator.userAgent || "",
      },
      safety: {
        sameOriginOnly: true,
        extraRequestLimit: 1,
        detailsFetched: false,
        paginationFetched: false,
        externalServicesUsed: false,
        persistedLocally: false,
        containsRealCouponIds: true,
        containsCouponRedemptionCodes: false,
      },
      pageCountEvidence: pageEvidence,
      request: {
        count: 0,
        method: "GET",
        url: sanitizeUrl(new URL(API_PATH, location.origin).href),
      },
      response: null,
      analysis: null,
      rawPayload: null,
      error: null,
    };
  }

  function mountPanel() {
    installStyles();

    const root = document.createElement("section");
    root.id = ROOT_ID;
    root.setAttribute("aria-label", APP_NAME);

    const headingRow = element("div", "dlcr-heading-row");
    const heading = element("h2", "dlcr-title", `${APP_NAME} `);
    heading.appendChild(element("span", "dlcr-badge", "B 版"));
    headingRow.appendChild(heading);
    root.appendChild(headingRow);

    const scope = element(
      "p",
      "dlcr-scope",
      "优惠券页仍只做一次同源读取与诊断；购物车页会另外批量读取当前购物车作品的条件字段。",
    );
    root.appendChild(scope);

    const status = element("div", "dlcr-status is-reading", "正在读取优惠券结构化数据……");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.appendChild(status);

    const facts = element("dl", "dlcr-facts");
    const requestFact = appendFact(facts, "本脚本请求", "0 / 1");
    const apiCountFact = appendFact(facts, "接口券数", "待读取");
    const pageCountFact = appendFact(facts, "页面券数", describePageCount(pageEvidence));
    const comparisonFact = appendFact(facts, "数量核对", "待读取");
    root.appendChild(facts);

    const warning = element(
      "p",
      "dlcr-warning",
      "注意：诊断 JSON 会移除认证信息、兑换码、邮箱和账号身份字段，但按你的选择保留真实优惠券 ID。请只在私下排错时发送，不要公开上传。",
    );
    root.appendChild(warning);

    const details = document.createElement("details");
    details.className = "dlcr-details";
    details.appendChild(element("summary", "", "字段结构摘要"));
    const schemaMeta = element("p", "dlcr-muted", "读取成功后显示字段路径、类型和安全样例。");
    details.appendChild(schemaMeta);
    const tableWrap = element("div", "dlcr-table-wrap");
    const table = element("table", "dlcr-table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["字段路径", "类型", "出现次数", "数组长度", "安全样例"]) {
      headerRow.appendChild(element("th", "", label));
    }
    thead.appendChild(headerRow);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    details.appendChild(tableWrap);
    root.appendChild(details);

    const actions = element("div", "dlcr-actions");
    const downloadButton = button("下载诊断 JSON", () => exportDiagnostic("download"));
    const copyButton = button("复制诊断 JSON", () => exportDiagnostic("copy"));
    const reloadButton = button("刷新页面重试", () => location.reload());
    reloadButton.classList.add("is-secondary");
    downloadButton.disabled = true;
    copyButton.disabled = true;
    actions.append(downloadButton, copyButton, reloadButton);
    root.appendChild(actions);

    const actionMessage = element("p", "dlcr-action-message");
    actionMessage.setAttribute("aria-live", "polite");
    root.appendChild(actionMessage);

    const host =
      document.querySelector("#main_inner, #main, main, .l-content") ||
      document.body;
    host.prepend(root);

    return {
      root,
      status,
      requestFact,
      apiCountFact,
      pageCountFact,
      comparisonFact,
      schemaMeta,
      tbody,
      downloadButton,
      copyButton,
      actionMessage,
    };
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        box-sizing: border-box;
        margin: 12px auto;
        padding: 14px;
        max-width: 1100px;
        color: #252525;
        background: #fff;
        border: 1px solid #cfd8e3;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, .08);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.55;
      }
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .dlcr-heading-row { display: flex; align-items: center; gap: 8px; }
      #${ROOT_ID} .dlcr-title { margin: 0; font-size: 19px; line-height: 1.4; }
      #${ROOT_ID} .dlcr-badge {
        display: inline-block; margin-left: 4px; padding: 2px 7px;
        color: #075985; background: #e0f2fe; border-radius: 999px;
        font-size: 12px; font-weight: 600; vertical-align: 2px;
      }
      #${ROOT_ID} .dlcr-scope { margin: 7px 0 10px; color: #475569; }
      #${ROOT_ID} .dlcr-status {
        margin: 8px 0 12px; padding: 9px 11px; border-radius: 7px;
        font-weight: 650; overflow-wrap: anywhere;
      }
      #${ROOT_ID} .dlcr-status.is-reading { color: #854d0e; background: #fef9c3; }
      #${ROOT_ID} .dlcr-status.is-success { color: #166534; background: #dcfce7; }
      #${ROOT_ID} .dlcr-status.is-partial { color: #9a3412; background: #ffedd5; }
      #${ROOT_ID} .dlcr-status.is-error { color: #991b1b; background: #fee2e2; }
      #${ROOT_ID} .dlcr-facts {
        display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px; margin: 0 0 12px;
      }
      #${ROOT_ID} .dlcr-fact { margin: 0; padding: 8px; background: #f8fafc; border-radius: 6px; }
      #${ROOT_ID} .dlcr-fact dt { color: #64748b; font-size: 12px; }
      #${ROOT_ID} .dlcr-fact dd { margin: 2px 0 0; font-weight: 650; overflow-wrap: anywhere; }
      #${ROOT_ID} .dlcr-warning {
        margin: 10px 0; padding: 9px 11px; color: #7c2d12;
        background: #fff7ed; border-left: 4px solid #fb923c;
      }
      #${ROOT_ID} .dlcr-details { margin: 10px 0; }
      #${ROOT_ID} .dlcr-details summary { cursor: pointer; font-weight: 650; }
      #${ROOT_ID} .dlcr-muted { margin: 6px 0; color: #64748b; }
      #${ROOT_ID} .dlcr-table-wrap { overflow-x: auto; max-height: 430px; border: 1px solid #e2e8f0; }
      #${ROOT_ID} .dlcr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      #${ROOT_ID} .dlcr-table th, #${ROOT_ID} .dlcr-table td {
        padding: 6px 8px; border-bottom: 1px solid #e2e8f0;
        text-align: left; vertical-align: top; overflow-wrap: anywhere;
      }
      #${ROOT_ID} .dlcr-table th { position: sticky; top: 0; background: #f1f5f9; z-index: 1; }
      #${ROOT_ID} .dlcr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${ROOT_ID} button {
        min-height: 38px; padding: 7px 12px; color: #fff; background: #0369a1;
        border: 0; border-radius: 6px; font: inherit; font-weight: 650; cursor: pointer;
      }
      #${ROOT_ID} button.is-secondary { color: #334155; background: #e2e8f0; }
      #${ROOT_ID} button:disabled { opacity: .45; cursor: not-allowed; }
      #${ROOT_ID} .dlcr-action-message { min-height: 1.4em; margin: 6px 0 0; color: #0369a1; }
      @media (max-width: 720px) {
        #${ROOT_ID} { margin: 8px; padding: 11px; }
        #${ROOT_ID} .dlcr-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        #${ROOT_ID} .dlcr-actions button { flex: 1 1 calc(50% - 4px); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  async function readOnce() {
    if (requestCount >= 1) return;
    requestCount += 1;
    diagnostic.request.count = requestCount;
    ui.requestFact.textContent = `${requestCount} / 1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const requestStarted = performance.now();

    try {
      const response = await fetch(new URL(API_PATH, location.origin), {
        method: "GET",
        credentials: "include",
        redirect: "follow",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const bodyText = await response.text();
      const elapsedMs = Math.round(performance.now() - requestStarted);
      const contentType = response.headers.get("content-type") || "";

      diagnostic.response = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        redirected: response.redirected,
        url: sanitizeUrl(response.url || diagnostic.request.url),
        contentType,
        elapsedMs,
        bodyBytes: utf8ByteLength(bodyText),
      };

      if (!response.ok) {
        const riskMessage = [403, 429].includes(response.status)
          ? "检测到风控状态，已停止且不会自动重试"
          : "接口请求失败，已停止且不会自动重试";
        throw new Error(`${riskMessage}（HTTP ${response.status}）`);
      }
      const trimmedBody = bodyText.trimStart();
      if (/^(?:\{|\[)/.test(trimmedBody)) {
        handleJsonResponse(bodyText);
      } else if (/^</.test(trimmedBody) || /text\/html/i.test(contentType)) {
        const blockReason = detectBlockingHtml(bodyText, response.url);
        if (blockReason) throw new Error(`${blockReason}，已停止且不会自动重试`);
        handleHtmlResponse(bodyText);
      } else {
        throw new Error("接口响应既不是 JSON 也不是可识别的 HTML，已停止且不会自动重试");
      }

      diagnostic.capturedAt = new Date().toISOString();
      diagnostic.error = null;
      lastDiagnosticText = JSON.stringify(diagnostic, null, 2);
      ui.downloadButton.disabled = false;
      ui.copyButton.disabled = false;
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? `请求超过 ${REQUEST_TIMEOUT_MS / 1000} 秒，已停止且不会自动重试`
          : error instanceof Error
            ? error.message
            : String(error);
      diagnostic.capturedAt = new Date().toISOString();
      diagnostic.error = {
        name: error instanceof Error ? error.name : "Error",
        message: redactString(message),
      };
      lastDiagnosticText = JSON.stringify(diagnostic, null, 2);
      setStatus(message, "error");
      ui.apiCountFact.textContent = "读取失败";
      ui.comparisonFact.textContent = "无法核对";
      ui.downloadButton.disabled = false;
      ui.copyButton.disabled = false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function handleJsonResponse(bodyText) {
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new Error("接口响应看似 JSON，但解析失败");
    }

    const schema = buildSchema(payload);
    const arrayCandidates = findArrayCandidates(payload);
    const couponCandidate = chooseCouponArrayCandidate(arrayCandidates);
    const apiCount = couponCandidate ? couponCandidate.length : null;
    const comparison = compareCounts(apiCount, pageEvidence.resolvedCount);

    diagnostic.analysis = {
      responseKind: "json",
      rootType: valueType(payload),
      apiCouponCount: apiCount,
      chosenCouponArray: couponCandidate,
      arrayCandidates,
      pageCouponCount: pageEvidence.resolvedCount,
      countComparison: comparison.code,
      schema: schema.rows,
      schemaTruncated: schema.truncated,
    };
    diagnostic.rawPayload = sanitizeForExport(payload);
    renderJsonSuccess(schema, couponCandidate, comparison);
  }

  function handleHtmlResponse(bodyText) {
    const parsed = new DOMParser().parseFromString(bodyText, "text/html");
    const htmlSummary = summarizeHtmlDocument(parsed);
    const responseCountEvidence = collectPageCountEvidence(parsed);
    const apiCount = responseCountEvidence.resolvedCount;
    const comparison = compareCounts(apiCount, pageEvidence.resolvedCount);
    const schema = buildHtmlSchema(htmlSummary);

    diagnostic.analysis = {
      responseKind: "html",
      rootType: "html-document",
      apiCouponCount: apiCount,
      pageCouponCount: pageEvidence.resolvedCount,
      countComparison: comparison.code,
      responseCountEvidence,
      htmlSummary,
      schema: schema.rows,
      schemaTruncated: schema.truncated,
    };
    diagnostic.rawPayload = {
      responseKind: "html",
      sanitizedHtml: sanitizeHtmlDocument(parsed),
    };
    renderHtmlSuccess(schema, apiCount, comparison);
  }

  function renderJsonSuccess(schema, couponCandidate, comparison) {
    const apiCount = couponCandidate ? couponCandidate.length : null;
    ui.apiCountFact.textContent =
      apiCount === null
        ? "未可靠识别"
        : `${apiCount}（${couponCandidate.path || "$"}）`;
    ui.comparisonFact.textContent = comparison.label;

    if (apiCount === null) {
      setStatus("已收到 JSON，但无法可靠识别优惠券主数组；请导出诊断 JSON。", "partial");
    } else if (comparison.code === "equal") {
      setStatus(`读取完成：接口与页面均为 ${apiCount} 张。`, "success");
    } else if (comparison.code === "mismatch") {
      setStatus(
        `读取完成但数量不一致：接口 ${apiCount} 张，页面 ${pageEvidence.resolvedCount} 张。请导出诊断 JSON。`,
        "error",
      );
    } else {
      setStatus(
        `接口识别到 ${apiCount} 张；未能从页面可靠取得总数，请人工核对并导出诊断 JSON。`,
        "partial",
      );
    }

    renderSchemaRows(
      schema,
      `记录 ${schema.rows.length} 个 JSON 字段路径` +
        (schema.truncated ? `（已达到展示上限 ${MAX_SCHEMA_ROWS}）` : "") +
        `；结构分析只抽样数组元素，不会发起额外请求。`,
    );
  }

  function renderHtmlSuccess(schema, apiCount, comparison) {
    ui.apiCountFact.textContent =
      apiCount === null ? "HTML 中尚未可靠识别" : `${apiCount}（HTML）`;
    ui.comparisonFact.textContent = comparison.label;
    if (apiCount === null) {
      setStatus(
        "已确认接口返回正常 HTML 片段；A 版已在本地清理并记录其结构，请再次导出诊断 JSON。",
        "partial",
      );
    } else if (comparison.code === "equal") {
      setStatus(`读取完成：HTML 接口与页面均为 ${apiCount} 张。`, "success");
    } else if (comparison.code === "mismatch") {
      setStatus(
        `读取完成但数量不一致：HTML 接口 ${apiCount} 张，页面 ${pageEvidence.resolvedCount} 张。请导出诊断 JSON。`,
        "error",
      );
    } else {
      setStatus(
        `HTML 接口中识别到 ${apiCount} 张；页面总数仍需人工核对，请导出诊断 JSON。`,
        "partial",
      );
    }
    renderSchemaRows(
      schema,
      `记录 ${schema.rows.length} 个 HTML 结构项目；分析和清理全部在本地完成，不会发起额外请求。`,
    );
  }

  function renderSchemaRows(schema, metaText) {
    ui.schemaMeta.textContent = metaText;
    ui.tbody.replaceChildren();
    for (const row of schema.rows) {
      const tr = document.createElement("tr");
      for (const text of [
        row.path,
        row.types.join(" / "),
        String(row.occurrences),
        row.arrayLengths.length ? row.arrayLengths.join(", ") : "—",
        row.samples.length ? row.samples.join("；") : "—",
      ]) {
        tr.appendChild(element("td", "", text));
      }
      ui.tbody.appendChild(tr);
    }
  }

  function setStatus(message, state) {
    ui.status.className = `dlcr-status is-${state}`;
    ui.status.textContent = message;
  }

  function buildSchema(root) {
    const records = new Map();
    let truncated = false;

    function record(path, value) {
      if (!records.has(path)) {
        if (records.size >= MAX_SCHEMA_ROWS) {
          truncated = true;
          return null;
        }
        records.set(path, {
          path,
          types: new Set(),
          occurrences: 0,
          arrayLengths: new Set(),
          samples: new Set(),
        });
      }
      const item = records.get(path);
      item.types.add(valueType(value));
      item.occurrences += 1;
      if (Array.isArray(value)) item.arrayLengths.add(value.length);
      const sample = safeSchemaSample(path, value);
      if (sample && item.samples.size < 3) item.samples.add(sample);
      return item;
    }

    function visit(value, path, depth) {
      record(path, value);
      if (depth >= MAX_SCHEMA_DEPTH || records.size >= MAX_SCHEMA_ROWS) return;
      if (Array.isArray(value)) {
        const limit = Math.min(value.length, MAX_SCHEMA_ARRAY_SAMPLE);
        for (let index = 0; index < limit; index += 1) {
          visit(value[index], `${path}[]`, depth + 1);
        }
        return;
      }
      if (!isPlainObject(value)) return;
      for (const [key, child] of Object.entries(value)) {
        visit(child, path === "$" ? `$.${key}` : `${path}.${key}`, depth + 1);
        if (records.size >= MAX_SCHEMA_ROWS) break;
      }
    }

    visit(root, "$", 0);
    return {
      rows: [...records.values()].map((item) => ({
        path: item.path,
        types: [...item.types].sort(),
        occurrences: item.occurrences,
        arrayLengths: [...item.arrayLengths].sort((a, b) => a - b),
        samples: [...item.samples],
      })),
      truncated,
    };
  }

  function detectBlockingHtml(bodyText, responseUrl) {
    const sample = String(bodyText).slice(0, 300_000);
    if (/\b(?:g-recaptcha|hcaptcha|cf-chl|captcha)\b/i.test(sample)) {
      return "检测到验证码或访问验证页";
    }
    if (/<input\b[^>]*\btype=["']?password\b/i.test(sample)) {
      return "检测到登录页面，当前登录状态可能已失效";
    }
    if (/(?:不正なアクセス|アクセスが集中|机器人验证|機器人驗證|비정상적인 접근)/i.test(sample)) {
      return "检测到访问限制页面";
    }
    try {
      const path = new URL(responseUrl, location.origin).pathname;
      if (/\/(?:login|signin|auth)(?:\/|$)/i.test(path)) {
        return "请求被转到登录页面";
      }
    } catch {
      // The response URL is diagnostic metadata only; body checks above still apply.
    }
    return "";
  }

  function summarizeHtmlDocument(parsed) {
    const root = parsed.body || parsed.documentElement;
    const elements = root ? [root, ...root.querySelectorAll("*")] : [];
    const tagCounts = new Map();
    const classCounts = new Map();
    const attributeCounts = new Map();
    const ids = [];

    for (const node of elements) {
      incrementCount(tagCounts, String(node.tagName || "unknown").toLowerCase());
      for (const className of node.classList || []) incrementCount(classCounts, className);
      for (const attribute of [...(node.attributes || [])]) {
        incrementCount(attributeCounts, attribute.name);
      }
      if (node.id && ids.length < 500) {
        ids.push(
          looksPersonalDomIdentifier(node.id)
            ? "[账号相关 DOM ID 已移除]"
            : redactString(node.id),
        );
      }
    }

    const links = [];
    for (const anchor of root?.querySelectorAll?.("a[href]") || []) {
      if (links.length >= 500) break;
      links.push({
        text: redactString(normalizeWhitespace(anchor.textContent)).slice(0, 300),
        href: sanitizeUrl(anchor.getAttribute("href") || ""),
        className: String(anchor.className || "").slice(0, 300),
      });
    }

    return {
      textLength: root?.textContent?.length || 0,
      elementCount: elements.length,
      tagCounts: sortedCountEntries(tagCounts, 200),
      classCounts: sortedCountEntries(classCounts, 500),
      attributeCounts: sortedCountEntries(attributeCounts, 200),
      ids,
      links,
    };
  }

  function buildHtmlSchema(summary) {
    const rows = [
      htmlSchemaRow("$.html", "html-document", 1, `元素 ${summary.elementCount}`),
      htmlSchemaRow("$.html.text", "string", 1, `${summary.textLength} 字符（内容不展示）`),
    ];
    for (const item of summary.tagCounts) {
      rows.push(htmlSchemaRow(`$.html.tags.${item.name}`, "element", item.count, "—"));
    }
    for (const item of summary.classCounts) {
      if (rows.length >= MAX_SCHEMA_ROWS) break;
      rows.push(htmlSchemaRow(`$.html.classes.${item.name}`, "class", item.count, "—"));
    }
    for (const item of summary.attributeCounts) {
      if (rows.length >= MAX_SCHEMA_ROWS) break;
      rows.push(htmlSchemaRow(`$.html.attributes.${item.name}`, "attribute", item.count, "值已隐藏"));
    }
    return { rows, truncated: rows.length >= MAX_SCHEMA_ROWS };
  }

  function htmlSchemaRow(path, type, occurrences, sample) {
    return {
      path,
      types: [type],
      occurrences,
      arrayLengths: [],
      samples: sample === "—" ? [] : [sample],
    };
  }

  function sanitizeHtmlDocument(parsed) {
    const root = parsed.body || parsed.documentElement;
    if (!root) return "";

    for (const node of parsed.querySelectorAll(
      "script, style, noscript, iframe, object, embed, link, meta, base",
    )) {
      node.remove();
    }

    for (const node of [root, ...root.querySelectorAll("*")]) {
      const fieldMarker = [
        node.getAttribute?.("name"),
        node.getAttribute?.("id"),
        node.getAttribute?.("type"),
      ]
        .filter(Boolean)
        .join("_");
      const isCouponIdField = /coupon[^a-z0-9]*(?:id|no|code)/i.test(fieldMarker);
      const isFormValueNode = /^(?:INPUT|TEXTAREA|SELECT|OPTION)$/i.test(node.tagName || "");
      if (isFormValueNode && shouldRemoveExportField(fieldMarker, `$.html.${fieldMarker}`)) {
        node.remove();
        continue;
      }

      for (const attribute of [...(node.attributes || [])]) {
        const name = String(attribute.name || "");
        const lowerName = name.toLowerCase();
        if (
          lowerName.startsWith("on") ||
          ["src", "srcset", "poster", "integrity", "nonce"].includes(lowerName) ||
          shouldRemoveExportField(name, `$.html.attributes.${name}`)
        ) {
          node.removeAttribute(name);
          continue;
        }
        if (lowerName === "style") {
          node.removeAttribute(name);
          continue;
        }
        if (lowerName === "id" && looksPersonalDomIdentifier(attribute.value || "")) {
          node.setAttribute(name, "[账号相关 DOM ID 已移除]");
          continue;
        }
        if (lowerName === "value" && isFormValueNode && !isCouponIdField) {
          node.setAttribute(name, "[表单值已移除]");
          continue;
        }
        if (["href", "action", "formaction"].includes(lowerName)) {
          node.setAttribute(name, sanitizeUrl(attribute.value || ""));
          continue;
        }
        const redacted = redactString(attribute.value || "");
        if (redacted !== attribute.value) node.setAttribute(name, redacted);
      }
    }

    const serialized = String(root.outerHTML || root.innerHTML || "").replace(
      /<!--[\s\S]*?-->/g,
      "",
    );
    return redactString(serialized);
  }

  function incrementCount(map, key) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  }

  function sortedCountEntries(map, limit) {
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function looksPersonalDomIdentifier(value) {
    return /(?:^|[-_])(?:user|member|account|customer|profile)[-_]?(?:id[-_]?)?\d{2,}(?:$|[-_])/i.test(
      String(value || ""),
    );
  }

  function findArrayCandidates(root) {
    const found = [];
    const visited = new Set();

    function visit(value, path, depth) {
      if (depth > MAX_SCHEMA_DEPTH || value === null || typeof value !== "object") return;
      if (visited.has(value)) return;
      visited.add(value);

      if (Array.isArray(value)) {
        const sample = value.slice(0, 30);
        const elementTypes = [...new Set(sample.map(valueType))];
        const objectKeys = new Set();
        for (const item of sample) {
          if (!isPlainObject(item)) continue;
          for (const key of Object.keys(item)) objectKeys.add(key);
        }
        found.push({
          path,
          length: value.length,
          elementTypes,
          objectKeys: [...objectKeys].sort(),
          score: scoreCouponArray(path, value.length, elementTypes, objectKeys),
        });
        for (let index = 0; index < Math.min(value.length, MAX_SCHEMA_ARRAY_SAMPLE); index += 1) {
          visit(value[index], `${path}[]`, depth + 1);
        }
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        visit(child, path === "$" ? `$.${key}` : `${path}.${key}`, depth + 1);
      }
    }

    visit(root, "$", 0);
    return found.sort((a, b) => b.score - a.score || b.length - a.length);
  }

  function scoreCouponArray(path, length, elementTypes, objectKeys) {
    const lowerPath = path.toLowerCase();
    const keys = new Set([...objectKeys].map((key) => key.toLowerCase()));
    let score = 0;
    if (elementTypes.includes("object")) score += 4;
    if (path === "$" && elementTypes.includes("object")) score += 3;
    if (length === 0 && path === "$") score += 5;
    if (length === 0 && /\.(data|items?|list|values?)$/i.test(lowerPath)) score += 4;
    if (/(coupon|クーポン|优惠券|優惠券)/i.test(lowerPath)) score += 5;
    if (/(items?|list|data|values?)$/i.test(lowerPath)) score += 1;
    for (const key of [
      "coupon_id",
      "coupon_name",
      "discount",
      "discount_type",
      "condition_type",
      "conditions",
      "limit_date",
    ]) {
      if (keys.has(key)) score += 2;
    }
    return score;
  }

  function chooseCouponArrayCandidate(candidates) {
    const best = candidates[0];
    if (!best || best.score < 4 || !best.elementTypes.includes("object")) return null;
    return best;
  }

  function collectPageCountEvidence(root) {
    const evidence = [];
    const add = (source, count) => {
      const numeric = Number(count);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100_000) return;
      if (evidence.some((item) => item.source === source && item.count === numeric)) return;
      evidence.push({ source, count: numeric });
    };

    const idValues = new Set();
    for (const node of root.querySelectorAll(
      "[data-coupon-id], [data-coupon_id], input[name*='coupon_id'], a[href*='coupon_id']",
    )) {
      const candidates = [
        node.getAttribute("data-coupon-id"),
        node.getAttribute("data-coupon_id"),
        node.getAttribute("value"),
      ];
      const href = node.getAttribute("href") || "";
      const hrefMatch = href.match(/coupon[_-]?id(?:=|\/)([^&#/?]+)/i);
      if (hrefMatch) candidates.push(hrefMatch[1]);
      for (const value of candidates) {
        if (value && String(value).trim()) idValues.add(String(value).trim());
      }
    }
    if (idValues.size) add("DOM 中不同 coupon_id", idValues.size);

    const cardSelectors = [
      "#coupon_list > li",
      "#coupon-list > li",
      ".coupon_list > li",
      ".coupon-list > li",
      ".couponList > li",
      "[data-coupon-id]",
      "[data-coupon_id]",
    ];
    for (const selector of cardSelectors) {
      const count = root.querySelectorAll(selector).length;
      if (count) add(`选择器 ${selector}`, count);
    }

    const text = (root.body?.innerText || root.body?.textContent || "").slice(0, 2_000_000);
    const patterns = [
      /(?:利用可能|使用可能|有効|所持|保有)[^\n\d]{0,30}(?:クーポン|coupon)[^\n\d]{0,20}(\d{1,5})\s*(?:枚|件|個)?/gi,
      /(?:可用|可使用|有效|持有)[^\n\d]{0,25}(?:优惠券|優惠券)[^\n\d]{0,20}(\d{1,5})\s*(?:张|張|个|個)?/gi,
      /(?:사용 가능|유효|보유)[^\n\d]{0,25}(?:쿠폰|coupon)[^\n\d]{0,20}(\d{1,5})\s*(?:장|개)?/gi,
      /(?:クーポン|优惠券|優惠券|쿠폰)\s*[（(]?\s*(\d{1,5})\s*(?:枚|张|張|장|件|個|个)?\s*[）)]?/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        add("页面计数文字", match[1]);
        if (evidence.length > 30) break;
      }
    }

    const textCounts = uniqueNumbers(
      evidence.filter((item) => item.source === "页面计数文字").map((item) => item.count),
    );
    const idCounts = uniqueNumbers(
      evidence.filter((item) => item.source === "DOM 中不同 coupon_id").map((item) => item.count),
    );
    const cardCounts = uniqueNumbers(
      evidence.filter((item) => item.source.startsWith("选择器 ")).map((item) => item.count),
    );

    let resolvedCount = null;
    let resolution = "not-found";
    if (textCounts.length === 1) {
      resolvedCount = textCounts[0];
      resolution = "declared-text";
    } else if (textCounts.length > 1) {
      resolution = "conflicting-text";
    } else if (idCounts.length === 1) {
      resolvedCount = idCounts[0];
      resolution = "unique-coupon-id";
    } else if (cardCounts.length === 1) {
      resolvedCount = cardCounts[0];
      resolution = "visible-cards";
    } else if (cardCounts.length > 1) {
      resolution = "conflicting-card-counts";
    }

    return { resolvedCount, resolution, evidence };
  }

  function describePageCount(result) {
    if (result.resolvedCount !== null) {
      const labels = {
        "declared-text": "页面声明",
        "unique-coupon-id": "DOM 券 ID",
        "visible-cards": "可见券卡",
      };
      return `${result.resolvedCount}（${labels[result.resolution] || result.resolution}）`;
    }
    if (result.resolution.startsWith("conflicting")) return "发现冲突，需人工核对";
    return "未可靠识别，需人工核对";
  }

  function compareCounts(apiCount, pageCount) {
    if (!Number.isInteger(apiCount) || !Number.isInteger(pageCount)) {
      return { code: "unverifiable", label: "无法自动核对" };
    }
    if (apiCount === pageCount) return { code: "equal", label: `一致（${apiCount}）` };
    return { code: "mismatch", label: `不一致（接口 ${apiCount} / 页面 ${pageCount}）` };
  }

  function sanitizeForExport(value, path = "$", seen = new WeakSet()) {
    if (value === null || typeof value !== "object") {
      return typeof value === "string" ? redactString(value) : value;
    }
    if (seen.has(value)) return "[循环引用已移除]";
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item, index) => sanitizeForExport(item, `${path}[${index}]`, seen));
    }

    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (shouldRemoveExportField(key, childPath)) {
        output[key] = "[已移除]";
      } else {
        output[key] = sanitizeForExport(child, childPath, seen);
      }
    }
    return output;
  }

  function shouldRemoveExportField(key, path) {
    const normalized = String(key).toLowerCase().replace(/[-\s]/g, "_");
    const bare = normalized.replace(/^data_/, "");
    if (/^coupon_?id$/.test(bare)) return false;
    if (
      /^(encrypted_code|coupon_code|coupon_no|serial_code|redeem_code|redemption_code|gift_code|promo_code|claim_code|issue_code)$/.test(
        bare,
      )
    ) {
      return true;
    }
    if (
      /^(cookie|set_cookie|authorization|headers?|request_headers?|password|passwd|secret|bearer|csrf|csrf_token|xsrf|xsrf_token|access_token|refresh_token|id_token|session|session_id|login_token)$/.test(
        bare,
      )
    ) {
      return true;
    }
    if (/(^|_)(authenticity_)?token(?:_|$)/.test(bare)) return true;
    if (/^(user|member|account|customer|profile|personal_info)$/.test(bare)) return true;
    if (/^(email|e_mail|mail_address|user_name|username|display_name|nickname|full_name|real_name|login_id|user_id|member_id|account_id|customer_id|phone|phone_number|mobile|mobile_number|tel|telephone|address|postal_code|zip_code|birthday|birth_date)$/.test(bare)) {
      return true;
    }
    const lowerPath = path.toLowerCase();
    return /\.(user|member|account|customer|profile)\.(name|id|email|mail|login)$/.test(lowerPath);
  }

  function redactString(input) {
    let text = String(input).replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[邮箱已移除]",
    );
    if (/^https?:\/\//i.test(text)) text = sanitizeUrl(text);
    return text;
  }

  function sanitizeUrl(input) {
    try {
      const url = new URL(String(input), location.origin);
      if (!["http:", "https:"].includes(url.protocol)) {
        return "[非 HTTP(S) 链接已移除]";
      }
      for (const key of [...url.searchParams.keys()]) {
        const value = url.searchParams.get(key) || "";
        if (
          /(token|auth|session|sid|email|mail|login|password|csrf|xsrf|user|member|account|customer)/i.test(key) ||
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
        ) {
          url.searchParams.set(key, "[已移除]");
        }
      }
      url.username = "";
      url.password = "";
      return url.href;
    } catch {
      return String(input);
    }
  }

  function safeSchemaSample(path, value) {
    const lowerPath = path.toLowerCase();
    const hidden = /(coupon_?id|user|member|account|customer|email|mail|name|title|code|token|auth|cookie|session|description|detail|info|note|text|url|link|product_all)/i.test(
      lowerPath,
    );
    if (value === null) return "null";
    if (Array.isArray(value)) return `数组(${value.length})`;
    if (isPlainObject(value)) return `对象(${Object.keys(value).length}键)`;
    if (hidden) {
      if (typeof value === "string") return `字符串(${value.length}字符，值已隐藏)`;
      return `${valueType(value)}（值已隐藏）`;
    }
    if (typeof value === "string") {
      const redacted = redactString(value);
      return JSON.stringify(redacted.length > 50 ? `${redacted.slice(0, 47)}…` : redacted);
    }
    return String(value);
  }

  // <cart-coupon-core>
  function cartNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  function cartTokens(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(cartTokens);
    if (isPlainObject(value)) return Object.values(value).flatMap(cartTokens);
    return [String(value)];
  }

  function couponPlainText(value) {
    return String(value || "")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseRelativeValidityDays(text) {
    const patterns = [
      /(?:使用|利用|유효|기한|期限|有效期)[^\d]{0,20}(\d{1,3})\s*(?:日|天|일)/i,
      /(\d{1,3})\s*(?:日|天|일)[^。.!！?？]{0,20}(?:使用|利用|유효|기한|期限|有效)/i,
    ];
    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (matched) return Number(matched[1]);
    }
    return null;
  }

  function parseJstDateTime(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text.replace(" ", "T")}+09:00`
      : text;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function couponExpiryMs(raw) {
    const limit = cartNumber(raw?.limit_date, NaN);
    if (Number.isFinite(limit) && limit > 0) {
      return limit > 1e12 ? limit : limit * 1000;
    }
    return parseJstDateTime(raw?.end_date);
  }

  function canonicalBusinessValue(value) {
    if (Array.isArray(value)) {
      return value
        .map(canonicalBusinessValue)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonicalBusinessValue(value[key])]),
      );
    }
    return value;
  }

  function stableBusinessString(value) {
    return JSON.stringify(canonicalBusinessValue(value));
  }

  function couponMinimumSpend(conditions) {
    const raw = conditions?.price_sum;
    if (Array.isArray(raw)) return Math.max(0, ...raw.map((value) => cartNumber(value)));
    return Math.max(0, cartNumber(raw));
  }

  function normalizeCartCoupon(raw, index) {
    const conditions = isPlainObject(raw?.conditions) ? raw.conditions : {};
    const combinedText = couponPlainText(
      [raw?.coupon_name, raw?.condition_info, raw?.info].filter(Boolean).join(" "),
    );
    const expiryMs = couponExpiryMs(raw);
    const startMs = parseJstDateTime(raw?.start_date);
    const relativeDays = parseRelativeValidityDays(combinedText);
    const discountType = raw?.discount_type === "price" ? "fixed" : "percent";
    const discount = Math.max(0, cartNumber(raw?.discount));
    const minSpend = couponMinimumSpend(conditions);
    const minItems = Math.max(1, Math.round(cartNumber(conditions?.post_condition?.count, 1)));
    const multipleUse = raw?.is_multiple_use === true;
    const validityPolicy =
      raw?.is_static_limit === false && relativeDays
        ? `relative:${relativeDays}`
        : `absolute:${expiryMs || "unknown"}`;
    const equivalentRate =
      discountType === "percent"
        ? discount
        : minSpend > 0
          ? (discount / minSpend) * 100
          : 0;

    return {
      instanceId: String(raw?.coupon_id || `coupon-${index + 1}`),
      name: String(raw?.coupon_name || `优惠券 ${index + 1}`),
      conditionInfo: couponPlainText(raw?.condition_info),
      info: couponPlainText(raw?.info),
      conditionType: String(raw?.condition_type || ""),
      conditions,
      distributeTargets: cartTokens(raw?.distribute_targets).sort(),
      discountType,
      discount,
      minSpend,
      minItems,
      multipleUse,
      affectsPayment: raw?.is_affect_to_payment === true,
      allowsDiscounted:
        raw?.is_affect_to_payment === true ||
        /割引中の作品にも適用|打折中的作品|할인[^。.!]{0,10}(?:적용|사용)/i.test(combinedText),
      expiryMs,
      startMs,
      relativeDays,
      validityPolicy,
      equivalentRate,
      isExceeded: raw?.is_limited_exceeded === true,
      groupKey: stableBusinessString({
        conditionType: String(raw?.condition_type || ""),
        conditions,
        discountType,
        discount,
        distributeTargets: cartTokens(raw?.distribute_targets).sort(),
        multipleUse,
        affectsPayment: raw?.is_affect_to_payment === true,
        validityPolicy,
      }),
    };
  }

  function groupCartCoupons(rawCoupons, nowMs = Date.now()) {
    const grouped = new Map();
    (Array.isArray(rawCoupons) ? rawCoupons : [])
      .map(normalizeCartCoupon)
      .filter((coupon) => !coupon.isExceeded)
      .filter((coupon) => coupon.startMs === null || coupon.startMs <= nowMs)
      .filter((coupon) => coupon.expiryMs === null || coupon.expiryMs >= nowMs)
      .forEach((coupon) => {
        if (!grouped.has(coupon.groupKey)) {
          grouped.set(coupon.groupKey, {
            key: coupon.groupKey,
            conditionType: coupon.conditionType,
            conditions: coupon.conditions,
            distributeTargets: coupon.distributeTargets,
            discountType: coupon.discountType,
            discount: coupon.discount,
            minSpend: coupon.minSpend,
            minItems: coupon.minItems,
            multipleUse: coupon.multipleUse,
            affectsPayment: coupon.affectsPayment,
            allowsDiscounted: coupon.allowsDiscounted,
            validityPolicy: coupon.validityPolicy,
            relativeDays: coupon.relativeDays,
            equivalentRate: coupon.equivalentRate,
            instances: [],
            names: [],
          });
        }
        const group = grouped.get(coupon.groupKey);
        group.instances.push({
          id: coupon.instanceId,
          name: coupon.name,
          expiryMs: coupon.expiryMs,
        });
        if (!group.names.includes(coupon.name)) group.names.push(coupon.name);
        group.allowsDiscounted ||= coupon.allowsDiscounted;
      });

    return [...grouped.values()].map((group) => {
      group.instances.sort((a, b) => (a.expiryMs || Infinity) - (b.expiryMs || Infinity));
      group.earliestExpiryMs = group.instances[0]?.expiryMs || null;
      group.latestExpiryMs = group.instances.at(-1)?.expiryMs || null;
      group.displayName = couponGroupDisplayName(group);
      return group;
    });
  }

  function couponGroupDisplayName(group) {
    if (group.affectsPayment && group.discountType === "fixed" && group.minSpend > 0) {
      return `满${formatCartYen(group.minSpend)}减${formatCartYen(group.discount)}`;
    }
    return group.names[0] || "DLsite 优惠券";
  }

  function tokenSet(value) {
    return new Set(cartTokens(value).map((token) => token.toUpperCase()));
  }

  function setsIntersect(left, right) {
    for (const value of left) if (right.has(value)) return true;
    return false;
  }

  function metadataProductPrice(item, metadata) {
    const value = cartNumber(metadata?.price, NaN);
    return Number.isFinite(value) && value > 0 ? value : item.price;
  }

  function couponMatchesCartProduct(group, item, metadata) {
    const conditions = group.conditions || {};
    const itemIds = tokenSet([item.id, ...(item.alternateIds || [])]);
    switch (group.conditionType) {
      case "payment":
        return true;
      case "id_all":
        return setsIntersect(itemIds, tokenSet(conditions.product_all));
      case "custom_genre":
        return setsIntersect(
          tokenSet(conditions.custom_genre),
          tokenSet(metadata?.custom_genres),
        );
      case "common":
        return setsIntersect(
          tokenSet(conditions.maker_id),
          tokenSet([metadata?.maker_id, metadata?.maker?.id]),
        );
      case "site_ids": {
        const siteMatches = setsIntersect(
          tokenSet(conditions.site_ids),
          tokenSet(metadata?.site_id),
        );
        if (!siteMatches) return false;
        const maximumPrice = cartNumber(conditions.maximum_applicable_price);
        return maximumPrice <= 0 || metadataProductPrice(item, metadata) <= maximumPrice;
      }
      case "worktype":
        return setsIntersect(tokenSet(conditions.worktype), tokenSet(metadata?.work_type));
      default:
        return false;
    }
  }

  function buildCartCouponOptions(items, groups, metadataById, cartSubtotal) {
    const contexts = groups.map((group) => {
      const matchingIds = new Set(
        items
          .filter((item) =>
            couponMatchesCartProduct(group, item, metadataById.get(item.id)),
          )
          .map((item) => item.id),
      );
      const countSatisfied = matchingIds.size >= group.minItems;
      const spendSatisfied = cartSubtotal >= group.minSpend;
      return { group, matchingIds, countSatisfied, spendSatisfied };
    });

    const result = new Map();
    for (const item of items) {
      const options = contexts
        .filter((context) => context.matchingIds.has(item.id))
        .map((context) => {
          const usableNow = context.countSatisfied && context.spendSatisfied;
          let blockedReason = "";
          if (!context.countSatisfied) {
            blockedReason = `还差 ${context.group.minItems - context.matchingIds.size} 部适用作品`;
          } else if (!context.spendSatisfied) {
            blockedReason = `购物车还差 ${formatCartYen(context.group.minSpend - cartSubtotal)}`;
          }
          return { ...context.group, usableNow, blockedReason };
        })
        .sort(
          (a, b) =>
            Number(b.usableNow) - Number(a.usableNow) ||
            b.equivalentRate - a.equivalentRate ||
            (a.earliestExpiryMs || Infinity) - (b.earliestExpiryMs || Infinity),
        );
      result.set(item.id, options);
    }
    return result;
  }

  function buildCartCouponOptionsForAreas(items, groups, metadataById) {
    const activeItems = items.filter((item) => item.area !== "later");
    const activeSubtotal = activeItems.reduce((sum, item) => sum + item.price, 0);
    const activeOptions = buildCartCouponOptions(
      activeItems,
      groups,
      metadataById,
      activeSubtotal,
    );
    const optionsByItem = new Map();

    for (const item of activeItems) {
      optionsByItem.set(item, activeOptions.get(item.id) || []);
    }
    for (const item of items.filter((candidate) => candidate.area === "later")) {
      // “稍后再买”不属于当前订单。仅预览把这一部移入后，订单会有哪些券可用。
      const hypotheticalItems = [...activeItems, { ...item, area: "active" }];
      const hypotheticalSubtotal = activeSubtotal + item.price;
      const hypotheticalOptions = buildCartCouponOptions(
        hypotheticalItems,
        groups,
        metadataById,
        hypotheticalSubtotal,
      );
      optionsByItem.set(item, hypotheticalOptions.get(item.id) || []);
    }

    return { activeItems, activeSubtotal, optionsByItem };
  }

  function resolveCartYenPrice(item, metadata) {
    const cartPrice = cartNumber(item?.price, NaN);
    if (Number.isFinite(cartPrice) && cartPrice > 0) return cartPrice;
    for (const candidate of [metadata?.currency_price?.JPY, metadata?.price]) {
      const value = cartNumber(candidate, NaN);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
  }

  function formatCartYen(value) {
    return `${Math.round(cartNumber(value)).toLocaleString("zh-CN")}日元`;
  }
  // </cart-coupon-core>

  async function enhanceCartCouponMarkers() {
    installCartMarkerStyles();
    const status = mountCartStatus();
    try {
      setCartStatus(status, "正在识别购物车作品……", "reading");
      const items = await waitForCartProducts();
      if (!items.length) {
        throw new Error("没有在“立即购买”或“稍后再买”区域识别到作品；请确认页面已加载完成后刷新");
      }

      const activeCount = items.filter((item) => item.area !== "later").length;
      const laterCount = items.length - activeCount;

      setCartStatus(
        status,
        `已识别立即购买 ${activeCount} 部、稍后再买 ${laterCount} 部，正在读取账号优惠券（请求 1/2）……`,
        "reading",
      );
      const couponPayload = await fetchCartJson(API_PATH, "优惠券接口");
      const rawCoupons = couponArrayFromCartPayload(couponPayload);
      if (!rawCoupons) throw new Error("优惠券接口没有返回可识别的数组");
      const groups = groupCartCoupons(rawCoupons);

      let metadataById = new Map();
      let metadataError = null;
      setCartStatus(
        status,
        `已读取 ${rawCoupons.length} 张券并归为 ${groups.length} 种；正在一次批量读取 ${items.length} 部作品的日元现价和用券条件（请求 2/2）……`,
        "reading",
      );
      try {
        metadataById = await fetchCartProductMetadata(items);
      } catch (error) {
        metadataError = error;
        console.warn(`[${APP_NAME}] cart product metadata failed:`, error);
      }

      for (const item of items) {
        const yenPrice = resolveCartYenPrice(item, metadataById.get(item.id));
        if (yenPrice !== null) item.price = yenPrice;
        renderCartYenPrice(item, yenPrice);
      }

      const { optionsByItem } = buildCartCouponOptionsForAreas(
        items,
        groups,
        metadataById,
      );
      for (const item of items) {
        renderCartCouponCard(item, optionsByItem.get(item) || []);
      }

      const activeUsableOptionCount = items.reduce(
        (sum, item) =>
          sum +
          (item.area === "later"
            ? 0
            : (optionsByItem.get(item) || []).filter((option) => option.usableNow).length),
        0,
      );
      const laterPreviewCount = items.reduce(
        (sum, item) =>
          sum +
          (item.area === "later"
            ? (optionsByItem.get(item) || []).filter((option) => option.usableNow).length
            : 0),
        0,
      );
      if (metadataError) {
        setCartStatus(
          status,
          `已读取 ${rawCoupons.length} 张券并归为 ${groups.length} 种，但作品日元价格/条件接口失败；仅在购物车自带日元字段可读时补价，当前只可靠标记指定 ID 券和满减券。${errorMessage(metadataError)}`,
          "partial",
        );
      } else {
        setCartStatus(
          status,
          `完成：${rawCoupons.length} 张券归为 ${groups.length} 种；立即购买找到 ${activeUsableOptionCount} 个当前可用组合，稍后再买找到 ${laterPreviewCount} 个移入后可用组合。每单仍只能使用一张券。`,
          "success",
        );
      }
    } catch (error) {
      setCartStatus(status, `优惠券标记失败：${errorMessage(error)}`, "error");
    }
  }

  async function fetchCartJson(path, label) {
    const response = await fetch(new URL(path, location.origin), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) {
      const risk = [403, 429].includes(response.status) ? "（检测到风控状态，已停止）" : "";
      throw new Error(`${label}返回 HTTP ${response.status}${risk}`);
    }
    const trimmed = text.trimStart();
    if (!/^(?:\{|\[)/.test(trimmed)) {
      const blockReason = detectBlockingHtml(text, response.url);
      throw new Error(blockReason || `${label}没有返回 JSON`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label}返回的 JSON 无法解析`);
    }
  }

  function couponArrayFromCartPayload(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["coupons", "items", "data", "values"]) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return null;
  }

  async function fetchCartProductMetadata(items) {
    const url = new URL(PRODUCT_INFO_PATH, location.origin);
    url.searchParams.set("product_id", items.map((item) => item.id).join(","));
    const payload = await fetchCartJson(url.href, "作品条件接口");
    return productMetadataMap(payload);
  }

  function productMetadataMap(payload) {
    const rawRecords = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.products)
        ? payload.products
        : isPlainObject(payload?.products)
          ? Object.entries(payload.products).map(([id, value]) => ({
              ...(isPlainObject(value) ? value : {}),
              product_id: value?.product_id || id,
            }))
          : isPlainObject(payload)
            ? Object.entries(payload).map(([id, value]) => ({
                ...(isPlainObject(value) ? value : {}),
                product_id: value?.product_id || id,
              }))
            : [];
    const records = new Map();
    for (const record of rawRecords) {
      const id = String(record?.product_id || record?.workno || record?.id || "").toUpperCase();
      if (id) records.set(id, record);
    }
    return records;
  }

  async function waitForCartProducts() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const items = extractCartProducts();
      if (items.length) return items;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return [];
  }

  function extractCartProducts() {
    const selectors = [
      "li.cart_list_item._cart_items",
      "li.cart_list_item[id^='buy_now_']",
      "li.cart_list_item[id^='buy_later_']",
      "li.cart_list_item[data-workno]",
      "li.n_work_list_item._cart_item",
      "li.n_work_list_item[id^='buy_now_']",
      "li.n_work_list_item[id^='buy_later_']",
      "li.n_work_list_item[data-workno]",
      ".__buy_now_target",
      ".__buy_later_target",
      "section.buy_later a[href*='product_id/']",
      "section.cart_hold a[href*='product_id/']",
    ];
    const seenNodes = new Set();
    const seenKeys = new Set();
    const items = [];
    for (const selector of selectors) {
      for (const rawNode of document.querySelectorAll(selector)) {
        const node =
          rawNode.closest("li.cart_list_item, li.n_work_list_item") ||
          rawNode.closest(".__buy_now_target, .__buy_later_target") ||
          rawNode;
        if (seenNodes.has(node) || isHiddenCartNode(node)) continue;
        seenNodes.add(node);
        const id = extractCartWorkId(node);
        const area = cartProductArea(rawNode, node);
        const key = `${area}:${id}`;
        if (!id || seenKeys.has(key)) continue;
        seenKeys.add(key);
        items.push({
          id,
          alternateIds: extractAlternateCartWorkIds(node, id),
          title: extractCartTitle(node, id),
          price: extractCartCurrentPrice(node),
          area,
          node,
        });
      }
    }
    return items;
  }

  function extractCartWorkId(node) {
    const candidates = [
      node.getAttribute("data-workno"),
      node.getAttribute("data-product-id"),
      node.getAttribute("data-pack-parent-id"),
      node.querySelector("[data-workno]")?.getAttribute("data-workno"),
      node.querySelector("[data-product-id]")?.getAttribute("data-product-id"),
    ];
    const href = node.querySelector('a[href*="product_id/"]')?.getAttribute("href") || "";
    candidates.push(href);
    for (const candidate of candidates) {
      const matched = String(candidate || "").match(/([RBV]J\d{6,})/i);
      if (matched) return matched[1].toUpperCase();
    }
    return null;
  }

  function extractAlternateCartWorkIds(node, primaryId) {
    const values = new Set();
    const add = (value) => {
      const matched = String(value || "").match(/([RBV]J\d{6,})/i);
      if (matched && matched[1].toUpperCase() !== primaryId) values.add(matched[1].toUpperCase());
    };
    add(node.getAttribute("data-pack-parent-id"));
    add(node.getAttribute("data-product-id"));
    add(node.getAttribute("data-workno"));
    const translation = String(node.getAttribute("data-translation_info") || "").replace(/&quot;/g, '"');
    try {
      const parsed = JSON.parse(translation);
      add(parsed?.parent_workno);
      add(parsed?.original_workno);
    } catch {
      // Optional translation metadata is not always present.
    }
    return [...values];
  }

  function extractCartTitle(node, fallback) {
    return (
      node.querySelector(".work_name a, .n_work_name a")?.textContent?.trim() ||
      node.querySelector('a[href*="product_id/"]')?.textContent?.trim() ||
      fallback
    );
  }

  function extractCartCurrentPrice(node) {
    const priceNodes = [
      node.querySelector(".n_work_price_wrap"),
      node.querySelector(".work_price"),
      node.querySelector('[class*="price"]'),
    ].filter(Boolean);
    for (const priceNode of priceNodes) {
      const matches = [...String(priceNode.textContent || "").replace(/,/g, "").matchAll(/(\d{1,8})\s*(?:円|JPY)/gi)];
      if (matches.length) return Number(matches.at(-1)[1]);
    }
    const attributeNames = [
      "data-price",
      "data-sale-price",
      "data-bulkbuy_price",
      "data-bulk-price",
    ];
    for (const name of attributeNames) {
      const direct = node.getAttribute(name) || node.querySelector(`[${name}]`)?.getAttribute(name);
      const parsed = cartNumber(direct, NaN);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 0;
  }

  function cartProductArea(rawNode, ownerNode) {
    const nodes = [rawNode, ownerNode].filter(Boolean);
    for (const node of nodes) {
      if (/^buy_later_/i.test(String(node.id || ""))) return "later";
      if (node.matches?.(".__buy_later_target")) return "later";
      if (node.closest?.(".__buy_later_target, section.buy_later, section.cart_hold")) {
        return "later";
      }
    }
    if (ownerNode?.querySelector?.(".__buy_later_target")) return "later";
    return "active";
  }

  function isHiddenCartNode(node) {
    return (
      node.classList?.contains("_removed") ||
      /display\s*:\s*none/i.test(node.getAttribute("style") || "")
    );
  }

  function cartPriceHost(item) {
    let host =
      item.node.querySelector(".n_work_price_wrap, .work_price") ||
      item.node.querySelector(".cart_list_item_inner") ||
      item.node;
    if (host.tagName === "SPAN" && host.parentElement) host = host.parentElement;
    return host;
  }

  function renderCartYenPrice(item, yenPrice) {
    item.node.querySelector(".dlcr-cart-yen-price")?.remove();
    if (!Number.isFinite(yenPrice) || yenPrice < 0) return;
    const label = element(
      "span",
      "dlcr-cart-yen-price",
      `（${Math.round(yenPrice).toLocaleString("zh-CN")}日元）`,
    );
    const host = cartPriceHost(item);
    const card = host.querySelector(".dlcr-cart-coupon-card");
    if (card?.parentElement === host) host.insertBefore(label, card);
    else host.appendChild(label);
  }

  function renderCartCouponCard(item, options) {
    item.node.querySelector(".dlcr-cart-coupon-card")?.remove();
    const card = element("section", "dlcr-cart-coupon-card");
    const usable = options.filter((option) => option.usableNow);
    const pending = options.filter((option) => !option.usableNow);
    const isLater = item.area === "later";
    if (isLater) card.classList.add("is-buy-later");
    const heading = element("div", "dlcr-cart-card-heading");
    if (usable.length) {
      heading.appendChild(
        element("strong", "", isLater ? `移入后可用券 ${usable.length} 种` : `可用券 ${usable.length} 种`),
      );
      heading.appendChild(
        element(
          "span",
          "dlcr-cart-best",
          `${isLater ? "移入后最佳" : "最佳"} ${formatEquivalentRate(usable[0].equivalentRate)} OFF`,
        ),
      );
    } else {
      heading.appendChild(
        element("strong", "", isLater ? "移入后仍未满足用券条件" : "暂未发现当前可用券"),
      );
    }
    card.appendChild(heading);
    if (isLater) {
      card.appendChild(
        element(
          "div",
          "dlcr-cart-area-note",
          "稍后再买不计入当前订单；以下按“只把这部移入立即购买”预览。",
        ),
      );
    }

    for (const option of [...usable, ...pending]) {
      const row = element(
        "div",
        `dlcr-cart-option${option.usableNow ? "" : " is-pending"}`,
      );
      const rate = element(
        "span",
        "dlcr-cart-rate",
        option.discountType === "fixed"
          ? `等效 ${formatEquivalentRate(option.equivalentRate)}`
          : `${formatEquivalentRate(option.equivalentRate)}`,
      );
      const content = element("div", "dlcr-cart-option-content");
      content.appendChild(element("div", "dlcr-cart-option-name", option.displayName));
      const details = [];
      if (isLater && option.usableNow) details.push("需先移入立即购买");
      if (option.instances.length > 1) details.push(`共 ${option.instances.length} 张`);
      details.push(option.multipleUse ? "期限内无限使用" : "每张一次");
      if (option.minItems > 1) details.push(`至少 ${option.minItems} 部适用作品`);
      if (option.allowsDiscounted) details.push("可用于折扣作品");
      if (option.earliestExpiryMs) details.push(`最早 ${formatChinaDate(option.earliestExpiryMs)} 到期`);
      if (!option.usableNow) details.unshift(option.blockedReason);
      content.appendChild(element("div", "dlcr-cart-option-meta", details.join(" · ")));
      row.append(rate, content);
      card.appendChild(row);
    }

    cartPriceHost(item).appendChild(card);
  }

  function formatEquivalentRate(rate) {
    const value = Math.round(cartNumber(rate) * 10) / 10;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
  }

  function formatChinaDate(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  }

  function mountCartStatus() {
    const root = element("section", "dlcr-cart-status is-reading");
    root.id = "dlcr-cart-status";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.textContent = `${APP_NAME}：准备读取……`;
    root.title = "点按可隐藏这条状态提示";
    root.addEventListener("click", () => root.remove(), { once: true });
    const host = document.body || document.documentElement;
    host.appendChild(root);
    return root;
  }

  function setCartStatus(node, message, state) {
    node.className = `dlcr-cart-status is-${state}`;
    node.textContent = `${APP_NAME}：${message}`;
  }

  function installCartMarkerStyles() {
    if (document.getElementById("dlcr-cart-style")) return;
    const style = document.createElement("style");
    style.id = "dlcr-cart-style";
    style.textContent = `
      .dlcr-cart-status {
        position: fixed; z-index: 2147483647; left: 50%; bottom: max(12px, env(safe-area-inset-bottom));
        transform: translateX(-50%); box-sizing: border-box; width: min(760px, calc(100vw - 24px));
        margin: 0; padding: 10px 12px; border: 1px solid rgba(15, 23, 42, .16);
        border-radius: 9px; box-shadow: 0 5px 24px rgba(15, 23, 42, .28); cursor: pointer;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .dlcr-cart-status.is-reading { color: #854d0e; background: #fef9c3; }
      .dlcr-cart-status.is-success { color: #166534; background: #dcfce7; }
      .dlcr-cart-status.is-partial { color: #9a3412; background: #ffedd5; }
      .dlcr-cart-status.is-error { color: #991b1b; background: #fee2e2; }
      .dlcr-cart-coupon-card {
        clear: both; margin-top: 8px; padding: 8px; color: #1f2937; background: #f8fafc;
        border: 1px solid #cbd5e1; border-radius: 7px; font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .dlcr-cart-yen-price {
        display: inline-block; margin-left: 5px; color: #475569; white-space: nowrap;
        font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .dlcr-cart-coupon-card.is-buy-later { background: #f5f3ff; border-color: #c4b5fd; }
      .dlcr-cart-area-note { margin: -1px 0 5px; color: #6d28d9; font-size: 11px; }
      .dlcr-cart-card-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 5px; }
      .dlcr-cart-best { padding: 2px 7px; color: #fff; background: #dc2626; border-radius: 999px; font-weight: 700; }
      .dlcr-cart-option { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-top: 1px solid #e2e8f0; }
      .dlcr-cart-option.is-pending { opacity: .58; }
      .dlcr-cart-rate { flex: 0 0 auto; min-width: 66px; padding: 2px 5px; color: #fff; background: #ea580c; border-radius: 5px; text-align: center; font-weight: 750; }
      .dlcr-cart-option.is-pending .dlcr-cart-rate { background: #64748b; }
      .dlcr-cart-option-content { min-width: 0; }
      .dlcr-cart-option-name { font-weight: 650; overflow-wrap: anywhere; }
      .dlcr-cart-option-meta { color: #64748b; overflow-wrap: anywhere; }
      @media (max-width: 720px) {
        .dlcr-cart-status { bottom: max(8px, env(safe-area-inset-bottom)); width: calc(100vw - 16px); }
        .dlcr-cart-coupon-card { width: 100%; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  async function exportDiagnostic(mode) {
    if (!lastDiagnosticText) return;
    const approved = window.confirm(
      "诊断 JSON 已移除 Cookie、认证信息、兑换码、邮箱和账号身份字段，但仍保留真实优惠券 ID。请勿公开上传。是否继续？",
    );
    if (!approved) return;

    try {
      if (mode === "copy") {
        await copyText(lastDiagnosticText);
        showActionMessage("诊断 JSON 已复制。请私下发送，不要公开粘贴。", false);
        return;
      }

      const blob = new Blob([lastDiagnosticText], { type: "application/json;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `dlsite-coupon-diagnostic-${fileTimestamp()}.json`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5_000);
      showActionMessage("已发起下载；若 Via 没有保存文件，请改用“复制诊断 JSON”。", false);
    } catch (error) {
      showActionMessage(
        `操作失败：${error instanceof Error ? error.message : String(error)}。请尝试另一种方式。`,
        true,
      );
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Via or WebView may deny the modern Clipboard API; use the legacy fallback.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("浏览器拒绝访问剪贴板");
  }

  function showActionMessage(message, isError) {
    ui.actionMessage.textContent = message;
    ui.actionMessage.style.color = isError ? "#b91c1c" : "#0369a1";
  }

  function appendFact(list, label, value) {
    const wrapper = element("div", "dlcr-fact");
    wrapper.appendChild(element("dt", "", label));
    const dd = element("dd", "", value);
    wrapper.appendChild(dd);
    list.appendChild(wrapper);
    return dd;
  }

  function element(tagName, className = "", text = "") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(label, onClick) {
    const node = element("button", "", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function valueType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (isPlainObject(value)) return "object";
    return typeof value;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function uniqueNumbers(values) {
    return [...new Set(values)].sort((a, b) => a - b);
  }

  function utf8ByteLength(text) {
    try {
      return new TextEncoder().encode(text).length;
    } catch {
      return text.length;
    }
  }

  function fileTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }
})();
