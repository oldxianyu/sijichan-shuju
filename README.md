# sijichan-shuju

四季蝉后台接口数据导出器。

这个仓库只负责从 `merchants.hydee.cn` 获取并整理四季蝉接口数据，输出标准数据包和接口诊断证据；不生成经营复盘结论，不生成 Excel/Word 报告，也不判断业务好坏。

公开仓库中的示例数据全部为脱敏 demo，不代表任何真实客户。

## 本次更新重点

根据已验证的数据链路，导出器升级为“接口诊断型导出器”：

- 不再只用最终 `0 行` 判断是否取到数据。
- 每个接口都会记录 HTTP 状态、业务码、业务消息、请求参数、明细行数、指标数量、取数时间和失败原因。
- 客户编码 `merCode` 改为选填：不填写时按登录账号默认权限取数，不再强行传 `merCode/isSuper`。
- 输出新增：
  - `dataset/interface_diagnostics.json`
  - `dataset/data_source_status.json`
- 固定自然月口径与 SOP_4CHAN 保持一致，默认以 `2026-06-06` 为基准。

## 数据口径

传入 `--as-of 2026-06-06` 时：

- 上月：`2026-05-01 00:00:00` 至 `2026-05-31 23:59:59`
- 上上月：`2026-04-01 00:00:00` 至 `2026-04-30 23:59:59`
- 前两月对比期：`2026-03-01 00:00:00` 至 `2026-04-30 23:59:59`
- 近半年：`2025-12-01 00:00:00` 至 `2026-05-31 23:59:59`
- 上期半年：`2025-06-01 00:00:00` 至 `2025-11-30 23:59:59`

## 导出模块

脚本会读取这些接口模块：

- 销售汇总：销售概览、销售商品明细
- 奖励统计：近半年奖励类型统计、奖励合计
- 活动汇总：5月、4月、近半年活动商品汇总
- 培训情况：课程概览、资源概览、角色/门店/员工/课程学习明细
- 店员圈厂家打赏：打赏汇总、打赏明细
- 概览校验：活动奖励核心指标、员工奖励提现指标、店员圈指标

## 数据状态口径

`dataset/data_source_status.json` 用于快速判断每个数据源是否可用：

- `detail`：接口成功并返回可复盘明细。
- `metrics`：接口成功并返回指标，但它本身不产生明细行，例如概览类接口。
- `empty`：接口成功，但当前客户/当前时间口径业务值为 0。
- `failed`：接口请求失败、业务码异常、权限不足或 token 不被该接口接受。具体原因见 `dataset/interface_diagnostics.json`。

## 快速开始

推荐用环境变量传账号密码，避免写进命令历史或文件：

```powershell
$env:SJC_USERNAME = "your_account"
$env:SJC_PASSWORD = "your_password"

powershell -ExecutionPolicy Bypass -File .\run-sijichan-data-export.ps1 `
  -OutDir ".\sijichan_data_export_20260606" `
  -AsOf "2026-06-06" `
  -MerName "客户名称"
```

如果要指定客户编码：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-sijichan-data-export.ps1 `
  -Username "your_account" `
  -Password "your_password" `
  -OutDir ".\sijichan_data_export_20260606" `
  -AsOf "2026-06-06" `
  -MerCode "000000" `
  -MerName "某机构"
```

也可以直接运行 Node 脚本：

```bash
node sijichan_data_export.js \
  --username your_account \
  --password your_password \
  --out-dir ./sijichan_data_export_20260606 \
  --as-of 2026-06-06
```

## 参数说明

| 参数 | 说明 |
| --- | --- |
| `--username` / `-Username` | 四季蝉后台账号，也可用 `SJC_USERNAME`。 |
| `--password` / `-Password` | 四季蝉后台密码，也可用 `SJC_PASSWORD`。 |
| `--token` / `-Token` | 备用授权方式，直接传后台 Authorization token。 |
| `--auth-state` / `-AuthStatePath` | 从浏览器授权状态文件读取 token。 |
| `--as-of` / `-AsOf` | 口径基准日，默认 `2026-06-06`。 |
| `--mer-code` / `-MerCode` | 客户编码，选填；为空时不传 `merCode/isSuper`。 |
| `--mer-name` / `-MerName` | 客户名称，选填，仅用于 manifest 标注。 |
| `--out-dir` / `-OutDir` | 输出目录。 |
| `--submit-export-tasks` / `-SubmitExportTasks` | 额外向后台提交异步导出任务。 |

## 输出结构

```text
输出目录/
├─ raw_exports/
│  └─ sijichan_raw_*.json
├─ dataset/
│  ├─ manifest.json
│  ├─ sales.json
│  ├─ reward_statistics.json
│  ├─ activity_summary.json
│  ├─ training.json
│  ├─ manufacturer_tips.json
│  ├─ overview.json
│  ├─ interface_diagnostics.json
│  └─ data_source_status.json
└─ run_result.json
```

## 给后续 AI/分析程序的读取建议

1. 先读取 `dataset/manifest.json`，确认客户、生成时间、日期口径和模块列表。
2. 再读取 `dataset/data_source_status.json`，区分明细型数据、指标型数据、业务值为 0 和接口失败。
3. 如果发现 `failed`，读取 `dataset/interface_diagnostics.json` 看具体接口、业务码和失败原因。
4. 做经营分析时基于 `dataset/*.json` 的标准化数据，不要直接基于 raw 接口响应下结论。

## 安全说明

- 不要提交 `.env`、账号、密码、token、真实客户原始数据。
- 脚本不会把密码或 token 写入输出文件。
- `raw_exports/` 和实际导出的 `dataset/` 应保存在私有目录，不要提交到公开仓库。
- 示例数据只保留脱敏结构和演示字段。
