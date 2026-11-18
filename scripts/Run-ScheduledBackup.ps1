$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $OutputEncoding
$TaskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StatusPath = 'F:\VikingPM\logs\backup-status.json'
$BackupMutex = New-Object System.Threading.Mutex($false, 'Local\VikingPM-Daily-Backup')
$Locked = $false
$StartedAt = [DateTimeOffset]::Now.ToString('o')
try {
    try { $Locked = $BackupMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $Locked = $true }
    if (-not $Locked) { exit 0 }
    @{ state = 'running'; startedAt = $StartedAt } | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
    $env:VIKINGPM_SCHEDULED_BACKUP = '1'
    $ScriptPath = Join-Path $TaskRoot 'scripts\backup-to-share.mjs'
    & 'C:\Program Files\nodejs\node.exe' $ScriptPath 1> 'F:\VikingPM\logs\backup-latest.out.log' 2> 'F:\VikingPM\logs\backup-latest.err.log'
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
    $Report = Get-Content -LiteralPath 'F:\VikingPM\logs\backup-latest.out.log' -Raw | ConvertFrom-Json
    if (-not $Report.restoreVerified -or -not $Report.exactSnapshotRowsMatched -or $Report.restoreDatabaseRetained -ne $false) { throw 'Verification incomplete' }
    @{ state = 'success'; startedAt = $StartedAt; finishedAt = [DateTimeOffset]::Now.ToString('o'); backupFile = $Report.backupFile; sharedFile = $Report.sharedFile; sha256 = $Report.sha256 } | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
    Write-Output '备份及恢复验证成功，已复制到公司共享目录。'
} catch {
    if ($Locked) {
        @{ state = 'failed'; startedAt = $StartedAt; finishedAt = [DateTimeOffset]::Now.ToString('o'); message = '备份未完成，请检查数据库、共享盘连接和固定错误日志；既有备份保留。' } | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
    }
    Write-Output '自动备份未完成，既有备份保留。'
    exit 1
} finally {
    if ($Locked) { $BackupMutex.ReleaseMutex() }
    $BackupMutex.Dispose()
}
