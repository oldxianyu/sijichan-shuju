#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_ORIGIN = "https://merchants.hydee.cn";
const MANAGER_BASE = `${API_ORIGIN}/businesses-gateway/mer-manager/1.0/`;
const MERCHANT_BASE = `${API_ORIGIN}/businesses-gateway/merchant/1.0/`;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateOnly(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function atStart(date) {
  return `${date} 00:00:00`;
}

function atEnd(date) {
  return `${date} 23:59:59`;
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function monthWindow(date) {
  return {
    start: atStart(dateOnly(monthStart(date))),
    end: atEnd(dateOnly(monthEnd(date))),
  };
}

function buildWindows(asOfText = "2026-06-06") {
  const asOf = new Date(`${asOfText || "2026-06-06"}T12:00:00`);
  const last = addMonths(asOf, -1);
  const prev = addMonths(asOf, -2);
  const priorTwoStart = addMonths(asOf, -3);
  const nearStart = addMonths(asOf, -6);
  const prevHalfStart = addMonths(asOf, -12);
  const prevHalfEnd = addMonths(asOf, -7);
  return {
    lastMonth: { label: "上月", ...monthWindow(last) },
    previousMonth: { label: "上上月", ...monthWindow(prev) },
    priorTwoMonths: {
      label: "前两月对比期",
      start: atStart(dateOnly(monthStart(priorTwoStart))),
      end: atEnd(dateOnly(monthEnd(prev))),
    },
    nearHalf: {
      label: "近半年",
      start: atStart(dateOnly(monthStart(nearStart))),
      end: atEnd(dateOnly(monthEnd(last))),
    },
    previousHalf: {
      label: "上期半年",
      start: atStart(dateOnly(monthStart(prevHalfStart))),
      end: atEnd(dateOnly(monthEnd(prevHalfEnd))),
    },
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function md5Upper(value) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex").toUpperCase();
}

function randomClientId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function networkErrorMessage(error) {
  const parts = [error && error.message].filter(Boolean);
  const cause = error && error.cause;
  if (cause && cause.code) parts.push(cause.code);
  if (cause && cause.message && cause.message !== error.message) parts.push(cause.message);
  return parts.join(" / ") || "未知网络错误";
}

function loadStoredAuth(args) {
  if (args.token) return { token: args.token, source: "cli-token" };
  if (process.env.SJC_AUTH_TOKEN) return { token: process.env.SJC_AUTH_TOKEN, source: "env-token" };
  if (args["auth-state"]) {
    const state = readJson(args["auth-state"]);
    if (state.auth) return { token: state.auth, source: "auth-state" };
    if (state.Authorization) return { token: state.Authorization, source: "auth-state" };
  }
  return null;
}

async function loginWithPassword(args) {
  const username = args.username || args.account || process.env.SJC_USERNAME || process.env.SJC_ACCOUNT;
  const password = args.password || process.env.SJC_PASSWORD;
  if (!username || !password) return null;

  let response;
  try {
    response = await fetch(`${MERCHANT_BASE}acc/_login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account: username,
        pwd: md5Upper(password),
        verificationCode: args["verification-code"] || "",
        clientId: args["client-id"] || randomClientId(),
        imgVerificationCode: args["img-verification-code"] || "",
        loginSourceType: Number(args["login-source-type"] || 1),
      }),
    });
  } catch (error) {
    throw new Error(`四季蝉登录接口请求失败：${networkErrorMessage(error)}`);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!response.ok || json.code !== "10000" || !json.data || !json.data.token) {
    throw new Error(`四季蝉登录失败：${json.msg || json.raw || `HTTP ${response.status}`}。如后台要求验证码，请先在浏览器完成验证后再试。`);
  }

  return {
    token: json.data.token,
    source: "username-password",
    loginUserName: json.data.userName || username,
    loginSystem: json.data.system ? json.data.system.reEngSystem || json.data.system.reSystem || "" : "",
  };
}

async function resolveAuth(args) {
  return loadStoredAuth(args) || loginWithPassword(args);
}

function buildHeaders(token, merCode) {
  const headers = {
    "content-type": "application/json",
    Authorization: token,
  };
  if (merCode) {
    headers.merCode = merCode;
    headers.isSuper = "1";
  }
  return headers;
}

function sanitizeRequest(value) {
  if (!value || typeof value !== "object") return value || {};
  const blocked = new Set(["password", "pwd", "token", "authorization"]);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [
      key,
      blocked.has(key.toLowerCase()) ? "***" : walk(child),
    ]));
  };
  return walk(value);
}

function responseData(result) {
  return (result && result.response && result.response.data) || {};
}

function rowsFromPaged(paged) {
  return paged && Array.isArray(paged.rows) ? paged.rows : [];
}

function metricRowsFromObject(value, source, basePath = "") {
  const rows = [];
  const visit = (node, pathParts = []) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) return;
    if (typeof node !== "object") {
      rows.push({
        source,
        path: [basePath, ...pathParts].filter(Boolean).join("."),
        metric: pathParts[pathParts.length - 1] || basePath || "value",
        value: node,
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) visit(child, [...pathParts, key]);
  };
  visit(value);
  return rows.filter((row) => row.value !== "" && row.value !== null && row.value !== undefined);
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const num = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function pickField(row, candidates) {
  for (const key of candidates) {
    if (row && hasValue(row[key])) return row[key];
  }
  return "";
}

function ratioPercent(numerator, denominator) {
  const base = toNumber(denominator);
  if (!base) return 0;
  return Math.round((toNumber(numerator) / base) * 10000) / 100;
}

function sumCandidates(rows, candidates) {
  return (rows || []).reduce((sum, row) => {
    const key = candidates.find((candidate) => row && row[candidate] !== undefined && row[candidate] !== "");
    return sum + (key ? toNumber(row[key]) : 0);
  }, 0);
}

function uniqueCountCandidates(rows, candidates) {
  const values = new Set();
  for (const row of rows || []) {
    const value = pickField(row, candidates);
    if (hasValue(value)) values.add(String(value).trim());
  }
  return values.size;
}

function countRowsWithPositiveCandidate(rows, candidates) {
  return (rows || []).filter((row) => candidates.some((candidate) => toNumber(row && row[candidate]) > 0)).length;
}

function rateLevel(value, good, warning) {
  if (value >= good) return "healthy";
  if (value >= warning) return "watch";
  return "risk";
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function topRowsByCandidates(rows, metricCandidates, fields, limit = 8) {
  return [...(rows || [])]
    .map((row) => {
      const metricKey = metricCandidates.find((candidate) => row && row[candidate] !== undefined && row[candidate] !== "");
      return { row, metricKey, metricValue: metricKey ? toNumber(row[metricKey]) : 0 };
    })
    .filter((item) => item.metricKey && item.metricValue > 0)
    .sort((a, b) => b.metricValue - a.metricValue)
    .slice(0, limit)
    .map((item) => {
      const out = {};
      for (const field of fields) {
        const value = pickField(item.row, field.candidates);
        if (hasValue(value)) out[field.name] = value;
      }
      out.metric = item.metricKey;
      out.value = roundMoney(item.metricValue);
      return out;
    });
}

function hasNonZeroMetric(rows) {
  return rows.some((row) => {
    const value = row.value;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = String(value || "").trim();
    if (!text) return false;
    if (/^(true|yes|是|有)$/i.test(text)) return true;
    return toNumber(text) !== 0;
  });
}

function diagnosticStatusText(item) {
  if (item.status === "failed") return `失败：${item.message || "未知错误"}`;
  if (item.rowCount > 0) return `成功，有明细 ${item.rowCount}行`;
  if (item.metricCount > 0 && item.hasNonZeroMetric) return `成功，有指标 ${item.metricCount}项`;
  if (item.metricCount > 0) return "成功，业务值为0";
  return "成功，无明细";
}

function buildDiagnostic({ label, endpoint, kind, request, result, rows = [], metricRows = [], error }) {
  const failed = Boolean(error || (result && result.error));
  const item = {
    module: label,
    endpoint,
    type: kind,
    status: failed ? "failed" : "success",
    statusText: "",
    httpStatus: (result && result.status) || "",
    businessCode: (result && result.response && result.response.code) || "",
    businessMessage: (result && result.response && result.response.msg) || "",
    rowCount: rows.length,
    metricCount: metricRows.length,
    request: sanitizeRequest(request || (result && (result.request || result.baseRequest)) || {}),
    fetchedAt: (result && result.fetchedAt) || new Date().toISOString(),
    message: (error && error.message) || (result && result.error) || "",
    hasNonZeroMetric: hasNonZeroMetric(metricRows),
  };
  item.statusText = diagnosticStatusText(item);
  return item;
}

function emptyPostResult(endpoint, body, error) {
  return {
    endpoint,
    status: 0,
    request: body || {},
    response: { code: "ERROR", msg: error.message || "接口请求失败", data: null },
    error: error.message || String(error),
    fetchedAt: new Date().toISOString(),
  };
}

function emptyPagedResult(endpoint, body, error, pageSize = 1000) {
  return {
    endpoint,
    baseRequest: body || {},
    pageSize,
    totalCount: 0,
    totalPages: 0,
    rows: [],
    pages: [],
    error: error.message || String(error),
    fetchedAt: new Date().toISOString(),
  };
}

async function postJson(endpoint, body, token, merCode) {
  let response;
  try {
    response = await fetch(MANAGER_BASE + endpoint, {
      method: "POST",
      headers: buildHeaders(token, merCode),
      body: JSON.stringify(body || {}),
    });
  } catch (error) {
    throw new Error(`${endpoint} 接口请求失败：${networkErrorMessage(error)}`);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (json.code && String(json.code) !== "10000") {
    if (String(json.code) === "40301") {
      throw new Error(`${endpoint} 返回 40301：登录成功但业务接口无权限，或 token 不被该接口接受。`);
    }
    throw new Error(`${endpoint} 返回失败：${json.msg || json.code}`);
  }

  return {
    endpoint,
    status: response.status,
    request: body || {},
    response: json,
    fetchedAt: new Date().toISOString(),
  };
}

async function pagedPost(endpoint, baseBody, token, merCode, pageSize = 1000) {
  const pages = [];
  const rows = [];
  let totalCount = 0;
  let totalPages = 1;
  for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
    const result = await postJson(endpoint, { ...baseBody, currentPage, pageSize }, token, merCode);
    pages.push(result);
    const data = result.response && result.response.data;
    if (currentPage === 1) {
      totalCount = Number((data && data.totalCount) || 0);
      totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    }
    if (Array.isArray(data && data.data)) rows.push(...data.data);
  }
  return {
    endpoint,
    baseRequest: baseBody,
    pageSize,
    totalCount,
    totalPages,
    rows,
    pages,
    fetchedAt: new Date().toISOString(),
  };
}

function createClient(token, merCode, diagnostics) {
  return {
    async post(label, endpoint, body) {
      try {
        const result = await postJson(endpoint, body, token, merCode);
        const metricRows = metricRowsFromObject(responseData(result), endpoint, "data");
        diagnostics.push(buildDiagnostic({ label, endpoint, kind: "post", request: body, result, metricRows }));
        return result;
      } catch (error) {
        const result = emptyPostResult(endpoint, body, error);
        diagnostics.push(buildDiagnostic({ label, endpoint, kind: "post", request: body, result, error }));
        return result;
      }
    },
    async paged(label, endpoint, body, pageSize = 1000) {
      try {
        const result = await pagedPost(endpoint, body, token, merCode, pageSize);
        diagnostics.push(buildDiagnostic({ label, endpoint, kind: "paged", request: body, result, rows: result.rows || [] }));
        return result;
      } catch (error) {
        const result = emptyPagedResult(endpoint, body, error, pageSize);
        diagnostics.push(buildDiagnostic({ label, endpoint, kind: "paged", request: body, result, error }));
        return result;
      }
    },
  };
}

function saleBody(window, comparison) {
  return {
    beginTime: window.start,
    endTime: window.end,
    comparisonBeginTime: comparison ? comparison.start : undefined,
    comparisonEndTime: comparison ? comparison.end : undefined,
    authorizeBusinessCode: "",
    commodityCodeList: [],
    saleChannel: "",
    orgClassList: [],
    areaIds: [],
    regionCodes: null,
    subOrgCodes: [],
    goodString: "",
  };
}

async function collectSales(windows, client) {
  const periods = {
    lastMonth_vs_priorTwoMonths: [windows.lastMonth, windows.priorTwoMonths],
    previousMonth: [windows.previousMonth, null],
    priorTwoMonths: [windows.priorTwoMonths, null],
    nearHalf_vs_previousHalf: [windows.nearHalf, windows.previousHalf],
    previousHalf: [windows.previousHalf, null],
  };
  const output = {};
  for (const [name, [window, comparison]] of Object.entries(periods)) {
    const body = saleBody(window, comparison);
    output[name] = {
      label: window.label,
      request: body,
      overview: await client.post(`销售概览-${window.label}`, "industryOrder/queryProductOverview", body),
      products: await client.paged(`销售商品明细-${window.label}`, "industryOrder/queryStatisticsByProductAndMer", body),
    };
  }
  return output;
}

async function collectData(args) {
  const auth = await resolveAuth(args);
  if (!auth || !auth.token) {
    throw new Error("缺少授权信息。请传 --username/--password，或设置 SJC_USERNAME/SJC_PASSWORD，或传 --token。");
  }

  const token = auth.token;
  const merCode = String(args["mer-code"] || "").trim();
  const merName = args["mer-name"] || "";
  const windows = buildWindows(args["as-of"] || "2026-06-06");
  const diagnostics = [];
  const client = createClient(token, merCode, diagnostics);
  const withMerCode = (payload = {}) => (merCode ? { merCode, ...payload } : payload);

  const trainBase = withMerCode({ startTime: windows.nearHalf.start, endTime: windows.nearHalf.end, authorizeBusinessCode: "" });
  const activityBody = (w) => ({ timeType: 1, startTime: w.start, endTime: w.end, summaryType: 1 });
  const rewardBody = { timeType: 1, startTime: windows.nearHalf.start, endTime: windows.nearHalf.end };
  const tipsBody = { startTime: windows.nearHalf.start, endTime: windows.nearHalf.end };

  const raw = {
    meta: {
      project: "四季蝉接口数据导出器",
      source: "登录获取",
      merCode,
      merName,
      collectedAt: new Date().toISOString(),
      windows,
      authSource: auth.source,
      loginUserName: auth.loginUserName || "",
      loginSystem: auth.loginSystem || "",
    },
    sales: await collectSales(windows, client),
    rewardStatistics: {
      nearHalf: {
        rows: await client.paged("奖励统计-近半年", "imActivityReward/commodity/rewardTypeStatistics", rewardBody),
        sum: await client.post("奖励统计合计-近半年", "imActivityReward/commodity/rewardTypeStatistics/sum", rewardBody),
      },
    },
    activitySummary: {
      lastMonth: {
        rows: await client.paged("活动汇总-5月", "imActivityReward/summary/page", activityBody(windows.lastMonth)),
        sum: await client.post("活动汇总合计-5月", "imActivityReward/summary/sum", activityBody(windows.lastMonth)),
      },
      previousMonth: {
        rows: await client.paged("活动汇总-4月", "imActivityReward/summary/page", activityBody(windows.previousMonth)),
        sum: await client.post("活动汇总合计-4月", "imActivityReward/summary/sum", activityBody(windows.previousMonth)),
      },
      nearHalf: {
        rows: await client.paged("活动汇总-近半年", "imActivityReward/summary/page", activityBody(windows.nearHalf)),
        sum: await client.post("活动汇总合计-近半年", "imActivityReward/summary/sum", activityBody(windows.nearHalf)),
      },
    },
    training: {
      courseOverview: await client.post("培训课程概览", "report/course/courseOverview", { ...trainBase, currentPage: 1, pageSize: 10, timeType: 1 }),
      resourceOverview: await client.post("培训资源概览", "report/course/resourceOverview", { ...trainBase, currentPage: 1, pageSize: 10, timeType: 1 }),
      roleLearning: await client.paged("培训角色学习统计", "employeeTrainingStatistics/queryStatisticsByRole", trainBase),
      storeLearning: await client.paged("培训门店学习统计", "employeeTrainingStatistics/queryStatisticsByStore", trainBase),
      employeeLearning: await client.paged("培训员工学习统计", "employeeTrainingStatistics/queryStatisticsByEmployee", trainBase),
      courseLearning: await client.paged("培训课程学习统计", "employeeTrainingStatistics/queryStatisticsByCourse", trainBase),
    },
    manufacturerTips: {
      summary: await client.post("店员圈厂家打赏汇总", "orderShareMoment/shareRewardDetailSum", tipsBody),
      rows: await client.paged("店员圈厂家打赏明细", "orderShareMoment/queryShareRewardDetailList", tipsBody),
    },
    overview: {
      activityTopStatistic: await client.post("概览-活动奖励核心指标", "report/activityReward/queryTopStatisticData", withMerCode({})),
      rewardStat: await client.post("概览-员工奖励提现指标", "report/account/emp/overview/queryRewardStat", withMerCode({ startTime: windows.nearHalf.start, endTime: windows.nearHalf.end, timeType: 1 })),
      orderShareSummary: await client.post("概览-店员圈指标", "report/order_share/orderShareMomentSummary", withMerCode({ startTime: windows.nearHalf.start, endTime: windows.nearHalf.end })),
    },
    exportTasks: null,
  };

  raw.diagnostics = diagnostics;
  if (args["submit-export-tasks"]) raw.exportTasks = await submitExportTasks(raw, client, args.operator || "");
  return raw;
}

async function submitExportTasks(raw, client, operator) {
  const tasks = [];
  async function task(name, endpoint, body) {
    tasks.push({ name, result: await client.post(`异步导出-${name}`, endpoint, body) });
  }
  await task("销售汇总-上月_vs_前两月", "industryOrder/exportStatisticsByProductAndMer", raw.sales.lastMonth_vs_priorTwoMonths.request);
  await task("销售汇总-近半年_vs_上期", "industryOrder/exportStatisticsByProductAndMer", raw.sales.nearHalf_vs_previousHalf.request);
  await task("奖励统计-半年", "rewardBatchTask/commonExport", {
    exportType: "COMMODITY_REWARD_TYPE_STATISTIC_EXPORT",
    operator,
    timeType: 1,
    startTime: raw.meta.windows.nearHalf.start,
    endTime: raw.meta.windows.nearHalf.end,
  });
  await task("活动汇总-上月", "rewardBatchTask/commonExport", {
    exportType: "ACTIVITY_SUMMARY_BY_COMMODITY_EXPORT",
    operator,
    timeType: 1,
    startTime: raw.meta.windows.lastMonth.start,
    endTime: raw.meta.windows.lastMonth.end,
    summaryType: 1,
  });
  await task("培训情况-半年", "employeeTrainingStatistics/exportEmployeeTrainingLearning", {
    operator,
    startTime: raw.meta.windows.nearHalf.start,
    endTime: raw.meta.windows.nearHalf.end,
  });
  await task("厂家打赏-半年", "rewardBatchTask/commonExport", {
    exportType: "IM_ORDER_SHARE_REWARD_DETAIL_EXPORT",
    operator,
    startTime: raw.meta.windows.nearHalf.start,
    endTime: raw.meta.windows.nearHalf.end,
  });
  return tasks;
}

function standardize(raw) {
  const dataset = {
    sales: {},
    reward_statistics: {
      nearHalf: rowsFromPaged(raw.rewardStatistics.nearHalf.rows),
      sum: responseData(raw.rewardStatistics.nearHalf.sum),
    },
    activity_summary: {},
    training: {
      courseOverview: responseData(raw.training.courseOverview),
      resourceOverview: responseData(raw.training.resourceOverview),
      roleLearning: rowsFromPaged(raw.training.roleLearning),
      storeLearning: rowsFromPaged(raw.training.storeLearning),
      employeeLearning: rowsFromPaged(raw.training.employeeLearning),
      courseLearning: rowsFromPaged(raw.training.courseLearning),
    },
    manufacturer_tips: {
      summary: responseData(raw.manufacturerTips.summary),
      rows: rowsFromPaged(raw.manufacturerTips.rows),
    },
    overview: Object.fromEntries(Object.entries(raw.overview).map(([key, value]) => [key, responseData(value)])),
    interface_diagnostics: raw.diagnostics || [],
  };

  for (const [key, value] of Object.entries(raw.sales)) {
    dataset.sales[key] = {
      label: value.label,
      request: value.request,
      overview: responseData(value.overview),
      products: rowsFromPaged(value.products),
    };
  }
  for (const [key, value] of Object.entries(raw.activitySummary)) {
    dataset.activity_summary[key] = {
      rows: rowsFromPaged(value.rows),
      sum: responseData(value.sum),
    };
  }
  if (raw.exportTasks) dataset.export_tasks = raw.exportTasks;
  dataset.data_source_status = buildDataSourceStatus(dataset);
  dataset.operation_insights = deriveOperationInsights(dataset);
  return dataset;
}

function headersFromRows(rows) {
  const headers = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
      if (headers.length >= 40) return headers;
    }
  }
  return headers;
}

function dataSourceStatus({ name, label, rows = [], metricRows = [], note = "" }) {
  let status = "empty";
  let statusText = "业务为0";
  if (rows.length > 0) {
    status = "detail";
    statusText = `有明细 ${rows.length}行`;
  } else if (metricRows.length > 0 && hasNonZeroMetric(metricRows)) {
    status = "metrics";
    statusText = "有指标无明细";
  } else if (metricRows.length > 0) {
    status = "empty";
    statusText = "接口成功，业务值为0";
  }
  return {
    name,
    label,
    status,
    statusText,
    rowCount: rows.length,
    metricCount: metricRows.length,
    headers: headersFromRows(rows),
    note,
  };
}

function buildDataSourceStatus(dataset) {
  const salesRows = Object.values(dataset.sales).flatMap((item) => item.products || []);
  const salesMetrics = Object.entries(dataset.sales).flatMap(([key, value]) => metricRowsFromObject(value.overview, "sales", `${key}.overview`));
  const activityRows = Object.values(dataset.activity_summary).flatMap((item) => item.rows || []);
  const activityMetrics = Object.entries(dataset.activity_summary).flatMap(([key, value]) => metricRowsFromObject(value.sum, "activity_summary", `${key}.sum`));
  const rewardRows = dataset.reward_statistics.nearHalf || [];
  const rewardMetrics = metricRowsFromObject(dataset.reward_statistics.sum, "reward_statistics", "nearHalf.sum");
  const trainingRows = [
    ...(dataset.training.roleLearning || []),
    ...(dataset.training.storeLearning || []),
    ...(dataset.training.employeeLearning || []),
    ...(dataset.training.courseLearning || []),
  ];
  const trainingMetrics = [
    ...metricRowsFromObject(dataset.training.courseOverview, "training", "courseOverview"),
    ...metricRowsFromObject(dataset.training.resourceOverview, "training", "resourceOverview"),
  ];
  const tipsRows = dataset.manufacturer_tips.rows || [];
  const tipsMetrics = metricRowsFromObject(dataset.manufacturer_tips.summary, "manufacturer_tips", "summary");
  const overviewMetrics = Object.entries(dataset.overview).flatMap(([key, value]) => metricRowsFromObject(value, "overview", key));

  return [
    dataSourceStatus({ name: "sales", label: "销售汇总", rows: salesRows, metricRows: salesMetrics, note: "销售商品明细接口，同时包含销售概览指标。" }),
    dataSourceStatus({ name: "activity_summary", label: "活动汇总", rows: activityRows, metricRows: activityMetrics, note: "活动商品明细接口，同时包含活动汇总合计。" }),
    dataSourceStatus({ name: "reward_statistics", label: "奖励统计", rows: rewardRows, metricRows: rewardMetrics, note: "奖励统计明细接口，同时包含奖励金额合计。" }),
    dataSourceStatus({ name: "training", label: "培训情况", rows: trainingRows, metricRows: trainingMetrics, note: "培训接口成功返回；明细为0时以课程/资源概览判断是否有培训承接。" }),
    dataSourceStatus({ name: "manufacturer_tips", label: "厂家打赏", rows: tipsRows, metricRows: tipsMetrics, note: "厂家打赏接口成功返回；金额和明细为0代表当前口径未发生厂家额外激励。" }),
    dataSourceStatus({ name: "overview", label: "概览校验", rows: [], metricRows: overviewMetrics, note: "首页概览是指标型数据，不产生明细行。" }),
  ];
}

function withDataMeta(rows, dataFile, dataPath) {
  return (rows || []).map((row) => ({ ...row, data_file: dataFile, data_path: dataPath }));
}

function deriveOperationInsights(dataset) {
  const productCodeCandidates = ["commodityCode", "wareIspCode", "erpCode", "productCode", "goodsCode", "skuCode", "商品编码"];
  const productNameCandidates = ["commodityName", "productName", "goodsName", "skuName", "商品名称"];
  const salesAmountCandidates = ["saleCommodityAmount", "rewardCommodityAmount", "saleAmount", "salesAmount", "销售金额", "激励商品销售金额"];
  const rewardAmountCandidates = ["rewardSaleAmount", "singleRewardMoney", "multiRewardMoney", "combineRewardMoney", "commodityTargetRewardMoney", "serialTargetRewardMoney", "combinationTargetRewardMoney", "dayRankRewardMoney", "rankingRewardMoney", "rewardAmount", "奖励金额", "激励总金额"];
  const storeCandidates = ["saleStoreNum", "storeNum", "storeCode", "merCode", "门店编码", "动销门店数"];
  const employeeCandidates = ["employeeCode", "empCode", "empId", "employeeName", "empName", "员工编码", "员工姓名"];
  const employeeCountCandidates = ["saleEmpNum", "rewardEmpNum", "empNum", "employeeNum", "参与员工数", "奖励员工数"];
  const rewardPlayFields = [
    ["single_sales", "单品销售奖励", "singleRewardMoney", "单品奖励金额"],
    ["multi_sales", "疗程销售奖励", "multiRewardMoney", "疗程奖励金额"],
    ["combined_sales", "关联销售奖励", "combineRewardMoney", "关联奖励金额"],
    ["single_target", "单品目标奖励", "commodityTargetRewardMoney", "单品目标奖励金额"],
    ["serial_target", "系列目标奖励", "serialTargetRewardMoney", "系列目标奖励金额"],
    ["combination_target", "组合目标奖励", "combinationTargetRewardMoney", "组合目标奖励金额"],
    ["early_bird", "早鸟奖励", "dayRankRewardMoney", "早鸟奖励金额"],
    ["ranking", "排名奖励", "rankingRewardMoney", "排名奖励金额"],
  ];

  const salesRows = Object.entries(dataset.sales || {}).flatMap(([key, value]) => withDataMeta(value.products || [], "sales.json", `${key}.products`));
  const activityRows = Object.entries(dataset.activity_summary || {}).flatMap(([key, value]) => withDataMeta(value.rows || [], "activity_summary.json", `${key}.rows`));
  const rewardRows = withDataMeta(dataset.reward_statistics && dataset.reward_statistics.nearHalf || [], "reward_statistics.json", "nearHalf.rows");
  const trainingRows = [
    ...withDataMeta(dataset.training && dataset.training.roleLearning || [], "training.json", "roleLearning"),
    ...withDataMeta(dataset.training && dataset.training.storeLearning || [], "training.json", "storeLearning"),
    ...withDataMeta(dataset.training && dataset.training.employeeLearning || [], "training.json", "employeeLearning"),
    ...withDataMeta(dataset.training && dataset.training.courseLearning || [], "training.json", "courseLearning"),
  ];
  const tipsRows = withDataMeta(dataset.manufacturer_tips && dataset.manufacturer_tips.rows || [], "manufacturer_tips.json", "rows");
  const trainingMetrics = [
    ...metricRowsFromObject(dataset.training && dataset.training.courseOverview, "training", "courseOverview"),
    ...metricRowsFromObject(dataset.training && dataset.training.resourceOverview, "training", "resourceOverview"),
  ];

  const salesSkuCount = uniqueCountCandidates(salesRows, productCodeCandidates);
  const activeSkuCount = uniqueCountCandidates(activityRows, productCodeCandidates);
  const rewardSkuCount = uniqueCountCandidates(rewardRows, productCodeCandidates);
  const totalSalesAmount = roundMoney(sumCandidates(salesRows, salesAmountCandidates));
  const activitySalesAmount = roundMoney(sumCandidates(activityRows, salesAmountCandidates));
  const rewardRowsAmount = roundMoney(sumCandidates(rewardRows, rewardAmountCandidates));
  const activityRewardAmount = roundMoney(sumCandidates(activityRows, rewardAmountCandidates));
  const totalRewardAmount = rewardRowsAmount || activityRewardAmount;
  const rewardEfficiency = activitySalesAmount ? roundMoney((totalRewardAmount / activitySalesAmount) * 100) : 0;
  const activityCoverageRate = ratioPercent(activeSkuCount || rewardSkuCount, salesSkuCount || activeSkuCount || rewardSkuCount);
  const storeCoverage = uniqueCountCandidates([...salesRows, ...activityRows], storeCandidates);
  const employeeCoverage = uniqueCountCandidates([...activityRows, ...tipsRows], employeeCandidates);
  const employeeParticipationSignal = employeeCoverage || roundMoney(sumCandidates(activityRows, employeeCountCandidates));
  const trainingHasSignal = trainingRows.length > 0 || hasNonZeroMetric(trainingMetrics);
  const shareRecordCount = tipsRows.length;
  const shareRewardAmount = roundMoney(sumCandidates(tipsRows, rewardAmountCandidates));
  const usedRewardPlays = rewardPlayFields
    .map(([key, label, ...fields]) => ({
      key,
      label,
      amount: roundMoney(sumCandidates(rewardRows, fields)),
      skuCount: countRowsWithPositiveCandidate(rewardRows, fields),
    }))
    .filter((item) => item.amount > 0 || item.skuCount > 0);
  const unusedRewardPlays = rewardPlayFields
    .filter(([key]) => !usedRewardPlays.some((item) => item.key === key))
    .map(([, label]) => label);
  const weakActivityRows = activityRows.filter((row) => sumCandidates([row], salesAmountCandidates) <= 0 && sumCandidates([row], rewardAmountCandidates) > 0);

  const scoreItems = [
    { key: "activity_coverage", label: "活动覆盖", value: activityCoverageRate, level: rateLevel(activityCoverageRate, 35, 15), explanation: `活动覆盖约 ${activityCoverageRate}% 的动销品种。` },
    { key: "reward_closure", label: "激励闭环", value: rewardEfficiency, level: activitySalesAmount ? rateLevel(Math.min(rewardEfficiency, 100), 8, 2) : "risk", explanation: activitySalesAmount ? `每100元活动销售对应约 ${rewardEfficiency} 元奖励。` : "未识别到活动销售额，难以证明奖励带动销售。" },
    { key: "employee_participation", label: "员工参与", value: employeeParticipationSignal, level: employeeParticipationSignal ? "watch" : "risk", explanation: employeeParticipationSignal ? `识别到员工/店员参与信号约 ${employeeParticipationSignal}。` : "缺少员工参与、晒单或收益闭环信号。" },
    { key: "training_conversion", label: "培训承接", value: trainingRows.length || trainingMetrics.length, level: trainingHasSignal ? "watch" : "risk", explanation: trainingHasSignal ? "已有培训或学习指标，建议继续绑定销售结果。" : "培训数据为空，客户容易只使用活动红包能力。" },
    { key: "factory_collaboration", label: "厂家协同", value: shareRewardAmount || shareRecordCount, level: shareRecordCount || shareRewardAmount ? "healthy" : "risk", explanation: shareRecordCount || shareRewardAmount ? `厂家晒单/打赏记录 ${shareRecordCount} 条，金额约 ${shareRewardAmount}。` : "厂家打赏和晒单为空，厂家资源没有形成执行证据。" },
  ];
  const healthScore = Math.max(0, Math.min(100, Math.round(scoreItems.reduce((sum, item) => sum + (item.level === "healthy" ? 20 : item.level === "watch" ? 12 : 5), 0))));
  const retentionRisk = healthScore >= 72 ? "low" : healthScore >= 48 ? "medium" : "high";

  return {
    purpose: "Help downstream review tools prove Sijichan value, identify churn risk, and guide customers to use more modules.",
    healthScore,
    retentionRisk,
    scoreItems,
    riskItems: scoreItems.filter((item) => item.level === "risk"),
    valueProofPoints: [
      totalSalesAmount ? `已识别重点品销售额约 ${totalSalesAmount}。` : "",
      activitySalesAmount ? `活动商品销售额约 ${activitySalesAmount}，奖励金额约 ${totalRewardAmount}。` : "",
      usedRewardPlays.length ? `已使用 ${usedRewardPlays.length} 类激励玩法：${usedRewardPlays.map((item) => item.label).join("、")}。` : "",
      storeCoverage ? `识别到 ${storeCoverage} 个门店/机构覆盖信号。` : "",
    ].filter(Boolean),
    recommendedActions: [
      activityCoverageRate < 35 ? "扩大活动覆盖，把AAA主力赚钱品、黄金单品和任务品分层配置。" : "保留当前活动覆盖，并按品种层级复制标杆门店。",
      usedRewardPlays.length < 3 ? `优先补齐 ${unusedRewardPlays.slice(0, 3).join("、")}，让客户看到四季蝉不只是单品红包。` : "复用已跑通玩法，沉淀月度活动模板。",
      trainingHasSignal ? "把培训结果与销售结果同屏复盘，证明学习能转化为推荐动作。" : "补齐培训考试，把重点品卖点学习、考试奖励和销售任务连成闭环。",
      shareRecordCount || shareRewardAmount ? "把厂家打赏和晒单沉淀成大单分享、排行榜和厂家复投证据。" : "推动厂家提供晒单打赏或活动费用，用数据证明资源落到门店执行层。",
      employeeParticipationSignal ? "继续强化店员感知，复盘排行榜、高收益员工和及时收益案例。" : "补齐店员收益闭环，重点展示及时豆、延时豆、可提现收益和到账案例。",
    ],
    metrics: {
      salesSkuCount,
      activeSkuCount,
      rewardSkuCount,
      activityCoverageRate,
      totalSalesAmount,
      activitySalesAmount,
      totalRewardAmount,
      rewardEfficiency,
      storeCoverage,
      employeeCoverage,
      employeeParticipationSignal,
      usedRewardPlayCount: usedRewardPlays.length,
      unusedRewardPlays,
      shareRecordCount,
      shareRewardAmount,
      weakActivitySkuCount: weakActivityRows.length,
    },
    weakActivityItems: topRowsByCandidates(weakActivityRows, rewardAmountCandidates, [
      { name: "productName", candidates: productNameCandidates },
      { name: "productCode", candidates: productCodeCandidates },
      { name: "dataPath", candidates: ["data_path"] },
    ], 8),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const outDir = path.resolve(args["out-dir"] || `sijichan_data_export_${timestamp()}`);
  const rawDir = path.join(outDir, "raw_exports");
  const datasetDir = path.join(outDir, "dataset");
  ensureDir(rawDir);
  ensureDir(datasetDir);

  const raw = await collectData(args);
  const dataset = standardize(raw);
  const rawPath = path.join(rawDir, `sijichan_raw_${timestamp()}.json`);
  writeJson(rawPath, raw);

  const modules = [
    ["manifest", null],
    ["sales", dataset.sales],
    ["reward_statistics", dataset.reward_statistics],
    ["activity_summary", dataset.activity_summary],
    ["training", dataset.training],
    ["manufacturer_tips", dataset.manufacturer_tips],
    ["overview", dataset.overview],
    ["interface_diagnostics", dataset.interface_diagnostics],
    ["data_source_status", dataset.data_source_status],
    ["operation_insights", dataset.operation_insights],
  ];
  if (dataset.export_tasks) modules.push(["export_tasks", dataset.export_tasks]);

  const manifest = {
    project: "四季蝉接口数据导出器",
    merCode: raw.meta.merCode,
    merName: raw.meta.merName,
    generatedAt: raw.meta.collectedAt,
    windows: raw.meta.windows,
    authSource: raw.meta.authSource,
    modules: modules
      .filter(([name]) => name !== "manifest")
      .map(([name]) => ({ name, path: `${name}.json` })),
    note: "This package only exports data and diagnostics. It does not generate business analysis conclusions.",
  };

  writeJson(path.join(datasetDir, "manifest.json"), manifest);
  for (const [name, value] of modules) {
    if (name !== "manifest") writeJson(path.join(datasetDir, `${name}.json`), value);
  }

  const result = {
    outDir,
    rawPath,
    manifestPath: path.join(datasetDir, "manifest.json"),
    datasetDir,
    dataSourceStatusPath: path.join(datasetDir, "data_source_status.json"),
    interfaceDiagnosticsPath: path.join(datasetDir, "interface_diagnostics.json"),
    hasExportTasks: Boolean(dataset.export_tasks),
  };
  writeJson(path.join(outDir, "run_result.json"), result);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
