param(
  [ValidateSet('StartDatabase','StopDatabase','DatabaseStatus','Start','Stop','Status')]
  [string]$Action = 'Status'
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Node = 'C:\Program Files\nodejs\node.exe'
$Pg = 'F:\VikingPM\runtime\pgsql\bin\pg_ctl.exe'
$Data = 'F:\VikingPM\data\postgres'
$Config = 'F:\VikingPM\security\application.json'
$PidFile = 'F:\VikingPM\app\application-process.json'
function Get-AppProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $record = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
  $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  if ($process.Path -ne $Node -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.started) { throw '进程记录不匹配，拒绝操作其他进程' }
  return $process
}
try {
  switch ($Action) {
    'DatabaseStatus' { & $Pg status -D $Data; exit $LASTEXITCODE }
    'StartDatabase' {
      & $Pg status -D $Data *> $null
      if ($LASTEXITCODE -eq 0) { Write-Output '数据库已经运行'; break }
      $process = Start-Process -FilePath $Pg -ArgumentList @('start','-D',$Data,'-l','F:\VikingPM\logs\postgres.log','-w','-t','30') -WindowStyle Hidden -PassThru -RedirectStandardOutput 'F:\VikingPM\logs\pg-start.out.log' -RedirectStandardError 'F:\VikingPM\logs\pg-start.err.log'
      if (-not $process.WaitForExit(40000)) { throw '数据库控制进程等待超时' }
      if ($process.ExitCode -ne 0) { throw '数据库启动失败' }
      & $Pg status -D $Data *> $null
      if ($LASTEXITCODE -ne 0) { throw '数据库启动未确认' }; Write-Output '数据库运行状态已确认'
    }
    'StopDatabase' {
      if ($null -ne (Get-AppProcess)) { throw '请先停止应用再停止数据库' }
      & $Pg stop -D $Data -m fast -w
      if ($LASTEXITCODE -ne 0) { throw '数据库停止未确认' }
    }
    'Start' {
      if ($null -ne (Get-AppProcess)) { Write-Output '应用已经运行'; break }
      $old = $env:VIKINGPM_CONFIG
      try {
        $env:VIKINGPM_CONFIG = $Config
        $main = Join-Path $Root 'app\main.mjs'
        $process = Start-Process -FilePath $Node -ArgumentList @(('"'+$main+'"')) -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput 'F:\VikingPM\logs\application.out.log' -RedirectStandardError 'F:\VikingPM\logs\application.err.log'
        @{pid=$process.Id;started=$process.StartTime.ToUniversalTime().Ticks.ToString();root=$Root} | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding utf8
      } finally { $env:VIKINGPM_CONFIG = $old }
      Start-Sleep -Seconds 2
      if ($null -eq (Get-AppProcess)) { throw '应用启动失败；查看固定错误提示，不输出配置内容' }
      Write-Output '应用进程已启动；请用浏览器检查入口和服务状态'
    }
    'Stop' {
      $process = Get-AppProcess
      if ($null -ne $process) { Stop-Process -Id $process.Id; Wait-Process -Id $process.Id -Timeout 15 -ErrorAction SilentlyContinue }
      Write-Output '应用已停止（未删除业务数据）'
    }
    'Status' {
      if ($null -eq (Get-AppProcess)) { Write-Output '应用已停止' } else { Write-Output '应用正在运行' }
      & $Pg status -D $Data
    }
  }
} catch { Write-Output '操作未完成，请联系开发者检查服务状态；不要复制凭证或完整日志。'; exit 1 }
