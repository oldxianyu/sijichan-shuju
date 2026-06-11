# sijichan-shuju

四季蝉后台数据导出器。

这个仓库专门负责从 `merchants.hydee.cn` 临时登录取数，把四季蝉后台分散在多个页面里的销售、活动、奖励、员工收益、培训、厂家打赏等数据，整理成一包结构清楚、可诊断、可被 AI 复盘系统直接读取的标准化 JSON 数据。

它更像是“四季蝉复盘的数据底座”：不直接下业务结论，不生成最终汇报页面，也不替客户判断好坏，而是把真实数据、接口状态和可复盘信号干净地准备好，交给 `SOP_4CHAN` 或其他分析程序继续生成报告。

## 最近更新

本轮已经把导出器从“只看有没有行数”的基础取数工具，升级成更适合老客户复盘和续用经营的诊断型数据包。

新增与增强内容：

- 新增 `activity_catalog.json`，读取“我的活动列表”，用于判断客户是否形成持续活动运营池。
- 新增 `reward_distribution.json`，读取奖励发放统计和奖励明细，证明奖励是否真正流向店员。
- 新增 `employee_account.json`，读取员工豆豆账户、提现、延时豆核销和员工结算数据。
- 新增 `data_source_status.json`，每个数据源都能看出是“有明细”“只有指标”“业务为空”还是“接口失败”。
- 新增 `interface_diagnostics.json`，保留接口业务码、业务消息、行数、失败原因和请求时间，方便排查权限和接口异常。
- 新增 `operation_insights.json`，提前计算健康度、流失风险、价值证明点和建议动作，方便 AI 报告直接组织复盘话术。
- 奖励发放明细增加大客户分页保护：当明细量特别大时，默认保留前 20 页明细，并在诊断中记录 `totalCount`、`totalPages`、`fetchedPages` 和 `truncated`。
- 客户编码 `merCode` 改为选填；为空时按登录账号默认权限取数，不强行传 `merCode/isSuper`。
- 活动状态识别已补充真实状态码：当前上架/可运营活动会纳入活动持续运营评分。

一次真实验证中，新客户数据可识别到：

- 销售商品明细：361 行
- 我的活动列表：36 行
- 活动汇总：273 行
- 奖励统计：96 行
- 奖励发放明细：7229 行
- 员工豆豆账户/提现：647 行
- 厂家打赏：3 行

这些数据能帮助复盘从“卖了多少”升级到“活动有没有持续运营、奖励有没有到店员、店员有没有提现感知、客户是否正在用四季蝉形成经营闭环”。

## 数据口径

默认基准日为 `2026-06-06`。传入 `--as-of 2026-06-06` 时，脚本按自然月口径计算：

| 口径 | 时间范围 |
| --- | --- |
| 上月 | `2026-05-01 00:00:00` 至 `2026-05-31 23:59:59` |
| 上上月 | `2026-04-01 00:00:00` 至 `2026-04-30 23:59:59` |
| 前两月对比期 | `2026-03-01 00:00:00` 至 `2026-04-30 23:59:59` |
| 近半年 | `2025-12-01 00:00:00` 至 `2026-05-31 23:59:59` |
| 上期半年 | `2025-06-01 00:00:00` 至 `2025-11-30 23:59:59` |

## 导出模块

脚本会读取并标准化这些模块：

- 销售汇总：销售概览、销售商品明细。
- 我的活动列表：已参加/已配置活动池、活动状态、预算、已用费用、活动销售额。
- 活动汇总：5 月、4 月、近半年活动商品汇总。
- 奖励统计：近半年奖励类型统计、奖励合计。
- 奖励发放明细：奖励发放统计、奖励流向店员的明细。
- 员工豆豆账户/提现：账户汇总、提现汇总、提现明细、延时豆核销、员工结算。
- 培训情况：课程概览、资源概览、角色/门店/员工/课程学习明细。
- 店员圈厂家打赏：打赏汇总、打赏明细。
- 概览校验：活动奖励核心指标、员工奖励提现指标、店员圈指标。

## 输出结构

```text
输出目录/
├─ raw_exports/
│  └─ sijichan_raw_*.json
├─ dataset/
│  ├─ manifest.json
│  ├─ sales.json
│  ├─ activity_catalog.json
│  ├─ activity_summary.json
│  ├─ reward_statistics.json
│  ├─ reward_distribution.json
│  ├─ employee_account.json
│  ├─ training.json
│  ├─ manufacturer_tips.json
│  ├─ overview.json
│  ├─ interface_diagnostics.json
│  ├─ data_source_status.json
│  └─ operation_insights.json
└─ run_result.json
```

## 数据状态说明

`dataset/data_source_status.json` 是排查数据质量的第一入口。

| 状态 | 含义 | 典型用途 |
| --- | --- | --- |
| `detail` | 接口成功并返回可复盘明细 | 可以直接进入 AI 分析 |
| `metrics` | 接口成功并返回指标，但没有明细行 | 适合做概览校验 |
| `empty` | 接口成功，但当前客户或当前时间口径业务值为 0 | 判断客户是否未使用该模块 |
| `failed` | 接口失败、业务码异常、权限不足或 token 不被接受 | 读取 `interface_diagnostics.json` 排查 |

## 运营洞察

`dataset/operation_insights.json` 会提前提炼一组面向复盘的话术素材：

