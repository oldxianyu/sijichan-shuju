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
  return JSON.parse(fs.readFileSync(file, "utf8"));
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

function buildWindows(asOfText) {
  const asOf = asOfText ? new Date(`${asOfText}T12:00:00`) : new Date();
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

function md5Upper(value) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex").toUpperCase();
}

function clientId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function loginWithPassword(args) {
  const username = args.username || args.account || process.env.SJC_USERNAME || process.env.SJC_ACCOUNT;
  const password = args.password || process.env.SJC_PASSWORD;
  if (!username || !password) return null;

  const res = await fetch(`${MERCHANT_BASE}acc/_login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account: username,
      pwd: md5Upper(password),
      verificationCode: args["verification-code"] || "",
      clientId: args["client-id"] || clientId(),
      imgVerificationCode: args["img-verification-code"] || "",
      loginSourceType: Number(args["login-source-type"] || 1),
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.code !== "10000" || !json.data || !json.data.token) {
    throw new Error(`账号密码登录失败：${json.msg || json.raw || `HTTP ${res.status}`}`);
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

function headers(token, merCode) {
  return {
    "content-type": "application/json",
    Authorization: token,
    merCode,
    isSuper: "1",
  };
}

async function postJson(endpoint, body, token, merCode) {
  const res = await fetch(MANAGER_BASE + endpoint, {
    method: "POST",
    headers: headers(token, merCode),
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return {
    endpoint,
    status: res.status,
    request: body || {},
    response: json,
    fetchedAt: new Date().toISOString(),
  };
}

async function pagedPost(endpoint, baseBody, token, merCode, pageSize = 1000) {
  const pages = [];
  let rows = [];
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
    if (Array.isArray(data && data.data)) rows = rows.concat(data.data);
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

async function collectSales(windows, token, merCode) {
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
      overview: await postJson("industryOrder/queryProductOverview", body, token, merCode),
      products: await pagedPost("industryOrder/queryStatisticsByProductAndMer", body, token, merCode),
    };
  }
  return output;
}

async function collectData(args) {
  const auth = await resolveAuth(args);
  if (!auth || !auth.token) {
    throw new Error("缺少授权信息。请传 --username/--password，或设置 SJC_USERNAME/SJC_PASSWORD。");
  }
  const token = auth.token;
  const merCode = args["mer-code"] || "000000";
  const merName = args["mer-name"] || "某机构";
  const windows = buildWindows(args["as-of"]);
  const meta = {
    project: "四季蝉接口数据导出",
    merCode,
    merName,
    collectedAt: new Date().toISOString(),
    windows,
    authSource: auth.source,
    loginUserName: auth.loginUserName || "",
    loginSystem: auth.loginSystem || "",
  };

  const trainBase = { merCode, startTime: windows.nearHalf.start, endTime: windows.nearHalf.end, authorizeBusinessCode: "" };
  const activityBody = (w) => ({ timeType: 1, startTime: w.start, endTime: w.end, summaryType: 1 });
  const rewardBody = { timeType: 1, startTime: windows.nearHalf.start, endTime: windows.nearHalf.end };
  const tipsBody = { startTime: windows.nearHalf.start, endTime: windows.nearHalf.end };

  const raw = {
    meta,
    sales: await collectSales(windows, token, merCode),
    rewardStatistics: {
      nearHalf: {
        rows: await pagedPost("imActivityReward/commodity/rewardTypeStatistics", rewardBody, token, merCode),
        sum: await postJson("imActivityReward/commodity/rewardTypeStatistics/sum", rewardBody, token, merCode),
      },
    },
    activitySummary: {
      lastMonth: {
        rows: await pagedPost("imActivityReward/summary/page", activityBody(windows.lastMonth), token, merCode),
        sum: await postJson("imActivityReward/summary/sum", activityBody(windows.lastMonth), token, merCode),
      },
      previousMonth: {
        rows: await pagedPost("imActivityReward/summary/page", activityBody(windows.previousMonth), token, merCode),
        sum: await postJson("imActivityReward/summary/sum", activityBody(windows.previousMonth), token, merCode),
      },
      nearHalf: {
        rows: await pagedPost("imActivityReward/summary/page", activityBody(windows.nearHalf), token, merCode),
        sum: await postJson("imActivityReward/summary/sum", activityBody(windows.nearHalf), token, merCode),
      },
    },
    training: {
      courseOverview: await postJson("report/course/courseOverview", { ...trainBase, currentPage: 1, pageSize: 10, timeType: 1 }, token, merCode),
      resourceOverview: await postJson("report/course/resourceOverview", { ...trainBase, currentPage: 1, pageSize: 10, timeType: 1 }, token, merCode),
      roleLearning: await pagedPost("employeeTrainingStatistics/queryStatisticsByRole", trainBase, token, merCode),
      storeLearning: await pagedPost("employeeTrainingStatistics/queryStatisticsByStore", trainBase, token, merCode),
      employeeLearning: await pagedPost("employeeTrainingStatistics/queryStatisticsByEmployee", trainBase, token, merCode),
      courseLearning: await pagedPost("employeeTrainingStatistics/queryStatisticsByCourse", trainBase, token, merCode),
    },
    manufacturerTips: {
      summary: await postJson("orderShareMoment/shareRewardDetailSum", tipsBody, token, merCode),
      rows: await pagedPost("orderShareMoment/queryShareRewardDetailList", tipsBody, token, merCode),
    },
    overview: {
      activityTopStatistic: await postJson("report/activityReward/queryTopStatisticData", { merCode }, token, merCode),
      rewardStat: await postJson("report/account/emp/overview/queryRewardStat", { merCode }, token, merCode),
      orderShareSummary: await postJson("report/order_share/orderShareMomentSummary", { merCode }, token, merCode),
    },
    exportTasks: null,
  };

  if (args["submit-export-tasks"]) {
    raw.exportTasks = await submitExportTasks(raw, token, merCode, args.operator || "");
  }

  return raw;
}

async function submitExportTasks(raw, token, merCode, operator) {
  const tasks = [];
  async function task(name, endpoint, body) {
    tasks.push({ name, result: await postJson(endpoint, body, token, merCode) });
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
    merCode,
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

function rowsFromPaged(paged) {
  return paged && Array.isArray(paged.rows) ? paged.rows : [];
}

function standardize(raw) {
  const dataset = {
    sales: {},
    reward_statistics: {
      nearHalf: rowsFromPaged(raw.rewardStatistics.nearHalf.rows),
      sum: raw.rewardStatistics.nearHalf.sum.response.data || {},
    },
    activity_summary: {},
    training: {
      courseOverview: raw.training.courseOverview.response.data || {},
      resourceOverview: raw.training.resourceOverview.response.data || {},
      roleLearning: rowsFromPaged(raw.training.roleLearning),
      storeLearning: rowsFromPaged(raw.training.storeLearning),
      employeeLearning: rowsFromPaged(raw.training.employeeLearning),
      courseLearning: rowsFromPaged(raw.training.courseLearning),
    },
    manufacturer_tips: {
      summary: raw.manufacturerTips.summary.response.data || {},
      rows: rowsFromPaged(raw.manufacturerTips.rows),
    },
    overview: Object.fromEntries(Object.entries(raw.overview).map(([key, value]) => [key, value.response.data || {}])),
  };

  for (const [key, value] of Object.entries(raw.sales)) {
    dataset.sales[key] = {
      label: value.label,
      request: value.request,
      overview: value.overview.response.data || {},
      products: rowsFromPaged(value.products),
    };
  }
  for (const [key, value] of Object.entries(raw.activitySummary)) {
    dataset.activity_summary[key] = {
      rows: rowsFromPaged(value.rows),
      sum: value.sum.response.data || {},
    };
  }
  if (raw.exportTasks) dataset.export_tasks = raw.exportTasks;
  return dataset;
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
    ["sales", dataset.sales],
    ["reward_statistics", dataset.reward_statistics],
    ["activity_summary", dataset.activity_summary],
    ["training", dataset.training],
    ["manufacturer_tips", dataset.manufacturer_tips],
    ["overview", dataset.overview],
  ];
  if (dataset.export_tasks) modules.push(["export_tasks", dataset.export_tasks]);

  const manifest = {
    project: "四季蝉接口数据导出",
    merCode: raw.meta.merCode,
    merName: raw.meta.merName,
    generatedAt: raw.meta.collectedAt,
    windows: raw.meta.windows,
    authSource: raw.meta.authSource,
    modules: modules.map(([name]) => ({ name, path: `${name}.json` })),
    note: "This package only exports data. It does not generate analysis conclusions.",
  };
  writeJson(path.join(datasetDir, "manifest.json"), manifest);
  for (const [name, value] of modules) writeJson(path.join(datasetDir, `${name}.json`), value);

  const result = {
    outDir,
    rawPath,
    manifestPath: path.join(datasetDir, "manifest.json"),
    datasetDir,
    hasExportTasks: Boolean(dataset.export_tasks),
  };
  writeJson(path.join(outDir, "run_result.json"), result);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
