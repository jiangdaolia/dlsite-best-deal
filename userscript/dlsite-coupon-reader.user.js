// ==UserScript==
// @name         DLsite 优惠券读取器（验证 A 版）
// @namespace    https://github.com/jiangdaolia/dlsite-best-deal
// @version      0.1.2
// @description  在“我的优惠券”页面用一次同源请求读取 JSON 或 HTML 数据，并导出安全诊断
// @author       Syoius & Cassandra-fox; coupon reader maintained by jiangdaolia
// @license      MIT
// @match        https://www.dlsite.com/*/mypage/coupon*
// @match        https://www.dlsite.com/mypage/coupon*
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
  // Stage A intentionally contains no price-history or optimizer code.

  const APP_NAME = "DLsite 优惠券读取器";
  const APP_VERSION = "0.1.2";
  const ROOT_ID = "dlsite-coupon-reader-a";
  const STYLE_ID = `${ROOT_ID}-style`;
  const API_PATH = "/books/mypage/coupon/list/ajax";
  const REQUEST_TIMEOUT_MS = 30_000;
  const MAX_SCHEMA_ROWS = 300;
  const MAX_SCHEMA_DEPTH = 9;
  const MAX_SCHEMA_ARRAY_SAMPLE = 20;

  if (!/\/mypage\/coupon(?:\/|[?#]|$)/i.test(location.href)) return;
  if (document.getElementById(ROOT_ID)) return;

  const startedAt = new Date().toISOString();
  const pageEvidence = collectPageCountEvidence(document);
  let requestCount = 0;
  let diagnostic = makeInitialDiagnostic();
  let lastDiagnosticText = "";

  const ui = mountPanel();
  void readOnce();

  function makeInitialDiagnostic() {
    return {
      format: "dlsite-coupon-reader-diagnostic-v1",
      script: {
        name: APP_NAME,
        version: APP_VERSION,
        stage: "A",
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
    heading.appendChild(element("span", "dlcr-badge", "验证 A 版"));
    headingRow.appendChild(heading);
    root.appendChild(headingRow);

    const scope = element(
      "p",
      "dlcr-scope",
      "本版只验证读取通路：一次同源请求；不读详情、不翻页、不访问作品或第三方网站。",
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
