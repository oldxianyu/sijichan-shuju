param(
  [string]$Username,
  [string]$Password,
  [string]$Token,
  [string]$AuthStatePath,
  [string]$OutDir,
  [string]$AsOf,
  [string]$MerCode = "",
  [string]$MerName = "",
  [string]$Operator = "",
  [switch]$SubmitExportTasks
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeScript = Join-Path $ScriptDir "sijichan_data_export.js"
if (-not (Test-Path -LiteralPath $NodeScript)) {
  throw "Cannot find Node script: $NodeScript"
}

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $default = "C:\Program Files\nodejs\node.exe"
  if (Test-Path -LiteralPath $default) { return $default }
  throw "Node.js was not found. Please install Node.js or add node.exe to PATH."
}

$node = Find-Node
$nodeArgs = @($NodeScript)
if ($MerCode) { $nodeArgs += @("--mer-code", $MerCode) }
if ($MerName) { $nodeArgs += @("--mer-name", $MerName) }
if ($Username) { $nodeArgs += @("--username", $Username) }
if ($Password) { $nodeArgs += @("--password", $Password) }
if ($Token) { $nodeArgs += @("--token", $Token) }
if ($AuthStatePath) { $nodeArgs += @("--auth-state", $AuthStatePath) }
if ($OutDir) { $nodeArgs += @("--out-dir", $OutDir) }
if ($AsOf) { $nodeArgs += @("--as-of", $AsOf) }
if ($Operator) { $nodeArgs += @("--operator", $Operator) }
if ($SubmitExportTasks) { $nodeArgs += "--submit-export-tasks" }

$jsonText = & $node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw "Node data export script failed." }
($jsonText -join "`n") | ConvertFrom-Json | ConvertTo-Json -Depth 5
