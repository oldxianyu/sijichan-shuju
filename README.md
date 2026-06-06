# 四季蝉接口数据导出器

`sijichan-shuju` 只负责从四季蝉后台导出接口数据，输出标准数据包，不做经营分析、不写复盘结论、不生成 Excel/Word 报告。它适合把数据交给其他智能体、BI 工具或后续分析流程继续处理。

> 公开仓库说明：仓库中的示例客户统一使用“某机构”，商户编码统一使用 `000000`。示例数据仅用于演示结构，不代表任何真实客户经营情况。

## 功能清单

- 账号密码自动登录后台，不需要手工复制 token。
- 按固定自然月口径请求销售、奖励、活动、培训、厂家打赏、概览接口。
- 输出完整原始接口响应到 `raw_exports/`。
- 输出标准化数据包到 `dataset/`，供其他智能体读取。
- 可选创建后台异步导出任务。
- 兼容备用授权方式：`--token`、`SJC_AUTH_TOKEN`、`--auth-state`。

## 不做的事情

- 不生成经营复盘结论。
- 不做老板视角分析。
- 不生成 Excel 工作簿。
- 不生成 Word 报告。
- 不判断业务好坏，只负责提供结构化数据。

## 环境要求

- Windows PowerShell 5+ 或 PowerShell 7+
- Node.js 18+

本仓库不依赖 Microsoft Excel 或 Word。

## 快速开始

推荐把账号密码放在临时环境变量中，不要写进配置文件：

```powershell
$env:SJC_USERNAME = "000000_admin"
$env:SJC_PASSWORD = "你的后台密码"

powershell -ExecutionPolicy Bypass -File .\run-sijichan-data-export.ps1 `
  -OutDir ".\四季蝉数据导出_某机构_20260606" `
  -AsOf "2026-06-06" `
  -MerCode "000000" `
  -MerName "某机构" `
  -Operator "000000_admin"
```

也可以直接传参：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-sijichan-data-export.ps1 `
  -Username "000000_admin" `
  -Password "你的后台密码" `
  -OutDir ".\四季蝉数据导出_某机构_20260606" `
  -AsOf "2026-06-06" `
  -MerCode "000000" `
  -MerName "某机构"
```

## 参数说明

| 参数 | 说明 |
| --- | --- |
| `-Username` | 后台账号。也可用环境变量 `SJC_USERNAME`。 |
| `-Password` | 后台密码。也可用环境变量 `SJC_PASSWORD`。 |
| `-AsOf` | 口径基准日，例如 `2026-06-06`。脚本自动推算上月、上上月、近半年、上期半年。 |
| `-MerCode` | 商户编码。公开示例使用 `000000`。 |
| `-MerName` | 商户名称。公开示例使用“某机构”。 |
| `-Operator` | 操作人，用于后台导出任务记录。 |
| `-SubmitExportTasks` | 额外创建后台异步导出任务。 |
| `-Token` | 备用授权方式，直接传后台 Authorization token。 |
| `-AuthStatePath` | 备用授权方式，从浏览器授权状态文件读取 token。 |

## 登录逻辑

脚本使用后台网页登录同款逻辑：

```text
account + MD5(password).toUpperCase() + clientId + loginSourceType=1
```

登录成功后只使用返回的接口 token 发起后续请求。脚本不会把密码或 token 写入输出文件。

## 日期口径

传入 `-AsOf "2026-06-06"` 时：

- 上月：2026-05-01 至 2026-05-31
- 上上月：2026-04-01 至 2026-04-30
- 前两月对比期：2026-03-01 至 2026-04-30
- 近半年：2025-12-01 至 2026-05-31
- 上期半年：2025-06-01 至 2025-11-30

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
│  └─ overview.json
└─ run_result.json
```

## 给其他智能体的读取约定

1. 先读取 `dataset/manifest.json`，确认商户、生成时间、日期口径和模块列表。
2. 再按 `manifest.modules[].path` 读取各模块 JSON。
3. 如果要做分析，请基于 `dataset/` 下的标准化数据；如需追溯接口细节，再查看 `raw_exports/`。
4. 本数据包不包含分析结论，后续智能体应自行完成指标解释、图表和报告。

## 示例产物

`examples/demo_dataset/` 是脱敏 demo：

- 客户名固定为“某机构”
- 商户编码固定为 `000000`
- 商品、门店、员工、金额均为虚拟值
- 不包含真实 raw_exports、手机号、订单号、员工姓名、真实商品明细或任何 token

## 安全提醒

- 不要提交 `.env`、密码、token、真实客户数据。
- 如果 token 曾经出现在聊天、日志或命令历史中，请立即在 GitHub 或后台系统撤销并重新生成。
- 公开仓库只保留可复用脚本和脱敏示例；真实输出应保存在私有目录或私有仓库。