- `healthScore`：客户四季蝉使用健康度。
- `retentionRisk`：续用风险，分为 `low`、`medium`、`high`。
- `scoreItems`：活动持续运营、活动覆盖、激励闭环、员工参与、培训承接、厂家协同。
- `valueProofPoints`：可直接用于复盘汇报的价值证明点。
- `recommendedActions`：下一步运营建议。
- `metrics`：关键量化指标，例如活动数、上架活动数、活动销售额、奖励金额、提现金额、员工参与信号等。

这个文件的目标不是替代 AI，而是让 AI 不再从一堆接口明细里盲猜，先拿到一套清晰的经营线索。

## 快速开始

推荐用环境变量传账号密码，避免写进命令历史或文件。

```powershell
$env:SJC_USERNAME = "your_account"
$env:SJC_PASSWORD = "your_password"

powershell -ExecutionPolicy Bypass -File .\run-sijichan-data-export.ps1 `
  -OutDir ".\sijichan_data_export_20260606" `
  -AsOf "2026-06-06" `
  -MerName "客户名称"
```

也可以直接运行 Node 脚本：

```bash
node sijichan_data_export.js \
  --username your_account \
  --password your_password \
  --out-dir ./sijichan_data_export_20260606 \
  --as-of 2026-06-06
```

如果需要指定客户编码：

```bash
node sijichan_data_export.js \
  --username your_account \
  --password your_password \
  --mer-code 000000 \
  --mer-name 客户名称 \
  --out-dir ./sijichan_data_export_20260606 \
  --as-of 2026-06-06
```

## 参数说明

| 参数 | 说明 |
| --- | --- |
| `--username` / `-Username` | 四季蝉后台账号，也可使用 `SJC_USERNAME`。 |
| `--password` / `-Password` | 四季蝉后台密码，也可使用 `SJC_PASSWORD`。 |
| `--token` / `-Token` | 备用授权方式，直接传后台 Authorization token。 |
| `--auth-state` / `-AuthStatePath` | 从浏览器授权状态文件读取 token。 |
| `--as-of` / `-AsOf` | 口径基准日，默认 `2026-06-06`。 |
| `--mer-code` / `-MerCode` | 客户编码，选填；为空时不传 `merCode/isSuper`。 |
| `--mer-name` / `-MerName` | 客户名称，选填，仅用于 manifest 标注。 |
| `--out-dir` / `-OutDir` | 输出目录。 |
| `--submit-export-tasks` / `-SubmitExportTasks` | 额外向后台提交异步导出任务。 |

## 给 AI/分析程序的读取建议

1. 先读 `dataset/manifest.json`，确认客户、生成时间、日期口径和模块列表。
2. 再读 `dataset/data_source_status.json`，判断哪些数据源可用、哪些只是指标、哪些为空、哪些失败。
3. 如果存在 `failed`，读取 `dataset/interface_diagnostics.json`，看具体接口、业务码和失败原因。
4. 读取 `dataset/operation_insights.json`，优先使用健康度、风险项、价值证明点和建议动作组织复盘话术。
5. 做经营分析时基于 `dataset/*.json` 的标准化数据，不要直接基于 raw 接口响应下结论。

## 和 SOP_4CHAN 的关系

`sijichan-shuju` 是数据导出器，负责把四季蝉后台数据整理成标准数据包。

`SOP_4CHAN` 是门户和报告系统，负责登录、上传、AI 复盘、历史报告、分享网页、SVG 长图、二维码和 Excel 汇总。

两者使用同一套核心口径：自然月取数、活动配置池、奖励发放、员工豆豆账户、数据源诊断和续用风险洞察。

## 安全说明

- 不要提交 `.env`、账号、密码、token、真实客户原始数据。
- 脚本不会把密码或 token 写入输出文件。
- `raw_exports/` 和实际导出的 `dataset/` 应保存到私有目录，不要提交到公开仓库。
- 公开仓库中的示例数据应只保留脱敏结构和演示字段。

## 2026-06-11 更新：动销率口径升级

本仓库新增 `operation_base.json` 基础档案模块，用于把复盘报告里的“门店动销率、人员动销率、商品动销率”从活动接口里的平均字段，升级为按新零售后台真实经营底数计算。

新增取数与计算口径：

- 门店总数：读取 `merchant/institution/list` 页面对应的门店/机构数据，当前接口为 `memberDefend/chooseStoreList`，只统计状态可用、机构类型不是“仓库”的门店。
- 员工总数：读取 `merchant/personManager/index` 页面对应的员工数据，当前接口为 `csd-staff/_searchEmployee`，只统计员工账号、在职、随心看启用，且随心看角色属于“店员、店长、运营、区域经理”的员工。
- 商品总数：优先从四季蝉概览接口 `report/activityReward/queryTopStatisticData` 提取商品相关总数；若概览未返回明确商品总数，则回退为活动/销售明细里的唯一商品数。
- 门店动销率 = 动销门店数 / 启用且非仓库门店总数。
- 人员动销率 = 动销员工数 / 符合随心看条件员工总数。
- 商品动销率 = 动销商品数 / 四季蝉商品总数。

输出变化：

- `dataset/operation_base.json` 保存基础档案原始行、筛选后摘要和数据来源说明。
- `dataset/data_source_status.json` 新增 `operation_base` 数据源状态。
- `dataset/interface_diagnostics.json` 会记录基础档案接口的成功/失败、行数、分页和业务消息。
- `dataset/operation_insights.json` 的 `metrics` 新增 `movingRates`、`storeMovingRate`、`employeeMovingRate`、`productMovingRate` 以及对应分子/分母字段，供 `SOP_4CHAN` 生成中文复盘报告和 Excel 汇总使用。
